/**
 * Fetch real graded card prices from the API server, which queries eBay
 * completed (sold) listings and converts to AUD.
 *
 * Results are cached in-memory for the app session so navigating away and
 * back to a card doesn't trigger a second network round-trip.
 */

const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';
const API_BASE = `${explicitBase || domainBase}/api`;

/** Grade key → AUD price. Only keys with real eBay data are present. */
export type GradedPrices = Record<string, number>;

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
 * @returns Map of grade keys to AUD prices. Empty object on any error.
 */
export async function fetchGradedPrices(
  cardId: string,
  name: string,
  setName: string,
  game: string,
  signal?: AbortSignal,
): Promise<GradedPrices> {
  if (!API_BASE || API_BASE === '/api') return {};

  // Return cached result for the session if already fetched
  const cached = sessionCache.get(cardId);
  if (cached !== undefined) return cached;

  try {
    const params = new URLSearchParams({ name, set: setName, game });
    const res = await fetch(`${API_BASE}/graded-prices?${params.toString()}`, { signal });
    if (!res.ok) return {};
    const body = (await res.json()) as { prices?: GradedPrices };
    const prices = body.prices ?? {};
    sessionCache.set(cardId, prices);
    return prices;
  } catch {
    return {};
  }
}
