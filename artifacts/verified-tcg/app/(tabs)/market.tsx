import React, { useState, useEffect, useCallback } from 'react';
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Chip } from '@/components/ui/Chip';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { GradeBadge } from '@/components/ui/Badge';
import { MarketMoverSkeleton } from '@/components/ui/SkeletonLoader';
import { getMarketMovers, getMostWatched, getRecentSales, getNewReleases } from '@/services/market';
import { resizeTcgPlayerUrl } from '@/services/catalogApi';
import { MOCK_LISTINGS } from '@/services/listings';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import colors from '@/constants/colors';
import type { MarketMover, TCGId } from '@/types';

const C = colors.dark;

type MainTab = 'market' | 'marketplace';

const TCG_FILTERS: { label: string; value: TCGId | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'One Piece', value: 'onepiece' },
  { label: 'MTG', value: 'magic' },
];

const SORT_OPTIONS = ['Popularity', 'Price ↑', 'Price ↓', 'Newest'];

const MOST_WATCHED = getMostWatched();
const RECENT_SALES = getRecentSales();
const NEW_RELEASES = getNewReleases();

export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const [movers, setMovers] = useState<MarketMover[]>([]);
  const [moversLoading, setMoversLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTCG, setActiveTCG] = useState<TCGId | 'all'>('all');
  const [mainTab, setMainTab] = useState<MainTab>('market');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [activeSort, setActiveSort] = useState('Popularity');

  const topPad = Platform.OS === 'web' ? 67 : isLiquidGlassAvailable() ? 0 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  const loadMovers = useCallback(async () => {
    setMoversLoading(true);
    try {
      const data = await getMarketMovers();
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

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadMovers();
    setIsRefreshing(false);
  }, [loadMovers]);

  const filteredMovers =
    activeTCG === 'all' ? movers : movers.filter(m => m.card.tcg === activeTCG);

  const filteredListings = (() => {
    let list =
      activeTCG === 'all' ? MOCK_LISTINGS : MOCK_LISTINGS.filter(l => l.card.tcg === activeTCG);
    if (verifiedOnly) list = list.filter(l => l.isVerifiedSeller);
    switch (activeSort) {
      case 'Price ↑':
        return [...list].sort((a, b) => a.askingPrice - b.askingPrice);
      case 'Price ↓':
        return [...list].sort((a, b) => b.askingPrice - a.askingPrice);
      case 'Newest':
        return [...list].sort((a, b) => b.listedAt.localeCompare(a.listedAt));
      default: // Popularity — sort by watch count
        return [...list].sort((a, b) => b.watchCount - a.watchCount);
    }
  })();

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
        <Pressable style={styles.searchBtn} onPress={() => router.push('/search')}>
          <Feather name="search" size={18} color={C.foreground} />
        </Pressable>
      </View>

      {/* Main tabs */}
      <View style={[styles.mainTabs, { backgroundColor: C.card }]}>
        {([
          ['market', 'Market'] as [MainTab, string],
          ['marketplace', 'Marketplace'] as [MainTab, string],
        ]).map(([tab, label]) => (
          <Pressable
            key={tab}
            onPress={() => setMainTab(tab)}
            style={[
              styles.mainTab,
              mainTab === tab && { backgroundColor: C.primary, borderRadius: 10 },
            ]}
          >
            <Text style={[styles.mainTabText, mainTab === tab && { color: '#FFFFFF' }]}>
              {label}
            </Text>
          </Pressable>
        ))}
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

      {/* ── MARKET TAB ── */}
      {mainTab === 'market' && (
        <View>
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
                {filteredMovers.length === 0 && (
                  <Text style={styles.noData}>No movers for this filter</Text>
                )}
              </ScrollView>
            )}
          </View>

          {/* Most Watched */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Most Watched</Text>
            </View>
            {MOST_WATCHED.map((item, idx) => (
              <Pressable
                key={item.card.id}
                style={[styles.rankedRow, { backgroundColor: C.card }]}
                onPress={() => router.push({ pathname: `/card/${item.card.id}` as any, params: { appCardJson: JSON.stringify(item.card) } })}
              >
                <Text style={styles.rank}>{idx + 1}</Text>
                <View style={[styles.rankedThumb, { backgroundColor: item.card.gradientStart, overflow: 'hidden' }]}>
                  {item.card.imageUrl
                    ? <Image source={{ uri: resizeTcgPlayerUrl(item.card.imageUrl, 437) ?? item.card.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    : <Text style={styles.rankedInitial}>{item.card.name[0]}</Text>}
                </View>
                <View style={styles.rankedInfo}>
                  <Text style={styles.rankedName}>{item.card.name}</Text>
                  <Text style={styles.rankedSet}>{item.card.setName}</Text>
                </View>
                <View style={styles.rankedRight}>
                  <Text style={styles.rankedPrice}>${item.price.toLocaleString()}</Text>
                  <View style={styles.watcherRow}>
                    <Feather name="eye" size={11} color={C.mutedForeground} />
                    <Text style={styles.watcherText}>{item.watchers.toLocaleString()}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>

          {/* Recent Sales */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Recent Sales</Text>
            </View>
            {RECENT_SALES.map(sale => (
              <View key={`${sale.card.id}-${sale.soldAt}`} style={[styles.saleRow, { backgroundColor: C.card }]}>
                <View style={[styles.rankedThumb, { backgroundColor: sale.card.gradientStart }]}>
                  <Text style={styles.rankedInitial}>{sale.card.name[0]}</Text>
                </View>
                <View style={styles.rankedInfo}>
                  <Text style={styles.rankedName}>{sale.card.name}</Text>
                  <Text style={styles.rankedSet}>{sale.card.setName}</Text>
                  <Text style={[styles.saleDate, { color: C.mutedForeground }]}>{sale.soldAt}</Text>
                </View>
                <View style={styles.rankedRight}>
                  <Text style={styles.rankedPrice}>${sale.soldPrice.toLocaleString()}</Text>
                  <Text style={[styles.saleGrade, { color: C.mutedForeground }]}>{sale.grade}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* New Releases */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>New Releases</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {NEW_RELEASES.map(r => (
                <View key={r.id} style={[styles.releaseCard, { backgroundColor: C.card }]}>
                  <View style={[styles.releaseIcon, { backgroundColor: C.muted }]}>
                    <Feather name="package" size={22} color={C.primary} />
                  </View>
                  <Text style={styles.releaseName} numberOfLines={2}>{r.name}</Text>
                  <Text style={styles.releaseTcg}>{r.tcg}</Text>
                  <Text style={[styles.releaseDate, { color: C.mutedForeground }]}>{r.releaseDate}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* ── MARKETPLACE TAB ── */}
      {mainTab === 'marketplace' && (
        <View>
          {/* Filters row */}
          <View style={styles.filterRow}>
            <Pressable
              onPress={() => setVerifiedOnly(v => !v)}
              style={[
                styles.filterChip,
                { backgroundColor: verifiedOnly ? C.primary : C.card, borderColor: verifiedOnly ? C.primary : C.border },
              ]}
            >
              <Feather name="shield" size={12} color={verifiedOnly ? '#FFF' : C.mutedForeground} />
              <Text style={[styles.filterChipText, { color: verifiedOnly ? '#FFF' : C.mutedForeground }]}>Verified</Text>
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {SORT_OPTIONS.map(s => (
                <Pressable
                  key={s}
                  onPress={() => setActiveSort(s)}
                  style={[
                    styles.filterChip,
                    { backgroundColor: activeSort === s ? C.primary : C.card, borderColor: activeSort === s ? C.primary : C.border },
                  ]}
                >
                  <Text style={[styles.filterChipText, { color: activeSort === s ? '#FFF' : C.mutedForeground }]}>{s}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {filteredListings.map(listing => (
            <Pressable
              key={listing.id}
              style={[styles.listingRow, { backgroundColor: C.card }]}
              onPress={() => router.push({ pathname: `/card/${listing.card.id}` as any, params: { appCardJson: JSON.stringify(listing.card) } })}
            >
              <View style={[styles.listingThumb, { backgroundColor: listing.card.gradientStart }]}>
                {listing.card.imageUrl
                  ? <Image source={{ uri: resizeTcgPlayerUrl(listing.card.imageUrl, 437) ?? listing.card.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  : <Text style={styles.rankedInitial}>{listing.card.name[0]}</Text>}
              </View>
              <View style={styles.listingInfo}>
                <View style={styles.listingNameRow}>
                  <Text style={styles.listingName} numberOfLines={1}>{listing.card.name}</Text>
                  {listing.isVerifiedSeller && (
                    <Feather name="shield" size={13} color={C.positive} />
                  )}
                </View>
                <Text style={styles.listingSet}>{listing.card.setName} · {listing.condition}</Text>
                {listing.grading && (
                  <GradeBadge grade={listing.grading.grade} company={listing.grading.company} size="sm" />
                )}
                <Text style={[styles.listingMeta, { color: C.mutedForeground }]}>
                  {listing.watchCount} watching · {listing.listedAt}
                </Text>
              </View>
              <View style={styles.listingPricing}>
                <Text style={styles.listingPrice}>${listing.askingPrice.toLocaleString()}</Text>
                <Text style={[styles.listingPriceLabel, { color: C.mutedForeground }]}>AUD</Text>
                <Pressable style={[styles.buyBtn, { backgroundColor: `${C.primary}22` }]}>
                  <Text style={[styles.buyBtnText, { color: C.primary }]}>Buy</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}

          {filteredListings.length === 0 && (
            <View style={styles.emptySection}>
              <Feather name="shopping-bag" size={36} color={C.muted} />
              <Text style={styles.emptyTitle}>No listings</Text>
              <Text style={styles.emptyBody}>Try a different filter or check back later.</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
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
  mainTabs: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
  },
  mainTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  mainTabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
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
  noData: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, paddingVertical: 20 },
  rankedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  rank: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.mutedForeground, width: 20, textAlign: 'center' },
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
  watcherRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  watcherText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  saleDate: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 3 },
  saleGrade: { fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 3 },
  releaseCard: {
    width: 130,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  releaseIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  releaseName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  releaseTcg: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  releaseDate: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  listingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  listingThumb: {
    width: 52,
    height: 72,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  listingInfo: { flex: 1, gap: 4 },
  listingNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  listingName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground, flex: 1 },
  listingSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  listingPricing: { alignItems: 'flex-end', gap: 4 },
  listingPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  listingPriceLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  buyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 2,
  },
  buyBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptySection: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  emptyBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
});
