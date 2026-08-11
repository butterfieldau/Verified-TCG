import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Logo } from '@/components/Logo';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { useApp } from '@/context/AppContext';
import { getMarketMovers, getTrendingCards } from '@/services/market';
import { getCollection } from '@/services/collection';
import colors from '@/constants/colors';
import type { PortfolioRange } from '@/types';

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
  const { user, portfolio, portfolioRange, setPortfolioRange } = useApp();
  const movers = getMarketMovers();
  const collection = getCollection();
  const trending = getTrendingCards();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const gain = portfolio.totalGain;
  const gainPct = portfolio.totalGainPercent;
  const isPositive = gain >= 0;

  const chartData = portfolio.chartData[portfolioRange];
  const chartMin = Math.min(...chartData.map(d => d.value));
  const chartMax = Math.max(...chartData.map(d => d.value));
  const chartRange = chartMax - chartMin || 1;

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
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Logo variant="white" width={110} height={48} />
        <View style={styles.headerRight}>
          <Pressable style={styles.iconBtn} onPress={() => router.push('/notifications')}>
            <Feather name="bell" size={20} color={C.foreground} />
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
        <Text style={styles.cardLabel}>Collection Value</Text>
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {movers.map(m => (
            <Pressable
              key={m.card.id}
              style={{ gap: 8 }}
              onPress={() => router.push(`/card/${m.card.id}`)}
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
                      { color: m.trend === 'up' ? C.positive : C.negative },
                    ]}
                  >
                    {m.trend === 'up' ? '+' : ''}{m.priceChangePercent.toFixed(1)}%
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Recently Added ── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recently Added</Text>
          <Pressable onPress={() => router.push('/(tabs)/collection')}>
            <Text style={styles.seeAll}>View all</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {collection.slice(0, 5).map(item => (
            <Pressable
              key={item.id}
              style={{ gap: 8 }}
              onPress={() => router.push(`/card/${item.card.id}`)}
            >
              <CardThumbnail card={item.card} grading={item.grading} compact />
              <View>
                <Text style={styles.moverName} numberOfLines={1}>{item.card.name}</Text>
                <Text style={styles.moverSet}>{item.card.setName}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Trending ── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Trending</Text>
          <Pressable onPress={() => router.push('/search')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {trending.map(card => (
            <Pressable
              key={card.id}
              style={{ gap: 8 }}
              onPress={() => router.push(`/card/${card.id}`)}
            >
              <CardThumbnail card={card} compact />
              <View>
                <Text style={styles.moverName} numberOfLines={1}>{card.name}</Text>
                <Text style={styles.moverSet} numberOfLines={1}>{card.setName}</Text>
                <View style={styles.moverPriceRow}>
                  <Text style={styles.moverPrice}>${card.price.raw.toLocaleString()}</Text>
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
      </View>
    </ScrollView>
  );
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
    marginBottom: 20,
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
  card: { borderRadius: 16, padding: 18, marginBottom: 20 },
  cardLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
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
});
