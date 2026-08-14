import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { Alert, AppState as RNAppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CollectionItem,
  WatchlistItem,
  PriceAlertType,
  PortfolioRange,
  TCGId,
  CollectionFilters,
  MarketFilters,
  User,
  PortfolioSummary,
} from '@/types';
import { getItemCurrentValue, fetchCollection, addCollectionItem, removeCollectionItem } from '@/services/collection';
import { MOCK_WATCHLIST, MOCK_USER } from '@/services/profile';
import { simulateRefreshedPrice, fetchRefreshedPrices } from '@/services/market';
import {
  syncWishlistToServer,
  addWishlistItemToServer,
  removeWishlistItemFromServer,
  updateWishlistItemOnServer,
} from '@/services/wishlistApi';
import {
  loadPersistedPrices,
  saveRefreshedPrices,
  applyPersistedCollectionPrices,
} from '@/services/pricePersistence';
import {
  loadPersistedAlerts,
  saveAlertState,
  mergeAlertSources,
} from '@/services/alertsStore';
import type { Notification } from '@/services/notifications';
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationReadOnServer,
  markAllNotificationsReadOnServer,
} from '@/services/notifications';
import {
  configureForegroundNotifications,
  requestAndRegisterPushToken,
} from '@/services/pushRegistration';
import { fetchMyActiveParticipation } from '@/services/eventsApi';
import {
  restoreSession,
  signInWithPassword,
  signInWithOAuth,
  signOut as authSignOut,
  deleteAccount as authDeleteAccount,
  updateUserMetadata,
  type OAuthProvider,
} from '@/services/auth';
import { FREE_SCAN_LIMIT, FREE_ALERT_LIMIT } from '@/services/subscription';
import type { SubscriptionTier } from '@/services/subscription';

// API base for server-side quota sync — same pattern as other service files
const _SCAN_API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * Fetch the authoritative scan count for the current period from the server.
 * Fire-and-forget — call it after sign-in / session restore so the local
 * counter cannot drift from the server-side truth.
 */
async function fetchServerScanCount(accessToken: string): Promise<number | null> {
  try {
    const res = await fetch(`${_SCAN_API_BASE}/api/scan/usage`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { scansUsed?: number };
    return typeof body.scansUsed === 'number' ? body.scansUsed : null;
  } catch {
    return null;
  }
}
import {
  SCAN_STATE_STORAGE_KEY,
  nextMonthFirstDay,
  advancePastResetDate,
  saveScanState,
  loadScanState,
} from '@/services/scanStatePersistence';

interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  collection: CollectionItem[];
  collectionLoading: boolean;
  refreshCollection: () => Promise<void>;
  portfolio: PortfolioSummary;
  collectionFilters: CollectionFilters;
  watchlist: WatchlistItem[];
  portfolioRange: PortfolioRange;
  marketFilters: MarketFilters;
  activeTCG: TCGId | null;
  pricesLastUpdated: Date | null;
  isPriceRefreshing: boolean;
  notifications: Notification[];
  /** Server-authoritative unread count — accurate even beyond the first loaded page. */
  unreadNotificationCount: number;
  /** True when more notifications exist on the server beyond the first page. */
  notificationsHasMore: boolean;
  /** Number of watchlist items with priceAlertEnabled === true. */
  activeAlertCount: number;
  // ── Subscription ──────────────────────────────────────────────────────────
  subscriptionTier: SubscriptionTier;
  scansUsed: number;
  scanLimit: number;
  scanResetDate: Date;
  // ── Pro Identity ──────────────────────────────────────────────────────────
  /** ID of the currently selected app icon (see ICON_OPTIONS in pro-identity.tsx). */
  selectedIcon: string;
  /** ID of the currently selected profile theme (see PROFILE_THEMES in pro-identity.tsx). */
  profileTheme: string;
  /**
   * Whether the Pro user has claimed their Founding Member badge this session.
   * Mock state — in production this would be a server-side boolean with a
   * unique member number assigned from a counter capped at FOUNDING_MEMBER_LIMIT.
   */
  foundingMemberClaimed: boolean;
  // ── Event Mode ─────────────────────────────────────────────────────────────
  /** ID of the event the collector is currently participating in, or null. */
  currentEventId: string | null;
}

interface AppActions {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithProvider: (provider: OAuthProvider) => Promise<boolean>;
  signOut: () => void;
  deleteAccount: (password: string) => Promise<void>;
  updateProfile: (patch: Pick<User, 'displayName' | 'username' | 'bio' | 'location'> & {
    favouriteTcg?: string | null;
    collectorSince?: string | null;
    profilePublic?: boolean;
    showCollection?: boolean;
    showWishlist?: boolean;
    showForTrade?: boolean;
    showForSale?: boolean;
  }) => Promise<void>;
  addToCollection: (item: CollectionItem) => void;
  removeFromCollection: (id: string) => void;
  addToWatchlist: (item: WatchlistItem) => void;
  removeFromWatchlist: (id: string) => void;
  updateWatchlistItem: (id: string, patch: Partial<Pick<WatchlistItem, 'desiredGrade' | 'targetPrice' | 'priceAlertEnabled' | 'alertType'>>) => void;
  setPortfolioRange: (range: PortfolioRange) => void;
  setCollectionFilters: (filters: Partial<CollectionFilters>) => void;
  setMarketFilters: (filters: Partial<MarketFilters>) => void;
  setActiveTCG: (tcg: TCGId | null) => void;
  refreshPrices: () => Promise<void>;
  markNotificationRead: (id: string, currentlyRead?: boolean) => void;
  markAllNotificationsRead: () => void;
  /** Pull fresh notifications from the server (call on pull-to-refresh). */
  refreshNotifications: () => Promise<void>;
  // ── Subscription ──────────────────────────────────────────────────────────
  setSubscriptionTier: (tier: SubscriptionTier) => void;
  incrementScanCount: () => void;
  /**
   * Sync the scan count with an authoritative server value.
   * Called after recognition (success or charged failure) to replace the
   * locally-incremented count with the count returned by the server, so
   * device-switch, reinstall, and charged-failure cases stay accurate.
   */
  syncScanCount: (serverCount: number) => void;
  /** Reset scansUsed to 0 (also available to DEV panel for quick testing). */
  resetScanCount: () => void;
  /**
   * DEV-only: set scansUsed to an arbitrary value so the limit flow can be
   * tested without clicking through 29+ scans.  Never call from product code.
   */
  devSetScansUsed: (count: number) => void;
  // ── Pro Identity ──────────────────────────────────────────────────────────
  setSelectedIcon: (icon: string) => void;
  setProfileTheme: (theme: string) => void;
  /** Toggle the mock Founding Member claim. Only callable when tier === 'pro'. */
  claimFoundingMember: () => void;
  // ── Event Mode ─────────────────────────────────────────────────────────────
  /** Set or clear the currently active event ID. */
  setCurrentEventId: (id: string | null) => void;
}

type AppContextType = AppState & AppActions;

const AppContext = createContext<AppContextType | null>(null);

const DEFAULT_COLLECTION_FILTERS: CollectionFilters = {
  sortBy: 'value',
  sortOrder: 'desc',
};

const DEFAULT_MARKET_FILTERS: MarketFilters = {
  sortBy: 'popularity',
  sortOrder: 'desc',
};

const WATCHLIST_STORAGE_KEY = '@verified_tcg/watchlist';

/**
 * Bump this constant whenever WatchlistItem's shape changes (fields added,
 * removed, or renamed). Add a corresponding case to migrateWatchlist() below
 * so existing data is upgraded rather than discarded.
 */
const WATCHLIST_SCHEMA_VERSION = 1;

function userFromSession(session: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } }): User {
  const email = session.user.email ?? '';
  const meta = session.user.user_metadata ?? {};
  const displayName = typeof meta.display_name === 'string' && meta.display_name
    ? meta.display_name
    : (email || 'Collector');
  const username = typeof meta.username === 'string' && meta.username
    ? meta.username
    : (email.split('@')[0] || 'collector');
  const bio = typeof meta.bio === 'string' ? meta.bio : undefined;
  const location = typeof meta.location === 'string' ? meta.location : undefined;
  const avatarUrl = typeof meta.avatar_url === 'string' ? meta.avatar_url : null;
  const favouriteTcg = typeof meta.favourite_tcg === 'string' ? meta.favourite_tcg : null;
  const collectorSince = typeof meta.collector_since === 'string' ? meta.collector_since : null;
  return {
    id: session.user.id,
    email,
    displayName,
    username,
    bio,
    location,
    avatarUrl,
    favouriteTcg,
    collectorSince,
    profilePublic: meta.profile_public !== false,
    showCollection: meta.show_collection !== false,
    showWishlist: meta.show_wishlist !== false,
    showForTrade: meta.show_for_trade !== false,
    showForSale: meta.show_for_sale !== false,
    joinedAt: new Date().toISOString(),
    tcgPreferences: MOCK_USER.tcgPreferences,
    stats: MOCK_USER.stats,
  };
}

interface WatchlistPayload {
  version: number;
  items: WatchlistItem[];
}

/**
 * Migrate a parsed payload from an older schema version to the current one.
 * Returns the migrated items, or null if the version gap is too large to
 * bridge safely (caller will discard and show a user notice).
 *
 * How to add a migration:
 *   1. Bump WATCHLIST_SCHEMA_VERSION.
 *   2. Add a `case <old_version>:` block that transforms `items` from the old
 *      shape to the new shape, then falls through to the next case.
 */
function migrateWatchlist(payload: WatchlistPayload): WatchlistItem[] | null {
  let { version, items } = payload;

  // Walk through each version gap in order.
  while (version < WATCHLIST_SCHEMA_VERSION) {
    switch (version) {
      case 0:
        // v0 → v1: the raw array format gains no new required fields in v1,
        // so items are already structurally compatible — no field transforms needed.
        version = 1;
        break;
      default:
        // Unknown version — cannot migrate safely.
        return null;
    }
  }

  return items;
}


export function AppProvider({ children }: { children: ReactNode }) {
  // Configure how in-app notifications are displayed while the app is open.
  // Called once on mount — safe to call on all platforms.
  useEffect(() => { configureForegroundNotifications(); }, []);

  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(MOCK_WATCHLIST);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [portfolioRange, setPortfolioRange] = useState<PortfolioRange>('7D');
  const [collectionFilters, setCollectionFiltersState] = useState<CollectionFilters>(DEFAULT_COLLECTION_FILTERS);
  const [marketFilters, setMarketFiltersState] = useState<MarketFilters>(DEFAULT_MARKET_FILTERS);
  const [activeTCG, setActiveTCG] = useState<TCGId | null>(null);
  const [pricesLastUpdated, setPricesLastUpdated] = useState<Date | null>(null);
  const [isPriceRefreshing, setIsPriceRefreshing] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const [notificationsHasMore, setNotificationsHasMore] = useState(false);

  // ── Pro Identity state ─────────────────────────────────────────────────────
  const [selectedIcon, setSelectedIcon] = useState<string>('original');
  const [profileTheme, setProfileTheme] = useState<string>('default');
  /**
   * Mock Founding Member claim — stored at app-session level in context so it
   * survives navigation but resets on full app restart (no backend yet).
   */
  const [foundingMemberClaimed, setFoundingMemberClaimed] = useState<boolean>(false);

  // ── Event Mode state ───────────────────────────────────────────────────────
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);

  // ── Subscription state ─────────────────────────────────────────────────────
  const [subscriptionTier, setSubscriptionTierState] = useState<SubscriptionTier>('free');
  const [scansUsed, setScansUsed] = useState(0);
  const [scansLoaded, setScansLoaded] = useState(false);
  const scanLimit = FREE_SCAN_LIMIT;

  const [scanResetDate, setScanResetDate] = useState<Date>(() =>
    nextMonthFirstDay(new Date()),
  );

  /**
   * Quota period guard — fires on mount and whenever the reset date changes.
   *
   * If the reset date is in the past (e.g. the app was left open across a
   * month boundary, or the initial date was computed just before midnight),
   * reset the scan counter and advance the reset date until it is in the
   * future. This keeps the displayed "resets 1 Sep" label and the exhaustion
   * gate accurate without requiring an external clock service.
   *
   * The advance logic lives in advancePastResetDate (scanStatePersistence.ts)
   * so it can be tested in isolation without mounting the full component tree.
   */
  useEffect(() => {
    const { newResetDate, didReset } = advancePastResetDate(scanResetDate, new Date());
    if (didReset) {
      setScanResetDate(newResetDate);
      setScansUsed(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResetDate]);

  // Load persisted watchlist, prices, scan state, and alerts from AsyncStorage on mount
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(WATCHLIST_STORAGE_KEY),
      loadPersistedPrices(),
      loadScanState(),
      loadPersistedAlerts(),
    ]).then(async ([storedWatchlist, persisted, storedScanState, persistedAlerts]) => {
      // Restore watchlist — handles versioned payloads and legacy plain arrays
      if (storedWatchlist !== null) {
        try {
          const raw = JSON.parse(storedWatchlist);

          // Detect legacy format (plain array written before versioning was added)
          const payload: WatchlistPayload = Array.isArray(raw)
            ? { version: 0, items: raw as WatchlistItem[] }
            : (raw as WatchlistPayload);

          if (payload.version === WATCHLIST_SCHEMA_VERSION) {
            // Current version — use as-is
            if (Array.isArray(payload.items)) {
              setWatchlist(payload.items);
            }
          } else {
            // Attempt migration
            const migrated = migrateWatchlist(payload);
            if (migrated !== null) {
              setWatchlist(migrated);
            } else {
              // Migration failed — discard and notify the user
              await AsyncStorage.removeItem(WATCHLIST_STORAGE_KEY);
              Alert.alert(
                'Wishlist Reset',
                'Your saved wishlist could not be loaded after an app update. ' +
                'Sorry for the inconvenience — you can re-add cards from the market.',
                [{ text: 'OK' }],
              );
            }
          }
        } catch {
          // Corrupted JSON — fall back to mock defaults silently
        }
      }

      // Restore persisted prices onto collection items
      if (persisted.collectionPrices !== null) {
        setCollection(prev => applyPersistedCollectionPrices(prev, persisted.collectionPrices!));
      }

      // Restore persisted prices onto watchlist items (price field only —
      // other watchlist data from storedWatchlist takes precedence)
      if (persisted.watchlistPrices !== null) {
        setWatchlist(prev => applyPersistedCollectionPrices(prev, persisted.watchlistPrices!));
      }

      // Restore last-updated timestamp
      if (persisted.lastUpdated !== null) {
        setPricesLastUpdated(persisted.lastUpdated);
      }

      // Restore scan state — both values loaded together via loadScanState().
      // The quota-period guard effect (above) will fire after state is set and
      // detect if the reset date is in the past, zeroing scansUsed and advancing
      // the date as needed. The persist effect then writes the updated pair.
      if (storedScanState !== null) {
        setScanResetDate(storedScanState.scanResetDate);
        setScansUsed(storedScanState.scansUsed);
      }

      // Union-merge alerts from the dedicated store (@verified_tcg/alerts) with
      // the already-loaded watchlist.  mergeAlertSources takes the UNION of both
      // sources — an alert is enabled if EITHER the watchlist payload OR the
      // dedicated store says so.  This prevents either store from silently
      // disabling a valid alert that the other store still knows about.
      // After merging, flush the union back to the dedicated store so both
      // sources stay in sync for the next restart.
      setWatchlist(prev => {
        const merged = mergeAlertSources(prev, persistedAlerts);
        // Flush union back to the dedicated store (fire-and-forget; errors swallowed)
        saveAlertState(merged).catch(() => {});
        return merged;
      });
    }).finally(() => {
      setWatchlistLoaded(true);
      setScansLoaded(true);
    });
  }, []);

  // Persist watchlist to AsyncStorage on every change (after initial load).
  // Always written as a versioned payload so the loader can detect schema changes.
  useEffect(() => {
    if (!watchlistLoaded) return;
    const payload: WatchlistPayload = { version: WATCHLIST_SCHEMA_VERSION, items: watchlist };
    AsyncStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
  }, [watchlist, watchlistLoaded]);

  // Atomically mirror the complete alert state to the dedicated alerts store
  // (@verified_tcg/alerts) on every watchlist change (after initial load).
  // Writing the full derived state from the in-memory watchlist avoids
  // read-modify-write races — the watchlist is the single source of truth
  // and this effect just keeps the dedicated store in sync.
  useEffect(() => {
    if (!watchlistLoaded) return;
    saveAlertState(watchlist).catch(() => {});
  }, [watchlist, watchlistLoaded]);

  // Persist scan state to AsyncStorage on every change (after initial load).
  // Both values must be written together so the loader can cross-check them.
  // Uses saveScanState() from scanStatePersistence (same module tested by
  // __tests__/scan-state-persistence.test.ts).
  useEffect(() => {
    if (!scansLoaded) return;
    saveScanState(scansUsed, scanResetDate).catch(() => {});
  }, [scansUsed, scanResetDate, scansLoaded]);

  /**
   * Server sync on initial load.
   *
   * Once AsyncStorage has been read, send the local list to the server and
   * adopt the server's canonical merged result unconditionally — including
   * when it is shorter, so tombstoned deletions from another device are
   * applied here.
   *
   * Any network error is silenced: AsyncStorage acts as the offline cache and
   * the next successful load will re-attempt the sync.
   *
   * Note: this is a single-tenant prototype — the server stores data for one
   * fixed collector and requires no credentials.  See wishlistApi.ts.
   */
  useEffect(() => {
    if (!watchlistLoaded) return;

    setWatchlist(snapshot => {
      syncWishlistToServer(snapshot)
        .then(serverCanonical => {
          // Always adopt the server's canonical list (may be shorter if items
          // were tombstoned/deleted on another device).
          setWatchlist(serverCanonical);
        })
        .catch(() => {
          // Network unavailable — stay with local cache
        });
      return snapshot; // unchanged while the request is in-flight
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistLoaded]);

  // ── Pending-mutation tracking ──────────────────────────────────────────────
  //
  // Tracks optimistic items whose server round-trip has not yet completed so
  // that a concurrent loadCollection() cannot wipe them out.
  //
  // pendingItemIds     — Set of client-generated temp IDs
  // pendingFingerprints — Maps temp ID → "cardId::acquiredAt" fingerprint
  //
  // During a server merge, a pending item is kept only if its fingerprint does
  // NOT already appear in the server response. This deduplicates the case where
  // the POST lands on the server before its promise handler fires: the server
  // row and the optimistic row would otherwise both appear in state until the
  // next refresh. Once the fingerprint matches a server item, the POST handler
  // will imminently swap the temp id → server id, so we drop the optimistic row.

  const pendingItemIds = useRef<Set<string>>(new Set());
  const pendingFingerprints = useRef<Map<string, string>>(new Map());
  // IDs of items that have been optimistically deleted but whose server DELETE
  // has not yet resolved. A background fetch must not restore these items.
  const pendingDeleteIds = useRef<Set<string>>(new Set());
  // Monotonically increasing counter; each loadCollection call captures it on
  // entry so a stale response cannot overwrite a newer one.
  const loadGeneration = useRef(0);

  // ── Load collection from server ────────────────────────────────────────────

  const loadCollection = useCallback(async () => {
    const gen = ++loadGeneration.current; // capture before first await
    setCollectionLoading(true);
    try {
      const serverItems = await fetchCollection();
      // If a newer loadCollection started after this one, discard this result.
      if (gen !== loadGeneration.current) return;

      setCollection(prev => {
        // 1. Exclude server items that have been optimistically deleted but
        //    whose DELETE hasn't landed on the server yet.
        const deletedIds = pendingDeleteIds.current;
        const filteredServer = serverItems.filter(i => !deletedIds.has(i.id));

        // 2. Keep optimistic adds whose POST has not yet landed. A pending add
        //    is kept only when its fingerprint is absent from the server
        //    response — once the server row appears, the POST handler will swap
        //    in the persisted id, so we drop the optimistic row to avoid dupes.
        const serverFingerprints = new Set(
          filteredServer.map(i => `${i.cardId}::${i.acquiredAt}`),
        );
        const pendingIds = pendingItemIds.current;
        const pendingFps = pendingFingerprints.current;
        const stillPending = prev.filter(i => {
          if (!pendingIds.has(i.id)) return false;
          const fp = pendingFps.get(i.id);
          return fp !== undefined && !serverFingerprints.has(fp);
        });

        return [...filteredServer, ...stillPending];
      });
    } catch {
      // Network error or unauthenticated — keep current local state
    } finally {
      // Only the latest generation clears the loading flag.
      if (gen === loadGeneration.current) setCollectionLoading(false);
    }
  }, []);

  // ── Notifications ───────────────────────────────────────────────────────────

  /**
   * Load the first page of server notifications and merge with any
   * locally-generated client notifications (price alerts with temp IDs).
   * Silently no-ops when the user is not authenticated.
   */
  const loadNotifications = useCallback(async () => {
    try {
      // Fetch first page of server notifications AND the authoritative unread count
      // in parallel so the badge is always accurate (even beyond the first page).
      const [page, unread] = await Promise.all([
        fetchNotifications(1, 20),
        fetchUnreadCount(),
      ]);
      setNotifications(prev => {
        // Keep any client-generated entries (temp IDs prefixed 'price-alert-wl-')
        const local = prev.filter(n => n.id.startsWith('price-alert-wl-'));
        // Merge: local first (most recent), then server (dedup by id)
        const serverIds = new Set(page.notifications.map(n => n.id));
        const dedupedLocal = local.filter(n => !serverIds.has(n.id));
        return [...dedupedLocal, ...page.notifications];
      });
      // Store server count only — local price-alert count is derived separately
      // via useMemo to avoid stale closure issues (no notifications in deps).
      setServerUnreadCount(unread);
      setNotificationsHasMore(page.hasMore);
    } catch {
      // Network unavailable — keep current state
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    await loadNotifications();
  }, [loadNotifications]);

  // Restore session on mount (handles app restarts and token refresh)
  useEffect(() => {
    restoreSession().then(async session => {
      if (!session) return;
      setUser(userFromSession(session));
      setIsAuthenticated(true);

      // Restore subscription tier from the cached session metadata.
      // The session is refreshed from the server whenever the access token
      // expires, so this value stays up-to-date across restarts.
      const meta = session.user.user_metadata ?? {};
      const restoredTier = meta.subscription_tier === 'pro' ? 'pro' : 'free';
      if (restoredTier === 'pro') setSubscriptionTierState('pro');
      if (meta.is_founding_member === true) setFoundingMemberClaimed(true);

      loadCollection();
      loadNotifications();

      // NOTE: Push token registration is NOT triggered on cold session restore.
      // It runs only after an explicit sign-in (see signIn callback) so the
      // OS permission prompt appears contextually — not on every app launch.

      // Hydrate scan count from server so the gate is accurate across
      // reinstalls, device switches, and charged-failure scenarios.
      // Only free-tier users have a meaningful quota to enforce.
      if (restoredTier === 'free') {
        fetchServerScanCount(session.access_token).then(count => {
          if (typeof count === 'number') setScansUsed(count);
        }).catch(() => {});
      }

      // Restore active event participation so Trade Match and Event Mode reflect
      // real data immediately without requiring navigation to Event Mode first.
      fetchMyActiveParticipation().then(p => {
        if (p.eventId) setCurrentEventId(p.eventId);
      }).catch(() => {});
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh collection and unread notification count when the app comes back
  // to the foreground so changes made on another device are reflected.
  const isAuthenticatedRef = useRef(false);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && isAuthenticatedRef.current) {
        loadCollection();
        // Refresh notifications on app focus so new server-side alerts appear
        loadNotifications();
      }
    };
    const subscription = RNAppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await signInWithPassword(email, password);
    setUser(userFromSession(session));
    setIsAuthenticated(true);

    // Restore subscription tier from the sign-in response
    const meta = session.user.user_metadata ?? {};
    if (meta.subscription_tier === 'pro') {
      setSubscriptionTierState('pro');
    } else {
      setSubscriptionTierState('free');
    }
    if (meta.is_founding_member === true) {
      setFoundingMemberClaimed(true);
    }

    // Load real collection and notifications from server
    loadCollection();
    loadNotifications();

    // Request push token after a fresh sign-in (contextual, not cold-launch)
    requestAndRegisterPushToken();

    // Sync wishlist with server after sign-in
    setWatchlist(snapshot => {
      syncWishlistToServer(snapshot)
        .then(serverCanonical => { setWatchlist(serverCanonical); })
        .catch(() => {});
      return snapshot;
    });

    // Hydrate server-authoritative scan count for free users
    const signedInTier = meta.subscription_tier === 'pro' ? 'pro' : 'free';
    if (signedInTier === 'free') {
      fetchServerScanCount(session.access_token).then(count => {
        if (typeof count === 'number') setScansUsed(count);
      }).catch(() => {});
    }
  }, [loadCollection, loadNotifications]);

  const signInWithProvider = useCallback(async (provider: OAuthProvider) => {
    const session = await signInWithOAuth(provider);
    if (!session) return false;
    setUser(userFromSession(session));
    setIsAuthenticated(true);
    // Run the same post-sign-in initialization as email/password sign-in
    loadCollection();
    loadNotifications();
    requestAndRegisterPushToken();
    return true;
  }, [loadCollection, loadNotifications]);

  const signOut = useCallback(() => {
    // Clear server-side sessions and wipe all local AsyncStorage data
    authSignOut().catch(() => {});
    // Reset all in-memory state so the next user starts completely fresh
    setUser(null);
    setIsAuthenticated(false);
    setCollection([]);
    setWatchlist([]);
    setNotifications([]);
    setServerUnreadCount(0);
    setNotificationsHasMore(false);
    setSubscriptionTierState('free');
    setScansUsed(0);
    setScanResetDate(nextMonthFirstDay(new Date()));
    setSelectedIcon('original');
    setProfileTheme('default');
    setFoundingMemberClaimed(false);
    setPricesLastUpdated(null);
    setCurrentEventId(null);
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await authDeleteAccount(password);
    // Reset all in-memory state after successful deletion
    setUser(null);
    setIsAuthenticated(false);
    setCollection([]);
    setWatchlist([]);
    setNotifications([]);
    setServerUnreadCount(0);
    setNotificationsHasMore(false);
    setSubscriptionTierState('free');
    setScansUsed(0);
    setScanResetDate(nextMonthFirstDay(new Date()));
    setSelectedIcon('original');
    setProfileTheme('default');
    setFoundingMemberClaimed(false);
    setPricesLastUpdated(null);
    setCurrentEventId(null);
  }, []);

  const updateProfile = useCallback(async (patch: Pick<User, 'displayName' | 'username' | 'bio' | 'location'> & {
    favouriteTcg?: string | null;
    collectorSince?: string | null;
    profilePublic?: boolean;
    showCollection?: boolean;
    showWishlist?: boolean;
    showForTrade?: boolean;
    showForSale?: boolean;
  }) => {
    if (!user) throw new Error('Create an account to edit your profile.');
    const data: Record<string, unknown> = {
      display_name: patch.displayName.trim(),
      username: patch.username.trim().replace(/^@+/, '').toLowerCase(),
      bio: patch.bio?.trim() ?? '',
      location: patch.location?.trim() ?? '',
    };
    if (patch.favouriteTcg !== undefined) data.favourite_tcg = patch.favouriteTcg;
    if (patch.collectorSince !== undefined) data.collector_since = patch.collectorSince;
    if (patch.profilePublic !== undefined) data.profile_public = patch.profilePublic;
    if (patch.showCollection !== undefined) data.show_collection = patch.showCollection;
    if (patch.showWishlist !== undefined) data.show_wishlist = patch.showWishlist;
    if (patch.showForTrade !== undefined) data.show_for_trade = patch.showForTrade;
    if (patch.showForSale !== undefined) data.show_for_sale = patch.showForSale;
    await updateUserMetadata(data);
    setUser(current => current
      ? {
          ...current,
          displayName: patch.displayName,
          username: patch.username.trim().replace(/^@+/, '').toLowerCase(),
          bio: patch.bio,
          location: patch.location,
          // Use !== undefined so that explicit null (user clearing the field) is preserved
          favouriteTcg: patch.favouriteTcg !== undefined ? patch.favouriteTcg : current.favouriteTcg,
          collectorSince: patch.collectorSince !== undefined ? patch.collectorSince : current.collectorSince,
          profilePublic: patch.profilePublic ?? current.profilePublic,
          showCollection: patch.showCollection ?? current.showCollection,
          showWishlist: patch.showWishlist ?? current.showWishlist,
          showForTrade: patch.showForTrade ?? current.showForTrade,
          showForSale: patch.showForSale ?? current.showForSale,
        }
      : current,
    );
  }, [user]);

  const addToCollection = useCallback((item: CollectionItem) => {
    // Register temp id and fingerprint BEFORE the optimistic insert so any
    // concurrent loadCollection() call can preserve or deduplicate correctly.
    const fp = `${item.cardId}::${item.acquiredAt}`;
    pendingItemIds.current.add(item.id);
    pendingFingerprints.current.set(item.id, fp);
    setCollection(prev => [...prev, item]);

    addCollectionItem(item)
      .then(saved => {
        // Swap the client-generated temp id for the server-assigned id.
        pendingItemIds.current.delete(item.id);
        pendingFingerprints.current.delete(item.id);
        setCollection(prev =>
          prev.map(i => i.id === item.id ? saved : i),
        );
      })
      .catch(() => {
        // Rollback and notify the user.
        pendingItemIds.current.delete(item.id);
        pendingFingerprints.current.delete(item.id);
        setCollection(prev => prev.filter(i => i.id !== item.id));
        Alert.alert(
          'Could not save card',
          'The card was not added to your collection. Please check your connection and try again.',
          [{ text: 'OK' }],
        );
      });
  }, []);

  const removeFromCollection = useCallback((id: string) => {
    // Register as pending-delete BEFORE the optimistic removal so any
    // concurrent loadCollection() call will filter it out of the server response.
    pendingDeleteIds.current.add(id);
    setCollection(prev => prev.filter(i => i.id !== id));
    removeCollectionItem(id)
      .then(() => {
        pendingDeleteIds.current.delete(id);
      })
      .catch(() => {
        // Server delete failed — restore item by re-fetching canonical state.
        pendingDeleteIds.current.delete(id);
        loadCollection();
      });
  }, [loadCollection]);

  const addToWatchlist = useCallback((item: WatchlistItem) => {
    // Optimistic local update
    setWatchlist(prev => [...prev, item]);
    // Background mirror to server (silenced — AsyncStorage is the local cache)
    addWishlistItemToServer(item).catch(() => {});
  }, []);

  const removeFromWatchlist = useCallback((id: string) => {
    // Optimistic local update
    setWatchlist(prev => prev.filter(i => i.id !== id));
    // Background mirror — DELETE records a server tombstone so future syncs
    // from stale clients cannot resurrect the item.
    removeWishlistItemFromServer(id).catch(() => {});
    // Alert store is kept in sync by the watchlist-change useEffect below —
    // no separate per-item delete needed here.
  }, []);

  const updateWatchlistItem = useCallback((
    id: string,
    patch: Partial<Pick<WatchlistItem, 'desiredGrade' | 'targetPrice' | 'priceAlertEnabled' | 'alertType'>>,
  ) => {
    // Enforce FREE_ALERT_LIMIT at the state layer so no caller can bypass the cap.
    // Use watchlistRef (always current) so the cap decision and server-mirror
    // decision are made together — either both happen or neither does.
    if (patch.priceAlertEnabled === true && subscriptionTier === 'free') {
      const current = watchlistRef.current;
      const item = current.find(i => i.id === id);
      if (item && !item.priceAlertEnabled) {
        const activeCount = current.filter(
          i => i.priceAlertEnabled && !!i.targetPrice,
        ).length;
        if (activeCount >= FREE_ALERT_LIMIT) {
          return; // cap reached — drop both local and server update
        }
      }
    }
    // Optimistic local update
    setWatchlist(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
    // Background mirror to server (only reached if the cap check passed)
    updateWishlistItemOnServer(id, patch).catch(() => {});
    // Alert store is kept in sync by the watchlist-change useEffect below —
    // no separate per-item read-modify-write needed here.
  }, [subscriptionTier]);

  const setCollectionFilters = useCallback((filters: Partial<CollectionFilters>) => {
    setCollectionFiltersState(prev => ({ ...prev, ...filters }));
  }, []);

  const setMarketFilters = useCallback((filters: Partial<MarketFilters>) => {
    setMarketFiltersState(prev => ({ ...prev, ...filters }));
  }, []);

  const markNotificationRead = useCallback((id: string, currentlyRead = false) => {
    // Optimistic local update — mark in context notifications array (page 1)
    setNotifications(prev => {
      const target = prev.find(n => n.id === id);
      // For page-1 notifications we have the live isRead state from context.
      // For page-2+ notifications (stored in extraNotifications in the screen)
      // the caller passes `currentlyRead` so we know not to double-decrement.
      const wasRead = target ? target.isRead : currentlyRead;
      if (!wasRead && !id.startsWith('price-alert-wl-')) {
        setServerUnreadCount(c => Math.max(0, c - 1));
      }
      return prev.map(n => n.id === id ? { ...n, isRead: true } : n);
    });
    // Persist to server for real notification rows (fire-and-forget)
    if (!id.startsWith('price-alert-wl-')) {
      markNotificationReadOnServer(id);
    }
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    // Optimistic local update — zero out the server-backed badge count
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setServerUnreadCount(0);
    // Persist to server (fire-and-forget)
    markAllNotificationsReadOnServer();
  }, []);

  // ── Subscription actions ───────────────────────────────────────────────────

  const setSubscriptionTier = useCallback((tier: SubscriptionTier) => {
    setSubscriptionTierState(tier);
    // On downgrade to Free, reset any Pro-gated identity selections so Free
    // users cannot continue benefiting from paid customisations they no longer
    // hold an entitlement for.
    if (tier === 'free') {
      setSelectedIcon('original');
      setProfileTheme('default');
      setFoundingMemberClaimed(false);
    }
  }, []);

  const incrementScanCount = useCallback(() => {
    // Only count scans against the Free quota; Pro is unlimited.
    // Cap defensively at the limit so the value never overflows the UI range.
    setSubscriptionTierState(tier => {
      if (tier === 'free') {
        setScansUsed(prev => Math.min(prev + 1, FREE_SCAN_LIMIT));
      }
      return tier; // unchanged
    });
  }, []);

  /**
   * Sync the local scan counter with an authoritative server value.
   * Always prefers the server count so device-switch, reinstall, and
   * charged-failure scenarios stay accurate.  Clamps to [0, FREE_SCAN_LIMIT]
   * for safety.
   */
  const syncScanCount = useCallback((serverCount: number) => {
    setScansUsed(Math.max(0, Math.min(serverCount, FREE_SCAN_LIMIT)));
  }, []);

  /** Reset scansUsed to 0, regardless of tier (DEV panel convenience). */
  const resetScanCount = useCallback(() => {
    setScansUsed(0);
  }, []);

  /**
   * DEV-only: set scansUsed to an exact value so the limit flow (amber banner
   * at 29, disabled scanner at 30) can be reached without clicking through
   * many scans.  Clamps to [0, FREE_SCAN_LIMIT].
   */
  const devSetScansUsed = useCallback((count: number) => {
    setScansUsed(Math.max(0, Math.min(count, FREE_SCAN_LIMIT)));
  }, []);

  // Refs so refreshPrices can read the latest collection/watchlist without
  // them being stale-closure-captured in the useCallback dependency array.
  const collectionRef = useRef<CollectionItem[]>(collection);
  const watchlistRef = useRef<WatchlistItem[]>(watchlist);
  useEffect(() => { collectionRef.current = collection; }, [collection]);
  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);

  const refreshPrices = useCallback(async () => {
    if (isPriceRefreshing) return;
    setIsPriceRefreshing(true);
    try {
      await fetchRefreshedPrices();
      const now = new Date();

      // Compute updated arrays using the latest ref values so we can
      // both set state and persist in the same step — no setTimeout needed.
      const updatedCollection = collectionRef.current.map(item => ({
        ...item,
        card: {
          ...item.card,
          price: simulateRefreshedPrice(item.cardId, item.card.price),
        },
      }));

      // Also refresh prices on watchlist cards so price-alert thresholds can trigger
      const updatedWatchlist = watchlistRef.current.map(item => ({
        ...item,
        card: {
          ...item.card,
          price: simulateRefreshedPrice(item.cardId, item.card.price),
        },
      }));

      setCollection(updatedCollection);
      setWatchlist(updatedWatchlist);
      setPricesLastUpdated(now);

      // Await persistence so that an immediate restart cannot lose the data.
      // Errors are caught and re-thrown so callers know the save failed.
      await saveRefreshedPrices(updatedCollection, updatedWatchlist, now);
    } finally {
      setIsPriceRefreshing(false);
    }
  }, [isPriceRefreshing]);

  // Track which watchlist item IDs have already generated a price-alert notification
  // so we don't create duplicates on every re-render.
  const alertedItemIds = useRef<Set<string>>(new Set());

  // Generate in-app price-alert notifications when an alert condition is met.
  // Supports two alert types:
  //   'price-drop' (default): fires when price <= targetPrice
  //   'price-rise': fires when price >= targetPrice
  useEffect(() => {
    if (!watchlistLoaded) return;

    const timeLabel = 'Just now';

    setNotifications(prev => {
      let updated = [...prev];

      watchlist.forEach(item => {
        const notifId = `price-alert-wl-${item.id}`;

        // Handle disabled or target-less items first — cleanup must run before returning
        if (!item.priceAlertEnabled) {
          // Alert was disabled — remove any generated notification and reset tracker
          alertedItemIds.current.delete(item.id);
          updated = updated.filter(n => n.id !== notifId);
          return;
        }
        if (!item.targetPrice) return; // no target → no alert to evaluate

        const price = item.card.price.raw;
        const target = item.targetPrice;
        const isPriceRise = item.alertType === 'price-rise';

        // Condition met: price has dropped to/below target (drop) or risen to/above (rise)
        const conditionMet = isPriceRise ? price >= target : price <= target;

        if (conditionMet && !alertedItemIds.current.has(item.id)) {
          // Condition met and alert hasn't fired yet — generate notification
          const alreadyExists = updated.some(n => n.id === notifId);
          if (!alreadyExists) {
            const alertLabel = isPriceRise ? 'risen to or above' : 'dropped to or below';
            updated = [
              {
                id: notifId,
                type: 'price_alert',
                title: `Price Alert — ${item.card.name}`,
                body: `${item.card.name} (${item.card.setName}) is now $${price.toLocaleString('en-AU')} AUD — ${alertLabel} your target of $${target.toLocaleString('en-AU')} AUD.`,
                isRead: false,
                time: timeLabel,
                actionLabel: 'View Card',
                route: `/card/${item.cardId}`,
              },
              ...updated,
            ];
            // localUnreadCount (derived via useMemo from notifications) will
            // automatically pick this up — no manual counter update needed.
          }
          alertedItemIds.current.add(item.id);
        } else if (!conditionMet) {
          // Condition no longer met — reset tracker so alert fires again when condition returns
          alertedItemIds.current.delete(item.id);
        }
      });

      return updated;
    });
  }, [watchlist, watchlistLoaded]);

  // Local unread count — client-generated price-alert-wl-* entries only.
  // Derived fresh from state every render, no stale-closure risk.
  const localUnreadCount = useMemo(
    () => notifications.filter(n => n.id.startsWith('price-alert-wl-') && !n.isRead).length,
    [notifications],
  );

  // Combined badge: server count (authoritative, covers all pages) +
  // in-memory local price-alert entries not yet persisted to the server.
  const unreadNotificationCount = serverUnreadCount + localUnreadCount;

  const activeAlertCount = useMemo(
    () => watchlist.filter(w => w.priceAlertEnabled && !!w.targetPrice).length,
    [watchlist],
  );

  const portfolio = useMemo<PortfolioSummary>(() => {
    const totalValue = collection.reduce(
      (sum, item) => sum + getItemCurrentValue(item) * item.quantity,
      0,
    );
    const totalCost = collection.reduce(
      (sum, item) => sum + item.acquiredPrice * item.quantity,
      0,
    );
    const totalGain = totalValue - totalCost;
    const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const cardCount = collection.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueCardCount = new Set(collection.map(item => item.cardId)).size;

    return {
      totalValue,
      totalCost,
      totalGain,
      totalGainPercent,
      currency: 'AUD',
      cardCount,
      uniqueCardCount,
      // Chart history is a separate task — provide empty ranges as placeholder
      chartData: {
        '1D': [], '7D': [], '1M': [], '3M': [], '1Y': [], 'ALL': [],
      },
    };
  }, [collection]);

  return (
    <AppContext.Provider
      value={{
        user, isAuthenticated,
        collection, collectionLoading, refreshCollection: loadCollection, portfolio, collectionFilters,
        watchlist, portfolioRange, marketFilters, activeTCG,
        pricesLastUpdated, isPriceRefreshing,
        notifications, unreadNotificationCount, notificationsHasMore, activeAlertCount,
        signIn, signInWithProvider, signOut, deleteAccount, updateProfile,
        addToCollection, removeFromCollection,
        addToWatchlist, removeFromWatchlist, updateWatchlistItem,
        setPortfolioRange, setCollectionFilters, setMarketFilters, setActiveTCG,
        refreshPrices,
        markNotificationRead, markAllNotificationsRead, refreshNotifications,
        subscriptionTier, scansUsed, scanLimit, scanResetDate,
        setSubscriptionTier, incrementScanCount, syncScanCount, resetScanCount, devSetScansUsed,
        selectedIcon, setSelectedIcon,
        profileTheme, setProfileTheme,
        foundingMemberClaimed,
        claimFoundingMember: () => setFoundingMemberClaimed(true),
        currentEventId, setCurrentEventId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
