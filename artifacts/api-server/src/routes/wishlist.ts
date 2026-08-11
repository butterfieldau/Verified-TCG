/**
 * Wishlist routes — single-tenant prototype.
 *
 * This server backs the wishlist for one collector (the single mock user whose
 * identity is fixed on the server).  There are no credentials, tokens, or
 * user-supplied identity headers — the server owns the user identity entirely.
 *
 * This is explicitly a prototype for demonstrating the cross-device sync
 * pattern described in Task #40.  A production implementation would integrate
 * a real authentication system (e.g. Clerk) and per-user database rows.
 *
 * Storage: in-memory Map.  Data resets on server restart; the mobile client
 * treats AsyncStorage as the authoritative local cache and re-syncs on every
 * app launch, so the server quickly recovers the latest state.
 * Task #55 tracks migrating to PostgreSQL.
 */

import { Router } from "express";

const wishlistRouter = Router();

/** Fixed user for this single-tenant prototype.  Never derived from requests. */
const SINGLE_USER_ID = "usr-001";

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

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/wishlist
 * Returns the current wishlist.
 */
wishlistRouter.get("/wishlist", (_req, res) => {
  const items = store.get(SINGLE_USER_ID) ?? [];
  res.json({ items });
});

/**
 * POST /api/wishlist/sync
 *
 * Merges the client's items into the server state:
 *   - Client items replace matching server items (client has fresher field values)
 *   - Server-only items are preserved (items added from other devices)
 *   - Tombstoned IDs are stripped from the client list before merging, so a
 *     stale sync cannot resurrect an item that was explicitly deleted
 *
 * Returns the canonical merged list so the client can reconcile local state.
 * Body: { items: WishlistItem[] }
 */
wishlistRouter.post("/wishlist/sync", (req, res) => {
  const { items: clientItems } = req.body as { items: WishlistItem[] };

  if (!Array.isArray(clientItems)) {
    res.status(400).json({ error: "body.items must be an array" });
    return;
  }

  const serverItems = store.get(SINGLE_USER_ID) ?? [];
  const userTombstones = tombstones.get(SINGLE_USER_ID) ?? new Set<string>();

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

  store.set(SINGLE_USER_ID, merged);
  res.json({ ok: true, items: merged, count: merged.length });
});

/**
 * POST /api/wishlist
 * Adds or replaces a single item (idempotent by id).
 * Re-adding a tombstoned item clears the tombstone.
 * Body: WishlistItem
 */
wishlistRouter.post("/wishlist", (req, res) => {
  const item = req.body as WishlistItem;

  if (!item?.id || !item?.cardId) {
    res.status(400).json({ error: "body must include id and cardId" });
    return;
  }

  // Clear tombstone — the collector is intentionally re-adding this item
  const userTombstones = tombstones.get(SINGLE_USER_ID);
  if (userTombstones?.has(item.id)) {
    userTombstones.delete(item.id);
  }

  const existing = store.get(SINGLE_USER_ID) ?? [];
  const updated = existing.some((i) => i.id === item.id)
    ? existing.map((i) => (i.id === item.id ? item : i))
    : [...existing, item];
  store.set(SINGLE_USER_ID, updated);
  res.status(201).json({ ok: true, item });
});

/**
 * PATCH /api/wishlist/:id
 * Updates fields on a single item.
 * Body: Partial<{ desiredGrade, targetPrice, priceAlertEnabled }>
 */
wishlistRouter.patch("/wishlist/:id", (req, res) => {
  const { id } = req.params;
  const patch = req.body as Partial<
    Pick<WishlistItem, "desiredGrade" | "targetPrice" | "priceAlertEnabled">
  >;

  const existing = store.get(SINGLE_USER_ID) ?? [];
  const item = existing.find((i) => i.id === id);
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const updated = existing.map((i) => (i.id === id ? { ...i, ...patch } : i));
  store.set(SINGLE_USER_ID, updated);
  res.json({ ok: true, item: updated.find((i) => i.id === id) });
});

/**
 * DELETE /api/wishlist/:id
 * Removes a single item and records a tombstone so subsequent syncs from
 * stale clients cannot resurrect it.
 */
wishlistRouter.delete("/wishlist/:id", (req, res) => {
  const { id } = req.params;

  // Record tombstone
  const userTombstones = tombstones.get(SINGLE_USER_ID) ?? new Set<string>();
  userTombstones.add(id);
  tombstones.set(SINGLE_USER_ID, userTombstones);

  const existing = store.get(SINGLE_USER_ID) ?? [];
  const filtered = existing.filter((i) => i.id !== id);
  store.set(SINGLE_USER_ID, filtered);
  res.json({ ok: true, removed: existing.length - filtered.length });
});

export default wishlistRouter;
