import React, { useState, useMemo, useCallback } from 'react';
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
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import { getItemCurrentValue } from '@/services/collection';
import { formatPrice } from '@/utils/currency';
import colors from '@/constants/colors';
import type { CollectionItem, TCGId } from '@/types';

const C = colors.dark;

// ── Helpers ──────────────────────────────────────────────────────────────────

const TCG_META: Record<TCGId, { label: string; color: string }> = {
  pokemon:     { label: 'Pokémon',     color: '#FFCC00' },
  onepiece:    { label: 'One Piece',   color: '#EF4444' },
  magic:       { label: 'MTG',         color: '#3B82F6' },
  yugioh:      { label: 'Yu-Gi-Oh',   color: '#9333EA' },
  lorcana:     { label: 'Lorcana',    color: '#EC4899' },
  dragonball:  { label: 'Dragon Ball', color: '#F97316' },
};

const GRADE_CO_META: Record<string, { color: string }> = {
  PSA: { color: '#FF1E2D' },
  BGS: { color: '#D4AF37' },
  CGC: { color: '#4A90D9' },
};

type AllocRow = { label: string; pct: number; color: string; value: number };

function buildAllocation(
  items: CollectionItem[],
  totalValue: number,
  groupFn: (item: CollectionItem) => { key: string; label: string; color: string } | null,
): AllocRow[] {
  const map = new Map<string, { label: string; color: string; value: number }>();
  for (const item of items) {
    const g = groupFn(item);
    if (!g) continue;
    const unitValue = getItemCurrentValue(item);
    if (unitValue == null) continue;
    const v = unitValue * item.quantity;
    const existing = map.get(g.key);
    if (existing) {
      existing.value += v;
    } else {
      map.set(g.key, { label: g.label, color: g.color, value: v });
    }
  }
  const rows: AllocRow[] = [...map.values()]
    .map(r => ({
      label: r.label,
      color: r.color,
      value: r.value,
      pct: totalValue > 0 ? Math.round((r.value / totalValue) * 100) : 0,
    }))
    .filter(r => r.pct > 0)
    .sort((a, b) => b.value - a.value);
  return rows;
}

type AllocTab = 'tcg' | 'condition' | 'grade_co' | 'value_tier';

// ── Bar allocation chart ─────────────────────────────────────────────────────
function AllocationBar({ data }: { data: AllocRow[] }) {
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

function AllocationLegend({ data, currency }: { data: AllocRow[]; currency: import('@/services/settingsStore').CurrencyCode }) {
  return (
    <View style={styles.legend}>
      {data.map(d => (
        <View key={d.label} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: d.color }]} />
          <Text style={styles.legendLabel}>{d.label}</Text>
          <Text style={styles.legendPct}>{d.pct}%</Text>
          <Text style={styles.legendValue}>{formatPrice(d.value, currency)}</Text>
        </View>
      ))}
    </View>
  );
}

const ALLOC_TABS: { label: string; value: AllocTab }[] = [
  { label: 'TCG', value: 'tcg' },
  { label: 'Raw vs Graded', value: 'condition' },
  { label: 'Grading Co.', value: 'grade_co' },
  { label: 'Value Tier', value: 'value_tier' },
];

function formatLastUpdated(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export default function PortfolioScreen() {
  const insets = useSafeAreaInsets();
  const { portfolio, collection, refreshPrices, pricesLastUpdated } = useApp();
  const { currency } = useSettings();
  const [allocTab, setAllocTab] = useState<AllocTab>('tcg');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshPrices();
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshPrices]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const isPositive = portfolio.totalGain >= 0;
  const totalValue = portfolio.totalValue;

  // ── Derived allocation data ────────────────────────────────────────────────

  const tcgAllocation = useMemo(() => buildAllocation(collection, totalValue, item => {
    const meta = TCG_META[item.card.tcg];
    return meta ? { key: item.card.tcg, label: meta.label, color: meta.color } : null;
  }), [collection, totalValue]);

  const conditionAllocation = useMemo(() => buildAllocation(collection, totalValue, item => {
    const isGraded = !!item.grading;
    return isGraded
      ? { key: 'graded', label: 'Graded', color: C.primary }
      : { key: 'raw', label: 'Raw', color: C.mutedForeground };
  }), [collection, totalValue]);

  const gradeCoAllocation = useMemo(() => buildAllocation(collection, totalValue, item => {
    if (!item.grading) return null;
    const co = item.grading.company;
    const meta = GRADE_CO_META[co] ?? { color: C.mutedForeground };
    return { key: co, label: co, color: meta.color };
  }), [collection, totalValue]);

  const valueTierAllocation = useMemo((): AllocRow[] => {
    const tiers = [
      { key: '$1k+',      label: '$1k+',       color: '#22C55E', min: 1000, max: Infinity },
      { key: '$500–$1k',  label: '$500–$1k',   color: '#3B82F6', min: 500,  max: 1000 },
      { key: '$100–$500', label: '$100–$500',  color: '#F59E0B', min: 100,  max: 500 },
      { key: '<$100',     label: 'Under $100', color: C.mutedForeground, min: 0, max: 100 },
    ];
    const buckets = new Map(tiers.map(t => [t.key, { ...t, value: 0 }]));
    for (const item of collection) {
      const price = getItemCurrentValue(item);
      if (price == null) continue;
      const v = price * item.quantity;
      const tier = tiers.find(t => price >= t.min && price < t.max);
      if (tier) {
        const b = buckets.get(tier.key)!;
        b.value += v;
      }
    }
    return [...buckets.values()]
      .map(b => ({ label: b.label, color: b.color, value: b.value, pct: totalValue > 0 ? Math.round((b.value / totalValue) * 100) : 0 }))
      .filter(r => r.pct > 0);
  }, [collection, totalValue]);

  function getAllocData(tab: AllocTab): AllocRow[] {
    if (tab === 'tcg') return tcgAllocation;
    if (tab === 'condition') return conditionAllocation;
    if (tab === 'grade_co') return gradeCoAllocation;
    return valueTierAllocation;
  }

  const allocData = getAllocData(allocTab);

  // ── Top performers ─────────────────────────────────────────────────────────
  const topPerformers = useMemo(() => {
    return collection
      .map(item => {
        const unitValue = getItemCurrentValue(item);
        if (unitValue == null) return null;
        const currentValue = unitValue * item.quantity;
        const costBasis = item.acquiredPrice * item.quantity;
        const gainAbs = currentValue - costBasis;
        const gainPct = costBasis > 0 ? (gainAbs / costBasis) * 100 : 0;
        const grade = item.grading ? `${item.grading.company} ${item.grading.grade}` : null;
        const label = grade ? `${item.card.name} ${grade}` : item.card.name;
        return { name: label, gain: gainPct, value: currentValue, change: gainAbs };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null && p.gain > 0)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 3);
  }, [collection]);

  // ── Largest holdings ───────────────────────────────────────────────────────
  const largestHoldings = useMemo(() => {
    return collection
      .map(item => {
        const unitValue = getItemCurrentValue(item);
        if (unitValue == null) return null;
        const value = unitValue * item.quantity;
        const grade = item.grading ? `${item.grading.company} ${item.grading.grade}` : 'Raw';
        return { name: item.card.name, grade, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);
  }, [collection, totalValue]);

  // ── Graded count ───────────────────────────────────────────────────────────
  const gradedCount = useMemo(
    () => collection.filter(item => !!item.grading).reduce((sum, item) => sum + item.quantity, 0),
    [collection],
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={C.primary}
          colors={[C.primary]}
        />
      }
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
          {formatPrice(portfolio.totalValue, currency)}
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
            {isPositive ? '+' : ''}{formatPrice(Math.abs(portfolio.totalGain), currency)}
          </Text>
        </View>
        {pricesLastUpdated && (
          <Text style={styles.heroUpdated}>
            Prices as of {formatLastUpdated(pricesLastUpdated)}
          </Text>
        )}
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: C.card }]}>
          <Text style={styles.statLabel}>INVESTED</Text>
          <Text style={styles.statVal}>{formatPrice(portfolio.totalCost, currency)}</Text>
          <Text style={styles.statSub}>Total cost basis</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.card }]}>
          <Text style={styles.statLabel}>PROFIT / LOSS</Text>
          <Text style={[styles.statVal, { color: isPositive ? C.positive : C.negative }]}>
            {isPositive ? '+' : ''}{formatPrice(Math.abs(portfolio.totalGain), currency)}
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
          <Text style={styles.statVal}>{gradedCount}</Text>
          <Text style={styles.statSub}>PSA / BGS / CGC</Text>
        </View>
      </View>

      {/* Best performers */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Performers</Text>
        {topPerformers.length === 0 ? (
          <Text style={styles.emptyText}>No gains yet — add cards to see your top performers.</Text>
        ) : topPerformers.map((p, i) => (
          <View key={i} style={[styles.performerRow, { backgroundColor: C.card }]}>
            <View style={styles.performerRank}>
              <Text style={styles.performerRankText}>{i + 1}</Text>
            </View>
            <View style={styles.performerInfo}>
              <Text style={styles.performerName} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.performerValue}>{formatPrice(p.value, currency)}</Text>
            </View>
            <View style={styles.performerRight}>
              <Text style={[styles.performerGain, { color: C.positive }]}>+{p.gain.toFixed(1)}%</Text>
              <Text style={[styles.performerAbs, { color: C.positive }]}>+{formatPrice(p.change, currency)}</Text>
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

        {allocData.length === 0 ? (
          <Text style={styles.emptyText}>No cards in your collection yet — add some to see allocation.</Text>
        ) : (
          <View style={[styles.allocCard, { backgroundColor: C.card }]}>
            <AllocationBar data={allocData} />
            <AllocationLegend data={allocData} currency={currency} />
          </View>
        )}
      </View>

      {/* Largest holdings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Largest Holdings</Text>
        {largestHoldings.length === 0 ? (
          <Text style={styles.emptyText}>No cards in your collection yet — add some to see your largest holdings.</Text>
        ) : largestHoldings.map((h, i) => (
          <View key={i} style={[styles.holdingRow, { backgroundColor: C.card }]}>
            <View style={styles.holdingInfo}>
              <Text style={styles.holdingName}>{h.name}</Text>
              <Text style={styles.holdingGrade}>{h.grade}</Text>
            </View>
            <View style={styles.holdingRight}>
              <Text style={styles.holdingValue}>{formatPrice(h.value, currency)}</Text>
              <Text style={styles.holdingPct}>{h.pct.toFixed(1)}% of portfolio</Text>
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
  heroUpdated: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    opacity: 0.7,
    marginTop: 10,
  },
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
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 8 },
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
