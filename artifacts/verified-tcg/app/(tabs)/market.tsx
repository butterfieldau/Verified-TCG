import React, { useState, useEffect, useCallback } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Chip } from '@/components/ui/Chip';
import { CardImage } from '@/components/ui/CardImage';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { MarketMoverSkeleton } from '@/components/ui/SkeletonLoader';
import { getMarketMovers, getMarketMoversCached } from '@/services/market';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import colors from '@/constants/colors';
import type { MarketMover, TCGId } from '@/types';

const C = colors.dark;

const TCG_FILTERS: { label: string; value: TCGId | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'One Piece', value: 'onepiece' },
  { label: 'MTG', value: 'magic' },
];

export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [moversLoading, setMoversLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTCG, setActiveTCG] = useState<TCGId | 'all'>('all');

  const topPad = Platform.OS === 'web' ? 67 : isLiquidGlassAvailable() ? 0 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  // Stale-while-revalidate: cached movers render instantly; a background
  // refresh (when stale) pushes fresh data in via the onUpdate callback.
  const loadMovers = useCallback(async () => {
    try {
      const data = await getMarketMoversCached(fresh => setMovers(fresh));
      setMovers(data);
    } catch {
      // silently keep previous data
    } finally {
      setMoversLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMovers();
  }, [loadMovers]);

  // Pull-to-refresh always hits the network (and rewrites the cache)
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await getMarketMovers();
      if (data.length > 0) setMovers(data);
    } catch {
      // keep previous data
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const filteredMovers =
    activeTCG === 'all' ? movers : movers.filter(m => m.card.tcg === activeTCG);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: tabH + 24 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={C.primary}
          colors={[C.primary]}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Market</Text>
          <Text style={styles.sub}>Updated just now · AUD</Text>
        </View>
        <View style={styles.headerButtons}>
          <Pressable
            style={styles.searchBtn}
            onPress={() => router.push('/(tabs)/scan')}
            accessibilityRole="button"
            accessibilityLabel="Scan a card"
            hitSlop={1}
          >
            <Feather name="camera" size={18} color={C.foreground} />
          </Pressable>
          <Pressable
            style={styles.searchBtn}
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            accessibilityLabel="Search cards"
            hitSlop={1}
          >
            <Feather name="search" size={18} color={C.foreground} />
          </Pressable>
        </View>
      </View>

      {/* TCG filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {TCG_FILTERS.map(f => (
          <Chip
            key={f.value}
            label={f.label}
            selected={activeTCG === f.value}
            onPress={() => setActiveTCG(f.value)}
            size="sm"
          />
        ))}
      </ScrollView>

      {/* Biggest Movers */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Biggest Movers</Text>
          <View style={[styles.badge, { backgroundColor: `${C.positive}22` }]}>
            <Feather name="trending-up" size={12} color={C.positive} />
          </View>
        </View>
        {moversLoading ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingRight: 4 }}
          >
            {[0, 1, 2, 3].map(i => <MarketMoverSkeleton key={i} />)}
          </ScrollView>
        ) : filteredMovers.length === 0 ? (
          <View style={styles.emptySection}>
            <Feather name="bar-chart-2" size={32} color={C.muted} />
            <Text style={styles.emptyTitle}>No data yet</Text>
            <Text style={styles.emptyBody}>Market mover data will appear here as prices update.</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingRight: 4 }}
          >
            {filteredMovers.map(m => (
              <Pressable
                key={m.card.id}
                style={styles.moverCard}
                onPress={() => router.push({ pathname: `/card/${m.card.id}` as any, params: { appCardJson: JSON.stringify(m.card) } })}
                accessibilityRole="button"
                accessibilityLabel={`${m.card.name}, ${m.trend === 'up' ? '+' : ''}${m.priceChangePercent.toFixed(1)}% — $${m.currentPrice.toLocaleString()}`}
              >
                <CardThumbnail card={m.card} compact />
                <Text style={styles.moverName} numberOfLines={1}>{m.card.name}</Text>
                <Text style={styles.moverSet} numberOfLines={1}>{m.card.setName}</Text>
                <View style={styles.moverBottom}>
                  <Text style={styles.moverPrice}>${m.currentPrice.toLocaleString()}</Text>
                  <Text style={[styles.moverPct, { color: m.trend === 'up' ? C.positive : C.negative }]}>
                    {m.trend === 'up' ? '+' : ''}{m.priceChangePercent.toFixed(1)}%
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Trending — tap to search */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Trending Cards</Text>
        </View>
        {filteredMovers.slice(0, 5).map(m => (
          <Pressable
            key={m.card.id}
            style={[styles.rankedRow, { backgroundColor: C.card }]}
            onPress={() => router.push({ pathname: `/card/${m.card.id}` as any, params: { appCardJson: JSON.stringify(m.card) } })}
          >
            <View style={[styles.rankedThumb, { backgroundColor: m.card.gradientStart, overflow: 'hidden' }]}>
              {m.card.imageUrl
                ? <CardImage uri={m.card.imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
                : <Text style={styles.rankedInitial}>{m.card.name[0]}</Text>}
            </View>
            <View style={styles.rankedInfo}>
              <Text style={styles.rankedName}>{m.card.name}</Text>
              <Text style={styles.rankedSet}>{m.card.setName}</Text>
            </View>
            <View style={styles.rankedRight}>
              <Text style={styles.rankedPrice}>${m.currentPrice.toLocaleString()}</Text>
              <Text style={[styles.moverPct, { color: m.trend === 'up' ? C.positive : C.negative, marginTop: 3 }]}>
                {m.trend === 'up' ? '+' : ''}{m.priceChangePercent.toFixed(1)}%
              </Text>
            </View>
          </Pressable>
        ))}
        {!moversLoading && filteredMovers.length === 0 && (
          <View style={styles.emptySection}>
            <Text style={styles.emptyBody}>No trending cards for this filter.</Text>
          </View>
        )}
      </View>

      {/* Marketplace — coming soon */}
      <View style={[styles.section, styles.comingSoonCard, { backgroundColor: C.card }]}>
        <Feather name="shopping-bag" size={28} color={C.primary} />
        <Text style={styles.comingSoonTitle}>Marketplace Coming Soon</Text>
        <Text style={styles.comingSoonBody}>
          Buy, sell and trade verified cards directly with other collectors. Stay tuned.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  headerButtons: { flexDirection: 'row', gap: 8 },
  title: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  searchBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  moverCard: { width: 110 },
  moverName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground, marginTop: 8 },
  moverSet: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  moverBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  moverPrice: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },
  moverPct: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  rankedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  rankedThumb: {
    width: 44,
    height: 60,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankedInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  rankedInfo: { flex: 1 },
  rankedName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  rankedSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  rankedRight: { alignItems: 'flex-end' },
  rankedPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptySection: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  emptyBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  comingSoonCard: {
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  comingSoonTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  comingSoonBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 20 },
});
