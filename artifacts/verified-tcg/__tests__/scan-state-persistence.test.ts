/**
 * Scan-state persistence tests
 *
 * Verifies the pure helpers in services/scanStatePersistence.ts that read,
 * write, and advance the monthly scan-quota state in AsyncStorage.
 *
 * Covers:
 *   - nextMonthFirstDay: calendar arithmetic
 *   - advancePastResetDate: quota-period guard (pure, no side-effects)
 *   - saveScanState / loadScanState: AsyncStorage round-trip
 *   - Month-boundary scenario: past reset date is detected, scansUsed zeroed,
 *     persisted file is updated with the advanced date
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SCAN_STATE_STORAGE_KEY,
  nextMonthFirstDay,
  advancePastResetDate,
  saveScanState,
  loadScanState,
} from '../services/scanStatePersistence';

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ── nextMonthFirstDay ─────────────────────────────────────────────────────────

describe('nextMonthFirstDay', () => {
  it('returns the 1st of the following month for a mid-month date', () => {
    const result = nextMonthFirstDay(new Date(2026, 0, 15)); // 15 Jan 2026
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1); // February (0-indexed)
    expect(result.getDate()).toBe(1);
  });

  it('handles December → January year rollover', () => {
    const result = nextMonthFirstDay(new Date(2025, 11, 31)); // 31 Dec 2025
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0); // January
    expect(result.getDate()).toBe(1);
  });

  it('returns the correct next month when called on the 1st', () => {
    const result = nextMonthFirstDay(new Date(2026, 5, 1)); // 1 Jun 2026
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(1);
  });
});

// ── advancePastResetDate ──────────────────────────────────────────────────────

describe('advancePastResetDate', () => {
  it('returns didReset=false when resetDate is strictly in the future', () => {
    const now = new Date(2026, 0, 15); // 15 Jan 2026
    const resetDate = new Date(2026, 1, 1); // 1 Feb 2026 (future)

    const { newResetDate, didReset } = advancePastResetDate(resetDate, now);

    expect(didReset).toBe(false);
    expect(newResetDate).toBe(resetDate); // same object, unchanged
  });

  it('returns didReset=true and advances one month when resetDate equals now', () => {
    const now = new Date(2026, 1, 1, 0, 0, 0); // midnight 1 Feb 2026
    const resetDate = new Date(2026, 1, 1, 0, 0, 0); // same moment

    const { newResetDate, didReset } = advancePastResetDate(resetDate, now);

    expect(didReset).toBe(true);
    expect(newResetDate.getFullYear()).toBe(2026);
    expect(newResetDate.getMonth()).toBe(2); // March
    expect(newResetDate.getDate()).toBe(1);
    expect(newResetDate > now).toBe(true);
  });

  it('returns didReset=true and advances one month when resetDate is one day in the past', () => {
    const now = new Date(2026, 1, 2); // 2 Feb 2026
    const resetDate = new Date(2026, 1, 1); // 1 Feb 2026 (just passed)

    const { newResetDate, didReset } = advancePastResetDate(resetDate, now);

    expect(didReset).toBe(true);
    expect(newResetDate.getMonth()).toBe(2); // March
    expect(newResetDate > now).toBe(true);
  });

  it('advances multiple months when the app was closed for many months', () => {
    const now = new Date(2026, 5, 15); // 15 Jun 2026
    const resetDate = new Date(2026, 1, 1); // 1 Feb 2026 (5 months ago)

    const { newResetDate, didReset } = advancePastResetDate(resetDate, now);

    expect(didReset).toBe(true);
    // The guard must advance until the result is strictly in the future
    expect(newResetDate > now).toBe(true);
    // Exactly one month past "now" in June puts us at 1 Jul 2026
    expect(newResetDate.getMonth()).toBe(6); // July
    expect(newResetDate.getDate()).toBe(1);
  });

  it('does not mutate the original resetDate object', () => {
    const now = new Date(2026, 1, 2);
    const resetDate = new Date(2026, 1, 1);
    const original = resetDate.getTime();

    advancePastResetDate(resetDate, now);

    expect(resetDate.getTime()).toBe(original);
  });
});

// ── saveScanState / loadScanState ─────────────────────────────────────────────

describe('saveScanState', () => {
  it('writes the scan count and reset date to SCAN_STATE_STORAGE_KEY', async () => {
    const scanResetDate = new Date('2026-08-01T00:00:00.000Z');
    await saveScanState(3, scanResetDate);

    const raw = await AsyncStorage.getItem(SCAN_STATE_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!);
    expect(parsed.scansUsed).toBe(3);
    expect(parsed.scanResetDate).toBe(scanResetDate.toISOString());
  });

  it('overwrites a previous save', async () => {
    await saveScanState(2, new Date('2026-07-01T00:00:00.000Z'));
    await saveScanState(5, new Date('2026-08-01T00:00:00.000Z'));

    const raw = await AsyncStorage.getItem(SCAN_STATE_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.scansUsed).toBe(5);
  });
});

describe('loadScanState', () => {
  it('returns null when AsyncStorage is empty', async () => {
    const result = await loadScanState();
    expect(result).toBeNull();
  });

  it('restores scansUsed and scanResetDate after a save', async () => {
    const resetDate = new Date('2026-08-01T00:00:00.000Z');
    await saveScanState(4, resetDate);

    const result = await loadScanState();
    expect(result).not.toBeNull();
    expect(result!.scansUsed).toBe(4);
    expect(result!.scanResetDate.toISOString()).toBe(resetDate.toISOString());
  });

  it('returns null for corrupted JSON without throwing', async () => {
    await AsyncStorage.setItem(SCAN_STATE_STORAGE_KEY, 'not-json');
    const result = await loadScanState();
    expect(result).toBeNull();
  });

  it('returns null when scanResetDate is not a valid date string', async () => {
    await AsyncStorage.setItem(
      SCAN_STATE_STORAGE_KEY,
      JSON.stringify({ scansUsed: 2, scanResetDate: 'not-a-date' }),
    );
    const result = await loadScanState();
    expect(result).toBeNull();
  });
});

// ── month-boundary: end-to-end round-trip ─────────────────────────────────────

describe('month-boundary: past reset date triggers reset and re-persist', () => {
  /**
   * Simulates the sequence that happens when the app is kept open across a
   * month boundary (or when a stale state is loaded from a previous session):
   *
   *   1. A past scanResetDate is written to AsyncStorage (mimicking what would
   *      be stored from the previous month).
   *   2. The app "restarts": loadScanState() reads the stored values.
   *   3. advancePastResetDate() fires (the quota-period guard).
   *   4. The new {scansUsed:0, scanResetDate} pair is persisted via saveScanState().
   *   5. A second loadScanState() confirms the persisted file now contains the
   *      advanced date and a zeroed count.
   */
  it('resets scansUsed to 0 and persists the advanced date after loading a past reset date', async () => {
    const pastResetDate = new Date('2026-01-01T00:00:00.000Z'); // well in the past
    const staleScansUsed = 7;

    // Step 1 — write stale state (as if the previous month's session wrote it)
    await saveScanState(staleScansUsed, pastResetDate);

    // Step 2 — load (simulating app restart)
    const loaded = await loadScanState();
    expect(loaded).not.toBeNull();
    expect(loaded!.scansUsed).toBe(staleScansUsed);
    expect(loaded!.scanResetDate.toISOString()).toBe(pastResetDate.toISOString());

    // Step 3 — apply the quota-period guard
    const now = new Date(); // real "now" — the stored date is far in the past
    const { newResetDate, didReset } = advancePastResetDate(loaded!.scanResetDate, now);

    expect(didReset).toBe(true);
    expect(newResetDate > now).toBe(true);

    // Step 4 — persist the advanced state (scansUsed zeroed because didReset)
    const newScansUsed = didReset ? 0 : loaded!.scansUsed;
    await saveScanState(newScansUsed, newResetDate);

    // Step 5 — reload and confirm the persisted file is correct
    const reloaded = await loadScanState();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.scansUsed).toBe(0);
    expect(reloaded!.scanResetDate.toISOString()).toBe(newResetDate.toISOString());
    expect(reloaded!.scanResetDate > now).toBe(true);
  });

  it('does not reset or re-persist when the stored reset date is still in the future', async () => {
    const futureResetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead
    await saveScanState(3, futureResetDate);

    const loaded = await loadScanState();
    expect(loaded).not.toBeNull();

    const now = new Date();
    const { newResetDate, didReset } = advancePastResetDate(loaded!.scanResetDate, now);

    expect(didReset).toBe(false);
    expect(newResetDate).toBe(loaded!.scanResetDate); // unchanged

    // Simulate what AppContext does: only persist when didReset changes state
    // (it re-persists on any state change, but the values would be the same)
    const newScansUsed = didReset ? 0 : loaded!.scansUsed;
    expect(newScansUsed).toBe(3); // unchanged
  });

  it('advances through multiple months when the app was closed for an extended period', async () => {
    // Store a reset date that is 3 months in the past
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    threeMonthsAgo.setDate(1);

    await saveScanState(10, threeMonthsAgo);

    const loaded = await loadScanState();
    const now = new Date();
    const { newResetDate, didReset } = advancePastResetDate(loaded!.scanResetDate, now);

    expect(didReset).toBe(true);
    expect(newResetDate > now).toBe(true);

    await saveScanState(0, newResetDate);

    const reloaded = await loadScanState();
    expect(reloaded!.scansUsed).toBe(0);
    expect(reloaded!.scanResetDate > now).toBe(true);
  });
});
