import type { CollectionItem, CollectionList, CollectionOrganizerFilters, CollectionSortDirection, CollectionSortField } from '@/types';
import { getAccessToken } from './auth';
import { apiJson } from './apiClient';

export interface CollectionOrganization {
  lists: CollectionList[];
  preferences: { viewMode: 'grid' | 'list' | 'compact'; selectedListId: string | null; filterState: CollectionOrganizerFilters; sortKey: string; updatedAt: string | null };
}
export interface CollectionBulkOperation {
  holdingIds: string[];
  assignToListId?: string;
  removeFromListId?: string;
  isForSale?: boolean;
  isForTrade?: boolean;
  delete?: boolean;
}
export interface CollectionListSubtotal {
  listId: string; currency: string; holdingCount: number; uniqueHoldingCount: number;
  totalValue: number | null; totalCost: number | null; pricedHoldings: number; totalHoldings: number; valuationComplete: boolean;
}
async function token() { const value = await getAccessToken(); if (!value) throw new Error('Your session has expired. Please sign in again.'); return value; }
const request = async <T,>(path: string, method = 'GET', body?: unknown) =>
  apiJson<T>(path, { method, accessToken: await token(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export function sortCollectionItems(items: readonly CollectionItem[], field: CollectionSortField, direction: CollectionSortDirection): CollectionItem[] {
  const factor = direction === 'asc' ? 1 : -1;
  const metric = (item: CollectionItem): number | null => field === 'value' ? item.valuation?.price == null ? null : item.valuation.price * item.quantity
    : field === 'gain' ? item.valuation?.gain == null ? null : item.valuation.gain * item.quantity
      : field === 'date' ? Date.parse(item.acquiredAt) || 0 : item.quantity;
  return [...items].sort((a, b) => {
    const left = field === 'name' ? 0 : metric(a), right = field === 'name' ? 0 : metric(b);
    // Unpriced/no-gain values are always last, regardless of sort direction.
    if (left === null || right === null) return left === right ? (a.card.id.localeCompare(b.card.id) || a.id.localeCompare(b.id)) : left === null ? 1 : -1;
    const main = field === 'name' ? a.card.name.localeCompare(b.card.name, undefined, { numeric: true, sensitivity: 'base' }) : left - right;
    if (main) return main * factor;
    return a.card.id.localeCompare(b.card.id) || a.id.localeCompare(b.id);
  });
}
export function filterCollectionItems(items: readonly CollectionItem[], filters: CollectionOrganizerFilters, query = '', memberIds?: ReadonlySet<string>): CollectionItem[] {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(item => {
    const value = item.valuation?.price == null ? null : item.valuation.price * item.quantity;
    const grade = item.grading ? Number(item.grading.grade) : null;
    return (!term || [item.card.name, item.card.setName, item.card.number].some(x => x.toLocaleLowerCase().includes(term)))
      && (!filters.tcg || item.card.tcg === filters.tcg) && (filters.graded === undefined || !!item.grading === filters.graded)
      && (filters.forSale === undefined || !!item.isForSale === filters.forSale) && (filters.forTrade === undefined || !!item.isForTrade === filters.forTrade)
      && (!filters.conditions?.length || filters.conditions.includes(item.condition))
      && (!filters.gradingCompanies?.length || !!item.grading && filters.gradingCompanies.includes(item.grading.company))
      && (filters.minGrade === undefined || grade !== null && grade >= filters.minGrade) && (filters.maxGrade === undefined || grade !== null && grade <= filters.maxGrade)
      && (filters.minValue === undefined || value !== null && value >= filters.minValue) && (filters.maxValue === undefined || value !== null && value <= filters.maxValue)
      && (!filters.acquiredAfter || item.acquiredAt >= filters.acquiredAfter) && (!filters.acquiredBefore || item.acquiredAt <= filters.acquiredBefore)
      && (!filters.pricing || (filters.pricing === 'priced' ? value !== null : value === null))
      && (!filters.pricingFreshness || (() => { const age = item.valuation?.updatedAt ? (Date.now() - Date.parse(item.valuation.updatedAt)) / 86400000 : Infinity; const days = filters.freshnessDays ?? 30; return filters.pricingFreshness === 'fresh' ? age <= days : age > days; })())
      && (!filters.listId || !!memberIds?.has(item.id));
  });
}
export const fetchCollectionOrganization = () => request<CollectionOrganization>('/api/collection/lists');
export const createCollectionList = (name: string) => request<CollectionOrganization>('/api/collection/lists', 'POST', { name });
export const renameCollectionList = (listId: string, name: string) => request<CollectionOrganization>(`/api/collection/lists/${encodeURIComponent(listId)}`, 'PATCH', { name });
export const reorderCollectionLists = (listIds: string[]) => request<CollectionOrganization>('/api/collection/lists/order', 'PUT', { listIds });
export const deleteCollectionList = (listId: string) => request<CollectionOrganization>(`/api/collection/lists/${encodeURIComponent(listId)}`, 'DELETE');
export const fetchCollectionListSubtotal = (listId: string, displayCurrency = 'AUD') => request<CollectionListSubtotal>(`/api/collection/lists/${encodeURIComponent(listId)}/subtotal?displayCurrency=${encodeURIComponent(displayCurrency)}`);
export const replaceCollectionListItems = (listId: string, holdingIds: string[]) => request<CollectionOrganization>(`/api/collection/lists/${encodeURIComponent(listId)}/items`, 'PUT', { holdingIds });
export const addCollectionListItems = (listId: string, holdingIds: string[]) => request<CollectionOrganization>(`/api/collection/lists/${encodeURIComponent(listId)}/items`, 'POST', { holdingIds });
export const removeCollectionListItem = (listId: string, holdingId: string) => request<CollectionOrganization>(`/api/collection/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(holdingId)}`, 'DELETE');
export const fetchCollectionPreferences = () => request<CollectionOrganization['preferences']>('/api/collection/preferences');
export const saveCollectionPreferences = (body: Pick<CollectionOrganization['preferences'], 'viewMode' | 'selectedListId' | 'filterState' | 'sortKey'>) => request<CollectionOrganization['preferences']>('/api/collection/preferences', 'PUT', body);
export const bulkUpdateCollectionItems = (body: CollectionBulkOperation) => request<CollectionOrganization>('/api/collection/bulk', 'POST', body);