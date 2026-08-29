/**
 * POST /scan/recognize
 *
 * Accepts a base64-encoded card image, calls GPT vision to extract card
 * name / set / number, searches the JustTCG catalog for matches, tracks
 * per-user monthly scan usage, and returns the top matches with confidence.
 *
 * Free users are limited to 30 scans per calendar month (FREE_SCAN_LIMIT).
 * Pro users are unlimited.
 *
 * Quota enforcement is fully atomic: a single conditional INSERT … ON CONFLICT
 * DO UPDATE statement reserves the scan slot before any expensive API call is
 * made.  No separate read-then-write path exists, so concurrent requests
 * cannot both pass the limit check.
 *
 * Body size: the /api/scan path is configured with a 12 MB JSON limit in
 * app.ts; this handler additionally validates the base64 payload directly.
 */
import { Router } from "express";
import express from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { db } from "@workspace/db";
import { scanAttemptsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";
import { justTcg } from "../lib/catalogueProvider.js";
import {
  normalizeCollectorNumber,
  normalizeForMatching,
  normalizeGameSlug,
  normalizeSetCode,
  normalizeText,
} from "../catalogue/internal/catalogueNormalisation.js";
import { normalizeJustTcgCard, type JustTcgProviderCard } from "../catalogue/internal/justTcgCanonicalAdapter.js";
import { shapeCanonicalCard } from "../catalogue/internal/catalogueReadService.js";

const router = Router();

const FREE_SCAN_LIMIT = 30;
const RECOGNITION_MODEL = "gpt-4o-mini";

/**
 * Maximum base64 image payload: 8 MB encoded ≈ ~6 MB JPEG.
 * Even at expo-camera's quality=0.5 this comfortably covers a full-resolution
 * mobile photo while bounding cost and request time.
 */
const MAX_IMAGE_B64_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Mobile TCGId values. Keep this list in lockstep with the client contract. */
const SUPPORTED_MOBILE_GAMES = new Set(["pokemon", "magic", "one piece", "yugioh", "lorcana", "dragonball"]);

export type ExtractedCardInfo = {
  game: string;
  name: string;
  setName: string;
  number: string;
};
export type RecognitionStatus = "matched" | "ambiguous" | "unreadable" | "unsupported" | "insufficient_evidence" | "no_canonical_match";

class CatalogueRecognitionError extends Error {}

function mobileGameId(providerSlug: string | null): string | null {
  switch (providerSlug) {
    case "pokemon": return "pokemon";
    case "magic-the-gathering": return "magic";
    case "one-piece": return "one piece";
    case "yu-gi-oh": return "yugioh";
    case "lorcana": return "lorcana";
    case "dragon-ball": return "dragonball";
    default: return null;
  }
}

function providerGameSlug(value: string): string | null {
  // catalogueNormalisation accepts human labels; retain the compact mobile ID
  // spelling as well so the mobile contract is accepted verbatim.
  if (normalizeForMatching(value) === "dragonball") return "dragon-ball";
  return normalizeGameSlug(value);
}

// ── OpenAI client ──────────────────────────────────────────────────────────

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the first day of the current UTC calendar month as a Date. */
function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Atomically reserve a scan slot for a free-tier user.
 *
 * Uses a single INSERT … ON CONFLICT DO UPDATE … WHERE statement so the
 * check and increment happen inside one database round-trip.  The conditional
 * WHERE on the conflict branch means the row is only updated when the current
 * count is strictly below the limit — PostgreSQL's UPDATE … WHERE guarantee
 * makes this race-free even under high concurrency.
 *
 * Returns the new scan_count after increment, or null when the limit was
 * already reached (row was not updated).
 */
async function atomicReserveScan(
  userId: string,
  periodStart: Date,
  limit: number,
): Promise<number | null> {
  const result = await db.execute<{ scan_count: number }>(sql`
    INSERT INTO scan_usage (user_id, period_start, scan_count, updated_at)
    VALUES (${userId}, ${periodStart}, 1, NOW())
    ON CONFLICT ON CONSTRAINT scan_usage_user_period_uniq DO UPDATE
      SET scan_count = scan_usage.scan_count + 1,
          updated_at = NOW()
      WHERE scan_usage.scan_count < ${limit}
    RETURNING scan_count
  `);

  // RETURNING returns 0 rows when the WHERE condition was false (limit hit)
  if (!result.rows.length) return null;
  return result.rows[0]!.scan_count;
}

/**
 * Atomically record a scan for a Pro user (no limit enforced).
 * Returns the new scan_count (informational only).
 */
async function atomicRecordProScan(
  userId: string,
  periodStart: Date,
): Promise<number> {
  const result = await db.execute<{ scan_count: number }>(sql`
    INSERT INTO scan_usage (user_id, period_start, scan_count, updated_at)
    VALUES (${userId}, ${periodStart}, 1, NOW())
    ON CONFLICT ON CONSTRAINT scan_usage_user_period_uniq DO UPDATE
      SET scan_count = scan_usage.scan_count + 1,
          updated_at = NOW()
    RETURNING scan_count
  `);
  return result.rows[0]?.scan_count ?? 1;
}

/**
 * Releases exactly one previously-reserved slot. This is safe with concurrent
 * requests: PostgreSQL locks the usage row while decrementing, so another
 * reservation cannot be lost. Zero rows are retained to avoid a delete/race.
 */
async function atomicReleaseScan(userId: string, periodStart: Date): Promise<number> {
  const result = await db.execute<{ scan_count: number }>(sql`
    UPDATE scan_usage
    SET scan_count = GREATEST(scan_count - 1, 0),
        updated_at = NOW()
    WHERE user_id = ${userId} AND period_start = ${periodStart} AND scan_count > 0
    RETURNING scan_count
  `);
  if (!result.rows[0]) throw new Error("Unable to release scan quota reservation");
  return result.rows[0].scan_count;
}

/** Read the current scan count for informational purposes (no side effects). */
async function readScanCount(userId: string, periodStart: Date): Promise<number> {
  const rows = await db.execute<{ scan_count: number }>(sql`
    SELECT scan_count FROM scan_usage
    WHERE user_id = ${userId} AND period_start = ${periodStart}
    LIMIT 1
  `);
  return rows.rows[0]?.scan_count ?? 0;
}

/** Look up the subscription tier for a user. */
async function getUserTier(userId: string): Promise<string> {
  const [user] = await db
    .select({ subscriptionTier: usersTable.subscriptionTier })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.subscriptionTier ?? "free";
}

/**
 * Strictly validates base64 and image signatures before spending a scan quota.
 * Buffer.from is deliberately not used as validation: it silently accepts
 * malformed base64 strings.
 */
function dimensionsAreSane(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS;
}

function validJpeg(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2;
  let dimensions = false;
  let scan = false;
  while (offset < bytes.length - 2) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return false;
      dimensions = dimensionsAreSane(bytes.readUInt16BE(offset + 3), bytes.readUInt16BE(offset + 5));
      if (!dimensions) return false;
    }
    if (marker === 0xda) {
      if (offset + length >= bytes.length - 2) return false;
      scan = true;
      break; // Compressed scan bytes are followed by the already-verified EOI.
    }
    offset += length;
  }
  return dimensions && scan;
}

function validPng(bytes: Buffer): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) return false;
  let offset = 8;
  let dimensions = false;
  let imageData = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) return false;
      dimensions = dimensionsAreSane(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
    } else if (type === "IDAT" && length > 0) {
      imageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) return false;
      ended = true;
      break;
    }
    offset = end;
  }
  return dimensions && imageData && ended;
}

function validWebp(bytes: Buffer): boolean {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
      bytes.subarray(8, 12).toString("ascii") !== "WEBP" ||
      bytes.readUInt32LE(4) + 8 !== bytes.length) return false;
  let offset = 12;
  let dimensions = false;
  let imageData = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + length + (length % 2);
    if (end > bytes.length) return false;
    if (type === "VP8 " && length >= 10 &&
        bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      dimensions = dimensionsAreSane(bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff);
      imageData = true;
    } else if (type === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      const width = 1 + bytes[data + 1]! + ((bytes[data + 2]! & 0x3f) << 8);
      const height = 1 + (bytes[data + 2]! >> 6) + (bytes[data + 3]! << 2) + ((bytes[data + 4]! & 0x0f) << 10);
      dimensions = dimensionsAreSane(width, height);
      imageData = true;
    }
    offset = end;
  }
  return offset === bytes.length && dimensions && imageData;
}

export function validateImagePayload(image: string, mimeType: unknown): { base64: string; mimeType: string } {
  if (typeof mimeType !== "string" || !SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error("mimeType must be one of image/jpeg, image/png, or image/webp");
  }
  if (image.length > MAX_IMAGE_B64_BYTES || image.length === 0 || image.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) {
    throw new Error("image must be valid base64-encoded image data");
  }
  const bytes = Buffer.from(image, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("image decoded size is invalid or exceeds 6 MB");
  }
  const structurallyValid = mimeType === "image/jpeg" ? validJpeg(bytes) :
    mimeType === "image/png" ? validPng(bytes) : validWebp(bytes);
  if (!structurallyValid) {
    throw new Error("image data is truncated, malformed, or does not match mimeType");
  }
  return { base64: image, mimeType };
}

function cleanExtractedText(value: unknown, limit: number): string {
  return typeof value === "string" ? normalizeText(value).slice(0, limit) : "";
}

/** Call GPT vision for structured, independently-verifiable card evidence. */
async function extractCardInfo(base64Image: string, mimeType: string): Promise<ExtractedCardInfo> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    throw new Error("Card recognition is not configured — missing API key.");
  }

  const response = await openai.chat.completions.create({
    model: RECOGNITION_MODEL,
    max_completion_tokens: 180,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: "high",
            },
          },
          {
            type: "text",
            text: `You are a trading card identifier. Read only visible evidence from this image.
Extract the supported TCG game, card name, set name or set code, and the complete
printed collector number. Read both numerator and denominator when printed (for
example "58/102"), and read any adjacent set code or set-symbol evidence. Do not
invent a set name from a symbol you cannot identify.
Supported games: Pokémon, Magic: The Gathering, One Piece, Yu-Gi-Oh!, Dragon Ball,
and Disney Lorcana. Do not guess values that are not legible.

Respond in this exact JSON format:
{"game":"<game>","name":"<card name>","setName":"<set name or code>","number":"<collector number>"}

If you cannot identify every field clearly, return empty strings for unknown fields.`,
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as {
        name?: string;
        setName?: string;
        number?: string;
        game?: string;
      };
      return {
        game: cleanExtractedText(parsed.game, 80),
        name: cleanExtractedText(parsed.name, 200),
        setName: cleanExtractedText(parsed.setName, 200),
        number: normalizeCollectorNumber(cleanExtractedText(parsed.number, 80)) ?? "",
      };
    }
  } catch {
    // JSON parse failed — fall through
  }

  return { game: "", name: "", setName: "", number: "" };
}

/** Search JustTCG catalog for cards matching extracted card text. */
async function searchCatalog(
  extracted: ExtractedCardInfo,
): Promise<Array<Record<string, unknown>>> {
  // Start specific, then make at most two evidence-only retries. Some provider
  // indexes tokenize set names/numbers differently from a combined free-text
  // query. Every returned card is still subject to exact canonical evidence.
  const queries = [
    [extracted.name, extracted.setName, extracted.number],
    [extracted.setName, extracted.number],
    [extracted.name, extracted.number],
  ].map((parts) => parts.filter(Boolean).join(" ").trim()).filter(Boolean);
  const cards = new Map<string, Record<string, unknown>>();
  for (const query of [...new Set(queries)]) {
    const params = new URLSearchParams({ q: query, limit: "20", include_price_history: "false" });
    const result = await justTcg(`/cards?${params.toString()}`);
    if (result.status >= 400) throw new CatalogueRecognitionError();
    const body = result.body as { data?: unknown[] };
    for (const value of body.data ?? []) {
      if (value && typeof value === "object") {
        const card = value as Record<string, unknown>;
        const id = typeof card.id === "string" || typeof card.id === "number" ? String(card.id) : null;
        if (id) cards.set(id, card);
      }
    }
    // A non-empty provider page can still contain only similarly named cards.
    // Retry only until it has canonical evidence, never based on fuzzy text.
    if (rankEvidenceMatches([...cards.values()], extracted).candidates.length > 0) break;
  }
  return [...cards.values()];
}

/**
 * Reads the durable provider-independent catalogue before attempting a network
 * provider call. The external ID/image requirements are the same public-card
 * contract used by catalogue reads; no scanner-only card or quote is invented.
 */
async function searchPersistedCatalogue(extracted: ExtractedCardInfo): Promise<Array<Record<string, unknown>>> {
  const game = providerGameSlug(extracted.game);
  const number = normalizeCollectorNumber(extracted.number);
  if (!game || !number) return [];
  const numeratorOnly = /^\d+$/.test(number);
  const result = await db.execute<Record<string, unknown>>(sql`
    SELECT e.external_id, c.id AS card_id, c.name, g.name AS game, s.name AS set_name,
      s.code AS set_code, c.collector_number, c.rarity, c.language, s.region,
      c.release_date,
      (SELECT i.url FROM catalogue_card_images i
       WHERE i.card_id = c.id AND i.is_primary = true
       ORDER BY i.created_at LIMIT 1) AS image_url,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'key', v.variant_key, 'name', v.name, 'finish', v.finish,
          'edition', v.edition, 'stamp', v.stamp
        ))
        FROM catalogue_card_variants v WHERE v.card_id = c.id
      ), '[]'::jsonb) AS variants
    FROM catalogue_external_ids e
    JOIN catalogue_cards c ON c.id = e.entity_id
    JOIN catalogue_sets s ON s.id = c.set_id
    JOIN catalogue_games g ON g.id = c.game_id
    WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
      AND g.slug = ${game}
      AND (
        c.collector_number_normalized = ${number}
        OR (${numeratorOnly} AND split_part(c.collector_number_normalized, '/', 1) = ${number})
      )
    LIMIT 50
  `);
  const cards: Array<Record<string, unknown>> = [];
  for (const row of result.rows) {
    const card = shapeCanonicalCard(row);
    if (card) cards.push(card as unknown as Record<string, unknown>);
  }
  return cards;
}

/** Conservative score used only after exact set and collector-number evidence. */
function scoreMatch(
  card: Record<string, unknown>,
  extracted: ExtractedCardInfo,
): number {
  const candidate = normalizeJustTcgCard(card as JustTcgProviderCard);
  const name = normalizeForMatching(extracted.name);
  const candidateName = normalizeForMatching(candidate.name);
  if (name === candidateName) return 100;
  const words = name.split(" ").filter((word) => word.length > 2);
  const overlap = words.filter((word) => candidateName.split(" ").includes(word)).length;
  // Do not accept a weak name merely because a number was read correctly.
  return words.length > 0 && overlap / words.length >= 0.75 ? 90 : 0;
}

function collectorNumberMatches(extracted: string, candidate: string | null): boolean {
  if (!candidate) return false;
  if (extracted === candidate) return true;
  // A lone numeric OCR value is evidence only for the printed numerator, never
  // a fuzzy substring. "58" can corroborate "58/102", but not "158/102".
  return /^\d+$/.test(extracted) && candidate.split("/")[0] === extracted;
}

function hasAutomaticMatchEvidence(
  card: Record<string, unknown>,
  extracted: ExtractedCardInfo,
): boolean {
  const candidate = normalizeJustTcgCard(card as JustTcgProviderCard);
  const number = normalizeCollectorNumber(extracted.number);
  const setText = normalizeForMatching(extracted.setName);
  const candidateSet = candidate.setName ? normalizeForMatching(candidate.setName) : "";
  const setCode = normalizeSetCode(extracted.setName);
  return Boolean(
    number &&
    candidate.collectorNumber === number &&
    setText &&
    (candidateSet === setText || (setCode !== null && candidate.setCode === setCode)),
  );
}

export function recognitionEvidenceStatus(extracted: ExtractedCardInfo): Exclude<RecognitionStatus, "matched" | "ambiguous" | "no_canonical_match"> | null {
  const unreadable = !extracted.name && !extracted.setName && !extracted.number && !extracted.game;
  if (unreadable) return "unreadable";
  const mobileGame = mobileGameId(providerGameSlug(extracted.game));
  if (extracted.game && !mobileGame) return "unsupported";
  if (!mobileGame || !extracted.name || !normalizeCollectorNumber(extracted.number)) return "insufficient_evidence";
  return null;
}

export function rankEvidenceMatches(
  catalogResults: Array<Record<string, unknown>>,
  extracted: ExtractedCardInfo,
): { candidates: Array<{ card: Record<string, unknown>; confidence: number }>; ambiguous: boolean } {
  const providerGame = providerGameSlug(extracted.game);
  const collectorNumber = normalizeCollectorNumber(extracted.number);
  const setText = normalizeForMatching(extracted.setName);
  const setCode = normalizeSetCode(extracted.setName);
  if (!mobileGameId(providerGame) || !extracted.name || !collectorNumber) {
    return { candidates: [], ambiguous: false };
  }
  const candidates = catalogResults
    .filter((card) => {
      const candidate = normalizeJustTcgCard(card as JustTcgProviderCard);
      const candidateSet = candidate.setName ? normalizeForMatching(candidate.setName) : "";
      return candidate.gameSlug === providerGame &&
        collectorNumberMatches(collectorNumber, candidate.collectorNumber) &&
        // A supplied set is mandatory evidence; absent set evidence must not be
        // replaced with a guess from a similarly named card.
        (!setText || candidateSet === setText || (setCode !== null && candidate.setCode === setCode));
    })
    .map((card) => ({ card, confidence: scoreMatch(card, extracted) }))
    .filter((candidate) => candidate.confidence >= 90)
    .sort((a, b) => b.confidence - a.confidence || String(a.card.id).localeCompare(String(b.card.id)));
  // Partial evidence is useful for user confirmation, never automatic identity.
  // Provider result limits/pagination cannot prove that a numerator-only or
  // set-less candidate is globally unique.
  return {
    candidates,
    ambiguous: candidates.length > 1 ||
      (candidates.length === 1 && !hasAutomaticMatchEvidence(candidates[0]!.card, extracted)),
  };
}

/**
 * Ranks candidates that are useful for a collector to confirm when the image
 * does not contain enough independent evidence for an automatic match.
 *
 * This deliberately has a separate contract from `rankEvidenceMatches`: it
 * never drives `topMatch`, never claims a canonical identity, and refuses a
 * supplied game/set/number that contradicts the returned card.  It exists so
 * a clearly-read name such as "Grookey" can lead to a manual picker instead
 * of an unhelpful empty failure state.
 */
export function rankConfirmationCandidates(
  catalogResults: Array<Record<string, unknown>>,
  extracted: ExtractedCardInfo,
): Array<{ card: Record<string, unknown>; confidence: number }> {
  const name = normalizeForMatching(extracted.name);
  const providerGame = providerGameSlug(extracted.game);
  const collectorNumber = normalizeCollectorNumber(extracted.number);
  const setText = normalizeForMatching(extracted.setName);
  const setCode = normalizeSetCode(extracted.setName);

  // A set code or collector number without a readable name is too broad to
  // present as an apparently meaningful choice to the user.
  if (!name) return [];

  return catalogResults
    .map((card) => {
      const candidate = normalizeJustTcgCard(card as JustTcgProviderCard);
      const candidateName = normalizeForMatching(candidate.name);
      const candidateSet = candidate.setName ? normalizeForMatching(candidate.setName) : "";

      if (providerGame && candidate.gameSlug !== providerGame) return null;
      if (collectorNumber && !collectorNumberMatches(collectorNumber, candidate.collectorNumber)) return null;
      if (setText && candidateSet !== setText && (setCode === null || candidate.setCode !== setCode)) return null;

      let confidence = 0;
      if (candidateName === name) confidence = 75;
      else if (candidateName.includes(name) || name.includes(candidateName)) confidence = 65;
      else {
        const words = name.split(" ").filter(word => word.length > 2);
        const candidateWords = candidateName.split(" ");
        const overlap = words.filter(word => candidateWords.includes(word)).length;
        if (words.length > 0 && overlap / words.length >= 0.75) confidence = 55;
      }
      if (confidence === 0) return null;

      if (collectorNumber) confidence += 10;
      if (setText) confidence += 5;
      // Keep manual candidates visibly distinct from an automatic recognition.
      return { card, confidence: Math.min(confidence, 79) };
    })
    .filter((candidate): candidate is { card: Record<string, unknown>; confidence: number } => candidate !== null)
    .sort((a, b) => b.confidence - a.confidence || String(a.card.id).localeCompare(String(b.card.id)))
    .slice(0, 3);
}

/** True when durable catalogue evidence makes a network provider read unnecessary. */
export function hasPersistedRecognitionEvidence(
  catalogResults: Array<Record<string, unknown>>,
  extracted: ExtractedCardInfo,
): boolean {
  return rankEvidenceMatches(catalogResults, extracted).candidates.length > 0;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /scan/recognize
 *
 * Body: { image: string (base64), mimeType?: string }
 * Auth: Bearer JWT required
 */
router.post("/scan/recognize", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const attemptStartedAt = Date.now();

  // These are hoisted so the outer catch can include quota context in 500 errors
  // that occur after the scan slot has been reserved.
  let isFreeTier = false;
  let periodStart = currentPeriodStart();
  let reservedScanCount: number | undefined;
  let quotaReleased = false;
  let attemptRecorded = false;

  try {
    // 1. Parse and validate request body
    const { image, mimeType = "image/jpeg" } = req.body as {
      image?: string;
      mimeType?: string;
    };

    if (!image || typeof image !== "string") {
      res.status(400).json({ message: "image (base64 string) is required" });
      return;
    }

    let validatedImage: { base64: string; mimeType: string };
    try {
      validatedImage = validateImagePayload(image, mimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid image";
      res.status(message.includes("exceeds") ? 413 : 400).json({ message });
      return;
    }

    // 2. Get subscription tier
    const tier = await getUserTier(userId);
    isFreeTier = tier === "free";
    periodStart = currentPeriodStart();

    // 3. Atomically reserve a scan slot BEFORE calling the vision API.
    //    This prevents the vision API from being called when the user is over
    //    limit, and prevents race conditions where two concurrent requests both
    //    pass the same check.
    let newScanCount: number;

    if (isFreeTier) {
      // Pre-check: read current count so we can return a useful 403 before
      // attempting the atomic increment (avoids the useless INSERT path when
      // we already know the user is over limit).
      const currentCount = await readScanCount(userId, periodStart);
      if (currentCount >= FREE_SCAN_LIMIT) {
        res.status(403).json({
          message: "Monthly scan limit reached. Upgrade to Pro for unlimited scans.",
          scansUsed: currentCount,
          scanLimit: FREE_SCAN_LIMIT,
          scansRemaining: 0,
          periodStart: periodStart.toISOString(),
        });
        return;
      }

      // Atomically claim the slot (enforces the limit even under concurrency)
      const reserved = await atomicReserveScan(userId, periodStart, FREE_SCAN_LIMIT);
      if (reserved === null) {
        // Another concurrent request filled the last slot between our read and write
        res.status(403).json({
          message: "Monthly scan limit reached. Upgrade to Pro for unlimited scans.",
          scansUsed: FREE_SCAN_LIMIT,
          scanLimit: FREE_SCAN_LIMIT,
          scansRemaining: 0,
          periodStart: periodStart.toISOString(),
        });
        return;
      }

      newScanCount = reserved;
    } else {
      // Pro users — record the scan but don't enforce any limit
      newScanCount = await atomicRecordProScan(userId, periodStart);
    }

    // Expose to outer catch so it can include quota data on unexpected errors
    reservedScanCount = newScanCount;

    // 4. Call vision API. A slot is reserved to prevent concurrent overspend,
    //    then atomically released if the recognition service is unavailable.
    let extracted: ExtractedCardInfo;
    try {
      extracted = await extractCardInfo(validatedImage.base64, validatedImage.mimeType);
    } catch (err) {
      // Log the full error server-side; only return a sanitized message to the client.
      logger.error({ err, userId }, "Scan vision request failed");
      const releasedCount = await atomicReleaseScan(userId, periodStart);
      reservedScanCount = releasedCount;
      quotaReleased = true;
      await db.insert(scanAttemptsTable).values({
        userId,
        status: "failed",
        durationMs: Date.now() - attemptStartedAt,
        model: RECOGNITION_MODEL,
        errorCode: "recognition_service_unavailable",
        reviewStatus: "pending",
      });
      attemptRecorded = true;
      res.status(503).json({
        message: "Card recognition service is temporarily unavailable. Please try searching manually.",
        // Service failures are not completed recognitions and are refunded.
        scansUsed: releasedCount,
        scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
        scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - releasedCount) : null,
        periodStart: periodStart.toISOString(),
        countsTowardLimit: false,
      });
      return;
    }

    // A match is never inferred from a name alone. A readable card must supply
    // game, set, and collector number before it can be opened automatically.
    // Partial OCR may still produce confirmation candidates for the collector.
    const evidenceStatus = recognitionEvidenceStatus(extracted);
    const imageUnreadable = evidenceStatus === "unreadable";
    const unsupported = evidenceStatus === "unsupported";
    const weakEvidence = evidenceStatus === "insufficient_evidence";

    let catalogResults: Array<Record<string, unknown>> = [];
    if (!imageUnreadable && !unsupported) {
      // A verified local match is sufficient and must stay available if
      // JustTCG is slow or unavailable.
      if (!weakEvidence) catalogResults = await searchPersistedCatalogue(extracted);
      if (!hasPersistedRecognitionEvidence(catalogResults, extracted)) {
        try {
          catalogResults = await searchCatalog(extracted);
        } catch (error) {
          if (error instanceof CatalogueRecognitionError) {
            const releasedCount = await atomicReleaseScan(userId, periodStart);
            reservedScanCount = releasedCount;
            quotaReleased = true;
            await db.insert(scanAttemptsTable).values({
              userId, status: "failed", extractedName: extracted.name || null,
              extractedSet: extracted.setName || null, extractedNumber: extracted.number || null,
              durationMs: Date.now() - attemptStartedAt, model: RECOGNITION_MODEL,
              errorCode: "catalogue_service_unavailable", reviewStatus: "pending",
            });
            attemptRecorded = true;
            res.status(503).json({
              message: "Card catalogue is temporarily unavailable. Please try again or search manually.",
              scansUsed: releasedCount, scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
              scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - releasedCount) : null,
              periodStart: periodStart.toISOString(),
              countsTowardLimit: false,
            });
            return;
          }
          throw error;
        }
      }
    }

    // Exact collector number and set evidence are mandatory. Name comparison is
    // only a tie-breaker/fuzzy confirmation after this canonical filter.
    const ranked = rankEvidenceMatches(catalogResults, extracted);
    const plausibleMatches = ranked.candidates;
    const topMatch = plausibleMatches[0];
    // Multiple canonical records with the same game/set/number can represent
    // variants. Do not guess which variant the photograph shows.
    const ambiguous = ranked.ambiguous;
    const hasMatch = Boolean(topMatch) && !ambiguous;
    const confirmationCandidates = !hasMatch && !imageUnreadable && !unsupported
      ? rankConfirmationCandidates(catalogResults, extracted)
      : [];
    const matches = hasMatch
      ? plausibleMatches.slice(0, 1)
      : ambiguous
        ? plausibleMatches.slice(0, 3)
        : confirmationCandidates;
    const scansRemaining = isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - newScanCount) : null;

    // 8. Persist only sanitized operational facts. Source photos and raw OCR
    //    text are intentionally excluded from the database.
    const operationalStatus = imageUnreadable
      ? "unreadable"
      : weakEvidence || unsupported || ambiguous || !hasMatch
        ? "unmatched"
        : "matched";
    await db.insert(scanAttemptsTable).values({
      userId,
      status: operationalStatus,
      extractedName: extracted.name.slice(0, 200) || null,
      extractedSet: extracted.setName.slice(0, 200) || null,
      extractedNumber: extracted.number.slice(0, 80) || null,
       topMatchCardId: hasMatch ? String(topMatch!.card.id ?? "").slice(0, 300) || null : null,
       topMatchName: hasMatch ? String(topMatch!.card.name ?? "").slice(0, 200) || null : null,
       topMatchConfidence: hasMatch ? topMatch!.confidence : null,
       candidateSummary: plausibleMatches.slice(0, 3).map(({ card, confidence }) => ({
        cardId: String(card.id ?? "").slice(0, 300),
        name: String(card.name ?? "").slice(0, 200),
        set: String(card.set_name ?? card.set ?? "").slice(0, 200),
        number: String(card.number ?? "").slice(0, 80),
        confidence,
      })),
      model: RECOGNITION_MODEL,
      durationMs: Date.now() - attemptStartedAt,
      reviewStatus: operationalStatus === "matched" ? "not_required" : "pending",
    });
    attemptRecorded = true;

    // 9. Return results
    res.json({
      extracted: {
        game: extracted.game,
        name: extracted.name,
        setName: extracted.setName,
        number: extracted.number,
      },
      matches: matches.map(({ card, confidence }) => ({ card, confidence })),
      topMatch: hasMatch ? { card: topMatch!.card, confidence: topMatch!.confidence } : null,
      lowConfidence: ambiguous || confirmationCandidates.length > 0,
      // imageUnreadable = true means GPT returned no text at all — the image
      // was likely blurry, too dark, or the card was partially out of frame.
      // Clients should show a more specific message than "no match found".
      imageUnreadable,
      recognitionStatus: imageUnreadable
        ? "unreadable"
        : unsupported
          ? "unsupported"
          : weakEvidence
          ? "insufficient_evidence"
          : ambiguous
            ? "ambiguous"
            : hasMatch ? "matched" : "no_canonical_match",
      countsTowardLimit: true,
      scansUsed: newScanCount,
      scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
      scansRemaining,
      periodStart: periodStart.toISOString(),
    });
  } catch (err) {
    // A failed post-reservation request is not a completed recognition. Refund
    // its slot before reporting usage; the decrement is atomic with other scans.
    if (reservedScanCount !== undefined && !quotaReleased) {
      try {
        reservedScanCount = await atomicReleaseScan(userId, periodStart);
        quotaReleased = true;
      } catch (releaseError) {
        logger.error({ err: releaseError, userId }, "Failed to release scan quota reservation");
      }
    }
    const quotaPayload = reservedScanCount !== undefined
      ? {
          scansUsed: reservedScanCount,
          scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
          scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - reservedScanCount) : null,
          periodStart: periodStart.toISOString(),
        }
      : {};

    // Log full error server-side; return only a sanitized message to the client.
    logger.error({ err, userId }, "Unexpected scan recognition failure");
    if (reservedScanCount !== undefined && !attemptRecorded) {
      await db.insert(scanAttemptsTable).values({
        userId,
        status: "failed",
        durationMs: Date.now() - attemptStartedAt,
        model: RECOGNITION_MODEL,
        errorCode: "unexpected_processing_failure",
        reviewStatus: "pending",
      }).catch((recordError: unknown) => {
        logger.error({ err: recordError, userId }, "Failed to persist scan failure");
      });
    }
    res.status(500).json({
      message: "Something went wrong during card recognition. Please try again.",
      countsTowardLimit: false,
      ...quotaPayload,
    });
  }
});

/**
 * GET /scan/usage
 * Returns current-period scan count for the authenticated user.
 */
router.get("/scan/usage", requireActiveUser, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const tier = await getUserTier(userId);
    const isFreeTier = tier === "free";
    const periodStart = currentPeriodStart();
    const scansUsed = await readScanCount(userId, periodStart);

    res.json({
      scansUsed,
      scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
      scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - scansUsed) : null,
      periodStart: periodStart.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch scan usage" });
  }
});

export default router;
