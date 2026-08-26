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
