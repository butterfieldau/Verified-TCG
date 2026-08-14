/**
 * Wishlist routes — per-user, JWT-authenticated.
 *
 * Storage: in-memory Map as fast primary read cache +
 * PostgreSQL wishlist_items table as the durable source of truth.
 *
 * Durability contract:
 *   - All mutations await the DB write before returning 2xx, so a caller
 *     receiving success can rely on persistence surviving a server restart.
 *   - Deletions use a soft-delete (deleted_at column) rather than row removal
 *     so tombstones are durable; a sync from a stale client cannot resurrect
 *     a deleted item even after a server restart.
 *   - Every route hydrates from DB before mutating when the user's data is
 *     absent from the in-memory cache, preventing a post-restart mutation
 *     from overwriting persisted data with an empty baseline.
 *   - The sync endpoint wraps all DB upserts in a single transaction.
 */

import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { db } from "@workspace/db";
import { wishlistItemsTable } from "@workspace/db";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";

const wishlistRouter = Router();

// ── Types ────────────────────────────────────────────────────────────────────

interface CardPrice {
  raw: number;
  formatted: string;
  currency: string;
}

interface Card {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  rarity: string;
  image: string;
  price: CardPrice;
  [key: string]: unknown;
}

interface WishlistItem {
  id: string;
  cardId: string;
  card: Card;
  desiredGrade?: string;
  targetPrice?: number;
  addedAt: string;
  priceAlertEnabled?: boolean;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
// Caches ACTIVE items only (deleted_at IS NULL). Populated on first access
// and kept in sync with every mutation.

const cache = new Map<string, WishlistItem[]>();

export function clearUserWishlists(userId: string): void {
  cache.delete(userId);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function rowToItem(row: typeof wishlistItemsTable.$inferSelect): WishlistItem {
  return {
    id: row.itemId,
    cardId: row.cardId,
    card: row.cardData as Card,
    desiredGrade: row.desiredGrade ?? undefined,
    targetPrice: row.targetPrice != null ? row.targetPrice / 100 : undefined,
    addedAt: row.addedAt,
    priceAlertEnabled: row.priceAlertEnabled,
  };
}

function itemToInsert(userId: string, item: WishlistItem): InferInsertModel<typeof wishlistItemsTable> {
  return {
    userId,
    itemId: item.id,
    cardId: item.cardId,
    cardData: item.card as Record<string, unknown>,
    desiredGrade: item.desiredGrade ?? null,
    targetPrice: item.targetPrice != null ? Math.round(item.targetPrice * 100) : null,
    priceAlertEnabled: item.priceAlertEnabled ?? false,
    addedAt: item.addedAt,
    deletedAt: null,
  };
}

/**
 * Load active wishlist items from the DB into the in-memory cache when the
 * cache is absent (e.g. after a server restart). No-op when cache is present.
 */
async function hydrateIfNeeded(userId: string): Promise<void> {
  if (cache.has(userId)) return;

  const rows = await db
    .select()
    .from(wishlistItemsTable)
    .where(
      and(
        eq(wishlistItemsTable.userId, userId),
        isNull(wishlistItemsTable.deletedAt),
      ),
    );

  cache.set(userId, rows.map(rowToItem));
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/wishlist — current wishlist for the authenticated collector */
wishlistRouter.get("/wishlist", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  await hydrateIfNeeded(userId);
  const items = cache.get(userId) ?? [];
  res.json({ items });
});

/**
 * POST /api/wishlist/sync
 *
 * Merge-sync client items into the server state:
 *   - Client items whose item_id is DB-tombstoned (deleted_at IS NOT NULL) are
 *     silently dropped — durable tombstone wins over stale-client resurrection.
 *   - Client items that exist in the DB (active) have their editable fields
 *     updated (card data, grade, price preferences).
 *   - Client items not in the DB at all are inserted as new.
 *   - Server-only items (from other devices) are preserved untouched.
 * All writes are wrapped in a single DB transaction.
 * Returns the canonical merged active list.
 *
 * Body: { items: WishlistItem[] }
 */
wishlistRouter.post("/wishlist/sync", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { items: clientItems } = req.body as { items: WishlistItem[] };

  if (!Array.isArray(clientItems)) {
    res.status(400).json({ error: "body.items must be an array" });
    return;
  }

  // Get current DB state (active + tombstoned) for this user
  const allRows = await db
    .select()
    .from(wishlistItemsTable)
    .where(eq(wishlistItemsTable.userId, userId));

  const activeById = new Map(
    allRows.filter((r) => r.deletedAt === null).map((r) => [r.itemId, r]),
  );
  const tombstonedIds = new Set(
    allRows.filter((r) => r.deletedAt !== null).map((r) => r.itemId),
  );

  // Filter out tombstoned items from client
  const liveClientItems = clientItems.filter((i) => !tombstonedIds.has(i.id));

  // Compute upserts: update matching active rows, insert genuinely new ones
  const toUpsert = liveClientItems.map((item) => itemToInsert(userId, item));

  if (toUpsert.length > 0) {
    await db.transaction(async (tx) => {
      for (const row of toUpsert) {
        await tx
          .insert(wishlistItemsTable)
          .values(row)
          .onConflictDoUpdate({
            target: [wishlistItemsTable.userId, wishlistItemsTable.itemId],
            set: {
              cardId: row.cardId,
              cardData: row.cardData,
              desiredGrade: row.desiredGrade,
              targetPrice: row.targetPrice,
              priceAlertEnabled: row.priceAlertEnabled,
              addedAt: row.addedAt,
              deletedAt: null, // un-delete if somehow re-synced
              updatedAt: new Date(),
            },
          });
      }
    });
  }

  // Re-read canonical active state from DB
  const finalRows = await db
    .select()
    .from(wishlistItemsTable)
    .where(
      and(
        eq(wishlistItemsTable.userId, userId),
        isNull(wishlistItemsTable.deletedAt),
      ),
    );

  // Merge: server rows already include server-only items + just-upserted items
  // Also preserve any server items that exist in activeById but weren't in client list
  const serverOnlyItems = [...activeById.values()]
    .filter((r) => !liveClientItems.some((c) => c.id === r.itemId))
    .map(rowToItem);

  const merged = [...finalRows.map(rowToItem)];
  cache.set(userId, merged);

  res.json({ ok: true, items: merged, count: merged.length });
});

/**
 * POST /api/wishlist
 * Add or update a single item (upsert by item_id). Durable.
 */
wishlistRouter.post("/wishlist", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const item = req.body as WishlistItem;

  if (!item?.id || !item?.cardId) {
    res.status(400).json({ error: "body must include id and cardId" });
    return;
  }

  const row = itemToInsert(userId, item);

  await db
    .insert(wishlistItemsTable)
    .values(row)
    .onConflictDoUpdate({
      target: [wishlistItemsTable.userId, wishlistItemsTable.itemId],
      set: {
        cardId: row.cardId,
        cardData: row.cardData,
        desiredGrade: row.desiredGrade,
        targetPrice: row.targetPrice,
        priceAlertEnabled: row.priceAlertEnabled,
        addedAt: row.addedAt,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });

  // Update cache after confirmed DB write
  await hydrateIfNeeded(userId);
  const existing = cache.get(userId) ?? [];
  const updated = existing.some((i) => i.id === item.id)
    ? existing.map((i) => (i.id === item.id ? item : i))
    : [...existing, item];
  cache.set(userId, updated);

  res.status(201).json({ ok: true, item });
});

/**
 * PATCH /api/wishlist/:id
 * Update editable fields of a single active item.
 */
wishlistRouter.patch("/wishlist/:id", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const id = typeof req.params.id === "string" ? req.params.id : String(req.params.id);
  const patch = req.body as Partial<
    Pick<WishlistItem, "desiredGrade" | "targetPrice" | "priceAlertEnabled">
  >;

  await hydrateIfNeeded(userId);

  const existing = cache.get(userId) ?? [];
  const item = existing.find((i) => i.id === id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if ("desiredGrade" in patch) setValues.desiredGrade = patch.desiredGrade ?? null;
  if ("targetPrice" in patch) {
    setValues.targetPrice = patch.targetPrice != null
      ? Math.round(patch.targetPrice * 100)
      : null;
  }
  if ("priceAlertEnabled" in patch) setValues.priceAlertEnabled = patch.priceAlertEnabled;

  await db
    .update(wishlistItemsTable)
    .set(setValues)
    .where(
      and(
        eq(wishlistItemsTable.userId, userId),
        eq(wishlistItemsTable.itemId, id),
        isNull(wishlistItemsTable.deletedAt),
      ),
    );

  const patched = { ...item, ...patch };
  cache.set(userId, existing.map((i) => (i.id === id ? patched : i)));

  res.json({ ok: true, item: patched });
});

/**
 * DELETE /api/wishlist/:id
 * Soft-delete: sets deleted_at so the tombstone survives server restarts.
 */
wishlistRouter.delete("/wishlist/:id", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const id = typeof req.params.id === "string" ? req.params.id : String(req.params.id);

  // Soft-delete in DB first — durable tombstone
  const result = await db
    .update(wishlistItemsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(wishlistItemsTable.userId, userId),
        eq(wishlistItemsTable.itemId, id),
      ),
    )
    .returning({ itemId: wishlistItemsTable.itemId });

  // Update cache after confirmed DB write
  await hydrateIfNeeded(userId);
  const existing = cache.get(userId) ?? [];
  cache.set(userId, existing.filter((i) => i.id !== id));

  res.json({ ok: true, removed: result.length });
});

export default wishlistRouter;
