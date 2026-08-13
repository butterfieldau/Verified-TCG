import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { Chip } from '@/components/ui/Chip';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { GradeBadge } from '@/components/ui/Badge';
import { getMarketMovers, getMostWatched, getRecentSales, getNewReleases } from '@/services/market';
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
  const [activeTCG, setActiveTCG] = useState<TCGId | 'all'>('all');

  useEffect(() => {
    getMarketMovers()
      .then(setMovers)
      .catch(() => {})
      .finally(() => setMoversLoading(false));
  }, []);
  const [mainTab, setMainTab] = useState<MainTab>('market');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [activeSort, setActiveSort] = useState('Popularity');

  // NativeTabs (iOS 26+ liquid glass) already accounts for the safe area —
  // adding insets.top on top of that creates a large black gap.
  const topPad = Platform.OS === 'web' ? 67 : isLiquidGlassAvailable() ? 0 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

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
              <ActivityIndicator color={C.primary} style={{ alignSelf: 'flex-start', marginLeft: 4, marginVertical: 8 }} />
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
                    ? <Image source={{ uri: item.card.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
            <Text style={styles.sectionTitle}>Recent Sales</Text>
            {RECENT_SALES.map((sale, i) => (
              <Pressable
                key={i}
                style={[styles.saleRow, { backgroundColor: C.card }]}
                onPress={() => router.push({ pathname: `/card/${sale.card.id}` as any, params: { appCardJson: JSON.stringify(sale.card) } })}
              >
                <View style={[styles.saleThumb, { backgroundColor: sale.card.gradientStart, overflow: 'hidden' }]}>
                  {sale.card.imageUrl
                    ? <Image source={{ uri: sale.card.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    : <Text style={styles.saleInitial}>{sale.card.name[0]}</Text>}
                </View>
                <View style={styles.saleInfo}>
                  <Text style={styles.saleName}>{sale.card.name}</Text>
                  <Text style={styles.saleSet}>{sale.card.setName}</Text>
                  {sale.grade && <Text style={styles.saleGrade}>{sale.grade}</Text>}
                </View>
                <View style={styles.saleRight}>
                  <Text style={styles.salePrice}>${sale.soldPrice.toLocaleString()}</Text>
                  <Text style={styles.saleTime}>{sale.soldAt}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          {/* New Releases */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>New Releases</Text>
            {NEW_RELEASES.map(rel => (
              <View key={rel.id} style={[styles.releaseCard, { backgroundColor: C.card }]}>
                <View style={styles.releaseHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.releaseName}>{rel.name}</Text>
                    <Text style={styles.releaseMeta}>
                      {rel.tcg} · {rel.cards} cards · {rel.releaseDate}
                    </Text>
                  </View>
                  <View style={[styles.newTag, { backgroundColor: `${C.primary}22` }]}>
                    <Text style={[styles.newTagText, { color: C.primary }]}>New</Text>
                  </View>
                </View>
                <View style={styles.releaseHighlight}>
                  <Feather name="star" size={12} color="#F59E0B" />
                  <Text style={styles.releaseHighlightText}>Chase: {rel.highlight}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── MARKETPLACE TAB ── */}
      {mainTab === 'marketplace' && (
        <View>
          {/* Filters */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 16 }}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
          >
            <Pressable
              onPress={() => setVerifiedOnly(v => !v)}
              style={[
                styles.filterChip,
                verifiedOnly && { backgroundColor: `${C.positive}22`, borderColor: C.positive },
              ]}
            >
              <Feather name="shield" size={13} color={verifiedOnly ? C.positive : C.mutedForeground} />
              <Text style={[styles.filterChipText, verifiedOnly && { color: C.positive }]}>
                Verified Only
              </Text>
            </Pressable>
            {SORT_OPTIONS.map(s => (
              <Pressable
                key={s}
                onPress={() => setActiveSort(s)}
                style={[
                  styles.filterChip,
                  activeSort === s && { borderColor: C.primary, backgroundColor: `${C.primary}18` },
                ]}
              >
                <Text style={[styles.filterChipText, activeSort === s && { color: C.primary }]}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Listing count */}
          <Text style={styles.listingCount}>
            {filteredListings.length} listing{filteredListings.length !== 1 ? 's' : ''}
          </Text>

          {/* Listings */}
          {filteredListings.length > 0 ? (
            filteredListings.map(listing => (
              <Pressable
                key={listing.id}
                style={[styles.listingRow, { backgroundColor: C.card }]}
                onPress={() => router.push({ pathname: `/card/${listing.card.id}` as any, params: { appCardJson: JSON.stringify(listing.card) } })}
              >
                <View style={[styles.listingThumb, { backgroundColor: listing.card.gradientStart }]}>
                  <Text style={styles.listingInitial}>{listing.card.name[0]}</Text>
                </View>
                <View style={styles.listingMid}>
                  <Text style={styles.listingName} numberOfLines={1}>
                    {listing.card.name}
                  </Text>
                  <Text style={styles.listingSet}>{listing.card.setName}</Text>
                  {listing.grading && (
                    <View style={styles.gradeWrap}>
                      <GradeBadge
                        grade={listing.grading.grade}
                        company={listing.grading.company}
                        size="sm"
                      />
                    </View>
                  )}
                  <View style={styles.sellerRow}>
                    <Text style={styles.sellerName}>{listing.sellerName}</Text>
                    {listing.isVerifiedSeller && (
                      <View style={styles.verifiedPill}>
                        <Feather name="shield" size={10} color={C.positive} />
                        <Text style={[styles.verifiedPillText, { color: C.positive }]}>Verified</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.listingRight}>
                  <Text style={styles.listingPrice}>${listing.askingPrice.toLocaleString()}</Text>
                  <Text style={styles.listingCurrency}>AUD</Text>
                  <View style={styles.watchRow}>
                    <Feather name="eye" size={11} color={C.mutedForeground} />
                    <Text style={styles.watchText}>{listing.watchCount}</Text>
                  </View>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Feather name="package" size={40} color={C.muted} />
              <Text style={styles.emptyTitle}>No listings found</Text>
              <Text style={styles.emptyBody}>Try removing filters or switching TCG</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
  },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  searchBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, marginBottom: 16 },
  mainTab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  mainTabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  chips: { marginBottom: 24 },
  section: { marginBottom: 28 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 14 },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  moverCard: { width: 118, gap: 6 },
  moverName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  moverSet: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  moverBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moverPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  moverPct: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  rankedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  rank: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    width: 20,
    textAlign: 'center',
  },
  rankedThumb: { width: 48, height: 68, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankedInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  rankedInfo: { flex: 1, gap: 3 },
  rankedName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  rankedSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  rankedRight: { alignItems: 'flex-end', gap: 4 },
  rankedPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  watcherRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  watcherText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  saleThumb: { width: 44, height: 62, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  saleInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  saleInfo: { flex: 1, gap: 3 },
  saleName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  saleSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  saleGrade: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  saleRight: { alignItems: 'flex-end', gap: 3 },
  salePrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  saleTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  releaseCard: { borderRadius: 14, padding: 16, marginBottom: 10 },
  releaseHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  releaseName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  releaseMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  newTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  newTagText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  releaseHighlight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  releaseHighlightText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  listingCount: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginBottom: 12,
  },
  listingRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    alignItems: 'center',
  },
  listingThumb: { width: 50, height: 70, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  listingInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  listingMid: { flex: 1, gap: 3 },
  listingName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listingSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  gradeWrap: { marginTop: 2 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sellerName: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedPillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  listingRight: { alignItems: 'flex-end', gap: 2 },
  listingPrice: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  listingCurrency: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  watchText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  emptyBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
});
