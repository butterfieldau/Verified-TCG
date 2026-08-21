import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card, MarketMover, PriceRecord, PortfolioDataPoint, PortfolioRange } from '@/types';
import { catalogCardToAppCard } from './catalogApi';
import type { CatalogCard } from './catalogApi';

// Resolve the API base URL the same way catalogApi.ts does.
const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
const API_BASE = `${explicitBase || domainBase}/api`;

// ── Server response shapes ────────────────────────────────────────────────────

interface MarketMoverServerCard extends CatalogCard {
  market_price: number;
  price_change_7d: number;
  trend: 'up' | 'down' | 'neutral';
}

// ── Stale-while-revalidate cache ──────────────────────────────────────────────
//
// Market/home data is cached in AsyncStorage so screens can render instantly
// from the last-known data while a background refresh runs. Cached data is
// served even past the TTL (stale) — the TTL only decides whether a background
// refresh is triggered. The UI only blocks when no cache exists at all.

const MARKET_CACHE_KEY = '@verified_tcg/market_cache';
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
 * Returns an empty array on error so callers can show a graceful fallback.
 */
export async function getMarketMovers(): Promise<MarketMover[]> {
  return singleFlight('market-movers', fetchMarketMovers);
}

async function fetchMarketMovers(): Promise<MarketMover[]> {
  if (!API_BASE || API_BASE === '/api') return [];
  try {
    const res = await fetch(`${API_BASE}/catalog/market-movers`);
    if (!res.ok) return [];
    const body = await res.json();
    const movers = (body.data as MarketMoverServerCard[]).map((card) => ({
      card: catalogCardToAppCard(card),
      currentPrice: card.market_price,
      priceChange: (card.market_price * card.price_change_7d) / 100,
      priceChangePercent: card.price_change_7d,
      trend: card.trend,
    }));
    if (movers.length > 0) await writeMarketCacheSection('movers', movers);
    return movers;
  } catch {
    return [];
  }
}

/**
 * Fetches trending cards — sorted by trading activity (price update frequency).
 * Returns an empty array on error.
 */
export async function getTrendingCards(): Promise<Card[]> {
  return singleFlight('trending', fetchTrendingCards);
}

async function fetchTrendingCards(): Promise<Card[]> {
  if (!API_BASE || API_BASE === '/api') return [];
  try {
    const res = await fetch(`${API_BASE}/catalog/trending`);
    if (!res.ok) return [];
    const body = await res.json();
    const cards = (body.data as CatalogCard[]).map(catalogCardToAppCard);
    if (cards.length > 0) await writeMarketCacheSection('trending', cards);
    return cards;
  } catch {
    return [];
  }
}

/**
 * Fetches recently-added catalog cards — high-value cards from current sets.
 * Returns an empty array on error.
 */
export async function getRecentlyAddedCards(): Promise<Card[]> {
  return singleFlight('recently-added', fetchRecentlyAddedCards);
}

async function fetchRecentlyAddedCards(): Promise<Card[]> {
  if (!API_BASE || API_BASE === '/api') return [];
  try {
    const res = await fetch(`${API_BASE}/catalog/recently-added`);
    if (!res.ok) return [];
    const body = await res.json();
    const cards = (body.data as CatalogCard[]).map(catalogCardToAppCard);
    if (cards.length > 0) await writeMarketCacheSection('recentlyAdded', cards);
    return cards;
  } catch {
    return [];
  }
}

// ── Portfolio chart data (still generated locally — collection-owned) ─────────

function generateChartData(
  baseValue: number,
  days: number,
  volatility: number,
): PortfolioDataPoint[] {
  const data: PortfolioDataPoint[] = [];
  let value = baseValue;
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const seed = (days - i + 17) * 9301 + 49297;
    const rand = ((seed % 233280) / 233280 - 0.45) * volatility;
    value = Math.max(value * (1 + rand), 100);
    data.push({ date: date.toISOString().split('T')[0], value: Math.round(value * 100) / 100 });
  }
  return data;
}

export const PORTFOLIO_CHART_DATA: Record<PortfolioRange, PortfolioDataPoint[]> = {
  '1D':  generateChartData(24500, 1,   0.008),
  '7D':  generateChartData(23800, 7,   0.015),
  '1M':  generateChartData(22400, 30,  0.020),
  '3M':  generateChartData(20100, 90,  0.025),
  '1Y':  generateChartData(16200, 365, 0.030),
  'ALL': generateChartData(8500,  730, 0.040),
};

// ── Price refresh (still simulated — real price refresh is task #20 scope) ────

export function simulateRefreshedPrice(cardId: string, current: PriceRecord): PriceRecord {
  const timeBucket = Math.floor(Date.now() / 60000);
  const cardSeed = cardId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const raw01 = ((timeBucket * 9301 + cardSeed * 49297) % 233280) / 233280;
  const variation = 1 + (raw01 - 0.5) * 0.06;

  function vary(v: number | undefined): number | undefined {
    return v !== undefined ? Math.round(v * variation * 100) / 100 : undefined;
  }

  return {
    ...current,
    raw:   Math.round(current.raw * variation * 100) / 100,
    psa9:  vary(current.psa9),
    psa10: vary(current.psa10),
    bgs9:  vary(current.bgs9),
    bgs95: vary(current.bgs95),
    cgc9:  vary(current.cgc9),
    cgc10: vary(current.cgc10),
    updatedAt: new Date().toISOString().split('T')[0],
  };
}

export async function fetchRefreshedPrices(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1200));
}

