/**
 * Scan-state persistence helpers
 *
 * Extracted from AppContext so the monthly-rollover logic and the
 * AsyncStorage round-trip can be tested in isolation, without mounting
 * the full React component tree.
 *
 * Layout of the stored value (SCAN_STATE_STORAGE_KEY):
 *   { scansUsed: number; scanResetDate: string }  // scanResetDate is ISO-8601
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SCAN_STATE_STORAGE_KEY = '@verified_tcg/scan_state';

/**
 * Return the first calendar day of the month that follows `from`.
 * Used to compute the initial reset date and to advance past dates.
 */
export function nextMonthFirstDay(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth() + 1, 1);
}

/**
 * Apply the quota-period guard to a stored reset date.
 *
 * If `resetDate` is already in the future relative to `now`, nothing changes.
 * Otherwise the date is advanced (one month at a time) until it is in the
 * future, and `didReset` is set to true so the caller can zero scansUsed.
 *
 * This is a pure function — no side-effects — so it is trivially testable.
 */
export function advancePastResetDate(
  resetDate: Date,
  now: Date,
): { newResetDate: Date; didReset: boolean } {
  if (resetDate > now) {
    return { newResetDate: resetDate, didReset: false };
  }

  let next = resetDate;
  while (next <= now) {
    next = nextMonthFirstDay(next);
  }
  return { newResetDate: next, didReset: true };
}

interface ScanStatePayload {
  scansUsed: number;
  scanResetDate: string; // ISO-8601
}

/**
 * Persist the current scan state to AsyncStorage.
 * Both values are always written together so the loader can cross-check them.
 */
export async function saveScanState(
  scansUsed: number,
  scanResetDate: Date,
): Promise<void> {
  const payload: ScanStatePayload = {
    scansUsed,
    scanResetDate: scanResetDate.toISOString(),
  };
  await AsyncStorage.setItem(SCAN_STATE_STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Load and parse the persisted scan state from AsyncStorage.
 *
 * Returns null when:
 *   - Nothing is stored yet (first launch)
 *   - The stored JSON is corrupted
 *   - The stored date string is not a valid ISO date
 *
 * The caller is responsible for applying `advancePastResetDate` to detect
 * whether the loaded reset date has already passed.
 */
export async function loadScanState(): Promise<{
  scansUsed: number;
  scanResetDate: Date;
} | null> {
  const raw = await AsyncStorage.getItem(SCAN_STATE_STORAGE_KEY);
  if (raw === null) return null;

  try {
    const { scansUsed, scanResetDate: isoStr } = JSON.parse(raw) as ScanStatePayload;
    const scanResetDate = new Date(isoStr);
    if (isNaN(scanResetDate.getTime())) return null;
    return { scansUsed, scanResetDate };
  } catch {
    return null;
  }
}
