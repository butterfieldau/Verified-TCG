import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Chip } from '@/components/ui/Chip';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { getMarketMovers } from '@/services/market';
import { MOCK_LISTINGS } from '@/services/listings';
import { GradeBadge, VerificationBadge } from '@/components/ui/Badge';
import colors from '@/constants/colors';
import type { TCGId } from '@/types';

const C = colors.dark;

const TCG_FILTERS: { label: string; value: TCGId | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'MTG', value: 'magic' },
  { label: 'One Piece', value: 'onepiece' },
];

export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const movers = getMarketMovers();
  const [activeTCG, setActiveTCG] = useState<TCGId | 'all'>('all');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const filteredMovers = activeTCG === 'all'
    ? movers
    : movers.filter(m => m.card.tcg === activeTCG);

  const filteredListings = activeTCG === 'all'
    ? MOCK_LISTINGS
    : MOCK_LISTINGS.filter(l => l.card.tcg === activeTCG);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: TAB_H + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Market</Text>
          <Text style={styles.sub}>Live prices · AUD</Text>
        </View>
        <Pressable style={styles.filterBtn}>
          <Feather name="sliders" size={18} color={C.foreground} />
        </Pressable>
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

      {/* Market Movers */}
      <Text style={styles.sectionTitle}>Top Movers</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 4 }}>
        {filteredMovers.map(m => (
          <Pressable key={m.card.id} style={styles.moverCard}>
            <CardThumbnail card={m.card} compact />
            <Text style={styles.moverName} numberOfLines={1}>{m.card.name}</Text>
            <View style={styles.moverBottom}>
              <Text style={styles.moverPrice}>${m.currentPrice.toLocaleString('en-AU')}</Text>
              <Text style={[styles.moverPct, { color: m.trend === 'up' ? C.positive : C.negative }]}>
                {m.trend === 'up' ? '+' : ''}{m.priceChangePercent.toFixed(1)}%
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Active Listings */}
      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Active Listings</Text>
      {filteredListings.map(listing => (
        <Pressable key={listing.id} style={[styles.listingRow, { backgroundColor: C.card }]}>
          <View style={styles.listingLeft}>
            <View style={[styles.listingCardPlaceholder, { backgroundColor: listing.card.gradientStart }]}>
              <Text style={styles.listingCardInitial}>{listing.card.name[0]}</Text>
            </View>
          </View>
          <View style={styles.listingMid}>
            <Text style={styles.listingName} numberOfLines={1}>{listing.card.name}</Text>
            <Text style={styles.listingSet} numberOfLines={1}>{listing.card.setName}</Text>
            {listing.grading && (
              <View style={styles.listingGrade}>
                <GradeBadge grade={listing.grading.grade} company={listing.grading.company} size="sm" />
              </View>
            )}
            <View style={styles.sellerRow}>
              <Text style={styles.sellerName}>{listing.sellerName}</Text>
              {listing.isVerifiedSeller && (
                <View style={styles.verifiedDot} />
              )}
            </View>
          </View>
          <View style={styles.listingRight}>
            <Text style={styles.listingPrice}>${listing.askingPrice.toLocaleString('en-AU')}</Text>
            <Text style={styles.listingCurrency}>AUD</Text>
            <Text style={styles.listingWatching}>
              <Feather name="eye" size={11} color={C.mutedForeground} /> {listing.watchCount}
            </Text>
          </View>
        </Pressable>
      ))}
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
  title: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { marginBottom: 20 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 14 },
  moverCard: { width: 110, gap: 8 },
  moverName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  moverBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moverPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  moverPct: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  listingRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    alignItems: 'center',
  },
  listingLeft: {},
  listingCardPlaceholder: {
    width: 50,
    height: 70,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingCardInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  listingMid: { flex: 1, gap: 3 },
  listingName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listingSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingGrade: { marginTop: 2 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  sellerName: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  verifiedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.positive },
  listingRight: { alignItems: 'flex-end', gap: 2 },
  listingPrice: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  listingCurrency: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingWatching: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 4 },
});
