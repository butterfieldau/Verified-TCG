/**
 * Price persistence helpers
 *
 * Encapsulates reading and writing refreshed prices and their timestamp to
 * AsyncStorage. Isolated here so the logic can be unit-tested independently
 * of the React rendering layer.
 *
 * Storage format
 * ──────────────
 * All price data is stored under a single key as a versioned JSON envelope:
 *
 *   { version: number; collectionPrices: PriceMap; watchlistPrices: PriceMap; lastUpdated: string }
 *
 * On load:
 *   1. If the versioned envelope exists and its version matches, it is used as-is.
 *   2. If the envelope's version doesn't match the current version, a migration
 *      is attempted (see migratePricesPayload).  If migration succeeds, the
 *      migrated data is written back under the current version.  If it fails,
 *      the payload is discarded and the app behaves as if no refresh has happened
 *      (prices are re-fetched on the next refresh — no collector data is lost).
 *   3. If the versioned envelope is absent, the loader checks the three legacy
 *      keys written by older app versions and migrates them forward atomically.
 *
 * How to handle a PriceRecord shape change
 * ─────────────────────────────────────────
 * 1. Update `PriceRecord` in types/index.ts.
 * 2. Bump PRICE_PERSISTENCE_VERSION below.
 * 3. Add a `case <old_version>:` block in migratePricesPayload() that transforms
 *    the old payload to the new shape and falls through to the next case.
 *    If the old shape cannot be safely up-converted, return null from that case
 *    and the stale payload will be discarded gracefully.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CollectionItem, WatchlistItem } from '@/types';

/**
 * Bump this constant whenever PriceRecord's shape changes (fields added,
 * removed, or renamed).  Existing stored payloads will be migrated forward
 * by migratePricesPayload(); if migration is impossible, the payload is
 * discarded and prices are re-fetched on the next refresh.
 */
export const PRICE_PERSISTENCE_VERSION = 1;

/** Single AsyncStorage key for the versioned price envelope (current format). */
export const PRICES_STORAGE_KEY = '@verified_tcg/prices_v2';

/**
 * Legacy AsyncStorage keys written by app versions prior to versioned-envelope
 * support.  Still read during migration; never written after this version.
 */
export const COLLECTION_PRICES_KEY = '@verified_tcg/collection_prices';
export const WATCHLIST_PRICES_KEY = '@verified_tcg/watchlist_prices';
export const PRICES_LAST_UPDATED_KEY = '@verified_tcg/prices_last_updated';

export type PriceMap = Record<string, CollectionItem['card']['price']>;

export interface PersistedPrices {
  collectionPrices: PriceMap | null;
  watchlistPrices: PriceMap | null;
  lastUpdated: Date | null;
}

/** Shape of the versioned payload written to AsyncStorage. */
export interface PricesPayload {
  version: number;
  collectionPrices: PriceMap;
  watchlistPrices: PriceMap;
  lastUpdated: string; // ISO-8601
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Attempt to migrate a payload from an older schema version to the current one.
 * Returns the migrated payload, or null if the version gap cannot be bridged
 * safely (caller discards and re-fetches on next refresh).
 *
 * How to add a migration:
 *   1. Bump PRICE_PERSISTENCE_VERSION.
 *   2. Add a `case <old_version>:` block that transforms the payload from the
 *      old shape to the new shape, then falls through.
 */
function migratePricesPayload(payload: PricesPayload): PricesPayload | null {
  let current = { ...payload };

  while (current.version < PRICE_PERSISTENCE_VERSION) {
    switch (current.version) {
      case 0:
        // v0 → v1: envelope shape is identical; no field transforms needed.
        current = { ...current, version: 1 };
        break;
      default:
        // Unknown version — cannot migrate safely.
        return null;
    }
  }

  return current;
}

/**
 * Attempt to build a versioned payload from the three legacy AsyncStorage keys
 * written by app versions that did not have the versioned-envelope format.
 * Returns null if no usable legacy data is found.
 */
async function migrateFromLegacyKeys(): Promise<PricesPayload | null> {
  const [storedCollection, storedWatchlist, storedTimestamp] = await AsyncStorage.multiGet([
    COLLECTION_PRICES_KEY,
    WATCHLIST_PRICES_KEY,
    PRICES_LAST_UPDATED_KEY,
  ]);

  // If none of the three keys exist this is a fresh install — nothing to migrate.
  if (storedCollection[1] === null && storedWatchlist[1] === null && storedTimestamp[1] === null) {
    return null;
  }

  let collectionPrices: PriceMap = {};
  try {
    if (storedCollection[1] !== null) {
      collectionPrices = JSON.parse(storedCollection[1]) as PriceMap;
    }
  } catch {
    // Corrupted — use empty map; the rest of the data is still worth migrating
  }

  let watchlistPrices: PriceMap = {};
  try {
    if (storedWatchlist[1] !== null) {
      watchlistPrices = JSON.parse(storedWatchlist[1]) as PriceMap;
    }
  } catch {
    // Corrupted — use empty map
  }

  // Timestamp is required for the payload to be meaningful; if it is absent or
  // corrupt, use the epoch so the caller can still restore prices while making
  // it obvious that the timestamp is unreliable (null is returned for epoch).
  let lastUpdated = new Date(0).toISOString();
  try {
    if (storedTimestamp[1] !== null) {
      const ts = new Date(storedTimestamp[1]);
      if (!isNaN(ts.getTime())) {
        lastUpdated = ts.toISOString();
      }
    }
  } catch {
    // Leave as epoch
  }

  return {
    version: PRICE_PERSISTENCE_VERSION,
    collectionPrices,
    watchlistPrices,
    lastUpdated,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads all persisted price data from AsyncStorage.
 *
 * Load order:
 *   1. Versioned envelope (current format) — used directly if version matches,
 *      migrated if version is older, discarded if migration fails.
 *   2. Legacy three-key format — migrated forward and saved to the new key so
 *      subsequent loads are fast.
 *
 * Returns `null` for any entry that is missing, corrupt, or written by an
 * incompatible version of the app.
 */
export async function loadPersistedPrices(): Promise<PersistedPrices> {
  const empty: PersistedPrices = {
    collectionPrices: null,
    watchlistPrices: null,
    lastUpdated: null,
  };

  let payload: PricesPayload | null = null;

  // ── 1. Try current versioned-envelope key ─────────────────────────────────
  try {
    const raw = await AsyncStorage.getItem(PRICES_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as PricesPayload;

      if (parsed.version === PRICE_PERSISTENCE_VERSION) {
        payload = parsed;
      } else if (parsed.version < PRICE_PERSISTENCE_VERSION) {
        // Attempt forward migration
        const migrated = migratePricesPayload(parsed);
        if (migrated !== null) {
          payload = migrated;
          // Write back under the current version so future loads are trivial
          AsyncStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(migrated)).catch(() => {});
        } else {
          // Cannot migrate — discard stale envelope
          AsyncStorage.removeItem(PRICES_STORAGE_KEY).catch(() => {});
        }
      } else {
        // Payload was written by a newer app version — discard to avoid
        // misinterpreting fields the current code doesn't understand.
        // (Do not delete: a downgraded app shouldn't erase future data.)
        payload = null;
      }
    }
  } catch {
    // Corrupted JSON — fall through to legacy migration
  }

  // ── 2. Legacy three-key migration (runs only when envelope was absent) ────
  if (payload === null) {
    try {
      const legacyPayload = await migrateFromLegacyKeys();
      if (legacyPayload !== null) {
        payload = legacyPayload;
        // Write the migrated data to the versioned key …
        await AsyncStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(legacyPayload));
        // … and clean up the now-redundant legacy keys.
        await AsyncStorage.multiRemove([
          COLLECTION_PRICES_KEY,
          WATCHLIST_PRICES_KEY,
          PRICES_LAST_UPDATED_KEY,
        ]);
      }
    } catch {
      // Migration failed — proceed with empty prices
    }
  }

  if (payload === null) return empty;

  const lastUpdatedDate = new Date(payload.lastUpdated);
  // Treat the epoch sentinel (used when the legacy timestamp was missing) as null
  const lastUpdated =
    isNaN(lastUpdatedDate.getTime()) || lastUpdatedDate.getTime() === 0
      ? null
      : lastUpdatedDate;

  return {
    collectionPrices: payload.collectionPrices ?? null,
    watchlistPrices: payload.watchlistPrices ?? null,
    lastUpdated,
  };
}

/**
 * Persists refreshed prices and the refresh timestamp to AsyncStorage as a
 * versioned envelope.  Awaited before the caller resolves so an immediate
 * restart cannot lose the data.
 */
export async function saveRefreshedPrices(
  collection: CollectionItem[],
  watchlist: WatchlistItem[],
  timestamp: Date,
): Promise<void> {
  const collectionPrices: PriceMap = {};
  collection.forEach(item => { collectionPrices[item.id] = item.card.price; });

  const watchlistPrices: PriceMap = {};
  watchlist.forEach(item => { watchlistPrices[item.id] = item.card.price; });

  const payload: PricesPayload = {
    version: PRICE_PERSISTENCE_VERSION,
    collectionPrices,
    watchlistPrices,
    lastUpdated: timestamp.toISOString(),
  };

  await AsyncStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(payload));
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
