import type { CollectionItem, PortfolioSummary, GradingCompany, GradingRecord } from '@/types';
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

/**
 * These are the server's canonical grade buckets. They are intentionally
 * descriptive rather than price-bearing: a variant stays selectable even
 * when the server has no exact provider quote for it.
 */
export interface CollectionGradeOption {
  gradeKey:
    | 'raw'
    | 'graded_7_75'
    | 'graded_8_85'
    | 'graded_9'
    | 'graded_95'
    | 'psa_10'
    | 'bgs_10'
    | 'bgs_black_label_10'
    | 'cgc_10'
    | 'cgc_pristine_10'
    | 'sgc_10'
    | 'tag_10'
    | 'ace_10';
  label: string;
  /** Exact collector-selected variant identity; intentionally finer than gradeKey. */
  identityKey: string;
  company: GradingCompany;
  grade?: number;
  designation?: string;
}

export const COLLECTION_GRADE_OPTIONS: readonly CollectionGradeOption[] = [
  { gradeKey: 'raw', identityKey: 'raw', label: 'Raw / Ungraded', company: 'Raw' },
  { gradeKey: 'graded_7_75', identityKey: 'generic_7', label: 'Generic Graded 7', company: 'Generic', grade: 7 },
  { gradeKey: 'graded_7_75', identityKey: 'generic_7.5', label: 'Generic Graded 7.5', company: 'Generic', grade: 7.5 },
  { gradeKey: 'graded_8_85', identityKey: 'generic_8', label: 'Generic Graded 8', company: 'Generic', grade: 8 },
  { gradeKey: 'graded_8_85', identityKey: 'generic_8.5', label: 'Generic Graded 8.5', company: 'Generic', grade: 8.5 },
  { gradeKey: 'graded_9', identityKey: 'generic_9', label: 'Generic Graded 9', company: 'Generic', grade: 9 },
  { gradeKey: 'graded_95', identityKey: 'generic_9.5', label: 'Generic Graded 9.5', company: 'Generic', grade: 9.5 },
  { gradeKey: 'psa_10', identityKey: 'psa_10', label: 'PSA 10', company: 'PSA', grade: 10 },
  { gradeKey: 'bgs_10', identityKey: 'bgs_10', label: 'BGS 10', company: 'BGS', grade: 10 },
  { gradeKey: 'bgs_black_label_10', identityKey: 'bgs_10_black_label', label: 'BGS 10 Black Label', company: 'BGS', grade: 10, designation: 'Black Label' },
  { gradeKey: 'cgc_10', identityKey: 'cgc_10', label: 'CGC 10', company: 'CGC', grade: 10 },
  { gradeKey: 'cgc_pristine_10', identityKey: 'cgc_10_pristine', label: 'CGC 10 Pristine', company: 'CGC', grade: 10, designation: 'Pristine' },
  { gradeKey: 'sgc_10', identityKey: 'sgc_10', label: 'SGC 10', company: 'SGC', grade: 10 },
  { gradeKey: 'tag_10', identityKey: 'tag_10', label: 'TAG 10', company: 'TAG', grade: 10 },
  { gradeKey: 'ace_10', identityKey: 'ace_10', label: 'ACE 10', company: 'ACE', grade: 10 },
];

/**
 * Mirrors the API's exact holding-to-grade resolution. This is only used to
 * compare variants in the picker; values still come exclusively from
 * item.valuation returned by the server.
 */
export function getCollectionGradeKey(item: Pick<CollectionItem, 'grading'>): CollectionGradeOption['gradeKey'] | null {
  if (!item.grading || item.grading.company === 'Raw') return 'raw';
  const company = String(item.grading.company).trim().toUpperCase();
  const grade = Number(item.grading.grade);
  if (!Number.isFinite(grade)) return null;
  if (grade === 10) {
    const designation = [
      (item.grading as GradingRecord & { designation?: string }).designation,
      (item.grading as GradingRecord & { variant?: string }).variant,
    ].filter(Boolean).join(' ').toLowerCase();
    if (company === 'PSA') return 'psa_10';
    if (company === 'BGS' || company === 'BECKETT') return designation.includes('black label') ? 'bgs_black_label_10' : 'bgs_10';
    if (company === 'CGC') return designation.includes('pristine') ? 'cgc_pristine_10' : 'cgc_10';
    if (company === 'SGC') return 'sgc_10';
    if (company === 'TAG') return 'tag_10';
    if (company === 'ACE') return 'ace_10';
    return null;
  }
  if (company === 'GENERIC' || company === 'UNSPECIFIED') {
    if (grade === 7 || grade === 7.5) return 'graded_7_75';
    if (grade === 8 || grade === 8.5) return 'graded_8_85';
    if (grade === 9) return 'graded_9';
    if (grade === 9.5) return 'graded_95';
  }
  return null;
}

export function getCollectionHoldingIdentity(item: Pick<CollectionItem, 'grading'>): string {
  if (!item.grading || item.grading.company === 'Raw') return 'raw';
  const company = String(item.grading.company).trim().toUpperCase() === 'BECKETT'
    ? 'BGS'
    : String(item.grading.company).trim().toUpperCase();
  const grade = String(item.grading.grade).trim();
  const designation = [
    (item.grading as GradingRecord & { designation?: string }).designation,
    (item.grading as GradingRecord & { variant?: string }).variant,
  ].filter(Boolean).join(' ').trim().toLowerCase().replace(/\s+/g, '_');
  return `${company.toLowerCase()}_${grade}${designation ? `_${designation}` : ''}`;
}

export function formatCollectionHoldingLabel(item: Pick<CollectionItem, 'grading'>): string {
  if (!item.grading || item.grading.company === 'Raw') return 'Raw / Ungraded';
  const designation = [
    (item.grading as GradingRecord & { designation?: string }).designation,
    (item.grading as GradingRecord & { variant?: string }).variant,
  ].filter(Boolean).join(' ');
  return `${item.grading.company} ${item.grading.grade}${designation ? ` · ${designation}` : ''}`;
}

export function findMatchingCollectionHolding(
  holdings: readonly CollectionItem[],
  cardId: string,
  identityKey: string,
): CollectionItem | undefined {
  return holdings.find(item => item.cardId === cardId && getCollectionHoldingIdentity(item) === identityKey);
}

export function summarizeCollectionHoldings(items: readonly CollectionItem[]): {
  quantity: number;
  totalValue: number | null;
  pricedVariants: number;
  unavailableVariants: number;
  currency: string | null;
} {
  const priced = items.filter(item => getItemCurrentValue(item) != null);
  return {
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalValue: priced.length === 0
      ? null
      : priced.reduce((sum, item) => sum + (getItemCurrentValue(item) ?? 0) * item.quantity, 0),
    pricedVariants: priced.length,
    unavailableVariants: items.length - priced.length,
    currency: priced[0]?.valuation?.currency ?? null,
  };
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
