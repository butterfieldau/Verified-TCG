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

const C = colors.dark;

// ── Allocation mock data ─────────────────────────────────────────────────────

const TCG_ALLOCATION = [
  { label: 'Pokémon', pct: 68, color: '#FFCC00', value: 16898 },
  { label: 'One Piece', pct: 18, color: '#EF4444', value: 4473 },
  { label: 'MTG', pct: 14, color: '#3B82F6', value: 3479 },
];

const CONDITION_ALLOCATION = [
  { label: 'Graded', pct: 72, color: C.primary, value: 17892 },
  { label: 'Raw', pct: 28, color: C.mutedForeground, value: 6958 },
];

const GRADE_CO_ALLOCATION = [
  { label: 'PSA', pct: 54, color: '#FF1E2D', value: 13419 },
  { label: 'BGS', pct: 28, color: '#D4AF37', value: 6958 },
  { label: 'CGC', pct: 18, color: '#4A90D9', value: 4473 },
];

const VALUE_TIER_ALLOCATION = [
  { label: '$1k+', pct: 45, color: '#22C55E', value: 11183 },
  { label: '$500–$1k', pct: 30, color: '#3B82F6', value: 7455 },
  { label: '$100–$500', pct: 18, color: '#F59E0B', value: 4473 },
  { label: 'Under $100', pct: 7, color: C.mutedForeground, value: 1739 },
];

const TOP_PERFORMERS = [
  { name: 'Umbreon ex PSA 10', gain: 42.3, value: 1480, change: '+$437' },
  { name: 'Monkey D. Luffy CGC 10', gain: 28.1, value: 95, change: '+$21' },
  { name: 'Charizard ex PSA 10', gain: 22.6, value: 580, change: '+$107' },
];

type AllocTab = 'tcg' | 'condition' | 'grade_co' | 'value_tier';

const ALLOC_TABS: { label: string; value: AllocTab }[] = [
  { label: 'TCG', value: 'tcg' },
  { label: 'Raw vs Graded', value: 'condition' },
  { label: 'Grading Co.', value: 'grade_co' },
  { label: 'Value Tier', value: 'value_tier' },
];

function getAllocData(tab: AllocTab) {
  if (tab === 'tcg') return TCG_ALLOCATION;
  if (tab === 'condition') return CONDITION_ALLOCATION;
  if (tab === 'grade_co') return GRADE_CO_ALLOCATION;
  return VALUE_TIER_ALLOCATION;
}

// ── Bar allocation chart ─────────────────────────────────────────────────────
function AllocationBar({ data }: { data: typeof TCG_ALLOCATION }) {
  return (
    <View style={styles.allocBar}>
      {data.map((d, i) => (
        <View
          key={d.label}
          style={[
            styles.allocSegment,
            {
              flex: d.pct,
              backgroundColor: d.color,
              borderTopLeftRadius: i === 0 ? 6 : 0,
              borderBottomLeftRadius: i === 0 ? 6 : 0,
              borderTopRightRadius: i === data.length - 1 ? 6 : 0,
              borderBottomRightRadius: i === data.length - 1 ? 6 : 0,
            },
          ]}
        />
      ))}
    </View>
  );
}

function AllocationLegend({ data }: { data: typeof TCG_ALLOCATION }) {
  return (
    <View style={styles.legend}>
      {data.map(d => (
        <View key={d.label} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: d.color }]} />
          <Text style={styles.legendLabel}>{d.label}</Text>
          <Text style={styles.legendPct}>{d.pct}%</Text>
          <Text style={styles.legendValue}>${d.value.toLocaleString('en-AU')}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PortfolioScreen() {
  const insets = useSafeAreaInsets();
  const { portfolio } = useApp();
  const [allocTab, setAllocTab] = useState<AllocTab>('tcg');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const isPositive = portfolio.totalGain >= 0;
  const allocData = getAllocData(allocTab);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Portfolio</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Hero value */}
      <View style={[styles.heroCard, { backgroundColor: C.card }]}>
        <Text style={styles.heroLabel}>TOTAL VALUE</Text>
        <Text style={styles.heroValue}>
          ${portfolio.totalValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })} AUD
        </Text>
        <View style={styles.heroRow}>
          <View style={[styles.gainPill, { backgroundColor: isPositive ? `${C.positive}22` : `${C.negative}22` }]}>
            <Feather
              name={isPositive ? 'trending-up' : 'trending-down'}
              size={13}
              color={isPositive ? C.positive : C.negative}
            />
            <Text style={[styles.gainPct, { color: isPositive ? C.positive : C.negative }]}>
              {isPositive ? '+' : ''}{portfolio.totalGainPercent.toFixed(2)}%
            </Text>
          </View>
          <Text style={[styles.gainAbs, { color: isPositive ? C.positive : C.negative }]}>
            {isPositive ? '+' : ''}${Math.abs(portfolio.totalGain).toLocaleString('en-AU', { minimumFractionDigits: 2 })} AUD
          </Text>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: C.card }]}>
          <Text style={styles.statLabel}>INVESTED</Text>
          <Text style={styles.statVal}>${portfolio.totalCost.toLocaleString('en-AU', { minimumFractionDigits: 0 })}</Text>
          <Text style={styles.statSub}>Total cost basis</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.card }]}>
          <Text style={styles.statLabel}>PROFIT / LOSS</Text>
          <Text style={[styles.statVal, { color: isPositive ? C.positive : C.negative }]}>
            {isPositive ? '+' : ''}${portfolio.totalGain.toLocaleString('en-AU', { minimumFractionDigits: 0 })}
          </Text>
          <Text style={styles.statSub}>Unrealised gain</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.card }]}>
          <Text style={styles.statLabel}>TOTAL CARDS</Text>
          <Text style={styles.statVal}>{portfolio.cardCount}</Text>
          <Text style={styles.statSub}>{portfolio.uniqueCardCount} unique</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.card }]}>
          <Text style={styles.statLabel}>GRADED</Text>
          <Text style={styles.statVal}>4</Text>
          <Text style={styles.statSub}>PSA / BGS / CGC</Text>
        </View>
      </View>

      {/* Best performers */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Performers</Text>
        {TOP_PERFORMERS.map((p, i) => (
          <View key={i} style={[styles.performerRow, { backgroundColor: C.card }]}>
            <View style={styles.performerRank}>
              <Text style={styles.performerRankText}>{i + 1}</Text>
            </View>
            <View style={styles.performerInfo}>
              <Text style={styles.performerName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.performerValue}>${p.value.toLocaleString('en-AU')}</Text>
            </View>
            <View style={styles.performerRight}>
              <Text style={[styles.performerGain, { color: C.positive }]}>+{p.gain}%</Text>
              <Text style={[styles.performerAbs, { color: C.positive }]}>{p.change}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Allocation */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Allocation</Text>

        {/* Alloc tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.allocTabsRow}>
          {ALLOC_TABS.map(t => (
            <Pressable
              key={t.value}
              onPress={() => setAllocTab(t.value)}
              style={[
                styles.allocTab,
                allocTab === t.value && { backgroundColor: C.primary },
              ]}
            >
              <Text style={[styles.allocTabText, allocTab === t.value && { color: '#FFFFFF' }]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[styles.allocCard, { backgroundColor: C.card }]}>
          <AllocationBar data={allocData} />
          <AllocationLegend data={allocData} />
        </View>
      </View>

      {/* Largest holdings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Largest Holdings</Text>
        {[
          { name: 'Umbreon ex', grade: 'PSA 10', pct: 5.95, value: 1480 },
          { name: 'Charizard ex', grade: 'PSA 10', pct: 2.33, value: 580 },
          { name: 'Rayquaza VMAX', grade: 'BGS 9.5', pct: 2.90, value: 720 },
          { name: 'Luffy Manga', grade: 'CGC 10', pct: 0.38, value: 95 },
        ].map((h, i) => (
          <View key={i} style={[styles.holdingRow, { backgroundColor: C.card }]}>
            <View style={styles.holdingInfo}>
              <Text style={styles.holdingName}>{h.name}</Text>
              <Text style={styles.holdingGrade}>{h.grade}</Text>
            </View>
            <View style={styles.holdingRight}>
              <Text style={styles.holdingValue}>${h.value.toLocaleString('en-AU')}</Text>
              <Text style={styles.holdingPct}>{h.pct}% of portfolio</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  heroCard: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  heroLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 2,
    marginBottom: 6,
  },
  heroValue: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    letterSpacing: -1,
    marginBottom: 10,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  gainPct: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  gainAbs: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  statLabel: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.5,
  },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  statSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  section: { paddingHorizontal: 20, marginBottom: 28 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 14 },
  performerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    marginBottom: 8,
  },
  performerRank: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  performerRankText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },
  performerInfo: { flex: 1 },
  performerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  performerValue: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  performerRight: { alignItems: 'flex-end' },
  performerGain: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  performerAbs: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  allocTabsRow: { marginBottom: 14 },
  allocTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.card,
    marginRight: 8,
  },
  allocTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  allocCard: { borderRadius: 16, padding: 18 },
  allocBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 20,
    gap: 2,
  },
  allocSegment: { height: '100%' },
  legend: { gap: 12 },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.foreground },
  legendPct: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground, width: 40, textAlign: 'right' },
  legendValue: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, width: 80, textAlign: 'right' },
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  holdingInfo: { flex: 1 },
  holdingName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  holdingGrade: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  holdingRight: { alignItems: 'flex-end' },
  holdingValue: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  holdingPct: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
});
