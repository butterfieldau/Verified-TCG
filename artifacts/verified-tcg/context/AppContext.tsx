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
import { Alert } from 'react-native';
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
import { MOCK_PORTFOLIO, getItemCurrentValue } from '@/services/collection';
import { MOCK_USER } from '@/services/profile';
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
import { getNotifications } from '@/services/notifications';
import type { Notification } from '@/services/notifications';
import { FREE_SCAN_LIMIT, FREE_ALERT_LIMIT } from '@/services/subscription';
import type { SubscriptionTier } from '@/services/subscription';
import { restoreSession, signInWithPassword, signOut as signOutSession } from '@/services/auth';
import { getCollectionFromServer, saveCollectionItemToServer, removeCollectionItemFromServer } from '@/services/collectionApi';
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
  isAuthLoading: boolean;
  collection: CollectionItem[];
  portfolio: PortfolioSummary;
  collectionFilters: CollectionFilters;
  watchlist: WatchlistItem[];
  portfolioRange: PortfolioRange;
  marketFilters: MarketFilters;
  activeTCG: TCGId | null;
  pricesLastUpdated: Date | null;
  isPriceRefreshing: boolean;
  notifications: Notification[];
  unreadNotificationCount: number;
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
}

interface AppActions {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
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
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  // ── Subscription ──────────────────────────────────────────────────────────
  setSubscriptionTier: (tier: SubscriptionTier) => void;
  incrementScanCount: () => void;
  // ── Pro Identity ──────────────────────────────────────────────────────────
  setSelectedIcon: (icon: string) => void;
  setProfileTheme: (theme: string) => void;
  /** Toggle the mock Founding Member claim. Only callable when tier === 'pro'. */
  claimFoundingMember: () => void;
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
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  // Do not seed a real session with another collector's prototype data.
  // Collection persistence is the next Stage 1 slice; until then these remain
  // empty and are populated only by authenticated user actions.
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [portfolioRange, setPortfolioRange] = useState<PortfolioRange>('7D');
  const [collectionFilters, setCollectionFiltersState] = useState<CollectionFilters>(DEFAULT_COLLECTION_FILTERS);
  const [marketFilters, setMarketFiltersState] = useState<MarketFilters>(DEFAULT_MARKET_FILTERS);
  const [activeTCG, setActiveTCG] = useState<TCGId | null>(null);
  const [pricesLastUpdated, setPricesLastUpdated] = useState<Date | null>(null);
  const [isPriceRefreshing, setIsPriceRefreshing] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(getNotifications);

  // ── Pro Identity state ─────────────────────────────────────────────────────
  const [selectedIcon, setSelectedIcon] = useState<string>('original');
  const [profileTheme, setProfileTheme] = useState<string>('default');
  /**
   * Mock Founding Member claim — stored at app-session level in context so it
   * survives navigation but resets on full app restart (no backend yet).
   */
  const [foundingMemberClaimed, setFoundingMemberClaimed] = useState<boolean>(false);

  // ── Subscription state ─────────────────────────────────────────────────────
  const [subscriptionTier, setSubscriptionTierState] = useState<SubscriptionTier>('free');
  const [scansUsed, setScansUsed] = useState(0);
  const [scansLoaded, setScansLoaded] = useState(false);
  const scanLimit = FREE_SCAN_LIMIT;

  const [scanResetDate, setScanResetDate] = useState<Date>(() =>
    nextMonthFirstDay(new Date()),
  );

  useEffect(() => {
    restoreSession().then(session => {
      if (!session) return;
      setUser({
        ...MOCK_USER,
        id: session.user.id,
        email: session.user.email ?? MOCK_USER.email,
        displayName: typeof session.user.user_metadata?.display_name === 'string'
          ? session.user.user_metadata.display_name
          : MOCK_USER.displayName,
      });
      setIsAuthenticated(true);
      getCollectionFromServer().then(setCollection).catch(() => {});
      syncWishlistToServer([]).then(setWatchlist).catch(() => {});
    }).catch(() => {
      setUser(null);
      setIsAuthenticated(false);
    }).finally(() => setIsAuthLoading(false));
  }, []);

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

  // Load persisted watchlist, prices, and scan state from AsyncStorage on mount
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(WATCHLIST_STORAGE_KEY),
      loadPersistedPrices(),
      loadScanState(),
    ]).then(async ([storedWatchlist, persisted, storedScanState]) => {
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
   * The server now scopes wishlist data to the authenticated Supabase user.
   * Network failures remain non-fatal so the local cache can be used offline.
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

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await signInWithPassword(email, password);
    setUser({
      ...MOCK_USER,
      id: session.user.id,
      email: session.user.email ?? email,
      displayName: typeof session.user.user_metadata?.display_name === 'string'
        ? session.user.user_metadata.display_name
        : MOCK_USER.displayName,
    });
    setIsAuthenticated(true);
    getCollectionFromServer().then(setCollection).catch(() => {});

    // On sign-in, sync with the server so the collector's list is fully
    // restored on a new or reset device.
    setWatchlist(snapshot => {
      syncWishlistToServer(snapshot)
        .then(serverCanonical => { setWatchlist(serverCanonical); })
        .catch(() => {});
      return snapshot;
    });
  }, []);

  const signOut = useCallback(() => {
    void signOutSession();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const addToCollection = useCallback((item: CollectionItem) => {
    setCollection(prev => [...prev, item]);
    saveCollectionItemToServer(item).catch(() => {});
  }, []);

  const removeFromCollection = useCallback((id: string) => {
    setCollection(prev => prev.filter(i => i.id !== id));
    removeCollectionItemFromServer(id).catch(() => {});
  }, []);

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
  }, [subscriptionTier]);

  const setCollectionFilters = useCallback((filters: Partial<CollectionFilters>) => {
    setCollectionFiltersState(prev => ({ ...prev, ...filters }));
  }, []);

  const setMarketFilters = useCallback((filters: Partial<MarketFilters>) => {
    setMarketFiltersState(prev => ({ ...prev, ...filters }));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
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

  const unreadNotificationCount = useMemo(
    () => notifications.filter(n => !n.isRead).length,
    [notifications],
  );

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
      // Keep static chart history — no real time-series data available in mock
      chartData: MOCK_PORTFOLIO.chartData,
    };
  }, [collection]);

  return (
    <AppContext.Provider
      value={{
        user, isAuthenticated, isAuthLoading,
        collection, portfolio, collectionFilters,
        watchlist, portfolioRange, marketFilters, activeTCG,
        pricesLastUpdated, isPriceRefreshing,
        notifications, unreadNotificationCount, activeAlertCount,
        signIn, signOut,
        addToCollection, removeFromCollection,
        addToWatchlist, removeFromWatchlist, updateWatchlistItem,
        setPortfolioRange, setCollectionFilters, setMarketFilters, setActiveTCG,
        refreshPrices,
        markNotificationRead, markAllNotificationsRead,
        subscriptionTier, scansUsed, scanLimit, scanResetDate,
        setSubscriptionTier, incrementScanCount,
        selectedIcon, setSelectedIcon,
        profileTheme, setProfileTheme,
        foundingMemberClaimed,
        claimFoundingMember: () => setFoundingMemberClaimed(true),
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
