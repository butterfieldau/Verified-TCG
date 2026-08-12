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
import colors from '@/constants/colors';
import { MOCK_SET_COMPLETION } from '@/services/matching';
import { useApp } from '@/context/AppContext';
import ProFeaturePreview from '@/components/ui/ProFeaturePreview';

const C = colors.dark;
const set = MOCK_SET_COMPLETION;
const progress = set.owned / set.total;

export default function CompleteMySetScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [activeFilter, setActiveFilter] = useState<'all' | 'event' | 'market'>('all');
  const { subscriptionTier } = useApp();
  const isPro = subscriptionTier === 'pro';

  const filteredCards = set.missingCards.filter(c => {
    if (activeFilter === 'event') return c.availableAtEvent;
    if (activeFilter === 'market') return c.availableOnMarket;
    return true;
  });

  const setHero = (
    <>
      {/* Set hero */}
      <View style={[styles.setHero, { backgroundColor: C.card }]}>
        <View style={[styles.setIconWrap, { backgroundColor: `${set.color}22` }]}>
          <Feather name="grid" size={24} color={set.color} />
        </View>
        <View style={styles.setHeroInfo}>
          <Text style={styles.setName}>{set.setName}</Text>
          <Text style={styles.setProgress}>{set.owned} / {set.total} cards</Text>
        </View>
        <View style={[styles.pctBadge, { backgroundColor: `${set.color}22` }]}>
          <Text style={[styles.pctText, { color: set.color }]}>{(progress * 100).toFixed(1)}%</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={[styles.progressBg, { backgroundColor: C.muted }]}>
          <View style={[styles.progressFill, { backgroundColor: set.color, width: `${progress * 100}%` as any }]} />
        </View>
        <View style={styles.progressLabels}>
          <Text style={styles.progressLabel}>{set.owned} owned</Text>
          <Text style={styles.progressLabel}>{set.missingCount} missing</Text>
        </View>
      </View>
    </>
  );

  const fullContent = (
    <>
      {setHero}

      {/* Stats */}
      <View style={styles.statsRow}>
        <StatBlock
          icon="map-pin" value={set.atThisEvent} label="At This Event" color={C.primary}
          onPress={() => setActiveFilter('event')}
        />
        <StatBlock
          icon="repeat" value={set.tradeMatches} label="Trade Matches" color='#22C55E'
          onPress={() => router.push('/trade-match' as any)}
        />
        <StatBlock
          icon="shopping-bag" value={set.marketplaceListings} label="Market Listings" color='#F59E0B'
          onPress={() => setActiveFilter('market')}
        />
      </View>

      {/* Find Missing CTA */}
      <Pressable
        onPress={() => router.push('/trade-match' as any)}
        style={[styles.findBtn, { backgroundColor: C.primary }]}
      >
        <Feather name="search" size={16} color="#FFF" />
        <Text style={styles.findBtnText}>Find Missing Cards</Text>
      </Pressable>

      {/* Missing cards list */}
      <View style={styles.filterRow}>
        {(['all', 'event', 'market'] as const).map(f => (
          <Pressable
            key={f}
            onPress={() => setActiveFilter(f)}
            style={[styles.filterPill, activeFilter === f && { backgroundColor: C.primary }]}
          >
            <Text style={[styles.filterText, activeFilter === f && { color: '#FFF' }]}>
              {f === 'all' ? 'All Missing' : f === 'event' ? 'At Event' : 'Marketplace'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>MISSING CARDS ({filteredCards.length})</Text>
      <View style={{ gap: 10 }}>
        {filteredCards.map(card => (
          <View key={card.id} style={[styles.missingCard, { backgroundColor: C.card }]}>
            <View style={[styles.cardThumb, { backgroundColor: card.color }]}>
              <Text style={styles.cardInitial}>{card.name[0]}</Text>
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>{card.number} · {card.rarity}</Text>
              <Text style={styles.cardValue}>${card.estimatedValue.toLocaleString('en-AU')}</Text>
            </View>
            <View style={styles.cardBadges}>
              {card.availableAtEvent && (
                <View style={[styles.avBadge, { backgroundColor: `${C.primary}22` }]}>
                  <Feather name="map-pin" size={9} color={C.primary} />
                  <Text style={[styles.avBadgeText, { color: C.primary }]}>Event</Text>
                </View>
              )}
              {card.availableOnMarket && (
                <View style={[styles.avBadge, { backgroundColor: `${C.warning}22` }]}>
                  <Feather name="shopping-bag" size={9} color={C.warning} />
                  <Text style={[styles.avBadgeText, { color: C.warning }]}>Market</Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>
    </>
  );

  const previewContent = (
    <>
      {setHero}
      {/* Stats (preview only shows first stat) */}
      <View style={styles.statsRow}>
        <StatBlock icon="map-pin" value={set.atThisEvent} label="At This Event" color={C.primary} />
        <StatBlock icon="repeat" value={set.tradeMatches} label="Trade Matches" color='#22C55E' />
        <StatBlock icon="shopping-bag" value={set.marketplaceListings} label="Market Listings" color='#F59E0B' />
      </View>
      <Text style={styles.sectionLabel}>MISSING CARDS ({set.missingCount})</Text>
      <View style={{ gap: 10 }}>
        {set.missingCards.slice(0, 2).map(card => (
          <View key={card.id} style={[styles.missingCard, { backgroundColor: C.card }]}>
            <View style={[styles.cardThumb, { backgroundColor: card.color }]}>
              <Text style={styles.cardInitial}>{card.name[0]}</Text>
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>{card.number} · {card.rarity}</Text>
              <Text style={styles.cardValue}>${card.estimatedValue.toLocaleString('en-AU')}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Complete My Set</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProFeaturePreview
          featureTitle="Complete My Set at Event"
          description="See which missing cards from your sets are available right here at this event, including trade matches and marketplace listings."
          previewContent={previewContent}
          lockedContent={fullContent}
          ctaLabel="Unlock Complete My Set with Pro"
        />
      </ScrollView>
    </View>
  );
}

function StatBlock({ icon, value, label, color, onPress }: { icon: string; value: number; label: string; color: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.statBlock, { backgroundColor: C.card }]}>
      <Feather name={icon as any} size={16} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 },
  setHero: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16 },
  setIconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  setHeroInfo: { flex: 1 },
  setName: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  setProgress: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  pctBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  pctText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressWrap: { gap: 8 },
  progressBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  statsRow: { flexDirection: 'row', gap: 10 },
  statBlock: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center', gap: 6 },
  statValue: { fontSize: 24, fontFamily: 'Inter_700Bold', color: C.foreground },
  statLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  findBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 52, borderRadius: 14,
  },
  findBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
    backgroundColor: C.card,
  },
  filterText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  missingCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 12, gap: 12 },
  cardThumb: { width: 44, height: 62, borderRadius: 7, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  cardValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  cardBadges: { gap: 4, alignItems: 'flex-end' },
  avBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  avBadgeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
});
