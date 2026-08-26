import type { CollectionItem, PortfolioSummary } from '@/types';
import { getAccessToken } from './auth';

const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
const API_BASE = explicitBase || domainBase;

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

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ── Collection API calls ──────────────────────────────────────────────────────

/** Fetch all collection items for the signed-in user from the server. */
export async function fetchCollection(): Promise<CollectionItem[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection`, { headers });
  if (!res.ok) throw new Error(`Failed to load collection (${res.status})`);
  return res.json() as Promise<CollectionItem[]>;
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
  const headers = await authHeaders();
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const res = await fetch(`${API_BASE}/api/collection?${params}`, { headers });
  if (!res.ok) throw new Error(`Failed to load collection (${res.status})`);
  return res.json() as Promise<PaginatedCollection>;
}

/** Add a card to the server collection. Returns the persisted item (server-assigned id). */
export async function addCollectionItem(
  item: CollectionItem,
): Promise<CollectionItem> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection`, {
    method: 'POST',
    headers,
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
  if (!res.ok) throw new Error(`Failed to add card (${res.status})`);
  return res.json() as Promise<CollectionItem>;
}

/** Update a collection item's mutable fields. Returns the updated item. */
export async function updateCollectionItem(
  id: string,
  patch: Partial<Pick<CollectionItem, 'quantity' | 'condition' | 'grading' | 'notes' | 'isForSale' | 'isForTrade' | 'acquiredPrice'>>,
): Promise<CollectionItem> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update card (${res.status})`);
  return res.json() as Promise<CollectionItem>;
}

/** Remove a card from the user's collection on the server. */
export async function removeCollectionItem(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error(`Failed to remove card (${res.status})`);
}
