import React, { useState } from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { GradeBadge, VerificationBadge } from '@/components/ui/Badge';
import { useApp } from '@/context/AppContext';
import { getCardById } from '@/services/cards';
import { MOCK_LISTINGS } from '@/services/listings';
import colors from '@/constants/colors';
import { RARITY_LABELS } from '@/types';
import type { CollectionItem } from '@/types';

const C = colors.dark;
const { width: W } = Dimensions.get('window');

type PriceTab = 'Raw' | 'PSA 9' | 'PSA 10' | 'CGC 10' | 'BGS 9.5';

const PRICE_TABS: PriceTab[] = ['Raw', 'PSA 9', 'PSA 10', 'CGC 10', 'BGS 9.5'];

function getTabPrice(card: any, tab: PriceTab): number | undefined {
  switch (tab) {
    case 'Raw': return card.price.raw;
    case 'PSA 9': return card.price.psa9;
    case 'PSA 10': return card.price.psa10;
    case 'CGC 10': return card.price.cgc10;
    case 'BGS 9.5': return card.price.bgs95;
    default: return card.price.raw;
  }
}

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { addToCollection, addToWatchlist, watchlist, collection } = useApp();
  const [priceTab, setPriceTab] = useState<PriceTab>('Raw');
  const [localInCollection, setLocalInCollection] = useState(false);
  const [localInWatchlist, setLocalInWatchlist] = useState(false);
  const [showAddedBanner, setShowAddedBanner] = useState(false);

  const card = getCardById(id ?? '') ?? getCardById('charizard-ex-ob')!;
  const cardListings = MOCK_LISTINGS.filter(l => l.card.id === card.id);
  const allListings = cardListings.length > 0 ? cardListings : MOCK_LISTINGS.slice(0, 2);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  const activePrice = getTabPrice(card, priceTab);

  const isOwned = localInCollection || collection.some(i => i.cardId === card.id);
  const isWatched = localInWatchlist || watchlist.some(w => w.cardId === card.id);

  function handleAddToCollection() {
    const newItem: CollectionItem = {
      id: `col-${Date.now()}`,
      cardId: card.id,
      card,
      quantity: 1,
      condition: 'near_mint',
      acquiredAt: new Date().toISOString().split('T')[0],
      acquiredPrice: card.price.raw,
      currency: 'AUD',
    };
    addToCollection(newItem);
    setLocalInCollection(true);
    setShowAddedBanner(true);
    setTimeout(() => setShowAddedBanner(false), 2500);
  }

  function handleWatch() {
    if (!isWatched) {
      addToWatchlist({
        id: `wl-${Date.now()}`,
        cardId: card.id,
        card,
        addedAt: new Date().toISOString().split('T')[0],
      });
      setLocalInWatchlist(true);
    }
  }

  const gain24h = card.price.change24h;
  const gain7d = card.price.change7d;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: tabH + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav */}
        <View style={styles.nav}>
          <Pressable onPress={() => router.back()} style={styles.navBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <View style={styles.navRight}>
            <Pressable
              onPress={handleWatch}
              style={[styles.navBtn, isWatched && { backgroundColor: `${C.primary}22` }]}
            >
              <Feather name="heart" size={20} color={isWatched ? C.primary : C.foreground} />
            </Pressable>
            <Pressable style={styles.navBtn}>
              <Feather name="share-2" size={20} color={C.foreground} />
            </Pressable>
          </View>
        </View>

        {/* Card image (gradient placeholder) */}
        <View style={styles.cardStage}>
          <View style={[styles.cardVisual, { backgroundColor: card.gradientStart }]}>
            <View style={styles.cardSheen} />
            <View style={styles.cardNumberBadge}>
              <Text style={styles.cardNumberText}>{card.number}</Text>
            </View>
            <Text style={styles.cardInitialLarge}>{card.name[0]}</Text>
            {card.verificationStatus === 'verified' && (
              <View style={styles.verifiedOverlay}>
                <VerificationBadge status="verified" />
              </View>
            )}
          </View>
        </View>

        {/* Title block */}
        <View style={styles.titleBlock}>
          <Text style={styles.cardName}>{card.name}</Text>
          <Text style={styles.cardMeta}>{card.setName} · {card.number}</Text>
          <View style={styles.tagRow}>
            <View style={[styles.tag, { backgroundColor: C.muted }]}>
              <Text style={styles.tagText}>{RARITY_LABELS[card.rarity]}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: C.muted }]}>
              <Text style={styles.tagText}>{card.year}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: C.muted }]}>
              <Text style={styles.tagText}>
                {card.tcg === 'pokemon' ? 'Pokémon' : card.tcg === 'magic' ? 'MTG' : 'One Piece'}
              </Text>
            </View>
          </View>
        </View>

        {/* Condition/grade price tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.priceTabs}
          contentContainerStyle={styles.priceTabsContent}
        >
          {PRICE_TABS.map(t => {
            const price = getTabPrice(card, t);
            if (!price) return null;
            return (
              <Pressable
                key={t}
                onPress={() => setPriceTab(t)}
                style={[
                  styles.priceTab,
                  priceTab === t && { borderColor: C.primary, backgroundColor: `${C.primary}18` },
                ]}
              >
                <Text style={[styles.priceTabLabel, priceTab === t && { color: C.primary }]}>{t}</Text>
                <Text style={[styles.priceTabValue, priceTab === t && { color: C.foreground }]}>
                  ${price.toLocaleString('en-AU')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Market value card */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.marketHeader}>
            <View>
              <Text style={styles.marketLabel}>Market Value</Text>
              <Text style={styles.marketValue}>
                ${activePrice?.toLocaleString('en-AU', { minimumFractionDigits: 2 }) ?? '—'} AUD
              </Text>
            </View>
            <View style={styles.changeCol}>
              {gain24h !== undefined && (
                <Text style={[styles.changeBadge, { color: gain24h >= 0 ? C.positive : C.negative }]}>
                  {gain24h >= 0 ? '+' : ''}{gain24h.toFixed(1)}% 24h
                </Text>
              )}
              {gain7d !== undefined && (
                <Text style={[styles.changeBadge, { color: gain7d >= 0 ? C.positive : C.negative }]}>
                  {gain7d >= 0 ? '+' : ''}{gain7d.toFixed(1)}% 7d
                </Text>
              )}
            </View>
          </View>

          {/* Bar chart */}
          <View style={styles.chartWrap}>
            <View style={styles.chartLine}>
              {Array.from({ length: 20 }, (_, i) => {
                const noise = Math.sin(i * 0.8 + 1.5) * 0.3 + Math.sin(i * 0.3) * 0.5 + i / 20;
                const h = Math.max(12 + noise * 30, 4);
                return (
                  <View
                    key={i}
                    style={[
                      styles.chartBar,
                      {
                        height: h,
                        backgroundColor: (gain7d ?? 0) >= 0 ? `${C.positive}99` : `${C.negative}99`,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Raw</Text>
              <Text style={styles.statValue}>${card.price.raw.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>PSA 10</Text>
              <Text style={styles.statValue}>
                {card.price.psa10 ? `$${card.price.psa10.toLocaleString()}` : '—'}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>30d Change</Text>
              <Text style={[
                styles.statValue,
                { color: (card.price.change30d ?? 0) >= 0 ? C.positive : C.negative },
              ]}>
                {card.price.change30d !== undefined
                  ? `${card.price.change30d >= 0 ? '+' : ''}${card.price.change30d.toFixed(1)}%`
                  : '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            onPress={handleAddToCollection}
            style={[styles.primaryBtn, isOwned && { backgroundColor: C.muted }]}
            disabled={isOwned}
          >
            <Feather name={isOwned ? 'check' : 'plus'} size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>{isOwned ? 'In Collection' : 'Add to Collection'}</Text>
          </Pressable>
          <Pressable
            onPress={handleWatch}
            style={[styles.secondaryBtn, isWatched && { borderColor: C.primary }]}
          >
            <Feather name="heart" size={18} color={isWatched ? C.primary : C.foreground} />
          </Pressable>
        </View>

        {/* For Sale listings */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Cards For Sale</Text>
            <Text style={styles.sectionCount}>{allListings.length} listing{allListings.length !== 1 ? 's' : ''}</Text>
          </View>
          {allListings.map(listing => (
            <Pressable key={listing.id} style={[styles.listingRow, { backgroundColor: C.card }]}>
              <View style={styles.listingLeft}>
                <Text style={styles.listingSellerName}>{listing.sellerName}</Text>
                <View style={styles.listingMeta}>
                  {listing.grading && (
                    <GradeBadge grade={listing.grading.grade} company={listing.grading.company} size="sm" />
                  )}
                  {listing.isVerifiedSeller && (
                    <View style={styles.verifiedTag}>
                      <Feather name="shield" size={11} color={C.positive} />
                      <Text style={[styles.verifiedTagText, { color: C.positive }]}>Verified</Text>
                    </View>
                  )}
                  {listing.sellerRating && (
                    <View style={styles.ratingRow}>
                      <Feather name="star" size={11} color="#F59E0B" />
                      <Text style={styles.ratingText}>{listing.sellerRating.toFixed(1)}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.listingWatchers}>
                  {listing.watchCount} watching · {listing.views} views
                </Text>
              </View>
              <View style={styles.listingRight}>
                <Text style={styles.listingPrice}>${listing.askingPrice.toLocaleString('en-AU')}</Text>
                <Text style={styles.listingCurrency}>AUD</Text>
                <Pressable style={styles.buyBtn}>
                  <Text style={styles.buyBtnText}>Buy</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Added banner */}
      {showAddedBanner && (
        <View style={styles.banner}>
          <Feather name="check-circle" size={16} color={C.positive} />
          <Text style={styles.bannerText}>Added to collection!</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 20 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  navRight: { flexDirection: 'row', gap: 8 },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardStage: { alignItems: 'center', marginBottom: 24 },
  cardVisual: {
    width: W * 0.55,
    height: W * 0.55 * 1.4,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 20,
    overflow: 'hidden',
    transform: [{ rotate: '2deg' }],
  },
  cardSheen: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cardNumberBadge: { position: 'absolute', top: 12, left: 14 },
  cardNumberText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.7)',
  },
  cardInitialLarge: {
    fontSize: 72,
    fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.25)',
  },
  verifiedOverlay: { position: 'absolute', top: 10, right: 10 },
  titleBlock: { marginBottom: 20 },
  cardName: {
    fontSize: 26,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
  },
  cardMeta: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 2,
    marginBottom: 10,
  },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  priceTabs: { marginBottom: 20 },
  priceTabsContent: { gap: 8, paddingRight: 4 },
  priceTab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: 'center',
    minWidth: 80,
  },
  priceTabLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    marginBottom: 3,
  },
  priceTabValue: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
  },
  card: { borderRadius: 16, padding: 18, marginBottom: 16 },
  marketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  marketLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  marketValue: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    letterSpacing: -0.5,
  },
  changeCol: { alignItems: 'flex-end', gap: 4 },
  changeBadge: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  chartWrap: { height: 52, marginVertical: 16 },
  chartLine: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  chartBar: { flex: 1, borderRadius: 2, minHeight: 4 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center' },
  statLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  statValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.primary,
  },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  secondaryBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  sectionCount: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingRow: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listingLeft: { flex: 1, gap: 5 },
  listingSellerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listingMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  verifiedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedTagText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  listingWatchers: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingRight: { alignItems: 'flex-end', gap: 4 },
  listingPrice: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  listingCurrency: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  buyBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  buyBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  banner: {
    position: 'absolute',
    bottom: 100,
    left: 40,
    right: 40,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  bannerText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
