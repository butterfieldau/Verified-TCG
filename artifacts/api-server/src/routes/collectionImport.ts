import { createHash } from "node:crypto";
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  collectionImportJobsTable,
  collectionItemsTable,
  collectionListItemsTable,
  collectionListsTable,
  db,
  wishlistItemsTable,
} from "@workspace/db";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import {
  normalizeCollectorNumber,
  normalizeForMatching,
  normalizeGameSlug,
} from "../catalogue/internal/catalogueNormalisation.js";
import {
  readCanonicalPublicCard,
  readCanonicalPublicCards,
  type PublicCatalogueCard,
} from "../catalogue/internal/catalogueReadService.js";
import { justTcg } from "../lib/catalogueProvider.js";
import { gradeKeyForHolding } from "../pricing/portfolio.js";
import { logActivitySafely } from "./activity.js";
import { clearUserWishlists } from "./wishlist.js";

const router = Router();

export const COLLECTION_IMPORT_SCHEMA_VERSION = 1;
export const COLLECTION_ORGANIZATION_SCHEMA_VERSION = 2;
export const COLLECTION_IMPORT_MAX_BYTES = 1024 * 1024;
export const COLLECTION_IMPORT_MAX_ROWS = 1_000;
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CollectionImportSource = "collectr" | "verified_tcg";
export type CollectionImportRowStatus =
  | "matched"
  | "watchlist_only"
  | "ambiguous"
  | "invalid"
  | "unmatched"
  | "duplicate";

export const VERIFIED_TCG_V2_HEADERS = [
  "Verified TCG CSV Version", "Source", "Record Type", "Holding ID", "Card ID",
  "Card Name", "TCG", "Set", "Set Code", "Card Number", "Rarity", "Finish",
  "Condition", "Graded", "Grade Company", "Grade", "Grade Designation",
  "Grade Original", "Certificate Number", "Graded Date", "Quantity",
  "Acquired Date", "Acquisition Currency", "Acquisition Unit Price", "For Sale",
  "For Trade", "Notes", "List Name", "List Names", "List Position",
] as const;

interface NormalizedImportRow {
  recordType?: "holding";
  rowNumber: number;
  status: CollectionImportRowStatus;
  source: CollectionImportSource;
  rowFingerprint: string;
  cardId?: string;
  canonicalCardId?: string;
  card?: Record<string, unknown>;
  candidateCount?: number;
  error?: string;
  isWatchlistOnly: boolean;
  quantity?: number;
  condition?: string;
  acquiredAt?: string;
  acquiredPrice?: number;
  currency?: string;
  notes?: string;
  finish?: string;
  variance?: string;
  grading?: Record<string, unknown>;
  desiredGrade?: string;
  isForSale?: boolean;
  isForTrade?: boolean;
  pricingAvailable?: boolean;
  supportedGrade?: boolean;
  holdingId?: string;
  listNames?: string[];
}

interface NormalizedImportList {
  recordType: "list";
  rowNumber: number;
  status: "valid" | "invalid" | "duplicate";
  name?: string;
  position?: number;
  error?: string;
}

type NormalizedImportRecord = NormalizedImportRow | NormalizedImportList;

export interface CollectionImportPreviewSummary {
  total: number;
  matched: number;
  watchlistOnly: number;
  invalid: number;
  ambiguous: number;
  unmatched: number;
  duplicate: number;
  priced: number;
  listCount?: number;
  membershipCount?: number;
  listsToCreate?: string[];
  listsToMerge?: string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cleanHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Bounded RFC 4180 parser used for user-provided migration files.
 * It supports BOM, CRLF/LF, escaped quotes, quoted commas and embedded lines.
 */
export function parseCollectionCsv(content: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  if (Buffer.byteLength(content, "utf8") > COLLECTION_IMPORT_MAX_BYTES) {
    throw new Error("CSV file is larger than the 1 MB import limit.");
  }
  if (content.includes("\u0000")) throw new Error("CSV contains invalid null bytes.");

  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell.length > 0) throw new Error("CSV has an unexpected quote.");
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim() !== "")) records.push(row);
      row = [];
      if (records.length > COLLECTION_IMPORT_MAX_ROWS + 1) {
        throw new Error(`CSV has more than ${COLLECTION_IMPORT_MAX_ROWS} data rows.`);
      }
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) records.push(row);

  if (records.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  if (records.length - 1 > COLLECTION_IMPORT_MAX_ROWS) {
    throw new Error(`CSV has more than ${COLLECTION_IMPORT_MAX_ROWS} data rows.`);
  }

  const rawHeaders = records[0]!.map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, "") : value,
  );
  const normalizedHeaders = rawHeaders.map(cleanHeader);
  if (normalizedHeaders.some((header) => !header)) throw new Error("CSV contains a blank header.");
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error("CSV contains duplicate headers.");
  }

  const rows = records.slice(1).map((values, rowIndex) => {
    if (values.length > rawHeaders.length) {
      throw new Error(`Row ${rowIndex + 2} has more columns than the header.`);
    }
    return Object.fromEntries(normalizedHeaders.map((header, columnIndex) => [
      header,
      values[columnIndex] ?? "",
    ]));
  });
  return { headers: rawHeaders, rows };
}

export function detectCollectionCsvSource(headers: string[]): CollectionImportSource {
  const collectrRequired = [
    "Portfolio Name", "Category", "Set", "Product Name", "Card Number", "Rarity",
    "Variance", "Grade", "Card Condition", "Average Cost Paid", "Quantity",
    "Market Price (As of DATE)", "Price Override", "Watchlist", "Date Added", "Notes",
  ];
  const collectrHeaders = [...headers];
  if (/^Market Price \(As of \d{4}-\d{2}-\d{2}\)$/.test(collectrHeaders[11] ?? "")) {
    collectrHeaders[11] = "Market Price (As of DATE)";
  }
  if (
    collectrHeaders.length === collectrRequired.length &&
    collectrHeaders.every((header, index) => header === collectrRequired[index])
  ) {
    return "collectr";
  }
  if (
    headers.length === VERIFIED_TCG_V2_HEADERS.length &&
    headers.every((header, index) => header === VERIFIED_TCG_V2_HEADERS[index])
  ) {
    return "verified_tcg";
  }
  const verifiedHeaders = [
    "Verified TCG CSV Version", "Source", "Card ID", "Card Name", "TCG", "Set",
    "Set Code", "Card Number", "Rarity", "Finish", "Condition", "Graded",
    "Grade Company", "Grade", "Grade Designation", "Grade Original",
    "Certificate Number", "Graded Date", "Quantity", "Acquired Date",
    "Acquisition Currency", "Acquisition Unit Price", "For Sale", "For Trade", "Notes",
  ];
  if (
    headers.length === verifiedHeaders.length &&
    headers.every((header, index) => header === verifiedHeaders[index])
  ) {
    return "verified_tcg";
  }
  throw new Error(
    "CSV headers do not match a supported Collectr or Verified TCG export.",
  );
}

export function detectCollectionCsvVersion(headers: string[]): number {
  if (
    headers.length === VERIFIED_TCG_V2_HEADERS.length &&
    headers.every((header, index) => header === VERIFIED_TCG_V2_HEADERS[index])
  ) {
    return COLLECTION_ORGANIZATION_SCHEMA_VERSION;
  }
  detectCollectionCsvSource(headers);
  return COLLECTION_IMPORT_SCHEMA_VERSION;
}

function field(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = row[cleanHeader(name)];
    if (value !== undefined) return value.trim();
  }
  return "";
}

function rawField(row: Record<string, string>, name: string): string {
  return row[cleanHeader(name)] ?? "";
}

function truthy(value: string): boolean {
  return ["true", "yes", "1", "y"].includes(value.trim().toLowerCase());
}

function parseAmount(value: string): number | null {
  const normalized = value.replace(/[$£€¥,\s]/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseListNames(value: string): string[] | null {
  if (!value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const names: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") return null;
    const name = item.trim();
    if (!name || name.length > 100 || names.includes(name)) return null;
    names.push(name);
  }
  return names.length <= 100 ? names : null;
}

const CONDITION_ALIASES: Record<string, string> = {
  mint: "mint",
  m: "mint",
  nearmint: "near_mint",
  nm: "near_mint",
  excellent: "excellent",
  ex: "excellent",
  good: "good",
  lightlyplayed: "light_played",
  lightplayed: "light_played",
  lp: "light_played",
  played: "played",
  moderatelyplayed: "played",
  heavilyplayed: "played",
  mp: "played",
  hp: "played",
  poor: "poor",
  damaged: "poor",
  dmg: "poor",
};

function condition(value: string): string | null {
  if (!value.trim()) return "near_mint";
  return CONDITION_ALIASES[cleanHeader(value)] ?? null;
}

function parseGrade(
  value: string,
  acquiredAt: string,
): {
  grading?: Record<string, unknown>;
  desiredGrade?: string;
  supported: boolean;
} {
  const original = value.trim();
  if (!original || /^(raw|ungraded|none|n\/a)$/i.test(original)) {
    return { supported: true };
  }

  const match = original.match(/^([A-Za-z]+)?\s*([0-9]+(?:\.[0-9]+)?)(.*)$/);
  if (!match) {
    return {
      desiredGrade: original,
      grading: {
        company: "UNSUPPORTED",
        grade: original,
        certNumber: "",
        gradedAt: acquiredAt,
        original,
      },
      supported: false,
    };
  }

  const company = (match[1] || "UNSPECIFIED").toUpperCase();
  const grade = Number(match[2]);
  const designation = match[3]?.trim() || undefined;
  const grading = {
    company,
    grade,
    certNumber: "",
    gradedAt: acquiredAt,
    ...(designation ? { designation } : {}),
    original,
  };
  return {
    grading,
    desiredGrade: original,
    supported: gradeKeyForHolding(true, grading) !== null,
  };
}

function parseVerifiedGrade(
  row: Record<string, string>,
  acquiredAt: string,
): {
  grading?: Record<string, unknown>;
  desiredGrade?: string;
  supported: boolean;
} {
  if (!truthy(field(row, "Graded"))) return { supported: true };
  const company = field(row, "Grade Company").toUpperCase();
  const gradeText = field(row, "Grade");
  const original = field(row, "Grade Original");
  const designation = field(row, "Grade Designation");
  const certNumber = field(row, "Certificate Number");
  const gradedAt = isoDate(field(row, "Graded Date")) ?? acquiredAt;
  if (!company || !gradeText) {
    const retainedOriginal = original || [
      company, gradeText, designation,
    ].filter(Boolean).join(" ") || "Unsupported graded value";
    return {
      supported: false,
      desiredGrade: retainedOriginal,
      grading: {
        company: company || "UNSUPPORTED",
        grade: gradeText || retainedOriginal,
        certNumber,
        gradedAt,
        ...(designation ? { designation } : {}),
        original: retainedOriginal,
      },
    };
  }
  const numericGrade = Number(gradeText);
  const grade: string | number = Number.isFinite(numericGrade)
    ? numericGrade
    : gradeText;
  const grading = {
    company,
    grade,
    certNumber,
    gradedAt,
    ...(designation ? { designation } : {}),
    ...(original ? { original } : {}),
  };
  return {
    grading,
    desiredGrade: original || `${company} ${gradeText}${designation ? ` ${designation}` : ""}`,
    supported: gradeKeyForHolding(true, grading) !== null,
  };
}

function normalizeRarity(value: string): string {
  const rarity = normalizeForMatching(value);
  if (rarity.includes("special illustration")) return "special_illustration";
  if (rarity.includes("hyper")) return "hyper_rare";
  if (rarity.includes("secret")) return "secret_rare";
  if (rarity.includes("ultra")) return "ultra_rare";
  if (rarity.includes("holo")) return "holo_rare";
  if (rarity.includes("uncommon")) return "uncommon";
  if (rarity.includes("common")) return "common";
  return "rare";
}

function appTcg(game: string): string {
  const slug = normalizeGameSlug(game);
  return slug === "magic-the-gathering"
    ? "magic"
    : slug === "one-piece"
      ? "onepiece"
      : slug === "yu-gi-oh"
        ? "yugioh"
        : slug === "dragon-ball"
          ? "dragonball"
          : slug ?? normalizeForMatching(game).replace(/\s+/g, "");
}

function appCard(
  card: PublicCatalogueCard,
  finish: string,
  variance: string,
): Record<string, unknown> {
  const foilEvidence = normalizeForMatching(`${finish} ${variance}`);
  return {
    id: card.id,
    name: card.name,
    setId: card.set_code ?? card.set,
    setCode: card.set_code ?? undefined,
    setName: card.set_name,
    tcg: appTcg(card.game),
    number: card.number ?? "",
    rarity: normalizeRarity(card.rarity ?? ""),
    year: card.release_date ? Number(card.release_date.slice(0, 4)) || 0 : 0,
    imageUrl: card.image_url ?? undefined,
    gradientStart: "#202020",
    gradientEnd: "#090909",
    isFoil: /\b(foil|holo|reverse)\b/.test(foilEvidence),
    finish: finish || undefined,
    variance: variance || undefined,
    price: {
      raw: 0,
      available: false,
      currency: "AUD",
      updatedAt: null,
    },
  };
}

function exactCandidate(
  candidate: PublicCatalogueCard,
  evidence: {
    source: CollectionImportSource;
    game: string;
    set: string;
    number: string;
    name: string;
    finish: string;
    setCode?: string;
    rarity?: string;
  },
): boolean {
  if (normalizeGameSlug(candidate.game) !== normalizeGameSlug(evidence.game)) return false;
  const comparableName = (value: string, number: string | null | undefined) => {
    let normalized = normalizeForMatching(value);
    const normalizedNumber = normalizeForMatching(number ?? "");
    if (normalizedNumber && normalized.endsWith(` ${normalizedNumber}`)) {
      normalized = normalized.slice(0, -(normalizedNumber.length + 1)).trim();
    }
    return normalized
      .replace(/\b(?:borderless|extended art|manga|jp|secret)\b/g, "")
      .replace(/\b0*\d{1,4}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };
  const candidateName = comparableName(candidate.name, candidate.number);
  const evidenceName = comparableName(evidence.name, evidence.number);
  if (
    normalizeForMatching(candidate.name) !== normalizeForMatching(evidence.name)
    && candidateName !== evidenceName
  ) return false;
  const set = normalizeForMatching(evidence.set);
  const candidateSet = normalizeForMatching(candidate.set_name);
  const comparableSet = (value: string) => value
    .replace(/^(?:sv|sm|xy)\s+/, "")
    .replace(/\b(?:pokemon|cards|card|promos|promo)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    set &&
    set !== candidateSet &&
    comparableSet(set) !== comparableSet(candidateSet) &&
    set !== normalizeForMatching(candidate.set_code ?? "") &&
    (evidence.source !== "collectr" || !evidence.number)
  ) return false;
  if (
    evidence.setCode &&
    normalizeForMatching(candidate.set_code ?? "") !== normalizeForMatching(evidence.setCode)
  ) return false;
  if (
    evidence.number &&
    normalizeCollectorNumber(candidate.number) !== normalizeCollectorNumber(evidence.number)
  ) return false;
  if (
    evidence.rarity &&
    evidence.source !== "collectr" &&
    normalizeForMatching(candidate.rarity ?? "") !== normalizeForMatching(evidence.rarity)
  ) return false;
  if (evidence.finish && evidence.source !== "collectr") {
    const finish = normalizeForMatching(evidence.finish);
    const finishes = candidate.variants
      .map((variant) => normalizeForMatching(String(variant.finish ?? variant.name ?? "")))
      .filter(Boolean);
    if (finishes.length > 0 && !finishes.some((value) => value === finish)) return false;
  }
  return true;
}

async function providerGameId(game: string, set: string, name: string): Promise<string | null> {
  const normalized = normalizeGameSlug(game);
  if (!normalized) return null;
  if (
    normalized === "pokemon"
    && /\b(?:jp|japanese)\b/i.test(`${set} ${name}`)
  ) return "pokemon-japan";
  if (normalized === "one-piece") return "one-piece-card-game";
  return normalized;
}

function providerCard(
  raw: Record<string, unknown>,
): PublicCatalogueCard | null {
  if (!raw.id || !raw.name || !(raw.set_name ?? raw.set) || !raw.game) return null;
  const variants = Array.isArray(raw.variants)
    ? raw.variants.map((variant) => {
        const value = variant as Record<string, unknown>;
        return {
          name: typeof value.name === "string" ? value.name : null,
          finish: typeof value.printing === "string"
            ? value.printing
            : typeof value.finish === "string" ? value.finish : null,
        };
      })
    : [];
  return {
    id: String(raw.id),
    name: String(raw.name),
    game: String(raw.game).replace(/\s+Japan$/i, ""),
    set: String(raw.set_name ?? raw.set),
    set_name: String(raw.set_name ?? raw.set),
    set_code: typeof raw.set_code === "string" ? raw.set_code : null,
    number: typeof raw.number === "string" ? raw.number : null,
    rarity: typeof raw.rarity === "string" ? raw.rarity : null,
    image_url: typeof raw.image_url === "string" ? raw.image_url : null,
    language: typeof raw.language === "string" ? raw.language : null,
    region: typeof raw.region === "string" ? raw.region : null,
    release_date: typeof raw.release_date === "string" ? raw.release_date : null,
    variants,
  };
}

async function candidatesForRow(input: {
  source: CollectionImportSource;
  cardId: string;
  game: string;
  set: string;
  number: string;
  name: string;
  finish: string;
  setCode?: string;
  rarity?: string;
}): Promise<PublicCatalogueCard[]> {
  if (input.source === "verified_tcg" && input.cardId) {
    const result = await readCanonicalPublicCard(input.cardId);
    if (result.outcome === "canonical_error") {
      throw new Error("CATALOGUE_UNAVAILABLE");
    }
    return result.value && exactCandidate(result.value, input) ? [result.value] : [];
  }

  const result = await readCanonicalPublicCards({
    query: input.name,
    game: input.game,
    limit: 100,
    offset: 0,
  });
  if (result.outcome === "canonical_error") throw new Error("CATALOGUE_UNAVAILABLE");
  const canonical = result.value.filter((candidate) => exactCandidate(candidate, input));
  if (canonical.length || input.source !== "collectr") return canonical;

  const game = await providerGameId(input.game, input.set, input.name);
  if (!game) return [];
  const rows: Record<string, unknown>[] = [];
  for (const query of [...new Set([input.name, input.number].filter(Boolean))]) {
    const response = await justTcg(`/cards?${new URLSearchParams({
      q: query,
      game,
      limit: "100",
      offset: "0",
      include_price_history: "false",
    }).toString()}`);
    if (response.status >= 500 || response.status === 429) {
      throw new Error("CATALOGUE_UNAVAILABLE");
    }
    if (
      response.body && typeof response.body === "object"
      && Array.isArray((response.body as { data?: unknown }).data)
    ) {
      rows.push(...(response.body as { data: Record<string, unknown>[] }).data);
    }
  }
  const matches = rows
    .map(providerCard)
    .filter((candidate): candidate is PublicCatalogueCard => Boolean(candidate))
    .filter((candidate) => exactCandidate(candidate, input));
  return [...new Map(matches.map((candidate) => [candidate.id, candidate])).values()];
}

function previewSummary(rows: NormalizedImportRow[]): CollectionImportPreviewSummary {
  return {
    total: rows.length,
    matched: rows.filter((row) => row.status === "matched").length,
    watchlistOnly: rows.filter((row) => row.status === "watchlist_only").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    ambiguous: rows.filter((row) => row.status === "ambiguous").length,
    unmatched: rows.filter((row) => row.status === "unmatched").length,
    duplicate: rows.filter((row) => row.status === "duplicate").length,
    priced: rows.filter((row) => row.pricingAvailable).length,
  };
}

async function addOrganizationPreview(
  rows: NormalizedImportRecord[],
  summary: CollectionImportPreviewSummary,
  userId: string,
): Promise<CollectionImportPreviewSummary> {
  const definitions = rows.filter(
    (row): row is NormalizedImportList =>
      row.recordType === "list" && row.status === "valid" && Boolean(row.name),
  );
  const names: string[] = [];
  for (const definition of definitions) {
    if (!names.includes(definition.name!)) names.push(definition.name!);
  }
  const existing = await db
    .select({ name: collectionListsTable.name })
    .from(collectionListsTable)
    .where(eq(collectionListsTable.userId, userId));
  const existingNames = new Set(existing.map((list) => list.name));
  const listsToCreate = names.filter((name) => !existingNames.has(name));
  const listsToMerge = names.filter((name) => existingNames.has(name));
  if (existing.length + listsToCreate.length > 100) {
    throw new Error("This CSV would exceed the 100 custom-list limit.");
  }
  const membershipCount = rows
    .filter((row): row is NormalizedImportRow =>
      row.recordType === "holding" && row.status === "matched",
    )
    .reduce((count, row) => count + (row.listNames?.length ?? 0), 0);

  return {
    ...summary,
    total: rows.length,
    invalid: summary.invalid +
      rows.filter((row) => row.recordType === "list" && row.status === "invalid").length,
    duplicate: summary.duplicate +
      rows.filter((row) => row.recordType === "list" && row.status === "duplicate").length,
    listCount: names.length,
    membershipCount,
    listsToCreate,
    listsToMerge,
  };
}

export async function normalizeRows(
  source: CollectionImportSource,
  sourceRows: Array<Record<string, string>>,
  schemaVersion = COLLECTION_IMPORT_SCHEMA_VERSION,
): Promise<NormalizedImportRecord[]> {
  const normalized: NormalizedImportRecord[] = [];
  const seen = new Set<string>();
  const seenListNames = new Set<string>();
  const candidateCache = new Map<string, Promise<PublicCatalogueCard[]>>();

  for (let index = 0; index < sourceRows.length; index += 1) {
    const sourceRow = sourceRows[index]!;
    const rowNumber = index + 2;
    if (schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION) {
      const recordType = field(sourceRow, "Record Type").toLowerCase();
      if (
        rawField(sourceRow, "Verified TCG CSV Version") !==
          String(COLLECTION_ORGANIZATION_SCHEMA_VERSION) ||
        rawField(sourceRow, "Source") !== "Verified TCG"
      ) {
        if (recordType === "list") {
          normalized.push({
            recordType: "list",
            rowNumber,
            status: "invalid",
            error: "Verified TCG rows must declare version 2 and source Verified TCG.",
          });
        } else {
          normalized.push({
            recordType: "holding",
            rowNumber,
            status: "invalid",
            source,
            rowFingerprint: sha256(JSON.stringify(sourceRow)),
            isWatchlistOnly: false,
            error: "Verified TCG rows must declare version 2 and source Verified TCG.",
          });
        }
        continue;
      }
      if (recordType === "list") {
        const name = field(sourceRow, "List Name");
        const positionText = field(sourceRow, "List Position");
        const position = Number(positionText);
        if (
          !name ||
          name.length > 100 ||
          !Number.isInteger(position) ||
          position < 0 ||
          position > 999
        ) {
          normalized.push({
            recordType: "list",
            rowNumber,
            status: "invalid",
            error: "List rows require a name (up to 100 characters) and a whole-number position.",
          });
        } else if (seenListNames.has(name)) {
          normalized.push({
            recordType: "list",
            rowNumber,
            status: "duplicate",
            name,
            position,
            error: "Duplicate list definition in this CSV.",
          });
        } else {
          seenListNames.add(name);
          normalized.push({ recordType: "list", rowNumber, status: "valid", name, position });
        }
        continue;
      }
      if (recordType !== "holding") {
        normalized.push({
          recordType: "holding",
          rowNumber,
          status: "invalid",
          source,
          rowFingerprint: sha256(JSON.stringify(sourceRow)),
          isWatchlistOnly: false,
          error: "Record Type must be holding or list.",
        });
        continue;
      }
    }
    const isWatchlistOnly =
      source === "collectr" && truthy(field(sourceRow, "Watchlist"));
    const game = field(sourceRow, source === "collectr" ? "Category" : "TCG");
    const set = field(sourceRow, "Set");
    const name = field(sourceRow, source === "collectr" ? "Product Name" : "Card Name");
    const number = field(sourceRow, source === "collectr" ? "Card Number" : "Card Number", "Number");
    const rarity = field(sourceRow, "Rarity");
    const variance = field(sourceRow, "Variance");
    const finish = field(sourceRow, "Finish") || variance;
    const rawCondition = field(sourceRow, source === "collectr" ? "Card Condition" : "Condition");
    const rawGrade = field(sourceRow, "Grade");
    const gradeCompany = field(sourceRow, "Grade Company");
    const gradeValue = gradeCompany && rawGrade ? `${gradeCompany} ${rawGrade}` : rawGrade;
    const quantityValue = field(sourceRow, "Quantity");
    const acquiredDate = field(sourceRow, source === "collectr" ? "Date Added" : "Acquired Date");
    const acquisitionCurrency = field(sourceRow, "Acquisition Currency");
    const costValue = field(
      sourceRow,
      source === "collectr" ? "Average Cost Paid" : "Acquisition Unit Price",
    );
    const notes = field(sourceRow, "Notes");
    const cardId = field(sourceRow, "Card ID");
    const holdingId = schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION
      ? field(sourceRow, "Holding ID")
      : "";
    const listNames = schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION
      ? parseListNames(rawField(sourceRow, "List Names"))
      : [];
    const rowFingerprint = sha256(JSON.stringify(sourceRow));

    const base: NormalizedImportRow = {
      recordType: "holding",
      rowNumber,
      status: "invalid",
      source,
      rowFingerprint,
      isWatchlistOnly,
    };

    if (
      source === "verified_tcg" &&
      (
        rawField(sourceRow, "Verified TCG CSV Version") !== String(schemaVersion) ||
        rawField(sourceRow, "Source") !== "Verified TCG"
      )
    ) {
      normalized.push({
        ...base,
        error: `Verified TCG rows must declare version ${schemaVersion} and source Verified TCG.`,
      });
      continue;
    }
    if (source === "verified_tcg" && !cardId) {
      normalized.push({
        ...base,
        error: "Verified TCG rows require a Card ID.",
      });
      continue;
    }
    if (
      schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION &&
      (!holdingId || !UUID_RE.test(holdingId))
    ) {
      normalized.push({
        ...base,
        error: "Holding rows require a valid Holding ID.",
      });
      continue;
    }
    if (schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION && listNames === null) {
      normalized.push({
        ...base,
        error: "List Names must be a JSON array of unique names.",
      });
      continue;
    }

    if (seen.has(rowFingerprint)) {
      normalized.push({ ...base, status: "duplicate", error: "Duplicate row in this CSV." });
      continue;
    }
    seen.add(rowFingerprint);

    if (!game || !set || !name) {
      normalized.push({
        ...base,
        error: "Game, set and product/card name are required.",
      });
      continue;
    }
    if (!normalizeGameSlug(game)) {
      normalized.push({ ...base, error: `Unsupported TCG: ${game}.` });
      continue;
    }

    const normalizedCondition = condition(rawCondition);
    if (!normalizedCondition) {
      normalized.push({ ...base, error: `Unsupported condition: ${rawCondition}.` });
      continue;
    }

    const quantity = isWatchlistOnly
      ? 0
      : Number(quantityValue || "1");
    if (!isWatchlistOnly && (!Number.isInteger(quantity) || quantity < 1 || quantity > 9_999)) {
      normalized.push({ ...base, error: "Quantity must be a whole number from 1 to 9,999." });
      continue;
    }

    const acquiredAt = isoDate(acquiredDate);
    if (!isWatchlistOnly && !acquiredAt) {
      normalized.push({ ...base, error: "Holdings require a valid Date Added/Acquired Date." });
      continue;
    }
    const acquiredPrice = parseAmount(costValue);
    if (acquiredPrice === null) {
      normalized.push({ ...base, error: "Average/unit cost must be a non-negative number." });
      continue;
    }
    if (notes.length > 2_000) {
      normalized.push({ ...base, error: "Notes must not exceed 2,000 characters." });
      continue;
    }
    if (source === "verified_tcg" && !/^[A-Za-z]{3}$/.test(acquisitionCurrency)) {
      normalized.push({ ...base, error: "Acquisition Currency must be a 3-letter ISO code." });
      continue;
    }

    const effectiveDate = acquiredAt ?? new Date().toISOString().slice(0, 10);
    const parsedGrade = source === "verified_tcg"
      ? parseVerifiedGrade(sourceRow, effectiveDate)
      : parseGrade(gradeValue, effectiveDate);
    const cacheKey = JSON.stringify([
      source, cardId, normalizeForMatching(game), normalizeForMatching(set),
      normalizeCollectorNumber(number), normalizeForMatching(name),
      normalizeForMatching(finish),
      normalizeForMatching(field(sourceRow, "Set Code")),
      normalizeForMatching(rarity),
    ]);
    let candidatePromise = candidateCache.get(cacheKey);
    if (!candidatePromise) {
      candidatePromise = candidatesForRow({
        source,
        cardId,
        game,
        set,
        number,
        name,
        finish,
        setCode: field(sourceRow, "Set Code"),
        rarity,
      });
      candidateCache.set(cacheKey, candidatePromise);
    }
    const candidates = await candidatePromise;
    if (candidates.length === 0) {
      normalized.push({
        ...base,
        status: "unmatched",
        error: "No exact Verified TCG catalogue match.",
      });
      continue;
    }
    if (candidates.length > 1) {
      normalized.push({
        ...base,
        status: "ambiguous",
        candidateCount: candidates.length,
        error: `${candidates.length} exact catalogue matches need review.`,
      });
      continue;
    }

    const matched = candidates[0]!;
    normalized.push({
      ...base,
      status: isWatchlistOnly ? "watchlist_only" : "matched",
      cardId: matched.id,
      canonicalCardId: matched.id,
      card: appCard(matched, finish, variance),
      candidateCount: 1,
      quantity: isWatchlistOnly ? undefined : quantity,
      condition: normalizedCondition,
      acquiredAt: effectiveDate,
      acquiredPrice,
      currency: acquisitionCurrency ? acquisitionCurrency.toUpperCase() : undefined,
      notes: notes || (finish ? `Imported finish/variance: ${finish}` : undefined),
      finish: finish || undefined,
      variance: variance || undefined,
      grading: parsedGrade.grading,
      desiredGrade: parsedGrade.desiredGrade,
      isForSale: truthy(field(sourceRow, "For Sale")),
      isForTrade: truthy(field(sourceRow, "For Trade")),
      pricingAvailable: false,
      supportedGrade: parsedGrade.supported,
      ...(holdingId ? { holdingId } : {}),
      ...(listNames ? { listNames } : {}),
    });
  }
  if (schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION) {
    const definitionsByName = new Map<string, NormalizedImportList[]>();
    for (const record of normalized) {
      if (record.recordType !== "list" || !record.name) continue;
      const definitions = definitionsByName.get(record.name) ?? [];
      definitions.push(record);
      definitionsByName.set(record.name, definitions);
    }
    const validNames = new Set<string>();
    const duplicateNames = new Set<string>();
    for (const [name, definitions] of definitionsByName) {
      if (definitions.length === 1 && definitions[0]!.status === "valid") {
        validNames.add(name);
      } else {
        duplicateNames.add(name);
        for (const definition of definitions) {
          definition.status = "duplicate";
          definition.error = "List names must be defined exactly once in a version 2 CSV.";
        }
      }
    }
    const holdingsById = new Map<string, NormalizedImportRow[]>();
    for (const record of normalized) {
      if (record.recordType !== "holding" || !record.holdingId) continue;
      const matching = holdingsById.get(record.holdingId) ?? [];
      matching.push(record);
      holdingsById.set(record.holdingId, matching);
    }
    for (const duplicates of holdingsById.values()) {
      if (duplicates.length < 2) continue;
      for (const duplicate of duplicates) {
        duplicate.status = "invalid";
        duplicate.error = "Holding IDs must appear exactly once in a version 2 CSV.";
      }
    }
    for (const record of normalized) {
      if (record.recordType !== "holding" || !record.listNames?.length) continue;
      const invalidName = record.listNames.find(
        (name) => !validNames.has(name) || duplicateNames.has(name),
      );
      if (invalidName) {
        record.status = "invalid";
        record.error = duplicateNames.has(invalidName)
          ? `List "${invalidName}" is defined more than once.`
          : `List "${invalidName}" does not have a list-definition row.`;
      }
    }
  }
  return normalized;
}

router.post(
  "/collection/import/preview",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    try {
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      if (!content) {
        res.status(400).json({ message: "CSV content is required." });
        return;
      }
      const parsed = parseCollectionCsv(content);
      const source = detectCollectionCsvSource(parsed.headers);
      const schemaVersion = detectCollectionCsvVersion(parsed.headers);
      const requestedCurrency =
        typeof req.body?.sourceCurrency === "string"
          ? req.body.sourceCurrency.trim().toUpperCase()
          : null;
      if (requestedCurrency && !/^[A-Z]{3}$/.test(requestedCurrency)) {
        res.status(400).json({ message: "Source currency must be a 3-letter ISO code." });
        return;
      }

      const contentSha256 = sha256(content);
      const existing = await db
        .select()
        .from(collectionImportJobsTable)
        .where(and(
          eq(collectionImportJobsTable.userId, req.userId!),
          eq(collectionImportJobsTable.contentSha256, contentSha256),
        ))
        .limit(1);
      const existingJob = existing[0];
      if (existingJob && (
        existingJob.status === "committed" ||
        existingJob.expiresAt.getTime() > Date.now()
      )) {
        res.json({
          jobId: existingJob.id,
          source: existingJob.source,
          schemaVersion: existingJob.schemaVersion,
          contentSha256,
          summary: existingJob.previewSummary,
          rows: existingJob.normalizedRows,
          status: existingJob.status,
          commitSummary: existingJob.commitSummary,
        });
        return;
      }

      const rows = await normalizeRows(source, parsed.rows, schemaVersion);
      const holdingRows = rows.filter(
        (row): row is NormalizedImportRow => row.recordType !== "list",
      );
      const baseSummary = previewSummary(holdingRows);
      const summary = schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION
        ? await addOrganizationPreview(rows, baseSummary, req.userId!)
        : baseSummary;
      const values = {
        source,
        schemaVersion,
        status: "previewed",
        sourceCurrency: requestedCurrency,
        normalizedRows: rows,
        previewSummary: summary,
        commitSummary: null,
        commitResults: null,
        committedAt: null,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      } as const;
      const [job] = existingJob
        ? await db.update(collectionImportJobsTable)
            .set(values)
            .where(eq(collectionImportJobsTable.id, existingJob.id))
            .returning()
        : await db.insert(collectionImportJobsTable)
            .values({
              userId: req.userId!,
              contentSha256,
              ...values,
            })
            .returning();

      res.json({
        jobId: job!.id,
        source,
        schemaVersion,
        contentSha256,
        summary,
        rows,
        status: "previewed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not preview CSV.";
      if (message === "CATALOGUE_UNAVAILABLE") {
        res.status(503).json({
          message: "The Verified TCG catalogue is temporarily unavailable. Nothing was saved.",
        });
        return;
      }
      req.log?.warn({ err: error }, "Collection CSV preview rejected");
      res.status(422).json({ message });
    }
  },
);

router.post(
  "/collection/import/:jobId/commit",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const jobId = String(req.params.jobId);
    const contentSha256 =
      typeof req.body?.contentSha256 === "string" ? req.body.contentSha256 : "";
    const requestedCurrency =
      typeof req.body?.sourceCurrency === "string"
        ? req.body.sourceCurrency.trim().toUpperCase()
        : "";

    const [job] = await db
      .select()
      .from(collectionImportJobsTable)
      .where(and(
        eq(collectionImportJobsTable.id, jobId),
        eq(collectionImportJobsTable.userId, req.userId!),
      ))
      .limit(1);
    if (!job) {
      res.status(404).json({ message: "Import preview not found." });
      return;
    }
    if (!contentSha256 || contentSha256 !== job.contentSha256) {
      res.status(409).json({ message: "The selected CSV no longer matches this preview." });
      return;
    }
    if (job.status === "committed") {
      res.json({
        jobId: job.id,
        status: "committed",
        summary: job.commitSummary,
        rows: job.commitResults,
        replayed: true,
      });
      return;
    }
    if (job.expiresAt.getTime() <= Date.now()) {
      res.status(409).json({ message: "This preview expired. Preview the CSV again." });
      return;
    }

    const records = job.normalizedRows as NormalizedImportRecord[];
    const rows = records.filter(
      (row): row is NormalizedImportRow => row.recordType !== "list",
    );
    const listRows = records.filter(
      (row): row is NormalizedImportList => row.recordType === "list",
    );
    const holdings = rows.filter((row) => row.status === "matched");
    const wishlist = rows.filter((row) => row.status === "watchlist_only");
    const currency =
      job.source === "collectr"
        ? requestedCurrency || job.sourceCurrency || ""
        : "";
    if (job.source === "collectr" && holdings.length > 0 && !/^[A-Z]{3}$/.test(currency)) {
      res.status(400).json({
        message: "Choose the Collectr file's source currency before importing paid prices.",
      });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Serialize all imports for one collector. Distinct files can contain
        // the same holding, so a lock scoped only to the preview job is unsafe.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${req.userId!}, 0))`,
        );
        const [lockedJob] = await tx
          .select()
          .from(collectionImportJobsTable)
          .where(and(
            eq(collectionImportJobsTable.id, job.id),
            eq(collectionImportJobsTable.userId, req.userId!),
          ))
          .limit(1);
        if (lockedJob?.status === "committed") {
          return {
            summary: lockedJob.commitSummary as Record<string, number>,
            rows: lockedJob.commitResults as Array<Record<string, unknown>>,
            replayed: true,
          };
        }

        const existingHoldings = await tx
          .select()
          .from(collectionItemsTable)
          .where(eq(collectionItemsTable.userId, req.userId!));
        const existingWishlist = await tx
          .select()
          .from(wishlistItemsTable)
          .where(and(
            eq(wishlistItemsTable.userId, req.userId!),
            isNull(wishlistItemsTable.deletedAt),
          ));
        const existingLists = job.schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION
          ? await tx
              .select()
              .from(collectionListsTable)
              .where(eq(collectionListsTable.userId, req.userId!))
          : [];

        let holdingsAdded = 0;
        let wishlistAdded = 0;
        let duplicates = rows.filter((row) => row.status === "duplicate").length +
          listRows.filter((row) => row.status === "duplicate").length;
        let unsupportedGrades = 0;
        let listsCreated = 0;
        let listsMerged = 0;
        let membershipsAdded = 0;
        let membershipDuplicates = 0;
        const holdingIdsByRowNumber = new Map<number, string>();
        const claimedExistingHoldingIds = new Set<string>();
        const results: Array<Record<string, unknown>> = rows
          .filter((row) => !["matched", "watchlist_only"].includes(row.status))
          .map((row) => ({
            rowNumber: row.rowNumber,
            status: "skipped",
            reason: row.error ?? row.status,
          }));
        for (const row of listRows.filter((candidate) => candidate.status !== "valid")) {
          results.push({
            rowNumber: row.rowNumber,
            status: row.status === "duplicate" ? "duplicate" : "skipped",
            reason: row.error ?? row.status,
          });
        }

        for (const row of holdings) {
          const rowCurrency =
            job.source === "collectr" ? currency : (row.currency ?? "AUD");
          const gradingJson = JSON.stringify(row.grading ?? null);
          const sameAccountHolding = job.schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION
            ? existingHoldings.find((existing) => existing.id === row.holdingId)
            : undefined;
          const duplicate = sameAccountHolding ?? existingHoldings.find((existing) =>
            (
              job.schemaVersion !== COLLECTION_ORGANIZATION_SCHEMA_VERSION ||
              !claimedExistingHoldingIds.has(existing.id)
            ) &&
            existing.cardId === row.cardId &&
            existing.quantity === row.quantity &&
            existing.condition === row.condition &&
            existing.acquiredAt === row.acquiredAt &&
            existing.acquiredPriceCents === Math.round((row.acquiredPrice ?? 0) * 100) &&
            existing.acquiredCurrency === rowCurrency &&
            (existing.notes ?? "") === (row.notes ?? "") &&
            JSON.stringify(existing.gradingData ?? null) === gradingJson
          );
          if (duplicate) {
            if (job.schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION) {
              claimedExistingHoldingIds.add(duplicate.id);
            }
            holdingIdsByRowNumber.set(row.rowNumber, duplicate.id);
            duplicates += 1;
            results.push({
              rowNumber: row.rowNumber,
              status: "duplicate",
              cardId: row.cardId,
              reason: "An identical holding already exists.",
            });
            continue;
          }

          const [inserted] = await tx
            .insert(collectionItemsTable)
            .values({
              userId: req.userId!,
              cardId: row.cardId!,
              cardData: row.card!,
              quantity: row.quantity!,
              condition: row.condition!,
              isGraded: Boolean(row.grading),
              gradingData: row.grading ?? null,
              acquiredAt: row.acquiredAt!,
              acquiredPriceCents: Math.round((row.acquiredPrice ?? 0) * 100),
              acquiredCurrency: rowCurrency,
              notes: row.notes ?? null,
              isForSale: row.isForSale ?? false,
              isForTrade: row.isForTrade ?? false,
            })
            .returning({ id: collectionItemsTable.id });
          holdingsAdded += 1;
          holdingIdsByRowNumber.set(row.rowNumber, inserted!.id);
          if (row.grading && !row.supportedGrade) unsupportedGrades += 1;
          results.push({
            rowNumber: row.rowNumber,
            status: "holding_added",
            cardId: row.cardId,
            collectionItemId: inserted!.id,
          });
        }

        for (const row of wishlist) {
          const active = existingWishlist.find((item) => item.cardId === row.cardId);
          if (active) {
            if (!active.desiredGrade && row.desiredGrade) {
              await tx
                .update(wishlistItemsTable)
                .set({ desiredGrade: row.desiredGrade, updatedAt: new Date() })
                .where(eq(wishlistItemsTable.id, active.id));
              active.desiredGrade = row.desiredGrade;
            }
            duplicates += 1;
            results.push({
              rowNumber: row.rowNumber,
              status: "wishlist_existing",
              cardId: row.cardId,
            });
            continue;
          }

          const deterministicId = `import-${sha256(row.cardId!).slice(0, 32)}`;
          await tx
            .insert(wishlistItemsTable)
            .values({
              userId: req.userId!,
              itemId: deterministicId,
              cardId: row.cardId!,
              cardData: row.card!,
              desiredGrade: row.desiredGrade ?? null,
              targetPrice: null,
              priceAlertEnabled: false,
              addedAt: new Date().toISOString(),
              deletedAt: null,
            })
            .onConflictDoUpdate({
              target: [wishlistItemsTable.userId, wishlistItemsTable.itemId],
              set: {
                cardId: row.cardId!,
                cardData: row.card!,
                desiredGrade: sql`COALESCE(${wishlistItemsTable.desiredGrade}, EXCLUDED.desired_grade)`,
                deletedAt: null,
                updatedAt: new Date(),
              },
            });
          wishlistAdded += 1;
          existingWishlist.push({
            id: deterministicId as never,
            userId: req.userId!,
            itemId: deterministicId,
            cardId: row.cardId!,
            cardData: row.card!,
            desiredGrade: row.desiredGrade ?? null,
            targetPrice: null,
            priceAlertEnabled: false,
            addedAt: new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          });
          results.push({
            rowNumber: row.rowNumber,
            status: "wishlist_added",
            cardId: row.cardId,
            wishlistItemId: deterministicId,
          });
        }

        if (job.schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION) {
          const orderedNames: string[] = [];
          const validDefinitions = listRows
            .filter((row) => row.status === "valid" && row.name)
            .sort((left, right) =>
              (left.position ?? Number.MAX_SAFE_INTEGER) -
              (right.position ?? Number.MAX_SAFE_INTEGER)
            );
          for (const row of validDefinitions) {
            if (!orderedNames.includes(row.name!)) orderedNames.push(row.name!);
          }
          const existingByName = new Map(existingLists.map((list) => [list.name, list]));
          const missingNames = orderedNames.filter((name) => !existingByName.has(name));
          if (existingLists.length + missingNames.length > 100) {
            throw new Error("LIST_LIMIT_EXCEEDED");
          }
          const definitionByName = new Map(
            validDefinitions.map((definition) => [definition.name!, definition]),
          );
          for (const name of orderedNames) {
            const definition = definitionByName.get(name)!;
            const existing = existingByName.get(name);
            if (existing) {
              if (existing.position !== definition.position) {
                await tx
                  .update(collectionListsTable)
                  .set({ position: definition.position!, updatedAt: new Date() })
                  .where(and(
                    eq(collectionListsTable.id, existing.id),
                    eq(collectionListsTable.userId, req.userId!),
                  ));
                existing.position = definition.position!;
              }
              listsMerged += 1;
              continue;
            }
            const [created] = await tx
              .insert(collectionListsTable)
              .values({
                userId: req.userId!,
                name,
                position: definition.position!,
              })
              .returning();
            existingByName.set(name, created!);
            listsCreated += 1;
          }

          for (const row of validDefinitions) {
            results.push({
              rowNumber: row.rowNumber,
              status: existingLists.some((list) => list.name === row.name)
                ? "list_merged"
                : "list_created",
              listName: row.name,
            });
          }

          const membershipValues: Array<{
            userId: string;
            listId: string;
            collectionItemId: string;
          }> = [];
          const seenMemberships = new Set<string>();
          for (const row of holdings) {
            const collectionItemId = holdingIdsByRowNumber.get(row.rowNumber);
            if (!collectionItemId) continue;
            for (const name of row.listNames ?? []) {
              const listId = existingByName.get(name)?.id;
              if (!listId) continue;
              const key = `${listId}:${collectionItemId}`;
              if (seenMemberships.has(key)) continue;
              seenMemberships.add(key);
              membershipValues.push({ userId: req.userId!, listId, collectionItemId });
            }
          }
          for (const membership of membershipValues) {
            const inserted = await tx
              .insert(collectionListItemsTable)
              .values(membership)
              .onConflictDoNothing()
              .returning({ listId: collectionListItemsTable.listId });
            if (inserted.length > 0) membershipsAdded += 1;
            else membershipDuplicates += 1;
          }
        }

        const skipped = results.filter((row) => row.status === "skipped").length;
        const summary = {
          holdingsAdded,
          wishlistAdded,
          skipped,
          duplicates,
          unsupportedGrades,
          ...(job.schemaVersion === COLLECTION_ORGANIZATION_SCHEMA_VERSION
            ? { listsCreated, listsMerged, membershipsAdded, membershipDuplicates }
            : {}),
        };
        await tx
          .update(collectionImportJobsTable)
          .set({
            status: "committed",
            sourceCurrency: currency || job.sourceCurrency,
            commitSummary: summary,
            commitResults: results,
            committedAt: new Date(),
          })
          .where(eq(collectionImportJobsTable.id, job.id));
        return { summary, rows: results, replayed: false };
      });

      clearUserWishlists(req.userId!);
      if (!result.replayed) {
        const savedHoldingRows = new Set(
          result.rows
            .filter((row) => row.status === "holding_added")
            .map((row) => row.rowNumber),
        );
        const savedWishlistRows = new Set(
          result.rows
            .filter((row) => row.status === "wishlist_added")
            .map((row) => row.rowNumber),
        );
        for (const row of holdings.filter((candidate) => savedHoldingRows.has(candidate.rowNumber))) {
          await logActivitySafely(
            req.userId!,
            "card_added",
            row.cardId!,
            String(row.card?.name ?? ""),
            { source: "csv_import" },
          );
        }
        for (const row of wishlist.filter((candidate) => savedWishlistRows.has(candidate.rowNumber))) {
          await logActivitySafely(
            req.userId!,
            "wishlist_added",
            row.cardId!,
            String(row.card?.name ?? ""),
            { source: "csv_import" },
          );
        }
      }
      res.json({
        jobId: job.id,
        status: "committed",
        summary: result.summary,
        rows: result.rows,
        replayed: result.replayed,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "LIST_LIMIT_EXCEEDED") {
        res.status(409).json({
          message: "This import would exceed the 100 custom-list limit. Nothing was saved.",
        });
        return;
      }
      req.log?.error({ err: error, jobId }, "Collection CSV commit failed");
      res.status(500).json({
        message: "Import failed before it could be completed. No partial import was saved.",
      });
    }
  },
);

export default router;