/**
 * Price persistence helpers
 *
 * Encapsulates reading and writing refreshed prices and their timestamp to
 * AsyncStorage. Isolated here so the logic can be unit-tested independently
 * of the React rendering layer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CollectionItem, WatchlistItem } from '@/types';

export const COLLECTION_PRICES_KEY = '@verified_tcg/collection_prices';
export const WATCHLIST_PRICES_KEY = '@verified_tcg/watchlist_prices';
export const PRICES_LAST_UPDATED_KEY = '@verified_tcg/prices_last_updated';

export type PriceMap = Record<string, CollectionItem['card']['price']>;

export interface PersistedPrices {
  collectionPrices: PriceMap | null;
  watchlistPrices: PriceMap | null;
  lastUpdated: Date | null;
}

/**
 * Reads all persisted price data from AsyncStorage in one batch.
 * Returns `null` for any entry that is missing or corrupt.
 */
export async function loadPersistedPrices(): Promise<PersistedPrices> {
  const [storedCollection, storedWatchlist, storedTimestamp] = await AsyncStorage.multiGet([
    COLLECTION_PRICES_KEY,
    WATCHLIST_PRICES_KEY,
    PRICES_LAST_UPDATED_KEY,
  ]);

  let collectionPrices: PriceMap | null = null;
  try {
    const raw = storedCollection[1];
    if (raw !== null) {
      collectionPrices = JSON.parse(raw) as PriceMap;
    }
  } catch {
    // Corrupted — fall back to mock prices
  }

  let watchlistPrices: PriceMap | null = null;
  try {
    const raw = storedWatchlist[1];
    if (raw !== null) {
      watchlistPrices = JSON.parse(raw) as PriceMap;
    }
  } catch {
    // Corrupted — fall back to current prices
  }

  let lastUpdated: Date | null = null;
  try {
    const raw = storedTimestamp[1];
    if (raw !== null) {
      const ts = new Date(raw);
      if (!isNaN(ts.getTime())) {
        lastUpdated = ts;
      }
    }
  } catch {
    // Corrupted — leave as null
  }

  return { collectionPrices, watchlistPrices, lastUpdated };
}

/**
 * Persists refreshed prices and the refresh timestamp to AsyncStorage.
 * Awaited before the caller resolves so an immediate restart cannot lose data.
 */
export async function saveRefreshedPrices(
  collection: CollectionItem[],
  watchlist: WatchlistItem[],
  timestamp: Date,
): Promise<void> {
  const collectionPriceMap: PriceMap = {};
  collection.forEach(item => { collectionPriceMap[item.id] = item.card.price; });

  const watchlistPriceMap: PriceMap = {};
  watchlist.forEach(item => { watchlistPriceMap[item.id] = item.card.price; });

  await AsyncStorage.multiSet([
    [COLLECTION_PRICES_KEY, JSON.stringify(collectionPriceMap)],
    [WATCHLIST_PRICES_KEY, JSON.stringify(watchlistPriceMap)],
    [PRICES_LAST_UPDATED_KEY, timestamp.toISOString()],
  ]);
}

/**
 * Applies persisted prices (by item id) onto a collection array.
 * Items whose id has no persisted price are returned unchanged.
 */
export function applyPersistedCollectionPrices<T extends { id: string; card: { price: PriceMap[string] } }>(
  items: T[],
  priceMap: PriceMap,
): T[] {
  return items.map(item =>
    priceMap[item.id] ? { ...item, card: { ...item.card, price: priceMap[item.id] } } : item,
  );
}
