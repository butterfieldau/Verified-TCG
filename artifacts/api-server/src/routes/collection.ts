import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { collectionItemsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET must be set");

// ── Auth middleware ───────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  userId?: string;
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization header required" });
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET as string) as { sub: string };
    req.userId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a DB row back to the CollectionItem shape the mobile app expects. */
function rowToItem(row: typeof collectionItemsTable.$inferSelect) {
  return {
    id: row.id,
    cardId: row.cardId,
    card: row.cardData,
    quantity: row.quantity,
    condition: row.condition,
    grading: row.gradingData ?? undefined,
    acquiredAt: row.acquiredAt,
    acquiredPrice: row.acquiredPriceCents / 100,
    currency: "AUD" as const,
    notes: row.notes ?? undefined,
    isForSale: row.isForSale,
    isForTrade: row.isForTrade,
  };
}

// ── GET /api/collection ───────────────────────────────────────────────────────

router.get("/collection", requireAuth, async (req: AuthRequest, res) => {
  const rows = await db
    .select()
    .from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, req.userId!))
    .orderBy(collectionItemsTable.createdAt);

  return res.json(rows.map(rowToItem));
});

// ── GET /api/collection/summary ───────────────────────────────────────────────

router.get("/collection/summary", requireAuth, async (req: AuthRequest, res) => {
  const rows = await db
    .select()
    .from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, req.userId!));

  let totalValue = 0;
  let totalCost = 0;
  let cardCount = 0;
  const cardIds = new Set<string>();

  for (const row of rows) {
    const card = row.cardData as Record<string, any>;
    const price = card?.price;
    let unitValue = price?.raw ?? 0;

    // Use grading-specific price if available
    if (row.isGraded && row.gradingData) {
      const g = row.gradingData as Record<string, any>;
      const company = g?.company;
      const grade = Number(g?.grade);
      if (company === "PSA") {
        if (grade === 10 && price?.psa10) unitValue = price.psa10;
        else if (grade === 9 && price?.psa9) unitValue = price.psa9;
      } else if (company === "BGS" || company === "Beckett") {
        if (grade === 9.5 && price?.bgs95) unitValue = price.bgs95;
        else if (grade === 9 && price?.bgs9) unitValue = price.bgs9;
      } else if (company === "CGC") {
        if (grade === 10 && price?.cgc10) unitValue = price.cgc10;
        else if (grade === 9 && price?.cgc9) unitValue = price.cgc9;
      }
    }

    totalValue += unitValue * row.quantity;
    totalCost += (row.acquiredPriceCents / 100) * row.quantity;
    cardCount += row.quantity;
    cardIds.add(row.cardId);
  }

  const totalGain = totalValue - totalCost;
  const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  return res.json({
    totalValue,
    totalCost,
    totalGain,
    totalGainPercent,
    currency: "AUD",
    cardCount,
    uniqueCardCount: cardIds.size,
  });
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

  return null;
}

// ── POST /api/collection ──────────────────────────────────────────────────────

router.post("/collection", requireAuth, async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;

  const validationError = validatePostBody(body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const acquiredPrice = (body.acquiredPrice as number | undefined) ?? 0;
  const acquiredPriceCents = Math.round(acquiredPrice * 100);

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
      notes: (body.notes as string | undefined) ?? null,
      isForSale: !!(body.isForSale),
      isForTrade: !!(body.isForTrade),
    })
    .returning();

  return res.status(201).json(rowToItem(row));
});

// ── PATCH /api/collection/:id ─────────────────────────────────────────────────

router.patch("/collection/:id", requireAuth, async (req: AuthRequest, res) => {
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

  const [row] = await db
    .update(collectionItemsTable)
    .set(patch)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .returning();

  return res.json(rowToItem(row));
});

// ── DELETE /api/collection/:id ────────────────────────────────────────────────

router.delete("/collection/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = String(req.params["id"] ?? "");
  if (!id) return res.status(400).json({ message: "id is required" });

  const deleted = await db
    .delete(collectionItemsTable)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .returning({ id: collectionItemsTable.id });

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Item not found" });
  }

  return res.json({ message: "Deleted" });
});

export default router;
