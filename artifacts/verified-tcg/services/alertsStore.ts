/**
 * Dedicated persistence layer for Smart Alerts.
 *
 * Stores alert configuration (item ID + alert type) for every watchlist item
 * that has `priceAlertEnabled === true`, under the dedicated key
 * `@verified_tcg/alerts`.  This gives alerts their own resilient store that
 * survives app restarts independently of the watchlist payload.
 *
 * Design decisions:
 * - **Atomic writes**: `saveAlertState` always writes the complete derived
 *   state from the current watchlist — no read-modify-write, no races.
 * - **Union merge on load**: `mergeAlertSources` unions the watchlist's own
 *   priceAlertEnabled flags with the dedicated store's entries so that neither
 *   source can cause a valid alert to disappear.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PriceAlertType } from '@/types';

export const ALERTS_STORAGE_KEY = '@verified_tcg/alerts';

export interface PersistedAlert {
  /** Watchlist item ID this alert is attached to. */
  itemId: string;
  alertType: PriceAlertType;
}

/**
 * Load all persisted alerts from AsyncStorage.
 * Returns an empty array when nothing is stored or JSON is corrupt.
 */
export async function loadPersistedAlerts(): Promise<PersistedAlert[]> {
  try {
    const raw = await AsyncStorage.getItem(ALERTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PersistedAlert[];
  } catch {
    return [];
  }
}

/**
 * Atomically overwrite the alerts store with the complete alert state derived
 * from the current watchlist.  Calling this on every watchlist change
 * eliminates read-modify-write races — the in-memory watchlist is the single
 * source of truth, and this just mirrors it to AsyncStorage.
 *
 * Only items with `priceAlertEnabled === true` AND a `targetPrice` are stored.
 * Errors are silently swallowed; the watchlist payload acts as the fallback.
 */
export async function saveAlertState(
  watchlistItems: Array<{ id: string; priceAlertEnabled?: boolean; targetPrice?: number; alertType?: PriceAlertType }>,
): Promise<void> {
  try {
    const alerts: PersistedAlert[] = watchlistItems
      .filter(item => item.priceAlertEnabled && !!item.targetPrice)
      .map(item => ({
        itemId: item.id,
        alertType: item.alertType ?? 'price-drop',
      }));
    await AsyncStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // Storage write failed; watchlist payload retains the alert state
  }
}

/**
 * Reconcile the alerts store entries with the watchlist items already loaded
 * into memory.  Returns a new watchlist array with `priceAlertEnabled` and
 * `alertType` set correctly, taking the UNION of both sources so that no
 * valid alert is silently lost.
 *
 * Rules:
 *   - If the watchlist item already has priceAlertEnabled === true, keep it.
 *   - If the alerts store has an entry for this item, enable it (and apply the
 *     stored alertType).
 *   - Otherwise leave the item unchanged.
 *
 * After reconciliation the caller should call `saveAlertState` to flush the
 * union back to the dedicated store so both sources stay in sync.
 */
export function mergeAlertSources<T extends {
  id: string;
  priceAlertEnabled?: boolean;
  alertType?: PriceAlertType;
  targetPrice?: number;
}>(
  watchlistItems: T[],
  storeAlerts: PersistedAlert[],
): T[] {
  if (storeAlerts.length === 0) return watchlistItems; // nothing to merge

  const alertMap = new Map(storeAlerts.map(a => [a.itemId, a.alertType]));

  return watchlistItems.map(item => {
    const storedAlertType = alertMap.get(item.id);
    if (storedAlertType !== undefined && !item.priceAlertEnabled) {
      // Alerts store has it enabled but watchlist doesn't — restore it
      return { ...item, priceAlertEnabled: true, alertType: storedAlertType };
    }
    // Item already enabled in watchlist, or not in either store — leave as-is
    return item;
  });
}
