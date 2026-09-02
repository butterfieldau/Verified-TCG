import { db } from "@workspace/db";
import {
  collectionItemsTable,
  currentQuotesTable,
  providerPriceHistoryTable,
  cardPriceSnapshotsTable,
  portfolioSnapshotsTable,
  soldArchiveItemsTable,
  usersTable,
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
  valueCents: number | null;
  value: number | null;
  currency: string;
  pricedHoldings: number;
  totalHoldings: number;
  /** False when one or more owned holdings has no exact retained price/FX for this date. */
  available: boolean;
  complete: boolean;
  /** Movement from the immediately preceding complete calendar day, never a bucket delta. */
  dailyChangeCents: number | null;
  dailyChange: number | null;
  dailyChangePercent: number | null;
  bucketStart?: string;
  bucketEnd?: string;
  sampledFrom?: string;
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
 * Build the collector's ownership-value timeline. Active rows and immutable
 * sold-archive rows form ownership intervals, so quantities appear on their
 * acquisition/restore date and disappear on their sale date. The account
 * creation date supplies the truthful zero baseline.
 *
 * A non-zero point is available only when every owned holding has an exact,
 * retained price for that date. Daily provider history is preferred;
 * timestamped snapshots fill the same calendar date. The current quote is used
 * only for today. We never carry a price across an unobserved date.
 */
export async function calculatePortfolioValueHistory(
  userId: string,
  periodDays = PORTFOLIO_HISTORY_RANGES.ALL!,
  displayCurrency = "AUD",
): Promise<PortfolioValueHistory> {
  const currency = displayCurrency.trim().toUpperCase();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [rows, archivedRows, accountRows] = await Promise.all([
    db.select().from(collectionItemsTable).where(eq(collectionItemsTable.userId, userId)),
    db.select().from(soldArchiveItemsTable).where(eq(soldArchiveItemsTable.userId, userId)),
    db
      .select({ createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId)),
  ]);
  const accountDate = rowDate(accountRows[0]?.createdAt.toISOString()) ?? today;
  if (accountRows.length === 0) {
    return {
      points: [],
      currency,
      historyAvailable: false,
      historyUnavailableReason: "Collector account is unavailable",
    };
  }

  type OwnershipInterval = {
    cardId: string;
    quantity: number;
    isGraded: boolean;
    gradingData: unknown;
    startDate: string;
    endDate: string | null;
  };
  const intervals: OwnershipInterval[] = [
    ...rows.flatMap(row => {
      const startDate = rowDate(row.ownershipStartedAt ?? row.acquiredAt);
      return startDate
        ? [{
            cardId: row.cardId,
            quantity: row.quantity,
            isGraded: row.isGraded,
            gradingData: row.gradingData,
            startDate,
            endDate: null,
          }]
        : [];
    }),
    ...archivedRows.flatMap(row => {
      const startDate = rowDate(row.ownershipStartedAt ?? row.acquiredAt);
      const endDate = rowDate(row.soldAt);
      return startDate && endDate && startDate <= endDate
        ? [{
            cardId: row.cardId,
            quantity: row.quantity,
            isGraded: row.isGraded,
            gradingData: row.gradingData,
            startDate,
            endDate,
          }]
        : [];
    }),
  ];
  const cardIds = [...new Set(intervals.map(row => row.cardId))];
  if (cardIds.length === 0) {
    const requestedStart = isoDateDaysAgo(Math.max(1, periodDays) - 1, now);
    const startDate = periodDays >= PORTFOLIO_HISTORY_RANGES.ALL!
      ? accountDate
      : accountDate > requestedStart ? accountDate : requestedStart;
    const points: PortfolioValueHistoryPoint[] = [];
    for (
      let cursor = new Date(`${startDate}T00:00:00Z`);
      cursor <= new Date(`${today}T00:00:00Z`);
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1_000)
    ) {
      points.push({
        date: cursor.toISOString().slice(0, 10),
        valueCents: 0,
        value: 0,
        currency,
        pricedHoldings: 0,
        totalHoldings: 0,
        available: true,
        complete: true,
        dailyChangeCents: points.length > 0 ? 0 : null,
        dailyChange: points.length > 0 ? 0 : null,
        dailyChangePercent: null,
      });
    }
    return {
      points,
      currency,
      historyAvailable: true,
      historyUnavailableReason: null,
    };
  }
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

  // A period is a count of calendar days, inclusive of today. The old
  // implementation treated 7D as "seven days ago through today", producing
  // eight calendar points and making range boundaries ambiguous.
  const requestedStart = isoDateDaysAgo(Math.max(1, periodDays) - 1, now);
  const startDate = periodDays >= PORTFOLIO_HISTORY_RANGES.ALL!
    ? accountDate
    : accountDate > requestedStart ? accountDate : requestedStart;
  const dates: string[] = [];
  for (
    let cursor = new Date(`${startDate}T00:00:00Z`);
    cursor <= new Date(`${today}T00:00:00Z`);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1_000)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  const points: PortfolioValueHistoryPoint[] = [];
  const conversionCache = new Map<string, number | null>();
  for (const date of dates) {
    // Account creation is the product timeline's zero baseline even when a
    // collector imports a card with an earlier real-world acquisition date.
    // Daily data cannot represent a second, later event on the same date, so
    // imported ownership first appears at the next retained observation.
    if (date === accountDate) {
      points.push({
        date,
        valueCents: 0,
        value: 0,
        currency,
        pricedHoldings: 0,
        totalHoldings: 0,
        available: true,
        complete: true,
        dailyChangeCents: null,
        dailyChange: null,
        dailyChangePercent: null,
      });
      continue;
    }
    const owned = intervals.filter(interval =>
      interval.startDate <= date && (interval.endDate === null || date < interval.endDate)
    );
    const totalHoldings = owned.reduce((sum, interval) => sum + interval.quantity, 0);
    if (totalHoldings === 0) {
      points.push({
        date,
        valueCents: 0,
        value: 0,
        currency,
        pricedHoldings: 0,
        totalHoldings: 0,
        available: true,
        complete: true,
        dailyChangeCents: null,
        dailyChange: null,
        dailyChangePercent: null,
      });
      continue;
    }

    let valueCents = 0;
    let complete = true;
    let pricedHoldings = 0;
    for (const row of owned) {
      const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
      if (!gradeKey) {
        complete = false;
        continue;
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
        // Exact-date lookup is intentional. A retained quote from a different
        // day cannot prove what the collection was worth on this day.
        price = history.find(candidate => candidate.date === date) ?? null;
      }
      if (!price) {
        complete = false;
        continue;
      }

      const conversionKey = `${price.priceCents}:${price.currency}:${currency}`;
      let converted = conversionCache.get(conversionKey);
      if (converted === undefined) {
        converted = await convertCents(price.priceCents, price.currency, currency);
        conversionCache.set(conversionKey, converted);
      }
      if (converted == null) {
        complete = false;
        continue;
      }
      valueCents += converted * row.quantity;
      pricedHoldings += row.quantity;
    }

    if (complete) {
      points.push({
        date,
        valueCents,
        value: valueCents / 100,
        currency,
        pricedHoldings,
        totalHoldings,
        available: true,
        complete: true,
        dailyChangeCents: null,
        dailyChange: null,
        dailyChangePercent: null,
      });
    } else {
      points.push({
        date,
        valueCents: null,
        value: null,
        currency,
        pricedHoldings,
        totalHoldings,
        available: false,
        complete: false,
        dailyChangeCents: null,
        dailyChange: null,
        dailyChangePercent: null,
      });
    }
  }

  const pointByDate = new Map(points.map(point => [point.date, point]));
  for (const point of points) {
    if (!point.available || point.valueCents == null) continue;
    const previousDate = isoDateDaysAgo(
      1,
      new Date(`${point.date}T00:00:00Z`),
    );
    const previous = pointByDate.get(previousDate);
    if (!previous?.available || previous.valueCents == null) continue;
    const changeCents = point.valueCents - previous.valueCents;
    point.dailyChangeCents = changeCents;
    point.dailyChange = changeCents / 100;
    point.dailyChangePercent =
      previous.valueCents > 0 ? (changeCents / previous.valueCents) * 100 : null;
  }

  return {
    points,
    currency,
    historyAvailable: points.some(point => point.available),
    historyUnavailableReason: points.length > 0
      && points.some(point => point.available)
      ? null
      : "No complete retained price observations are available during ownership",
  };
}

type PortfolioChartRange = keyof typeof PORTFOLIO_HISTORY_RANGES;

function dateFromIso(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function isoDateMonthsAgo(months: number, now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return date.toISOString().slice(0, 10);
}

function copyUnavailablePoint(
  date: string,
  currency: string,
  bucketStart?: string,
  bucketEnd?: string,
): PortfolioValueHistoryPoint {
  return {
    date,
    valueCents: null,
    value: null,
    currency,
    pricedHoldings: 0,
    totalHoldings: 0,
    available: false,
    complete: false,
    dailyChangeCents: null,
    dailyChange: null,
    dailyChangePercent: null,
    bucketStart,
    bucketEnd,
  };
}

function sampledWeeklyPoints(
  points: PortfolioValueHistoryPoint[],
  days: number,
): PortfolioValueHistoryPoint[] {
  const today = points.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const start = isoDateDaysAgo(days - 1, dateFromIso(today));
  const inRange = points.filter(point => point.date >= start && point.date <= today);
  const startDate = dateFromIso(start);
  const result: PortfolioValueHistoryPoint[] = [];
  for (let offset = 0; offset < days; offset += 7) {
    const bucketStartDate = new Date(startDate.getTime() + offset * 24 * 60 * 60 * 1_000);
    const bucketEndDate = new Date(
      Math.min(
        dateFromIso(today).getTime(),
        bucketStartDate.getTime() + 6 * 24 * 60 * 60 * 1_000,
      ),
    );
    const bucketStart = bucketStartDate.toISOString().slice(0, 10);
    const bucketEnd = bucketEndDate.toISOString().slice(0, 10);
    const bucket = inRange.filter(point => point.date >= bucketStart && point.date <= bucketEnd);
    const selected = [...bucket].reverse().find(point => point.available);
    if (selected) {
      result.push({ ...selected, bucketStart, bucketEnd, sampledFrom: selected.date });
    } else {
      result.push(copyUnavailablePoint(bucketEnd, points[0]?.currency ?? "AUD", bucketStart, bucketEnd));
    }
  }
  return result;
}

function sampledMonthlyPoints(points: PortfolioValueHistoryPoint[]): PortfolioValueHistoryPoint[] {
  const today = dateFromIso(points.at(-1)?.date ?? new Date().toISOString().slice(0, 10));
  const firstMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  const result: PortfolioValueHistoryPoint[] = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const monthStartDate = new Date(Date.UTC(
      firstMonth.getUTCFullYear(),
      firstMonth.getUTCMonth() + offset,
      1,
    ));
    const nextMonthDate = new Date(Date.UTC(
      firstMonth.getUTCFullYear(),
      firstMonth.getUTCMonth() + offset + 1,
      1,
    ));
    const monthStart = monthStartDate.toISOString().slice(0, 10);
    const monthEnd = new Date(nextMonthDate.getTime() - 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    const bucket = points.filter(point => point.date >= monthStart && point.date <= monthEnd);
    const selected = [...bucket].reverse().find(point => point.available);
    if (selected) {
      result.push({
        ...selected,
        bucketStart: monthStart,
        bucketEnd: selected.date < monthEnd ? selected.date : monthEnd,
        sampledFrom: selected.date,
      });
    } else {
      result.push(copyUnavailablePoint(
        monthEnd > today.toISOString().slice(0, 10) ? today.toISOString().slice(0, 10) : monthEnd,
        points[0]?.currency ?? "AUD",
        monthStart,
        monthEnd,
      ));
    }
  }
  return result;
}

export function portfolioChartData(
  points: PortfolioValueHistoryPoint[],
  now = new Date(),
) {
  const today = points.at(-1)?.date ?? now.toISOString().slice(0, 10);
  const currentDate = dateFromIso(today);
  const daily = (days: number) => points.filter(point =>
    point.date >= isoDateDaysAgo(days - 1, currentDate) && point.date <= today,
  );
  const all = points.filter(point => point.date <= today);
  return {
    "1D": daily(1),
    "7D": daily(7),
    "1M": daily(30),
    "3M": sampledWeeklyPoints(points, 90),
    "6M": sampledWeeklyPoints(points, 180),
    // Twelve user-facing calendar months, including the current month.
    "1Y": sampledMonthlyPoints(points),
    "ALL": all,
  } as Record<PortfolioChartRange, PortfolioValueHistoryPoint[]>;
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
