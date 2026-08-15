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
  signOut: jest.fn(() => Promise.resolve()),
  signInWithPassword: jest.fn(),
  signInWithOAuth: jest.fn(() => Promise.resolve(null)),
  deleteAccount: jest.fn(),
  updateUserMetadata: jest.fn(),
}));

jest.mock('../services/collection', () => ({
  fetchCollection: jest.fn(() => Promise.resolve([])),
  addCollectionItem: jest.fn(),
  removeCollectionItem: jest.fn(),
  getItemCurrentValue: jest.fn(() => 0),
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

jest.mock('../services/market', () => ({
  simulateRefreshedPrice: jest.fn((item: unknown) => item),
  fetchRefreshedPrices: jest.fn(() => Promise.resolve([])),
  PORTFOLIO_CHART_DATA: [],
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

jest.mock('../services/profile', () => ({
  MOCK_WATCHLIST: [],
  MOCK_USER: {
    id: 'mock-user',
    email: 'mock@example.com',
    displayName: 'Mock',
    username: 'mock',
    tcgPreferences: [],
    stats: { cardsInCollection: 0, totalTrades: 0, memberSince: '2025' },
  },
}));

// ── Import under test (after mocks) ──────────────────────────────────────────
import { AppProvider, useApp } from '../context/AppContext';
import type { AppContextType } from '../context/AppContext';

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
