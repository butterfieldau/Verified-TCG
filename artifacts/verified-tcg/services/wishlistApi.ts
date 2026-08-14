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
 * In the Replit preview the Expo app runs as a web page, so a root-relative
 * path (/api/…) is routed through the Replit proxy to the API server.
 * On a physical/emulated native device set EXPO_PUBLIC_API_BASE_URL to the
 * full server URL (e.g. https://your-repl.replit.dev).
 */

import type { WatchlistItem } from '@/types';
import { getAccessToken } from '@/services/auth';

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function checkResponse(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Wishlist API ${res.status}: ${body}`);
  }
}

/**
 * Returns headers that include the Bearer token for the active session.
 * Throws if no token is available so callers can skip the request when
 * the collector is not signed in.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error('No active session — wishlist request skipped');
  return { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
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
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/wishlist/sync`, {
    method: 'POST',
    headers,
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
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/wishlist`, {
    method: 'POST',
    headers,
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
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE}/wishlist/${encodeURIComponent(itemId)}`,
    { method: 'DELETE', headers },
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
  const headers = await authHeaders();
  const res = await fetch(
    `${API_BASE}/wishlist/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    },
  );
  await checkResponse(res);
}
