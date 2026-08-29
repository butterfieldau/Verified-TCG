import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Platform,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supportsLiquidGlassTabs } from '@/utils/liquidGlass';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Circle,
  Line as SvgLine,
} from 'react-native-svg';
import { Logo } from '@/components/Logo';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { MarketMoverSkeleton } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import {
  getMarketMovers,
  getMarketGainers,
  getMarketLosers,
  getTrendingCards,
  getRecentlyAddedCards,
  getMarketMoversCached,
  getMarketGainersCached,
  getMarketLosersCached,
  getTrendingCardsCached,
  getRecentlyAddedCardsCached,
} from '@/services/market';
import { fetchActiveEvents, type EventSummary } from '@/services/eventsApi';
import { fetchRecentActivity, type ActivityItem } from '@/services/activityApi';
import {
  fetchCollectionSummary,
  fetchCollectionPerformance,
  type CollectionSummary,
  type CollectionPerformance,
  type PerformanceRange,
} from '@/services/collectionPerformance';
import {
  getHomeCollectionCards,
  getHomePerformanceView,
  getHomePortfolioValueState,
} from '@/services/homePortfolio';
import { getMarketFeed, type MarketTab } from '@/services/marketFeed';
import { CardImage } from '@/components/ui/CardImage';
import { useSettings } from '@/context/SettingsContext';
import colors from '@/constants/colors';
import type { Card, MarketMover, PortfolioRange } from '@/types';
const EVENT_BANNER_DISMISSED_KEY = '@verified_tcg/event_banner_dismissed_event_id';
const C = colors.dark;
const RANGES: PortfolioRange[] = ['1D', '7D', '1M', '3M', '1Y', 'ALL'];

const MARKET_TABS: { id: MarketTab; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'new', label: 'New' },
];

const QUICK_ACTIONS: { icon: string; label: string; action: string }[] = [
  { icon: 'camera', label: 'Scan', action: 'scan' },
  { icon: 'search', label: 'Search', action: 'search' },
  { icon: 'plus-circle', label: 'Add', action: 'add-card' },
  { icon: 'shield', label: 'Verify', action: 'search' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

function formatLastUpdated(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
interface ChartPoint { value: number; date: string; }

interface InteractiveChartProps {
  data: ChartPoint[];
  isPositive: boolean;
  onPointSelect: (pt: ChartPoint | null) => void;
}

function InteractiveChart({ data, isPositive, onPointSelect }: InteractiveChartProps) {
  const [width, setWidth] = useState(350);
  const height = 140;
  const padL = 0;
  const padR = 0;
  const padT = 12;
  const padB = 4;

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const vals = data.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const rangeV = maxV - minV || 1;

  const chartColor = isPositive ? C.positive : C.negative;
  const gradId = isPositive ? 'chartGreen' : 'chartRed';

  // Map data index → pixel x
  const xOf = (i: number) =>
    padL + (i / Math.max(data.length - 1, 1)) * (width - padL - padR);
  // Map value → pixel y
  const yOf = (v: number) =>
    padT + (1 - (v - minV) / rangeV) * (height - padT - padB);

  // Build smooth SVG path (monotone cubic)
  function buildPath() {
    if (data.length < 2) return '';
    const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.value) }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const cx = (pts[i].x + pts[i + 1].x) / 2;
      d += ` C ${cx} ${pts[i].y}, ${cx} ${pts[i + 1].y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
    }
    return d;
  }

  function buildArea() {
    if (data.length < 2) return '';
    const line = buildPath();
    const last = { x: xOf(data.length - 1), y: height };
    const first = { x: xOf(0), y: height };
    return `${line} L ${last.x} ${last.y} L ${first.x} ${first.y} Z`;
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        handleTouch(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => {
        handleTouch(e.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        setActiveIndex(null);
        onPointSelect(null);
      },
      onPanResponderTerminate: () => {
        setActiveIndex(null);
        onPointSelect(null);
      },
    })
  ).current;

  function handleTouch(touchX: number) {
    const n = data.length;
    if (n === 0) return;
    const usableWidth = Math.max(width - padL - padR, 1);
    const ratio = Math.max(0, Math.min(1, (touchX - padL) / usableWidth));
    const idx = Math.min(Math.round(ratio * (n - 1)), n - 1);
    setActiveIndex(idx);
    onPointSelect(data[idx]);
  }

  const linePath = buildPath();
  const areaPath = buildArea();
  const activeX = activeIndex !== null ? xOf(activeIndex) : null;
  const activeY = activeIndex !== null ? yOf(data[activeIndex].value) : null;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, width: '100%' }}
      {...panResponder.panHandlers}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
            <Stop offset="100%" stopColor={chartColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Area fill */}
        <Path d={areaPath} fill={`url(#${gradId})`} />

        {/* Line */}
        <Path
          d={linePath}
          stroke={chartColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Crosshair */}
        {activeX !== null && activeY !== null && (
          <>
            <SvgLine
              x1={activeX}
              y1={padT}
              x2={activeX}
              y2={height - padB}
              stroke={chartColor}
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.6}
            />
            {/* Outer glow ring */}
            <Circle cx={activeX} cy={activeY} r={10} fill={chartColor} opacity={0.15} />
            {/* Dot */}
            <Circle cx={activeX} cy={activeY} r={5} fill={chartColor} />
            {/* White centre */}
            <Circle cx={activeX} cy={activeY} r={2.5} fill="#FFFFFF" />
          </>
        )}
      </Svg>
    </View>
  );
}

// ── Tooltip pill shown above chart when touching ───────────────────────────────
function ChartTooltip({ point, currency }: { point: ChartPoint | null; currency: string }) {
  if (!point) return null;
  return (
    <View style={styles.tooltipBox}>
      <Text style={styles.tooltipValue}>
        {currency} {point.value.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
      </Text>
      {!!point.date && (
        <Text style={styles.tooltipLabel}>{point.date}</Text>
      )}
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const {
    user,
    isAuthenticated,
    collection,
    portfolioRange,
    setPortfolioRange,
    refreshPrices,
    isPriceRefreshing,
    pricesLastUpdated,
    unreadNotificationCount,
  } = useApp();

  const { currency } = useSettings();
  const marketCacheScope = `${user?.id ?? 'anonymous'}:${(user?.tcgPreferences ?? []).join(',')}`;
  const [marketTab, setMarketTab] = useState<MarketTab>('trending');
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [gainers, setGainers] = useState<MarketMover[]>([]);
  const [losers, setLosers] = useState<MarketMover[]>([]);
  const [trending, setTrending] = useState<Card[]>([]);
  const [recentCards, setRecentCards] = useState<Card[]>([]);
  const [marketFeedStatus, setMarketFeedStatus] = useState<Record<'movers' | 'gainers' | 'losers' | 'trending' | 'recent', { loading: boolean; error: string | null }>>({
    movers: { loading: true, error: null },
    gainers: { loading: true, error: null },
    losers: { loading: true, error: null },
    trending: { loading: true, error: null },
    recent: { loading: true, error: null },
  });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Server-authoritative collection summary for portfolio totals
  const [serverSummary, setServerSummary] = useState<CollectionSummary | null>(null);
  const [serverPerformance, setServerPerformance] = useState<CollectionPerformance | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  const performanceRange: PerformanceRange = portfolioRange;

  useEffect(() => {
    if (!isAuthenticated) return;
    setSummaryLoading(true);
    setSummaryError(false);
    fetchCollectionSummary(currency)
      .then(setServerSummary)
      .catch(() => {
        setServerSummary(null);
        setSummaryError(true);
      })
      .finally(() => setSummaryLoading(false));
    fetchCollectionPerformance(performanceRange, currency)
      .then(setServerPerformance)
      .catch(() => setServerPerformance(null));
  }, [isAuthenticated, currency, performanceRange]);

  // Chart tooltip state
  const [activeChartPoint, setActiveChartPoint] = useState<ChartPoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    setActivityLoading(true);
    const loadFeed = <T,>(
      key: 'movers' | 'gainers' | 'losers' | 'trending' | 'recent',
      load: (onUpdate: (data: T) => void) => Promise<T>,
      setData: (data: T) => void,
    ) => {
      setMarketFeedStatus(previous => ({ ...previous, [key]: { loading: true, error: null } }));
      load(fresh => { if (!cancelled) setData(fresh); })
        .then(data => { if (!cancelled) setData(data); })
        .catch(error => {
          if (!cancelled) setMarketFeedStatus(previous => ({
            ...previous,
            [key]: { loading: false, error: error instanceof Error ? error.message : 'Market data is unavailable.' },
          }));
        })
        .finally(() => {
          if (!cancelled) setMarketFeedStatus(previous => ({
            ...previous, [key]: { ...previous[key], loading: false },
          }));
        });
    };
    loadFeed('movers', callback => getMarketMoversCached(callback, { cacheScope: marketCacheScope }), setMovers);
    loadFeed('gainers', callback => getMarketGainersCached(callback, { cacheScope: marketCacheScope }), setGainers);
    loadFeed('losers', callback => getMarketLosersCached(callback, { cacheScope: marketCacheScope }), setLosers);
    loadFeed('trending', callback => getTrendingCardsCached(callback, { cacheScope: marketCacheScope }), setTrending);
    loadFeed('recent', callback => getRecentlyAddedCardsCached(callback, { cacheScope: marketCacheScope }), setRecentCards);

    fetchRecentActivity(10)
      .then(a => { if (!cancelled) setActivity(a); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setActivityLoading(false); });

    return () => { cancelled = true; };
  }, [marketCacheScope]);

  const onRefresh = useCallback(async () => {
    await refreshPrices();
    const [moversResult, gainersResult, losersResult, trendingResult, recentResult, activityResult, summaryResult, performanceResult] =
      await Promise.allSettled([
      getMarketMovers({ cacheScope: marketCacheScope }),
       getMarketGainers({ cacheScope: marketCacheScope }),
       getMarketLosers({ cacheScope: marketCacheScope }),
      getTrendingCards({ cacheScope: marketCacheScope }),
      getRecentlyAddedCards({ cacheScope: marketCacheScope }),
      fetchRecentActivity(10),
      fetchCollectionSummary(currency),
      fetchCollectionPerformance(performanceRange, currency),
      ]);
    if (moversResult.status === 'fulfilled') setMovers(moversResult.value);
    if (gainersResult.status === 'fulfilled') setGainers(gainersResult.value);
    if (losersResult.status === 'fulfilled') setLosers(losersResult.value);
    if (trendingResult.status === 'fulfilled') setTrending(trendingResult.value);
    if (recentResult.status === 'fulfilled') setRecentCards(recentResult.value);
    if (activityResult.status === 'fulfilled') setActivity(activityResult.value);
    if (summaryResult.status === 'fulfilled') {
      setServerSummary(summaryResult.value);
      setSummaryError(false);
    } else {
      setServerSummary(null);
      setSummaryError(true);
    }
    setServerPerformance(performanceResult.status === 'fulfilled' ? performanceResult.value : null);
  }, [refreshPrices, currency, performanceRange, marketCacheScope]);

  const retryPortfolio = useCallback(() => {
    setSummaryLoading(true);
    setSummaryError(false);
    fetchCollectionSummary(currency)
      .then(setServerSummary)
      .catch(() => {
        setServerSummary(null);
        setSummaryError(true);
      })
      .finally(() => setSummaryLoading(false));
    fetchCollectionPerformance(performanceRange, currency)
      .then(setServerPerformance)
      .catch(() => setServerPerformance(null));
  }, [currency, performanceRange]);

  // ── Live event banner (real API-backed) ─────────────────────────────────────
  const [featuredEvent, setFeaturedEvent] = useState<EventSummary | null>(null);
  // Stored dismissed event id (null = not yet loaded from storage).
  const [dismissedEventId, setDismissedEventId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    // Fetch active events — only a real, returned event drives the banner.
    fetchActiveEvents()
      .then(list => {
        if (cancelled) return;
        setFeaturedEvent(list.length > 0 ? list[0] : null);
      })
      .catch(() => {
        // API failure means no banner — never fall back to fabricated data.
        if (!cancelled) setFeaturedEvent(null);
      });

    AsyncStorage.getItem(EVENT_BANNER_DISMISSED_KEY)
      .then(id => { if (!cancelled) setDismissedEventId(id); })
      .catch(() => { if (!cancelled) setDismissedEventId(null); });

    return () => { cancelled = true; };
  }, []);

  const dismissEventBanner = useCallback(() => {
    if (!featuredEvent) return;
    setDismissedEventId(featuredEvent.id);
    AsyncStorage.setItem(EVENT_BANNER_DISMISSED_KEY, featuredEvent.id).catch(() => {});
  }, [featuredEvent]);

  // Banner shows only for a real event the user hasn't dismissed.
  const showEventBanner =
    featuredEvent !== null &&
    dismissedEventId !== undefined &&
    dismissedEventId !== featuredEvent.id;

  // NativeTabs already reserves the status-bar area on iOS 26+. Applying
  // insets.top again adds an empty band above the dashboard content.
  const topPad = Platform.OS === 'web' ? 67 : supportsLiquidGlassTabs() ? 0 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const valueState = getHomePortfolioValueState(serverSummary, summaryLoading, summaryError, currency);
  const performanceView = getHomePerformanceView(serverPerformance, portfolioRange);
  const chartData = performanceView.kind === 'chart' ? performanceView.points : [];
  const displayValue = activeChartPoint?.value ?? (
    valueState.kind === 'empty' || valueState.kind === 'priced' ? valueState.value : null
  );
  const gain =
    chartData.length >= 2
      ? chartData[chartData.length - 1]!.value - chartData[0]!.value
      : null;
  const gainPct =
    gain != null && chartData[0]!.value > 0
      ? (gain / chartData[0]!.value) * 100
      : null;
  const isPositive = (gain ?? 0) >= 0;

  const oneDayGain = serverSummary?.todayMovement?.absolute ?? 0;
  const oneDayGainPct = serverSummary?.todayMovement?.percent ?? 0;
  const hasOneDayData = serverSummary?.todayMovement != null;
  const isOneDayPositive = oneDayGain >= 0;

  const topMover = serverPerformance?.topPerformers[0] ?? null;
  const staleCardCount = serverSummary?.coverage.staleHoldings ?? 0;
  const homeCollectionCards = React.useMemo(
    () => getHomeCollectionCards(collection).slice(0, 5),
    [collection],
  );

  const marketCards = getMarketFeed(marketTab, movers, trending, recentCards, gainers, losers, user?.tcgPreferences ?? []).slice(0, 8);
  const activeFeedKey = marketTab === 'trending' ? 'trending' : marketTab === 'new' ? 'recent' : marketTab;
  const activeFeedStatus = marketFeedStatus[activeFeedKey];
  const retryMarketFeed = useCallback(() => {
    setMarketFeedStatus(previous => ({ ...previous, [activeFeedKey]: { loading: true, error: null } }));
    const request = activeFeedKey === 'gainers'
      ? getMarketGainers({ cacheScope: marketCacheScope }).then(setGainers)
      : activeFeedKey === 'losers'
        ? getMarketLosers({ cacheScope: marketCacheScope }).then(setLosers)
      : activeFeedKey === 'trending'
        ? getTrendingCards({ cacheScope: marketCacheScope }).then(setTrending)
        : getRecentlyAddedCards({ cacheScope: marketCacheScope }).then(setRecentCards);
    request.catch(error => setMarketFeedStatus(previous => ({
      ...previous, [activeFeedKey]: { loading: false, error: error instanceof Error ? error.message : 'Market data is unavailable.' },
    }))).finally(() => setMarketFeedStatus(previous => ({
      ...previous, [activeFeedKey]: { ...previous[activeFeedKey], loading: false },
    })));
  }, [activeFeedKey, marketCacheScope]);

  function handleQuickAction(action: string) {
    if (action === 'scan') router.push('/scan');
    else if (action === 'add-card') router.push('/add-card');
    else router.push('/search');
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: TAB_H + 24 }]}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={isPriceRefreshing}
          onRefresh={onRefresh}
          tintColor={C.primary}
          colors={[C.primary]}
        />
      }
    >

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Logo variant="white" width={110} height={48} />
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={
              unreadNotificationCount > 0
                ? `Notifications, ${unreadNotificationCount} unread`
                : 'Notifications'
            }
            hitSlop={3}
          >
            <Feather name="bell" size={20} color={C.foreground} />
            {unreadNotificationCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            style={styles.avatar}
            onPress={() => router.push('/(tabs)/profile')}
            accessibilityRole="button"
            accessibilityLabel="View profile"
            hitSlop={3}
          >
            <Text style={styles.avatarText}>{user?.displayName?.trim().charAt(0).toUpperCase() || '?'}</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Portfolio hero ──────────────────────────────────────────────── */}
      <View style={styles.portfolioHero}>
        <View style={styles.portfolioLabelRow}>
          <Text style={styles.portfolioLabel}>PORTFOLIO VALUE</Text>
          {pricesLastUpdated && (
            <Text style={styles.lastUpdated}>
              Updated {formatLastUpdated(pricesLastUpdated)}
            </Text>
          )}
        </View>

        {/* The server owns valuations. An empty collection is the one truthful
            zero-value state; unpriced non-empty holdings remain unavailable. */}
        {displayValue !== null ? (
          <>
            <View style={styles.portfolioValueRow}>
              <Text style={styles.portfolioValue}>
                ${displayValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
              </Text>
              <Text style={styles.portfolioCurrency}>{serverSummary?.currency ?? currency}</Text>
            </View>
            {serverSummary?.unrealizedGainPercent !== null && serverSummary?.unrealizedGainPercent !== undefined && (
              <View style={styles.changeBadgeRow}>
                <View style={[
                  styles.changeBadge,
                  { backgroundColor: (serverSummary.unrealizedGainPercent >= 0 ? C.positive : C.negative) + '18' },
                ]}>
                  <Feather
                    name={serverSummary.unrealizedGainPercent >= 0 ? 'trending-up' : 'trending-down'}
                    size={11}
                    color={serverSummary.unrealizedGainPercent >= 0 ? C.positive : C.negative}
                  />
                  <Text style={[styles.changeBadgeText, { color: serverSummary.unrealizedGainPercent >= 0 ? C.positive : C.negative }]}>
                    {serverSummary.unrealizedGainPercent >= 0 ? '+' : ''}{serverSummary.unrealizedGainPercent.toFixed(2)}%
                  </Text>
                </View>
                {serverSummary.unrealizedGain !== null && serverSummary.unrealizedGain !== undefined && (
                  <Text style={styles.changePeriod}>
                    {serverSummary.unrealizedGain >= 0 ? '+' : ''}
                    {serverSummary.unrealizedGain.toLocaleString('en-AU', { minimumFractionDigits: 2 })} {serverSummary.currency ?? currency}
                  </Text>
                )}
              </View>
            )}
            {valueState.kind === 'priced' && valueState.unpricedHoldings > 0 && (
              <Text style={styles.coverageNote}>
                Subtotal · {valueState.unpricedHoldings} holding{valueState.unpricedHoldings === 1 ? '' : 's'} unpriced
              </Text>
            )}
          </>
        ) : (
          <View style={styles.portfolioUnavailableRow}>
            <Text style={[styles.portfolioValue, { fontSize: 22, color: C.mutedForeground }]}>
              {valueState.kind === 'loading' ? 'Loading…' : 'Unavailable'}
            </Text>
            {valueState.kind === 'unavailable' && (
              <Pressable
                onPress={retryPortfolio}
                accessibilityRole="button"
                accessibilityLabel="Retry loading portfolio"
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* ── Chart tooltip (shows while touching) ───────────────────────── */}
      <View style={styles.tooltipContainer}>
        <ChartTooltip point={activeChartPoint} currency={currency} />
      </View>

      {/* ── Interactive chart ───────────────────────────────────────────── */}
      <View style={styles.chartContainer}>
        {performanceView.kind === 'chart' ? (
          <InteractiveChart
            data={chartData}
            isPositive={isPositive}
            onPointSelect={setActiveChartPoint}
          />
        ) : performanceView.kind === 'initial' ? (
          <View style={styles.chartUnavailable}>
            <Feather name="minus" size={18} color={C.mutedForeground} />
            <Text style={styles.chartUnavailableText}>
              Initial snapshot recorded · {performanceView.point.value.toLocaleString('en-AU', { minimumFractionDigits: 2 })} {performanceView.point.currency}
            </Text>
          </View>
        ) : (
          <View style={styles.chartUnavailable}>
            <Feather name="bar-chart-2" size={18} color={C.mutedForeground} />
            <Text style={styles.chartUnavailableText}>
              {performanceView.message}
            </Text>
          </View>
        )}
      </View>

      {/* ── Range pills ─────────────────────────────────────────────────── */}
      <View style={styles.rangeRow}>
        {RANGES.map(r => (
          <Pressable
            key={r}
            onPress={() => { setPortfolioRange(r); setActiveChartPoint(null); }}
            accessibilityRole="button"
            accessibilityLabel={`${r} range`}
            accessibilityState={{ selected: portfolioRange === r }}
            hitSlop={{ top: 10, bottom: 10 }}
            style={[
              styles.rangeBtn,
              portfolioRange === r && styles.rangeBtnActive,
            ]}
          >
            <Text style={[
              styles.rangeText,
              { color: portfolioRange === r ? '#FFFFFF' : C.mutedForeground },
            ]}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <View style={styles.actions}>
        {QUICK_ACTIONS.map(a => (
          <Pressable
            key={a.label}
            onPress={() => handleQuickAction(a.action)}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <View style={[styles.actionIcon, { backgroundColor: C.card, borderColor: C.border }]}>
              <Feather name={a.icon as any} size={20} color={C.foreground} />
            </View>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Your Collection ───────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Collection</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/collection')}
            accessibilityRole="link"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.seeAll}>View collection →</Text>
          </Pressable>
        </View>
        {homeCollectionCards.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.collectionCarousel}
          >
            {homeCollectionCards.map(({ item, currentValue, currency: valueCurrency, gainPercent }) => (
              <Pressable
                key={item.id}
                style={[styles.collectionPreviewCard, { backgroundColor: C.card, borderColor: C.border }]}
                onPress={() => router.push(`/card/${item.cardId}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`${item.card.name}, ${item.grading ? `${item.grading.company} ${item.grading.grade}` : 'Raw'}, ${currentValue == null ? 'market value unavailable' : `${valueCurrency} ${currentValue.toFixed(2)}`}`}
              >
                <View style={[styles.collectionPreviewImage, { backgroundColor: item.card.gradientStart }]}>
                  <CardImage uri={item.card.imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
                </View>
                <Text style={styles.collectionPreviewName} numberOfLines={1}>{item.card.name}</Text>
                <Text style={styles.collectionPreviewGrade}>
                  {item.grading ? `${item.grading.company} ${item.grading.grade}` : 'Raw'}
                </Text>
                <Text style={styles.collectionPreviewValue}>
                  {currentValue == null ? 'Unavailable' : `${valueCurrency} ${currentValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}`}
                </Text>
                <Text style={[styles.collectionPreviewGain, { color: gainPercent == null ? C.mutedForeground : gainPercent >= 0 ? C.positive : C.negative }]}>
                  {gainPercent == null ? 'Gain unavailable' : `${gainPercent >= 0 ? '+' : ''}${gainPercent.toFixed(1)}%`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {serverSummary?.totalValue != null && serverSummary.totalValue > 0 ? (
          <View style={[styles.insightCard, { backgroundColor: C.card, borderColor: C.border }]}>

            {/* Row 1 — server cost basis vs current value, else 1-day change */}
            {serverSummary?.totalCost != null && serverSummary.totalValue != null ? (
              <Pressable
                style={[styles.insightRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}
                onPress={() => router.push('/collection-insights' as any)}
                accessibilityRole="button"
                accessibilityLabel={`Unrealised gain: ${serverSummary.unrealizedGainPercent != null ? ((serverSummary.unrealizedGainPercent >= 0 ? '+' : '') + serverSummary.unrealizedGainPercent.toFixed(1) + '%') : 'unavailable'}`}
              >
                <View style={[styles.insightIcon, { backgroundColor: `${(serverSummary.unrealizedGainPercent ?? 0) >= 0 ? C.positive : C.negative}18` }]}>
                  <Feather name={(serverSummary.unrealizedGainPercent ?? 0) >= 0 ? 'trending-up' : 'trending-down'} size={14} color={(serverSummary.unrealizedGainPercent ?? 0) >= 0 ? C.positive : C.negative} />
                </View>
                <View style={styles.insightBody}>
                  <Text style={styles.insightText}>Unrealised P/L</Text>
                  <Text style={styles.insightSub}>
                    Cost {currency} {serverSummary.totalCost.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                {serverSummary.unrealizedGainPercent != null ? (
                  <Text style={[styles.insightBadge, { color: (serverSummary.unrealizedGainPercent ?? 0) >= 0 ? C.positive : C.negative }]}>
                    {(serverSummary.unrealizedGainPercent ?? 0) >= 0 ? '+' : ''}{(serverSummary.unrealizedGainPercent ?? 0).toFixed(1)}%
                  </Text>
                ) : (
                  <Text style={[styles.insightBadge, { color: C.mutedForeground }]}>—</Text>
                )}
              </Pressable>
            ) : hasOneDayData && (
              <Pressable
                style={[styles.insightRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}
                onPress={() => router.push('/(tabs)/collection')}
                accessibilityRole="button"
                accessibilityLabel={`Today's portfolio change: ${isOneDayPositive ? '+' : ''}${oneDayGainPct.toFixed(2)}%`}
              >
                <View style={[styles.insightIcon, { backgroundColor: `${isOneDayPositive ? C.positive : C.negative}18` }]}>
                  <Feather name={isOneDayPositive ? 'trending-up' : 'trending-down'} size={14} color={isOneDayPositive ? C.positive : C.negative} />
                </View>
                <View style={styles.insightBody}>
                  <Text style={styles.insightText}>Today's change</Text>
                  <Text style={styles.insightSub}>
                    {isOneDayPositive ? '+' : ''}{currency} {Math.abs(oneDayGain).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <Text style={[styles.insightBadge, { color: isOneDayPositive ? C.positive : C.negative }]}>
                  {isOneDayPositive ? '+' : ''}{oneDayGainPct.toFixed(2)}%
                </Text>
              </Pressable>
            )}

            {/* Row 2 — Top price mover from collection */}
            {topMover !== null && (
              <Pressable
                style={[styles.insightRow, { borderBottomWidth: staleCardCount > 0 ? 1 : 0, borderBottomColor: C.border }]}
                onPress={() => router.push({
                  pathname: `/card/${topMover.cardId}` as any,
                })}
                accessibilityRole="button"
                accessibilityLabel={`${topMover.name} is the top portfolio performer at ${topMover.gainPercent >= 0 ? '+' : ''}${topMover.gainPercent.toFixed(1)}%`}
              >
                <View style={[styles.insightIcon, { backgroundColor: `${topMover.gainPercent >= 0 ? C.positive : C.negative}18` }]}>
                  <Feather name={topMover.gainPercent >= 0 ? 'arrow-up-right' : 'arrow-down-right'} size={14} color={topMover.gainPercent >= 0 ? C.positive : C.negative} />
                </View>
                <View style={styles.insightBody}>
                  <Text style={styles.insightText} numberOfLines={1}>
                    {topMover.name}
                  </Text>
                  <Text style={styles.insightSub} numberOfLines={1}>
                    Portfolio performer
                  </Text>
                </View>
                <Text style={[styles.insightBadge, { color: topMover.gainPercent >= 0 ? C.positive : C.negative }]}>
                  {topMover.gainPercent >= 0 ? '+' : ''}{topMover.gainPercent.toFixed(1)}%
                </Text>
              </Pressable>
            )}

            {/* Row 3 — Stale cards warning (conditional) */}
            {staleCardCount > 0 && (
              <Pressable
                style={styles.insightRow}
                onPress={() => router.push('/(tabs)/collection')}
                accessibilityRole="button"
                accessibilityLabel={`${staleCardCount} card${staleCardCount !== 1 ? 's' : ''} haven't had a sale in 30+ days`}
              >
                <View style={[styles.insightIcon, { backgroundColor: '#F59E0B18' }]}>
                  <Feather name="clock" size={14} color="#F59E0B" />
                </View>
                <View style={styles.insightBody}>
                  <Text style={styles.insightText}>
                    {staleCardCount} card{staleCardCount !== 1 ? 's' : ''} with outdated pricing
                  </Text>
                  <Text style={styles.insightSub}>Price data not updated in 30+ days</Text>
                </View>
                <Feather name="chevron-right" size={14} color={C.mutedForeground} />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={[styles.insightEmpty, { backgroundColor: C.card, borderColor: C.border }]}>
            <Feather name="layers" size={28} color={C.mutedForeground} />
            <Text style={styles.insightEmptyTitle}>Start tracking your collection</Text>
            <Text style={styles.insightEmptySub}>
              Scan a card to see price movements, portfolio growth, and personalised insights here.
            </Text>
            <Pressable
              style={[styles.insightEmptyBtn, { backgroundColor: C.primary }]}
              onPress={() => router.push('/scan')}
              accessibilityRole="button"
              accessibilityLabel="Scan your first card"
            >
              <Feather name="camera" size={14} color="#FFF" />
              <Text style={styles.insightEmptyBtnText}>Scan a Card</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ── Market ────────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Market</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/market')}
            accessibilityRole="link"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.seeAll}>View Market →</Text>
          </Pressable>
        </View>

        {/* Tab pills */}
        <View style={styles.marketTabRow}>
          {MARKET_TABS.map(t => (
            <Pressable
              key={t.id}
              onPress={() => setMarketTab(t.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: marketTab === t.id }}
              style={[styles.marketTabBtn, marketTab === t.id && styles.marketTabBtnActive]}
            >
              <Text style={[styles.marketTabText, { color: marketTab === t.id ? '#FFFFFF' : C.mutedForeground }]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Card carousel */}
        {activeFeedStatus.loading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
        ) : activeFeedStatus.error ? (
          <View style={styles.marketFeedMessage}>
            <Text style={styles.emptySection}>Market data is unavailable.</Text>
            <Pressable onPress={retryMarketFeed} accessibilityRole="button">
              <Text style={styles.marketRetry}>Try again</Text>
            </Pressable>
          </View>
        ) : marketCards.length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {marketCards.map(({ card, price, currency: cardCurrency, change }) => (
              <Pressable
                key={card.id}
                style={{ gap: 8, width: 110 }}
                onPress={() => router.push({ pathname: `/card/${card.id}` as any, params: { appCardJson: JSON.stringify(card) } })}
                accessibilityRole="button"
                accessibilityLabel={`${card.name} from ${card.setName}`}
              >
                <CardThumbnail card={card} compact />
                <View>
                  <Text style={styles.moverName} numberOfLines={1}>{card.name}</Text>
                  <Text style={styles.moverSet} numberOfLines={1}>{card.setName}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                   <Text style={styles.moverPrice}>{price == null ? 'Price unavailable' : `${cardCurrency} ${price.toLocaleString('en-AU')}`}</Text>
                    {change !== undefined && (
                      <Text style={[styles.moverChange, { color: change >= 0 ? C.positive : C.negative }]}>
                        {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Live Event Banner (real API-backed) ──────────────────────────── */}
      {showEventBanner && featuredEvent && (
        <View style={styles.eventBanner}>
          <View style={styles.eventBannerAccent} />
          <View style={styles.eventBannerInner}>
            <View style={styles.eventBannerTop}>
              <View style={styles.eventLivePill}>
                {featuredEvent.status === 'live' && <View style={styles.eventLiveDot} />}
                <Text style={styles.eventLiveText}>
                  {featuredEvent.status === 'live' ? 'LIVE EVENT' : 'UPCOMING EVENT'}
                </Text>
              </View>
              <Pressable
                onPress={e => { e.stopPropagation(); dismissEventBanner(); }}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={styles.dismissBtn}
                accessibilityRole="button"
                accessibilityLabel="Dismiss event banner"
              >
                <Feather name="x" size={14} color={C.mutedForeground} />
              </Pressable>
            </View>
            <Text style={styles.eventBannerName}>{featuredEvent.name}</Text>
            <Text style={styles.eventBannerVenue}>{featuredEvent.venue} · {featuredEvent.eventDate}</Text>
            <View style={styles.eventStatRow}>
              <View style={styles.eventStat}>
                <Text style={styles.eventStatValue}>{featuredEvent.participantCount}</Text>
                <Text style={styles.eventStatLabel}>Collectors{'\n'}Registered</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => router.push('/event-mode' as any)}
                style={styles.enterEventBtn}
                accessibilityRole="button"
                accessibilityLabel={`${featuredEvent.status === 'live' ? 'Live' : 'Upcoming'} event: ${featuredEvent.name} at ${featuredEvent.venue}. Tap to enter.`}
              >
                <Feather name="zap" size={14} color="#FFF" />
                <Text style={styles.enterEventBtnText}>Enter</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* ── Recently Added ───────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Added</Text>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="link"
            accessibilityLabel="Browse all recently added cards"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.seeAll}>Browse all</Text>
          </Pressable>
        </View>
        {marketFeedStatus.recent.loading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
        ) : marketFeedStatus.recent.error ? (
          <View style={styles.marketFeedMessage}>
            <Text style={styles.emptySection}>Recently added cards are unavailable.</Text>
            <Pressable onPress={() => {
              setMarketFeedStatus(previous => ({ ...previous, recent: { loading: true, error: null } }));
              getRecentlyAddedCards({ cacheScope: marketCacheScope }).then(setRecentCards).catch(error => setMarketFeedStatus(previous => ({
                ...previous, recent: { loading: false, error: error instanceof Error ? error.message : 'Market data is unavailable.' },
              }))).finally(() => setMarketFeedStatus(previous => ({ ...previous, recent: { ...previous.recent, loading: false } })));
            }} accessibilityRole="button"><Text style={styles.marketRetry}>Try again</Text></Pressable>
          </View>
        ) : recentCards.length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {recentCards.map(card => (
              <Pressable
                key={card.id}
                style={{ gap: 8, width: 110 }}
                onPress={() => router.push({ pathname: `/card/${card.id}` as any, params: { appCardJson: JSON.stringify(card) } })}
                accessibilityRole="button"
                accessibilityLabel={`${card.name} from ${card.setName}`}
              >
                <CardThumbnail card={card} compact />
                <View>
                  <Text style={styles.moverName} numberOfLines={1}>{card.name}</Text>
                  <Text style={styles.moverSet} numberOfLines={1}>{card.setName}</Text>
                  <Text style={styles.moverPrice}>{card.price.raw > 0 ? `${card.price.currency} ${card.price.raw.toLocaleString('en-AU')}` : 'Price unavailable'}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>


    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#FFFFFF', lineHeight: 12 },
  avatar: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  // Portfolio hero
  portfolioHero: { marginBottom: 4 },
  portfolioLabelRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 6,
  },
  portfolioLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, letterSpacing: 1.5,
  },
  lastUpdated: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, opacity: 0.7 },
  portfolioValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  portfolioValue: {
    fontSize: 36, fontFamily: 'Inter_700Bold',
    color: C.foreground, letterSpacing: -1,
  },
  portfolioCurrency: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  portfolioUnavailableRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  retryButton: {
    borderWidth: 1, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  retryButtonText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  coverageNote: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 8 },
  changeBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  changeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8,
  },
  changeBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  changePeriod: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Tooltip
  tooltipContainer: { height: 42, justifyContent: 'flex-end', paddingBottom: 4 },
  tooltipBox: {
    alignSelf: 'center',
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
  },
  tooltipValue: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: -0.3 },
  tooltipLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },

  // Chart
  chartContainer: { marginHorizontal: -20, marginBottom: 4 },
  chartUnavailable: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  chartUnavailableText: {
    color: C.mutedForeground,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },

  // Range pills
  rangeRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 4, marginBottom: 20,
  },
  rangeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  rangeBtnActive: { backgroundColor: C.primary },
  rangeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Divider
  divider: { height: 1, backgroundColor: C.border, marginBottom: 20 },

  // Market tabs
  marketTabRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  marketTabBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card,
  },
  marketTabBtnActive: { backgroundColor: '#CC1826', borderColor: '#CC1826' },
  marketTabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Insight card
  insightCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  insightRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  insightIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  insightBody: { flex: 1, minWidth: 0 },
  insightText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground, letterSpacing: -0.2 },
  insightSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  insightBadge: { fontSize: 13, fontFamily: 'Inter_700Bold', flexShrink: 0 },
  insightEmpty: {
    borderRadius: 16, borderWidth: 1, padding: 24,
    alignItems: 'center', gap: 10,
  },
  insightEmptyTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  insightEmptySub: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground,
    textAlign: 'center', lineHeight: 18,
  },
  insightEmptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 4,
  },
  insightEmptyBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Home collection preview
  collectionCarousel: { gap: 12, paddingRight: 4, marginBottom: 14 },
  collectionPreviewCard: {
    width: 132, borderWidth: 1, borderRadius: 12, padding: 8, gap: 4,
  },
  collectionPreviewImage: { height: 126, borderRadius: 8, overflow: 'hidden', marginBottom: 3 },
  collectionPreviewName: { color: C.foreground, fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  collectionPreviewGrade: { color: C.mutedForeground, fontSize: 10, fontFamily: 'Inter_400Regular' },
  collectionPreviewValue: { color: C.foreground, fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  collectionPreviewGain: { fontSize: 11, fontFamily: 'Inter_700Bold' },

  // Quick actions
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  action: { alignItems: 'center', gap: 8, flex: 1 },
  actionIcon: {
    width: 54, height: 54, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  actionLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },

  // Event banner
  eventBanner: {
    borderRadius: 16, marginBottom: 20, overflow: 'hidden',
    backgroundColor: C.card, borderWidth: 1, borderColor: `${C.primary}44`,
    flexDirection: 'row',
  },
  eventBannerAccent: { width: 4, backgroundColor: C.primary },
  eventBannerInner: { flex: 1, padding: 14, gap: 6 },
  eventBannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventLivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: `${C.primary}22`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  eventLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.positive },
  eventLiveText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 1 },
  dismissBtn: { padding: 2 },
  eventBannerName: { fontSize: 17, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  eventBannerVenue: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 4 },
  eventStatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  eventStat: { alignItems: 'center', gap: 2 },
  eventStatValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground, lineHeight: 22 },
  eventStatLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 12 },
  eventStatDivider: { width: 1, height: 28, backgroundColor: C.border },
  enterEventBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#CC1826', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
  },
  enterEventBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // Trade matches
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  matchCountPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  matchCountText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  tradeMatchCard: { width: 170, borderRadius: 14, padding: 12, gap: 10 },
  tradeMatchPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  tradeMatchDot: { width: 5, height: 5, borderRadius: 3 },
  tradeMatchPct: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  tradeMatchCards: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  tradeMatchSide: { flex: 1, alignItems: 'center', gap: 4 },
  tradeMatchThumb: {
    width: 48, height: 66, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  tradeMatchLabel: { fontSize: 8, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 0.8 },
  tradeMatchCardName: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  tradeMatchGrade: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  tradeMatchSwap: { alignItems: 'center', justifyContent: 'center', paddingTop: 24 },
  tradeMatchCollector: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderTopWidth: 1, paddingTop: 8,
  },
  tradeMatchAvatar: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tradeMatchAvatarText: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#FFF' },
  tradeMatchUsername: { flex: 1, fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  tradeMatchViewAll: {
    width: 90, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12,
  },
  tradeMatchViewAllText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textAlign: 'center', lineHeight: 15 },

  // Sections (new arrivals / trending)
  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  seeAll: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  emptySection: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, paddingVertical: 8 },
  moverName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground, width: 110 },
  moverSet: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2, width: 110 },
  moverPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  moverChange: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  marketFeedMessage: { gap: 8, paddingVertical: 12 },
  marketRetry: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
