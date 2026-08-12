/**
 * wishlistApi.ts — authenticated wishlist client
 *
 * HTTP client for the /api/wishlist endpoints.
 *
 * URL strategy
 * ──────────────
 * For web, a root-relative path can be used when the API is same-origin.
 * Native builds must set EXPO_PUBLIC_API_BASE_URL to the API origin.
 */

import type { WatchlistItem } from '@/types';
import { getAccessToken } from './auth';

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

async function headers(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function checkResponse(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Wishlist API ${res.status}: ${body}`);
  }
}

// ── Wishlist operations ───────────────────────────────────────────────────────

/**
 * Sends the client's local wishlist to the server and returns the server's
 * canonical merged result.
 *
 * Server merge semantics:
 * - Client items replace matching server items (client may have fresher edits)
 * - Server-only items are preserved (added from other devices)
 * - Tombstoned IDs (explicitly deleted via DELETE) are stripped from the
 *   client list before merging so a stale sync cannot resurrect a deleted item
 *
 * The returned list is authoritative — callers should replace their local
 * state with it unconditionally, including when it is shorter (deletions made
 * on another device must be reflected locally).
 */
export async function syncWishlistToServer(
  items: WatchlistItem[],
): Promise<WatchlistItem[]> {
  const res = await fetch(`${API_BASE}/wishlist/sync`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ items }),
  });
  await checkResponse(res);
  const data = (await res.json()) as { items: WatchlistItem[] };
  return Array.isArray(data.items) ? data.items : items;
}

/**
 * Adds a single item to the server wishlist.
 * Idempotent: if the item already exists it is replaced.
 * Re-adding a previously deleted item clears its tombstone on the server.
 */
export async function addWishlistItemToServer(
  item: WatchlistItem,
): Promise<void> {
  const res = await fetch(`${API_BASE}/wishlist`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(item),
  });
  await checkResponse(res);
}

/**
 * Removes a single item from the server wishlist by its ID.
 * Records a tombstone on the server — subsequent syncs from stale clients
 * will not resurrect the item.
 */
export async function removeWishlistItemFromServer(
  itemId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/wishlist/${encodeURIComponent(itemId)}`,
    { method: 'DELETE', headers: await headers() },
  );
  await checkResponse(res);
}

/**
 * Patches fields on a single server wishlist item.
 */
export async function updateWishlistItemOnServer(
  itemId: string,
  patch: Partial<Pick<WatchlistItem, 'desiredGrade' | 'targetPrice' | 'priceAlertEnabled'>>,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/wishlist/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: await headers(),
      body: JSON.stringify(patch),
    },
  );
  await checkResponse(res);
}
