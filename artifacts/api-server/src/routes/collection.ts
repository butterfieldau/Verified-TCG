import { Router } from "express";
import { db } from "@workspace/db";
import { collectionItemsTable, currentQuotesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { logActivity } from "./activity.js";
import { PROVIDER_KEY } from "../pricing/pricecharting.js";
import { gradeKeyForHolding } from "../pricing/portfolio.js";
import { normalizeGradeKey } from "../pricing/grades.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a DB row back to the CollectionItem shape the mobile app expects. */
function rowToItem(
  row: typeof collectionItemsTable.$inferSelect,
  valuation?: { priceCents: number; currency: string; gradeKey: string; fetchedAt: Date } | null,
) {
  return {
    id: row.id,
    cardId: row.cardId,
    card: row.cardData,
    quantity: row.quantity,
    condition: row.condition,
    grading: row.gradingData ?? undefined,
    acquiredAt: row.acquiredAt,
    acquiredPrice: row.acquiredPriceCents / 100,
    // Preserve acquisition currency (defaults AUD for legacy rows)
    currency: (row.acquiredCurrency ?? "AUD") as string,
    notes: row.notes ?? undefined,
    isForSale: row.isForSale,
    isForTrade: row.isForTrade,
    // Valuation from PriceCharting (nullable — never zero when missing)
    valuation: valuation
      ? {
          priceCents: valuation.priceCents,
          price: valuation.priceCents / 100,
          currency: valuation.currency,
          gradeKey: valuation.gradeKey,
          updatedAt: valuation.fetchedAt.toISOString(),
        }
      : null,
  };
}

// ── GET /api/collection ───────────────────────────────────────────────────────

router.get("/collection", requireActiveUser, async (req: AuthRequest, res) => {
  const pageParam = req.query["page"];
  const limitParam = req.query["limit"];

  // Paginated mode when either param is provided
  const isPaginated = pageParam !== undefined || limitParam !== undefined;

  if (isPaginated) {
    const limit = Math.min(Math.max(parseInt(String(limitParam ?? "20"), 10) || 20, 1), 100);
    const page = Math.max(parseInt(String(pageParam ?? "1"), 10) || 1, 1);
    const offset = (page - 1) * limit;

    const [countResult, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!)),
      db
        .select()
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!))
        .orderBy(collectionItemsTable.createdAt)
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    // Fetch valuations for this page
    const cardIds = rows.map(r => r.cardId);
    const quotes = cardIds.length > 0
      ? await db
          .select()
          .from(currentQuotesTable)
          .where(eq(currentQuotesTable.providerKey, PROVIDER_KEY))
      : [];

    const quoteMap = new Map<string, typeof currentQuotesTable.$inferSelect>();
    for (const q of quotes) {
      if (!cardIds.includes(q.cardId)) continue;
      const gradeKey = normalizeGradeKey(q.gradeKey);
      if (gradeKey) quoteMap.set(`${q.cardId}:${gradeKey}`, q);
    }

    return res.json({
      items: rows.map(row => {
        const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
        const q = gradeKey ? quoteMap.get(`${row.cardId}:${gradeKey}`) : null;
        return rowToItem(row, q ?? null);
      }),
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    });
  }

  // Non-paginated (backward-compatible) — return full list as array
  const rows = await db
    .select()
    .from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, req.userId!))
    .orderBy(collectionItemsTable.createdAt);

  // Fetch valuations for all items
  const cardIds = rows.map(r => r.cardId);
  const quotes = cardIds.length > 0
    ? await db
        .select()
        .from(currentQuotesTable)
        .where(eq(currentQuotesTable.providerKey, PROVIDER_KEY))
    : [];

  const quoteMap = new Map<string, typeof currentQuotesTable.$inferSelect>();
  for (const q of quotes) {
    if (!cardIds.includes(q.cardId)) continue;
    const gradeKey = normalizeGradeKey(q.gradeKey);
    if (gradeKey) quoteMap.set(`${q.cardId}:${gradeKey}`, q);
  }

  return res.json(rows.map(row => {
    const gradeKey = gradeKeyForHolding(row.isGraded, row.gradingData);
    const q = gradeKey ? quoteMap.get(`${row.cardId}:${gradeKey}`) : null;
    return rowToItem(row, q ?? null);
  }));
});

// ── Validation helpers ────────────────────────────────────────────────────────

// Must match CardCondition in artifacts/verified-tcg/types/index.ts
const VALID_CONDITIONS = new Set([
  "mint", "near_mint", "excellent", "good", "light_played", "played", "poor",
]);

function isValidDateString(s: string): boolean {
  // Accept ISO date (YYYY-MM-DD) or ISO datetime
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s));
}

function validatePostBody(body: Record<string, unknown>): string | null {
  if (!body.cardId || typeof body.cardId !== "string") return "cardId is required";
  if (!body.card || typeof body.card !== "object") return "card object is required";
  if (!body.acquiredAt || typeof body.acquiredAt !== "string") return "acquiredAt is required";
  if (!isValidDateString(body.acquiredAt)) return "acquiredAt must be a valid ISO date string";

  const qty = body.quantity as number | undefined;
  if (qty !== undefined) {
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999)
      return "quantity must be a positive integer between 1 and 9999";
  }

  const price = body.acquiredPrice as number | undefined;
  if (price !== undefined) {
    if (!Number.isFinite(price) || price < 0)
      return "acquiredPrice must be a non-negative finite number";
  }

  const cond = body.condition as string | undefined;
  if (cond !== undefined && !VALID_CONDITIONS.has(cond))
    return `condition must be one of: ${[...VALID_CONDITIONS].join(", ")}`;

  const notes = body.notes as string | undefined;
  if (notes !== undefined && notes.length > 2000)
    return "notes must not exceed 2000 characters";

  const currency = body.currency as string | undefined;
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency))
    return "currency must be a 3-letter ISO currency code";

  return null;
}

function validatePatchBody(body: Record<string, unknown>): string | null {
  const qty = body.quantity as number | undefined;
  if (qty !== undefined) {
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999)
      return "quantity must be a positive integer between 1 and 9999";
  }

  const price = body.acquiredPrice as number | undefined;
  if (price !== undefined) {
    if (!Number.isFinite(price) || price < 0)
      return "acquiredPrice must be a non-negative finite number";
  }

  const cond = body.condition as string | undefined;
  if (cond !== undefined && !VALID_CONDITIONS.has(cond))
    return `condition must be one of: ${[...VALID_CONDITIONS].join(", ")}`;

  const notes = body.notes as string | undefined;
  if (notes !== undefined && notes.length > 2000)
    return "notes must not exceed 2000 characters";

  const currency = body.currency as string | undefined;
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency))
    return "currency must be a 3-letter ISO currency code";

  return null;
}

// ── POST /api/collection ──────────────────────────────────────────────────────

router.post("/collection", requireActiveUser, async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;

  const validationError = validatePostBody(body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const acquiredPrice = (body.acquiredPrice as number | undefined) ?? 0;
  const acquiredPriceCents = Math.round(acquiredPrice * 100);
  const acquiredCurrency = typeof body.currency === "string"
    ? body.currency.toUpperCase()
    : "AUD";

  const [row] = await db
    .insert(collectionItemsTable)
    .values({
      userId: req.userId!,
      cardId: body.cardId as string,
      cardData: body.card as Record<string, unknown>,
      quantity: (body.quantity as number | undefined) ?? 1,
      condition: (body.condition as string | undefined) ?? "near_mint",
      isGraded: !!(body.grading),
      gradingData: (body.grading as Record<string, unknown> | null | undefined) ?? null,
      acquiredAt: body.acquiredAt as string,
      acquiredPriceCents,
      acquiredCurrency,
      notes: (body.notes as string | undefined) ?? null,
      isForSale: !!(body.isForSale),
      isForTrade: !!(body.isForTrade),
    })
    .returning();

  // Log activity — fire-and-forget
  const cardName = (body.card as Record<string, unknown>)?.name as string | undefined;
  logActivity(req.userId!, "card_added", body.cardId as string, cardName ?? null, {
    cardImageUrl: ((body.card as Record<string, unknown>)?.image as string | undefined) ?? null,
  });

  return res.status(201).json(rowToItem(row));
});

// ── PATCH /api/collection/:id ─────────────────────────────────────────────────

router.patch("/collection/:id", requireActiveUser, async (req: AuthRequest, res) => {
  const id = String(req.params["id"] ?? "");
  if (!id) return res.status(400).json({ message: "id is required" });

  const body = req.body as Record<string, unknown>;
  const validationError = validatePatchBody(body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  // Verify ownership
  const [existing] = await db
    .select({ id: collectionItemsTable.id })
    .from(collectionItemsTable)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .limit(1);

  if (!existing) {
    return res.status(404).json({ message: "Item not found" });
  }

  const patch: Partial<typeof collectionItemsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.quantity !== undefined) patch.quantity = body.quantity as number;
  if (body.condition !== undefined) patch.condition = body.condition as string;
  if ("grading" in body) {
    patch.gradingData = (body.grading as Record<string, unknown> | null | undefined) ?? null;
    patch.isGraded = !!body.grading;
  }
  if (body.notes !== undefined) patch.notes = body.notes as string;
  if (body.isForSale !== undefined) patch.isForSale = !!(body.isForSale);
  if (body.isForTrade !== undefined) patch.isForTrade = !!(body.isForTrade);
  if (body.acquiredPrice !== undefined) {
    patch.acquiredPriceCents = Math.round((body.acquiredPrice as number) * 100);
  }
  if (typeof body.currency === "string") {
    patch.acquiredCurrency = body.currency.toUpperCase();
  }

  const [row] = await db
    .update(collectionItemsTable)
    .set(patch)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .returning();

  // Log activity — fire-and-forget
  const rowCard = row.cardData as Record<string, unknown> | null;
  logActivity(req.userId!, "collection_updated", row.cardId, rowCard?.name as string ?? null, {
    cardImageUrl: (rowCard?.image as string | undefined) ?? null,
  });

  return res.json(rowToItem(row));
});

// ── DELETE /api/collection/:id ────────────────────────────────────────────────

router.delete("/collection/:id", requireActiveUser, async (req: AuthRequest, res) => {
  const id = String(req.params["id"] ?? "");
  if (!id) return res.status(400).json({ message: "id is required" });

  const deleted = await db
    .delete(collectionItemsTable)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .returning({ id: collectionItemsTable.id });

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Item not found" });
  }

  // Log activity — fire-and-forget (entity name not available after deletion)
  logActivity(req.userId!, "card_removed", id, null);

  return res.json({ message: "Deleted" });
});

export default router;
