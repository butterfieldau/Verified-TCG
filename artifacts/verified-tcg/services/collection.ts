import type { CollectionItem, PortfolioSummary } from '@/types';
import { getAccessToken } from './auth';
import { apiJson, apiRequest } from './apiClient';

// ── Value helper (kept for price-display callers) ─────────────────────────────

/**
 * Returns the server-resolved current unit value for a collection holding.
 *
 * The API resolves the exact PriceCharting grade key for the persisted
 * holding.  A graded holding without an exact quote is deliberately null:
 * raw pricing is not a valid substitute for (for example) PSA 10 pricing.
 * Multiply a non-null value by item.quantity for the holding total.
 */
export function getItemCurrentValue(item: CollectionItem): number | null {
  const value = item.valuation?.price;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

// ── Authenticated API helpers ─────────────────────────────────────────────────

async function accessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return token;
}

// ── Collection API calls ──────────────────────────────────────────────────────

/** Fetch all collection items for the signed-in user from the server. */
export async function fetchCollection(displayCurrency = 'AUD'): Promise<CollectionItem[]> {
  const params = new URLSearchParams({ displayCurrency });
  return apiJson<CollectionItem[]>(`/api/collection?${params}`, { accessToken: await accessToken() });
}

export interface PaginatedCollection {
  items: CollectionItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Fetch a paginated page of collection items. */
export async function fetchCollectionPage(
  page: number,
  limit: number = 20,
  displayCurrency = 'AUD',
): Promise<PaginatedCollection> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), displayCurrency });
  return apiJson<PaginatedCollection>(`/api/collection?${params}`, { accessToken: await accessToken() });
}

/** Add a card to the server collection. Returns the persisted item (server-assigned id). */
export async function addCollectionItem(
  item: CollectionItem,
): Promise<CollectionItem> {
  return apiJson<CollectionItem>('/api/collection', {
    method: 'POST',
    accessToken: await accessToken(),
    body: JSON.stringify({
      cardId: item.cardId,
      card: item.card,
      quantity: item.quantity,
      condition: item.condition,
      grading: item.grading ?? null,
      acquiredAt: item.acquiredAt,
      acquiredPrice: item.acquiredPrice,
      currency: item.currency,
      notes: item.notes,
      isForSale: item.isForSale ?? false,
      isForTrade: item.isForTrade ?? false,
    }),
  });
}

/** Update a collection item's mutable fields. Returns the updated item. */
export async function updateCollectionItem(
  id: string,
  patch: Partial<Pick<CollectionItem, 'quantity' | 'condition' | 'grading' | 'notes' | 'isForSale' | 'isForTrade' | 'acquiredPrice' | 'acquiredAt' | 'currency'>>,
): Promise<CollectionItem> {
  return apiJson<CollectionItem>(`/api/collection/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    accessToken: await accessToken(),
    body: JSON.stringify(patch),
  });
}

/** Remove a card from the user's collection on the server. */
export async function removeCollectionItem(id: string): Promise<void> {
  await apiRequest(`/api/collection/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    accessToken: await accessToken(),
  });
}
