import React, { useState, useCallback, useEffect } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Logo } from '@/components/Logo';
import { CardImage } from '@/components/ui/CardImage';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { MarketMoverSkeleton, RecentActivitySkeleton } from '@/components/ui/SkeletonLoader';
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
import colors from '@/constants/colors';
import type { Card, MarketMover, PortfolioRange } from '@/types';

// Storage keys
const EVENT_BANNER_DISMISSED_KEY = '@verified_tcg/event_banner_dismissed_event_id';
const TRADE_MATCHES_DISMISSED_KEY = '@verified_tcg/trade_matches_dismissed_count';

const C = colors.dark;
const RANGES: PortfolioRange[] = ['1D', '7D', '1M', '3M', '1Y', 'ALL'];

type TcgFilter = 'all' | 'pokemon' | 'onepiece' | 'magic';
const TCG_FILTERS: { id: TcgFilter; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'pokemon',  label: 'Pokémon' },
  { id: 'onepiece', label: 'One Piece' },
  { id: 'magic',    label: 'MTG' },
];

const QUICK_ACTIONS: { icon: string; label: string; action: string }[] = [
  { icon: 'camera', label: 'Scan', action: 'scan' },
  { icon: 'plus-circle', label: 'Add Card', action: 'add-card' },
  { icon: 'dollar-sign', label: 'Check Price', action: 'search' },
  { icon: 'shield', label: 'Verify', action: 'search' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, portfolio, portfolioRange, setPortfolioRange, collection, refreshPrices, isPriceRefreshing, pricesLastUpdated, unreadNotificationCount } = useApp();

  // TCG filter for Market Movers + Trending
  const [tcgFilter, setTcgFilter] = useState<TcgFilter>('all');

  // Live catalog data for Home screen sections
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [trending, setTrending] = useState<Card[]>([]);
  const [recentCards, setRecentCards] = useState<Card[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  // Recent activity — real server data for signed-in users
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSectionsLoading(true);
    setActivityLoading(true);

    // Stale-while-revalidate: cached data renders instantly; when a background
    // refresh resolves, the onUpdate callbacks push fresh data into state.
    // sectionsLoading only stays true when there is no cache at all.
    Promise.all([
      getMarketMoversCached(fresh => { if (!cancelled) setMovers(fresh); }),
      getTrendingCardsCached(fresh => { if (!cancelled) setTrending(fresh); }),
      getRecentlyAddedCardsCached(fresh => { if (!cancelled) setRecentCards(fresh); }),
    ])
      .then(([m, t, r]) => {
        if (cancelled) return;
        setMovers(m);
        setTrending(t);
        setRecentCards(r);
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
    // Also refresh catalog sections and activity on pull-to-refresh
    Promise.all([getMarketMovers(), getTrendingCards(), getRecentlyAddedCards(), fetchRecentActivity(10)])
      .then(([m, t, r, a]) => { setMovers(m); setTrending(t); setRecentCards(r); setActivity(a); })
      .catch(() => {});
  }, [refreshPrices]);

  // `null` = not yet read from storage; `false` = visible; `true` = dismissed
  const [eventBannerDismissed, setEventBannerDismissed] = useState<boolean | null>(null);
  const [tradeMatchesDismissed, setTradeMatchesDismissed] = useState<boolean | null>(null);

  // Load persisted dismissed states on mount — keep banners hidden until resolved
  useEffect(() => {
    async function loadDismissed() {
      try {
        const [dismissedEventId, dismissedMatchCount] = await Promise.all([
          AsyncStorage.getItem(EVENT_BANNER_DISMISSED_KEY),
          AsyncStorage.getItem(TRADE_MATCHES_DISMISSED_KEY),
        ]);

        // Event banner: dismissed only if the stored event ID matches the current event
        setEventBannerDismissed(dismissedEventId === MOCK_EVENT.id);

        // Trade matches: dismissed only if match count hasn't grown since last dismissal
        if (dismissedMatchCount !== null) {
          const storedCount = parseInt(dismissedMatchCount, 10);
          setTradeMatchesDismissed(!isNaN(storedCount) && MOCK_TRADE_MATCHES.length <= storedCount);
        } else {
          setTradeMatchesDismissed(false);
        }
      } catch {
        // Storage read failed — show banners by default
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

  // When NativeTabs (Liquid Glass) is active on iOS 26+, the native container
  // already applies safe-area insets, so we must not add insets.top again.
  const topPad = Platform.OS === 'web' ? 67 : isLiquidGlassAvailable() ? 0 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const gain = portfolio.totalGain;
  const gainPct = portfolio.totalGainPercent;
  const isPositive = gain >= 0;

  const chartData = portfolio.chartData[portfolioRange];
  const chartMin = Math.min(...chartData.map(d => d.value));
  const chartMax = Math.max(...chartData.map(d => d.value));
  const chartRange = chartMax - chartMin || 1;

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
      refreshControl={
        <RefreshControl
          refreshing={isPriceRefreshing}
          onRefresh={onRefresh}
          tintColor={C.primary}
          colors={[C.primary]}
        />
      }
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Logo variant="white" width={110} height={48} />
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={unreadNotificationCount > 0 ? `Notifications, ${unreadNotificationCount} unread` : 'Notifications'}
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

      {/* ── Greeting ── */}
      <View style={styles.greeting}>
        <Text style={styles.greetingTime}>{getGreeting()}</Text>
        <Text style={styles.greetingName}>{user?.displayName ?? 'Collector'}</Text>
      </View>

      {/* ── Search bar ── */}
      <Pressable
        style={styles.searchBar}
        onPress={() => router.push('/search')}
        accessibilityRole="search"
        accessibilityLabel="Search cards, sets or products"
      >
        <Feather name="search" size={16} color={C.mutedForeground} />
        <Text style={styles.searchPlaceholder}>Search cards, sets or products</Text>
        <Pressable
          style={styles.scanShortcut}
          onPress={() => router.push('/scan')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Scan a card"
        >
          <Feather name="camera" size={16} color={C.primary} />
        </Pressable>
      </Pressable>

      {/* ── Portfolio Overview ── */}
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <View style={styles.cardLabelRow}>
          <Text style={styles.cardLabel}>Collection Value</Text>
          {pricesLastUpdated && (
            <Text style={styles.lastUpdated}>
              Updated {formatLastUpdated(pricesLastUpdated)}
            </Text>
          )}
        </View>
        <Text style={styles.portfolioValue}>
          ${portfolio.totalValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })} AUD
        </Text>
        <View style={styles.changeRow}>
          <Text style={[styles.changeAmount, { color: isPositive ? C.positive : C.negative }]}>
            {isPositive ? '+' : ''}${Math.abs(gain).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
          </Text>
          <Text style={[styles.changePct, { color: isPositive ? C.positive : C.negative }]}>
            {isPositive ? '+' : ''}{gainPct.toFixed(2)}%
          </Text>
        </View>

        {/* Mini bar chart */}
        <View style={styles.chart}>
          <View style={styles.chartLine}>
            {chartData.slice(-20).map((pt, i, arr) => {
              const pct = (pt.value - chartMin) / chartRange;
              const prevPct = i > 0 ? (arr[i - 1].value - chartMin) / chartRange : pct;
              const isUp = pct >= prevPct;
              return (
                <View
                  key={i}
                  style={[
                    styles.chartBar,
                    {
                      height: 40 * pct + 4,
                      backgroundColor: isPositive
                        ? `${C.positive}${isUp ? 'BB' : '55'}`
                        : `${C.negative}${isUp ? '55' : 'BB'}`,
                    },
                  ]}
                />
              );
            })}
          </View>
        </View>

        {/* Range picker */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ranges}>
          {RANGES.map(r => (
            <Pressable
              key={r}
              onPress={() => setPortfolioRange(r)}
              accessibilityRole="button"
              accessibilityLabel={`${r} range`}
              accessibilityState={{ selected: portfolioRange === r }}
              hitSlop={{ top: 10, bottom: 10 }}
              style={[
                styles.rangeBtn,
                {
                  backgroundColor: portfolioRange === r ? '#CC1826' : 'transparent',
                  borderColor: portfolioRange === r ? '#CC1826' : C.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.rangeText,
                  { color: portfolioRange === r ? '#FFFFFF' : C.mutedForeground },
                ]}
              >
                {r}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Live Event Banner ── */}
      {MOCK_EVENT.isActive && eventBannerDismissed === false && (
        <Pressable
          onPress={() => router.push('/event-mode' as any)}
          style={styles.eventBanner}
          accessibilityRole="button"
          accessibilityLabel={`Live event: ${MOCK_EVENT.name} at ${MOCK_EVENT.venue}. Tap to enter.`}
        >
          {/* Accent stripe */}
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

      {/* ── Trade Matches Strip ── */}
      {tradeMatchesDismissed === false && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Trade Matches</Text>
              <View style={[styles.matchCountPill, { backgroundColor: `${C.primary}22` }]}>
                <Text style={[styles.matchCountText, { color: C.primary }]}>{MOCK_TRADE_MATCHES.length}</Text>
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
                onPress={() => dismissTradeMatches()}
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
                accessibilityLabel={`Trade match: you want ${match.youWant.name}, they want ${match.theyWant.name}. ${match.matchPercent}% match with @${match.collector.username}`}
              >
                {/* Match % */}
                <View style={[styles.tradeMatchPill, { backgroundColor: matchColor(match.matchPercent) + '22' }]}>
                  <View style={[styles.tradeMatchDot, { backgroundColor: matchColor(match.matchPercent) }]} />
                  <Text style={[styles.tradeMatchPct, { color: matchColor(match.matchPercent) }]}>
                    {match.matchPercent}%
                  </Text>
                </View>

                {/* Cards side by side */}
                <View style={styles.tradeMatchCards}>
                  <View style={styles.tradeMatchSide}>
                    <View style={[styles.tradeMatchThumb, { backgroundColor: match.youWant.color, overflow: 'hidden' }]}>
                      {match.youWant.imageUrl
                        ? <CardImage uri={match.youWant.imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
                        : <Text style={styles.tradeMatchInitial}>{match.youWant.name[0]}</Text>}
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
                        : <Text style={styles.tradeMatchInitial}>{match.theyWant.name[0]}</Text>}
                    </View>
                    <Text style={styles.tradeMatchLabel}>THEY WANT</Text>
                    <Text style={styles.tradeMatchCardName} numberOfLines={2}>{match.theyWant.name}</Text>
                    <Text style={styles.tradeMatchGrade}>{match.theyWant.grade}</Text>
                  </View>
                </View>

                {/* Collector row */}
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

            {/* View all card */}
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

      {/* ── Quick Actions ── */}
      <View style={styles.actions}>
        {QUICK_ACTIONS.map(a => (
          <Pressable
            key={a.label}
            onPress={() => handleQuickAction(a.action)}
            style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <View style={[styles.actionIcon, { backgroundColor: C.card }]}>
              <Feather name={a.icon as any} size={20} color={C.foreground} />
            </View>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── TCG Filter Pills ── */}
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
              {
                backgroundColor: tcgFilter === f.id ? '#CC1826' : C.card,
                borderColor: tcgFilter === f.id ? '#CC1826' : C.border,
              },
            ]}
          >
            <Text
              style={[
                styles.tcgFilterPillText,
                { color: tcgFilter === f.id ? '#FFFFFF' : C.mutedForeground },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Market Movers ── */}
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
        ) : movers.filter(m => tcgFilter === 'all' || m.card.tcg === tcgFilter).length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
            {movers.filter(m => tcgFilter === 'all' || m.card.tcg === tcgFilter).map(m => (
              <Pressable
                key={m.card.id}
                style={{ gap: 8 }}
                onPress={() => router.push({ pathname: `/card/${m.card.id}` as any, params: { appCardJson: JSON.stringify(m.card) } })}
                accessibilityRole="button"
                accessibilityLabel={`${m.card.name} from ${m.card.setName}`}
              >
                <CardThumbnail card={m.card} compact />
                <View>
                  <Text style={styles.moverName} numberOfLines={1}>{m.card.name}</Text>
                  <Text style={styles.moverSet} numberOfLines={1}>{m.card.setName}</Text>
                  <View style={styles.moverPriceRow}>
                    <Text style={styles.moverPrice}>
                      ${m.currentPrice.toLocaleString('en-AU')}
                    </Text>
                    <Text
                      style={[
                        styles.moverChange,
                        { color: m.trend === 'up' ? C.positive : m.trend === 'down' ? C.negative : C.mutedForeground },
                      ]}
                    >
                      {m.trend === 'up' ? '+' : ''}{m.priceChangePercent.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── New Arrivals (catalog recently-added) ── */}
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
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
                  <View style={styles.moverPriceRow}>
                    <Text style={styles.moverPrice}>${card.price.raw.toLocaleString('en-AU')}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Trending ── */}
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
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
                  <View style={styles.moverPriceRow}>
                    <Text style={styles.moverPrice}>${card.price.raw.toLocaleString('en-AU')}</Text>
                    {card.price.change7d !== undefined && (
                      <Text
                        style={[
                          styles.moverChange,
                          { color: (card.price.change7d ?? 0) >= 0 ? C.positive : C.negative },
                        ]}
                      >
                        {(card.price.change7d ?? 0) >= 0 ? '+' : ''}
                        {card.price.change7d?.toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ── Recent Activity (signed-in users only) ── */}
      {isAuthenticated && (activityLoading || activity.length > 0) && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
          </View>
          {activityLoading ? (
            <RecentActivitySkeleton count={4} />
          ) : (
            <View style={[styles.activityCard, { backgroundColor: C.card }]}>
              {activity.map((item, idx) => (
                <View
                  key={item.id}
                  style={[
                    styles.activityRow,
                    idx < activity.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border },
                  ]}
                >
                  <View style={[styles.activityDot, { backgroundColor: `${C.primary}22` }]}>
                    <Feather
                      name={
                        item.type === 'card_added' ? 'plus-circle' :
                        item.type === 'card_removed' ? 'minus-circle' :
                        item.type === 'wishlist_added' ? 'heart' :
                        item.type === 'wishlist_removed' ? 'heart' :
                        item.type === 'price_alert_fired' ? 'bell' :
                        'edit-2'
                      }
                      size={14}
                      color={C.primary}
                    />
                  </View>
                  <View style={styles.activityContent}>
                    <Text style={styles.activityDesc} numberOfLines={1}>{item.description}</Text>
                    <Text style={styles.activityTime}>{item.timeAgo}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    lineHeight: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  greeting: { marginBottom: 16 },
  greetingTime: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  greetingName: {
    fontSize: 26,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  scanShortcut: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // ── Event Banner ──
  eventBanner: {
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: `${C.primary}44`,
    flexDirection: 'row',
  },
  eventBannerAccent: {
    width: 4,
    backgroundColor: C.primary,
  },
  eventBannerInner: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  eventBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: `${C.primary}22`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  eventLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.positive,
  },
  eventLiveText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 1,
  },
  dismissBtn: {
    padding: 2,
  },
  eventBannerName: {
    fontSize: 17,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.2,
  },
  eventBannerVenue: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginBottom: 4,
  },
  eventStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  eventStat: {
    alignItems: 'center',
    gap: 2,
  },
  eventStatValue: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    lineHeight: 22,
  },
  eventStatLabel: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 12,
  },
  eventStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: C.border,
  },
  enterEventBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#CC1826',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  enterEventBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },

  // ── Trade Matches Strip ──
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchCountPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  matchCountText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  tradeMatchCard: {
    width: 170,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  tradeMatchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tradeMatchDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  tradeMatchPct: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  tradeMatchCards: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  tradeMatchSide: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tradeMatchThumb: {
    width: 48,
    height: 66,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradeMatchInitial: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: 'rgba(255,255,255,0.9)',
  },
  tradeMatchLabel: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    letterSpacing: 0.8,
  },
  tradeMatchCardName: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    textAlign: 'center',
  },
  tradeMatchGrade: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  tradeMatchSwap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 24,
  },
  tradeMatchCollector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  tradeMatchAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradeMatchAvatarText: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
  tradeMatchUsername: {
    flex: 1,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  tradeMatchViewAll: {
    width: 90,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  tradeMatchViewAllText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    lineHeight: 15,
  },

  card: { borderRadius: 16, padding: 18, marginBottom: 20 },
  cardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  lastUpdated: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    opacity: 0.7,
  },
  portfolioValue: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    letterSpacing: -0.5,
  },
  changeRow: { flexDirection: 'row', gap: 10, marginTop: 6, alignItems: 'center' },
  changeAmount: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  changePct: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chart: { height: 48, marginVertical: 16 },
  chartLine: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  chartBar: { flex: 1, borderRadius: 2, minHeight: 4 },
  ranges: { marginTop: 4 },
  rangeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 6,
  },
  rangeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  action: { alignItems: 'center', gap: 8, flex: 1 },
  actionIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  section: { marginBottom: 28 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  seeAll: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  moverName: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    width: 110,
  },
  moverSet: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 2,
    width: 110,
  },
  moverPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  moverPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  moverChange: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  emptySection: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    paddingVertical: 8,
  },

  // ── Recent Activity ──
  activityCard: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  activityDot: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityContent: { flex: 1 },
  activityDesc: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },

  // ── TCG Filter Pills ──
  tcgFilterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 4,
  },
  tcgFilterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  tcgFilterPillText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
