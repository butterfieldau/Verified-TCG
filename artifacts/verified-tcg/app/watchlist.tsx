import React, { useState } from 'react';
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
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import type { WatchlistItem } from '@/types';

const C = colors.dark;

function WatchCard({ item, onRemove }: { item: WatchlistItem; onRemove: () => void }) {
  const price = item.card.price.raw;
  const change = item.card.price.change7d ?? 0;
  const isUp = change >= 0;

  const atTarget = item.targetPrice ? price <= item.targetPrice : false;

  return (
    <Pressable
      onPress={() => router.push(`/card/${item.card.id}` as any)}
      style={({ pressed }) => [
        styles.watchCard,
        { backgroundColor: pressed ? C.muted : C.card },
      ]}
    >
      {/* Card thumb */}
      <View style={[styles.thumb, { backgroundColor: item.card.gradientStart }]}>
        <Text style={styles.thumbInitial}>{item.card.name[0]}</Text>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.cardName} numberOfLines={1}>{item.card.name}</Text>
        <Text style={styles.cardSet} numberOfLines={1}>{item.card.setName}</Text>

        {/* Target row */}
        {item.targetPrice && (
          <View style={styles.targetRow}>
            <Feather name="target" size={11} color={atTarget ? C.positive : C.mutedForeground} />
            <Text style={[styles.targetText, atTarget && { color: C.positive }]}>
              Target: ${item.targetPrice.toLocaleString('en-AU')} AUD
            </Text>
            {atTarget && (
              <View style={[styles.targetMet, { backgroundColor: `${C.positive}22` }]}>
                <Text style={[styles.targetMetText, { color: C.positive }]}>At target</Text>
              </View>
            )}
          </View>
        )}

        {/* Alert badge */}
        {item.priceAlertEnabled && (
          <View style={styles.alertRow}>
            <Feather name="bell" size={11} color={C.primary} />
            <Text style={styles.alertText}>Price alert active</Text>
          </View>
        )}
      </View>

      {/* Pricing */}
      <View style={styles.pricing}>
        <Text style={styles.price}>${price.toLocaleString('en-AU')}</Text>
        <View style={[
          styles.changePill,
          { backgroundColor: isUp ? `${C.positive}22` : `${C.negative}22` },
        ]}>
          <Feather
            name={isUp ? 'trending-up' : 'trending-down'}
            size={11}
            color={isUp ? C.positive : C.negative}
          />
          <Text style={[styles.changeText, { color: isUp ? C.positive : C.negative }]}>
            {isUp ? '+' : ''}{change.toFixed(1)}%
          </Text>
        </View>
        <Pressable onPress={onRemove} style={styles.removeBtn} hitSlop={8}>
          <Feather name="x" size={14} color={C.mutedForeground} />
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const { watchlist, removeFromWatchlist } = useApp();
  const [sortBy, setSortBy] = useState<'added' | 'value' | 'change'>('added');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const sorted = [...watchlist].sort((a, b) => {
    if (sortBy === 'value') return b.card.price.raw - a.card.price.raw;
    if (sortBy === 'change') return (b.card.price.change7d ?? 0) - (a.card.price.change7d ?? 0);
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  const alertsActive = watchlist.filter(w => w.priceAlertEnabled).length;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Watchlist</Text>
        <View style={[styles.countBadge, { backgroundColor: C.card }]}>
          <Text style={styles.countText}>{watchlist.length}</Text>
        </View>
      </View>

      {/* Alerts strip */}
      {alertsActive > 0 && (
        <View style={[styles.alertsStrip, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}>
          <Feather name="bell" size={15} color={C.primary} />
          <Text style={styles.alertsText}>
            {alertsActive} price {alertsActive === 1 ? 'alert' : 'alerts'} active
          </Text>
          <Text style={styles.alertsSub}>Notifications will be sent when targets are reached</Text>
        </View>
      )}

      {watchlist.length === 0 ? (
        // ── Empty state ─────────────────────────────────────────────────────
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: C.card }]}>
            <Feather name="eye" size={36} color={C.mutedForeground} />
          </View>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>
            Watch cards you're interested in and they'll appear here. You can set target prices and enable price alerts.
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)/market' as any)}
            style={[styles.emptyBtn, { backgroundColor: C.primary }]}
          >
            <Feather name="trending-up" size={16} color="#FFFFFF" />
            <Text style={styles.emptyBtnText}>Browse Market</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/search' as any)}
            style={[styles.emptyBtnSecondary, { backgroundColor: C.card }]}
          >
            <Text style={styles.emptyBtnSecondaryText}>Search Cards</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Sort controls */}
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Sort by:</Text>
            {(['added', 'value', 'change'] as const).map(s => (
              <Pressable
                key={s}
                onPress={() => setSortBy(s)}
                style={[
                  styles.sortChip,
                  sortBy === s && { backgroundColor: C.primary },
                  sortBy !== s && { backgroundColor: C.card },
                ]}
              >
                <Text style={[styles.sortChipText, sortBy === s && { color: '#FFFFFF' }]}>
                  {s === 'added' ? 'Recent' : s === 'value' ? 'Value' : '7d Change'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Cards */}
          {sorted.map(item => (
            <WatchCard
              key={item.id}
              item={item}
              onRemove={() => removeFromWatchlist(item.id)}
            />
          ))}

          {/* Footer info */}
          <Text style={styles.footerNote}>
            Prices shown are estimated market values. Future backend will support live price alerts and real-time data.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  countText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  alertsStrip: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 4,
    flexDirection: 'column',
  },
  alertsText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  alertsSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 17 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sortLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  sortChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  watchCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  thumb: {
    width: 54,
    height: 76,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbInitial: { fontSize: 24, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  info: { flex: 1, gap: 4 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  targetText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  targetMet: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  targetMetText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  alertText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.primary },
  pricing: { alignItems: 'flex-end', gap: 6 },
  price: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  changeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  removeBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 14,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  emptyBtnSecondary: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
  },
  emptyBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  footerNote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}88`,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
});
