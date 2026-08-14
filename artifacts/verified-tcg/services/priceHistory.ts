/**
 * Price history service — fetches historical price data for a card from the API server.
 *
 * The server returns data points built from the price_snapshots table, which
 * accumulates over time as cards are viewed. If no history exists yet for a
 * given card / grade / period, the API returns an empty array and the UI
 * shows a friendly empty state.
 */

const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';
const API_BASE = `${explicitBase || domainBase}/api`;

export type PricePeriod = '7D' | '30D' | '90D' | '1Y' | 'All';

export interface PricePoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** AUD price (not cents) */
  price: number;
}

export interface PriceHistoryResult {
  points: PricePoint[];
  /** ISO timestamp of the most recent snapshot, or null if no data */
  updatedAt: string | null;
  source: string;
}

/** In-memory cache: `${cardId}:${gradeKey}:${period}` → result */
const cache = new Map<string, { data: PriceHistoryResult; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch price history for a card from the API server.
 * Returns empty points array on error or if no data exists yet.
 */
export async function fetchPriceHistory(
  cardId: string,
  gradeKey: string,
  period: PricePeriod,
  signal?: AbortSignal,
): Promise<PriceHistoryResult> {
  if (!API_BASE || API_BASE === '/api') {
    return { points: [], updatedAt: null, source: 'ebay_sold' };
  }

  const cacheKey = `${cardId}:${gradeKey}:${period}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  try {
    const params = new URLSearchParams({ grade: gradeKey, period });
    const res = await fetch(
      `${API_BASE}/catalog/cards/${encodeURIComponent(cardId)}/price-history?${params}`,
      { signal },
    );
    if (!res.ok) return { points: [], updatedAt: null, source: 'ebay_sold' };
    const body = (await res.json()) as PriceHistoryResult;
    cache.set(cacheKey, { data: body, fetchedAt: Date.now() });
    return body;
  } catch {
    return { points: [], updatedAt: null, source: 'ebay_sold' };
  }
}

/**
 * Fire-and-forget: trigger a price snapshot recording for a card on the server.
 * Called when a card detail screen loads so history accumulates over time.
 * Errors are silently swallowed — this is a best-effort call.
 */
export function triggerPriceSnapshot(
  cardId: string,
  name: string,
  setName: string,
  game: string,
): void {
  if (!API_BASE || API_BASE === '/api') return;
  fetch(`${API_BASE}/catalog/cards/${encodeURIComponent(cardId)}/snapshot-prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, set: setName, game }),
  }).catch(() => {});
}

/**
 * Build an eBay search URL for a card name, set, and grade.
 * Opens to category 2536 (Trading Cards) with sold listings visible.
 */
export function buildEbaySearchUrl(cardName: string, setName: string, grade: string): string {
  const gradeStr = grade !== 'Raw' ? ` ${grade}` : '';
  const query = `${cardName} ${setName}${gradeStr} card`;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=2536`;
}

/**
 * Format a relative "updated X ago" string from an ISO timestamp.
 */
export function formatUpdatedAt(isoString: string | null): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}
