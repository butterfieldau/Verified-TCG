import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card, MarketMover } from '@/types';
import { catalogCardToAppCard } from './catalogApi';
import type { CatalogCard } from './catalogApi';
import { apiJson } from './apiClient';
import { getAccessToken } from './auth';

// ── Server response shapes ────────────────────────────────────────────────────

interface MarketMoverServerCard extends CatalogCard {
  market_price: number;
  absolute_change: number;
  price_change_7d: number;
  trend: 'up' | 'down' | 'neutral';
  currency: string;
  updated_at: string;
}

// ── Stale-while-revalidate cache ──────────────────────────────────────────────
//
// Market/home data is cached in AsyncStorage so screens can render instantly
// from the last-known data while a background refresh runs. Cached data is
// served even past the TTL (stale) — the TTL only decides whether a background
// refresh is triggered. The UI only blocks when no cache exists at all.

// v2 prevents pre-release, provider-search market results from surviving as
// a release fallback after the snapshot-backed feed ships.
const MARKET_CACHE_KEY = '@verified_tcg/market_cache_v5';
const MARKET_CACHE_TTL_MS = 5 * 60 * 1000;

export interface MarketCacheOptions {
  force?: boolean;
  /** Stable, non-secret identity + preference fingerprint supplied by the view. */
  cacheScope?: string;
  /** The user's selected display currency, converted server-side when available. */
  displayCurrency?: string;
}

function scopedCacheKey(scope?: string, displayCurrency?: string): string {
  // Do not put a bearer token in AsyncStorage. Views pass the authenticated
  // user ID and preference fingerprint; anonymous callers remain isolated.
  return `${MARKET_CACHE_KEY}:${encodeURIComponent(scope || 'anonymous')}:${encodeURIComponent(displayCurrency?.toUpperCase() || 'source')}`;
}

interface MarketCacheSection<T> {
  data: T;
  updatedAt: number;
}

interface MarketCache {
  movers?: MarketCacheSection<MarketMover[]>;
  gainers?: MarketCacheSection<MarketMover[]>;
  losers?: MarketCacheSection<MarketMover[]>;
  trending?: MarketCacheSection<Card[]>;
  lookupTrending?: MarketCacheSection<Card[]>;
  recentlyAdded?: MarketCacheSection<Card[]>;
}

const networkFlights = new Map<string, Promise<unknown>>();

function singleFlight<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = networkFlights.get(key);
  if (existing) return existing as Promise<T>;
  const flight = request().finally(() => networkFlights.delete(key));
  networkFlights.set(key, flight);
  return flight;
}

async function readMarketCache(scope?: string, displayCurrency?: string): Promise<MarketCache> {
  try {
    const raw = await AsyncStorage.getItem(scopedCacheKey(scope, displayCurrency));
    return raw ? (JSON.parse(raw) as MarketCache) : {};
  } catch {
    return {};
  }
}

// All sections share one JSON blob, so read-modify-write cycles must be
// serialized — otherwise concurrent section writes (e.g. Home fetching all
// three feeds on cold start) would clobber each other, with the last write
// discarding the other sections.
let cacheWriteQueue: Promise<void> = Promise.resolve();

function writeMarketCacheSection<K extends keyof MarketCache>(
  key: K,
  data: NonNullable<MarketCache[K]>['data'],
  scope?: string,
  displayCurrency?: string,
): Promise<void> {
  cacheWriteQueue = cacheWriteQueue.then(async () => {
    try {
      const cache = await readMarketCache(scope, displayCurrency);
      cache[key] = { data, updatedAt: Date.now() } as MarketCache[K];
      await AsyncStorage.setItem(scopedCacheKey(scope, displayCurrency), JSON.stringify(cache));
    } catch {
      // Cache writes are best-effort
    }
  });
  return cacheWriteQueue;
}

/**
 * Generic stale-while-revalidate wrapper.
 * - Cache hit  → returns cached data immediately; if past TTL, refreshes in
 *   the background and reports fresh data via `onUpdate`.
 * - Cache miss → awaits the network fetch (the only blocking path).
 * Successful empty fetch results are authoritative and clear stale cached data.
 */
async function swrFetch<K extends keyof MarketCache, T extends NonNullable<MarketCache[K]>['data']>(
  key: K,
  fetcher: () => Promise<T>,
  onUpdate?: (fresh: T) => void,
  options?: MarketCacheOptions,
): Promise<T> {
  // A manual refresh must not be satisfied by an otherwise-fresh cache entry.
  // Failed requests leave cache untouched; successful empty responses clear it.
  if (options?.force) return fetcher();
  const cache = await readMarketCache(options?.cacheScope, options?.displayCurrency);
  const section = cache[key] as MarketCacheSection<T> | undefined;

  if (section && Array.isArray(section.data)) {
    const isStale = Date.now() - section.updatedAt > MARKET_CACHE_TTL_MS;
    if (isStale) {
      // Background revalidation — never blocks the caller.
      // (The base fetchers write the cache themselves on success.)
      fetcher()
        .then(fresh => {
          // Empty is an authoritative successful response, not a failure.
          onUpdate?.(fresh);
        })
        .catch(() => {});
    }
    return section.data;
  }

  // No cache — block on the network just this once
  return fetcher();
}

/** Cached variant of getMarketMovers — see swrFetch for semantics. */
export function getMarketMoversCached(onUpdate?: (fresh: MarketMover[]) => void, options?: MarketCacheOptions): Promise<MarketMover[]> {
  return swrFetch('movers', () => getMarketMovers(options), onUpdate, options);
}

/** Cached server-ranked gainers; not derived from the absolute mover feed. */
export function getMarketGainersCached(onUpdate?: (fresh: MarketMover[]) => void, options?: MarketCacheOptions): Promise<MarketMover[]> {
  return swrFetch('gainers', () => getMarketGainers(options), onUpdate, options);
}

/** Cached server-ranked losers; not derived from the absolute mover feed. */
export function getMarketLosersCached(onUpdate?: (fresh: MarketMover[]) => void, options?: MarketCacheOptions): Promise<MarketMover[]> {
  return swrFetch('losers', () => getMarketLosers(options), onUpdate, options);
}

/** Cached variant of getTrendingCards — see swrFetch for semantics. */
export function getTrendingCardsCached(onUpdate?: (fresh: Card[]) => void, options?: MarketCacheOptions): Promise<Card[]> {
  return swrFetch('trending', () => getTrendingCards(options), onUpdate, options);
}

export function getLookupTrendingCardsCached(onUpdate?: (fresh: Card[]) => void, options?: MarketCacheOptions): Promise<Card[]> {
  return swrFetch('lookupTrending', () => getLookupTrendingCards(options), onUpdate, options);
}

/** Cached variant of getRecentlyAddedCards — see swrFetch for semantics. */
export function getRecentlyAddedCardsCached(onUpdate?: (fresh: Card[]) => void, options?: MarketCacheOptions): Promise<Card[]> {
  return swrFetch('recentlyAdded', () => getRecentlyAddedCards(options), onUpdate, options);
}

// ── Live API functions ────────────────────────────────────────────────────────

/**
 * Fetches the top market movers from the API server.
 * Cards are sorted server-side by absolute 7-day price change.
 * A successful empty array means no comparable movement exists. Errors are
 * deliberately propagated so the screen can show an unavailable state.
 */
export async function getMarketMovers(options?: MarketCacheOptions): Promise<MarketMover[]> {
  return singleFlight(`market-movers:${options?.cacheScope ?? 'anonymous'}:${options?.displayCurrency ?? 'source'}`, () => fetchMarketMovers('movers', options));
}

export async function getMarketGainers(options?: MarketCacheOptions): Promise<MarketMover[]> {
  return singleFlight(`market-gainers:${options?.cacheScope ?? 'anonymous'}:${options?.displayCurrency ?? 'source'}`, () => fetchMarketMovers('gainers', options));
}

export async function getMarketLosers(options?: MarketCacheOptions): Promise<MarketMover[]> {
  return singleFlight(`market-losers:${options?.cacheScope ?? 'anonymous'}:${options?.displayCurrency ?? 'source'}`, () => fetchMarketMovers('losers', options));
}

async function fetchMarketMovers(section: 'movers' | 'gainers' | 'losers', options?: MarketCacheOptions): Promise<MarketMover[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams();
  if (section !== 'movers') params.set('mode', section);
  if (options?.displayCurrency) params.set('displayCurrency', options.displayCurrency);
  const endpoint = `/api/catalog/market-movers${params.size ? `?${params.toString()}` : ''}`;
  const body = await apiJson<{ data: MarketMoverServerCard[] }>(
    endpoint,
    token ? { accessToken: token } : undefined,
  );
  const movers = (body.data ?? []).map((card) => {
      const appCard = catalogCardToAppCard(card);
      return {
      card: appCard,
      currentPrice: card.market_price,
      priceChange: card.absolute_change,
      priceChangePercent: card.price_change_7d,
      trend: card.trend,
      currency: card.currency,
      updatedAt: card.updated_at,
    };
  });
  await writeMarketCacheSection(section, movers, options?.cacheScope, options?.displayCurrency);
  return movers;
}

/**
 * Fetches the deterministic ranking of fresh comparable snapshot movements.
 * Verified TCG does not yet claim a separate social-popularity signal.
 * A successful empty array means no persisted trend records exist.
 */
export async function getTrendingCards(options?: MarketCacheOptions): Promise<Card[]> {
  return singleFlight(`trending:${options?.cacheScope ?? 'anonymous'}:${options?.displayCurrency ?? 'source'}`, () => fetchTrendingCards(options));
}

export async function getLookupTrendingCards(options?: MarketCacheOptions): Promise<Card[]> {
  return singleFlight(`lookup-trending:${options?.cacheScope ?? 'anonymous'}:${options?.displayCurrency ?? 'source'}`, () => fetchLookupTrendingCards(options));
}

async function fetchLookupTrendingCards(options?: MarketCacheOptions): Promise<Card[]> {
  const token = await getAccessToken();
  const suffix = options?.displayCurrency ? `?${new URLSearchParams({ displayCurrency: options.displayCurrency }).toString()}` : '';
  const body = await apiJson<{ data: CatalogCard[] }>(
    `/api/catalog/trending-lookups${suffix}`,
    token ? { accessToken: token } : undefined,
  );
  const cards = (body.data ?? []).map(catalogCardToAppCard);
  await writeMarketCacheSection('lookupTrending', cards, options?.cacheScope, options?.displayCurrency);
  return cards;
}

async function fetchTrendingCards(options?: MarketCacheOptions): Promise<Card[]> {
  const token = await getAccessToken();
  const suffix = options?.displayCurrency ? `?${new URLSearchParams({ displayCurrency: options.displayCurrency }).toString()}` : '';
  const body = await apiJson<{ data: CatalogCard[] }>(`/api/catalog/trending${suffix}`, token ? { accessToken: token } : undefined);
  const cards = (body.data ?? []).map(catalogCardToAppCard);
  await writeMarketCacheSection('trending', cards, options?.cacheScope, options?.displayCurrency);
  return cards;
}

/**
 * Fetches recently-added canonical catalogue records with a current quote when
 * one exists. This is ordered by catalogue provenance, not a fixture or a
 * hand-picked price list.
 * A successful empty array means the catalogue has no persisted records yet.
 */
export async function getRecentlyAddedCards(options?: MarketCacheOptions): Promise<Card[]> {
  return singleFlight(`recently-added:${options?.cacheScope ?? 'anonymous'}:${options?.displayCurrency ?? 'source'}`, () => fetchRecentlyAddedCards(options));
}

async function fetchRecentlyAddedCards(options?: MarketCacheOptions): Promise<Card[]> {
  const token = await getAccessToken();
  const suffix = options?.displayCurrency ? `?${new URLSearchParams({ displayCurrency: options.displayCurrency }).toString()}` : '';
  const body = await apiJson<{ data: CatalogCard[] }>(`/api/catalog/recently-added${suffix}`, token ? { accessToken: token } : undefined);
  const cards = (body.data ?? []).map(catalogCardToAppCard);
  await writeMarketCacheSection('recentlyAdded', cards, options?.cacheScope, options?.displayCurrency);
  return cards;
}
