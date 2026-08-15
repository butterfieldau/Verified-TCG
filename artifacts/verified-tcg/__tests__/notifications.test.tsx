/**
 * Notification unread-count tests via AppContext
 *
 * Tests the real AppContext markNotificationRead and markAllNotificationsRead
 * actions by mounting the full AppProvider and calling the context methods.
 * This ensures that regressions in the actual context code are caught.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

const mockFetchNotifications = jest.fn(() =>
  Promise.resolve({ notifications: [], page: 1, totalPages: 1, totalCount: 0, hasMore: false }),
);
const mockFetchUnreadCount = jest.fn(() => Promise.resolve(0));
const mockMarkNotificationReadOnServer = jest.fn(() => Promise.resolve());
const mockMarkAllNotificationsReadOnServer = jest.fn(() => Promise.resolve());

jest.mock('../services/notifications', () => ({
  fetchNotifications: (...args: unknown[]) => mockFetchNotifications(...args),
  fetchUnreadCount: () => mockFetchUnreadCount(),
  markNotificationReadOnServer: (id: string) => mockMarkNotificationReadOnServer(id),
  markAllNotificationsReadOnServer: () => mockMarkAllNotificationsReadOnServer(),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

import { AppProvider, useApp } from '../context/AppContext';
import type { AppContextType } from '../context/AppContext';

function mountProvider(): { getValue: () => AppContextType; unmount: () => void } {
  const ctxRef = { current: null as AppContextType | null };
  function Spy() {
    ctxRef.current = useApp();
    return null;
  }
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <AppProvider><Spy /></AppProvider>,
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
  mockFetchNotifications.mockResolvedValue({
    notifications: [], page: 1, totalPages: 1, totalCount: 0, hasMore: false,
  });
  mockFetchUnreadCount.mockResolvedValue(0);
  mockMarkNotificationReadOnServer.mockClear();
  mockMarkAllNotificationsReadOnServer.mockClear();
});

describe('unreadNotificationCount — initial state', () => {
  it('starts at 0 before any data is loaded', () => {
    const { getValue, unmount } = mountProvider();
    expect(getValue().unreadNotificationCount).toBe(0);
    unmount();
  });

  it('reflects the server unread count after refreshNotifications', async () => {
    mockFetchUnreadCount.mockResolvedValueOnce(5);
    const { getValue, unmount } = mountProvider();

    await act(async () => {
      await getValue().refreshNotifications();
    });

    expect(getValue().unreadNotificationCount).toBe(5);
    unmount();
  });
});

describe('markNotificationRead — decrements unread count', () => {
  it('decrements the count when a server notification is marked read', async () => {
    mockFetchUnreadCount.mockResolvedValueOnce(3);
    const { getValue, unmount } = mountProvider();

    await act(async () => {
      await getValue().refreshNotifications();
    });
    expect(getValue().unreadNotificationCount).toBe(3);

    // Mark a notification read — the notification doesn't need to be in the
    // notifications array (markNotificationRead handles page-2+ notifs via
    // the currentlyRead parameter defaulting to false).
    act(() => { getValue().markNotificationRead('server-notif-1'); });
    expect(getValue().unreadNotificationCount).toBe(2);

    unmount();
  });

  it('does not go below 0', async () => {
    mockFetchUnreadCount.mockResolvedValueOnce(0);
    const { getValue, unmount } = mountProvider();

    await act(async () => {
      await getValue().refreshNotifications();
    });

    act(() => { getValue().markNotificationRead('server-notif-x'); });
    expect(getValue().unreadNotificationCount).toBe(0);
    unmount();
  });

  it('does not decrement when currentlyRead=true is passed', async () => {
    mockFetchUnreadCount.mockResolvedValueOnce(2);
    const { getValue, unmount } = mountProvider();

    await act(async () => {
      await getValue().refreshNotifications();
    });

    // Passing currentlyRead=true means the notif was already read — no decrement
    act(() => { getValue().markNotificationRead('already-read-notif', true); });
    expect(getValue().unreadNotificationCount).toBe(2);
    unmount();
  });

  it('does not decrement for local price-alert notifications (price-alert-wl- prefix)', async () => {
    mockFetchUnreadCount.mockResolvedValueOnce(2);
    const { getValue, unmount } = mountProvider();

    await act(async () => {
      await getValue().refreshNotifications();
    });

    act(() => { getValue().markNotificationRead('price-alert-wl-card-001'); });
    // serverUnreadCount should NOT change for local price alerts
    expect(getValue().unreadNotificationCount).toBe(2);
    unmount();
  });
});

describe('markAllNotificationsRead', () => {
  it('sets the unread count to 0', async () => {
    mockFetchUnreadCount.mockResolvedValueOnce(7);
    const { getValue, unmount } = mountProvider();

    await act(async () => {
      await getValue().refreshNotifications();
    });
    expect(getValue().unreadNotificationCount).toBe(7);

    act(() => { getValue().markAllNotificationsRead(); });
    expect(getValue().unreadNotificationCount).toBe(0);
    unmount();
  });

  it('calls markAllNotificationsReadOnServer', async () => {
    const { getValue, unmount } = mountProvider();
    act(() => { getValue().markAllNotificationsRead(); });
    expect(mockMarkAllNotificationsReadOnServer).toHaveBeenCalled();
    unmount();
  });
});
