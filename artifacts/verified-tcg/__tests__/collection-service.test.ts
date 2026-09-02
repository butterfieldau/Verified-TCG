/**
 * Collection service unit tests
 *
 * Mocks the global fetch and the auth service so we can verify that the
 * service functions call the correct API endpoints with the right payloads.
 */
import type { CollectionItem } from '../types';

// Mock the auth module so getAccessToken returns a fake token
jest.mock('../services/auth', () => ({
  getAccessToken: jest.fn(() => Promise.resolve('fake-access-token')),
  restoreSession: jest.fn(() =>
    Promise.resolve({ access_token: 'fake-access-token', refresh_token: 'rt', user: { id: 'u1' } }),
  ),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks are set up
import {
  fetchCollection,
  addCollectionItem,
  updateCollectionItem,
  removeCollectionItem,
  getItemCurrentValue,
  getCollectionGradeKey,
  getCollectionHoldingIdentity,
  formatCollectionHoldingLabel,
  findMatchingCollectionHolding,
  COLLECTION_GRADE_OPTIONS,
  summarizeCollectionHoldings,
} from '../services/collection';

const FAKE_API_BASE = ''; // process.env.EXPO_PUBLIC_API_BASE_URL is '' in test env

function makeCollectionItem(id = 'item-001'): CollectionItem {
  return {
    id,
    cardId: 'card-001',
    quantity: 1,
    condition: 'near_mint',
    acquiredAt: '2025-01-01',
    acquiredPrice: 10,
    currency: 'AUD',
    card: {
      id: 'card-001',
      name: 'Charizard',
      setName: 'Base Set',
      setId: 'base',
      number: '4',
      rarity: 'holo_rare',
      game: 'Pokemon',
      image: 'https://example.com/charizard.jpg',
      price: { raw: 100, currency: 'AUD', updatedAt: '2025-01-01T00:00:00Z' },
    },
  };
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.verified.test';
  mockFetch.mockClear();
});

describe('fetchCollection', () => {
  it('calls GET /api/collection with the auth token', async () => {
    const items = [makeCollectionItem()];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(items),
    } as Response);

    const result = await fetchCollection();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fake-access-token');
    expect(result).toEqual(items);
  });

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    await expect(fetchCollection()).rejects.toThrow();
  });
});

describe('getItemCurrentValue', () => {
  it('uses the server-resolved PSA 10 quote instead of conflicting raw card metadata', () => {
    const item = {
      ...makeCollectionItem(),
      grading: { company: 'PSA', grade: 10, certNumber: '123' },
      card: {
        ...makeCollectionItem().card,
        price: { raw: 25, psa10: 225, currency: 'AUD', updatedAt: '2025-01-01T00:00:00Z' },
      },
      valuation: {
        priceCents: 22500,
        price: 225,
        currency: 'AUD',
        gradeKey: 'psa_10',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    } as CollectionItem;

    expect(getItemCurrentValue(item)).toBe(225);
  });

  it('does not silently substitute a raw quote when a graded quote is unavailable', () => {
    const item = {
      ...makeCollectionItem(),
      grading: { company: 'PSA', grade: 10, certNumber: '123' },
      card: {
        ...makeCollectionItem().card,
        price: { raw: 25, currency: 'AUD', updatedAt: '2025-01-01T00:00:00Z' },
      },
      valuation: null,
    } as CollectionItem;

    expect(getItemCurrentValue(item)).toBeNull();
  });
});

describe('exact holdings grade identity', () => {
  it('keeps raw, company-specific grade 10s, and generic buckets distinct', () => {
    const raw = makeCollectionItem('raw');
    const psa = { ...makeCollectionItem('psa'), grading: { company: 'PSA', grade: 10 } } as CollectionItem;
    const bgs = { ...makeCollectionItem('bgs'), grading: { company: 'BGS', grade: 10 } } as CollectionItem;
    const generic = { ...makeCollectionItem('generic'), grading: { company: 'Generic', grade: 7.5 } } as CollectionItem;

    expect(getCollectionGradeKey(raw)).toBe('raw');
    expect(getCollectionGradeKey(psa)).toBe('psa_10');
    expect(getCollectionGradeKey(bgs)).toBe('bgs_10');
    expect(getCollectionGradeKey(generic)).toBe('graded_7_75');
    expect(getCollectionHoldingIdentity(generic)).toBe('generic_7.5');
    expect(findMatchingCollectionHolding([raw, psa, bgs, generic], 'card-001', 'psa_10')).toBe(psa);
    expect(findMatchingCollectionHolding([raw, psa, bgs, generic], 'card-001', 'cgc_10')).toBeUndefined();
  });

  it('does not map unsupported PSA grades onto generic or raw pricing, while retaining exact identity', () => {
    const psaNine = {
      ...makeCollectionItem('psa-nine'),
      grading: { company: 'PSA', grade: 9 },
      valuation: null,
    } as CollectionItem;
    expect(getCollectionGradeKey(psaNine)).toBeNull();
    expect(getCollectionHoldingIdentity(psaNine)).toBe('psa_9');
    expect(findMatchingCollectionHolding([psaNine], 'card-001', 'graded_9')).toBeUndefined();
    expect(findMatchingCollectionHolding([psaNine], 'card-001', 'raw')).toBeUndefined();
  });

  it('keeps slab designations in the persisted identity', () => {
    const blackLabel = { ...makeCollectionItem('black'), grading: { company: 'BGS', grade: 10, designation: 'Black Label' } } as CollectionItem;
    const pristine = { ...makeCollectionItem('pristine'), grading: { company: 'CGC', grade: 10, designation: 'Pristine' } } as CollectionItem;
    expect(getCollectionHoldingIdentity(blackLabel)).toBe('bgs_10_black_label');
    expect(getCollectionHoldingIdentity(pristine)).toBe('cgc_10_pristine');
    expect(findMatchingCollectionHolding([blackLabel, pristine], 'card-001', 'bgs_10')).toBeUndefined();
    expect(findMatchingCollectionHolding([blackLabel, pristine], 'card-001', 'bgs_10_black_label')).toBe(blackLabel);
    expect(formatCollectionHoldingLabel(blackLabel)).toBe('BGS 10 · Black Label');
    expect(formatCollectionHoldingLabel(pristine)).toBe('CGC 10 · Pristine');
  });

  it('offers exact generic grades separately while sharing only their valuation bucket', () => {
    const genericOptions = COLLECTION_GRADE_OPTIONS.filter(option => option.company === 'Generic');
    expect(genericOptions.map(option => option.label)).toEqual([
      'Generic Graded 7',
      'Generic Graded 7.5',
      'Generic Graded 8',
      'Generic Graded 8.5',
      'Generic Graded 9',
      'Generic Graded 9.5',
    ]);
    expect(genericOptions.find(option => option.grade === 7)?.gradeKey).toBe('graded_7_75');
    expect(genericOptions.find(option => option.grade === 7.5)?.gradeKey).toBe('graded_7_75');
    expect(genericOptions.find(option => option.grade === 7)?.identityKey).not.toBe(
      genericOptions.find(option => option.grade === 7.5)?.identityKey,
    );
  });

  it('excludes unavailable variants from the aggregate without hiding their copies', () => {
    const valued = {
      ...makeCollectionItem('valued'),
      quantity: 2,
      valuation: {
        priceCents: 12500,
        price: 125,
        currency: 'AUD',
        gradeKey: 'raw',
        updatedAt: '2026-09-01T00:00:00Z',
      },
    } as CollectionItem;
    const unavailable = { ...makeCollectionItem('unavailable'), quantity: 3, valuation: null } as CollectionItem;

    expect(summarizeCollectionHoldings([valued, unavailable])).toEqual({
      quantity: 5,
      totalValue: 250,
      pricedVariants: 1,
      unavailableVariants: 1,
      currency: 'AUD',
    });
  });
});

describe('addCollectionItem', () => {
  it('calls POST /api/collection with the correct body', async () => {
    const item = makeCollectionItem();
    const serverItem = { ...item, id: 'server-assigned-id' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(serverItem),
    } as Response);

    const result = await addCollectionItem(item);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.cardId).toBe(item.cardId);
    expect(result).toEqual(serverItem);
  });
});

describe('updateCollectionItem', () => {
  it('persists the full collector acquisition edit through the API', async () => {
    const updated = {
      ...makeCollectionItem(),
      quantity: 2,
      acquiredPrice: 120.5,
      currency: 'USD',
      acquiredAt: '2025-02-03',
      condition: 'excellent' as const,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(updated),
    } as Response);

    await expect(updateCollectionItem('item-001', {
      quantity: 2,
      acquiredPrice: 120.5,
      currency: 'USD',
      acquiredAt: '2025-02-03',
      condition: 'excellent',
    })).resolves.toEqual(updated);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection/item-001');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      quantity: 2,
      acquiredPrice: 120.5,
      currency: 'USD',
      acquiredAt: '2025-02-03',
      condition: 'excellent',
    });
  });
});

describe('removeCollectionItem', () => {
  it('calls DELETE /api/collection/:id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Deleted' }),
    } as Response);

    await removeCollectionItem('item-001');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection/item-001');
    expect(init.method).toBe('DELETE');
  });

  it('throws when the item is not found (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await expect(removeCollectionItem('missing-item')).rejects.toThrow();
  });
});
