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

// ── Recent Scans ──────────────────────────────────────────────────────────────

export const RECENT_SCANS_STORAGE_KEY = '@verified_tcg/recent_scans';

/** Maximum number of recent scans to retain. */
const RECENT_SCANS_LIMIT = 10;

/**
 * Module-level generation counter.  Incremented by `clearRecentScans`.
 *
 * Callers should capture this via `getScanGeneration()` *before* any async
 * work (e.g. before firing the network recognition request) and pass the
 * captured value to `appendRecentScan`.  This means the comparison is always
 * "generation at scan-start vs. generation now" — if `clearRecentScans` ran
 * at any point between those two moments the check fails and no write occurs,
 * regardless of when `appendRecentScan` is eventually called.
 */
let _scanGeneration = 0;

/** Return the current generation token for capture before async operations. */
export function getScanGeneration(): number {
  return _scanGeneration;
}

export interface RecentScan {
  /** Card catalogue ID */
  cardId: string;
  name: string;
  setName: string;
  number: string;
  imageUrl?: string;
  /** ISO-8601 timestamp of when the scan occurred */
  scannedAt: string;
}

/**
 * Load the list of recent scans from AsyncStorage.
 * Returns an empty array when nothing is stored or the value is corrupted.
 */
export async function loadRecentScans(): Promise<RecentScan[]> {
  const raw = await AsyncStorage.getItem(RECENT_SCANS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentScan[];
  } catch {
    return [];
  }
}

/**
 * Prepend a new scan to the stored recent-scans list, keeping at most
 * `RECENT_SCANS_LIMIT` entries.  The most-recent scan is always at index 0.
 *
 * `callerGen` MUST be the value returned by `getScanGeneration()` captured
 * *before* the caller's recognition network request.  This makes the guard
 * "has-it-changed-since-the-scan-started" rather than
 * "has-it-changed-during-my-read-write", closing the race where sign-out
 * increments the counter and then the caller still captures the new value
 * and passes it in at call-time.
 *
 * Returns an empty array and writes nothing when sign-out (or account
 * deletion) ran at any point since `callerGen` was captured.
 */
export async function appendRecentScan(
  scan: RecentScan,
  callerGen: number,
): Promise<RecentScan[]> {
  // Immediate check — if sign-out already ran, skip the read entirely.
  if (_scanGeneration !== callerGen) return [];

  const current = await loadRecentScans();

  // Post-read check — sign-out may have run while we were awaiting the read.
  if (_scanGeneration !== callerGen) return [];

  // Deduplicate by cardId — if the same card was scanned before, remove the
  // older entry so it bubbles to the top instead of duplicating.
  const deduplicated = current.filter(s => s.cardId !== scan.cardId);
  const next = [scan, ...deduplicated].slice(0, RECENT_SCANS_LIMIT);
  await AsyncStorage.setItem(RECENT_SCANS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/**
 * Wipe the recent-scans list and invalidate any in-flight appends.
 * Call this on sign-out and account deletion so the next user starts with
 * a clean slate and no concurrent write can recreate the cleared key.
 */
export async function clearRecentScans(): Promise<void> {
  // Invalidate FIRST so any concurrent appendRecentScan that reads after
  // this point will see the incremented generation and abort before writing.
  _scanGeneration++;
  await AsyncStorage.removeItem(RECENT_SCANS_STORAGE_KEY);
}
