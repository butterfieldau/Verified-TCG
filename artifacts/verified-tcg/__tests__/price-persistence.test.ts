/**
 * Price persistence tests
 *
 * Tests the pure helpers in services/pricePersistence.ts that read/write
 * refreshed prices and the refresh timestamp to AsyncStorage.
 *
 * Also covers the end-to-end contract: save → load → apply confirms that
 * prices written after a refresh are fully restored on the next app start.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadPersistedPrices,
  saveRefreshedPrices,
  applyPersistedCollectionPrices,
  COLLECTION_PRICES_KEY,
  WATCHLIST_PRICES_KEY,
  PRICES_LAST_UPDATED_KEY,
} from '../services/pricePersistence';
import type { CollectionItem, WatchlistItem } from '../types';

// ── fixtures ──────────────────────────────────────────────────────────────────

function makePrice(raw: number) {
  return { raw, psa10: raw * 1.5, psa9: raw * 1.2, currency: 'AUD' as const, updatedAt: '2026-01-15T00:00:00.000Z' };
}

function makeCollectionItem(id: string, raw: number): CollectionItem {
  return {
    id,
    cardId: `card-${id}`,
    quantity: 1,
    condition: 'near_mint',
    acquiredAt: '2024-01-01',
    acquiredPrice: raw,
    currency: 'AUD',
    card: {
      id: `card-${id}`,
      name: `Card ${id}`,
      setName: 'Test Set',
      setId: 'ts',
      number: '001',
      rarity: 'rare',
      tcg: 'pokemon',
      imageUrl: '',
      price: makePrice(raw),
    },
  } as unknown as CollectionItem;
}

function makeWatchlistItem(id: string, raw: number): WatchlistItem {
  return {
    id,
    cardId: `card-${id}`,
    addedAt: '2024-01-01',
    priceAlertEnabled: false,
    card: {
      id: `card-${id}`,
      name: `Card ${id}`,
      setName: 'Test Set',
      setId: 'ts',
      number: '001',
      rarity: 'rare',
      tcg: 'pokemon',
      imageUrl: '',
      price: makePrice(raw),
    },
  } as unknown as WatchlistItem;
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ── saveRefreshedPrices ───────────────────────────────────────────────────────

describe('saveRefreshedPrices', () => {
  it('writes collection prices, watchlist prices, and ISO timestamp to AsyncStorage', async () => {
    const collection = [makeCollectionItem('col-1', 100), makeCollectionItem('col-2', 200)];
    const watchlist = [makeWatchlistItem('wl-1', 50)];
    const now = new Date('2026-01-15T12:00:00.000Z');

    await saveRefreshedPrices(collection, watchlist, now);

    const [storedCol, storedWl, storedTs] = await Promise.all([
      AsyncStorage.getItem(COLLECTION_PRICES_KEY),
      AsyncStorage.getItem(WATCHLIST_PRICES_KEY),
      AsyncStorage.getItem(PRICES_LAST_UPDATED_KEY),
    ]);

    // Timestamp is stored as ISO string
    expect(storedTs).toBe(now.toISOString());

    // Collection price map contains every item
    const colMap = JSON.parse(storedCol!) as Record<string, { raw: number }>;
    expect(colMap['col-1'].raw).toBe(100);
    expect(colMap['col-2'].raw).toBe(200);

    // Watchlist price map contains every item
    const wlMap = JSON.parse(storedWl!) as Record<string, { raw: number }>;
    expect(wlMap['wl-1'].raw).toBe(50);
  });

  it('overwrites a previous save with the latest prices', async () => {
    const collection = [makeCollectionItem('col-1', 100)];
    const now1 = new Date('2026-01-15T10:00:00.000Z');
    await saveRefreshedPrices(collection, [], now1);

    // Simulate a second refresh with a higher price
    const updated = [makeCollectionItem('col-1', 110)];
    const now2 = new Date('2026-01-15T11:00:00.000Z');
    await saveRefreshedPrices(updated, [], now2);

    const colMap = JSON.parse((await AsyncStorage.getItem(COLLECTION_PRICES_KEY))!) as Record<string, { raw: number }>;
    const ts = await AsyncStorage.getItem(PRICES_LAST_UPDATED_KEY);

    expect(colMap['col-1'].raw).toBe(110);
    expect(ts).toBe(now2.toISOString());
  });
});

// ── loadPersistedPrices ───────────────────────────────────────────────────────

describe('loadPersistedPrices', () => {
  it('returns null fields when AsyncStorage is empty', async () => {
    const result = await loadPersistedPrices();
    expect(result.collectionPrices).toBeNull();
    expect(result.watchlistPrices).toBeNull();
    expect(result.lastUpdated).toBeNull();
  });

  it('restores collection prices, watchlist prices, and timestamp after a save', async () => {
    const collection = [makeCollectionItem('col-1', 100)];
    const watchlist = [makeWatchlistItem('wl-1', 50)];
    const now = new Date('2026-01-15T12:00:00.000Z');

    await saveRefreshedPrices(collection, watchlist, now);

    const result = await loadPersistedPrices();

    expect(result.collectionPrices).not.toBeNull();
    expect(result.collectionPrices!['col-1'].raw).toBe(100);

    expect(result.watchlistPrices).not.toBeNull();
    expect(result.watchlistPrices!['wl-1'].raw).toBe(50);

    expect(result.lastUpdated).not.toBeNull();
    expect(result.lastUpdated!.toISOString()).toBe(now.toISOString());
  });

  it('returns null for a corrupted price entry without throwing', async () => {
    await AsyncStorage.setItem(COLLECTION_PRICES_KEY, 'not-valid-json');
    await AsyncStorage.setItem(PRICES_LAST_UPDATED_KEY, new Date().toISOString());

    const result = await loadPersistedPrices();
    expect(result.collectionPrices).toBeNull();
    expect(result.lastUpdated).not.toBeNull(); // timestamp was valid
  });

  it('returns null for a corrupted timestamp without throwing', async () => {
    const collection = [makeCollectionItem('col-1', 100)];
    await saveRefreshedPrices(collection, [], new Date());
    await AsyncStorage.setItem(PRICES_LAST_UPDATED_KEY, 'not-a-date');

    const result = await loadPersistedPrices();
    expect(result.collectionPrices).not.toBeNull(); // prices were valid
    expect(result.lastUpdated).toBeNull();
  });
});

// ── applyPersistedCollectionPrices ────────────────────────────────────────────

describe('applyPersistedCollectionPrices', () => {
  it('patches matching items with persisted prices', () => {
    const items = [makeCollectionItem('col-1', 100), makeCollectionItem('col-2', 200)];
    const priceMap = { 'col-1': makePrice(120) };

    const result = applyPersistedCollectionPrices(items, priceMap);

    expect(result[0].card.price.raw).toBe(120); // patched
    expect(result[1].card.price.raw).toBe(200); // unchanged
  });

  it('leaves items unchanged when there is no matching entry in the price map', () => {
    const items = [makeCollectionItem('col-1', 100)];
    const result = applyPersistedCollectionPrices(items, {});
    expect(result[0].card.price.raw).toBe(100);
  });
});

// ── end-to-end: save → load → apply ──────────────────────────────────────────

describe('end-to-end: refresh completion followed by remount', () => {
  it('restores the exact prices written during a refresh', async () => {
    // Simulate a price refresh: original prices + $10 delta.
    const original = [makeCollectionItem('col-1', 100), makeCollectionItem('col-2', 200)];
    const refreshed = original.map(item => ({
      ...item,
      card: { ...item.card, price: makePrice(item.card.price.raw + 10) },
    }));
    const now = new Date('2026-01-15T12:00:00.000Z');

    // Save — as refreshPrices() does before it resolves.
    await saveRefreshedPrices(refreshed, [], now);

    // Load — as AppProvider does on mount (simulating a restart).
    const persisted = await loadPersistedPrices();
    const restored = applyPersistedCollectionPrices(original, persisted.collectionPrices!);

    // Each price should equal the refreshed value, not the original.
    expect(restored[0].card.price.raw).toBe(110);
    expect(restored[1].card.price.raw).toBe(210);

    // Timestamp should survive the round-trip.
    expect(persisted.lastUpdated!.toISOString()).toBe(now.toISOString());
  });
});
