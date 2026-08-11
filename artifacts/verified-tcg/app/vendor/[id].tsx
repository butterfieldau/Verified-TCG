import React, { useState } from 'react';
import {
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
import colors from '@/constants/colors';
import { MOCK_EVENT } from '@/services/matching';
import { getVendorWantedCards, getVendorInventoryExtras } from '@/services/event';

const C = colors.dark;

type VendorTab = 'inventory' | 'wanted' | 'about';

export default function VendorProfileScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [activeTab, setActiveTab] = useState<VendorTab>('inventory');

  const vendor = MOCK_EVENT.vendors.find(v => v.id === id || v.name.toLowerCase().replace(/\s+/g, '-') === id)
    ?? MOCK_EVENT.vendors[0];

  const TABS: { label: string; value: VendorTab }[] = [
    { label: 'Inventory', value: 'inventory' },
    { label: 'Wanted', value: 'wanted' },
    { label: 'About', value: 'about' },
  ];

  const WANTED_CARDS = getVendorWantedCards();
  const FULL_INVENTORY = [...vendor.topCards, ...getVendorInventoryExtras()];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Vendor Profile</Text>
        <Pressable style={styles.backBtn}>
          <Feather name="more-horizontal" size={20} color={C.foreground} />
        </Pressable>
      </View>

      {/* Vendor card */}
      <View style={[styles.vendorCard, { backgroundColor: C.card }]}>
        <View style={styles.vendorTop}>
          <View style={[styles.avatar, { backgroundColor: vendor.avatarColor }]}>
            <Text style={styles.avatarText}>{vendor.initials}</Text>
          </View>
          <View style={styles.vendorNameBlock}>
            <Text style={styles.vendorName}>{vendor.name}</Text>
            <View style={styles.badgesRow}>
              {vendor.isVerifiedVendor ? (
                <View style={[styles.badge, { backgroundColor: `${C.positive}22` }]}>
                  <Feather name="shield" size={11} color={C.positive} />
                  <Text style={[styles.badgeText, { color: C.positive }]}>Verified Vendor</Text>
                </View>
              ) : (
                <View style={[styles.badge, { backgroundColor: C.muted }]}>
                  <Feather name="user" size={11} color={C.mutedForeground} />
                  <Text style={[styles.badgeText, { color: C.mutedForeground }]}>Independent Seller</Text>
                </View>
              )}
              {vendor.tradeAccepted && (
                <View style={[styles.badge, { backgroundColor: '#3B82F622' }]}>
                  <Feather name="repeat" size={11} color='#3B82F6' />
                  <Text style={[styles.badgeText, { color: '#3B82F6' }]}>Trades OK</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Booth info */}
        <View style={[styles.boothBanner, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}>
          <Feather name="map-pin" size={14} color={C.primary} />
          <Text style={[styles.boothText, { color: C.primary }]}>{vendor.booth}</Text>
          <Text style={styles.boothEvent}>· {MOCK_EVENT.name}</Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBlock label="For Sale" value={String(vendor.cardsForSale)} />
          <View style={styles.divider} />
          <StatBlock label="Wanted" value={String(vendor.wantedCards)} />
          <View style={styles.divider} />
          <View style={styles.statBlock}>
            <View style={styles.ratingRow}>
              <Text style={styles.statValue}>{vendor.rating.toFixed(1)}</Text>
              <Feather name="star" size={13} color={C.warning} />
            </View>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.divider} />
          <StatBlock label="Reviews" value={String(vendor.reviewCount)} />
        </View>
      </View>

      {/* View Inventory CTA */}
      <Pressable
        onPress={() => setActiveTab('inventory')}
        style={[styles.inventoryBtn, { backgroundColor: C.primary }]}
      >
        <Feather name="package" size={16} color="#FFF" />
        <Text style={styles.inventoryBtnText}>View Inventory</Text>
      </Pressable>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsRow}>
        {TABS.map(t => (
          <Pressable
            key={t.value}
            onPress={() => setActiveTab(t.value)}
            style={[styles.tab, activeTab === t.value && { borderBottomColor: C.primary }]}
          >
            <Text style={[styles.tabText, activeTab === t.value && { color: C.foreground }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* INVENTORY */}
      {activeTab === 'inventory' && (
        <View style={styles.tabContent}>
          <Text style={styles.tabMeta}>{FULL_INVENTORY.length} cards available</Text>
          {FULL_INVENTORY.map((card, i) => (
            <View key={i} style={[styles.cardRow, { backgroundColor: C.card }]}>
              <View style={[styles.cardThumb, { backgroundColor: card.color }]}>
                <Text style={styles.cardInitial}>{card.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{card.name}</Text>
                <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                  <Text style={styles.gradePillText}>{card.grade}</Text>
                </View>
              </View>
              <View style={styles.cardPricing}>
                <Text style={styles.cardPrice}>${card.price.toLocaleString('en-AU')}</Text>
                <Pressable style={[styles.buyBtn, { backgroundColor: `${C.primary}22` }]}>
                  <Text style={[styles.buyBtnText, { color: C.primary }]}>Enquire</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* WANTED */}
      {activeTab === 'wanted' && (
        <View style={styles.tabContent}>
          <Text style={styles.tabMeta}>Cards this vendor is actively buying</Text>
          {WANTED_CARDS.map(card => (
            <View key={card.id} style={[styles.cardRow, { backgroundColor: C.card }]}>
              <View style={[styles.cardThumb, { backgroundColor: card.color }]}>
                <Text style={styles.cardInitial}>{card.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{card.name}</Text>
                <Text style={styles.cardSet}>{card.set} · {card.grade}</Text>
              </View>
              <View style={styles.cardPricing}>
                <Text style={[styles.maxBuy, { color: C.positive }]}>Up to ${card.maxBuy.toLocaleString()}</Text>
                <Pressable style={[styles.buyBtn, { backgroundColor: `${C.positive}22` }]}>
                  <Text style={[styles.buyBtnText, { color: C.positive }]}>I Have It</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ABOUT */}
      {activeTab === 'about' && (
        <View style={styles.tabContent}>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>LOCATION</Text>
            <Text style={styles.aboutValue}>{vendor.location}</Text>
          </View>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>TRADES ACCEPTED</Text>
            <Text style={styles.aboutValue}>{vendor.tradeAccepted ? 'Yes — open to fair trades' : 'No trades at this time'}</Text>
          </View>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>VERIFICATION STATUS</Text>
            <View style={[styles.badge, { backgroundColor: vendor.isVerifiedVendor ? `${C.positive}22` : C.muted, alignSelf: 'flex-start', marginTop: 4 }]}>
              <Feather name={vendor.isVerifiedVendor ? 'shield' : 'user'} size={12} color={vendor.isVerifiedVendor ? C.positive : C.mutedForeground} />
              <Text style={[styles.badgeText, { color: vendor.isVerifiedVendor ? C.positive : C.mutedForeground }]}>
                {vendor.isVerifiedVendor ? 'Verified Vendor' : 'Unverified'}
              </Text>
            </View>
          </View>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>RATING</Text>
            <View style={styles.ratingDetail}>
              <Text style={styles.ratingLarge}>{vendor.rating.toFixed(1)}</Text>
              <View>
                <View style={styles.starsRow}>
                  {[1,2,3,4,5].map(s => (
                    <Feather key={s} name="star" size={13} color={s <= Math.round(vendor.rating) ? C.warning : C.muted} />
                  ))}
                </View>
                <Text style={styles.reviewCount}>{vendor.reviewCount} reviews</Text>
              </View>
            </View>
          </View>
          {!vendor.isVerifiedVendor && (
            <View style={[styles.warningCard, { backgroundColor: `${C.warning}18`, borderColor: `${C.warning}44` }]}>
              <Feather name="alert-triangle" size={14} color={C.warning} style={{ marginTop: 1 }} />
              <Text style={[styles.warningText, { color: C.mutedForeground }]}>
                This vendor is not verified by Verified TCG. Always check cards before completing a transaction.
              </Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  vendorCard: { borderRadius: 18, padding: 18, marginBottom: 14, gap: 14 },
  vendorTop: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#FFF' },
  vendorNameBlock: { flex: 1, gap: 8 },
  vendorName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  badgesRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  boothBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10,
  },
  boothText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  boothEvent: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statBlock: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  divider: { width: 1, height: 32, backgroundColor: C.border },
  inventoryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 50, borderRadius: 14, marginBottom: 16,
  },
  inventoryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  tabsRow: { borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  tab: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 2, borderBottomColor: 'transparent', marginRight: 4,
  },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  tabContent: { paddingTop: 16, gap: 10 },
  tabMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 4 },
  cardRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, gap: 12 },
  cardThumb: { width: 50, height: 70, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardInfo: { flex: 1, gap: 6 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  gradePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  cardPricing: { alignItems: 'flex-end', gap: 6 },
  cardPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  maxBuy: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  buyBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9 },
  buyBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  aboutCard: { borderRadius: 14, padding: 16, gap: 6 },
  aboutLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 1.5 },
  aboutValue: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground, lineHeight: 22 },
  ratingDetail: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  ratingLarge: { fontSize: 36, fontFamily: 'Inter_700Bold', color: C.foreground },
  starsRow: { flexDirection: 'row', gap: 2 },
  reviewCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 4 },
  warningCard: {
    flexDirection: 'row', gap: 10, borderRadius: 12, borderWidth: 1, padding: 14,
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 19 },
});
