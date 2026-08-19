jest.mock('../services/auth', () => ({
  getAccessToken: jest.fn(() => Promise.resolve('fake-access-token')),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  fetchVerifiedPricing,
  fetchVerifiedPriceHistory,
} from '../services/verifiedPricing';
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
    expect(url).not.toContain('PRICECHARTING_TOKEN');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fake-access-token');
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