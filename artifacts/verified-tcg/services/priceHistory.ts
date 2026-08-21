/**
 * Price history service — fetches historical price data for a card from the API server.
 *
 * The server returns data points built from the price_snapshots table, which
 * accumulates over time as cards are viewed. If no history exists yet for a
 * given card / grade / period, the API returns an empty array and the UI
 * shows a friendly empty state.
 */

import { getAccessToken } from './auth';

const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';
const API_BASE = `${explicitBase || domainBase}/api`;

function ebaySoldHistoryApiBase(): string {
  const configuredBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';
  return `${configuredBase || configuredDomain}/api`;
}

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
  /** True when the server rejected the request because the user is not Pro. */
  requiresUpgrade?: boolean;
}

export type EbaySoldHistoryAvailability =
  | 'available'
  | 'no_results'
  | 'configuration_error'
  | 'authorization_error'
  | 'permission_error'
  | 'conversion_error'
  | 'upstream_error'
  | 'network_error'
  | 'sign_in_required';

export interface EbaySale {
  title: string;
  endedAt: string;
  condition: string | null;
  sourcePrice: number;
  sourceCurrency: string;
  priceCents: number;
  price: number;
  currency: string;
  url: string;
}

export interface EbaySoldHistoryPoint {
  date: string;
  priceCents: number;
  price: number;
  currency: string;
}

export interface EbaySoldHistoryMovement {
  absolute: number;
  percent: number;
  direction: 'up' | 'down' | 'flat';
}

export interface EbaySoldHistoryResult {
  cardId: string;
  gradeKey: string;
  period: string;
  currency: string;
  source: 'ebay_completed_sales';
  configured: boolean;
  availability: EbaySoldHistoryAvailability;
  coverage: 'returned_results' | 'provider_limited';
  message: string | null;
  sales: EbaySale[];
  points: EbaySoldHistoryPoint[];
  movement: EbaySoldHistoryMovement | null;
  returnedAt: string | null;
  requiresUpgrade?: boolean;
}

/** In-memory cache: `${cardId}:${gradeKey}:${period}` → result */
const cache = new Map<string, { data: PriceHistoryResult; fetchedAt: number }>();
const ebaySoldHistoryCache = new Map<string, { data: EbaySoldHistoryResult; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function unavailableEbaySoldHistory(
  cardId: string,
  gradeKey: string,
  period: PricePeriod,
  currency: string,
  availability: EbaySoldHistoryAvailability,
  message: string,
  requiresUpgrade = false,
): EbaySoldHistoryResult {
  return {
    cardId,
    gradeKey,
    period,
    currency,
    source: 'ebay_completed_sales',
    configured: availability !== 'configuration_error',
    availability,
    coverage: 'returned_results',
    message,
    sales: [],
    points: [],
    movement: null,
    returnedAt: null,
    requiresUpgrade,
  };
}

/**
 * Fetch individual completed eBay sales and a trend calculated from those same
 * sales. Unlike the legacy snapshot helper below, this never turns failures
 * into an indistinguishable empty history.
 */
export async function fetchEbaySoldHistory(
  cardId: string,
  opts: {
    name: string;
    set: string;
    game: string;
    number: string;
    gradeKey: string;
    period: PricePeriod;
    displayCurrency: string;
  },
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<EbaySoldHistoryResult> {
  const { gradeKey, period, displayCurrency } = opts;
  const cacheKey = `${cardId}:${gradeKey}:${period}:${displayCurrency}`;
  const hit = ebaySoldHistoryCache.get(cacheKey);
  if (!forceRefresh && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;
  if (forceRefresh) ebaySoldHistoryCache.delete(cacheKey);

  const base = ebaySoldHistoryApiBase();
  if (!base || base === '/api') {
    return unavailableEbaySoldHistory(
      cardId, gradeKey, period, displayCurrency, 'configuration_error',
      'eBay sold history is not configured for this app.',
    );
  }

  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({
      name: opts.name,
      set: opts.set,
      game: opts.game,
      number: opts.number,
      grade: gradeKey,
      period,
      displayCurrency,
    });
    const res = await fetch(
      `${base}/catalog/cards/${encodeURIComponent(cardId)}/ebay-sold-history?${params.toString()}`,
      {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );

    if (res.status === 401) {
      return unavailableEbaySoldHistory(
        cardId, gradeKey, period, displayCurrency, 'sign_in_required',
        'Sign in again to view eBay sold history.',
      );
    }
    if (res.status === 403) {
      return unavailableEbaySoldHistory(
        cardId, gradeKey, period, displayCurrency, 'permission_error',
        'Pro access is required to view eBay sold history.', true,
      );
    }
    if (!res.ok) {
      return unavailableEbaySoldHistory(
        cardId, gradeKey, period, displayCurrency, 'upstream_error',
        'eBay sold history is temporarily unavailable. Please try again.',
      );
    }

    const body = (await res.json()) as EbaySoldHistoryResult;
    const result: EbaySoldHistoryResult = {
      ...body,
      cardId,
      gradeKey,
      period,
      currency: body.currency ?? displayCurrency,
      source: 'ebay_completed_sales',
      coverage: body.coverage === 'provider_limited' ? 'provider_limited' : 'returned_results',
      sales: Array.isArray(body.sales) ? body.sales : [],
      points: Array.isArray(body.points) ? body.points : [],
      movement: body.movement ?? null,
      returnedAt: body.returnedAt ?? null,
    };
    ebaySoldHistoryCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
    return result;
  } catch (error: unknown) {
    if ((error as Error)?.name === 'AbortError') throw error;
    return unavailableEbaySoldHistory(
      cardId, gradeKey, period, displayCurrency, 'network_error',
      'Couldn’t reach eBay sold history. Check your connection and try again.',
    );
  }
}

/** Clears an individual result so a visible retry never reuses an empty session value. */
export function invalidateEbaySoldHistory(
  cardId: string,
  gradeKey: string,
  period: PricePeriod,
  displayCurrency: string,
): void {
  ebaySoldHistoryCache.delete(`${cardId}:${gradeKey}:${period}:${displayCurrency}`);
}

/**
 * Fetch price history for a card from the API server.
 * Returns empty points array on error or if no data exists yet.
 * Sets `requiresUpgrade: true` when the server returns 403.
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
    const token = await getAccessToken();
    const params = new URLSearchParams({ grade: gradeKey, period });
    const res = await fetch(
      `${API_BASE}/catalog/cards/${encodeURIComponent(cardId)}/price-history?${params}`,
      {
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );

    if (res.status === 403) {
      return { points: [], updatedAt: null, source: 'ebay_sold', requiresUpgrade: true };
    }
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
export async function triggerPriceSnapshot(
  cardId: string,
  name: string,
  setName: string,
  game: string,
  number: string,
): Promise<void> {
  if (!API_BASE || API_BASE === '/api') return;
  try {
    const token = await getAccessToken();
    await fetch(`${API_BASE}/catalog/cards/${encodeURIComponent(cardId)}/snapshot-prices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ name, set: setName, game, number }),
    });
  } catch {
    // Snapshot collection is best-effort; its truthful availability is shown by
    // the explicit sold-history response rather than by this background request.
  }
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
