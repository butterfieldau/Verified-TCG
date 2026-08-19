/**
 * Collection valuation, performance, disposal, and sold archive routes.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  collectionItemsTable,
  soldArchiveItemsTable,
  currentQuotesTable,
  portfolioSnapshotsTable,
} from "@workspace/db";
import { and, eq, gte, desc, asc } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { logActivity } from "./activity.js";
import { convertCents } from "../pricing/fx.js";
import { PROVIDER_KEY } from "../pricing/pricecharting.js";
import {
  calculatePortfolioValuation,
  capturePortfolioSnapshot,
  gradeKeyForHolding,
} from "../pricing/portfolio.js";

const router = Router();

type ArchiveRow = typeof soldArchiveItemsTable.$inferSelect;
type QuoteRow = typeof currentQuotesTable.$inferSelect;

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value);
}

function dollars(cents: number | null): number | null {
  return cents == null ? null : cents / 100;
}

function movement(
  fromCents: number,
  toCents: number,
  fromDate: string,
  toDate: string,
) {
  const absoluteCents = toCents - fromCents;
  return {
    absolute: absoluteCents / 100,
    percent: fromCents > 0 ? (absoluteCents / fromCents) * 100 : null,
    direction: absoluteCents > 0 ? "up" : absoluteCents < 0 ? "down" : "flat",
    fromDate,
    toDate,
  };
}

async function currentQuoteForArchive(row: ArchiveRow): Promise<QuoteRow | null> {
  const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
  if (!gradeKey) return null;
  const [quote] = await db
    .select()
    .from(currentQuotesTable)
    .where(
      and(
        eq(currentQuotesTable.cardId, row.cardId),
        eq(currentQuotesTable.providerKey, PROVIDER_KEY),
        eq(currentQuotesTable.gradeKey, gradeKey),
      ),
    )
    .limit(1);
  return quote ?? null;
}

async function archiveRowToResponse(
  row: ArchiveRow,
  displayCurrency: string,
  quote: QuoteRow | null,
) {
  const currency = displayCurrency.toUpperCase();
  const totalCostOriginal = row.acquiredPriceCents * row.quantity;
  const saleDisplayCents = await convertCents(
    row.salePriceCents,
    row.saleCurrency.toUpperCase(),
    currency,
  );
  const costDisplayCents = await convertCents(
    totalCostOriginal,
    row.acquiredCurrency.toUpperCase(),
    currency,
  );
  const disposalDisplayCents =
    row.marketValueAtDisposalCents != null && row.marketValueCurrency
      ? await convertCents(
          row.marketValueAtDisposalCents,
          row.marketValueCurrency.toUpperCase(),
          currency,
        )
      : null;

  let currentMarketValueCents: number | null = null;
  let currentMarketCurrency: string | null = null;
  if (quote) {
    const originalCurrentCents = quote.priceCents * row.quantity;
    const converted = await convertCents(
      originalCurrentCents,
      quote.currency.toUpperCase(),
      currency,
    );
    currentMarketValueCents = converted ?? originalCurrentCents;
    currentMarketCurrency = converted != null ? currency : quote.currency;
  }

  const realisedGainCents =
    saleDisplayCents != null && costDisplayCents != null
      ? saleDisplayCents - costDisplayCents
      : null;

  return {
    id: row.id,
    originalCollectionItemId: row.originalCollectionItemId,
    cardId: row.cardId,
    card: row.cardData,
    quantity: row.quantity,
    condition: row.condition,
    grading: row.gradingData ?? undefined,
    isGraded: row.isGraded,
    acquiredAt: row.acquiredAt,
    acquiredPriceCents: row.acquiredPriceCents,
    acquiredCurrency: row.acquiredCurrency,
    totalCostBasisCents: totalCostOriginal,
    soldAt: row.soldAt,
    salePriceCents: row.salePriceCents,
    saleCurrency: row.saleCurrency,
    venue: row.venue ?? undefined,
    buyer: row.buyer ?? undefined,
    notes: row.notes ?? undefined,
    marketValueAtDisposalCents: row.marketValueAtDisposalCents ?? null,
    marketValueCurrency: row.marketValueCurrency ?? null,
    marketValueGradeKey: row.marketValueGradeKey ?? null,
    displayCurrency: currency,
    salePrice: dollars(saleDisplayCents ?? row.salePriceCents),
    salePriceCurrency: saleDisplayCents != null ? currency : row.saleCurrency,
    acquiredPrice: dollars(costDisplayCents ?? totalCostOriginal),
    acquiredPriceCurrency: costDisplayCents != null ? currency : row.acquiredCurrency,
    realisedGain: dollars(realisedGainCents),
    realisedGainPercent:
      realisedGainCents != null && costDisplayCents != null && costDisplayCents > 0
        ? (realisedGainCents / costDisplayCents) * 100
        : null,
    marketValueAtDisposal: dollars(disposalDisplayCents),
    currentMarketValue: dollars(currentMarketValueCents),
    currentMarketCurrency,
    currentMarketUpdatedAt: quote?.fetchedAt.toISOString() ?? null,
    currentMarketSource: quote ? "PriceCharting" : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post("/collection/:id/sell", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const body = req.body as Record<string, unknown>;
  const salePrice = body["salePrice"];
  const soldAt = body["soldAt"];
  const currency = body["currency"];

  if (!id) {
    res.status(400).json({ message: "id is required" });
    return;
  }
  if (typeof salePrice !== "number" || !Number.isFinite(salePrice) || salePrice < 0) {
    res.status(400).json({ message: "salePrice must be a non-negative number" });
    return;
  }
  if (!isValidCurrency(currency)) {
    res.status(400).json({ message: "currency must be a 3-letter ISO currency code" });
    return;
  }
  if (typeof soldAt !== "string" || !isValidDateString(soldAt)) {
    res.status(400).json({ message: "soldAt must be a valid ISO date string" });
    return;
  }

  const salePriceCents = Math.round(salePrice * 100);
  const outcome = await db.transaction(async tx => {
    // Lock the holding before validating quantity or creating the archive row.
    // This makes duplicate/concurrent disposal requests serialize safely.
    const [item] = await tx
      .select()
      .from(collectionItemsTable)
      .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
      .limit(1)
      .for("update");

    if (!item) return { status: "not_found" as const };

    const requestedQuantity =
      body["quantity"] == null ? item.quantity : Number(body["quantity"]);
    if (
      !Number.isInteger(requestedQuantity) ||
      requestedQuantity < 1 ||
      requestedQuantity > item.quantity
    ) {
      return {
        status: "invalid_quantity" as const,
        heldQuantity: item.quantity,
      };
    }

    const gradeKey = gradeKeyForHolding(item.isGraded, item.gradingData);
    const [quote] = gradeKey
      ? await tx
          .select()
          .from(currentQuotesTable)
          .where(
            and(
              eq(currentQuotesTable.cardId, item.cardId),
              eq(currentQuotesTable.providerKey, PROVIDER_KEY),
              eq(currentQuotesTable.gradeKey, gradeKey),
            ),
          )
          .limit(1)
      : [];

    const [archived] = await tx
      .insert(soldArchiveItemsTable)
      .values({
        userId: req.userId!,
        originalCollectionItemId: item.id,
        cardId: item.cardId,
        cardData: item.cardData as Record<string, unknown>,
        quantity: requestedQuantity,
        condition: item.condition,
        gradingData: (item.gradingData as Record<string, unknown> | null) ?? null,
        isGraded: item.isGraded,
        acquiredPriceCents: item.acquiredPriceCents,
        acquiredCurrency: item.acquiredCurrency,
        acquiredAt: item.acquiredAt,
        // Sale price is the total proceeds for this disposal transaction.
        salePriceCents,
        saleCurrency: currency.toUpperCase(),
        soldAt,
        venue: typeof body["venue"] === "string" ? body["venue"].slice(0, 200) : null,
        buyer: typeof body["buyer"] === "string" ? body["buyer"].slice(0, 200) : null,
        notes: typeof body["notes"] === "string" ? body["notes"].slice(0, 2_000) : null,
        marketValueAtDisposalCents: quote ? quote.priceCents * requestedQuantity : null,
        marketValueCurrency: quote?.currency ?? null,
        marketValueGradeKey: quote ? gradeKey : null,
      })
      .returning();

    if (requestedQuantity === item.quantity) {
      await tx.delete(collectionItemsTable).where(eq(collectionItemsTable.id, item.id));
    } else {
      await tx
        .update(collectionItemsTable)
        .set({ quantity: item.quantity - requestedQuantity, updatedAt: new Date() })
        .where(eq(collectionItemsTable.id, item.id));
    }
    return {
      status: "sold" as const,
      archiveRow: archived!,
      item,
      quote: quote ?? null,
      requestedQuantity,
    };
  });

  if (outcome.status === "not_found") {
    res.status(404).json({ message: "Collection item not found" });
    return;
  }
  if (outcome.status === "invalid_quantity") {
    res.status(400).json({
      message: `quantity must be between 1 and ${outcome.heldQuantity} (held quantity)`,
    });
    return;
  }

  const { archiveRow, item, quote, requestedQuantity } = outcome;
  const card = item.cardData as Record<string, unknown>;
  logActivity(req.userId!, "card_removed", item.cardId, String(card["name"] ?? item.cardId), {
    disposition: "sold",
    quantity: requestedQuantity,
  });
  void capturePortfolioSnapshot(req.userId!);
  res.status(201).json(
    await archiveRowToResponse(archiveRow, currency.toUpperCase(), quote),
  );
});

router.get("/collection/archive", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const displayCurrency =
    typeof req.query["displayCurrency"] === "string" &&
    isValidCurrency(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : "AUD";
  const rows = await db
    .select()
    .from(soldArchiveItemsTable)
    .where(eq(soldArchiveItemsTable.userId, req.userId!))
    .orderBy(desc(soldArchiveItemsTable.soldAt));

  const items = await Promise.all(
    rows.map(async row =>
      archiveRowToResponse(row, displayCurrency, await currentQuoteForArchive(row)),
    ),
  );
  res.json(items);
});

router.get("/collection/archive/:id", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const displayCurrency =
    typeof req.query["displayCurrency"] === "string" &&
    isValidCurrency(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : "AUD";
  const [row] = await db
    .select()
    .from(soldArchiveItemsTable)
    .where(and(eq(soldArchiveItemsTable.id, id), eq(soldArchiveItemsTable.userId, req.userId!)))
    .limit(1);

  if (!row) {
    res.status(404).json({ message: "Archive item not found" });
    return;
  }
  res.json(await archiveRowToResponse(row, displayCurrency, await currentQuoteForArchive(row)));
});

router.patch("/collection/archive/:id", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const body = req.body as Record<string, unknown>;
  const [existing] = await db
    .select()
    .from(soldArchiveItemsTable)
    .where(and(eq(soldArchiveItemsTable.id, id), eq(soldArchiveItemsTable.userId, req.userId!)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ message: "Archive item not found" });
    return;
  }

  const patch: Partial<typeof soldArchiveItemsTable.$inferInsert> = { updatedAt: new Date() };
  if (body["salePrice"] !== undefined) {
    const price = body["salePrice"];
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      res.status(400).json({ message: "salePrice must be a non-negative number" });
      return;
    }
    patch.salePriceCents = Math.round(price * 100);
  }
  if (body["currency"] !== undefined) {
    if (!isValidCurrency(body["currency"])) {
      res.status(400).json({ message: "currency must be a 3-letter ISO currency code" });
      return;
    }
    patch.saleCurrency = body["currency"].toUpperCase();
  }
  if (body["soldAt"] !== undefined) {
    if (typeof body["soldAt"] !== "string" || !isValidDateString(body["soldAt"])) {
      res.status(400).json({ message: "soldAt must be a valid ISO date string" });
      return;
    }
    patch.soldAt = body["soldAt"];
  }
  for (const field of ["venue", "buyer", "notes"] as const) {
    if (typeof body[field] === "string" || body[field] === null) {
      patch[field] = body[field] as string | null;
    }
  }

  const [row] = await db
    .update(soldArchiveItemsTable)
    .set(patch)
    .where(and(eq(soldArchiveItemsTable.id, id), eq(soldArchiveItemsTable.userId, req.userId!)))
    .returning();
  const displayCurrency =
    isValidCurrency(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : row!.saleCurrency;
  res.json(
    await archiveRowToResponse(row!, displayCurrency, await currentQuoteForArchive(row!)),
  );
});

router.post("/collection/archive/:id/restore", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const item = await db.transaction(async tx => {
    // Lock before insertion so concurrent restore attempts cannot duplicate the
    // active holding while racing to delete the same archive row.
    const [archiveRow] = await tx
      .select()
      .from(soldArchiveItemsTable)
      .where(and(eq(soldArchiveItemsTable.id, id), eq(soldArchiveItemsTable.userId, req.userId!)))
      .limit(1)
      .for("update");
    if (!archiveRow) return null;

    const [restored] = await tx
      .insert(collectionItemsTable)
      .values({
        userId: req.userId!,
        cardId: archiveRow.cardId,
        cardData: archiveRow.cardData as Record<string, unknown>,
        quantity: archiveRow.quantity,
        condition: archiveRow.condition ?? "near_mint",
        isGraded: archiveRow.isGraded,
        gradingData: (archiveRow.gradingData as Record<string, unknown> | null) ?? null,
        acquiredAt: archiveRow.acquiredAt ?? new Date().toISOString().slice(0, 10),
        acquiredPriceCents: archiveRow.acquiredPriceCents,
        acquiredCurrency: archiveRow.acquiredCurrency,
        notes: archiveRow.notes,
      })
      .returning();
    await tx.delete(soldArchiveItemsTable).where(eq(soldArchiveItemsTable.id, archiveRow.id));
    return restored!;
  });

  if (!item) {
    res.status(404).json({ message: "Archive item not found" });
    return;
  }

  void capturePortfolioSnapshot(req.userId!);
  res.status(201).json({
    id: item.id,
    cardId: item.cardId,
    card: item.cardData,
    quantity: item.quantity,
    condition: item.condition,
    grading: item.gradingData ?? undefined,
    acquiredAt: item.acquiredAt,
    acquiredPrice: item.acquiredPriceCents / 100,
    currency: item.acquiredCurrency,
    notes: item.notes ?? undefined,
  });
});

async function aggregateRealisedGain(
  rows: ArchiveRow[],
  displayCurrency: string,
): Promise<{ cents: number | null; count: number }> {
  let total = 0;
  for (const row of rows) {
    const sale = await convertCents(row.salePriceCents, row.saleCurrency, displayCurrency);
    const cost = await convertCents(
      row.acquiredPriceCents * row.quantity,
      row.acquiredCurrency,
      displayCurrency,
    );
    if (sale == null || cost == null) return { cents: null, count: rows.length };
    total += sale - cost;
  }
  return { cents: total, count: rows.length };
}

async function loadSnapshotMovements(userId: string, displayCurrency: string) {
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const snapshots = await db
    .select()
    .from(portfolioSnapshotsTable)
    .where(
      and(
        eq(portfolioSnapshotsTable.userId, userId),
        gte(portfolioSnapshotsTable.snapshotDate, thirtyOneDaysAgo),
      ),
    )
    .orderBy(asc(portfolioSnapshotsTable.snapshotDate));

  const converted = [];
  for (const snapshot of snapshots) {
    const value = await convertCents(snapshot.totalValueCents, snapshot.currency, displayCurrency);
    if (value != null) converted.push({ ...snapshot, value });
  }

  const latest = converted.at(-1);
  const previous = converted.at(-2);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const todayMovement =
    latest?.snapshotDate === today && previous?.snapshotDate === yesterday
      ? movement(previous.value, latest.value, previous.snapshotDate, latest.snapshotDate)
      : null;

  const cutoff = new Date(Date.now() - 29 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const first = converted[0];
  const movement30d =
    first && latest && first.snapshotDate <= cutoff && first.snapshotDate !== latest.snapshotDate
      ? movement(first.value, latest.value, first.snapshotDate, latest.snapshotDate)
      : null;
  return { todayMovement, movement30d };
}

router.get("/collection/summary", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const displayCurrency =
    typeof req.query["displayCurrency"] === "string" &&
    isValidCurrency(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : "AUD";
  const valuation = await calculatePortfolioValuation(req.userId!, displayCurrency);
  const soldRows = await db
    .select()
    .from(soldArchiveItemsTable)
    .where(eq(soldArchiveItemsTable.userId, req.userId!));
  const realised = await aggregateRealisedGain(soldRows, displayCurrency);
  await capturePortfolioSnapshot(req.userId!);
  const movements = await loadSnapshotMovements(req.userId!, displayCurrency);
  const ratio =
    valuation.totalHoldings > 0
      ? valuation.pricedHoldings / valuation.totalHoldings
      : 0;
  const completeness =
    valuation.totalHoldings === 0
      ? "No items in collection"
      : valuation.pricedHoldings === valuation.totalHoldings
        ? "All holdings priced"
        : valuation.pricedHoldings === 0
          ? "No pricing data available"
          : `${valuation.pricedHoldings} of ${valuation.totalHoldings} holdings priced (${Math.round(ratio * 100)}%)`;

  res.json({
    totalValue: dollars(valuation.totalValueCents),
    totalValueCents: valuation.totalValueCents,
    totalCost: dollars(valuation.totalCostCents),
    totalCostCents: valuation.totalCostCents,
    totalGain: dollars(valuation.unrealizedGainCents),
    totalGainPercent: valuation.unrealizedGainPercent,
    unrealizedGain: dollars(valuation.unrealizedGainCents),
    unrealizedGainCents: valuation.unrealizedGainCents,
    unrealizedGainPercent: valuation.unrealizedGainPercent,
    realisedGain: dollars(realised.cents),
    realisedGainCents: realised.cents,
    currency: displayCurrency,
    cardCount: valuation.cardCount,
    uniqueCardCount: valuation.uniqueCardCount,
    coverage: {
      pricedHoldings: valuation.pricedHoldings,
      totalHoldings: valuation.totalHoldings,
      ratio,
      freshHoldings: valuation.freshHoldings,
      staleHoldings: valuation.staleHoldings,
    },
    valuationComplete: valuation.valuationComplete,
    costBasisComplete: valuation.costBasisComplete,
    todayMovement: movements.todayMovement,
    movement30d: movements.movement30d,
    completeness,
  });
});

const PERFORMANCE_RANGES: Record<string, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "ALL": 36_500,
};

router.get("/collection/performance", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const requestedRange =
    typeof req.query["range"] === "string" ? req.query["range"].toUpperCase() : "1M";
  const range = PERFORMANCE_RANGES[requestedRange] ? requestedRange : "1M";
  const displayCurrency =
    typeof req.query["displayCurrency"] === "string" &&
    isValidCurrency(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : "AUD";
  const sinceDate = new Date(Date.now() - PERFORMANCE_RANGES[range]! * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);

  await capturePortfolioSnapshot(req.userId!);
  const [snapshots, soldRows, valuation] = await Promise.all([
    db
      .select()
      .from(portfolioSnapshotsTable)
      .where(
        and(
          eq(portfolioSnapshotsTable.userId, req.userId!),
          gte(portfolioSnapshotsTable.snapshotDate, sinceDate),
        ),
      )
      .orderBy(asc(portfolioSnapshotsTable.snapshotDate)),
    db
      .select()
      .from(soldArchiveItemsTable)
      .where(eq(soldArchiveItemsTable.userId, req.userId!)),
    calculatePortfolioValuation(req.userId!, displayCurrency),
  ]);

  const points = [];
  let historyConversionComplete = true;
  for (const snapshot of snapshots) {
    const [valueCents, costCents] = await Promise.all([
      convertCents(snapshot.totalValueCents, snapshot.currency, displayCurrency),
      convertCents(snapshot.totalCostCents, snapshot.currency, displayCurrency),
    ]);
    if (valueCents == null || costCents == null) {
      historyConversionComplete = false;
      continue;
    }
    points.push({
      date: snapshot.snapshotDate,
      value: valueCents / 100,
      valueCents,
      cost: costCents / 100,
      costCents,
      currency: displayCurrency,
    });
  }

  const realised = await aggregateRealisedGain(soldRows, displayCurrency);
  const performers = valuation.holdings
    .filter(
      holding =>
        holding.currentValueCents != null &&
        holding.costBasisCents != null &&
        holding.costBasisCents > 0,
    )
    .map(holding => {
      const card = holding.row.cardData as Record<string, unknown>;
      const gain = holding.currentValueCents! - holding.costBasisCents!;
      return {
        cardId: holding.row.cardId,
        name: String(card["name"] ?? holding.row.cardId),
        image: typeof card["image"] === "string" ? card["image"] : undefined,
        gain: gain / 100,
        gainPercent: (gain / holding.costBasisCents!) * 100,
        currentValue: holding.currentValueCents! / 100,
        costBasis: holding.costBasisCents! / 100,
      };
    })
    .sort((a, b) => b.gainPercent - a.gainPercent);

  const allocationTotals = new Map<string, number>();
  for (const holding of valuation.holdings) {
    if (holding.currentValueCents == null) continue;
    const card = holding.row.cardData as Record<string, unknown>;
    const label = String(card["tcg"] ?? card["game"] ?? "Other");
    allocationTotals.set(label, (allocationTotals.get(label) ?? 0) + holding.currentValueCents);
  }
  const allocationValue = [...allocationTotals.values()].reduce((sum, value) => sum + value, 0);
  const allocations = [...allocationTotals.entries()]
    .map(([name, valueCents]) => ({
      name,
      value: valueCents / 100,
      percentage: allocationValue > 0 ? (valueCents / allocationValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const historyAvailable = points.length >= 2 && historyConversionComplete;
  res.json({
    range,
    currency: displayCurrency,
    historyAvailable,
    historyUnavailableReason: historyAvailable
      ? null
      : !historyConversionComplete
        ? "Historical values could not be converted to the selected currency"
        : "At least two complete daily portfolio snapshots are required",
    points,
    history: points,
    totalValue: dollars(valuation.totalValueCents),
    costBasis: dollars(valuation.totalCostCents),
    realisedGain: dollars(realised.cents),
    realisedCount: realised.count,
    unrealizedGain: dollars(valuation.unrealizedGainCents),
    unrealizedGainPercent: valuation.unrealizedGainPercent,
    topPerformers: performers.slice(0, 5),
    worstPerformers: performers.slice(-5).reverse(),
    bottomPerformers: performers.slice(-5).reverse(),
    allocations,
    coverage: {
      pricedHoldings: valuation.pricedHoldings,
      totalHoldings: valuation.totalHoldings,
      ratio:
        valuation.totalHoldings > 0
          ? valuation.pricedHoldings / valuation.totalHoldings
          : 0,
    },
    completeness:
      valuation.pricedHoldings === valuation.totalHoldings && valuation.totalHoldings > 0
        ? "All holdings priced"
        : valuation.pricedHoldings > 0
          ? `${valuation.pricedHoldings} of ${valuation.totalHoldings} holdings priced`
          : "No pricing data available",
  });
});

export default router;