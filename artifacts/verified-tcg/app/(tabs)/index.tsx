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
import { isLiquidGlassAvailable } from 'expo-glass-effect';
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
import { CardImage } from '@/components/ui/CardImage';
import colors from '@/constants/colors';
import type { Card, MarketMover, PortfolioRange } from '@/types';

const EVENT_BANNER_DISMISSED_KEY = '@verified_tcg/event_banner_dismissed_event_id';
const TRADE_MATCHES_DISMISSED_KEY = '@verified_tcg/trade_matches_dismissed_count';

const C = colors.dark;
const RANGES: PortfolioRange[] = ['1D', '7D', '1M', '3M', '1Y', 'ALL'];

type TcgFilter = 'all' | 'pokemon' | 'onepiece' | 'magic';
const TCG_FILTERS: { id: TcgFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pokemon', label: 'Pokémon' },
  { id: 'onepiece', label: 'One Piece' },
  { id: 'magic', label: 'MTG' },
];

const QUICK_ACTIONS: { icon: string; label: string; action: string }[] = [
  { icon: 'camera', label: 'Scan', action: 'scan' },
  { icon: 'plus-circle', label: 'Add Card', action: 'add-card' },
  { icon: 'dollar-sign', label: 'Prices', action: 'search' },
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
function ChartTooltip({ point }: { point: ChartPoint | null }) {
  if (!point) return null;
  return (
    <View style={styles.tooltipBox}>
      <Text style={styles.tooltipValue}>
        ${point.value.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
      </Text>
      {!!point.date && (
        <Text style={styles.tooltipLabel}>{point.date}</Text>
      )}
    </View>
  );
}

// ── Market row (gainers / losers / market movers list) ─────────────────────────
function MarketRow({
  card,
  currentPrice,
  priceChangePercent,
  positive,
}: {
  card: Card;
  currentPrice: number;
  priceChangePercent: number;
  positive: boolean;
}) {
  return (
    <Pressable
      style={styles.marketRow}
      onPress={() =>
        router.push({
          pathname: `/card/${card.id}` as any,
          params: { appCardJson: JSON.stringify(card) },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`${card.name}, ${positive ? '+' : ''}${priceChangePercent.toFixed(1)}%`}
    >
      <View style={[styles.marketRowIcon, { backgroundColor: positive ? `${C.positive}18` : `${C.negative}18` }]}>
        <Feather
          name={positive ? 'trending-up' : 'trending-down'}
          size={14}
          color={positive ? C.positive : C.negative}
        />
      </View>
      <View style={styles.marketRowInfo}>
        <Text style={styles.marketRowName} numberOfLines={1}>{card.name}</Text>
        <Text style={styles.marketRowSet} numberOfLines={1}>{card.setName}</Text>
      </View>
      <View style={styles.marketRowRight}>
        <Text style={styles.marketRowPrice}>
          ${currentPrice.toLocaleString('en-AU')}
        </Text>
        <Text style={[styles.marketRowChange, { color: positive ? C.positive : C.negative }]}>
          {positive ? '+' : ''}{priceChangePercent.toFixed(1)}%
        </Text>
      </View>
    </Pressable>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const {
    user,
    isAuthenticated,
    portfolio,
    portfolioRange,
    setPortfolioRange,
    refreshPrices,
    isPriceRefreshing,
    pricesLastUpdated,
    unreadNotificationCount,
  } = useApp();

  const [tcgFilter, setTcgFilter] = useState<TcgFilter>('all');
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [trending, setTrending] = useState<Card[]>([]);
  const [recentCards, setRecentCards] = useState<Card[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

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
    Promise.all([getMarketMovers(), getTrendingCards(), getRecentlyAddedCards(), fetchRecentActivity(10)])
      .then(([m, t, r, a]) => { setMovers(m); setTrending(t); setRecentCards(r); setActivity(a); })
      .catch(() => {});
  }, [refreshPrices]);

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

  const chartData = portfolio.chartData[portfolioRange];
  const displayValue = activeChartPoint?.value ?? portfolio.totalValue;
  const gain = displayValue - (chartData[0]?.value ?? displayValue);
  const gainPct = chartData[0]?.value ? (gain / chartData[0].value) * 100 : portfolio.totalGainPercent;
  const isPositive = gain >= 0;

  // Derive gainers and losers from movers data
  const filteredMovers = movers.filter(m => tcgFilter === 'all' || m.card.tcg === tcgFilter);
  const gainers = filteredMovers.filter(m => m.trend === 'up').sort((a, b) => b.priceChangePercent - a.priceChangePercent).slice(0, 4);
  const losers = filteredMovers.filter(m => m.trend === 'down').sort((a, b) => a.priceChangePercent - b.priceChangePercent).slice(0, 4);

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

        <View style={styles.portfolioValueRow}>
          <Text style={styles.portfolioValue}>
            ${displayValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
          </Text>
          <Text style={styles.portfolioCurrency}>AUD</Text>
        </View>

        <View style={styles.changeBadgeRow}>
          <View style={[
            styles.changeBadge,
            { backgroundColor: isPositive ? `${C.positive}18` : `${C.negative}18` },
          ]}>
            <Feather
              name={isPositive ? 'trending-up' : 'trending-down'}
              size={11}
              color={isPositive ? C.positive : C.negative}
            />
            <Text style={[styles.changeBadgeText, { color: isPositive ? C.positive : C.negative }]}>
              {isPositive ? '+' : ''}{gainPct.toFixed(2)}%
            </Text>
          </View>
          <Text style={styles.changePeriod}>
            {isPositive ? '+' : ''}${Math.abs(gain).toLocaleString('en-AU', { minimumFractionDigits: 2 })} this period
          </Text>
        </View>
      </View>

      {/* ── Chart tooltip (shows while touching) ───────────────────────── */}
      <View style={styles.tooltipContainer}>
        <ChartTooltip point={activeChartPoint} />
      </View>

      {/* ── Interactive chart ───────────────────────────────────────────── */}
      <View style={styles.chartContainer}>
        <InteractiveChart
          data={chartData}
          isPositive={isPositive}
          onPointSelect={setActiveChartPoint}
        />
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

      {/* ── TCG Filter Pills ─────────────────────────────────────────────  */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tcgFilterRow}
        style={{ marginBottom: 16 }}
      >
        {TCG_FILTERS.map(f => (
          <Pressable
            key={f.id}
            onPress={() => setTcgFilter(f.id)}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${f.label}`}
            accessibilityState={{ selected: tcgFilter === f.id }}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[
              styles.tcgFilterPill,
              tcgFilter === f.id && styles.tcgFilterPillActive,
            ]}
          >
            <Text style={[
              styles.tcgFilterPillText,
              { color: tcgFilter === f.id ? '#FFFFFF' : C.mutedForeground },
            ]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Gainers & Losers ─────────────────────────────────────────────── */}
      <View style={styles.glRow}>

        {/* Gainers */}
        <View style={[styles.glCard, { borderColor: C.border }]}>
          <View style={styles.glHeader}>
            <View style={[styles.glDot, { backgroundColor: C.positive }]} />
            <Text style={[styles.glTitle, { color: C.positive }]}>GAINERS</Text>
          </View>
          {sectionsLoading ? (
            <View style={{ gap: 10, padding: 12 }}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={styles.glSkeletonRow}>
                  <View style={styles.glSkeletonIcon} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={[styles.glSkeletonLine, { width: '80%' }]} />
                    <View style={[styles.glSkeletonLine, { width: '50%' }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : gainers.length === 0 ? (
            <Text style={styles.glEmpty}>No data</Text>
          ) : (
            <View style={styles.glList}>
              {gainers.map((m, i) => (
                <Pressable
                  key={m.card.id}
                  style={[styles.glRow2, i < gainers.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                  onPress={() => router.push({ pathname: `/card/${m.card.id}` as any, params: { appCardJson: JSON.stringify(m.card) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.card.name}, +${m.priceChangePercent.toFixed(1)}%`}
                >
                  <View style={[styles.glIconBox, { backgroundColor: `${C.positive}14` }]}>
                    <Feather name="trending-up" size={12} color={C.positive} />
                  </View>
                  <View style={styles.glInfo}>
                    <Text style={styles.glName} numberOfLines={1}>{m.card.name}</Text>
                    <Text style={[styles.glChange, { color: C.positive }]}>+{m.priceChangePercent.toFixed(1)}%</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Losers */}
        <View style={[styles.glCard, { borderColor: C.border }]}>
          <View style={styles.glHeader}>
            <View style={[styles.glDot, { backgroundColor: C.negative }]} />
            <Text style={[styles.glTitle, { color: C.negative }]}>LOSERS</Text>
          </View>
          {sectionsLoading ? (
            <View style={{ gap: 10, padding: 12 }}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={styles.glSkeletonRow}>
                  <View style={styles.glSkeletonIcon} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={[styles.glSkeletonLine, { width: '80%' }]} />
                    <View style={[styles.glSkeletonLine, { width: '50%' }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : losers.length === 0 ? (
            <Text style={styles.glEmpty}>No data</Text>
          ) : (
            <View style={styles.glList}>
              {losers.map((m, i) => (
                <Pressable
                  key={m.card.id}
                  style={[styles.glRow2, i < losers.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                  onPress={() => router.push({ pathname: `/card/${m.card.id}` as any, params: { appCardJson: JSON.stringify(m.card) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.card.name}, ${m.priceChangePercent.toFixed(1)}%`}
                >
                  <View style={[styles.glIconBox, { backgroundColor: `${C.negative}14` }]}>
                    <Feather name="trending-down" size={12} color={C.negative} />
                  </View>
                  <View style={styles.glInfo}>
                    <Text style={styles.glName} numberOfLines={1}>{m.card.name}</Text>
                    <Text style={[styles.glChange, { color: C.negative }]}>{m.priceChangePercent.toFixed(1)}%</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* ── Market Movers list ───────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Market Movers</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/market')}
            accessibilityRole="link"
            accessibilityLabel="See all market movers"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {sectionsLoading ? (
          <View style={{ gap: 2 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </View>
        ) : filteredMovers.length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <View style={[styles.marketListCard, { backgroundColor: C.card, borderColor: C.border }]}>
            {filteredMovers.slice(0, 6).map((m, i) => (
              <View key={m.card.id} style={i < Math.min(filteredMovers.length, 6) - 1 ? { borderBottomWidth: 1, borderBottomColor: C.border } : {}}>
                <MarketRow
                  card={m.card}
                  currentPrice={m.currentPrice}
                  priceChangePercent={m.priceChangePercent}
                  positive={m.trend === 'up'}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Quick Actions ────────────────────────────────────────────────── */}
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

      {/* ── New Arrivals ─────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>New Arrivals</Text>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="link"
            accessibilityLabel="Browse all new arrivals"
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
                style={{ gap: 8 }}
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

      {/* ── Trending ─────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Trending</Text>
          <Pressable
            onPress={() => router.push('/search')}
            accessibilityRole="link"
            accessibilityLabel="See all trending cards"
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {sectionsLoading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
        ) : trending.filter(c => tcgFilter === 'all' || c.tcg === tcgFilter).length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {trending.filter(c => tcgFilter === 'all' || c.tcg === tcgFilter).map(card => (
              <Pressable
                key={card.id}
                style={{ gap: 8 }}
                onPress={() => router.push({ pathname: `/card/${card.id}` as any, params: { appCardJson: JSON.stringify(card) } })}
                accessibilityRole="button"
                accessibilityLabel={`${card.name} from ${card.setName}`}
              >
                <CardThumbnail card={card} compact />
                <View>
                  <Text style={styles.moverName} numberOfLines={1}>{card.name}</Text>
                  <Text style={styles.moverSet} numberOfLines={1}>{card.setName}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Text style={styles.moverPrice}>${card.price.raw.toLocaleString('en-AU')}</Text>
                    {card.price.change7d !== undefined && (
                      <Text style={[styles.moverChange, { color: (card.price.change7d ?? 0) >= 0 ? C.positive : C.negative }]}>
                        {(card.price.change7d ?? 0) >= 0 ? '+' : ''}{card.price.change7d?.toFixed(1)}%
                      </Text>
                    )}
                  </View>
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

  // TCG filter
  tcgFilterRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  tcgFilterPill: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card,
  },
  tcgFilterPillActive: { backgroundColor: '#CC1826', borderColor: '#CC1826' },
  tcgFilterPillText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Gainers / Losers
  glRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  glCard: {
    flex: 1, backgroundColor: C.card,
    borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },
  glHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  glDot: { width: 6, height: 6, borderRadius: 3 },
  glTitle: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.8 },
  glList: {},
  glRow2: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingHorizontal: 14, paddingVertical: 9,
  },
  glIconBox: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  glInfo: { flex: 1, minWidth: 0 },
  glName: { fontSize: 11.5, fontFamily: 'Inter_600SemiBold', color: C.foreground, letterSpacing: -0.2 },
  glChange: { fontSize: 11, fontFamily: 'Inter_700Bold', marginTop: 1 },
  glEmpty: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, padding: 14 },
  glSkeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  glSkeletonIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.muted, opacity: 0.4 },
  glSkeletonLine: { height: 10, borderRadius: 5, backgroundColor: C.muted, opacity: 0.4 },

  // Market list
  marketListCard: {
    borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },
  marketRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  marketRowIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  marketRowInfo: { flex: 1, minWidth: 0 },
  marketRowName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground, letterSpacing: -0.2 },
  marketRowSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },
  marketRowRight: { alignItems: 'flex-end', flexShrink: 0 },
  marketRowPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: -0.2 },
  marketRowChange: { fontSize: 11, fontFamily: 'Inter_700Bold', marginTop: 1 },

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
