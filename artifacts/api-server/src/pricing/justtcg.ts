/**
 * Server-side JustTCG raw-price persistence.
 *
 * A catalogue card's JustTCG id is already its public identity, so raw market
 * data can be recorded without guessing a cross-provider product match. The
 * adapter intentionally accepts only positive, explicitly supplied values.
 */
import { db, cardPriceSnapshotsTable, currentQuotesTable, providerPriceHistoryTable } from "@workspace/db";

export const JUSTTCG_PRICING_PROVIDER_KEY = "justtcg";
export const JUSTTCG_PRICING_PROVIDER_LABEL = "JustTCG";
export const JUSTTCG_DEFAULT_CURRENCY = "USD";

type RecordValue = Record<string, unknown>;

export interface JustTcgRawQuote {
  cardId: string;
  providerProductId: string | null;
  priceCents: number;
  currency: string;
  fetchedAt: Date;
  history: Array<{ snapshotDate: string; priceCents: number; recordedAt: Date }>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveCents(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function timestamp(value: unknown, fallback: Date): Date {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  const date = new Date(raw * 1000);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function currencyFor(variant: RecordValue, card: RecordValue): string {
  const markets = Array.isArray(variant.markets) ? variant.markets : [];
  const market = markets.find((value): value is RecordValue => Boolean(value) && typeof value === "object");
  const currency = text(market?.currency ?? variant.currency ?? card.currency);
  return /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : JUSTTCG_DEFAULT_CURRENCY;
}

function rawVariant(card: RecordValue): RecordValue | null {
  const variants = Array.isArray(card.variants)
    ? card.variants.filter((value): value is RecordValue => Boolean(value) && typeof value === "object")
    : [];
  const priced = variants.filter(variant => positiveCents(variant.price) !== null);
  return priced.find(variant => text(variant.condition).toLowerCase() === "near mint" && ["", "normal"].includes(text(variant.printing).toLowerCase()))
    ?? priced.find(variant => text(variant.condition).toLowerCase() === "near mint")
    ?? priced[0]
    ?? null;
}

export function extractJustTcgRawQuote(card: RecordValue, fetchedAt = new Date()): JustTcgRawQuote | null {
  const cardId = text(card.id);
  const variant = rawVariant(card);
  if (!cardId || !variant) return null;
  const priceCents = positiveCents(variant.price);
  if (priceCents === null) return null;
  const observedAt = timestamp(variant.lastUpdated, fetchedAt);
  const historyEntries = Array.isArray(variant.priceHistory) ? variant.priceHistory : [];
  const history = historyEntries.flatMap((entry): JustTcgRawQuote["history"] => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as RecordValue;
    const historicalCents = positiveCents(value.p ?? value.price);
    if (historicalCents === null) return [];
    const recordedAt = timestamp(value.t ?? value.timestamp, observedAt);
    return [{ snapshotDate: recordedAt.toISOString().slice(0, 10), priceCents: historicalCents, recordedAt }];
  });
  return {
    cardId,
    providerProductId: text(card.uuid) || cardId,
    priceCents,
    currency: currencyFor(variant, card),
    fetchedAt: observedAt,
    history,
  };
}

function snapshotBucketFor(date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `${day}:${date.getUTCHours() < 12 ? "AM" : "PM"}`;
}

/** Persist genuine provider history; never create a zero or synthetic point. */
export async function persistJustTcgRawQuote(card: RecordValue, fetchedAt = new Date()): Promise<JustTcgRawQuote | null> {
  const quote = extractJustTcgRawQuote(card, fetchedAt);
  if (!quote) return null;
  const snapshotDate = quote.fetchedAt.toISOString().slice(0, 10);
  await db.transaction(async tx => {
    await tx.insert(currentQuotesTable).values({
      cardId: quote.cardId, providerKey: JUSTTCG_PRICING_PROVIDER_KEY, gradeKey: "raw",
      priceCents: quote.priceCents, currency: quote.currency, fetchedAt: quote.fetchedAt,
      providerProductId: quote.providerProductId,
    }).onConflictDoUpdate({
      target: [currentQuotesTable.cardId, currentQuotesTable.providerKey, currentQuotesTable.gradeKey],
      set: { priceCents: quote.priceCents, currency: quote.currency, fetchedAt: quote.fetchedAt, providerProductId: quote.providerProductId, updatedAt: quote.fetchedAt },
    });
    for (const point of [...quote.history, { snapshotDate, priceCents: quote.priceCents, recordedAt: quote.fetchedAt }]) {
      await tx.insert(providerPriceHistoryTable).values({
        cardId: quote.cardId, providerKey: JUSTTCG_PRICING_PROVIDER_KEY, gradeKey: "raw",
        priceCents: point.priceCents, currency: quote.currency, snapshotDate: point.snapshotDate, recordedAt: point.recordedAt,
      }).onConflictDoUpdate({
        target: [providerPriceHistoryTable.cardId, providerPriceHistoryTable.providerKey, providerPriceHistoryTable.gradeKey, providerPriceHistoryTable.snapshotDate],
        set: { priceCents: point.priceCents, currency: quote.currency, recordedAt: point.recordedAt },
      });
    }
    await tx.insert(cardPriceSnapshotsTable).values({
      cardId: quote.cardId, providerKey: JUSTTCG_PRICING_PROVIDER_KEY, providerProductId: quote.providerProductId,
      gradeKey: "raw", priceCents: quote.priceCents, currency: quote.currency, capturedAt: quote.fetchedAt,
      snapshotBucket: snapshotBucketFor(quote.fetchedAt), captureStatus: "success",
    }).onConflictDoUpdate({
      target: [cardPriceSnapshotsTable.cardId, cardPriceSnapshotsTable.providerKey, cardPriceSnapshotsTable.gradeKey, cardPriceSnapshotsTable.snapshotBucket],
      set: { providerProductId: quote.providerProductId, priceCents: quote.priceCents, currency: quote.currency, capturedAt: quote.fetchedAt, captureStatus: "success", failureCode: null },
    });
  });
  return quote;
}
