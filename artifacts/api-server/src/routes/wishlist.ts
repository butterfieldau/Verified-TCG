/**
 * Wishlist routes — per-user, JWT-authenticated.
 *
 * Every request must include a valid Bearer token in the Authorization header.
 * The user ID is extracted from the JWT's `sub` claim (never from request body
 * or query params) so each collector sees only their own data.
 *
 * Auth is enforced by the shared `requireActiveUser` middleware, which verifies
 * the JWT AND confirms the user still exists in the database. This means that
 * after account deletion, any still-valid access tokens are rejected on the
 * next request — the DB row is the source of truth, not the token TTL.
 *
 * Storage: in-memory Map keyed by user ID.  Data resets on server restart; the
 * mobile client treats AsyncStorage as the authoritative local cache and
 * re-syncs on every app launch, so the server quickly recovers the latest state.
 * Task #55 tracks migrating to PostgreSQL.
 */

import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

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

// ── In-memory store ───────────────────────────────────────────────────────────

const store = new Map<string, WishlistItem[]>();

/**
 * Tombstone set: records item IDs that have been explicitly deleted via DELETE.
 * Sync requests filter incoming items whose IDs appear here, preventing a
 * stale client list from resurrecting a deleted item.
 *
 * Tombstones are cleared when an item is explicitly re-added via POST, so a
 * collector can re-add a card they previously removed.
 */
const tombstones = new Map<string, Set<string>>();

/**
 * Clear all in-memory wishlist data for a user whose account has been deleted.
 * Called by the account-deletion route in auth.ts immediately before deleting
 * the DB user row.
 *
 * Token rejection is handled by requireActiveUser checking the DB — once the
 * user row is gone, any still-valid JWT will receive a 401 on the next request.
 */
export function clearUserWishlists(userId: string): void {
  store.delete(userId);
  tombstones.delete(userId);
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/wishlist
 * Returns the current wishlist for the authenticated collector.
 */
wishlistRouter.get("/wishlist", requireActiveUser, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const items = store.get(userId) ?? [];
  res.json({ items });
});

/**
 * POST /api/wishlist/sync
 *
 * Merges the client's items into the server state for the authenticated collector:
 *   - Client items replace matching server items (client has fresher field values)
 *   - Server-only items are preserved (items added from other devices)
 *   - Tombstoned IDs are stripped from the client list before merging, so a
 *     stale sync cannot resurrect an item that was explicitly deleted
 *
 * Returns the canonical merged list so the client can reconcile local state.
 * Body: { items: WishlistItem[] }
 */
wishlistRouter.post("/wishlist/sync", requireActiveUser, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { items: clientItems } = req.body as { items: WishlistItem[] };

  if (!Array.isArray(clientItems)) {
    res.status(400).json({ error: "body.items must be an array" });
    return;
  }

  const serverItems = store.get(userId) ?? [];
  const userTombstones = tombstones.get(userId) ?? new Set<string>();

  // Strip tombstoned IDs from the incoming client list
  const liveClientItems = clientItems.filter((i) => !userTombstones.has(i.id));

  // Build a client-item lookup for O(1) access
  const clientMap = new Map<string, WishlistItem>(
    liveClientItems.map((i) => [i.id, i]),
  );

  // Start with the server list; replace any item the client also has
  const merged: WishlistItem[] = serverItems.map((serverItem) =>
    clientMap.has(serverItem.id) ? clientMap.get(serverItem.id)! : serverItem,
  );

  // Append live client items the server doesn't know about yet
  const serverIds = new Set(serverItems.map((i) => i.id));
  for (const clientItem of liveClientItems) {
    if (!serverIds.has(clientItem.id)) {
      merged.push(clientItem);
    }
  }

  store.set(userId, merged);
  res.json({ ok: true, items: merged, count: merged.length });
});

/**
 * POST /api/wishlist
 * Adds or replaces a single item (idempotent by id).
 * Re-adding a tombstoned item clears the tombstone.
 * Body: WishlistItem
 */
wishlistRouter.post("/wishlist", requireActiveUser, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const item = req.body as WishlistItem;

  if (!item?.id || !item?.cardId) {
    res.status(400).json({ error: "body must include id and cardId" });
    return;
  }

  // Clear tombstone — the collector is intentionally re-adding this item
  const userTombstones = tombstones.get(userId);
  if (userTombstones?.has(item.id)) {
    userTombstones.delete(item.id);
  }

  const existing = store.get(userId) ?? [];
  const updated = existing.some((i) => i.id === item.id)
    ? existing.map((i) => (i.id === item.id ? item : i))
    : [...existing, item];
  store.set(userId, updated);
  res.status(201).json({ ok: true, item });
});

/**
 * PATCH /api/wishlist/:id
 * Updates fields on a single item for the authenticated collector.
 * Body: Partial<{ desiredGrade, targetPrice, priceAlertEnabled }>
 */
wishlistRouter.patch("/wishlist/:id", requireActiveUser, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { id } = req.params;
  const patch = req.body as Partial<
    Pick<WishlistItem, "desiredGrade" | "targetPrice" | "priceAlertEnabled">
  >;

  const existing = store.get(userId) ?? [];
  const item = existing.find((i) => i.id === id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const updated = existing.map((i) => (i.id === id ? { ...i, ...patch } : i));
  store.set(userId, updated);
  res.json({ ok: true, item: updated.find((i) => i.id === id) });
});

/**
 * DELETE /api/wishlist/:id
 * Removes a single item for the authenticated collector and records a tombstone
 * so subsequent syncs from stale clients cannot resurrect it.
 */
wishlistRouter.delete("/wishlist/:id", requireActiveUser, (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { id } = req.params;

  // Record tombstone
  const userTombstones = tombstones.get(userId) ?? new Set<string>();
  userTombstones.add(id);
  tombstones.set(userId, userTombstones);

  const existing = store.get(userId) ?? [];
  const filtered = existing.filter((i) => i.id !== id);
  store.set(userId, filtered);
  res.json({ ok: true, removed: existing.length - filtered.length });
});

export default wishlistRouter;
