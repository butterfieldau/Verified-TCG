jest.mock('../services/auth', () => ({
  getAccessToken: jest.fn(() => Promise.resolve('fake-access-token')),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  fetchVerifiedPricing,
  fetchVerifiedPriceHistory,
} from '../services/verifiedPricing';
import { fetchEbaySoldHistory } from '../services/priceHistory';
import { ebaySoldHistoryAvailabilityCopy } from '../components/ui/EbaySoldHistoryCard';
import {
  fetchCollectionPerformance,
  fetchArchive,
  sellCollectionItem,
} from '../services/collectionPerformance';

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('Verified pricing mobile service', () => {
  it('preserves the honest missing-secret state without inventing quotes', async () => {
    mockFetch.mockResolvedValueOnce(response({
      status: 'unavailable',
      configured: false,
      mappingStatus: null,
      source: null,
      confidence: { level: null, score: null },
      quotes: [],
      updatedAt: null,
      stale: false,
      message: 'Pricing source is not configured yet.',
    }));

    const result = await fetchVerifiedPricing('card-1', {
      name: 'Pikachu',
      set: 'Vivid Voltage',
      number: '043',
      displayCurrency: 'AUD',
    });

    expect(result.status).toBe('unavailable');
    expect(result.configured).toBe(false);
    expect(result.quotes).toEqual([]);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/pricing/cards/card-1');
    expect(url).toContain('displayCurrency=AUD');
    expect(url).not.toContain('PRICECHARTING_API_TOKEN');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fake-access-token');
    expect(new Headers(init.headers).get('x-app-version')).toBeTruthy();
  });

  it('preserves unavailable history and null movement', async () => {
    mockFetch.mockResolvedValueOnce(response({
      cardId: 'card-1',
      gradeKey: 'raw',
      period: '30d',
      points: [],
      historyAvailable: false,
      movement: null,
      updatedAt: null,
    }));

    const result = await fetchVerifiedPriceHistory('card-1', 'raw', '30d', 'AUD');
    expect(result.historyAvailable).toBe(false);
    expect(result.points).toEqual([]);
    expect(result.movement).toBeNull();
  });

  it('does not cache a pending match ahead of the provider result', async () => {
    mockFetch
      .mockResolvedValueOnce(response({
        cardId: 'pending-card', status: 'pending_match', configured: true,
        queued: true, quotes: [], verifiedMarket: [], source: null,
        confidence: null, providerMetadata: null, updatedAt: null, isStale: false,
      }))
      .mockResolvedValueOnce(response({
        cardId: 'pending-card', status: 'available', configured: true,
        queued: false,
        quotes: [{ gradeKey: 'raw', label: 'Raw', priceCents: 1250, price: 12.5, currency: 'AUD', originalPriceCents: 800, originalCurrency: 'USD' }],
        verifiedMarket: [], source: null, confidence: null, providerMetadata: null,
        updatedAt: '2026-08-31T00:00:00.000Z', isStale: false,
      }));

    const pending = await fetchVerifiedPricing('pending-card', { displayCurrency: 'AUD' });
    const available = await fetchVerifiedPricing('pending-card', { displayCurrency: 'AUD' });

    expect(pending.status).toBe('pending_match');
    expect(available.status).toBe('available');
    expect(available.quotes[0]?.gradeKey).toBe('raw');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed pricing request distinct from a genuinely unpriced card', async () => {
    mockFetch.mockResolvedValueOnce(response({}, false));

    await expect(fetchVerifiedPricing('network-error-card', { displayCurrency: 'AUD' }))
      .rejects.toThrow('temporarily unavailable');
  });

  it('keeps a failed price-history request distinct from empty retained history', async () => {
    mockFetch.mockResolvedValueOnce(response({}, false));

    await expect(fetchVerifiedPriceHistory('history-error-card', 'raw', '30d', 'AUD'))
      .rejects.toThrow('temporarily unavailable');
  });

  it.each([
    ['7d', '7d'],
    ['30d', '30d'],
    ['90d', '90d'],
    ['180d', '180d'],
    ['1y', '1y'],
    ['all', 'all'],
  ] as const)('sends the %s history period without remapping it', async (period, expected) => {
    mockFetch.mockResolvedValueOnce(response({
      cardId: 'card-1',
      gradeKey: 'raw',
      points: [],
      historyAvailable: false,
      movement: null,
      updatedAt: null,
    }));

    await fetchVerifiedPriceHistory('card-1', 'raw', period, 'AUD');
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`period=${expected}`);
  });
});

describe('eBay sold-history mobile service', () => {
  it('keeps normalized completed sales and selected display currency intact', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
    mockFetch.mockResolvedValueOnce(response({
      cardId: 'card-1',
      gradeKey: 'psa10',
      period: '30D',
      currency: 'EUR',
      source: 'ebay_completed_sales',
      configured: true,
      availability: 'available',
      message: null,
      sales: [{
        title: 'Pikachu PSA 10',
        endedAt: '2026-08-19T12:00:00.000Z',
        condition: 'Graded',
        priceCents: 12000,
        price: 120,
        currency: 'EUR',
        url: 'https://www.ebay.com/itm/123',
      }],
      points: [{ date: '2026-08-19', priceCents: 12000, price: 120, currency: 'EUR' }],
      movement: null,
      returnedAt: '2026-08-20T12:00:00.000Z',
    }));

    const result = await fetchEbaySoldHistory('card-1', {
      name: 'Pikachu',
      set: 'Base Set',
      game: 'pokemon',
      number: '025',
      gradeKey: 'psa10',
      period: '30D',
      displayCurrency: 'EUR',
    });

    expect(result.availability).toBe('available');
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]?.url).toBe('https://www.ebay.com/itm/123');
    expect(result.currency).toBe('EUR');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/ebay-sold-history');
    expect(url).toContain('grade=psa10');
    expect(url).toContain('displayCurrency=EUR');
    expect(url).not.toContain('EBAY_APP_ID');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fake-access-token');
    expect(new Headers(init.headers).get('x-app-version')).toBeTruthy();
  });

  it('preserves a configuration failure instead of returning an ambiguous empty history', async () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';
    mockFetch.mockResolvedValueOnce(response({
      configured: false,
      availability: 'configuration_error',
      message: 'eBay sold history is not configured for this app.',
      sales: [],
      points: [],
      movement: null,
      returnedAt: null,
    }));

    const result = await fetchEbaySoldHistory('card-1', {
      name: 'Pikachu',
      set: 'Base Set',
      game: 'pokemon',
      number: '025',
      gradeKey: 'raw',
      period: '7D',
      displayCurrency: 'AUD',
    });

    expect(result.availability).toBe('configuration_error');
    expect(result.configured).toBe(false);
    expect(result.sales).toEqual([]);
    expect(result.message).toContain('not configured');
  });

  it('renders a distinct retryable explanation for currency conversion failures', () => {
    const copy = ebaySoldHistoryAvailabilityCopy({
      cardId: 'card-1',
      gradeKey: 'raw',
      period: '30D',
      currency: 'AUD',
      source: 'ebay_completed_sales',
      configured: true,
      availability: 'conversion_error',
      coverage: 'returned_results',
      message: 'Completed sales were found, but they could not be converted to AUD.',
      sales: [],
      points: [],
      movement: null,
      returnedAt: null,
    });
    expect(copy.title).toBe('Sale currency unavailable');
    expect(copy.retryable).toBe(true);
    expect(copy.message).toContain('could not be converted');
  });
});

describe('Collection performance and archive mobile service', () => {
  it('normalizes server allocations and performer fields for the UI', async () => {
    mockFetch.mockResolvedValueOnce(response({
      points: [],
      realisedGain: null,
      unrealizedGain: null,
      costBasis: null,
      currency: 'AUD',
      allocations: [{ name: 'Pokémon', value: 125, percentage: 62.5 }],
      topPerformers: [{
        cardId: 'card-1',
        name: 'Pikachu',
        gain: 20,
        gainPercent: 19.05,
        currentValue: 125,
        costBasis: 105,
      }],
      worstPerformers: [],
      historyAvailable: false,
      historyUnavailableReason: 'No retained snapshots for this range.',
      completeness: 'Pricing coverage is incomplete.',
    }));

    const result = await fetchCollectionPerformance('1M', 'AUD');
    expect(result.unrealisedGain).toBeNull();
    expect(result.allocations[0]).toMatchObject({
      label: 'Pokémon',
      value: 125,
      percent: 62.5,
    });
    expect(result.topPerformers[0]).toMatchObject({
      cardId: 'card-1',
      name: 'Pikachu',
      gainAbsolute: 20,
      currency: 'AUD',
    });
  });

  it('requests archive values in the selected display currency and preserves null realised gain', async () => {
    mockFetch.mockResolvedValueOnce(response([{
      id: 'archive-1',
      displayCurrency: 'EUR',
      realisedGain: null,
      realisedGainPercent: null,
    }]));

    const result = await fetchArchive('EUR');
    expect(result[0]?.realisedGain).toBeNull();
    expect((mockFetch.mock.calls[0] as [string])[0]).toContain('displayCurrency=EUR');
  });

  it('sends sale proceeds as a transaction total with currency and date', async () => {
    mockFetch.mockResolvedValueOnce(response({
      id: 'archive-1',
      displayCurrency: 'AUD',
      realisedGain: 25,
      realisedGainPercent: 50,
    }));

    const result = await sellCollectionItem('holding-1', {
      salePrice: 75,
      currency: 'AUD',
      soldAt: '2026-08-19',
      notes: 'Convention sale',
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      salePrice: 75,
      currency: 'AUD',
      soldAt: '2026-08-19',
    });
    expect(result.id).toBe('archive-1');
  });
});
