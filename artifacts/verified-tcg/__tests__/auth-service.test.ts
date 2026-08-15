/**
 * Auth service unit tests
 *
 * Verifies that signOut removes every expected AsyncStorage key.
 * Uses the AsyncStorage mock from setup.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut, ALL_STORAGE_KEYS } from '../services/auth';

// Mock fetch so signOut's server call doesn't fail
global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response));

beforeEach(async () => {
  await AsyncStorage.clear();
  (fetch as jest.Mock).mockClear();
  // Seed every key so we can verify they are removed
  for (const key of ALL_STORAGE_KEYS) {
    await AsyncStorage.setItem(key, 'some-value');
  }
});

describe('signOut', () => {
  it('clears all expected AsyncStorage keys', async () => {
    await signOut();

    for (const key of ALL_STORAGE_KEYS) {
      const value = await AsyncStorage.getItem(key);
      expect(value).toBeNull();
    }
  });

  it('succeeds even when AsyncStorage is already empty', async () => {
    await AsyncStorage.clear();
    await expect(signOut()).resolves.not.toThrow();
  });

  it('clears the auth session key in particular', async () => {
    await signOut();
    const session = await AsyncStorage.getItem('@verified_tcg/auth_session');
    expect(session).toBeNull();
  });

  it('clears the watchlist key', async () => {
    await signOut();
    const watchlist = await AsyncStorage.getItem('@verified_tcg/watchlist');
    expect(watchlist).toBeNull();
  });

  it('clears the scan state key', async () => {
    await signOut();
    const scanState = await AsyncStorage.getItem('@verified_tcg/scan_state');
    expect(scanState).toBeNull();
  });
});
