import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "@workspace/db";
import { collectionItemsTable, usersTable } from "@workspace/db/schema";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const router = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureUser(user: NonNullable<AuthenticatedRequest["user"]>): Promise<void> {
  await db.insert(usersTable).values({
    id: user.id,
    email: user.email ?? `${user.id}@unknown.invalid`,
  }).onConflictDoUpdate({
    target: usersTable.id,
    set: { email: user.email ?? `${user.id}@unknown.invalid`, updatedAt: new Date() },
  });
}

function toClientItem(row: typeof collectionItemsTable.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    cardId: row.cardId,
    card: row.cardSnapshot,
    quantity: row.quantity,
    condition: row.condition,
    grading: row.grading,
    acquiredAt: row.acquiredAt ?? undefined,
    acquiredPrice: row.acquiredPrice === null ? 0 : Number(row.acquiredPrice),
    currency: row.currency,
    notes: row.notes ?? undefined,
    isForSale: row.isForSale,
    isForTrade: row.isForTrade,
  };
}

function parseItem(body: unknown): {
  id: string;
  cardId: string;
  card?: Record<string, unknown>;
  quantity: number;
  condition: string;
  grading?: unknown;
  acquiredAt?: string;
  acquiredPrice: number;
  currency: string;
  notes?: string;
  isForSale: boolean;
  isForTrade: boolean;
} | null {
  if (!isRecord(body)) return null;
  if (typeof body.id !== "string" || typeof body.cardId !== "string" || typeof body.condition !== "string") return null;
  const quantity = body.quantity === undefined ? 1 : body.quantity;
  const acquiredPrice = body.acquiredPrice === undefined ? 0 : body.acquiredPrice;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return null;
  if (typeof acquiredPrice !== "number" || !Number.isFinite(acquiredPrice)) return null;
  if (body.card !== undefined && !isRecord(body.card)) return null;
  if (body.acquiredAt !== undefined && typeof body.acquiredAt !== "string") return null;
  return {
    id: body.id,
    cardId: body.cardId,
    card: body.card as Record<string, unknown> | undefined,
    quantity,
    condition: body.condition,
    grading: body.grading,
    acquiredAt: body.acquiredAt,
    acquiredPrice,
    currency: typeof body.currency === "string" ? body.currency : "AUD",
    notes: typeof body.notes === "string" ? body.notes : undefined,
    isForSale: body.isForSale === true,
    isForTrade: body.isForTrade === true,
  };
}

router.use(requireAuth);

router.get("/collection", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const rows = await db.select().from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, req.user!.id))
    .orderBy(asc(collectionItemsTable.createdAt));
  res.json({ items: rows.map(toClientItem) });
});

router.post("/collection", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const item = parseItem(req.body);
  if (!item) {
    res.status(400).json({ error: "body must contain a valid collection item" });
    return;
  }
  await db.insert(collectionItemsTable).values({
    id: item.id,
    userId: req.user!.id,
    cardId: item.cardId,
    cardSnapshot: item.card,
    quantity: item.quantity,
    condition: item.condition,
    grading: item.grading,
    acquiredAt: item.acquiredAt,
    acquiredPrice: item.acquiredPrice.toFixed(2),
    currency: item.currency,
    notes: item.notes,
    isForSale: item.isForSale,
    isForTrade: item.isForTrade,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: collectionItemsTable.id,
    set: {
      cardId: item.cardId,
      cardSnapshot: item.card,
      quantity: item.quantity,
      condition: item.condition,
      grading: item.grading,
      acquiredAt: item.acquiredAt,
      acquiredPrice: item.acquiredPrice.toFixed(2),
      currency: item.currency,
      notes: item.notes,
      isForSale: item.isForSale,
      isForTrade: item.isForTrade,
      updatedAt: new Date(),
    },
    where: eq(collectionItemsTable.userId, req.user!.id),
  });
  res.status(201).json({ ok: true });
});

router.delete("/collection/:id", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const removed = await db.delete(collectionItemsTable)
    .where(and(eq(collectionItemsTable.id, String(req.params.id)), eq(collectionItemsTable.userId, req.user!.id)))
    .returning({ id: collectionItemsTable.id });
  res.json({ ok: true, removed: removed.length });
});

export default router;
