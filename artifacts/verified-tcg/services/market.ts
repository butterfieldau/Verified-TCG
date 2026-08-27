import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card, MarketMover } from '@/types';
import { catalogCardToAppCard } from './catalogApi';
import type { CatalogCard } from './catalogApi';
import { apiJson } from './apiClient';

// ── Server response shapes ────────────────────────────────────────────────────

interface MarketMoverServerCard extends CatalogCard {
  market_price: number;
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
const MARKET_CACHE_KEY = '@verified_tcg/market_cache_v2';
const MARKET_CACHE_TTL_MS = 5 * 60 * 1000;

interface MarketCacheSection<T> {
  data: T;
  updatedAt: number;
}

interface MarketCache {
  movers?: MarketCacheSection<MarketMover[]>;
  trending?: MarketCacheSection<Card[]>;
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

async function readMarketCache(): Promise<MarketCache> {
  try {
    const raw = await AsyncStorage.getItem(MARKET_CACHE_KEY);
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
): Promise<void> {
  cacheWriteQueue = cacheWriteQueue.then(async () => {
    try {
      const cache = await readMarketCache();
      cache[key] = { data, updatedAt: Date.now() } as MarketCache[K];
      await AsyncStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(cache));
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
 * Empty fetch results never overwrite existing cached data.
 */
async function swrFetch<K extends keyof MarketCache, T extends NonNullable<MarketCache[K]>['data']>(
  key: K,
  fetcher: () => Promise<T>,
  onUpdate?: (fresh: T) => void,
): Promise<T> {
  const cache = await readMarketCache();
  const section = cache[key] as MarketCacheSection<T> | undefined;

  if (section && Array.isArray(section.data) && section.data.length > 0) {
    const isStale = Date.now() - section.updatedAt > MARKET_CACHE_TTL_MS;
    if (isStale) {
      // Background revalidation — never blocks the caller.
      // (The base fetchers write the cache themselves on success.)
      fetcher()
        .then(fresh => {
          if (fresh.length > 0) onUpdate?.(fresh);
        })
        .catch(() => {});
    }
    return section.data;
  }

  // No cache — block on the network just this once
  return fetcher();
}

/** Cached variant of getMarketMovers — see swrFetch for semantics. */
export function getMarketMoversCached(onUpdate?: (fresh: MarketMover[]) => void): Promise<MarketMover[]> {
  return swrFetch('movers', getMarketMovers, onUpdate);
}

/** Cached variant of getTrendingCards — see swrFetch for semantics. */
export function getTrendingCardsCached(onUpdate?: (fresh: Card[]) => void): Promise<Card[]> {
  return swrFetch('trending', getTrendingCards, onUpdate);
}

/** Cached variant of getRecentlyAddedCards — see swrFetch for semantics. */
export function getRecentlyAddedCardsCached(onUpdate?: (fresh: Card[]) => void): Promise<Card[]> {
  return swrFetch('recentlyAdded', getRecentlyAddedCards, onUpdate);
}

// ── Live API functions ────────────────────────────────────────────────────────

/**
 * Fetches the top market movers from the API server.
 * Cards are sorted server-side by absolute 7-day price change.
 * A successful empty array means no comparable movement exists. Errors are
 * deliberately propagated so the screen can show an unavailable state.
 */
export async function getMarketMovers(): Promise<MarketMover[]> {
  return singleFlight('market-movers', fetchMarketMovers);
}

async function fetchMarketMovers(): Promise<MarketMover[]> {
  const body = await apiJson<{ data: MarketMoverServerCard[] }>('/api/catalog/market-movers');
  const movers = (body.data ?? []).map((card) => {
      const appCard = catalogCardToAppCard(card);
      return {
      card: appCard,
      currentPrice: card.market_price,
      priceChange: (card.market_price * card.price_change_7d) / 100,
      priceChangePercent: card.price_change_7d,
      trend: card.trend,
      currency: card.currency,
      updatedAt: card.updated_at,
    };
  });
  if (movers.length > 0) await writeMarketCacheSection('movers', movers);
  return movers;
}

/**
 * Fetches the deterministic ranking of fresh comparable snapshot movements.
 * Verified TCG does not yet claim a separate social-popularity signal.
 * A successful empty array means no persisted trend records exist.
 */
export async function getTrendingCards(): Promise<Card[]> {
  return singleFlight('trending', fetchTrendingCards);
}

async function fetchTrendingCards(): Promise<Card[]> {
  const body = await apiJson<{ data: CatalogCard[] }>('/api/catalog/trending');
  const cards = (body.data ?? []).map(catalogCardToAppCard);
  if (cards.length > 0) await writeMarketCacheSection('trending', cards);
  return cards;
}

/**
 * Fetches recently-added canonical catalogue records with a current quote when
 * one exists. This is ordered by catalogue provenance, not a fixture or a
 * hand-picked price list.
 * A successful empty array means the catalogue has no persisted records yet.
 */
export async function getRecentlyAddedCards(): Promise<Card[]> {
  return singleFlight('recently-added', fetchRecentlyAddedCards);
}

async function fetchRecentlyAddedCards(): Promise<Card[]> {
  const body = await apiJson<{ data: CatalogCard[] }>('/api/catalog/recently-added');
  const cards = (body.data ?? []).map(catalogCardToAppCard);
  if (cards.length > 0) await writeMarketCacheSection('recentlyAdded', cards);
  return cards;
}
