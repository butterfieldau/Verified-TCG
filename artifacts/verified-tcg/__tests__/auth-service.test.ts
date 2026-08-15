/**
 * Auth service unit tests
 *
 * Verifies that signOut removes every expected AsyncStorage key, and that
 * restorePurchases() correctly syncs the server-authoritative subscription_tier
 * into the cached AsyncStorage session (covering the reinstall / device-switch
 * scenario where local storage is cleared but the server still knows the tier).
 *
 * Uses the AsyncStorage mock from setup.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut, ALL_STORAGE_KEYS, type AuthSession } from '../services/auth';

import { restorePurchases } from '../services/auth';

// Mock fetch so network calls are controlled per-test
global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response));

const SESSION_KEY = '@verified_tcg/auth_session';

/** Build a minimal AuthSession stored in AsyncStorage. */
function makeSession(overrides: Partial<AuthSession['user']['user_metadata']> = {}): AuthSession {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    user: {
      id: 'user-123',
      email: 'test@example.com',
      user_metadata: {
        subscription_tier: 'free',
        is_founding_member: false,
        ...overrides,
      },
    },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (fetch as jest.Mock).mockClear();
  // Seed every key so we can verify they are removed
  for (const key of ALL_STORAGE_KEYS) {
    await AsyncStorage.setItem(key, 'some-value');
  }
});

// ── restorePurchases ──────────────────────────────────────────────────────────

describe('restorePurchases', () => {
  it('returns the server tier and restored flag when server confirms Pro', async () => {
    // Seed a cached session (subscription_tier reflects stale local state)
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(makeSession({ subscription_tier: 'free' })));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: 'pro',
        is_founding_member: false,
        restored: true,
        message: 'Your Pro subscription has been restored.',
      }),
    } as Response);

    const result = await restorePurchases();
    expect(result.subscription_tier).toBe('pro');
    expect(result.restored).toBe(true);
    expect(result.is_founding_member).toBe(false);
  });

  it('updates the cached AsyncStorage session with the server-returned Pro tier', async () => {
    // Start with a free-tier session (simulates cleared-then-re-signed-in state)
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(makeSession({ subscription_tier: 'free' })));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: 'pro',
        is_founding_member: true,
        restored: true,
        message: 'Your Pro subscription has been restored.',
      }),
    } as Response);

    await restorePurchases();

    const raw = await AsyncStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as AuthSession;
    expect(stored.user.user_metadata?.subscription_tier).toBe('pro');
    expect(stored.user.user_metadata?.is_founding_member).toBe(true);
  });

  it('updates the cached AsyncStorage session when the server returns free (e.g. chargeback)', async () => {
    // Start with a stale pro-tier session (server has since downgraded it)
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(makeSession({ subscription_tier: 'pro' })));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: 'free',
        is_founding_member: false,
        restored: false,
        message: 'No active Pro subscription found on this account.',
      }),
    } as Response);

    const result = await restorePurchases();
    expect(result.subscription_tier).toBe('free');
    expect(result.restored).toBe(false);

    const raw = await AsyncStorage.getItem(SESSION_KEY);
    const stored = JSON.parse(raw!) as AuthSession;
    expect(stored.user.user_metadata?.subscription_tier).toBe('free');
  });

  it('preserves the access and refresh tokens when updating the session', async () => {
    const original = makeSession({ subscription_tier: 'free' });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(original));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: 'pro',
        is_founding_member: false,
        restored: true,
        message: 'Your Pro subscription has been restored.',
      }),
    } as Response);

    await restorePurchases();

    const raw = await AsyncStorage.getItem(SESSION_KEY);
    const stored = JSON.parse(raw!) as AuthSession;
    expect(stored.access_token).toBe(original.access_token);
    expect(stored.refresh_token).toBe(original.refresh_token);
    expect(stored.user.id).toBe(original.user.id);
  });

  it('throws when there is no session in AsyncStorage (simulates fresh reinstall before sign-in)', async () => {
    await AsyncStorage.clear();
    await expect(restorePurchases()).rejects.toThrow();
  });

  it('throws when the server returns a non-OK response', async () => {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(makeSession()));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid or expired token' }),
    } as Response);

    await expect(restorePurchases()).rejects.toThrow();
  });
});

// ── signOut ───────────────────────────────────────────────────────────────────

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
