/**
 * Pricing orchestration service.
 *
 * Coordinates:
 *  - PriceCharting API calls (rate-limited, deduplicated)
 *  - DB persistence of mappings and quotes
 *  - Stale quote fallback
 *  - FX conversion for display
 */
import { db } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  cardProviderMappingsTable,
  cardPriceSnapshotsTable,
  currentQuotesTable,
  pricingOverridesTable,
  pricingProvidersTable,
  providerPriceHistoryTable,
  priceChartingGuideImportsTable,
  priceChartingGuideRowsTable,
  priceChartingGuideDownloadLeaseTable,
} from "@workspace/db";
import { and, eq, desc, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  priceChartingProvider,
  PROVIDER_KEY,
  PROVIDER_LABEL,
  PC_CURRENCY,
  normalizeProduct,
  downloadBulkGuide,
  extractPrices,
  PriceChartingError,
  PriceChartingThrottleError,
  type PriceChartingGuideCategory,
} from "./pricecharting.js";
import type { PCProductDetail } from "./pricecharting.js";
import {
  GRADE_DEFINITIONS,
  GRADE_BY_KEY,
  isValidGradeKey,
  normalizeGradeKey,
} from "./grades.js";
import type { GradeKey } from "./grades.js";
import {
  buildMatchSearchQueries,
  collectorNumbersMatch,
  extractCardNumber,
  normalizeCollectorNumberForMatch,
  normalizeString,
  pickBestMatch,
  stripCardNumber,
  type MatchCandidate,
  type MatchInput,
} from "./matcher.js";
import { convertCents, buildConversionProvenance } from "./fx.js";
import {
  aggregateVerifiedMarketValue,
  type VerifiedMarketValue,
} from "./engine.js";
import { recordTelemetry } from "../lib/telemetry.js";
import { justTcg } from "../lib/catalogueProvider.js";
import {
  JUSTTCG_PRICING_PROVIDER_KEY,
  persistJustTcgRawQuote,
} from "./justtcg.js";

/**
 * Fixed operation enum for PriceCharting integration telemetry. Never
 * includes URLs, query strings, card identifiers, or provider payloads.
 */
type PCOperation = "product_refresh" | "search" | "explicit_refresh" | "bulk_import";
export type ProviderFailureKind = PriceChartingError["kind"] | "transient";

function providerFailureKind(error: unknown): ProviderFailureKind {
  return error instanceof PriceChartingError ? error.kind : "transient";
}

// Quote staleness threshold (12 hours)
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
const NON_MATCH_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Stable UTC bucket used to deduplicate one AM and one PM capture per day. */
export function snapshotBucketFor(date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `${day}:${date.getUTCHours() < 12 ? "AM" : "PM"}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuoteItem {
  gradeKey: GradeKey;
  label: string;
  priceCents: number;
  price: number;      // dollars (display)
  currency: string;   // display currency
  originalPriceCents: number;
  originalCurrency: string;
}

export type PricingStatus =
  | "available"
  | "stale"
  | "pending_match"
  | "review_required"
  | "unmatched"
  | "unavailable"
  | "error";

export interface PricingResponse {
  cardId: string;
  status: PricingStatus;
  configured: boolean;
  queued: boolean;
  quotes: QuoteItem[];
  /** Provider-neutral, explainable values for every available grade. */
  verifiedMarket: VerifiedMarketValue[];
  source: {
    provider: string;
    label: string;
    productId: string | null;
  };
  confidence: {
    level: string | null;
    score: number | null;
    providerCount?: number;
    reasons?: string[];
  };
  matchingConfidence?: {
    level: string | null;
    score: number | null;
  };
  providerMetadata: {
    salesVolume: number | null;
    releaseDate: string | null;
    genre: string | null;
    upc: string | null;
    epid: string | null;
  } | null;
  updatedAt: string | null;
  isStale: boolean;
  errorCode?: string;
  message?: string;
  conversion?: ReturnType<typeof buildConversionProvenance>;
  manualOverrides?: Array<{
    id: string;
    gradeKey: string;
    priceCents: number;
    currency: string;
    reason: string;
    expiresAt: string | null;
  }>;
}

// ── In-flight background match jobs ──────────────────────────────────────────

const matchInFlight = new Map<string, Promise<void>>();
const justTcgRawPricingInFlight = new Map<string, Promise<boolean>>();

function isJustTcgPricingConfigured(): boolean {
  return Boolean(process.env.JUSTTCG_API_KEY?.trim());
}

/**
 * The public card id is a JustTCG id. Resolve it directly and persist only
 * genuine positive raw observations plus the provider's returned history.
 */
async function refreshJustTcgRawHistory(cardId: string): Promise<boolean> {
  if (!isJustTcgPricingConfigured()) return false;
  const existing = justTcgRawPricingInFlight.get(cardId);
  if (existing) return existing;
  const request = (async () => {
    try {
      // JustTCG's supported direct-lookup and retained-history parameters.
      // The old include_price_history flag was ignored by the provider, which
      // meant a card detail often persisted only one current observation.
      const params = new URLSearchParams({ cardId, priceHistoryDuration: "30d" });
      const result = await justTcg(`/cards?${params.toString()}`);
      if (result.status >= 400) return false;
      const data = result.body as { data?: Array<Record<string, unknown>> } | null;
      const card = data?.data?.find(candidate => candidate.id === cardId);
      return Boolean(card && await persistJustTcgRawQuote(card));
    } catch {
      return false;
    }
  })().finally(() => justTcgRawPricingInFlight.delete(cardId));
  justTcgRawPricingInFlight.set(cardId, request);
  return request;
}

async function recordProviderHealth(
  healthy: boolean,
  message?: string,
  operation?: PCOperation,
  failureKind?: ProviderFailureKind,
): Promise<void> {
  // Sanitized integration observability. Every external PriceCharting call
  // outcome flows through this centralized path. We record only the fixed
  // operation enum and the ok/failed status — never URLs, card inputs,
  // provider payloads, credentials, or error text.
  if (operation) {
    void recordTelemetry({
      category: "integration",
      action: "integration.pricecharting.request",
      status: healthy ? "ok" : "failed",
      metadata: { operation },
    });
  }
  const now = new Date();
  const configured = priceChartingProvider.isConfigured();
  const sanitizedKind = healthy ? null : (failureKind ?? "transient");
  await db
    .insert(pricingProvidersTable)
    .values({
      providerKey: PROVIDER_KEY,
      label: PROVIDER_LABEL,
      isActive: configured,
      baseUrl: "https://www.pricecharting.com/api",
      ...(healthy
        ? { lastHealthyAt: now, lastErrorMessage: null, lastErrorKind: null }
        : {
            lastErrorAt: now,
            lastErrorMessage: message ?? "Provider request failed",
            lastErrorKind: sanitizedKind,
          }),
    })
    .onConflictDoUpdate({
      target: pricingProvidersTable.providerKey,
      set: {
        isActive: configured,
        updatedAt: now,
        ...(healthy
          ? { lastHealthyAt: now, lastErrorMessage: null, lastErrorKind: null }
          : {
              lastErrorAt: now,
              lastErrorMessage: message ?? "Provider request failed",
              lastErrorKind: sanitizedKind,
            }),
      },
    });
}

// ── Core: get or match a card ─────────────────────────────────────────────────

/**
 * Look up an existing DB mapping for a card + provider.
 */
async function getExistingMapping(cardId: string) {
  const [row] = await db
    .select()
    .from(cardProviderMappingsTable)
    .where(
      and(
        eq(cardProviderMappingsTable.cardId, cardId),
        eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface PricingMappingState {
  status: string;
  providerProductId: string | null;
  identity: {
    name: string;
    set?: string;
    number?: string;
    game?: string;
  };
}

/**
 * Return persisted provider identity without contacting any external catalog.
 * Routes use this before resolving first-time card identity so cached quotes
 * remain available during unrelated catalog outages.
 */
export async function getPricingMappingState(cardId: string): Promise<PricingMappingState | null> {
  const mapping = await getExistingMapping(cardId);
  if (!mapping) return null;
  return {
    status: mapping.status ?? "unmatched",
    providerProductId: mapping.providerProductId ?? null,
    identity: {
      name: mapping.matchedName?.trim() ?? "",
      ...(mapping.matchedSet ? { set: mapping.matchedSet } : {}),
      ...(mapping.matchedNumber ? { number: mapping.matchedNumber } : {}),
      ...(mapping.matchedGame ? { game: mapping.matchedGame } : {}),
    },
  };
}

/**
 * Get all current quotes for a card from DB.
 */
async function getStoredQuotes(cardId: string) {
  const rows = await db
    .select()
    .from(currentQuotesTable)
    .where(
      and(
        eq(currentQuotesTable.cardId, cardId),
        eq(currentQuotesTable.providerKey, PROVIDER_KEY),
      ),
    );
  return rows.map((row) => ({
    ...row,
    gradeKey: normalizeGradeKey(row.gradeKey) ?? row.gradeKey,
  }));
}

async function getStoredJustTcgRawQuote(cardId: string) {
  const [row] = await db
    .select()
    .from(currentQuotesTable)
    .where(and(
      eq(currentQuotesTable.cardId, cardId),
      eq(currentQuotesTable.providerKey, JUSTTCG_PRICING_PROVIDER_KEY),
      eq(currentQuotesTable.gradeKey, "raw"),
    ))
    .limit(1);
  return row ?? null;
}

async function justTcgRawPricingResponse(input: {
  cardId: string;
  quote: Awaited<ReturnType<typeof getStoredJustTcgRawQuote>>;
  displayCurrency: string;
}): Promise<PricingResponse | null> {
  const { cardId, quote, displayCurrency } = input;
  if (!quote || quote.priceCents <= 0) return null;

  const convertedCents = quote.currency === displayCurrency
    ? quote.priceCents
    : await convertCents(quote.priceCents, quote.currency, displayCurrency);
  const priceCents = convertedCents ?? quote.priceCents;
  const currency = convertedCents == null ? quote.currency : displayCurrency;
  const isStale = Date.now() - quote.fetchedAt.getTime() > STALE_THRESHOLD_MS;
  const retained = await db
    .select({ priceCents: providerPriceHistoryTable.priceCents })
    .from(providerPriceHistoryTable)
    .where(and(
      eq(providerPriceHistoryTable.cardId, cardId),
      eq(providerPriceHistoryTable.providerKey, JUSTTCG_PRICING_PROVIDER_KEY),
      eq(providerPriceHistoryTable.gradeKey, "raw"),
      gte(providerPriceHistoryTable.recordedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    ));
  const retainedSnapshotCents = convertedCents == null
    ? retained.map(row => row.priceCents)
    : await Promise.all(retained.map(row => convertCents(row.priceCents, quote.currency, currency)))
      .then(values => values.filter((value): value is number => value != null));
  const market = aggregateVerifiedMarketValue({
    gradeKey: "raw",
    quotes: [{
      providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
      providerLabel: "JustTCG",
      providerProductId: quote.providerProductId,
      gradeKey: "raw",
      priceCents,
      currency,
      originalPriceCents: quote.priceCents,
      originalCurrency: quote.currency,
      fetchedAt: quote.fetchedAt,
    }],
    // The public card id is a JustTCG card id, so this is an exact provider
    // identity rather than a fuzzy cross-provider match.
    matchingConfidence: 1,
    isStale,
    retainedSnapshotCents,
  });
  return {
    cardId,
    status: isStale ? "stale" : "available",
    configured: isJustTcgPricingConfigured(),
    queued: false,
    quotes: [{
      gradeKey: "raw",
      label: "Raw / Ungraded",
      priceCents,
      price: priceCents / 100,
      currency,
      originalPriceCents: quote.priceCents,
      originalCurrency: quote.currency,
    }],
    verifiedMarket: market ? [market] : [],
    source: {
      provider: JUSTTCG_PRICING_PROVIDER_KEY,
      label: "JustTCG",
      productId: quote.providerProductId,
    },
    confidence: {
      level: market?.confidence.level ?? "low",
      score: market?.confidence.score ?? 0,
      providerCount: market?.confidence.providerCount,
      reasons: market?.confidence.reasons,
    },
    providerMetadata: null,
    updatedAt: quote.fetchedAt.toISOString(),
    isStale,
    ...(quote.currency !== currency ? {
      conversion: buildConversionProvenance(quote.currency, currency, priceCents / quote.priceCents),
    } : {}),
  };
}

/**
 * Persist current quotes to DB (upsert).
 */
export async function persistQuotes(
  cardId: string,
  providerProductId: string,
  prices: Map<GradeKey, number>,
): Promise<void> {
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);
  const snapshotBucket = snapshotBucketFor(now);

  // A valid provider response with no usable prices must not erase a last
  // known quote. Missing fields remain missing; they are never converted to 0.
  if (prices.size === 0) return;

  await db.transaction(async tx => {
    for (const [gradeKey, priceCents] of prices) {
      await tx
        .insert(currentQuotesTable)
        .values({ cardId, providerKey: PROVIDER_KEY, gradeKey, priceCents, currency: PC_CURRENCY, fetchedAt: now, providerProductId })
        .onConflictDoUpdate({
          target: [currentQuotesTable.cardId, currentQuotesTable.providerKey, currentQuotesTable.gradeKey],
          set: { priceCents, currency: PC_CURRENCY, fetchedAt: now, providerProductId, updatedAt: now },
        });

      await tx
        .insert(providerPriceHistoryTable)
        .values({
          cardId,
          providerKey: PROVIDER_KEY,
          gradeKey,
          priceCents,
          currency: PC_CURRENCY,
          snapshotDate: todayDate,
          recordedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            providerPriceHistoryTable.cardId,
            providerPriceHistoryTable.providerKey,
            providerPriceHistoryTable.gradeKey,
            providerPriceHistoryTable.snapshotDate,
          ],
          set: { priceCents, currency: PC_CURRENCY, recordedAt: now },
        });

      await tx
        .insert(cardPriceSnapshotsTable)
        .values({
          cardId,
          providerKey: PROVIDER_KEY,
          providerProductId,
          gradeKey,
          priceCents,
          currency: PC_CURRENCY,
          capturedAt: now,
          snapshotBucket,
          captureStatus: "success",
        })
        .onConflictDoUpdate({
          target: [
            cardPriceSnapshotsTable.cardId,
            cardPriceSnapshotsTable.providerKey,
            cardPriceSnapshotsTable.gradeKey,
            cardPriceSnapshotsTable.snapshotBucket,
          ],
          set: { priceCents, currency: PC_CURRENCY, providerProductId, capturedAt: now, captureStatus: "success", failureCode: null },
        });
    }
  });
}

/** Bound bulk insert batches to avoid PostgreSQL's 65,535 parameter limit. */
export function chunkGuideRows<T>(rows: readonly T[], size = 1_000): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) chunks.push(rows.slice(offset, offset + size));
  return chunks;
}

const GUIDE_GAME_NAMES: Record<PriceChartingGuideCategory, string> = {
  pokemon: "Pokemon",
  magic: "Magic: The Gathering",
  yugioh: "Yu-Gi-Oh!",
  one_piece: "One Piece",
};

const GUIDE_GAME_SLUGS: Record<PriceChartingGuideCategory, string[]> = {
  pokemon: ["pokemon"],
  magic: ["magic-the-gathering", "magic", "mtg"],
  yugioh: ["yu-gi-oh", "yugioh"],
  one_piece: ["one-piece", "onepiece"],
};

function normalizedGuideName(productName: string): string {
  return normalizeString(stripCardNumber(productName));
}

function normalizedGuideSet(consoleName: string): string {
  const ignored = new Set(["cards", "card", "tcg", "pokemon", "pokémon", "magic", "the", "gathering", "yugioh", "yu", "gi", "oh", "one", "piece"]);
  return normalizeString(consoleName).split(" ").filter(word => word && !ignored.has(word)).join(" ");
}

function explicitLanguage(value: string): string | null {
  const normalized = normalizeString(value);
  const labels: Array<[RegExp, string]> = [
    [/\bjapanese\b|\bjapan\b/, "ja"],
    [/\bkorean\b|\bkorea\b/, "ko"],
    [/\bchinese\b|\bchina\b|\bsimplified\b|\btraditional\b/, "zh"],
    [/\bfrench\b|\bfrance\b/, "fr"],
    [/\bgerman\b|\bgermany\b/, "de"],
    [/\bitalian\b|\bitaly\b/, "it"],
    [/\bspanish\b|\bspain\b/, "es"],
    [/\bportuguese\b|\bportugal\b|\bbrazil\b/, "pt"],
    [/\benglish\b/, "en"],
  ];
  return labels.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function normalizedLanguage(value: string | null | undefined): string | null {
  const normalized = normalizeString(value ?? "");
  if (!normalized) return null;
  const aliases: Record<string, string> = {
    japanese: "ja", jpn: "ja", jp: "ja", ja: "ja",
    korean: "ko", kor: "ko", kr: "ko", ko: "ko",
    chinese: "zh", zho: "zh", cn: "zh", zh: "zh",
    english: "en", eng: "en", en: "en",
    french: "fr", fra: "fr", fr: "fr",
    german: "de", deu: "de", de: "de",
    italian: "it", ita: "it", it: "it",
    spanish: "es", spa: "es", es: "es",
    portuguese: "pt", por: "pt", pt: "pt",
  };
  return aliases[normalized] ?? normalized;
}

export interface CanonicalGuideIdentity extends MatchInput {
  cardId: string;
  setCode?: string;
}

export interface GuideIdentityRow {
  providerProductId: string;
  productName: string;
  consoleName: string;
  prices: Record<string, number>;
}

export interface GuideIdentityMatch {
  status: "matched" | "review_required" | "unmatched";
  candidate: GuideIdentityRow | null;
  score: number;
  reason: string;
  candidateCount: number;
}

/**
 * Deterministic guide matcher. Fuzzy similarity alone never creates a mapping:
 * an exact normalized card name and compatible explicit collector number are
 * mandatory. Set and language evidence only disambiguate duplicate printings.
 */
export function matchCanonicalCardToGuide(
  input: CanonicalGuideIdentity,
  guideRows: readonly GuideIdentityRow[],
  category: PriceChartingGuideCategory,
): GuideIdentityMatch {
  const wantedName = normalizeString(stripCardNumber(input.name));
  const wantedNumber = normalizeCollectorNumberForMatch(input.number);
  if (!wantedName || !wantedNumber) {
    return { status: "unmatched", candidate: null, score: 0, reason: "missing_deterministic_identity", candidateCount: 0 };
  }
  const wantedLanguage = normalizedLanguage(input.language);
  const candidates = guideRows.filter(row => {
    if (normalizedGuideName(row.productName) !== wantedName) return false;
    const candidateNumber = extractCardNumber(row.productName);
    if (!collectorNumbersMatch(input.number, candidateNumber)) return false;
    const providerLanguage = explicitLanguage(`${row.consoleName} ${row.productName}`);
    return !wantedLanguage || !providerLanguage || wantedLanguage === providerLanguage;
  });
  if (candidates.length === 0) {
    return { status: "unmatched", candidate: null, score: 0, reason: "no_exact_name_number", candidateCount: 0 };
  }
  const matchCandidates: MatchCandidate[] = candidates.map(row => ({
    id: row.providerProductId,
    name: stripCardNumber(row.productName),
    consoleName: row.consoleName,
    cardNumber: extractCardNumber(row.productName),
    genre: GUIDE_GAME_NAMES[category],
    language: explicitLanguage(`${row.consoleName} ${row.productName}`) ?? undefined,
  }));
  const result = pickBestMatch(input, matchCandidates);
  if (result.status !== "matched" || !result.candidate) {
    return {
      status: candidates.length > 0 ? "review_required" : "unmatched",
      candidate: null,
      score: result.score.total,
      reason: candidates.length > 1 ? "duplicate_printing_ambiguous" : "insufficient_set_evidence",
      candidateCount: candidates.length,
    };
  }
  const selected = candidates.find(row => row.providerProductId === result.candidate!.id) ?? null;
  return {
    status: selected ? "matched" : "review_required",
    candidate: selected,
    score: result.score.total,
    reason: selected ? "unique_exact_name_number" : "candidate_disappeared",
    candidateCount: candidates.length,
  };
}

export interface PriceChartingReconciliationResult {
  category: PriceChartingGuideCategory;
  claimed: boolean;
  status: "pending" | "running" | "completed" | "failed";
  processed: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  quotesPersisted: number;
  nextCursor: string | null;
  hasMore: boolean;
}

interface CanonicalReconciliationRow extends Record<string, unknown> {
  card_id: string;
  name: string;
  set_name: string;
  set_code: string | null;
  collector_number: string | null;
  language: string | null;
  region: string | null;
}

function priceMapFromJson(value: unknown): Map<GradeKey, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value as Record<string, unknown>)
    .filter(([grade, cents]) => isValidGradeKey(grade) && Number.isSafeInteger(cents) && Number(cents) > 0)
    .map(([grade, cents]) => [grade as GradeKey, Number(cents)]));
}

async function persistReconciliationQuote(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  cardId: string,
  providerProductId: string,
  prices: Map<GradeKey, number>,
  fetchedAt: Date,
): Promise<number> {
  const snapshotDate = fetchedAt.toISOString().slice(0, 10);
  const snapshotBucket = snapshotBucketFor(fetchedAt);
  for (const [gradeKey, priceCents] of prices) {
    await tx.insert(currentQuotesTable).values({
      cardId, providerKey: PROVIDER_KEY, gradeKey, priceCents, currency: PC_CURRENCY,
      fetchedAt, providerProductId,
    }).onConflictDoUpdate({
      target: [currentQuotesTable.cardId, currentQuotesTable.providerKey, currentQuotesTable.gradeKey],
      set: { priceCents, currency: PC_CURRENCY, fetchedAt, providerProductId, updatedAt: fetchedAt },
    });
    await tx.insert(providerPriceHistoryTable).values({
      cardId, providerKey: PROVIDER_KEY, gradeKey, priceCents, currency: PC_CURRENCY,
      snapshotDate, recordedAt: fetchedAt,
    }).onConflictDoUpdate({
      target: [
        providerPriceHistoryTable.cardId,
        providerPriceHistoryTable.providerKey,
        providerPriceHistoryTable.gradeKey,
        providerPriceHistoryTable.snapshotDate,
      ],
      set: { priceCents, currency: PC_CURRENCY, recordedAt: fetchedAt },
    });
    await tx.insert(cardPriceSnapshotsTable).values({
      cardId, providerKey: PROVIDER_KEY, providerProductId, gradeKey, priceCents,
      currency: PC_CURRENCY, capturedAt: fetchedAt, snapshotBucket, captureStatus: "success",
    }).onConflictDoUpdate({
      target: [
        cardPriceSnapshotsTable.cardId,
        cardPriceSnapshotsTable.providerKey,
        cardPriceSnapshotsTable.gradeKey,
        cardPriceSnapshotsTable.snapshotBucket,
      ],
      set: { priceCents, currency: PC_CURRENCY, providerProductId, capturedAt: fetchedAt, captureStatus: "success", failureCode: null },
    });
  }
  return prices.size;
}

/** Claim and reconcile one bounded canonical-card page for a cached guide. */
export async function reconcilePriceChartingGuide(
  category: PriceChartingGuideCategory,
  options: { batchSize?: number } = {},
): Promise<PriceChartingReconciliationResult> {
  const batchSize = Math.min(Math.max(options.batchSize ?? 500, 1), 1_000);
  const claimToken = randomUUID();
  const claim = await db.execute<{ reconciliation_cursor: string | null }>(sql`
    UPDATE pricecharting_guide_imports
    SET reconciliation_status = 'running',
        reconciliation_lease_until = NOW() + INTERVAL '10 minutes',
        reconciliation_claim_token = ${claimToken},
        updated_at = NOW()
    WHERE category = ${category}
      AND status = 'ready'
      AND (
        reconciliation_status IN ('pending', 'failed')
        OR (reconciliation_status = 'running' AND reconciliation_lease_until < NOW())
      )
    RETURNING reconciliation_cursor
  `);
  if (!claim.rows[0]) {
    const [state] = await db.select().from(priceChartingGuideImportsTable)
      .where(eq(priceChartingGuideImportsTable.category, category)).limit(1);
    const stats = (state?.reconciliationStats ?? {}) as Record<string, unknown>;
    return {
      category,
      claimed: false,
      status: state?.reconciliationStatus === "completed" ? "completed" : state?.reconciliationStatus === "failed" ? "failed" : "running",
      processed: Number(stats["processed"] ?? 0),
      matched: Number(stats["matched"] ?? 0),
      ambiguous: Number(stats["ambiguous"] ?? 0),
      unmatched: Number(stats["unmatched"] ?? 0),
      quotesPersisted: Number(stats["quotesPersisted"] ?? 0),
      nextCursor: state?.reconciliationCursor ?? null,
      hasMore: state?.reconciliationStatus !== "completed",
    };
  }
  const cursor = claim.rows[0].reconciliation_cursor;
  try {
    const slugs = GUIDE_GAME_SLUGS[category];
    const canonical = await db.execute<CanonicalReconciliationRow>(sql`
      SELECT e.external_id AS card_id, c.name, s.name AS set_name, s.code AS set_code,
        c.collector_number, COALESCE(c.language, s.language) AS language, s.region
      FROM catalogue_external_ids e
      JOIN catalogue_cards c ON c.id = e.entity_id
      JOIN catalogue_sets s ON s.id = c.set_id
      JOIN catalogue_games g ON g.id = c.game_id
      WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
        AND c.is_active = true AND s.is_active = true AND g.is_active = true
        AND g.slug IN (${sql.join(slugs.map(slug => sql`${slug}`), sql`, `)})
        AND (${cursor}::text IS NULL OR e.external_id > ${cursor})
      ORDER BY e.external_id
      LIMIT ${batchSize + 1}
    `);
    const hasMore = canonical.rows.length > batchSize;
    const cards = canonical.rows.slice(0, batchSize);
    const names = [...new Set(cards.map(card => normalizedGuideName(card.name)).filter(Boolean))];
    const numbers = [...new Set(cards.map(card =>
      normalizeCollectorNumberForMatch(card.collector_number ?? undefined)?.numerator ?? "",
    ).filter(Boolean))];
    const mappingRows = cards.length === 0 ? [] : await db.select({
      cardId: cardProviderMappingsTable.cardId,
      providerProductId: cardProviderMappingsTable.providerProductId,
      status: cardProviderMappingsTable.status,
      matchMetadata: cardProviderMappingsTable.matchMetadata,
    }).from(cardProviderMappingsTable).where(and(
      eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      inArray(cardProviderMappingsTable.cardId, cards.map(card => card.card_id)),
    ));
    const mappedProductIds = [...new Set(mappingRows
      .map(mapping => mapping.providerProductId)
      .filter((id): id is string => Boolean(id)))];
    const identityCondition = names.length > 0 && numbers.length > 0
      ? and(
          inArray(priceChartingGuideRowsTable.normalizedName, names),
          inArray(priceChartingGuideRowsTable.normalizedNumber, numbers),
        )
      : undefined;
    const productCondition = mappedProductIds.length > 0
      ? inArray(priceChartingGuideRowsTable.providerProductId, mappedProductIds)
      : undefined;
    const candidateCondition = identityCondition && productCondition
      ? or(identityCondition, productCondition)
      : identityCondition ?? productCondition;
    const persistedGuide = candidateCondition
      ? await db.select().from(priceChartingGuideRowsTable).where(and(
          eq(priceChartingGuideRowsTable.category, category),
          candidateCondition,
        ))
      : [];
    const guideRows: GuideIdentityRow[] = persistedGuide.map(row => ({
      providerProductId: row.providerProductId,
      productName: row.productName,
      consoleName: row.consoleName,
      prices: row.prices as Record<string, number>,
    }));
    const existingByCard = new Map(mappingRows.map(mapping => [mapping.cardId, mapping]));
    const guideByProduct = new Map(guideRows.map(row => [row.providerProductId, row]));
    let matched = 0, ambiguous = 0, unmatched = 0, quotesPersisted = 0;
    const fetchedAt = (await db.select({ fetchedAt: priceChartingGuideImportsTable.fetchedAt })
      .from(priceChartingGuideImportsTable)
      .where(eq(priceChartingGuideImportsTable.category, category)).limit(1))[0]?.fetchedAt ?? new Date();
    await db.transaction(async tx => {
      // Renew and lock the claim row for the whole write transaction. A stale
      // worker that lost ownership cannot write mappings, quotes, cursor, stats,
      // or failure state after another instance takes over.
      const ownership = await tx.execute(sql`
        UPDATE pricecharting_guide_imports
        SET reconciliation_lease_until = NOW() + INTERVAL '10 minutes', updated_at = NOW()
        WHERE category = ${category}
          AND reconciliation_status = 'running'
          AND reconciliation_claim_token = ${claimToken}
        RETURNING category
      `);
      if (!ownership.rows[0]) throw new Error("PriceCharting reconciliation claim was lost");
      for (const card of cards) {
        const identity: CanonicalGuideIdentity = {
          cardId: card.card_id,
          name: card.name,
          set: card.set_name,
          setCode: card.set_code ?? undefined,
          number: card.collector_number ?? undefined,
          game: GUIDE_GAME_NAMES[category],
          language: card.language ?? undefined,
          region: card.region ?? undefined,
        };
        const existing = existingByCard.get(card.card_id);
        const adminReview = (existing?.matchMetadata as Record<string, unknown> | null)?.["adminReview"];
        if (existing?.status === "matched" && existing.providerProductId) {
          // A valid existing mapping is durable identity evidence. Import any
          // fresh fields that are present, but never clear its older quotes
          // when the guide omits the product or a condition.
          matched += 1;
          const mappedGuideRow = guideByProduct.get(existing.providerProductId);
          if (mappedGuideRow) {
            quotesPersisted += await persistReconciliationQuote(
              tx,
              card.card_id,
              existing.providerProductId,
              priceMapFromJson(mappedGuideRow.prices),
              fetchedAt,
            );
          }
          continue;
        }
        if (adminReview) {
          if (existing?.status === "review_required") ambiguous += 1;
          else unmatched += 1;
          continue;
        }
        const result = matchCanonicalCardToGuide(identity, guideRows, category);
        if (result.status === "matched" && result.candidate) {
          matched += 1;
          await tx.insert(cardProviderMappingsTable).values({
            cardId: card.card_id,
            providerKey: PROVIDER_KEY,
            providerProductId: result.candidate.providerProductId,
            providerProductName: result.candidate.productName,
            status: "matched",
            confidenceScore: result.score,
            confidenceLevel: "strong",
            matchMetadata: {
              source: "bulk_guide",
              category,
              reason: result.reason,
              candidateCount: result.candidateCount,
              guideFetchedAt: fetchedAt.toISOString(),
            },
            matchedName: identity.name,
            matchedSet: identity.set ?? null,
            matchedNumber: identity.number ?? null,
            matchedGame: identity.game ?? null,
          }).onConflictDoUpdate({
            target: [cardProviderMappingsTable.cardId, cardProviderMappingsTable.providerKey],
            set: {
              providerProductId: result.candidate.providerProductId,
              providerProductName: result.candidate.productName,
              status: "matched",
              confidenceScore: result.score,
              confidenceLevel: "strong",
              matchMetadata: {
                source: "bulk_guide",
                category,
                reason: result.reason,
                candidateCount: result.candidateCount,
                guideFetchedAt: fetchedAt.toISOString(),
              },
              matchedName: identity.name,
              matchedSet: identity.set ?? null,
              matchedNumber: identity.number ?? null,
              matchedGame: identity.game ?? null,
              updatedAt: fetchedAt,
            },
          });
          quotesPersisted += await persistReconciliationQuote(
            tx,
            card.card_id,
            result.candidate.providerProductId,
            priceMapFromJson(result.candidate.prices),
            fetchedAt,
          );
        } else {
          if (result.status === "review_required") ambiguous += 1;
          else unmatched += 1;
          // Existing strong mappings remain valid when a guide row is absent or
          // ambiguous. Failed mappings are reconsidered and receive fresh,
          // sanitized evidence so they do not become permanent cooldown rows.
          await tx.execute(sql`
            INSERT INTO card_provider_mappings (
              card_id, provider_key, status, confidence_score, confidence_level,
              match_metadata, matched_name, matched_set, matched_number, matched_game, updated_at
            ) VALUES (
              ${card.card_id}, ${PROVIDER_KEY}, ${result.status}, ${result.score},
              ${result.status === "review_required" ? "ambiguous" : "none"},
              ${JSON.stringify({
                source: "bulk_guide",
                category,
                reason: result.reason,
                candidateCount: result.candidateCount,
                guideFetchedAt: fetchedAt.toISOString(),
              })}::jsonb,
              ${identity.name}, ${identity.set ?? null}, ${identity.number ?? null}, ${identity.game ?? null}, ${fetchedAt}
            )
            ON CONFLICT (card_id, provider_key) DO UPDATE SET
              status = EXCLUDED.status,
              provider_product_id = NULL,
              provider_product_name = NULL,
              confidence_score = EXCLUDED.confidence_score,
              confidence_level = EXCLUDED.confidence_level,
              match_metadata = EXCLUDED.match_metadata,
              matched_name = EXCLUDED.matched_name,
              matched_set = EXCLUDED.matched_set,
              matched_number = EXCLUDED.matched_number,
              matched_game = EXCLUDED.matched_game,
              updated_at = EXCLUDED.updated_at
            WHERE card_provider_mappings.status <> 'matched'
              AND NOT (card_provider_mappings.match_metadata ? 'adminReview')
          `);
        }
      }
      const nextCursor = cards.at(-1)?.card_id ?? cursor;
      await tx.execute(sql`
        UPDATE pricecharting_guide_imports
        SET reconciliation_status = ${hasMore ? "pending" : "completed"},
            reconciliation_cursor = ${hasMore ? nextCursor : null},
            reconciliation_lease_until = NULL,
            reconciliation_claim_token = NULL,
            reconciled_at = ${hasMore ? null : new Date()},
            reconciliation_stats = jsonb_build_object(
              'processed', COALESCE((reconciliation_stats->>'processed')::int, 0) + ${cards.length},
              'matched', COALESCE((reconciliation_stats->>'matched')::int, 0) + ${matched},
              'ambiguous', COALESCE((reconciliation_stats->>'ambiguous')::int, 0) + ${ambiguous},
              'unmatched', COALESCE((reconciliation_stats->>'unmatched')::int, 0) + ${unmatched},
              'quotesPersisted', COALESCE((reconciliation_stats->>'quotesPersisted')::int, 0) + ${quotesPersisted}
            ),
            updated_at = NOW()
        WHERE category = ${category}
          AND reconciliation_status = 'running'
          AND reconciliation_claim_token = ${claimToken}
      `);
    });
    return {
      category, claimed: true, status: hasMore ? "pending" : "completed",
      processed: cards.length, matched, ambiguous, unmatched, quotesPersisted,
      nextCursor: hasMore ? cards.at(-1)?.card_id ?? cursor : null,
      hasMore,
    };
  } catch (error) {
    await db.execute(sql`
      UPDATE pricecharting_guide_imports
      SET reconciliation_status = 'failed',
          reconciliation_lease_until = NULL,
          reconciliation_claim_token = NULL,
          updated_at = NOW()
      WHERE category = ${category}
        AND reconciliation_status = 'running'
        AND reconciliation_claim_token = ${claimToken}
    `).catch(() => {});
    throw error;
  }
}

/** Continue the oldest incomplete cached guide without downloading it again. */
export async function continuePriceChartingReconciliation(): Promise<PriceChartingReconciliationResult | null> {
  const pending = await db.execute<{ category: PriceChartingGuideCategory }>(sql`
    SELECT category
    FROM pricecharting_guide_imports
    WHERE status = 'ready'
      AND (
        reconciliation_status IN ('pending', 'failed')
        OR (reconciliation_status = 'running' AND reconciliation_lease_until < NOW())
      )
    ORDER BY COALESCE(reconciled_at, '-infinity'::timestamptz), fetched_at, category
    LIMIT 1
  `);
  const category = pending.rows[0]?.category;
  return category ? reconcilePriceChartingGuide(category) : null;
}

/**
 * Scheduler entry point: continue cached work first, otherwise refresh the
 * oldest/missing supported guide. The global CSV lease still permits only one
 * provider download across all API instances.
 */
export async function runScheduledGuideReconciliation(): Promise<PriceChartingReconciliationResult | null> {
  const continued = await continuePriceChartingReconciliation();
  if (continued) return continued;
  // Cached guide rows can still be reconciled without a live credential, but
  // never attempt a new provider download when the integration is not configured.
  if (!priceChartingProvider.isConfigured()) return null;
  const imports = await db.select().from(priceChartingGuideImportsTable);
  const byCategory = new Map(imports.map(row => [row.category, row]));
  const categories = Object.keys(GUIDE_GAME_NAMES) as PriceChartingGuideCategory[];
  const next = categories.sort((left, right) => {
    const leftAt = byCategory.get(left)?.fetchedAt.getTime() ?? 0;
    const rightAt = byCategory.get(right)?.fetchedAt.getTime() ?? 0;
    return leftAt - rightAt || left.localeCompare(right);
  })[0];
  if (!next) return null;
  const row = byCategory.get(next);
  if (row && Date.now() - row.fetchedAt.getTime() < 24 * 60 * 60 * 1_000) return null;
  const imported = await importPriceChartingBulkGuide(next);
  return imported.reconciliation;
}

export interface PriceChartingCoverageGame {
  game: string;
  supportedCards: number;
  matchedCards: number;
  rawQuoteCards: number;
  gradedOnlyCards: number;
  ambiguousCards: number;
  unmatchedCards: number;
  unprocessedCards: number;
  staleQuoteCards: number;
}

/** Repeatable, collector-independent coverage proof over the canonical catalogue. */
export async function getPriceChartingCoverageAudit(): Promise<{
  generatedAt: string;
  staleAfterHours: number;
  totals: PriceChartingCoverageGame;
  byGame: PriceChartingCoverageGame[];
  imports: Array<{
    category: string;
    status: string;
    reconciliationStatus: string;
    rowCount: number;
    fetchedAt: string;
    reconciledAt: string | null;
    lastAttemptAt: string | null;
    lastErrorKind: string | null;
    reconciliationCursor: string | null;
    reconciliationLeaseUntil: string | null;
    ageHours: number;
    stats: Record<string, unknown>;
  }>;
  failureReasons: Array<{ reason: string; count: number }>;
  latestSchedulerRun: {
    status: string;
    trigger: string;
    selectedCards: number;
    refreshSucceeded: number;
    refreshFailed: number;
    startedAt: string;
    finishedAt: string | null;
    errorMessage: string | null;
  } | null;
}> {
  const rows = await db.execute<{
    game: string;
    supported_cards: number;
    matched_cards: number;
    raw_quote_cards: number;
    graded_only_cards: number;
    ambiguous_cards: number;
    unmatched_cards: number;
    unprocessed_cards: number;
    stale_quote_cards: number;
  }>(sql`
    WITH supported AS (
      SELECT e.external_id AS card_id,
        CASE
          WHEN g.slug IN ('magic', 'mtg', 'magic-the-gathering') THEN 'magic'
          WHEN g.slug IN ('yu-gi-oh', 'yugioh') THEN 'yugioh'
          WHEN g.slug IN ('one-piece', 'onepiece') THEN 'one_piece'
          ELSE 'pokemon'
        END AS game
      FROM catalogue_external_ids e
      JOIN catalogue_cards c ON c.id = e.entity_id
      JOIN catalogue_sets s ON s.id = c.set_id
      JOIN catalogue_games g ON g.id = c.game_id
      WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
        AND c.is_active = true AND s.is_active = true AND g.is_active = true
        AND g.slug IN ('pokemon', 'magic', 'mtg', 'magic-the-gathering', 'yu-gi-oh', 'yugioh', 'one-piece', 'onepiece')
    ), quote_state AS (
      SELECT card_id,
        BOOL_OR(grade_key = 'raw' AND price_cents > 0) AS has_raw,
        BOOL_OR(grade_key <> 'raw' AND price_cents > 0) AS has_graded,
        MAX(fetched_at) AS latest_quote
      FROM current_quotes
      WHERE provider_key = ${PROVIDER_KEY}
      GROUP BY card_id
    )
    SELECT supported.game,
      COUNT(*)::int AS supported_cards,
      COUNT(*) FILTER (WHERE mapping.status = 'matched')::int AS matched_cards,
      COUNT(*) FILTER (WHERE quote_state.has_raw)::int AS raw_quote_cards,
      COUNT(*) FILTER (WHERE NOT COALESCE(quote_state.has_raw, false) AND quote_state.has_graded)::int AS graded_only_cards,
      COUNT(*) FILTER (WHERE mapping.status = 'review_required')::int AS ambiguous_cards,
      COUNT(*) FILTER (WHERE mapping.status = 'unmatched')::int AS unmatched_cards,
      COUNT(*) FILTER (WHERE mapping.status IS NULL)::int AS unprocessed_cards,
      COUNT(*) FILTER (
        WHERE quote_state.latest_quote < NOW() - INTERVAL '12 hours'
      )::int AS stale_quote_cards
    FROM supported
    LEFT JOIN card_provider_mappings mapping
      ON mapping.card_id = supported.card_id AND mapping.provider_key = ${PROVIDER_KEY}
    LEFT JOIN quote_state ON quote_state.card_id = supported.card_id
    GROUP BY supported.game
    ORDER BY supported.game
  `);
  const toGame = (row: typeof rows.rows[number]): PriceChartingCoverageGame => ({
    game: row.game,
    supportedCards: Number(row.supported_cards),
    matchedCards: Number(row.matched_cards),
    rawQuoteCards: Number(row.raw_quote_cards),
    gradedOnlyCards: Number(row.graded_only_cards),
    ambiguousCards: Number(row.ambiguous_cards),
    unmatchedCards: Number(row.unmatched_cards),
    unprocessedCards: Number(row.unprocessed_cards),
    staleQuoteCards: Number(row.stale_quote_cards),
  });
  const byGame = rows.rows.map(toGame);
  const totals = byGame.reduce<PriceChartingCoverageGame>((total, game) => ({
    game: "all",
    supportedCards: total.supportedCards + game.supportedCards,
    matchedCards: total.matchedCards + game.matchedCards,
    rawQuoteCards: total.rawQuoteCards + game.rawQuoteCards,
    gradedOnlyCards: total.gradedOnlyCards + game.gradedOnlyCards,
    ambiguousCards: total.ambiguousCards + game.ambiguousCards,
    unmatchedCards: total.unmatchedCards + game.unmatchedCards,
    unprocessedCards: total.unprocessedCards + game.unprocessedCards,
    staleQuoteCards: total.staleQuoteCards + game.staleQuoteCards,
  }), {
    game: "all", supportedCards: 0, matchedCards: 0, rawQuoteCards: 0,
    gradedOnlyCards: 0, ambiguousCards: 0, unmatchedCards: 0,
    unprocessedCards: 0, staleQuoteCards: 0,
  });
  const [imports, failures, schedulerRuns] = await Promise.all([
    db.select().from(priceChartingGuideImportsTable).orderBy(priceChartingGuideImportsTable.category),
    db.execute<{ reason: string; count: number }>(sql`
      SELECT COALESCE(match_metadata->>'reason', 'unspecified') AS reason, COUNT(*)::int AS count
      FROM card_provider_mappings
      WHERE provider_key = ${PROVIDER_KEY} AND status <> 'matched'
      GROUP BY COALESCE(match_metadata->>'reason', 'unspecified')
      ORDER BY count DESC, reason
      LIMIT 10
    `),
    db.execute<{
      status: string;
      trigger: string;
      selected_cards: number;
      refresh_succeeded: number;
      refresh_failed: number;
      started_at: Date;
      finished_at: Date | null;
      error_message: string | null;
    }>(sql`
      SELECT status, trigger, selected_cards, refresh_succeeded, refresh_failed,
        started_at, finished_at, error_message
      FROM pricing_scheduler_runs
      ORDER BY started_at DESC
      LIMIT 1
    `),
  ]);
  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(),
    staleAfterHours: STALE_THRESHOLD_MS / 3_600_000,
    totals,
    byGame,
    imports: imports.map(row => ({
      category: row.category,
      status: row.status,
      reconciliationStatus: row.reconciliationStatus,
      rowCount: row.rowCount,
      fetchedAt: row.fetchedAt.toISOString(),
      reconciledAt: row.reconciledAt?.toISOString() ?? null,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      lastErrorKind: row.lastErrorKind,
      reconciliationCursor: row.reconciliationCursor,
      reconciliationLeaseUntil: row.reconciliationLeaseUntil?.toISOString() ?? null,
      ageHours: Number(((now - row.fetchedAt.getTime()) / 3_600_000).toFixed(1)),
      stats: row.reconciliationStats as Record<string, unknown>,
    })),
    failureReasons: failures.rows.map(row => ({ reason: row.reason.slice(0, 80), count: Number(row.count) })),
    latestSchedulerRun: schedulerRuns.rows[0]
      ? {
          status: schedulerRuns.rows[0].status,
          trigger: schedulerRuns.rows[0].trigger,
          selectedCards: Number(schedulerRuns.rows[0].selected_cards),
          refreshSucceeded: Number(schedulerRuns.rows[0].refresh_succeeded),
          refreshFailed: Number(schedulerRuns.rows[0].refresh_failed),
          startedAt: new Date(schedulerRuns.rows[0].started_at).toISOString(),
          finishedAt: schedulerRuns.rows[0].finished_at
            ? new Date(schedulerRuns.rows[0].finished_at).toISOString()
            : null,
          errorMessage: schedulerRuns.rows[0].error_message?.slice(0, 200) ?? null,
        }
      : null,
  };
}

/**
 * Cache a PriceCharting bulk guide and reconcile it against canonical identity.
 * Strong existing mappings are retained; failed states are reconsidered.
 */
export async function importPriceChartingBulkGuide(category: PriceChartingGuideCategory): Promise<{
  category: PriceChartingGuideCategory;
  rowsRead: number;
  quotesPersisted: number;
  reused: boolean;
  reconciliation: PriceChartingReconciliationResult;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const [existing] = await db.select().from(priceChartingGuideImportsTable)
    .where(eq(priceChartingGuideImportsTable.category, category)).limit(1);
  let reusable = existing?.status === "ready"
    && existing.fetchedAt.toISOString().slice(0, 10) === today;
  if (reusable) {
    const legacyRow = await db.select({ id: priceChartingGuideRowsTable.providerProductId })
      .from(priceChartingGuideRowsTable)
      .where(and(
        eq(priceChartingGuideRowsTable.category, category),
        eq(priceChartingGuideRowsTable.normalizedName, ""),
      ))
      .limit(1);
    reusable = legacyRow.length === 0;
  }
  if (reusable) {
    // A prior parser could persist the official CSV rows while dropping every
    // dollar-prefixed price. Treat an all-empty guide as invalid cache data so
    // the next bounded import repairs it rather than reconciling no quotes.
    const pricedRow = await db.select({ id: priceChartingGuideRowsTable.providerProductId })
      .from(priceChartingGuideRowsTable)
      .where(and(
        eq(priceChartingGuideRowsTable.category, category),
        sql`${priceChartingGuideRowsTable.prices} <> '{}'::jsonb`,
      ))
      .limit(1);
    reusable = pricedRow.length > 0;
  }
  let rowsRead: number;
  let reused = reusable;
  if (reusable) {
    const persisted = await db.select().from(priceChartingGuideRowsTable)
      .where(eq(priceChartingGuideRowsTable.category, category));
    rowsRead = persisted.length;
  } else {
    const downloadClaimToken = randomUUID();
    // PriceCharting applies this limit to all CSV categories, not each
    // category independently. This singleton row serializes every process.
    const globalClaim = await db.execute(sql`
      INSERT INTO pricecharting_guide_download_lease
        (lease_key, last_attempt_at, lease_until, claim_token, updated_at)
      VALUES ('pricecharting-csv', NOW(), NOW() + INTERVAL '30 minutes', ${downloadClaimToken}, NOW())
      ON CONFLICT (lease_key) DO UPDATE SET
        last_attempt_at = NOW(), lease_until = NOW() + INTERVAL '30 minutes',
        claim_token = ${downloadClaimToken}, updated_at = NOW()
      WHERE pricecharting_guide_download_lease.lease_until < NOW()
        AND pricecharting_guide_download_lease.last_attempt_at < NOW() - INTERVAL '10 minutes'
      RETURNING last_attempt_at
    `);
    if (!globalClaim.rows[0]) {
      const [globalLease] = await db.select().from(priceChartingGuideDownloadLeaseTable)
        .where(eq(priceChartingGuideDownloadLeaseTable.leaseKey, "pricecharting-csv")).limit(1);
      throw new PriceChartingThrottleError(globalLease
        ? Math.max(0, globalLease.leaseUntil.getTime() - Date.now())
        : 600_000, 429);
    }
    const claim = await db.execute<{ last_attempt_at: Date }>(sql`
      INSERT INTO pricecharting_guide_imports
        (category, status, fetched_at, row_count, last_attempt_at, lease_until, download_claim_token, updated_at)
      VALUES (${category}, 'downloading', NOW(), 0, NOW(), NOW() + INTERVAL '10 minutes', ${downloadClaimToken}, NOW())
      ON CONFLICT (category) DO UPDATE SET
        status = 'downloading', last_attempt_at = NOW(),
        lease_until = NOW() + INTERVAL '10 minutes',
        download_claim_token = ${downloadClaimToken}, updated_at = NOW()
      WHERE (
          pricecharting_guide_imports.last_attempt_at IS NULL
          OR pricecharting_guide_imports.last_attempt_at < NOW() - INTERVAL '10 minutes'
        )
        AND NOT (
          pricecharting_guide_imports.reconciliation_status = 'running'
          AND pricecharting_guide_imports.reconciliation_lease_until >= NOW()
        )
      RETURNING last_attempt_at
    `);
    if (!claim.rows[0]) {
      // No provider request was made. Release the global claim immediately so
      // another eligible category is not blocked for the full 30-minute
      // download lease by this category's local cooldown.
      await db.execute(sql`
        UPDATE pricecharting_guide_download_lease
        SET last_attempt_at = NOW() - INTERVAL '11 minutes',
            lease_until = NOW() - INTERVAL '1 second',
            claim_token = NULL,
            updated_at = NOW()
        WHERE lease_key = 'pricecharting-csv' AND claim_token = ${downloadClaimToken}
      `).catch(() => {});
      const retryAfterMs = existing?.lastAttemptAt
        ? Math.max(0, 600_000 - (Date.now() - existing.lastAttemptAt.getTime()))
        : 600_000;
      throw new PriceChartingThrottleError(retryAfterMs, 429);
    }
    let downloaded;
    try {
      const globalOwnership = await db.execute(sql`
        UPDATE pricecharting_guide_download_lease
        SET lease_until = NOW() + INTERVAL '30 minutes', updated_at = NOW()
        WHERE lease_key = 'pricecharting-csv' AND claim_token = ${downloadClaimToken}
        RETURNING lease_key
      `);
      if (!globalOwnership.rows[0]) throw new Error("PriceCharting global download claim was lost");
      downloaded = await downloadBulkGuide(category);
    } catch (error) {
      const message = error instanceof PriceChartingError
        ? `PriceCharting bulk import ${error.kind}`
        : "PriceCharting bulk import failed";
      await recordProviderHealth(
        false,
        message,
        "bulk_import",
        error instanceof PriceChartingError ? error.kind : "transient",
      ).catch(() => {});
      await db.update(priceChartingGuideImportsTable).set({
        status: "failed",
        lastErrorKind: error instanceof PriceChartingError ? error.kind : "transient",
        downloadClaimToken: null,
        updatedAt: new Date(),
      }).where(and(
        eq(priceChartingGuideImportsTable.category, category),
        eq(priceChartingGuideImportsTable.downloadClaimToken, downloadClaimToken),
      ));
      await db.execute(sql`
        UPDATE pricecharting_guide_download_lease
        SET lease_until = GREATEST(last_attempt_at + INTERVAL '10 minutes', NOW()),
            claim_token = NULL,
            updated_at = NOW()
        WHERE lease_key = 'pricecharting-csv' AND claim_token = ${downloadClaimToken}
      `).catch(() => {});
      throw error;
    }
    rowsRead = downloaded.length;
    const fetchedAt = new Date();
    await db.transaction(async tx => {
      const globalOwnership = await tx.execute(sql`
        UPDATE pricecharting_guide_download_lease
        SET lease_until = GREATEST(last_attempt_at + INTERVAL '10 minutes', NOW()),
            claim_token = NULL,
            updated_at = NOW()
        WHERE lease_key = 'pricecharting-csv' AND claim_token = ${downloadClaimToken}
        RETURNING lease_key
      `);
      if (!globalOwnership.rows[0]) throw new Error("PriceCharting global download claim was lost");
      // Fence publication and hold the category row lock until the replacement
      // guide and reset reconciliation generation commit atomically.
      const ownership = await tx.execute(sql`
        UPDATE pricecharting_guide_imports
        SET lease_until = NOW() + INTERVAL '10 minutes', updated_at = NOW()
        WHERE category = ${category}
          AND status = 'downloading'
          AND download_claim_token = ${downloadClaimToken}
        RETURNING category
      `);
      if (!ownership.rows[0]) throw new Error("PriceCharting guide download claim was lost");
      await tx.delete(priceChartingGuideRowsTable)
        .where(eq(priceChartingGuideRowsTable.category, category));
      for (const batch of chunkGuideRows(downloaded)) {
        await tx.insert(priceChartingGuideRowsTable).values(batch.map(row => ({
          category,
          providerProductId: String(row.id),
          productName: row["product-name"],
          consoleName: row["console-name"],
          normalizedName: normalizedGuideName(row["product-name"]),
          normalizedNumber: normalizeCollectorNumberForMatch(extractCardNumber(row["product-name"]))?.numerator ?? null,
          normalizedSet: normalizedGuideSet(row["console-name"]),
          prices: Object.fromEntries(extractPrices(row)),
          fetchedAt,
        })));
      }
      await tx.insert(priceChartingGuideImportsTable).values({
        category,
        status: "ready",
        fetchedAt,
        rowCount: downloaded.length,
        lastErrorKind: null,
        downloadClaimToken: null,
        reconciliationStatus: "pending",
        reconciliationCursor: null,
        reconciliationLeaseUntil: null,
        reconciliationClaimToken: null,
        reconciledAt: null,
        reconciliationStats: {},
        updatedAt: fetchedAt,
      }).onConflictDoUpdate({ target: priceChartingGuideImportsTable.category, set: {
        status: "ready",
        fetchedAt,
        rowCount: downloaded.length,
        lastErrorKind: null,
        downloadClaimToken: null,
        reconciliationStatus: "pending",
        reconciliationCursor: null,
        reconciliationLeaseUntil: null,
        reconciliationClaimToken: null,
        reconciledAt: null,
        reconciliationStats: {},
        updatedAt: fetchedAt,
      } });
    });
    await recordProviderHealth(true, undefined, "bulk_import");
  }
  // Complete modest catalogues in one protected import call while retaining a
  // strict per-transaction bound. Large catalogues persist their cursor and are
  // continued by later imports or the recurring scheduler.
  let reconciliation = await reconcilePriceChartingGuide(category);
  let quotesPersisted = reconciliation.claimed ? reconciliation.quotesPersisted : 0;
  for (let batch = 1; reconciliation.hasMore && batch < 20; batch += 1) {
    reconciliation = await reconcilePriceChartingGuide(category);
    if (!reconciliation.claimed) break;
    quotesPersisted += reconciliation.quotesPersisted;
  }
  return { category, rowsRead, quotesPersisted, reused, reconciliation };
}

function cleanProviderText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 300) : null;
}

function cleanSalesVolume(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = String(value).trim().replaceAll(",", "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function persistProviderMetadata(cardId: string, detail: PCProductDetail): Promise<void> {
  await db
    .update(cardProviderMappingsTable)
    .set({
      providerProductName: cleanProviderText(detail["product-name"]),
      providerSalesVolume: cleanSalesVolume(detail["sales-volume"]),
      providerReleaseDate: cleanProviderText(detail["release-date"]),
      providerGenre: cleanProviderText(detail["genre"]),
      providerUpc: cleanProviderText(detail["upc"]),
      providerEpid: cleanProviderText(detail["epid"]),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cardProviderMappingsTable.cardId, cardId),
        eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      ),
    );
}

function runMappedRefresh(
  cardId: string,
  providerProductId: string,
  propagateFailures = false,
): Promise<void> {
  const key = `${cardId}:${PROVIDER_KEY}`;
  const existing = matchInFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    // A refresh must reach the provider. Reusing the four-hour response cache
    // here would incorrectly stamp an old quote and history point as fresh.
    const detail = await priceChartingProvider.getProductDetail(providerProductId, { bypassCache: true });
    if (!detail) {
      await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh");
      if (propagateFailures) throw new Error("PriceCharting product refresh returned no data");
      return;
    }
    await persistProviderMetadata(cardId, detail);
    const prices = normalizeProduct(detail).prices;
    await persistQuotes(cardId, providerProductId, prices);
    await recordProviderHealth(true, undefined, "product_refresh");
  })()
    .catch(async (err: unknown) => {
      logger.error({ err, cardId }, "Pricing refresh failed");
      await recordProviderHealth(
        false,
        "PriceCharting product refresh failed",
        "product_refresh",
        providerFailureKind(err),
      ).catch(() => {});
      if (propagateFailures) throw err;
    })
    .finally(() => matchInFlight.delete(key));

  matchInFlight.set(key, job);
  return job;
}

/**
 * Run background match + fetch for a card. Idempotent via in-flight map.
 */
async function runBackgroundMatch(
  cardId: string,
  input: { name: string; set?: string; number?: string; game?: string },
  propagateFailures = false,
): Promise<void> {
  const key = `${cardId}:${PROVIDER_KEY}`;
  const existing = matchInFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    if (!priceChartingProvider.isConfigured()) return;

    // Search by exact card name + collector number first. This avoids making a
    // low-confidence same-name mapping when the provider has multiple prints.
    // Fall back to name/set/game only when the provider has no numbered result.
    let products: NonNullable<Awaited<ReturnType<typeof priceChartingProvider.searchProducts>>> = [];
    let bestResult: ReturnType<typeof pickBestMatch> | null = null;
    for (const query of buildMatchSearchQueries(input)) {
      const queryProducts = await priceChartingProvider.searchProducts(query);
      if (!queryProducts) {
        await recordProviderHealth(false, "PriceCharting search failed", "search");
        if (propagateFailures) throw new Error("PriceCharting search returned no data");
        return;
      }
      const knownIds = new Set(products.map(product => String(product.id)));
      products.push(...queryProducts.filter(product => !knownIds.has(String(product.id))));
      const queryResult = pickBestMatch(
        input,
        queryProducts.map(product => priceChartingProvider.toMatchCandidate(product)),
      );
      if (!bestResult || queryResult.score.total > bestResult.score.total) bestResult = queryResult;
      if (queryResult.status === "matched") {
        bestResult = queryResult;
        break;
      }
    }
    await recordProviderHealth(true, undefined, "search");

    if (products.length === 0) {
      // Save unmatched result
      await db
        .insert(cardProviderMappingsTable)
        .values({
          cardId,
          providerKey: PROVIDER_KEY,
          status: "unmatched",
          confidenceScore: 0,
          confidenceLevel: "none",
          matchedName: input.name,
          matchedSet: input.set ?? null,
          matchedNumber: input.number ?? null,
          matchedGame: input.game ?? null,
        })
        .onConflictDoUpdate({
          target: [cardProviderMappingsTable.cardId, cardProviderMappingsTable.providerKey],
          set: {
            status: "unmatched",
            confidenceScore: 0,
            confidenceLevel: "none",
            providerProductId: null,
            providerProductName: null,
            matchMetadata: { source: "api_search", reason: "no_candidates" },
            matchedName: input.name,
            matchedSet: input.set ?? null,
            matchedNumber: input.number ?? null,
            matchedGame: input.game ?? null,
            updatedAt: new Date(),
          },
        });
      return;
    }

    const candidates = products.map(product => priceChartingProvider.toMatchCandidate(product));
    const result = bestResult ?? pickBestMatch(input, candidates);

    // Persist the mapping
    await db
      .insert(cardProviderMappingsTable)
      .values({
        cardId,
        providerKey: PROVIDER_KEY,
        status: result.status,
        providerProductId: result.candidate?.id ?? null,
        providerProductName: result.candidate?.name ?? null,
        confidenceScore: result.score.total,
        confidenceLevel: result.level,
        matchMetadata: result.score as unknown as Record<string, unknown>,
        matchedName: input.name,
        matchedSet: input.set ?? null,
        matchedNumber: input.number ?? null,
        matchedGame: input.game ?? null,
      })
      .onConflictDoUpdate({
        target: [cardProviderMappingsTable.cardId, cardProviderMappingsTable.providerKey],
        set: {
          status: result.status,
          providerProductId: result.candidate?.id ?? null,
          providerProductName: result.candidate?.name ?? null,
          confidenceScore: result.score.total,
          confidenceLevel: result.level,
          matchMetadata: result.score as unknown as Record<string, unknown>,
          matchedName: input.name,
          matchedSet: input.set ?? null,
          matchedNumber: input.number ?? null,
          matchedGame: input.game ?? null,
          updatedAt: new Date(),
        },
      });

    // If matched, fetch and store prices
    if (result.status === "matched" && result.candidate) {
      const detail = await priceChartingProvider.getProductDetail(result.candidate.id);
      if (detail) {
        await persistProviderMetadata(cardId, detail);
        const prices = normalizeProduct(detail).prices;
        await persistQuotes(cardId, result.candidate.id, prices);
        await recordProviderHealth(true, undefined, "product_refresh");
      } else {
        await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh");
        if (propagateFailures) throw new Error("PriceCharting product refresh returned no data");
      }
    }
  })()
    .catch(async (err: unknown) => {
      logger.error({ err, cardId }, "Background pricing match failed");
      await recordProviderHealth(
        false,
        "PriceCharting matching request failed",
        "search",
        providerFailureKind(err),
      ).catch(() => {});
      if (propagateFailures) throw err;
    })
    .finally(() => {
      matchInFlight.delete(key);
    });

  matchInFlight.set(key, job);
  return job;
}

// ── Public service functions ──────────────────────────────────────────────────

export interface GetPricingOptions {
  cardId: string;
  name: string;
  set?: string;
  number?: string;
  game?: string;
  displayCurrency?: string;
}

/**
 * Get pricing for a card. Returns immediately with stored data or queues
 * a background match/refresh.
 */
export async function getPricing(opts: GetPricingOptions): Promise<PricingResponse> {
  const { cardId, name, set, number, game, displayCurrency = "AUD" } = opts;
  const configured = priceChartingProvider.isConfigured();
  const emptyMarket = {
    verifiedMarket: [] as VerifiedMarketValue[],
    providerMetadata: null,
  };

  const baseSource = {
    provider: PROVIDER_KEY,
    label: PROVIDER_LABEL,
    productId: null as string | null,
  };

  // A JustTCG public card id is already an exact provider identity. Hydrate
  // its real raw quote before asking PriceCharting to establish a separate
  // fuzzy mapping for slabs. This keeps a valid raw price visible for cards
  // that PriceCharting does not catalogue (notably many promos/reprints).
  if (isJustTcgPricingConfigured()) {
    await refreshJustTcgRawHistory(cardId);
  }
  const justTcgRaw = await getStoredJustTcgRawQuote(cardId);
  const justTcgRawResponse = await justTcgRawPricingResponse({
    cardId,
    quote: justTcgRaw,
    displayCurrency,
  });

  // Check existing mapping
  const mapping = await getExistingMapping(cardId);
  const normalizedIdentityChanged = mapping
    ? normalizeString(mapping.matchedName ?? "") !== normalizeString(name)
      || normalizeString(mapping.matchedSet ?? "") !== normalizeString(set ?? "")
      || (normalizeCollectorNumberForMatch(mapping.matchedNumber ?? undefined)?.full ?? "")
        !== (normalizeCollectorNumberForMatch(number)?.full ?? "")
      || normalizeString(mapping.matchedGame ?? "") !== normalizeString(game ?? "")
    : false;

  // If no mapping, queue background match and return pending
  if (!mapping) {
    if (justTcgRawResponse) {
      // Continue the legacy graded-provider match in the background when it
      // is configured, but do not make a genuine raw quote wait for it.
      if (configured) void runBackgroundMatch(cardId, { name, set, number, game });
      return justTcgRawResponse;
    }
    if (!configured) {
      return {
        cardId,
        status: "unavailable",
        configured: false,
        queued: false,
        quotes: [],
        ...emptyMarket,
        source: baseSource,
        confidence: { level: null, score: null },
        updatedAt: null,
        isStale: false,
        errorCode: "missing_secret",
        message: "PriceCharting is not configured on the server",
      };
    }
    runBackgroundMatch(cardId, { name, set, number, game });
    return {
      cardId,
      status: "pending_match",
      configured,
      queued: true,
      quotes: [],
      ...emptyMarket,
      source: baseSource,
      confidence: { level: null, score: null },
      updatedAt: null,
      isStale: false,
      message: "Matching in progress, check back shortly",
    };
  }

  // Mapping exists but is review_required or unmatched
  if (mapping.status === "review_required") {
    if (justTcgRawResponse) return justTcgRawResponse;
    const retryQueued = configured && (
      normalizedIdentityChanged
      || Date.now() - mapping.updatedAt.getTime() >= NON_MATCH_RETRY_COOLDOWN_MS
    );
    if (retryQueued) void runBackgroundMatch(cardId, { name, set, number, game });
    return {
      cardId,
      status: "review_required",
      configured,
      queued: retryQueued,
      quotes: [],
      ...emptyMarket,
      source: { ...baseSource, productId: mapping.providerProductId ?? null },
      confidence: {
        level: mapping.confidenceLevel ?? null,
        score: mapping.confidenceScore ?? null,
      },
      updatedAt: mapping.updatedAt.toISOString(),
      isStale: false,
      message: retryQueued
        ? "Rechecking card identity with PriceCharting"
        : "Match requires review — prices unavailable until resolved",
    };
  }

  if (mapping.status === "unmatched") {
    if (justTcgRawResponse) return justTcgRawResponse;
    const retryQueued = configured && (
      normalizedIdentityChanged
      || Date.now() - mapping.updatedAt.getTime() >= NON_MATCH_RETRY_COOLDOWN_MS
    );
    if (retryQueued) void runBackgroundMatch(cardId, { name, set, number, game });
    return {
      cardId,
      status: "unmatched",
      configured,
      queued: retryQueued,
      quotes: [],
      ...emptyMarket,
      source: baseSource,
      confidence: {
        level: mapping.confidenceLevel ?? null,
        score: mapping.confidenceScore ?? null,
      },
      updatedAt: mapping.updatedAt.toISOString(),
      isStale: false,
      message: retryQueued
        ? "Rechecking card identity with PriceCharting"
        : "No matching product found in provider catalog",
    };
  }

  // Matched — get quotes
  const priceChartingQuotes = await getStoredQuotes(cardId);
  // Raw catalogue values now come from the exact JustTCG card identity. Keep
  // PriceCharting's company-specific grades, but never let its raw quote
  // override a newer JustTCG raw observation.
  const storedQuotes = justTcgRaw
    ? [
        ...priceChartingQuotes.filter(quote => quote.gradeKey !== "raw"),
        { ...justTcgRaw, gradeKey: "raw" as GradeKey },
      ]
    : priceChartingQuotes;
  const productId = mapping.providerProductId ?? null;

  if (storedQuotes.length === 0) {
    if (!configured) {
      return {
        cardId,
        status: "unavailable",
        configured: false,
        queued: false,
        quotes: [],
        ...emptyMarket,
        source: { ...baseSource, productId },
        confidence: {
          level: mapping.confidenceLevel ?? null,
          score: mapping.confidenceScore ?? null,
        },
        updatedAt: null,
        isStale: false,
        errorCode: "missing_secret",
        message: "Stored mapping exists, but PriceCharting is not configured for a quote refresh",
      };
    }
    // No quotes yet — queue refresh
    if (productId) void runMappedRefresh(cardId, productId);
    else void runBackgroundMatch(cardId, { name, set, number, game });
    return {
      cardId,
      status: "pending_match",
      configured: true,
      queued: true,
      quotes: [],
      ...emptyMarket,
      source: { ...baseSource, productId },
      confidence: {
        level: mapping.confidenceLevel ?? null,
        score: mapping.confidenceScore ?? null,
      },
      updatedAt: null,
      isStale: false,
      message: "Fetching prices, check back shortly",
    };
  }

  // Build quote items with FX conversion
  const latestFetch = storedQuotes.reduce<Date | null>((best, q) => {
    return best == null || q.fetchedAt > best ? q.fetchedAt : best;
  }, null);

  const isStale = latestFetch
    ? Date.now() - latestFetch.getTime() > STALE_THRESHOLD_MS
    : true;
  const refreshQueued = Boolean(isStale && configured && productId);
  if (refreshQueued && productId) void runMappedRefresh(cardId, productId);

  // Determine FX rate once for all quotes
  let fxRate: number | null = null;
  let conversionProvenance: ReturnType<typeof buildConversionProvenance> | undefined;
  if (displayCurrency !== PC_CURRENCY) {
    fxRate = await convertCents(100, PC_CURRENCY, displayCurrency).then(v =>
      v != null ? v / 100 : null,
    );
    conversionProvenance = buildConversionProvenance(PC_CURRENCY, displayCurrency, fxRate);
  }

  const quoteMap = new Map(storedQuotes.map(q => [q.gradeKey, q]));
  const quotes: QuoteItem[] = [];
  const verifiedMarket: VerifiedMarketValue[] = [];
  const retainedHistory = await db
    .select()
    .from(providerPriceHistoryTable)
    .where(
      and(
        eq(providerPriceHistoryTable.cardId, cardId),
        inArray(providerPriceHistoryTable.providerKey, [PROVIDER_KEY, JUSTTCG_PRICING_PROVIDER_KEY]),
        gte(providerPriceHistoryTable.recordedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      ),
    );
  const now = new Date();
  const activeOverrideRows = await db
    .select()
    .from(pricingOverridesTable)
    .where(
      and(
        eq(pricingOverridesTable.cardId, cardId),
        isNull(pricingOverridesTable.revokedAt),
        lte(pricingOverridesTable.startsAt, now),
        or(
          isNull(pricingOverridesTable.expiresAt),
          gt(pricingOverridesTable.expiresAt, now),
        ),
      ),
    )
    .orderBy(desc(pricingOverridesTable.createdAt));
  const overrideByGrade = new Map(
    activeOverrideRows.map((override) => [override.gradeKey, override]),
  );
  const appliedOverrides: NonNullable<PricingResponse["manualOverrides"]> = [];

  for (const gradeDef of GRADE_DEFINITIONS) {
    const q = quoteMap.get(gradeDef.key);
    if (!q) continue;

    let displayCents: number;
    let displayCurrencyFinal: string;

    if (fxRate != null) {
      displayCents = Math.round(q.priceCents * fxRate);
      displayCurrencyFinal = displayCurrency;
    } else {
      displayCents = q.priceCents;
      displayCurrencyFinal = q.currency;
    }

    quotes.push({
      gradeKey: gradeDef.key,
      label: gradeDef.label,
      priceCents: displayCents,
      price: displayCents / 100,
      currency: displayCurrencyFinal,
      originalPriceCents: q.priceCents,
      originalCurrency: q.currency,
    });

    const historyProviderKey = gradeDef.key === "raw"
      ? JUSTTCG_PRICING_PROVIDER_KEY
      : PROVIDER_KEY;
    const retainedSnapshotCents = retainedHistory
      .filter(row => row.gradeKey === gradeDef.key && row.providerKey === historyProviderKey)
      .map(row => fxRate != null ? Math.round(row.priceCents * fxRate) : row.priceCents);
    const market = aggregateVerifiedMarketValue({
      gradeKey: gradeDef.key,
      quotes: [{
        providerKey: q.providerKey,
        providerLabel: q.providerKey === JUSTTCG_PRICING_PROVIDER_KEY
          ? "JustTCG"
          : PROVIDER_LABEL,
        providerProductId: q.providerProductId ?? productId,
        gradeKey: gradeDef.key,
        priceCents: displayCents,
        currency: displayCurrencyFinal,
        originalPriceCents: q.priceCents,
        originalCurrency: q.currency,
        fetchedAt: q.fetchedAt,
      }],
      matchingConfidence: mapping.confidenceScore ?? null,
      isStale,
      retainedSnapshotCents,
    });
    if (market) {
      const override = overrideByGrade.get(gradeDef.key);
      if (override) {
        const overrideDisplayCents =
          override.currency === displayCurrencyFinal
            ? override.priceCents
            : await convertCents(
                override.priceCents,
                override.currency,
                displayCurrencyFinal,
              );
        if (overrideDisplayCents != null) {
          market.verifiedMarketValueCents = overrideDisplayCents;
          market.verifiedMarketValue = overrideDisplayCents / 100;
          market.currency = displayCurrencyFinal;
          market.confidence = {
            ...market.confidence,
            score: Math.min(market.confidence.score, 50),
            level: "low",
            reasons: [
              "A reviewed manual override is currently active",
              ...market.confidence.reasons,
            ],
          };
          market.insights = [
            "Verified Market value is temporarily overridden; provider quotes remain visible",
            ...market.insights,
          ];
          appliedOverrides.push({
            id: override.id,
            gradeKey: override.gradeKey,
            priceCents: override.priceCents,
            currency: override.currency,
            reason: override.reason,
            expiresAt: override.expiresAt?.toISOString() ?? null,
          });
        }
      }
      verifiedMarket.push(market);
    }
  }

  const primaryMarket = verifiedMarket.find(value => value.gradeKey === "raw") ?? verifiedMarket[0];

  return {
    cardId,
    status: isStale ? "stale" : "available",
    configured,
    queued: refreshQueued,
    quotes,
    verifiedMarket,
    source: {
      provider: PROVIDER_KEY,
      label: PROVIDER_LABEL,
      productId,
    },
    confidence: {
      level: primaryMarket?.confidence.level ?? null,
      score: primaryMarket?.confidence.score ?? null,
      providerCount: primaryMarket?.confidence.providerCount,
      reasons: primaryMarket?.confidence.reasons,
    },
    matchingConfidence: {
      level: mapping.confidenceLevel ?? null,
      score: mapping.confidenceScore ?? null,
    },
    providerMetadata: {
      salesVolume: mapping.providerSalesVolume ?? null,
      releaseDate: mapping.providerReleaseDate ?? null,
      genre: mapping.providerGenre ?? null,
      upc: mapping.providerUpc ?? null,
      epid: mapping.providerEpid ?? null,
    },
    updatedAt: latestFetch?.toISOString() ?? null,
    isStale,
    ...(appliedOverrides.length > 0 ? { manualOverrides: appliedOverrides } : {}),
    ...(!configured
      ? { message: "Stored PriceCharting value shown; automatic refresh is not configured" }
      : {}),
    ...(conversionProvenance ? { conversion: conversionProvenance } : {}),
  };
}

/**
 * Force-refresh pricing for a card. Waits for the refresh to complete
 * (bounded by timeout) then returns updated pricing.
 */
export async function refreshPricing(opts: GetPricingOptions): Promise<PricingResponse> {
  const { cardId, name, set, number, game } = opts;

  if (!priceChartingProvider.isConfigured()) {
    return getPricing(opts);
  }

  // Get existing mapping to know the product ID
  const mapping = await getExistingMapping(cardId);
  const productId = mapping?.providerProductId ?? null;

  const REFRESH_TIMEOUT_MS = 15_000;

  if (productId && mapping?.status === "matched") {
    // Re-fetch via product ID
    const key = `${cardId}:${PROVIDER_KEY}`;
    if (!matchInFlight.has(key)) {
      void runMappedRefresh(cardId, productId);
    }
    // Wait for completion or timeout
    await Promise.race([
      matchInFlight.get(key) ?? Promise.resolve(),
      new Promise<void>(r => setTimeout(r, REFRESH_TIMEOUT_MS)),
    ]);
  } else {
    // Re-run full match
    void runBackgroundMatch(cardId, { name, set, number, game });
    await Promise.race([
      matchInFlight.get(`${cardId}:${PROVIDER_KEY}`) ?? Promise.resolve(),
      new Promise<void>(r => setTimeout(r, REFRESH_TIMEOUT_MS)),
    ]);
  }

  return getPricing(opts);
}

/**
 * Scheduler refresh variant. Unlike the interactive endpoint, this waits for
 * the real provider job (including queue time) before resolving so dependent
 * portfolio snapshots cannot run against pre-refresh data.
 */
export async function refreshPricingForScheduler(
  opts: Pick<GetPricingOptions, "cardId" | "name" | "set" | "number" | "game">,
): Promise<void> {
  if (!priceChartingProvider.isConfigured()) return;

  const mapping = await getExistingMapping(opts.cardId);
  if (mapping?.status === "matched" && mapping.providerProductId) {
    await runMappedRefresh(opts.cardId, mapping.providerProductId, true);
    return;
  }

  await runBackgroundMatch(opts.cardId, {
    name: opts.name,
    set: opts.set,
    number: opts.number,
    game: opts.game,
  }, true);
}

/**
 * Explicitly refresh quotes for a card using the persisted provider product ID.
 * Unlike `runMappedRefresh`, this function:
 *   - Bypasses every cache layer and contacts the provider unconditionally
 *   - Awaits quote AND history persistence before resolving
 *   - Propagates failure as a returned status rather than silently catching it
 *
 * Intended for admin-initiated refresh jobs where the operator expects the DB
 * to reflect fresh provider data once the job is marked `succeeded`.
 */
export async function refreshPricingExplicit(
  cardId: string,
  providerProductId: string,
): Promise<{ status: "succeeded" } | { status: "failed"; error: string }> {
  if (!priceChartingProvider.isConfigured()) {
    return { status: "failed", error: "PriceCharting provider is not configured" };
  }
  try {
    const detail = await priceChartingProvider.getProductDetail(providerProductId, {
      bypassCache: true,
    });
    if (!detail) {
      await recordProviderHealth(false, "PriceCharting product refresh returned no data", "explicit_refresh");
      return { status: "failed", error: "Provider returned no data for this product" };
    }
    await persistProviderMetadata(cardId, detail);
    const prices = priceChartingProvider.normalizeQuotes(detail);
    await persistQuotes(cardId, providerProductId, prices);
    await recordProviderHealth(true, undefined, "explicit_refresh");
    return { status: "succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error during refresh";
    logger.error({ err, cardId, providerProductId }, "Explicit pricing refresh failed");
    await recordProviderHealth(
      false,
      "PriceCharting explicit refresh failed",
      "explicit_refresh",
      providerFailureKind(err),
    ).catch(() => {});
    return { status: "failed", error: message };
  }
}

/**
 * Advance fair scheduling when authoritative catalog identity cannot be
 * resolved. Existing strong mappings are never overwritten.
 */
export async function recordSchedulerIdentityFailure(cardId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO card_provider_mappings (
      card_id,
      provider_key,
      status,
      confidence_level,
      match_metadata,
      updated_at
    )
    VALUES (
      ${cardId},
      ${PROVIDER_KEY},
      'unmatched',
      'none',
      '{"reason":"catalog_identity_unavailable"}'::jsonb,
      NOW()
    )
    ON CONFLICT (card_id, provider_key) DO UPDATE
      SET updated_at = NOW(),
          match_metadata = EXCLUDED.match_metadata
      WHERE card_provider_mappings.status <> 'matched'
  `);
}

/**
 * Get price history for a card from providerPriceHistory + legacy price_snapshots.
 */
export interface HistoryPoint {
  date: string;
  priceCents: number;
  price: number;
  currency: string;
}

export interface PriceHistoryResult {
  cardId: string;
  gradeKey: string;
  points: HistoryPoint[];
  source: string;
  historyAvailable: boolean;
  movement: {
    absolute: number;
    percent: number;
    direction: "up" | "down" | "flat";
  } | null;
  updatedAt: string | null;
}

export async function getPriceHistory(opts: {
  cardId: string;
  gradeKey?: string;
  periodDays?: number;
  displayCurrency?: string;
}): Promise<PriceHistoryResult> {
  const { cardId, periodDays = 30, displayCurrency = "AUD" } = opts;
  const canonicalGradeKey = normalizeGradeKey(opts.gradeKey ?? "raw") ?? "raw";

  // Raw historical data is sourced from JustTCG. Fetching the exact public id
  // here also lets a card-detail page repair an empty local cache without
  // inventing any backfilled observations.
  if (canonicalGradeKey === "raw") {
    await refreshJustTcgRawHistory(cardId);
  }

  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  let historyProviderKey = canonicalGradeKey === "raw"
    ? JUSTTCG_PRICING_PROVIDER_KEY
    : PROVIDER_KEY;

  let snapshotRows = await db
    .select()
    .from(cardPriceSnapshotsTable)
    .where(
      and(
        eq(cardPriceSnapshotsTable.cardId, cardId),
        eq(cardPriceSnapshotsTable.providerKey, historyProviderKey),
        eq(cardPriceSnapshotsTable.gradeKey, canonicalGradeKey),
        gte(cardPriceSnapshotsTable.capturedAt, since),
        eq(cardPriceSnapshotsTable.captureStatus, "success"),
      ),
    )
    .orderBy(cardPriceSnapshotsTable.capturedAt);

  // Retained daily history predates the timestamped snapshot table. Read both
  // so an initial new capture does not hide an existing multi-day price graph.
  // A timestamped capture wins for its calendar day because it has the more
  // precise observation; daily rows fill only days without such a capture.
  let legacyRows = await db
    .select()
    .from(providerPriceHistoryTable)
    .where(and(
      eq(providerPriceHistoryTable.cardId, cardId),
      eq(providerPriceHistoryTable.providerKey, historyProviderKey),
      eq(providerPriceHistoryTable.gradeKey, canonicalGradeKey),
      gte(providerPriceHistoryTable.snapshotDate, since.toISOString().slice(0, 10)),
    ))
    .orderBy(providerPriceHistoryTable.snapshotDate);

  // Keep existing PriceCharting history available while a JustTCG cache is
  // cold. It is a fallback only: a real JustTCG observation always wins.
  if (canonicalGradeKey === "raw" && snapshotRows.length === 0 && legacyRows.length === 0) {
    historyProviderKey = PROVIDER_KEY;
    snapshotRows = await db.select().from(cardPriceSnapshotsTable).where(and(
      eq(cardPriceSnapshotsTable.cardId, cardId),
      eq(cardPriceSnapshotsTable.providerKey, historyProviderKey),
      eq(cardPriceSnapshotsTable.gradeKey, canonicalGradeKey),
      gte(cardPriceSnapshotsTable.capturedAt, since),
      eq(cardPriceSnapshotsTable.captureStatus, "success"),
    )).orderBy(cardPriceSnapshotsTable.capturedAt);
    legacyRows = await db.select().from(providerPriceHistoryTable).where(and(
      eq(providerPriceHistoryTable.cardId, cardId),
      eq(providerPriceHistoryTable.providerKey, historyProviderKey),
      eq(providerPriceHistoryTable.gradeKey, canonicalGradeKey),
      gte(providerPriceHistoryTable.snapshotDate, since.toISOString().slice(0, 10)),
    )).orderBy(providerPriceHistoryTable.snapshotDate);
  }

  const snapshotDays = new Set(
    snapshotRows.map((row) => row.capturedAt.toISOString().slice(0, 10)),
  );
  const pointsSource = [
    ...legacyRows
      .filter((row) => row.priceCents > 0)
      .filter((row) => !snapshotDays.has(row.snapshotDate))
      .map((row) => ({
        date: row.snapshotDate,
        priceCents: row.priceCents,
        currency: row.currency,
        recordedAt: row.recordedAt,
      })),
    ...snapshotRows
      .filter((row) => row.priceCents != null && row.priceCents > 0)
      .map((row) => ({
        date: row.capturedAt.toISOString(),
        priceCents: row.priceCents!,
        currency: row.currency,
        recordedAt: row.capturedAt,
      })),
  ].sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime());

  // FX conversion
  let fxRate: number | null = null;
  if (displayCurrency !== "USD") {
    fxRate = await convertCents(100, "USD", displayCurrency).then(v => v != null ? v / 100 : null);
  }

  const points: HistoryPoint[] = pointsSource.map(r => {
    const displayCents = fxRate != null
      ? Math.round(r.priceCents * fxRate)
      : r.priceCents;
    const displayCurr = fxRate != null ? displayCurrency : r.currency;
    return {
      date: r.date,
      priceCents: displayCents,
      price: displayCents / 100,
      currency: displayCurr,
    };
  });

  // Calculate movement if we have at least 2 points
  let movement: PriceHistoryResult["movement"] = null;
  if (points.length >= 2) {
    const from = points[0]!.priceCents;
    const to   = points[points.length - 1]!.priceCents;
    const changeCents = to - from;
    const percent = from > 0 ? (changeCents / from) * 100 : 0;
    movement = {
      absolute: changeCents / 100,
      percent,
      direction: changeCents > 0 ? "up" : changeCents < 0 ? "down" : "flat",
    };
  }

  const latestRow = pointsSource[pointsSource.length - 1] ?? null;

  return {
    cardId,
    gradeKey: canonicalGradeKey,
    points,
    source: snapshotRows.length > 0 && legacyRows.length > 0
      ? `${historyProviderKey}_retained_history_and_snapshots`
      : snapshotRows.length > 0
        ? `${historyProviderKey}_snapshots`
        : historyProviderKey,
    historyAvailable: points.length >= 2,
    movement,
    updatedAt: latestRow?.recordedAt?.toISOString() ?? null,
  };
}

/** Check if a background match is in flight for a card. */
export function isMatchInFlight(cardId: string): boolean {
  return matchInFlight.has(`${cardId}:${PROVIDER_KEY}`);
}
