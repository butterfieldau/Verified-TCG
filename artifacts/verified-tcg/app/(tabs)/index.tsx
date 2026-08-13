import React, { useState, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { useApp } from '@/context/AppContext';
import { getMarketMovers, getTrendingCards, getRecentlyAddedCards } from '@/services/market';
import { resizeTcgPlayerUrl } from '@/services/catalogApi';
import { MOCK_EVENT, MOCK_TRADE_MATCHES } from '@/services/matching';
import colors from '@/constants/colors';
import type { Card, MarketMover, PortfolioRange } from '@/types';

// Storage keys
const EVENT_BANNER_DISMISSED_KEY = '@verified_tcg/event_banner_dismissed_event_id';
const TRADE_MATCHES_DISMISSED_KEY = '@verified_tcg/trade_matches_dismissed_count';

const C = colors.dark;
const RANGES: PortfolioRange[] = ['1D', '7D', '1M', '3M', '1Y', 'ALL'];

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
  const { user, portfolio, portfolioRange, setPortfolioRange, collection, refreshPrices, isPriceRefreshing, pricesLastUpdated, unreadNotificationCount } = useApp();

  // Live catalog data for Home screen sections
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [trending, setTrending] = useState<Card[]>([]);
  const [recentCards, setRecentCards] = useState<Card[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  useEffect(() => {
    setSectionsLoading(true);
    Promise.all([
      getMarketMovers(),
      getTrendingCards(),
      getRecentlyAddedCards(),
    ])
      .then(([m, t, r]) => {
        setMovers(m);
        setTrending(t);
        setRecentCards(r);
      })
      .catch(() => {})
      .finally(() => setSectionsLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    await refreshPrices();
    // Also refresh catalog sections on pull-to-refresh
    Promise.all([getMarketMovers(), getTrendingCards(), getRecentlyAddedCards()])
      .then(([m, t, r]) => { setMovers(m); setTrending(t); setRecentCards(r); })
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
    if (action === 'scan') router.push('/(tabs)/scan');
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
          <Pressable style={styles.iconBtn} onPress={() => router.push('/notifications')}>
            <Feather name="bell" size={20} color={C.foreground} />
            {unreadNotificationCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable style={styles.avatar}>
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
      <Pressable style={styles.searchBar} onPress={() => router.push('/search')}>
        <Feather name="search" size={16} color={C.mutedForeground} />
        <Text style={styles.searchPlaceholder}>Search cards, sets or products</Text>
        <Pressable
          style={styles.scanShortcut}
          onPress={() => router.push('/(tabs)/scan')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
              style={[
                styles.rangeBtn,
                {
                  backgroundColor: portfolioRange === r ? C.primary : 'transparent',
                  borderColor: portfolioRange === r ? C.primary : C.border,
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
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.dismissBtn}
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
              <Pressable onPress={() => router.push('/trade-match' as any)}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
              <Pressable
                onPress={() => dismissTradeMatches()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginLeft: 8 }}
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
                        ? <Image source={{ uri: resizeTcgPlayerUrl(match.youWant.imageUrl, 437) ?? match.youWant.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
                        ? <Image source={{ uri: resizeTcgPlayerUrl(match.theyWant.imageUrl, 437) ?? match.theyWant.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
          >
            <View style={[styles.actionIcon, { backgroundColor: C.card }]}>
              <Feather name={a.icon as any} size={20} color={C.foreground} />
            </View>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Market Movers ── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Market Movers</Text>
          <Pressable onPress={() => router.push('/(tabs)/market')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {sectionsLoading ? (
          <ActivityIndicator color={C.primary} style={{ alignSelf: 'flex-start', marginLeft: 4 }} />
        ) : movers.length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
            {movers.map(m => (
              <Pressable
                key={m.card.id}
                style={{ gap: 8 }}
                onPress={() => router.push({ pathname: `/card/${m.card.id}` as any, params: { appCardJson: JSON.stringify(m.card) } })}
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
          <Pressable onPress={() => router.push('/search')}>
            <Text style={styles.seeAll}>Browse all</Text>
          </Pressable>
        </View>
        {sectionsLoading ? (
          <ActivityIndicator color={C.primary} style={{ alignSelf: 'flex-start', marginLeft: 4 }} />
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
          <Pressable onPress={() => router.push('/search')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {sectionsLoading ? (
          <ActivityIndicator color={C.primary} style={{ alignSelf: 'flex-start', marginLeft: 4 }} />
        ) : trending.length === 0 ? (
          <Text style={styles.emptySection}>No data available right now</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
          >
            {trending.map(card => (
              <Pressable
                key={card.id}
                style={{ gap: 8 }}
                onPress={() => router.push({ pathname: `/card/${card.id}` as any, params: { appCardJson: JSON.stringify(card) } })}
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
  scanShortcut: { padding: 2 },

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
    backgroundColor: C.primary,
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
});
