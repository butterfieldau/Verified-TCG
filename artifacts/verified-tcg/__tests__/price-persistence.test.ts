/**
 * Price persistence tests
 *
 * Tests the pure helpers in services/pricePersistence.ts that read/write
 * refreshed prices and the refresh timestamp to AsyncStorage.
 *
 * Covers:
 *   - saveRefreshedPrices: writes versioned envelope to PRICES_STORAGE_KEY
 *   - loadPersistedPrices: happy path, version mismatch, corrupt data
 *   - Legacy-key migration: data written by older app versions is preserved
 *   - applyPersistedCollectionPrices: price patching helper
 *   - End-to-end: save → load → apply confirms full round-trip
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadPersistedPrices,
  saveRefreshedPrices,
  applyPersistedCollectionPrices,
  PRICES_STORAGE_KEY,
  PRICE_PERSISTENCE_VERSION,
  COLLECTION_PRICES_KEY,
  WATCHLIST_PRICES_KEY,
  PRICES_LAST_UPDATED_KEY,
  type PricesPayload,
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
  it('writes a versioned envelope to PRICES_STORAGE_KEY', async () => {
    const collection = [makeCollectionItem('col-1', 100), makeCollectionItem('col-2', 200)];
    const watchlist = [makeWatchlistItem('wl-1', 50)];
    const now = new Date('2026-01-15T12:00:00.000Z');

    await saveRefreshedPrices(collection, watchlist, now);

    const raw = await AsyncStorage.getItem(PRICES_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const payload = JSON.parse(raw!) as PricesPayload;

    // Envelope must carry the current schema version
    expect(payload.version).toBe(PRICE_PERSISTENCE_VERSION);

    // Timestamp is stored as ISO string
    expect(payload.lastUpdated).toBe(now.toISOString());

    // Collection price map contains every item
    expect(payload.collectionPrices['col-1'].raw).toBe(100);
    expect(payload.collectionPrices['col-2'].raw).toBe(200);

    // Watchlist price map contains every item
    expect(payload.watchlistPrices['wl-1'].raw).toBe(50);
  });

  it('overwrites a previous save with the latest prices', async () => {
    const collection1 = [makeCollectionItem('col-1', 100)];
    await saveRefreshedPrices(collection1, [], new Date('2026-01-15T10:00:00.000Z'));

    const collection2 = [makeCollectionItem('col-1', 110)];
    const now2 = new Date('2026-01-15T11:00:00.000Z');
    await saveRefreshedPrices(collection2, [], now2);

    const payload = JSON.parse((await AsyncStorage.getItem(PRICES_STORAGE_KEY))!) as PricesPayload;
    expect(payload.collectionPrices['col-1'].raw).toBe(110);
    expect(payload.lastUpdated).toBe(now2.toISOString());
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

  it('discards the payload when the version is newer than the current app understands', async () => {
    const futurePayload: PricesPayload = {
      version: PRICE_PERSISTENCE_VERSION + 1,
      collectionPrices: { 'col-1': makePrice(999) },
      watchlistPrices: {},
      lastUpdated: new Date().toISOString(),
    };
    await AsyncStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(futurePayload));

    const result = await loadPersistedPrices();

    // Prices from a newer schema are not applied — collector re-fetches next refresh
    expect(result.collectionPrices).toBeNull();
    expect(result.watchlistPrices).toBeNull();
    expect(result.lastUpdated).toBeNull();
  });

  it('returns null for a corrupted envelope without throwing', async () => {
    await AsyncStorage.setItem(PRICES_STORAGE_KEY, 'not-valid-json');

    const result = await loadPersistedPrices();
    expect(result.collectionPrices).toBeNull();
    expect(result.lastUpdated).toBeNull();
  });
});

// ── legacy-key migration ──────────────────────────────────────────────────────

describe('legacy-key migration', () => {
  it('reads prices from the three legacy keys and migrates them to the versioned envelope', async () => {
    const colMap = { 'col-1': makePrice(100), 'col-2': makePrice(200) };
    const wlMap = { 'wl-1': makePrice(50) };
    const ts = new Date('2026-01-10T08:00:00.000Z');

    // Write using the old three-key format
    await AsyncStorage.multiSet([
      [COLLECTION_PRICES_KEY, JSON.stringify(colMap)],
      [WATCHLIST_PRICES_KEY, JSON.stringify(wlMap)],
      [PRICES_LAST_UPDATED_KEY, ts.toISOString()],
    ]);

    const result = await loadPersistedPrices();

    // Prices should be restored from legacy keys
    expect(result.collectionPrices).not.toBeNull();
    expect(result.collectionPrices!['col-1'].raw).toBe(100);
    expect(result.collectionPrices!['col-2'].raw).toBe(200);

    expect(result.watchlistPrices).not.toBeNull();
    expect(result.watchlistPrices!['wl-1'].raw).toBe(50);

    expect(result.lastUpdated).not.toBeNull();
    expect(result.lastUpdated!.toISOString()).toBe(ts.toISOString());
  });

  it('writes the versioned envelope after migration so subsequent loads skip the legacy path', async () => {
    const colMap = { 'col-1': makePrice(100) };
    const ts = new Date('2026-01-10T08:00:00.000Z');

    await AsyncStorage.multiSet([
      [COLLECTION_PRICES_KEY, JSON.stringify(colMap)],
      [PRICES_LAST_UPDATED_KEY, ts.toISOString()],
    ]);

    // First load triggers migration
    await loadPersistedPrices();

    // The new versioned key must be present after migration
    const envelope = await AsyncStorage.getItem(PRICES_STORAGE_KEY);
    expect(envelope).not.toBeNull();
    const payload = JSON.parse(envelope!) as PricesPayload;
    expect(payload.version).toBe(PRICE_PERSISTENCE_VERSION);
    expect(payload.collectionPrices['col-1'].raw).toBe(100);
  });

  it('removes the legacy keys after a successful migration', async () => {
    const colMap = { 'col-1': makePrice(100) };
    const ts = new Date('2026-01-10T08:00:00.000Z');

    await AsyncStorage.multiSet([
      [COLLECTION_PRICES_KEY, JSON.stringify(colMap)],
      [WATCHLIST_PRICES_KEY, JSON.stringify({})],
      [PRICES_LAST_UPDATED_KEY, ts.toISOString()],
    ]);

    await loadPersistedPrices();

    // Legacy keys should be gone so future loads don't re-migrate stale data
    const [col, wl, stamp] = await Promise.all([
      AsyncStorage.getItem(COLLECTION_PRICES_KEY),
      AsyncStorage.getItem(WATCHLIST_PRICES_KEY),
      AsyncStorage.getItem(PRICES_LAST_UPDATED_KEY),
    ]);
    expect(col).toBeNull();
    expect(wl).toBeNull();
    expect(stamp).toBeNull();
  });

  it('migrates partial legacy data when only some keys are present', async () => {
    // Only collection prices stored — watchlist key absent
    const colMap = { 'col-1': makePrice(77) };
    const ts = new Date('2026-01-10T08:00:00.000Z');

    await AsyncStorage.multiSet([
      [COLLECTION_PRICES_KEY, JSON.stringify(colMap)],
      [PRICES_LAST_UPDATED_KEY, ts.toISOString()],
    ]);

    const result = await loadPersistedPrices();

    expect(result.collectionPrices!['col-1'].raw).toBe(77);
    expect(result.watchlistPrices).not.toBeNull(); // empty map, not null
  });

  it('migrates collection prices even when the legacy timestamp is corrupt', async () => {
    const colMap = { 'col-1': makePrice(55) };

    await AsyncStorage.multiSet([
      [COLLECTION_PRICES_KEY, JSON.stringify(colMap)],
      [PRICES_LAST_UPDATED_KEY, 'not-a-date'],
    ]);

    const result = await loadPersistedPrices();

    // Prices still restored — bad timestamp should not block migration
    expect(result.collectionPrices!['col-1'].raw).toBe(55);
    // Timestamp treated as null when the stored value is not a valid date
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

  it('restores prices migrated from legacy keys on the first launch after upgrade', async () => {
    const original = [makeCollectionItem('col-1', 100)];
    const refreshed = [makeCollectionItem('col-1', 130)];
    const now = new Date('2026-01-10T08:00:00.000Z');

    // Simulate what the old app wrote before versioning was added
    const colMap: Record<string, ReturnType<typeof makePrice>> = {};
    refreshed.forEach(item => { colMap[item.id] = item.card.price; });

    await AsyncStorage.multiSet([
      [COLLECTION_PRICES_KEY, JSON.stringify(colMap)],
      [WATCHLIST_PRICES_KEY, JSON.stringify({})],
      [PRICES_LAST_UPDATED_KEY, now.toISOString()],
    ]);

    // Load — migration path
    const persisted = await loadPersistedPrices();
    const restored = applyPersistedCollectionPrices(original, persisted.collectionPrices!);

    // Refreshed price from legacy storage must be applied
    expect(restored[0].card.price.raw).toBe(130);
    expect(persisted.lastUpdated!.toISOString()).toBe(now.toISOString());
  });
});
