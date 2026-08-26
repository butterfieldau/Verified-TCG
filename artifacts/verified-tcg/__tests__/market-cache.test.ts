/**
 * Market cache (stale-while-revalidate) tests
 *
 * Covers services/market.ts caching behavior:
 *   - Concurrent initial fetches (Home cold start) persist ALL sections —
 *     the shared JSON blob must not lose sections to write races
 *   - Cache hits within TTL are served without hitting the network
 *   - Empty fetch results never overwrite existing cached data
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// The app-card mapper is exercised elsewhere; identity-map here.
jest.mock('@/services/catalogApi', () => ({
  catalogCardToAppCard: (c: any) => c,
}));

process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';

// Require (not import) after env is set so API_BASE resolves to the test host
// — static imports hoist above the env assignment.
const {
  getMarketMoversCached,
  getTrendingCardsCached,
  getRecentlyAddedCardsCached,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('@/services/market') as typeof import('@/services/market');

const CACHE_KEY = '@verified_tcg/market_cache_v2';

function jsonResponse(data: unknown) {
  return { ok: true, json: async () => ({ data }) } as Response;
}

const moverCard = { id: 'c1', market_price: 100, price_change_7d: 5, trend: 'up' };
const trendingCard = { id: 'c2' };
const recentCard = { id: 'c3' };

function mockFetchByEndpoint() {
  return jest.fn(async (url: string) => {
    if (url.includes('market-movers')) return jsonResponse([moverCard]);
    if (url.includes('trending')) return jsonResponse([trendingCard]);
    if (url.includes('recently-added')) return jsonResponse([recentCard]);
    return { ok: false } as Response;
  });
}

describe('market SWR cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (global as any).fetch = mockFetchByEndpoint();
  });

  it('persists all three sections when fetched concurrently (cold start)', async () => {
    const [movers, trending, recent] = await Promise.all([
      getMarketMoversCached(),
      getTrendingCardsCached(),
      getRecentlyAddedCardsCached(),
    ]);

    expect(movers).toHaveLength(1);
    expect(trending).toHaveLength(1);
    expect(recent).toHaveLength(1);

    const raw = await AsyncStorage.getItem(CACHE_KEY);
    expect(raw).toBeTruthy();
    const cache = JSON.parse(raw!);
    // No section may be lost to a concurrent read-modify-write race
    expect(cache.movers?.data).toHaveLength(1);
    expect(cache.trending?.data).toHaveLength(1);
    expect(cache.recentlyAdded?.data).toHaveLength(1);
  });

  it('serves fresh cache without hitting the network', async () => {
    await Promise.all([
      getMarketMoversCached(),
      getTrendingCardsCached(),
      getRecentlyAddedCardsCached(),
    ]);
    const fetchMock = mockFetchByEndpoint();
    (global as any).fetch = fetchMock;

    const movers = await getMarketMoversCached();
    expect(movers).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares one matching request between concurrent market consumers', async () => {
    const fetchMock = mockFetchByEndpoint();
    (global as any).fetch = fetchMock;

    const [home, market] = await Promise.all([
      getMarketMoversCached(),
      getMarketMoversCached(),
    ]);

    expect(home).toHaveLength(1);
    expect(market).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite cached data with an empty/error fetch result', async () => {
    await getMarketMoversCached();

    // Age the cache past the TTL so a background refresh fires
    const cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY))!);
    cache.movers.updatedAt = Date.now() - 10 * 60 * 1000;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));

    // Server now fails → fetcher resolves to []
    (global as any).fetch = jest.fn(async () => ({ ok: false } as Response));

    const onUpdate = jest.fn();
    const movers = await getMarketMoversCached(onUpdate);
    expect(movers).toHaveLength(1); // stale cache still served

    // Let the background refresh settle
    await new Promise(r => setTimeout(r, 20));
    expect(onUpdate).not.toHaveBeenCalled();
    const after = JSON.parse((await AsyncStorage.getItem(CACHE_KEY))!);
    expect(after.movers.data).toHaveLength(1);
  });
});
