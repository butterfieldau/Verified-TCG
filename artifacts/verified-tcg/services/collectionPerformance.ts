/**
 * Collection Performance & Archive Service
 *
 * Provides typed API methods for:
 *   - Collection summary (totals, coverage, freshness)
 *   - Performance history (range-selectable, real data only)
 *   - Archive (sold holdings): list, restore, patch
 *   - Sell action: POST a sale to archive a holding
 */

import { getAccessToken } from './auth';

const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
const API_BASE = explicitBase || domainBase;

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ── Collection Summary ─────────────────────────────────────────────────────────

export interface CollectionCoverage {
  pricedHoldings: number;
  totalHoldings: number;
  ratio: number;      // 0–1
  freshHoldings: number;
  staleHoldings: number;
}

export interface CollectionMovement {
  absolute: number;
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
  fromDate?: string;
  toDate?: string;
}

export interface CollectionSummary {
  // Monetary
  totalValue: number | null;
  totalCost: number | null;
  unrealizedGain: number | null;
  unrealizedGainPercent: number | null;
  realisedGain: number | null;
  // Counts
  cardCount: number;
  uniqueCardCount: number;
  currency: string;
  // Coverage / freshness
  coverage: CollectionCoverage;
  // Movement
  todayMovement: CollectionMovement | null;
  movement30d: CollectionMovement | null;
  // Meta
  completeness: string;    // human-readable note e.g. "72% of holdings priced"
}

/**
 * Fetch authoritative collection summary from the server.
 * On any error returns null — callers should handle null as "unavailable".
 */
export async function fetchCollectionSummary(
  displayCurrency = 'AUD',
): Promise<CollectionSummary | null> {
  try {
    const headers = await authHeaders();
    const params = new URLSearchParams({ displayCurrency });
    const res = await fetch(`${API_BASE}/api/collection/summary?${params}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as CollectionSummary;
  } catch {
    return null;
  }
}

// ── Performance History ─────────────────────────────────────────────────────────

export type PerformanceRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export interface PerformancePoint {
  date: string;
  value: number;
  currency: string;
}

export interface PerformanceAllocation {
  label: string;
  value: number;
  percent: number;
  color: string;
}

export interface PerformanceCard {
  cardId: string;
  name: string;
  setName?: string;
  gainAbsolute: number;
  gainPercent: number;
  currency: string;
}

export interface CollectionPerformance {
  points: PerformancePoint[];
  realisedGain: number | null;
  unrealisedGain: number | null;
  costBasis: number | null;
  currency: string;
  allocations: PerformanceAllocation[];
  topPerformers: PerformanceCard[];
  worstPerformers: PerformanceCard[];
  historyAvailable: boolean;
  historyUnavailableReason?: string | null;
  completeness: string;   // e.g. "Performance based on 8 of 12 priced holdings"
}

/**
 * Fetch real performance history for a given range.
 * Returns historyAvailable:false with empty points when no data exists.
 */
export async function fetchCollectionPerformance(
  range: PerformanceRange,
  displayCurrency = 'AUD',
): Promise<CollectionPerformance | null> {
  try {
    const headers = await authHeaders();
    const params = new URLSearchParams({ range, displayCurrency });
    const res = await fetch(`${API_BASE}/api/collection/performance?${params}`, { headers });
    if (!res.ok) return null;
    const raw = await res.json() as {
      points?: PerformancePoint[];
      realisedGain?: number | null;
      unrealizedGain?: number | null;
      costBasis?: number | null;
      currency?: string;
      allocations?: Array<{ name: string; value: number; percentage: number }>;
      topPerformers?: Array<{
        cardId: string;
        name: string;
        gain: number;
        gainPercent: number;
        currentValue: number;
        costBasis: number;
      }>;
      worstPerformers?: Array<{
        cardId: string;
        name: string;
        gain: number;
        gainPercent: number;
        currentValue: number;
        costBasis: number;
      }>;
      historyAvailable?: boolean;
      historyUnavailableReason?: string | null;
      completeness?: string;
    };
    const colors = ['#CC1826', '#3B82F6', '#22C55E', '#F59E0B', '#A855F7', '#14B8A6'];
    const mapCard = (card: NonNullable<typeof raw.topPerformers>[number]): PerformanceCard => ({
      cardId: card.cardId,
      name: card.name,
      gainAbsolute: card.gain,
      gainPercent: card.gainPercent,
      currency: raw.currency ?? displayCurrency,
    });
    return {
      points: raw.points ?? [],
      realisedGain: raw.realisedGain ?? null,
      unrealisedGain: raw.unrealizedGain ?? null,
      costBasis: raw.costBasis ?? null,
      currency: raw.currency ?? displayCurrency,
      allocations: (raw.allocations ?? []).map((allocation, index) => ({
        label: allocation.name,
        value: allocation.value,
        percent: Math.round(allocation.percentage * 10) / 10,
        color: colors[index % colors.length]!,
      })),
      topPerformers: (raw.topPerformers ?? []).map(mapCard),
      worstPerformers: (raw.worstPerformers ?? []).map(mapCard),
      historyAvailable: raw.historyAvailable ?? false,
      historyUnavailableReason: raw.historyUnavailableReason,
      completeness: raw.completeness ?? 'Performance data unavailable',
    };
  } catch {
    return null;
  }
}

// ── Archive (sold holdings) ───────────────────────────────────────────────────

export interface ArchivedHolding {
  id: string;
  cardId: string;
  card: {
    id: string;
    name: string;
    setName: string;
    number: string;
    imageUrl?: string;
    gradientStart: string;
    gradientEnd: string;
    tcg: string;
  };
  quantity: number;
  condition: string;
  grading?: {
    company: string;
    grade: number | string;
    certNumber: string;
  };
  acquiredAt: string;
  acquiredPrice: number;
  acquiredPriceCurrency: string;
  salePrice: number;
  salePriceCurrency: string;
  soldAt: string;
  displayCurrency: string;
  notes?: string;
  venue?: string;
  buyer?: string;
  realisedGain: number | null;
  realisedGainPercent: number | null;
  // Current Verified Market value if available
  currentMarketValue: number | null;
  currentMarketCurrency: string | null;
  currentMarketUpdatedAt: string | null;
}

/**
 * Fetch all archived (sold) holdings for the signed-in user.
 */
export async function fetchArchive(displayCurrency = 'AUD'): Promise<ArchivedHolding[]> {
  const headers = await authHeaders();
  const params = new URLSearchParams({ displayCurrency });
  const res = await fetch(`${API_BASE}/api/collection/archive?${params}`, { headers });
  if (!res.ok) throw new Error(`Failed to load archive (${res.status})`);
  return (await res.json()) as ArchivedHolding[];
}

/**
 * Patch an archived holding (e.g. update notes, venue, buyer).
 */
export async function patchArchivedHolding(
  id: string,
  patch: Partial<Pick<ArchivedHolding, 'notes' | 'venue' | 'buyer' | 'salePrice' | 'soldAt'>>,
): Promise<ArchivedHolding> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/archive/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update archived holding (${res.status})`);
  return (await res.json()) as ArchivedHolding;
}

/**
 * Restore an archived holding back to the active collection.
 */
export async function restoreArchivedHolding(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/archive/${id}/restore`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error(`Failed to restore archived holding (${res.status})`);
}

// ── Sell Action ────────────────────────────────────────────────────────────────

export interface SellRequest {
  salePrice: number;
  currency: string;
  soldAt: string;     // ISO date
  notes?: string;
  venue?: string;
  buyer?: string;
}

export interface SellResponse {
  id: string;
  realisedGain: number | null;
  realisedGainPercent: number | null;
  displayCurrency: string;
}

/**
 * Record a sale for an active collection item, archiving it.
 * Returns the archived record on success.
 */
export async function sellCollectionItem(
  collectionItemId: string,
  sale: SellRequest,
): Promise<SellResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/${collectionItemId}/sell`, {
    method: 'POST',
    headers,
    body: JSON.stringify(sale),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Failed to record sale (${res.status})`);
  }
  return (await res.json()) as SellResponse;
}
