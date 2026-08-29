/**
 * Verified Market Pricing Service
 *
 * Fetches live pricing data from the server's /api/pricing/cards/:id endpoint.
 * Never fabricates fallback prices — returns explicit status indicators for all
 * non-available states (pending, review_required, unavailable, stale, etc.)
 */

import { getAccessToken } from './auth';
import { ApiClientError, apiJson } from './apiClient';

export interface PricingQuote {
  gradeKey: string;
  label: string;
  priceCents: number;
  price: number;
  currency: string;
  originalPriceCents: number;
  originalCurrency: string;
}

export interface PricingSource {
  provider: string;
  label: string;
  productId: string | null;
}

export interface PricingConfidence {
  level: 'high' | 'medium' | 'low' | 'strong' | 'ambiguous' | 'none' | null;
  score: number | null;
  providerCount?: number;
  reasons?: string[];
}

export interface VerifiedMarketRange {
  lowCents: number;
  highCents: number;
  currency: string;
  sampleCount: number;
  basis: 'retained_snapshots';
}

export interface VerifiedMarketValue {
  gradeKey: string;
  verifiedMarketValueCents: number;
  verifiedMarketValue: number;
  currency: string;
  range: VerifiedMarketRange | null;
  confidence: Required<Pick<PricingConfidence, 'level' | 'score'>> & {
    level: 'high' | 'medium' | 'low';
    score: number;
    providerCount: number;
    reasons: string[];
  };
  providers: Array<{
    key: string;
    label: string;
    productId: string | null;
    priceCents: number;
    currency: string;
    originalPriceCents: number;
    originalCurrency: string;
    fetchedAt: string;
  }>;
  insights: string[];
}

export interface PricingConversion {
  originalCurrency: string;
  displayCurrency: string;
  rate?: number;
  available: boolean;
  source?: string;
}

export type PricingStatus =
  | 'available'
  | 'stale'
  | 'pending_match'
  | 'review_required'
  | 'unavailable';

export interface CardPricingResult {
  cardId: string;
  status: PricingStatus;
  configured: boolean;
  queued: boolean;
  quotes: PricingQuote[];
  verifiedMarket: VerifiedMarketValue[];
  source: PricingSource | null;
  confidence: PricingConfidence | null;
  matchingConfidence?: PricingConfidence | null;
  providerMetadata: {
    salesVolume: number | null;
    releaseDate: string | null;
    genre: string | null;
    upc: string | null;
  } | null;
  updatedAt: string | null;
  isStale: boolean;
  errorCode?: string;
  message?: string;
  conversion?: PricingConversion;
}

export interface PriceHistoryPoint {
  date: string;
  price: number;
  priceCents: number;
  currency: string;
}

export interface PriceHistoryMovement {
  absolute: number;
  percent: number;
  direction: 'up' | 'down' | 'flat';
}

export interface CardPriceHistoryResult {
  points: PriceHistoryPoint[];
  updatedAt: string | null;
  source: string | null;
  movement: PriceHistoryMovement | null;
  historyAvailable: boolean;
}

export type HistoryPeriod = '7d' | '30d' | '90d' | '180d' | '1y' | 'all';

/** In-memory cache for pricing results (5-min TTL) */
const pricingCache = new Map<string, { data: CardPricingResult; fetchedAt: number }>();
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch verified market pricing for a card.
 * Returns status-rich result — never fabricates prices.
 */
export async function fetchVerifiedPricing(
  cardId: string,
  opts: {
    name?: string;
    set?: string;
    number?: string;
    game?: string;
    displayCurrency?: string;
  } = {},
  signal?: AbortSignal,
): Promise<CardPricingResult> {
  const cacheKey = `${cardId}:${opts.displayCurrency ?? 'AUD'}`;
  const hit = pricingCache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < PRICING_CACHE_TTL_MS) return hit.data;

  try {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    if (opts.name) params.set('name', opts.name);
    if (opts.set) params.set('set', opts.set);
    if (opts.number) params.set('number', opts.number);
    if (opts.game) params.set('game', opts.game);
    if (opts.displayCurrency) params.set('displayCurrency', opts.displayCurrency);

    const qs = params.toString();
    const data = await apiJson<CardPricingResult>(
      `/api/pricing/cards/${encodeURIComponent(cardId)}${qs ? `?${qs}` : ''}`,
      { accessToken: token, signal },
    );
    pricingCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    const clientError = err instanceof ApiClientError ? err : null;
    return {
      cardId,
      status: 'unavailable',
      configured: clientError?.kind !== 'configuration',
      queued: false,
      quotes: [],
      verifiedMarket: [],
      source: null,
      confidence: null,
      providerMetadata: null,
      updatedAt: null,
      isStale: false,
      errorCode: clientError?.kind ?? 'network_error',
      message: clientError?.message ?? 'Network error — check connection',
    };
  }
}

/**
 * Trigger a bounded refresh of pricing data for a card.
 * Fire-and-forget — call after showing current stale data.
 */
export async function refreshVerifiedPricing(
  cardId: string,
  opts: {
    name?: string;
    set?: string;
    number?: string;
    game?: string;
    displayCurrency?: string;
  } = {},
): Promise<CardPricingResult> {
  // Invalidate cache first
  const cacheKey = `${cardId}:${opts.displayCurrency ?? 'AUD'}`;
  pricingCache.delete(cacheKey);

  const token = await getAccessToken();
  const params = new URLSearchParams();
  if (opts.name) params.set('name', opts.name);
  if (opts.set) params.set('set', opts.set);
  if (opts.number) params.set('number', opts.number);
  if (opts.game) params.set('game', opts.game);
  if (opts.displayCurrency) params.set('displayCurrency', opts.displayCurrency);

  const qs = params.toString();
  try {
    const data = await apiJson<CardPricingResult>(
      `/api/pricing/cards/${encodeURIComponent(cardId)}/refresh${qs ? `?${qs}` : ''}`,
      { method: 'POST', accessToken: token },
    );
    pricingCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch {
    // On error, re-fetch the current stored result
    return fetchVerifiedPricing(cardId, opts);
  }
}

/**
 * Fetch real price history for a card from the server.
 * Returns empty points + historyAvailable: false when no data exists.
 */
export async function fetchVerifiedPriceHistory(
  cardId: string,
  grade: string,
  period: HistoryPeriod,
  displayCurrency?: string,
  signal?: AbortSignal,
): Promise<CardPriceHistoryResult> {
  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({ grade, period });
    if (displayCurrency) params.set('displayCurrency', displayCurrency);
    return apiJson<CardPriceHistoryResult>(
      `/api/pricing/cards/${encodeURIComponent(cardId)}/history?${params}`,
      { accessToken: token, signal },
    );
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    return { points: [], updatedAt: null, source: null, movement: null, historyAvailable: false };
  }
}
