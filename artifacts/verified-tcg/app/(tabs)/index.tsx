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
  getTrendingCards,
  getRecentlyAddedCards,
  getMarketMoversCached,
  getTrendingCardsCached,
  getRecentlyAddedCardsCached,
} from '@/services/market';
import { MOCK_EVENT, MOCK_TRADE_MATCHES } from '@/services/matching';
import { fetchRecentActivity, type ActivityItem } from '@/services/activityApi';
import {
  fetchCollectionSummary,
  fetchCollectionPerformance,
  type CollectionSummary,
  type CollectionPerformance,
  type PerformanceRange,
} from '@/services/collectionPerformance';
import { CardImage } from '@/components/ui/CardImage';
import { useSettings } from '@/context/SettingsContext';
import colors from '@/constants/colors';
import type { Card, MarketMover, PortfolioRange } from '@/types';

const EVENT_BANNER_DISMISSED_KEY = '@verified_tcg/event_banner_dismissed_event_id';
const TRADE_MATCHES_DISMISSED_KEY = '@verified_tcg/trade_matches_dismissed_count';

const C = colors.dark;
const RANGES: PortfolioRange[] = ['1D', '7D', '1M', '3M', '1Y', 'ALL'];

type MarketTab = 'trending' | 'gainers' | 'losers' | 'new';
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

function matchColor(pct: number) {
  if (pct >= 90) return '#22C55E';
  if (pct >= 75) return '#F59E0B';
  return '#888888';
}

// ── Interactive SVG Chart ──────────────────────────────────────────────────────

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
    portfolio,
    portfolioRange,
    setPortfolioRange,
    refreshPrices,
    isPriceRefreshing,
    pricesLastUpdated,
    unreadNotificationCount,
  } = useApp();

  const { currency } = useSettings();
  const [marketTab, setMarketTab] = useState<MarketTab>('trending');
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [trending, setTrending] = useState<Card[]>([]);
  const [recentCards, setRecentCards] = useState<Card[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Server-authoritative collection summary for portfolio totals
  const [serverSummary, setServerSummary] = useState<CollectionSummary | null>(null);
  const [serverPerformance, setServerPerformance] = useState<CollectionPerformance | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const performanceRange: PerformanceRange =
    portfolioRange === '3M' || portfolioRange === '1Y' || portfolioRange === 'ALL'
      ? portfolioRange
      : '1M';

  useEffect(() => {
    if (!isAuthenticated) return;
    setSummaryLoading(true);
    Promise.all([
      fetchCollectionSummary(currency),
      fetchCollectionPerformance(performanceRange, currency),
    ])
      .then(([summary, performance]) => {
        setServerSummary(summary);
        setServerPerformance(performance);
      })
      .catch(() => setServerSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [isAuthenticated, currency, performanceRange]);

  // Chart tooltip state
  const [activeChartPoint, setActiveChartPoint] = useState<ChartPoint | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSectionsLoading(true);
    setActivityLoading(true);

    Promise.all([
      getMarketMoversCached(fresh => { if (!cancelled) setMovers(fresh); }),
      getTrendingCardsCached(fresh => { if (!cancelled) setTrending(fresh); }),
      getRecentlyAddedCardsCached(fresh => { if (!cancelled) setRecentCards(fresh); }),
    ])
      .then(([m, t, r]) => {
        if (cancelled) return;
        setMovers(m); setTrending(t); setRecentCards(r);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSectionsLoading(false); });

    fetchRecentActivity(10)
      .then(a => { if (!cancelled) setActivity(a); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setActivityLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const onRefresh = useCallback(async () => {
    await refreshPrices();
    Promise.all([
      getMarketMovers(),
      getTrendingCards(),
      getRecentlyAddedCards(),
      fetchRecentActivity(10),
      fetchCollectionSummary(currency),
      fetchCollectionPerformance(performanceRange, currency),
    ])
      .then(([m, t, r, a, summary, performance]) => {
        setMovers(m);
        setTrending(t);
        setRecentCards(r);
        setActivity(a);
        setServerSummary(summary);
        setServerPerformance(performance);
      })
      .catch(() => {});
  }, [refreshPrices, currency, performanceRange]);

  const [eventBannerDismissed, setEventBannerDismissed] = useState<boolean | null>(null);
  const [tradeMatchesDismissed, setTradeMatchesDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    async function loadDismissed() {
      try {
        const [dismissedEventId, dismissedMatchCount] = await Promise.all([
          AsyncStorage.getItem(EVENT_BANNER_DISMISSED_KEY),
          AsyncStorage.getItem(TRADE_MATCHES_DISMISSED_KEY),
        ]);
        setEventBannerDismissed(dismissedEventId === MOCK_EVENT.id);
        if (dismissedMatchCount !== null) {
          const storedCount = parseInt(dismissedMatchCount, 10);
          setTradeMatchesDismissed(!isNaN(storedCount) && MOCK_TRADE_MATCHES.length <= storedCount);
        } else {
          setTradeMatchesDismissed(false);
        }
      } catch {
        setEventBannerDismissed(false);
        setTradeMatchesDismissed(false);
      }
    }
    loadDismissed();
  }, []);

  const dismissEventBanner = useCallback(() => {
    setEventBannerDismissed(true);
    AsyncStorage.setItem(EVENT_BANNER_DISMISSED_KEY, MOCK_EVENT.id).catch(() => {});
  }, []);

  const dismissTradeMatches = useCallback(() => {
    setTradeMatchesDismissed(true);
    AsyncStorage.setItem(TRADE_MATCHES_DISMISSED_KEY, String(MOCK_TRADE_MATCHES.length)).catch(() => {});
  }, []);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const chartData = React.useMemo(() => {
    const points = serverPerformance?.points ?? [];
    const days = portfolioRange === '1D' ? 1 : portfolioRange === '7D' ? 7 : null;
    if (days == null) return points;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return points.filter(point => new Date(point.date).getTime() >= cutoff);
  }, [serverPerformance, portfolioRange]);
  const displayValue = activeChartPoint?.value ?? serverSummary?.totalValue ?? null;
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

  // Derive gainers and losers from movers data
  const gainers = movers.filter(m => m.trend === 'up').sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 8);
  const losers = movers.filter(m => m.trend === 'down').sort((a, b) => a.priceChangePercent - b.priceChangePercent).slice(0, 8);

  const marketCards: { card: Card; price: number; change: number | undefined }[] = (() => {
    if (marketTab === 'gainers') return gainers.map(m => ({ card: m.card, price: m.currentPrice, change: m.priceChangePercent }));
    if (marketTab === 'losers') return losers.map(m => ({ card: m.card, price: m.currentPrice, change: m.priceChangePercent }));
    if (marketTab === 'new') return recentCards.map(c => ({ card: c, price: c.price.raw, change: c.price.change7d }));
    return trending.map(c => ({ card: c, price: c.price.raw, change: c.price.change7d }));
  })();

  const previewMatches = MOCK_TRADE_MATCHES.slice(0, 2);

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
            <Text style={styles.avatarText}>{user?.displayName?.[0] ?? 'U'}</Text>
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

        {/* Prefer server-authoritative value; fall back to local with "Unavailable" */}
        {serverSummary?.totalValue !== null && serverSummary?.totalValue !== undefined ? (
          <>
            <View style={styles.portfolioValueRow}>
              <Text style={styles.portfolioValue}>
                {serverSummary.totalValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
              </Text>
              <Text style={styles.portfolioCurrency}>{serverSummary.currency ?? currency}</Text>
            </View>
            {serverSummary.unrealizedGainPercent !== null && serverSummary.unrealizedGainPercent !== undefined && (
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
          </>
        ) : (
          <View style={styles.portfolioValueRow}>
            <Text style={[styles.portfolioValue, { fontSize: 22, color: C.mutedForeground }]}>
              Unavailable
            </Text>
          </View>
        )}
      </View>

      {/* ── Chart tooltip (shows while touching) ───────────────────────── */}
      <View style={styles.tooltipContainer}>
        <ChartTooltip point={activeChartPoint} currency={currency} />
      </View>

      {/* ── Interactive chart ───────────────────────────────────────────── */}
      <View style={styles.chartContainer}>
        {chartData.length >= 2 ? (
          <InteractiveChart
            data={chartData}
            isPositive={isPositive}
            onPointSelect={setActiveChartPoint}
          />
        ) : (
          <View style={styles.chartUnavailable}>
            <Feather name="bar-chart-2" size={18} color={C.mutedForeground} />
            <Text style={styles.chartUnavailableText}>
              {portfolioRange === '1D' || portfolioRange === '7D'
                ? `Not enough retained history for ${portfolioRange}`
                : serverPerformance?.historyUnavailableReason ?? 'Price history is not available yet'}
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
        {sectionsLoading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
        ) : marketCards.length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {marketCards.map(({ card, price, change }) => (
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
                    <Text style={styles.moverPrice}>${price.toLocaleString('en-AU')}</Text>
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

      {/* ── Live Event Banner ────────────────────────────────────────────── */}
      {MOCK_EVENT.isActive && eventBannerDismissed === false && (
        <Pressable
          onPress={() => router.push('/event-mode' as any)}
          style={styles.eventBanner}
          accessibilityRole="button"
          accessibilityLabel={`Live event: ${MOCK_EVENT.name} at ${MOCK_EVENT.venue}. Tap to enter.`}
        >
          <View style={styles.eventBannerAccent} />
          <View style={styles.eventBannerInner}>
            <View style={styles.eventBannerTop}>
              <View style={styles.eventLivePill}>
                <View style={styles.eventLiveDot} />
                <Text style={styles.eventLiveText}>LIVE EVENT</Text>
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
            <Text style={styles.eventBannerName}>{MOCK_EVENT.name}</Text>
            <Text style={styles.eventBannerVenue}>{MOCK_EVENT.venue} · {MOCK_EVENT.dates}</Text>
            <View style={styles.eventStatRow}>
              <View style={styles.eventStat}>
                <Text style={styles.eventStatValue}>{MOCK_EVENT.stats.tradeMatches}</Text>
                <Text style={styles.eventStatLabel}>Trade{'\n'}Matches</Text>
              </View>
              <View style={styles.eventStatDivider} />
              <View style={styles.eventStat}>
                <Text style={styles.eventStatValue}>{MOCK_EVENT.stats.wishlistForSale}</Text>
                <Text style={styles.eventStatLabel}>Wishlist{'\n'}For Sale</Text>
              </View>
              <View style={styles.eventStatDivider} />
              <View style={styles.eventStat}>
                <Text style={styles.eventStatValue}>{MOCK_EVENT.collectorsPresent}</Text>
                <Text style={styles.eventStatLabel}>Collectors{'\n'}Present</Text>
              </View>
              <View style={{ flex: 1 }} />
              <View style={styles.enterEventBtn}>
                <Feather name="zap" size={14} color="#FFF" />
                <Text style={styles.enterEventBtnText}>Enter</Text>
              </View>
            </View>
          </View>
        </Pressable>
      )}

      {/* ── Trade Matches Strip ──────────────────────────────────────────── */}
      {tradeMatchesDismissed === false && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Trade Matches</Text>
              <View style={[styles.matchCountPill, { backgroundColor: `${C.primary}22` }]}>
                <Text style={[styles.matchCountText, { color: C.primary }]}>
                  {MOCK_TRADE_MATCHES.length}
                </Text>
              </View>
            </View>
            <View style={styles.sectionHeaderRight}>
              <Pressable
                onPress={() => router.push('/trade-match' as any)}
                accessibilityRole="link"
                accessibilityLabel="See all trade matches"
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
              <Pressable
                onPress={dismissTradeMatches}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={{ marginLeft: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Dismiss trade matches"
              >
                <Feather name="x" size={14} color={C.mutedForeground} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 4 }}
          >
            {previewMatches.map(match => (
              <Pressable
                key={match.id}
                onPress={() => router.push('/trade-match' as any)}
                style={[styles.tradeMatchCard, { backgroundColor: C.card }]}
                accessibilityRole="button"
                accessibilityLabel={`Trade match with @${match.collector.username}, ${match.matchPercent}% match`}
              >
                <View style={[styles.tradeMatchPill, { backgroundColor: matchColor(match.matchPercent) + '22' }]}>
                  <View style={[styles.tradeMatchDot, { backgroundColor: matchColor(match.matchPercent) }]} />
                  <Text style={[styles.tradeMatchPct, { color: matchColor(match.matchPercent) }]}>
                    {match.matchPercent}%
                  </Text>
                </View>
                <View style={styles.tradeMatchCards}>
                  <View style={styles.tradeMatchSide}>
                    <View style={[styles.tradeMatchThumb, { backgroundColor: match.youWant.color, overflow: 'hidden' }]}>
                      {match.youWant.imageUrl
                        ? <CardImage uri={match.youWant.imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
                        : <Feather name="credit-card" size={20} color="rgba(255,255,255,0.7)" />}
                    </View>
                    <Text style={styles.tradeMatchLabel}>YOU WANT</Text>
                    <Text style={styles.tradeMatchCardName} numberOfLines={2}>{match.youWant.name}</Text>
                    <Text style={styles.tradeMatchGrade}>{match.youWant.grade}</Text>
                  </View>
                  <View style={styles.tradeMatchSwap}>
                    <Feather name="repeat" size={14} color={C.mutedForeground} />
                  </View>
                  <View style={styles.tradeMatchSide}>
                    <View style={[styles.tradeMatchThumb, { backgroundColor: match.theyWant.color, overflow: 'hidden' }]}>
                      {match.theyWant.imageUrl
                        ? <CardImage uri={match.theyWant.imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
                        : <Feather name="credit-card" size={20} color="rgba(255,255,255,0.7)" />}
                    </View>
                    <Text style={styles.tradeMatchLabel}>THEY WANT</Text>
                    <Text style={styles.tradeMatchCardName} numberOfLines={2}>{match.theyWant.name}</Text>
                    <Text style={styles.tradeMatchGrade}>{match.theyWant.grade}</Text>
                  </View>
                </View>
                <View style={[styles.tradeMatchCollector, { borderTopColor: C.border }]}>
                  <View style={[styles.tradeMatchAvatar, { backgroundColor: match.collector.avatarColor }]}>
                    <Text style={styles.tradeMatchAvatarText}>{match.collector.initials}</Text>
                  </View>
                  <Text style={styles.tradeMatchUsername} numberOfLines={1}>@{match.collector.username}</Text>
                  {match.collector.isVerified && (
                    <Feather name="check-circle" size={11} color={C.positive} />
                  )}
                </View>
              </Pressable>
            ))}
            <Pressable
              onPress={() => router.push('/trade-match' as any)}
              style={[styles.tradeMatchViewAll, { backgroundColor: C.card, borderColor: C.border }]}
              accessibilityRole="button"
              accessibilityLabel={`View all trade matches, ${MOCK_TRADE_MATCHES.length - 2} more`}
            >
              <Feather name="arrow-right" size={20} color={C.primary} />
              <Text style={[styles.tradeMatchViewAllText, { color: C.primary }]}>
                View all{'\n'}{MOCK_TRADE_MATCHES.length - 2} more
              </Text>
            </Pressable>
          </ScrollView>
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
        {sectionsLoading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
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
                  <Text style={styles.moverPrice}>${card.price.raw.toLocaleString('en-AU')}</Text>
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
});
