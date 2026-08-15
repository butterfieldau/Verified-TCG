/**
 * Fetch real graded card prices from the API server, which queries eBay
 * completed (sold) listings and converts to AUD.
 *
 * Results are cached in-memory for the app session so navigating away and
 * back to a card doesn't trigger a second network round-trip.
 */

import { getAccessToken } from './auth';

const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';
const API_BASE = `${explicitBase || domainBase}/api`;

/** Grade key → AUD price. Only keys with real eBay data are present. */
export type GradedPrices = Record<string, number>;

export interface GradedPricesResult {
  prices: GradedPrices;
  /** True when the server rejected the request because the user is not Pro. */
  requiresUpgrade: boolean;
}

/** Session-level in-memory cache: `${cardId}` → prices */
const sessionCache = new Map<string, GradedPrices>();

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
  signal?: AbortSignal,
): Promise<GradedPricesResult> {
  if (!API_BASE || API_BASE === '/api') return { prices: {}, requiresUpgrade: false };

  // Return cached result for the session if already fetched
  const cached = sessionCache.get(cardId);
  if (cached !== undefined) return { prices: cached, requiresUpgrade: false };

  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({ name, set: setName, game });
    const res = await fetch(`${API_BASE}/graded-prices?${params.toString()}`, {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (res.status === 403) return { prices: {}, requiresUpgrade: true };
    if (!res.ok) return { prices: {}, requiresUpgrade: false };

    const body = (await res.json()) as { prices?: GradedPrices };
    const prices = body.prices ?? {};
    sessionCache.set(cardId, prices);
    return { prices, requiresUpgrade: false };
  } catch {
    return { prices: {}, requiresUpgrade: false };
  }
}
