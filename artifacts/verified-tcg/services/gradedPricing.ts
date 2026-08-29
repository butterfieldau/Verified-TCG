/**
 * Fetch real graded card prices from the API server, which queries eBay
 * completed (sold) listings and converts to AUD.
 *
 * Results are cached in-memory for the app session so navigating away and
 * back to a card doesn't trigger a second network round-trip.
 */

import { getAccessToken } from './auth';
import { ApiClientError, apiJson } from './apiClient';

/** Grade key → AUD price. Only keys with real eBay data are present. */
export type GradedPrices = Record<string, number>;

export type GradedPricingAvailability =
  | 'available'
  | 'no_results'
  | 'configuration_error'
  | 'authorization_error'
  | 'permission_error'
  | 'conversion_error'
  | 'upstream_error'
  | 'network_error';

export interface GradedPricesResult {
  prices: GradedPrices;
  /** True when the server rejected the request because the user is not Pro. */
  requiresUpgrade: boolean;
  configured: boolean;
  availability: GradedPricingAvailability;
  message: string | null;
}

/** Session-level in-memory cache: `${cardId}` → completed-sale result */
const sessionCache = new Map<string, GradedPricesResult>();

/**
 * Fetch real graded prices for a card.
 *
 * @param cardId   Stable card identifier used as session cache key
 * @param name     Card name (e.g. "Umbreon ex")
 * @param setName  Set name (e.g. "Prismatic Evolutions")
 * @param game     TCG identifier: "pokemon" | "onepiece" | "yugioh" | etc.
 * @param signal   Optional AbortSignal
 * @returns prices map and a `requiresUpgrade` flag when a Pro subscription is needed.
 */
export async function fetchGradedPrices(
  cardId: string,
  name: string,
  setName: string,
  game: string,
  number: string,
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<GradedPricesResult> {
  // Return cached result for the session if already fetched
  const cached = sessionCache.get(cardId);
  if (!forceRefresh && cached !== undefined) return cached;
  if (forceRefresh) sessionCache.delete(cardId);

  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({ name, set: setName, game, number });
    if (forceRefresh) params.set('refresh', '1');
    const body = await apiJson<{
      prices?: GradedPrices;
      configured?: boolean;
      availability?: GradedPricingAvailability;
      message?: string | null;
    }>(`/api/graded-prices?${params.toString()}`, {
      signal,
      accessToken: token,
    });
    const result: GradedPricesResult = {
      prices: body.prices ?? {},
      requiresUpgrade: false,
      configured: body.configured ?? true,
      availability: body.availability ?? 'upstream_error',
      message: body.message ?? null,
    };
    // Keep successful data for navigation, but never cache empty/failure results
    // so a retry does not reproduce a stale unavailable state.
    if (result.availability === 'available' && Object.keys(result.prices).length > 0) {
      sessionCache.set(cardId, result);
    }
    return result;
  } catch (error) {
    const clientError = error instanceof ApiClientError ? error : null;
    if (clientError?.kind === 'forbidden') {
      return {
        prices: {},
        requiresUpgrade: true,
        configured: true,
        availability: 'permission_error',
        message: 'Pro access is required to view eBay completed-sale pricing.',
      };
    }
    if (clientError?.kind === 'configuration') {
      return {
        prices: {},
        requiresUpgrade: false,
        configured: false,
        availability: 'configuration_error',
        message: 'eBay completed-sale pricing is not configured for this app.',
      };
    }
    if (clientError?.kind === 'provider_unavailable' || clientError?.kind === 'server') {
      return {
        prices: {},
        requiresUpgrade: false,
        configured: true,
        availability: 'upstream_error',
        message: clientError.message,
      };
    }
    return {
      prices: {},
      requiresUpgrade: false,
      configured: true,
      availability: 'network_error',
      message: 'Couldn’t reach eBay completed-sale pricing. Check your connection and try again.',
    };
  }
}

export function invalidateGradedPrices(cardId: string): void {
  sessionCache.delete(cardId);
}
