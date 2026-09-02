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

export type PortfolioMovementKind = "market_price" | "acquisition" | "sale";

export interface PortfolioMovementContribution {
  id: string;
  cardId: string;
  name: string;
  setName: string | null;
  imageUrl: string | null;
  quantity: number;
  gradeKey: GradeKey | null;
  kind: PortfolioMovementKind;
  amountCents: number | null;
  amount: number | null;
  previousValueCents: number | null;
  previousValue: number | null;
  valueCents: number | null;
  value: number | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface PortfolioMovementBreakdown {
  date: string;
  previousDate: string | null;
  currency: string;
  available: boolean;
  previousAvailable: boolean;
  breakdownAvailable: boolean;
  totalChangeCents: number | null;
  totalChange: number | null;
  contributions: PortfolioMovementContribution[];
  unavailableReason: string | null;
}

type HistoricalPrice = {
  date: string;
  priceCents: number;
  currency: string;
  recordedAt: number;
  priority: number;
};

type OwnershipInterval = {
  id: string;
  cardId: string;
  quantity: number;
  isGraded: boolean;
  gradingData: unknown;
  cardData: unknown;
  addedDate: string;
  startDate: string;
  endDate: string | null;
};

type HistoryPricing = {
  quoteMap: Map<string, QuoteRow>;
  historyByKey: Map<string, HistoricalPrice[]>;
};

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

async function loadOwnershipIntervals(userId: string): Promise<{
  intervals: OwnershipInterval[];
  accountDate: string;
  today: string;
  accountFound: boolean;
}> {
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
  const intervals: OwnershipInterval[] = [
    ...rows.flatMap(row => {
      const startDate = rowDate(row.ownershipStartedAt ?? row.acquiredAt);
      const addedDate = rowDate(row.createdAt.toISOString());
      return startDate && addedDate
        ? [{
            id: row.id,
            cardId: row.cardId,
            quantity: row.quantity,
            isGraded: row.isGraded,
            gradingData: row.gradingData,
            cardData: row.cardData,
            addedDate,
            startDate,
            endDate: null,
          }]
        : [];
    }),
    ...archivedRows.flatMap(row => {
      const startDate = rowDate(row.ownershipStartedAt ?? row.acquiredAt);
      const endDate = rowDate(row.soldAt);
      const addedDate = rowDate(row.createdAt.toISOString());
      return startDate && endDate && addedDate && startDate <= endDate
        ? [{
            id: row.id,
            cardId: row.cardId,
            quantity: row.quantity,
            isGraded: row.isGraded,
            gradingData: row.gradingData,
            cardData: row.cardData,
            addedDate,
            startDate,
            endDate,
          }]
        : [];
    }),
  ];
  return { intervals, accountDate, today, accountFound: accountRows.length > 0 };
}

async function loadHistoryPricing(cardIds: string[]): Promise<HistoryPricing> {
  if (cardIds.length === 0) {
    return { quoteMap: new Map(), historyByKey: new Map() };
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

  return {
    quoteMap,
    historyByKey: new Map(
      [...historyMap.entries()].map(([key, dates]) => [
        key,
        [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)),
      ]),
    ),
  };
}

function retainedPriceForDate(
  pricing: HistoryPricing,
  cardId: string,
  gradeKey: GradeKey,
  date: string,
  today: string,
): HistoricalPrice | null {
  const quote = date === today ? pricing.quoteMap.get(`${cardId}:${gradeKey}`) : undefined;
  if (quote) {
    return {
      date,
      priceCents: quote.priceCents,
      currency: quote.currency,
      recordedAt: quote.fetchedAt.getTime(),
      priority: 3,
    };
  }
  // Exact-date lookup is intentional. A retained quote from another day
  // cannot prove what the collection was worth on this day.
  return pricing.historyByKey.get(`${cardId}:${gradeKey}`)?.find(candidate => candidate.date === date) ?? null;
}

/**
 * Build the current profile's retained market-value timeline. Only cards that
 * are currently in the collection are included, and each starts contributing
 * on the date it was added to this profile.
 *
 * Historical dates use the most recent real provider observation retained on
 * or before that date. This is an as-of market value, not interpolation. When
 * some cards have never had an observation, the known priced subtotal remains
 * drawable and the point is explicitly marked incomplete.
 */
export async function calculatePortfolioValueHistory(
  userId: string,
  periodDays = PORTFOLIO_HISTORY_RANGES.ALL!,
  displayCurrency = "AUD",
): Promise<PortfolioValueHistory> {
  const currency = displayCurrency.trim().toUpperCase();
  const now = new Date();
  const ownership = await loadOwnershipIntervals(userId);
  const { accountDate, today } = ownership;
  const profileRows = ownership.intervals.filter(interval => interval.endDate === null);
  if (!ownership.accountFound) {
    return {
      points: [],
      currency,
      historyAvailable: false,
      historyUnavailableReason: "Collector account is unavailable",
    };
  }

  const cardIds = [...new Set(profileRows.map(row => row.cardId))];
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
  const { quoteMap, historyByKey } = await loadHistoryPricing(cardIds);

  // A period is a count of calendar days, inclusive of today. The old
  // implementation treated 7D as "seven days ago through today", producing
  // eight calendar points and making range boundaries ambiguous.
  const requestedStart = isoDateDaysAgo(Math.max(1, periodDays) - 1, now);
  const profileStart = profileRows.reduce(
    (earliest, row) => row.addedDate < earliest ? row.addedDate : earliest,
    profileRows[0]!.addedDate,
  );
  const startDate = periodDays >= PORTFOLIO_HISTORY_RANGES.ALL!
    ? profileStart
    : profileStart > requestedStart ? profileStart : requestedStart;
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
    const profileAtDate = profileRows.filter(row => row.addedDate <= date);
    const totalHoldings = profileAtDate.reduce((sum, row) => sum + row.quantity, 0);
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
    let pricedHoldings = 0;
    for (const row of profileAtDate) {
      const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
      if (!gradeKey) {
        continue;
      }

      const history = historyByKey.get(`${row.cardId}:${gradeKey}`) ?? [];
      const price = date === today && quoteMap.get(`${row.cardId}:${gradeKey}`)
        ? retainedPriceForDate({ quoteMap, historyByKey }, row.cardId, gradeKey, date, today)
        : [...history].reverse().find(candidate => candidate.date <= date) ?? null;
      if (!price) {
        continue;
      }

      const conversionKey = `${price.priceCents}:${price.currency}:${currency}`;
      let converted = conversionCache.get(conversionKey);
      if (converted === undefined) {
        converted = await convertCents(price.priceCents, price.currency, currency);
        conversionCache.set(conversionKey, converted);
      }
      if (converted == null) {
        continue;
      }
      valueCents += converted * row.quantity;
      pricedHoldings += row.quantity;
    }

    const complete = pricedHoldings === totalHoldings;
    if (pricedHoldings > 0) {
      points.push({
        date,
        valueCents,
        value: valueCents / 100,
        currency,
        pricedHoldings,
        totalHoldings,
        available: true,
        complete,
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
      : "No retained market prices are available for cards in this profile",
  };
}

/**
 * Explain a daily ownership-value change using the same retained observations
 * as calculatePortfolioValueHistory. Membership changes are deliberately
 * separate from market movement so an acquisition or sale is never presented
 * as a price gain or loss.
 */
export async function calculatePortfolioMovementBreakdown(
  userId: string,
  date: string,
  displayCurrency = "AUD",
): Promise<PortfolioMovementBreakdown> {
  const currency = displayCurrency.trim().toUpperCase();
  const ownership = await loadOwnershipIntervals(userId);
  const { intervals, accountDate, today } = ownership;
  const previousDate = rowDate(date)
    ? new Date(`${date}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1_000
    : null;
  const previousDateString = previousDate == null
    ? null
    : new Date(previousDate).toISOString().slice(0, 10);

  if (!ownership.accountFound) {
    return {
      date,
      previousDate: previousDateString,
      currency,
      available: false,
      previousAvailable: false,
      breakdownAvailable: false,
      totalChangeCents: null,
      totalChange: null,
      contributions: [],
      unavailableReason: "Collector account is unavailable",
    };
  }

  const selectedDateIsValid = rowDate(date) === date;
  const selectedDateIsInTimeline = selectedDateIsValid && date >= accountDate && date <= today;
  const isAccountBaseline = selectedDateIsInTimeline && date === accountDate;
  const currentIntervals = selectedDateIsInTimeline && date !== accountDate
    ? intervals.filter(interval =>
        interval.startDate <= date && (interval.endDate === null || date < interval.endDate),
      )
    : [];
  const previousIntervals = previousDateString && previousDateString > accountDate
    ? intervals.filter(interval =>
        interval.startDate <= previousDateString
        && (interval.endDate === null || previousDateString < interval.endDate),
      )
    : [];
  const cardIds = [...new Set(
    [...currentIntervals, ...previousIntervals].map(interval => interval.cardId),
  )];
  const pricing = await loadHistoryPricing(cardIds);
  const valueCache = new Map<string, { valueCents: number | null; reason: string | null }>();

  const valueAt = async (
    interval: OwnershipInterval,
    intervalDate: string,
  ): Promise<{ valueCents: number | null; reason: string | null }> => {
    const cacheKey = `${interval.id}:${intervalDate}`;
    const cached = valueCache.get(cacheKey);
    if (cached) return cached;
    const gradeKey = gradeKeyForHolding(interval.isGraded, interval.gradingData);
    if (!gradeKey) {
      const result = {
        valueCents: null,
        reason: "Exact provider grade is unavailable for this holding",
      };
      valueCache.set(cacheKey, result);
      return result;
    }
    const price = retainedPriceForDate(pricing, interval.cardId, gradeKey, intervalDate, today);
    if (!price) {
      const result = {
        valueCents: null,
        reason: "No exact retained provider observation is available for this date",
      };
      valueCache.set(cacheKey, result);
      return result;
    }
    const convertedUnit = await convertCents(price.priceCents, price.currency, currency);
    if (convertedUnit == null) {
      const result = {
        valueCents: null,
        reason: `Currency conversion to ${currency} is unavailable for this date`,
      };
      valueCache.set(cacheKey, result);
      return result;
    }
    const result = { valueCents: convertedUnit * interval.quantity, reason: null };
    valueCache.set(cacheKey, result);
    return result;
  };

  const currentValues = new Map<string, { valueCents: number | null; reason: string | null }>();
  for (const interval of currentIntervals) {
    currentValues.set(interval.id, await valueAt(interval, date));
  }
  const previousValues = new Map<string, { valueCents: number | null; reason: string | null }>();
  if (previousDateString && previousDateString > accountDate) {
    for (const interval of previousIntervals) {
      previousValues.set(interval.id, await valueAt(interval, previousDateString));
    }
  }

  const currentAvailable =
    selectedDateIsInTimeline
    && currentIntervals.every(interval => currentValues.get(interval.id)?.valueCents != null);
  const previousAvailable =
    isAccountBaseline
      ? false
      : previousDateString != null
        && previousDateString <= accountDate
      ? true
      : previousDateString != null
        && previousIntervals.every(interval => previousValues.get(interval.id)?.valueCents != null);

  const byId = new Map<string, OwnershipInterval>();
  for (const interval of [...previousIntervals, ...currentIntervals]) byId.set(interval.id, interval);
  const contributions: PortfolioMovementContribution[] = [];
  for (const interval of byId.values()) {
    const current = currentValues.get(interval.id);
    const previous = previousValues.get(interval.id);
    const card = interval.cardData && typeof interval.cardData === "object"
      ? interval.cardData as Record<string, unknown>
      : {};
    const gradeKey = gradeKeyForHolding(interval.isGraded, interval.gradingData);
    const name = String(card["name"] ?? card["title"] ?? interval.cardId);
    const setName = typeof card["setName"] === "string"
      ? card["setName"]
      : typeof card["set_name"] === "string"
        ? card["set_name"]
        : null;
    const imageUrl = typeof card["imageUrl"] === "string"
      ? card["imageUrl"]
      : typeof card["image"] === "string"
        ? card["image"]
        : null;
    const isCurrent = current != null;
    const isPrevious = previous != null;
    let kind: PortfolioMovementKind;
    let amountCents: number | null;
    let unavailableReason: string | null = null;
    if (isCurrent && !isPrevious) {
      kind = "acquisition";
      amountCents = current.valueCents;
      unavailableReason = current.reason;
    } else if (!isCurrent && isPrevious) {
      kind = "sale";
      amountCents = previous.valueCents == null ? null : -previous.valueCents;
      unavailableReason = previous.reason;
    } else if (current && previous) {
      kind = "market_price";
      amountCents =
        current.valueCents != null && previous.valueCents != null
          ? current.valueCents - previous.valueCents
          : null;
      unavailableReason = current.reason ?? previous.reason;
    } else {
      continue;
    }
    contributions.push({
      id: interval.id,
      cardId: interval.cardId,
      name,
      setName,
      imageUrl,
      quantity: interval.quantity,
      gradeKey,
      kind,
      amountCents,
      amount: amountCents == null ? null : amountCents / 100,
      previousValueCents: previous?.valueCents ?? null,
      previousValue: previous?.valueCents == null ? null : previous.valueCents / 100,
      valueCents: current?.valueCents ?? null,
      value: current?.valueCents == null ? null : current.valueCents / 100,
      available: amountCents != null,
      unavailableReason,
    });
  }

  const allValuesAvailable = contributions.every(contribution => contribution.available);
  const movementComplete =
    selectedDateIsInTimeline
    && !isAccountBaseline
    && currentAvailable
    && previousAvailable
    && allValuesAvailable;
  const totalChangeCents =
    movementComplete
      ? contributions.reduce((sum, contribution) => sum + (contribution.amountCents ?? 0), 0)
      : null;
  const unavailableReason = !selectedDateIsInTimeline
    ? "This date is outside the collector's retained ownership timeline"
    : isAccountBaseline
      ? "Account creation is the portfolio baseline and has no preceding ownership day"
    : !currentAvailable
      ? "One or more holdings has no exact retained observation for this date"
      : previousDateString == null
        ? "A preceding calendar day is unavailable"
        : !previousAvailable
          ? "One or more holdings has no exact retained observation for the preceding calendar day"
          : !allValuesAvailable
            ? "Some card movement contributions are unavailable"
            : null;

  return {
    date,
    previousDate: previousDateString,
    currency,
    available: currentAvailable,
    previousAvailable,
    breakdownAvailable: movementComplete,
    totalChangeCents,
    totalChange: totalChangeCents == null ? null : totalChangeCents / 100,
    contributions,
    unavailableReason,
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
