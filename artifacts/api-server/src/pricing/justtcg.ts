/**
 * JustTCG primary raw-pricing adapter.
 *
 * The card catalogue and raw-card market value come from the same provider,
 * so a JustTCG legacy card id can be used directly without a lossy cross-
 * provider product match. PriceCharting remains a supplementary source for
 * company-specific graded quotes; it is never needed to make an exact raw
 * JustTCG quote usable.
 */
import { db, cardPriceSnapshotsTable, currentQuotesTable, providerPriceHistoryTable } from "@workspace/db";

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

/** Exact raw values prefer JustTCG; company-specific grades remain PriceCharting-only. */
export function preferredProviderKeyForGrade(gradeKey: string): string {
  return gradeKey === "raw" ? JUSTTCG_PRICING_PROVIDER_KEY : "pricecharting";
}

export function selectPreferredQuote<T extends { providerKey: string; gradeKey: string }>(
  quotes: readonly T[],
  gradeKey: string,
): T | null {
  const preferred = preferredProviderKeyForGrade(gradeKey);
  return quotes.find(quote => quote.gradeKey === gradeKey && quote.providerKey === preferred)
    ?? quotes.find(quote => quote.gradeKey === gradeKey && quote.providerKey === "pricecharting")
    ?? null;
}
