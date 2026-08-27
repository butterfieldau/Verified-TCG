import type { CollectionItem, PortfolioSummary } from '@/types';
import { getAccessToken } from './auth';
import { apiJson, apiRequest } from './apiClient';

// ── Value helper (kept for price-display callers) ─────────────────────────────

/**
 * Returns the current market value for a single CollectionItem, using the
 * grading-specific price where available (e.g. PSA 10 → price.psa10) and
 * falling back to price.raw. Multiply by item.quantity for total value.
 */
export function getItemCurrentValue(item: CollectionItem): number {
  const p = item.card.price;
  const g = item.grading;
  if (!g) return p.raw;
  const company = g.company;
  const grade = Number(g.grade);
  if (company === 'PSA') {
    if (grade === 10) return p.psa10 ?? p.raw;
    if (grade === 9)  return p.psa9  ?? p.raw;
  }
  if (company === 'BGS' || company === 'Beckett') {
    if (grade === 9.5) return p.bgs95 ?? p.raw;
    if (grade === 9)   return (p as any).bgs9  ?? p.raw;
  }
  if (company === 'CGC') {
    if (grade === 10) return p.cgc10 ?? p.raw;
    if (grade === 9)  return p.cgc9  ?? p.raw;
  }
  return p.raw;
}

// ── Authenticated API helpers ─────────────────────────────────────────────────

async function accessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return token;
}

// ── Collection API calls ──────────────────────────────────────────────────────

/** Fetch all collection items for the signed-in user from the server. */
export async function fetchCollection(): Promise<CollectionItem[]> {
  return apiJson<CollectionItem[]>('/api/collection', { accessToken: await accessToken() });
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
): Promise<PaginatedCollection> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
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
