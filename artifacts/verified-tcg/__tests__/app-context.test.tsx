/**
 * AppContext unit tests
 *
 * Tests subscription tier defaults, setSubscriptionTier, scan-count helpers,
 * and logout state reset.  Uses react-test-renderer with a Context.Consumer
 * component rather than @testing-library/react-native so we don't pull in
 * the full RNTL setup (which triggers native-module loading in jest-expo).
 */
import React, { useRef } from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Service mocks — must come before any import that touches these modules ───

jest.mock('../services/auth', () => ({
  restoreSession: jest.fn(() => Promise.resolve(null)),
  fetchCurrentUser: jest.fn(() => Promise.resolve(null)),
  signOut: jest.fn(() => Promise.resolve()),
  signInWithPassword: jest.fn(),
  signInWithOAuth: jest.fn(() => Promise.resolve(null)),
  deleteAccount: jest.fn(),
  updateUserMetadata: jest.fn(),
}));

jest.mock('../services/collection', () => ({
  fetchCollection: jest.fn(() => Promise.resolve([])),
  addCollectionItem: jest.fn(),
  updateCollectionItem: jest.fn(),
  removeCollectionItem: jest.fn(),
  getItemCurrentValue: jest.fn(() => 0),
}));

jest.mock('../services/verifiedPricing', () => ({
  refreshVerifiedPricing: jest.fn(() => Promise.resolve({ status: 'available' })),
}));

jest.mock('../services/wishlistApi', () => ({
  syncWishlistToServer: jest.fn(() => Promise.resolve([])),
  addWishlistItemToServer: jest.fn(),
  removeWishlistItemFromServer: jest.fn(),
  updateWishlistItemOnServer: jest.fn(),
}));

jest.mock('../services/notifications', () => ({
  fetchNotifications: jest.fn(() =>
    Promise.resolve({ notifications: [], page: 1, totalPages: 1, totalCount: 0 }),
  ),
  fetchUnreadCount: jest.fn(() => Promise.resolve(0)),
  markNotificationReadOnServer: jest.fn(),
  markAllNotificationsReadOnServer: jest.fn(),
}));

jest.mock('../services/pushRegistration', () => ({
  configureForegroundNotifications: jest.fn(),
  registerPushTokenIfPermitted: jest.fn(),
}));

jest.mock('../services/eventsApi', () => ({
  fetchMyActiveParticipation: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../services/pricePersistence', () => ({
  loadPersistedPrices: jest.fn(() =>
    Promise.resolve({ collectionPrices: null, watchlistPrices: null, lastUpdated: null }),
  ),
  saveRefreshedPrices: jest.fn(),
  applyPersistedCollectionPrices: jest.fn((items: unknown) => items),
}));

jest.mock('../services/alertsStore', () => ({
  loadPersistedAlerts: jest.fn(() => Promise.resolve([])),
  saveAlertState: jest.fn(() => Promise.resolve()),
  mergeAlertSources: jest.fn((watchlist: unknown) => watchlist),
}));

jest.mock('../services/tcgPreferences', () => ({
  syncPreferredTcgsAfterSignIn: jest.fn(),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────
import { AppProvider, useApp } from '../context/AppContext';
import type { AppContextType } from '../context/AppContext';
import { restoreSession, fetchCurrentUser } from '../services/auth';
import { addCollectionItem } from '../services/collection';
import { refreshVerifiedPricing } from '../services/verifiedPricing';
import type { CollectionItem } from '../types';

// ── Test helper: mount the provider and capture context values ────────────────

/**
 * Renders the AppProvider tree and returns a ref that always holds the latest
 * context value.  Call `getValue()` after any `act()` block to read current state.
 */
function mountProvider(): { getValue: () => AppContextType; unmount: () => void } {
  // We use a ref-based approach: the Consumer stores the context value into a ref.
  const ctxRef = { current: null as AppContextType | null };

  function Spy() {
    const ctx = useApp();
    ctxRef.current = ctx;
    return null;
  }

  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <AppProvider>
        <Spy />
      </AppProvider>,
    );
  });

  return {
    getValue: () => ctxRef.current!,
    unmount: () => act(() => { tree.unmount(); }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('AppContext — subscription tier defaults', () => {
  it('starts with subscriptionTier = "free"', () => {
    const { getValue, unmount } = mountProvider();
    expect(getValue().subscriptionTier).toBe('free');
    unmount();
  });

  it('starts with scansUsed = 0', () => {
    const { getValue, unmount } = mountProvider();
    expect(getValue().scansUsed).toBe(0);
  });

  it('starts with isAuthenticated = false', () => {
    const { getValue, unmount } = mountProvider();
    expect(getValue().isAuthenticated).toBe(false);
    unmount();
  });
});

describe('AppContext — setSubscriptionTier', () => {
  it('updates tier to "pro"', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().setSubscriptionTier('pro'); });
    expect(getValue().subscriptionTier).toBe('pro');
    unmount();
  });

  it('reverts from "pro" to "free"', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().setSubscriptionTier('pro'); });
    act(() => { getValue().setSubscriptionTier('free'); });
    expect(getValue().subscriptionTier).toBe('free');
    unmount();
  });
});

describe('AppContext — scan count helpers', () => {
  it('incrementScanCount adds 1', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().incrementScanCount(); });
    expect(getValue().scansUsed).toBe(1);
    unmount();
  });

  it('incrementScanCount increments correctly multiple times', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().incrementScanCount(); });
    act(() => { getValue().incrementScanCount(); });
    act(() => { getValue().incrementScanCount(); });
    expect(getValue().scansUsed).toBe(3);
    unmount();
  });

  it('resetScanCount resets to 0', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().incrementScanCount(); });
    act(() => { getValue().resetScanCount(); });
    expect(getValue().scansUsed).toBe(0);
    unmount();
  });

  it('syncScanCount replaces the local count with the server value', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().incrementScanCount(); });
    act(() => { getValue().syncScanCount(25); });
    expect(getValue().scansUsed).toBe(25);
    unmount();
  });
});

describe('AppContext — signOut resets state', () => {
  it('resets subscriptionTier to "free" after signOut', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().setSubscriptionTier('pro'); });
    act(() => { getValue().signOut(); });
    expect(getValue().subscriptionTier).toBe('free');
    unmount();
  });

  it('resets scansUsed to 0 after signOut', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().incrementScanCount(); });
    act(() => { getValue().signOut(); });
    expect(getValue().scansUsed).toBe(0);
    unmount();
  });

  it('sets isAuthenticated to false after signOut', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().signOut(); });
    expect(getValue().isAuthenticated).toBe(false);
    unmount();
  });

  it('clears the user to null after signOut', () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().signOut(); });
    expect(getValue().user).toBeNull();
    unmount();
  });
});

// ── Session restore on mount (reinstall / device-switch scenario) ─────────────
//
// After a reinstall AsyncStorage is cleared, but the user can sign back in with
// their credentials.  Once a session exists in storage, AppContext must read the
// subscription_tier from session.user.user_metadata and set subscriptionTier
// accordingly — without the user needing to re-purchase.

/** Build a minimal AuthSession that restoreSession() can return. */
function makeProSession(subscriptionTier: 'pro' | 'free' = 'pro', isFoundingMember = false) {
  return {
    access_token: 'tok-access',
    refresh_token: 'tok-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-abc',
      email: 'pro@example.com',
      user_metadata: {
        display_name: 'Pro Collector',
        username: 'procollector',
        subscription_tier: subscriptionTier,
        is_founding_member: isFoundingMember,
      },
    },
  };
}

/**
 * Flush all pending microtasks and macrotasks so that nested fire-and-forget
 * promise chains (e.g. fetchCurrentUser inside the session-restore effect)
 * are guaranteed to have resolved before the assertion runs.
 *
 * Multiple rounds are needed because React's useEffect for ref updates commits
 * after the render caused by the first state change, and that commit must happen
 * before the inner fetchCurrentUser().then() guard can pass.
 */
async function flushPromises(rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 0));
    });
  }
}

/**
 * Mount the AppProvider, wait for all pending async effects (including the
 * session-restore useEffect) to settle, then return the context accessor.
 *
 * Pass `extraFlush: true` when the test depends on a nested promise chain
 * inside the session-restore effect (e.g. fetchCurrentUser).
 */
async function mountProviderAsync({ extraFlush = false } = {}) {
  const ctxRef = { current: null as AppContextType | null };

  function Spy() {
    const ctx = useApp();
    ctxRef.current = ctx;
    return null;
  }

  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <AppProvider>
        <Spy />
      </AppProvider>,
    );
  });

  // Second flush resolves nested fire-and-forget chains (fetchCurrentUser etc.)
  if (extraFlush) await flushPromises();

  return {
    getValue: () => ctxRef.current!,
    unmount: () => act(() => { tree.unmount(); }),
  };
}

describe('AppContext — Pro tier restored from session on mount', () => {
  beforeEach(() => {
    // Reset mocks before each test so restoreSession can be re-configured
    (restoreSession as jest.Mock).mockReset().mockResolvedValue(null);
    (fetchCurrentUser as jest.Mock).mockReset().mockResolvedValue(null);
  });

  it('sets subscriptionTier to "pro" when the cached session carries subscription_tier = "pro"', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(makeProSession('pro'));

    const { getValue, unmount } = await mountProviderAsync();

    expect(getValue().subscriptionTier).toBe('pro');
    unmount();
  });

  it('keeps subscriptionTier as "free" when the cached session carries subscription_tier = "free"', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(makeProSession('free'));

    const { getValue, unmount } = await mountProviderAsync();

    expect(getValue().subscriptionTier).toBe('free');
    unmount();
  });

  it('keeps subscriptionTier as "free" when there is no cached session (fresh reinstall)', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(null);

    const { getValue, unmount } = await mountProviderAsync();

    expect(getValue().subscriptionTier).toBe('free');
    unmount();
  });

  it('sets isAuthenticated to true when a valid session is restored', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(makeProSession('pro'));

    const { getValue, unmount } = await mountProviderAsync();

    expect(getValue().isAuthenticated).toBe(true);
    unmount();
  });

  it('populates the user from the restored session', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(makeProSession('pro'));

    const { getValue, unmount } = await mountProviderAsync();

    expect(getValue().user).not.toBeNull();
    expect(getValue().user?.email).toBe('pro@example.com');
    unmount();
  });

  it('calls fetchCurrentUser after restoring a session so the server tier is re-synced', async () => {
    // Any valid session triggers a fetchCurrentUser call for live-sync
    (restoreSession as jest.Mock).mockResolvedValue(makeProSession('pro'));
    (fetchCurrentUser as jest.Mock).mockResolvedValue(null); // network unavailable — falls back

    await mountProviderAsync();

    expect(fetchCurrentUser as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('does not call fetchCurrentUser when there is no session (fresh reinstall)', async () => {
    (restoreSession as jest.Mock).mockResolvedValue(null);

    await mountProviderAsync();

    expect(fetchCurrentUser as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('AppContext — collection pricing refresh', () => {
  it('refreshes server pricing with the persisted card identity after an add', async () => {
    const item = {
      id: 'temporary-pikachu',
      cardId: 'pokemon-sm-promos-pikachu-zekrom-gx-promo',
      card: {
        id: 'pokemon-sm-promos-pikachu-zekrom-gx-promo',
        name: 'Pikachu & Zekrom GX',
        setId: 'sm-promos',
        setName: 'SM Promos',
        tcg: 'pokemon',
        number: 'SM168',
        rarity: 'promo',
        year: 2019,
        gradientStart: '#111111',
        gradientEnd: '#222222',
        price: { raw: 0, currency: 'AUD', updatedAt: null },
      },
      quantity: 1,
      condition: 'near_mint',
      grading: { company: 'PSA', grade: '10', label: 'PSA 10' },
      acquiredAt: '2026-08-30',
      acquiredPrice: 100,
      currency: 'AUD',
    } as CollectionItem;
    const persisted = { ...item, id: 'persisted-pikachu' };
    (addCollectionItem as jest.Mock).mockResolvedValueOnce(persisted);
    (refreshVerifiedPricing as jest.Mock).mockClear().mockResolvedValueOnce({ status: 'available' });

    const { getValue, unmount } = await mountProviderAsync();
    await act(async () => {
      await getValue().addToCollection(item);
      await Promise.resolve();
    });

    expect(refreshVerifiedPricing).toHaveBeenCalledWith(item.cardId, {
      name: 'Pikachu & Zekrom GX',
      set: 'SM Promos',
      number: 'SM168',
      game: 'pokemon',
    });
    unmount();
  });
});
