/**
 * JustTCG primary raw-pricing adapter.
 *
 * The card catalogue and raw-card market value come from the same provider,
 * so a JustTCG legacy card id can be used directly without a lossy cross-
 * provider product match. JustTCG v2 can additionally provide exact
 * company-and-grade slab quotes when explicitly enabled server-side. v2 is a
 * beta API, so PriceCharting remains the safe fallback until each graded
 * record has a real JustTCG v2 quote.
 */
import { db, cardPriceSnapshotsTable, currentQuotesTable, providerPriceHistoryTable } from "@workspace/db";
import type { GradeKey } from "./grades.js";
import { justTcgV2 } from "../lib/catalogueProvider.js";

export const JUSTTCG_PRICING_PROVIDER_KEY = "justtcg";
export const JUSTTCG_PRICING_PROVIDER_LABEL = "JustTCG";
export const JUSTTCG_DEFAULT_CURRENCY = "USD";

type JustTcgVariant = Record<string, unknown>;
type JustTcgCard = Record<string, unknown>;

export interface JustTcgRawQuote {
  cardId: string;
  providerProductId: string | null;
  priceCents: number;
  currency: string;
  fetchedAt: Date;
  history: Array<{ snapshotDate: string; priceCents: number; recordedAt: Date }>;
}

export interface JustTcgGradedQuote extends JustTcgRawQuote {
  gradeKey: GradeKey;
}

function positiveMoneyCents(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const cents = Math.round(number * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function asTimestamp(value: unknown, fallback: Date): Date {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toGradeNumber(value: unknown): number | null {
  const grade = typeof value === "number" ? value : Number(value);
  return Number.isFinite(grade) ? grade : null;
}

/**
 * Map only exact company-specific JustTCG v2 grades into existing canonical
 * grade keys. Generic grade keys intentionally do not stand in for PSA/BGS/
 * CGC/etc. and unsupported slabs remain unpriced instead of being guessed.
 */
export function gradeKeyFromJustTcgGrading(value: unknown): GradeKey | null {
  if (!value || typeof value !== "object") return null;
  const grading = value as Record<string, unknown>;
  const company = text(grading.company).toUpperCase();
  const grade = toGradeNumber(grading.grade);
  const descriptors = [grading.canonical, grading.grade_label, grading.qualifier]
    .map(text)
    .join(" ")
    .toLowerCase();
  if (grade !== 10) return null;
  if (company === "PSA") return "psa_10";
  if (company === "BGS" || company === "BECKETT") {
    return descriptors.includes("black label") ? "bgs_black_label_10" : "bgs_10";
  }
  if (company === "CGC") {
    return descriptors.includes("pristine") ? "cgc_pristine_10" : "cgc_10";
  }
  if (company === "SGC") return "sgc_10";
  if (company === "TAG") return "tag_10";
  if (company === "ACE") return "ace_10";
  return null;
}

function selectRawVariant(value: unknown): JustTcgVariant | null {
  if (!Array.isArray(value)) return null;
  const variants = value.filter((variant): variant is JustTcgVariant =>
    Boolean(variant) && typeof variant === "object" && positiveMoneyCents((variant as JustTcgVariant).price) !== null,
  );
  return variants.find(variant =>
    String(variant.condition ?? "").trim().toLowerCase() === "near mint"
    && ["", "normal"].includes(String(variant.printing ?? "").trim().toLowerCase()),
  ) ?? variants.find(variant => String(variant.condition ?? "").trim().toLowerCase() === "near mint")
    ?? variants[0]
    ?? null;
}

function variantCurrency(variant: JustTcgVariant, card: JustTcgCard): string {
  const markets = Array.isArray(variant.markets) ? variant.markets : [];
  const marketCurrency = markets.find((market): market is Record<string, unknown> =>
    Boolean(market) && typeof market === "object" && typeof (market as Record<string, unknown>).currency === "string",
  )?.currency;
  const currency = marketCurrency ?? variant.currency ?? card.currency ?? JUSTTCG_DEFAULT_CURRENCY;
  return typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim())
    ? currency.trim().toUpperCase()
    : JUSTTCG_DEFAULT_CURRENCY;
}

function marketForNorthAmerica(variant: JustTcgVariant): Record<string, unknown> | null {
  if (!Array.isArray(variant.markets)) return null;
  return variant.markets.find((market): market is Record<string, unknown> =>
    Boolean(market) &&
      typeof market === "object" &&
      text((market as Record<string, unknown>).region).toUpperCase() === "NA" &&
      positiveMoneyCents((market as Record<string, unknown>).price) !== null,
  ) ?? null;
}

function v2History(market: Record<string, unknown>, fallback: Date): JustTcgRawQuote["history"] {
  const entries = Array.isArray(market.price_history)
    ? market.price_history
    : Array.isArray(market.priceHistory)
      ? market.priceHistory
      : [];
  return entries.flatMap((point): JustTcgRawQuote["history"] => {
    if (!point || typeof point !== "object") return [];
    const record = point as Record<string, unknown>;
    const priceCents = positiveMoneyCents(record.p ?? record.price);
    const recordedAt = asTimestamp(record.t ?? record.timestamp, fallback);
    return priceCents === null ? [] : [{
      snapshotDate: recordedAt.toISOString().slice(0, 10),
      priceCents,
      recordedAt,
    }];
  });
}

/** Extract only an explicit Near Mint/raw JustTCG quote; missing is null, never $0. */
export function extractJustTcgRawQuote(card: JustTcgCard, fetchedAt = new Date()): JustTcgRawQuote | null {
  const cardId = typeof card.id === "string" ? card.id.trim() : "";
  if (!cardId) return null;
  const variant = selectRawVariant(card.variants);
  if (!variant) return null;
  const priceCents = positiveMoneyCents(variant.price);
  if (priceCents === null) return null;
  const providerProductId = typeof card.uuid === "string" && card.uuid.trim()
    ? card.uuid.trim()
    : cardId;
  const history = (Array.isArray(variant.priceHistory) ? variant.priceHistory : [])
    .flatMap((point): Array<{ snapshotDate: string; priceCents: number; recordedAt: Date }> => {
      if (!point || typeof point !== "object") return [];
      const record = point as Record<string, unknown>;
      const historicalCents = positiveMoneyCents(record.p ?? record.price);
      const recordedAt = asTimestamp(record.t ?? record.timestamp, fetchedAt);
      return historicalCents === null ? [] : [{
        snapshotDate: recordedAt.toISOString().slice(0, 10),
        priceCents: historicalCents,
        recordedAt,
      }];
    });
  return {
    cardId,
    providerProductId,
    priceCents,
    currency: variantCurrency(variant, card),
    fetchedAt: asTimestamp(variant.lastUpdated, fetchedAt),
    history,
  };
}

/**
 * Extract exact v2 graded quotes for the requested legacy card id. A card
 * response must identify itself by that slug (or exact UUID request) and
 * ambiguous duplicate variants for the same grade are rejected rather than
 * silently selecting a different printing or language.
 */
export function extractJustTcgGradedQuotes(
  card: JustTcgCard,
  requestedCardId: string,
  fetchedAt = new Date(),
): JustTcgGradedQuote[] {
  const expected = requestedCardId.trim();
  const cardId = text(card.slug) === expected || text(card.id) === expected ? expected : "";
  if (!cardId || !Array.isArray(card.variants)) return [];
  const providerProductId = text(card.id) || text(card.slug) || cardId;
  const candidates = new Map<GradeKey, JustTcgGradedQuote[]>();
  for (const value of card.variants) {
    if (!value || typeof value !== "object") continue;
    const variant = value as JustTcgVariant;
    if (text(variant.type).toLowerCase() !== "graded") continue;
    const gradeKey = gradeKeyFromJustTcgGrading(variant.grading);
    const market = marketForNorthAmerica(variant);
    if (!gradeKey || !market) continue;
    const priceCents = positiveMoneyCents(market.price);
    if (priceCents === null) continue;
    const quote: JustTcgGradedQuote = {
      cardId,
      providerProductId,
      gradeKey,
      priceCents,
      currency: variantCurrency({ ...variant, markets: [market] }, card),
      fetchedAt: asTimestamp(market.updated_at ?? market.updatedAt, fetchedAt),
      history: v2History(market, fetchedAt),
    };
    candidates.set(gradeKey, [...(candidates.get(gradeKey) ?? []), quote]);
  }
  return [...candidates.values()]
    .flatMap((quotes) => quotes.length === 1 ? quotes : []);
}

function snapshotBucketFor(date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `${day}:${date.getUTCHours() < 12 ? "AM" : "PM"}`;
}

/**
 * Persist a real JustTCG raw quote and its provider-supplied history. This
 * accepts data only after an authenticated server-side JustTCG response.
 */
export async function persistJustTcgRawQuote(card: JustTcgCard, fetchedAt = new Date()): Promise<JustTcgRawQuote | null> {
  const quote = extractJustTcgRawQuote(card, fetchedAt);
  if (!quote) return null;
  const snapshotDate = quote.fetchedAt.toISOString().slice(0, 10);
  await db.transaction(async tx => {
    await tx.insert(currentQuotesTable).values({
      cardId: quote.cardId,
      providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
      gradeKey: "raw",
      priceCents: quote.priceCents,
      currency: quote.currency,
      fetchedAt: quote.fetchedAt,
      providerProductId: quote.providerProductId,
    }).onConflictDoUpdate({
      target: [currentQuotesTable.cardId, currentQuotesTable.providerKey, currentQuotesTable.gradeKey],
      set: {
        priceCents: quote.priceCents,
        currency: quote.currency,
        fetchedAt: quote.fetchedAt,
        providerProductId: quote.providerProductId,
        updatedAt: quote.fetchedAt,
      },
    });
    const history = [
      ...quote.history,
      { snapshotDate, priceCents: quote.priceCents, recordedAt: quote.fetchedAt },
    ];
    for (const point of history) {
      await tx.insert(providerPriceHistoryTable).values({
        cardId: quote.cardId,
        providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
        gradeKey: "raw",
        priceCents: point.priceCents,
        currency: quote.currency,
        snapshotDate: point.snapshotDate,
        recordedAt: point.recordedAt,
      }).onConflictDoUpdate({
        target: [
          providerPriceHistoryTable.cardId,
          providerPriceHistoryTable.providerKey,
          providerPriceHistoryTable.gradeKey,
          providerPriceHistoryTable.snapshotDate,
        ],
        set: { priceCents: point.priceCents, currency: quote.currency, recordedAt: point.recordedAt },
      });
    }
    await tx.insert(cardPriceSnapshotsTable).values({
      cardId: quote.cardId,
      providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
      providerProductId: quote.providerProductId,
      gradeKey: "raw",
      priceCents: quote.priceCents,
      currency: quote.currency,
      capturedAt: quote.fetchedAt,
      snapshotBucket: snapshotBucketFor(quote.fetchedAt),
      captureStatus: "success",
    }).onConflictDoUpdate({
      target: [
        cardPriceSnapshotsTable.cardId,
        cardPriceSnapshotsTable.providerKey,
        cardPriceSnapshotsTable.gradeKey,
        cardPriceSnapshotsTable.snapshotBucket,
      ],
      set: {
        providerProductId: quote.providerProductId,
        priceCents: quote.priceCents,
        currency: quote.currency,
        capturedAt: quote.fetchedAt,
        captureStatus: "success",
        failureCode: null,
      },
    });
  });
  return quote;
}

async function persistJustTcgQuote(quote: JustTcgGradedQuote): Promise<void> {
  const snapshotDate = quote.fetchedAt.toISOString().slice(0, 10);
  await db.transaction(async tx => {
    await tx.insert(currentQuotesTable).values({
      cardId: quote.cardId,
      providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
      gradeKey: quote.gradeKey,
      priceCents: quote.priceCents,
      currency: quote.currency,
      fetchedAt: quote.fetchedAt,
      providerProductId: quote.providerProductId,
    }).onConflictDoUpdate({
      target: [currentQuotesTable.cardId, currentQuotesTable.providerKey, currentQuotesTable.gradeKey],
      set: {
        priceCents: quote.priceCents,
        currency: quote.currency,
        fetchedAt: quote.fetchedAt,
        providerProductId: quote.providerProductId,
        updatedAt: quote.fetchedAt,
      },
    });
    for (const point of [...quote.history, { snapshotDate, priceCents: quote.priceCents, recordedAt: quote.fetchedAt }]) {
      await tx.insert(providerPriceHistoryTable).values({
        cardId: quote.cardId,
        providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
        gradeKey: quote.gradeKey,
        priceCents: point.priceCents,
        currency: quote.currency,
        snapshotDate: point.snapshotDate,
        recordedAt: point.recordedAt,
      }).onConflictDoUpdate({
        target: [
          providerPriceHistoryTable.cardId,
          providerPriceHistoryTable.providerKey,
          providerPriceHistoryTable.gradeKey,
          providerPriceHistoryTable.snapshotDate,
        ],
        set: { priceCents: point.priceCents, currency: quote.currency, recordedAt: point.recordedAt },
      });
    }
    await tx.insert(cardPriceSnapshotsTable).values({
      cardId: quote.cardId,
      providerKey: JUSTTCG_PRICING_PROVIDER_KEY,
      providerProductId: quote.providerProductId,
      gradeKey: quote.gradeKey,
      priceCents: quote.priceCents,
      currency: quote.currency,
      capturedAt: quote.fetchedAt,
      snapshotBucket: snapshotBucketFor(quote.fetchedAt),
      captureStatus: "success",
    }).onConflictDoUpdate({
      target: [
        cardPriceSnapshotsTable.cardId,
        cardPriceSnapshotsTable.providerKey,
        cardPriceSnapshotsTable.gradeKey,
        cardPriceSnapshotsTable.snapshotBucket,
      ],
      set: {
        providerProductId: quote.providerProductId,
        priceCents: quote.priceCents,
        currency: quote.currency,
        capturedAt: quote.fetchedAt,
        captureStatus: "success",
        failureCode: null,
      },
    });
  });
}

/**
 * Fetch and persist exact JustTCG v2 graded prices for one existing v1 card
 * identity. The v2 response is beta and no caller ever receives its raw body.
 */
export async function refreshJustTcgGradedQuotes(cardId: string): Promise<number> {
  if (!isJustTcgGradedPricingEnabled()) return 0;
  const params = new URLSearchParams({
    card_id: cardId,
    graded: "only",
    regions: "NA",
    include: "price_history.30d",
  });
  const result = await justTcgV2(`/cards?${params.toString()}`);
  if (result.status >= 400) return 0;
  const body = result.body as { data?: Array<Record<string, unknown>> } | null;
  const card = body?.data?.find(candidate =>
    text(candidate.slug) === cardId || text(candidate.id) === cardId,
  );
  if (!card) return 0;
  const quotes = extractJustTcgGradedQuotes(card, cardId);
  await Promise.all(quotes.map((quote) => persistJustTcgQuote(quote)));
  return quotes.length;
}

/** JustTCG v2 graded pricing is beta and remains kill-switch controlled. */
export function isJustTcgGradedPricingEnabled(): boolean {
  return process.env.JUSTTCG_GRADED_PRICING_ENABLED?.trim().toLowerCase() === "true";
}

/** Exact raw prices always prefer JustTCG; exact v2 grade prices do so only when enabled. */
export function preferredProviderKeyForGrade(
  gradeKey: string,
  options: { justTcgGradedPricingEnabled?: boolean } = {},
): string {
  const gradedEnabled = options.justTcgGradedPricingEnabled ?? isJustTcgGradedPricingEnabled();
  return gradeKey === "raw" || gradedEnabled
    ? JUSTTCG_PRICING_PROVIDER_KEY
    : "pricecharting";
}

export function selectPreferredQuote<T extends { providerKey: string; gradeKey: string }>(
  quotes: readonly T[],
  gradeKey: string,
  options: { justTcgGradedPricingEnabled?: boolean } = {},
): T | null {
  const preferred = preferredProviderKeyForGrade(gradeKey, options);
  return quotes.find(quote => quote.gradeKey === gradeKey && quote.providerKey === preferred)
    ?? quotes.find(quote => quote.gradeKey === gradeKey && quote.providerKey === "pricecharting")
    ?? null;
}
