import { db } from "@workspace/db";
import {
  collectionItemsTable,
  currentQuotesTable,
  providerPriceHistoryTable,
  cardPriceSnapshotsTable,
  portfolioSnapshotsTable,
  soldArchiveItemsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { convertCents } from "./fx.js";
import { normalizeGradeKey } from "./grades.js";
import type { GradeKey } from "./grades.js";
import { PROVIDER_KEY } from "./pricecharting.js";

const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

type CollectionRow = typeof collectionItemsTable.$inferSelect;
type QuoteRow = typeof currentQuotesTable.$inferSelect;

export interface HoldingValuation {
  row: CollectionRow;
  gradeKey: GradeKey | null;
  quote: QuoteRow | null;
  currentValueCents: number | null;
  costBasisCents: number | null;
  unrealizedGainCents: number | null;
  isStale: boolean;
}

export interface PortfolioValuation {
  currency: string;
  holdings: HoldingValuation[];
  cardCount: number;
  uniqueCardCount: number;
  totalHoldings: number;
  pricedHoldings: number;
  freshHoldings: number;
  staleHoldings: number;
  totalValueCents: number | null;
  totalCostCents: number | null;
  unrealizedGainCents: number | null;
  unrealizedGainPercent: number | null;
  valuationComplete: boolean;
  costBasisComplete: boolean;
}

export interface PortfolioValueHistoryPoint {
  date: string;
  valueCents: number;
  value: number;
  currency: string;
  pricedHoldings: number;
  totalHoldings: number;
}

export interface PortfolioValueHistory {
  points: PortfolioValueHistoryPoint[];
  currency: string;
  historyAvailable: boolean;
  historyUnavailableReason: string | null;
}

const PORTFOLIO_HISTORY_RANGES: Record<string, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "ALL": 36_500,
};

function isoDateDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function rowDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = value.slice(0, 10);
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

/**
 * Build a historical market-value series for the cards and quantities in the
 * collector's current collection. A point is emitted only when every current
 * holding has a known price on that date; this prevents changing price coverage
 * from looking like market performance.
 *
 * The daily provider history is preferred because it is the canonical,
 * deduplicated history. Timestamped snapshots fill gaps for older captures.
 * The current quote is used only for today's point, never to backfill the
 * past.
 */
export async function calculatePortfolioValueHistory(
  userId: string,
  periodDays = PORTFOLIO_HISTORY_RANGES.ALL!,
  displayCurrency = "AUD",
): Promise<PortfolioValueHistory> {
  const currency = displayCurrency.trim().toUpperCase();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // This series answers “what would the cards currently in my collection have
  // been worth?”. It intentionally uses today's active holdings and quantities
  // across the full requested market-history range, including observations
  // before acquisition. Ownership-period P&L remains a separate calculation.
  const rows = await db
    .select()
    .from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, userId));

  if (rows.length === 0) {
    return {
      points: [],
      currency,
      historyAvailable: false,
      historyUnavailableReason: "No items in collection",
    };
  }

  const cardIds = [...new Set(rows.map(row => row.cardId))];
  const [quoteRows, dailyRows, timestampedRows] = await Promise.all([
    db
      .select()
      .from(currentQuotesTable)
      .where(and(
        eq(currentQuotesTable.providerKey, PROVIDER_KEY),
        inArray(currentQuotesTable.cardId, cardIds),
      )),
    db
      .select()
      .from(providerPriceHistoryTable)
      .where(and(
        eq(providerPriceHistoryTable.providerKey, PROVIDER_KEY),
        inArray(providerPriceHistoryTable.cardId, cardIds),
      )),
    db
      .select()
      .from(cardPriceSnapshotsTable)
      .where(and(
        eq(cardPriceSnapshotsTable.providerKey, PROVIDER_KEY),
        inArray(cardPriceSnapshotsTable.cardId, cardIds),
        eq(cardPriceSnapshotsTable.captureStatus, "success"),
      )),
  ]);

  const quoteMap = new Map<string, QuoteRow>();
  for (const quote of quoteRows) {
    const gradeKey = normalizeGradeKey(quote.gradeKey);
    if (gradeKey) quoteMap.set(`${quote.cardId}:${gradeKey}`, quote);
  }

  type HistoricalPrice = {
    date: string;
    priceCents: number;
    currency: string;
    recordedAt: number;
    priority: number;
  };
  const historyMap = new Map<string, Map<string, HistoricalPrice>>();
  const addHistory = (
    cardId: string,
    gradeKeyValue: string,
    priceCents: number | null,
    sourceCurrency: string,
    date: string,
    recordedAt: number,
    priority: number,
  ) => {
    if (priceCents == null || !Number.isFinite(priceCents) || priceCents < 0) return;
    const key = `${cardId}:${gradeKeyValue}`;
    const dates = historyMap.get(key) ?? new Map<string, HistoricalPrice>();
    const existing = dates.get(date);
    if (
      !existing ||
      priority > existing.priority ||
      (priority === existing.priority && recordedAt >= existing.recordedAt)
    ) {
      dates.set(date, {
        date,
        priceCents,
        currency: sourceCurrency.toUpperCase(),
        recordedAt,
        priority,
      });
    }
    historyMap.set(key, dates);
  };

  for (const row of dailyRows) {
    const gradeKey = normalizeGradeKey(row.gradeKey);
    const date = rowDate(row.snapshotDate);
    if (gradeKey && date) {
      // Daily provider history is canonical when both tables contain a date.
      addHistory(row.cardId, gradeKey, row.priceCents, row.currency, date, row.recordedAt.getTime(), 2);
    }
  }
  for (const row of timestampedRows) {
    const gradeKey = normalizeGradeKey(row.gradeKey);
    const date = rowDate(row.capturedAt.toISOString());
    if (gradeKey && date) {
      addHistory(row.cardId, gradeKey, row.priceCents, row.currency, date, row.capturedAt.getTime(), 1);
    }
  }

  const historyByKey = new Map<string, HistoricalPrice[]>();
  for (const [key, dates] of historyMap) {
    historyByKey.set(key, [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)));
  }

  const requestedStart = isoDateDaysAgo(Math.max(1, periodDays), now);
  const earliestRetainedDate = [...historyByKey.values()]
    .flatMap(history => history.map(point => point.date))
    .sort()[0];
  const startDate = periodDays >= PORTFOLIO_HISTORY_RANGES.ALL!
    ? earliestRetainedDate ?? requestedStart
    : requestedStart;
  const dates = new Set<string>([today]);
  for (const history of historyByKey.values()) {
    for (const point of history) {
      if (point.date >= startDate && point.date <= today) dates.add(point.date);
    }
  }

  const points: PortfolioValueHistoryPoint[] = [];
  const conversionCache = new Map<string, number | null>();
  for (const date of [...dates].sort()) {
    let valueCents = 0;
    let complete = true;
    for (const row of rows) {
      const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
      if (!gradeKey) {
        complete = false;
        break;
      }

      const quote = date === today ? quoteMap.get(`${row.cardId}:${gradeKey}`) : undefined;
      let price: HistoricalPrice | null = quote
        ? {
            date,
            priceCents: quote.priceCents,
            currency: quote.currency,
            recordedAt: quote.fetchedAt.getTime(),
            priority: 3,
          }
        : null;
      if (!price) {
        const history = historyByKey.get(`${row.cardId}:${gradeKey}`) ?? [];
        for (let index = history.length - 1; index >= 0; index -= 1) {
          if (history[index]!.date <= date) {
            price = history[index]!;
            break;
          }
        }
      }
      if (!price) {
        complete = false;
        break;
      }

      const conversionKey = `${price.priceCents}:${price.currency}:${currency}`;
      let converted = conversionCache.get(conversionKey);
      if (converted === undefined) {
        converted = await convertCents(price.priceCents, price.currency, currency);
        conversionCache.set(conversionKey, converted);
      }
      if (converted == null) {
        complete = false;
        break;
      }
      valueCents += converted * row.quantity;
    }

    if (complete) {
      points.push({
        date,
        valueCents,
        value: valueCents / 100,
        currency,
        pricedHoldings: rows.length,
        totalHoldings: rows.length,
      });
    }
  }

  return {
    points,
    currency,
    historyAvailable: points.length >= 2,
    historyUnavailableReason: points.length >= 2
      ? null
      : "At least two complete retained price observations are required for the current collection",
  };
}

export function portfolioChartData(
  points: PortfolioValueHistoryPoint[],
  now = new Date(),
) {
  return Object.fromEntries(
    Object.entries(PORTFOLIO_HISTORY_RANGES).map(([range, days]) => [
      range,
      days >= PORTFOLIO_HISTORY_RANGES.ALL!
        ? points
        : points.filter(point => point.date >= isoDateDaysAgo(days, now)),
    ]),
  ) as Record<keyof typeof PORTFOLIO_HISTORY_RANGES, PortfolioValueHistoryPoint[]>;
}

function normalizedGrade(value: unknown): number | null {
  const grade = Number(value);
  return Number.isFinite(grade) ? grade : null;
}

function designationText(grading: Record<string, unknown>): string {
  return [
    grading.designation,
    grading.label,
    grading.variant,
    grading.subLabel,
    grading.sub_label,
    grading.isBlackLabel ? "black label" : "",
    grading.isPristine ? "pristine" : "",
  ].filter(Boolean).join(" ").trim().toLowerCase();
}

/**
 * Resolve a holding to the exact normalized provider grade that represents it.
 * Unsupported graded values return null; they never fall back to raw.
 */
export function gradeKeyForHolding(
  isGraded: boolean,
  gradingData: unknown,
): GradeKey | null {
  if (!isGraded) return "raw";
  if (!gradingData || typeof gradingData !== "object") return null;

  const grading = gradingData as Record<string, unknown>;
  const company = String(grading["company"] ?? grading["gradingCompany"] ?? "").trim().toUpperCase();
  const grade = normalizedGrade(grading["grade"]);
  if (grade == null) return null;

  if (grade === 10) {
    const designation = designationText(grading);
    if (company === "PSA") return "psa_10";
    if (company === "BGS" || company === "BECKETT") {
      return designation.includes("black label") ? "bgs_black_label_10" : "bgs_10";
    }
    if (company === "CGC") {
      return designation.includes("pristine") ? "cgc_pristine_10" : "cgc_10";
    }
    if (company === "SGC") return "sgc_10";
    if (company === "TAG") return "tag_10";
    if (company === "ACE") return "ace_10";
    return null;
  }
  // Generic PriceCharting grades are not substitutes for a company-specific
  // slab. They can only be selected when the holding explicitly identifies
  // itself as a generic grade.
  if (company === "GENERIC" || company === "UNSPECIFIED") {
    if (grade === 9) return normalizeGradeKey("graded_9");
    if (grade === 8 || grade === 8.5) return normalizeGradeKey("graded_8_85");
    if (grade === 9.5) return normalizeGradeKey("graded_95");
  }
  return null;
}

export async function calculatePortfolioValuation(
  userId: string,
  displayCurrency: string,
  rowIds?: string[],
): Promise<PortfolioValuation> {
  const currency = displayCurrency.trim().toUpperCase();
  const rows = rowIds && rowIds.length === 0
    ? []
    : await db
        .select()
        .from(collectionItemsTable)
        .where(
          rowIds
            ? and(
                eq(collectionItemsTable.userId, userId),
                inArray(collectionItemsTable.id, rowIds),
              )
            : eq(collectionItemsTable.userId, userId),
        );

  const cardIds = [...new Set(rows.map(row => row.cardId))];
  const quotes = cardIds.length > 0
    ? await db
        .select()
        .from(currentQuotesTable)
        .where(and(
          eq(currentQuotesTable.providerKey, PROVIDER_KEY),
          inArray(currentQuotesTable.cardId, cardIds),
        ))
    : [];

  const quoteMap = new Map<string, QuoteRow>();
  for (const quote of quotes) {
    const canonicalGrade = normalizeGradeKey(quote.gradeKey);
    if (canonicalGrade) quoteMap.set(`${quote.cardId}:${canonicalGrade}`, quote);
  }

  let totalValueCents = 0;
  let totalCostCents = 0;
  let pricedHoldings = 0;
  let freshHoldings = 0;
  let staleHoldings = 0;
  let costBasisComplete = true;
  const now = Date.now();
  const holdings: HoldingValuation[] = [];

  for (const row of rows) {
    const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
    const quote = gradeKey ? quoteMap.get(`${row.cardId}:${gradeKey}`) ?? null : null;
    const acquiredCurrency = (row.acquiredCurrency ?? "AUD").toUpperCase();
    const originalCostCents = row.acquiredPriceCents * row.quantity;
    const convertedCost = await convertCents(originalCostCents, acquiredCurrency, currency);

    if (convertedCost == null) {
      costBasisComplete = false;
    } else {
      totalCostCents += convertedCost;
    }

    let currentValueCents: number | null = null;
    let isStale = false;
    if (quote) {
      const convertedUnitValue = await convertCents(
        quote.priceCents,
        quote.currency.toUpperCase(),
        currency,
      );
      if (convertedUnitValue != null) {
        currentValueCents = convertedUnitValue * row.quantity;
        totalValueCents += currentValueCents;
        pricedHoldings += 1;
        isStale = now - quote.fetchedAt.getTime() > STALE_THRESHOLD_MS;
        if (isStale) staleHoldings += 1;
        else freshHoldings += 1;
      }
    }

    holdings.push({
      row,
      gradeKey,
      quote,
      currentValueCents,
      costBasisCents: convertedCost,
      unrealizedGainCents:
        currentValueCents != null && convertedCost != null
          ? currentValueCents - convertedCost
          : null,
      isStale,
    });
  }

  const totalHoldings = rows.length;
  const valuationComplete = totalHoldings > 0 && pricedHoldings === totalHoldings;
  const completeUnrealized =
    valuationComplete && costBasisComplete
      ? totalValueCents - totalCostCents
      : null;

  return {
    currency,
    holdings,
    cardCount: rows.reduce((sum, row) => sum + row.quantity, 0),
    uniqueCardCount: new Set(rows.map(row => row.cardId)).size,
    totalHoldings,
    pricedHoldings,
    freshHoldings,
    staleHoldings,
    totalValueCents: pricedHoldings > 0 ? totalValueCents : null,
    totalCostCents: costBasisComplete ? totalCostCents : null,
    unrealizedGainCents: completeUnrealized,
    unrealizedGainPercent:
      completeUnrealized != null && totalCostCents > 0
        ? (completeUnrealized / totalCostCents) * 100
        : null,
    valuationComplete,
    costBasisComplete,
  };
}

/**
 * Capture one canonical USD point per user/day. Partial valuations are not
 * snapshotted because improved pricing coverage must not look like performance.
 */
export async function capturePortfolioSnapshot(userId: string): Promise<boolean> {
  const valuation = await calculatePortfolioValuation(userId, "USD");
  if (
    !valuation.valuationComplete ||
    !valuation.costBasisComplete ||
    valuation.totalValueCents == null ||
    valuation.totalCostCents == null
  ) {
    return false;
  }

  const now = new Date();
  const snapshotDate = now.toISOString().slice(0, 10);
  await db
    .insert(portfolioSnapshotsTable)
    .values({
      userId,
      totalValueCents: valuation.totalValueCents,
      totalCostCents: valuation.totalCostCents,
      currency: "USD",
      pricedHoldings: valuation.pricedHoldings,
      totalHoldings: valuation.totalHoldings,
      snapshotDate,
      recordedAt: now,
    })
    .onConflictDoUpdate({
      target: [portfolioSnapshotsTable.userId, portfolioSnapshotsTable.snapshotDate],
      set: {
        totalValueCents: valuation.totalValueCents,
        totalCostCents: valuation.totalCostCents,
        currency: "USD",
        pricedHoldings: valuation.pricedHoldings,
        totalHoldings: valuation.totalHoldings,
        recordedAt: now,
      },
    });
  return true;
}

export async function captureAllPortfolioSnapshots(): Promise<number> {
  return (await captureAllPortfolioSnapshotsDetailed()).captured;
}

export async function captureAllPortfolioSnapshotsDetailed(): Promise<{
  captured: number;
  skipped: number;
  failed: number;
}> {
  const userRows = await db
    .selectDistinct({ userId: collectionItemsTable.userId })
    .from(collectionItemsTable);

  let captured = 0;
  let skipped = 0;
  let failed = 0;
  for (const { userId } of userRows) {
    try {
      if (await capturePortfolioSnapshot(userId)) captured += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }
  return { captured, skipped, failed };
}
