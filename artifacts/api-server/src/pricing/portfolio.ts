import { db } from "@workspace/db";
import {
  collectionItemsTable,
  currentQuotesTable,
  portfolioSnapshotsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { convertCents } from "./fx.js";
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

function normalizedGrade(value: unknown): number | null {
  const grade = Number(value);
  return Number.isFinite(grade) ? grade : null;
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
  const company = String(grading["company"] ?? "").trim().toUpperCase();
  const grade = normalizedGrade(grading["grade"]);
  if (grade == null) return null;

  if (grade === 10) {
    if (company === "PSA") return "psa_10";
    if (company === "BGS" || company === "BECKETT") return "bgs_10";
    if (company === "CGC") return "cgc_10";
    if (company === "SGC") return "sgc_10";
    return null;
  }
  if (grade === 9.5) return "grade_9_5";
  if (grade === 9) return "grade_9";
  if (grade === 8) return "grade_8";
  if (grade === 7) return "grade_7";
  return null;
}

export async function calculatePortfolioValuation(
  userId: string,
  displayCurrency: string,
): Promise<PortfolioValuation> {
  const currency = displayCurrency.trim().toUpperCase();
  const rows = await db
    .select()
    .from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, userId));

  const cardIds = new Set(rows.map(row => row.cardId));
  const quotes = cardIds.size > 0
    ? await db
        .select()
        .from(currentQuotesTable)
        .where(eq(currentQuotesTable.providerKey, PROVIDER_KEY))
    : [];

  const quoteMap = new Map<string, QuoteRow>();
  for (const quote of quotes) {
    if (cardIds.has(quote.cardId)) {
      quoteMap.set(`${quote.cardId}:${quote.gradeKey}`, quote);
    }
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
  const userRows = await db
    .selectDistinct({ userId: collectionItemsTable.userId })
    .from(collectionItemsTable);

  let captured = 0;
  for (const { userId } of userRows) {
    if (await capturePortfolioSnapshot(userId)) captured += 1;
  }
  return captured;
}