import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, wishlistItemsTable } from "@workspace/db/schema";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";

const wishlistRouter = Router();

type CardSnapshot = Record<string, unknown>;
type WishlistBody = {
  id?: unknown;
  cardId?: unknown;
  card?: unknown;
  desiredGrade?: unknown;
  targetPrice?: unknown;
  currency?: unknown;
  priceAlertEnabled?: unknown;
  alertType?: unknown;
  addedAt?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): {
  id: string;
  cardId: string;
  card?: CardSnapshot;
  desiredGrade?: string;
  targetPrice?: number;
  currency: string;
  priceAlertEnabled: boolean;
  alertType?: string;
  addedAt?: Date;
} | null {
  if (!isRecord(body)) return null;
  const value = body as WishlistBody;
  if (typeof value.id !== "string" || typeof value.cardId !== "string") return null;
  if (value.card !== undefined && !isRecord(value.card)) return null;
  if (value.targetPrice !== undefined && (typeof value.targetPrice !== "number" || !Number.isFinite(value.targetPrice))) return null;
  if (value.priceAlertEnabled !== undefined && typeof value.priceAlertEnabled !== "boolean") return null;

  const addedAt = value.addedAt === undefined ? undefined : new Date(String(value.addedAt));
  if (addedAt && Number.isNaN(addedAt.getTime())) return null;

  return {
    id: value.id,
    cardId: value.cardId,
    card: value.card as CardSnapshot | undefined,
    desiredGrade: typeof value.desiredGrade === "string" ? value.desiredGrade : undefined,
    targetPrice: typeof value.targetPrice === "number" ? value.targetPrice : undefined,
    currency: typeof value.currency === "string" ? value.currency : "AUD",
    priceAlertEnabled: value.priceAlertEnabled === true,
    alertType: typeof value.alertType === "string" ? value.alertType : undefined,
    addedAt,
  };
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

function toClientItem(row: typeof wishlistItemsTable.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    cardId: row.cardId,
    card: row.cardSnapshot,
    desiredGrade: row.desiredGrade ?? undefined,
    targetPrice: row.targetPrice === null ? undefined : Number(row.targetPrice),
    addedAt: row.addedAt.toISOString(),
    priceAlertEnabled: row.priceAlertEnabled,
    alertType: row.alertType ?? undefined,
  };
}

wishlistRouter.use(requireAuth);

wishlistRouter.get("/wishlist", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const rows = await db.select().from(wishlistItemsTable)
    .where(eq(wishlistItemsTable.userId, req.user!.id))
    .orderBy(asc(wishlistItemsTable.addedAt));
  res.json({ items: rows.map(toClientItem) });
});

wishlistRouter.post("/wishlist/sync", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  if (!Array.isArray(req.body?.items)) {
    res.status(400).json({ error: "body.items must be an array" });
    return;
  }

  const parsed = (req.body.items as unknown[]).map(parseBody);
  if (parsed.some((item): item is null => item === null)) {
    res.status(400).json({ error: "items contain an invalid wishlist shape" });
    return;
  }
  const items = parsed.filter((item): item is NonNullable<typeof item> => item !== null);

  for (const item of items) {
    await db.insert(wishlistItemsTable).values({
      id: item.id,
      userId: req.user!.id,
      cardId: item.cardId,
      cardSnapshot: item.card,
      desiredGrade: item.desiredGrade,
      targetPrice: item.targetPrice?.toFixed(2),
      currency: item.currency,
      priceAlertEnabled: item.priceAlertEnabled,
      alertType: item.alertType,
      addedAt: item.addedAt,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: wishlistItemsTable.id,
      set: {
        cardId: item.cardId,
        cardSnapshot: item.card,
        desiredGrade: item.desiredGrade,
        targetPrice: item.targetPrice?.toFixed(2),
        currency: item.currency,
        priceAlertEnabled: item.priceAlertEnabled,
        alertType: item.alertType,
        updatedAt: new Date(),
      },
      // IDs are globally unique, so an item cannot be overwritten across users.
      where: eq(wishlistItemsTable.userId, req.user!.id),
    });
  }

  const rows = await db.select().from(wishlistItemsTable)
    .where(eq(wishlistItemsTable.userId, req.user!.id))
    .orderBy(asc(wishlistItemsTable.addedAt));
  res.json({ ok: true, items: rows.map(toClientItem), count: rows.length });
});

wishlistRouter.post("/wishlist", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const item = parseBody(req.body);
  if (!item) {
    res.status(400).json({ error: "body must include a valid id and cardId" });
    return;
  }

  await db.insert(wishlistItemsTable).values({
    id: item.id,
    userId: req.user!.id,
    cardId: item.cardId,
    cardSnapshot: item.card,
    desiredGrade: item.desiredGrade,
    targetPrice: item.targetPrice?.toFixed(2),
    currency: item.currency,
    priceAlertEnabled: item.priceAlertEnabled,
    alertType: item.alertType,
    addedAt: item.addedAt,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: wishlistItemsTable.id,
    set: { cardId: item.cardId, cardSnapshot: item.card, desiredGrade: item.desiredGrade, targetPrice: item.targetPrice?.toFixed(2), currency: item.currency, priceAlertEnabled: item.priceAlertEnabled, alertType: item.alertType, updatedAt: new Date() },
    where: eq(wishlistItemsTable.userId, req.user!.id),
  });
  res.status(201).json({ ok: true });
});

wishlistRouter.patch("/wishlist/:id", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const id = req.params.id;
  const patch = req.body as Record<string, unknown>;
  const values: Partial<typeof wishlistItemsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.desiredGrade !== undefined && typeof patch.desiredGrade === "string") values.desiredGrade = patch.desiredGrade;
  if (patch.targetPrice !== undefined && typeof patch.targetPrice === "number" && Number.isFinite(patch.targetPrice)) values.targetPrice = patch.targetPrice.toFixed(2);
  if (patch.priceAlertEnabled !== undefined && typeof patch.priceAlertEnabled === "boolean") values.priceAlertEnabled = patch.priceAlertEnabled;
  if (patch.alertType !== undefined && typeof patch.alertType === "string") values.alertType = patch.alertType;

  const updated = await db.update(wishlistItemsTable).set(values).where(and(eq(wishlistItemsTable.id, String(id)), eq(wishlistItemsTable.userId, req.user!.id))).returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  res.json({ ok: true, item: toClientItem(updated[0]) });
});

wishlistRouter.delete("/wishlist/:id", async (req: AuthenticatedRequest, res) => {
  await ensureUser(req.user!);
  const removed = await db.delete(wishlistItemsTable).where(and(eq(wishlistItemsTable.id, String(req.params.id)), eq(wishlistItemsTable.userId, req.user!.id))).returning({ id: wishlistItemsTable.id });
  res.json({ ok: true, removed: removed.length });
});

export default wishlistRouter;
