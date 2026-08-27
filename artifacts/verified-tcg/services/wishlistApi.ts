/**
 * wishlistApi.ts — per-user, JWT-authenticated
 *
 * HTTP client for the /api/wishlist endpoints.
 *
 * Every request includes the collector's Bearer token from the active session
 * so the API server can scope data to the authenticated user.  Unauthenticated
 * calls (no token available) are rejected gracefully — the caller receives an
 * error that is caught and silenced in AppContext, leaving AsyncStorage as the
 * authoritative offline cache.
 *
 * URL strategy
 * ──────────────
 * The shared API client resolves the explicit public API origin for every
 * environment. There is no editor/preview-domain fallback for native builds.
 */

import type { WatchlistItem } from '@/types';
import { getAccessToken } from '@/services/auth';
import { apiJson, apiRequest } from './apiClient';

/**
 * Returns headers that include the Bearer token for the active session.
 * Throws if no token is available so callers can skip the request when
 * the collector is not signed in.
 */
async function authToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('No active session — wishlist request skipped');
  return token;
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
  const data = await apiJson<{ items: WatchlistItem[] }>('/api/wishlist/sync', {
    method: 'POST',
    accessToken: await authToken(),
    body: JSON.stringify({ items }),
  });
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
  await apiRequest('/api/wishlist', {
    method: 'POST',
    accessToken: await authToken(),
    body: JSON.stringify(item),
  });
}

/**
 * Removes a single item from the server wishlist by its ID.
 * Records a tombstone on the server — subsequent syncs from stale clients
 * will not resurrect the item.
 */
export async function removeWishlistItemFromServer(
  itemId: string,
): Promise<void> {
  await apiRequest(`/api/wishlist/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    accessToken: await authToken(),
  });
}

/**
 * Patches fields on a single server wishlist item.
 */
export async function updateWishlistItemOnServer(
  itemId: string,
  patch: Partial<Pick<WatchlistItem, 'desiredGrade' | 'targetPrice' | 'priceAlertEnabled'>>,
): Promise<void> {
  await apiRequest(`/api/wishlist/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    accessToken: await authToken(),
    body: JSON.stringify(patch),
  });
}
