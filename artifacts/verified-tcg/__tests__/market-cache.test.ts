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
jest.mock('@/services/auth', () => ({
  getAccessToken: jest.fn(async () => 'market-test-token'),
}));

process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';

// Require (not import) after env is set so API_BASE resolves to the test host
// — static imports hoist above the env assignment.
const {
  getMarketMoversCached,
  getMarketGainersCached,
  getMarketLosersCached,
  getTrendingCardsCached,
  getRecentlyAddedCardsCached,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('@/services/market') as typeof import('@/services/market');
const { getAccessToken } = require('@/services/auth') as { getAccessToken: jest.Mock };

const CACHE_KEY = '@verified_tcg/market_cache_v5:anonymous';

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
    getAccessToken.mockResolvedValue('market-test-token');
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

  it('force refresh bypasses fresh cache and retains it when the request is empty', async () => {
    await getMarketMoversCached();
    (global as any).fetch = jest.fn(async () => jsonResponse([]));

    const result = await getMarketMoversCached(undefined, { force: true });
    expect(result).toEqual([]);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY))!);
    expect(cache.movers.data).toHaveLength(0);
  });

  it('sends the stored access token as a bearer authorization header', async () => {
    const fetchMock = mockFetchByEndpoint();
    (global as any).fetch = fetchMock;
    await getMarketMoversCached();
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.get('Authorization')).toBe('Bearer market-test-token');
  });

  it('issues anonymous market requests without an authorization header', async () => {
    getAccessToken.mockResolvedValue(null);
    const fetchMock = mockFetchByEndpoint();
    (global as any).fetch = fetchMock;
    await getMarketMoversCached();
    expect(fetchMock.mock.calls[0][1].headers.has('Authorization')).toBe(false);
  });

  it('uses directional endpoint paths and separate cache sections', async () => {
    const fetchMock = mockFetchByEndpoint();
    (global as any).fetch = fetchMock;
    await Promise.all([getMarketGainersCached(), getMarketLosersCached()]);

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      expect.stringContaining('/api/catalog/market-movers?mode=gainers'),
      expect.stringContaining('/api/catalog/market-movers?mode=losers'),
    ]));
    const cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY))!);
    expect(cache.gainers.data).toHaveLength(1);
    expect(cache.losers.data).toHaveLength(1);
  });

  it('isolates cached market data by supplied user and preference scope', async () => {
    await getMarketMoversCached(undefined, { cacheScope: 'user-a:pokemon' });
    const fetchMock = mockFetchByEndpoint();
    (global as any).fetch = fetchMock;
    const fromOtherScope = await getMarketMoversCached(undefined, { cacheScope: 'user-b:magic' });

    expect(fromOtherScope).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('@verified_tcg/market_cache_v5:user-a%3Apokemon')).toBeTruthy();
    expect(await AsyncStorage.getItem('@verified_tcg/market_cache_v5:user-b%3Amagic')).toBeTruthy();
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

  it('clears stale cached data and notifies the view on a successful empty revalidation', async () => {
    await getMarketMoversCached();
    const cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY))!);
    cache.movers.updatedAt = Date.now() - 10 * 60 * 1000;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    (global as any).fetch = jest.fn(async () => jsonResponse([]));

    const onUpdate = jest.fn();
    expect(await getMarketMoversCached(onUpdate)).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(onUpdate).toHaveBeenCalledWith([]);
    expect(JSON.parse((await AsyncStorage.getItem(CACHE_KEY))!).movers.data).toEqual([]);
  });
});
