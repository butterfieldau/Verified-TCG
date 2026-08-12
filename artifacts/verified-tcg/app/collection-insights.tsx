/**
 * Collection Insights Pro — deep portfolio analytics for Pro users.
 * Free users see hero stats (value + count) ungated, then a ProFeaturePreview
 * gate with blurred placeholder content and an "Unlock Collection Insights" CTA.
 */

import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import ProFeaturePreview from '@/components/ui/ProFeaturePreview';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { MOCK_COLLECTION_INSIGHTS } from '@/services/collection';
import type { InsightsBreakdown, InsightsHighlight, InsightsChartPoint } from '@/services/collection';

const C = colors.dark;

const RANGE_CHIPS = ['1M', '3M', '6M', '1Y', 'ALL'] as const;
type RangeKey = (typeof RANGE_CHIPS)[number];

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function fmtDelta(n: number, pct: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${fmt(n)} (${sign}${pct.toFixed(1)}%)`;
}

// ─── Chart ─────────────────────────────────────────────────────────────────────

function MiniLineChart({ points }: { points: InsightsChartPoint[] }) {
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 280;
  const H = 80;
  const step = W / Math.max(points.length - 1, 1);

  // Build SVG-style polyline string
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = H - ((p.value - min) / range) * (H - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // First and last label for x-axis
  const firstLabel = points[0]?.date ?? '';
  const lastLabel = points[points.length - 1]?.date ?? '';
  const lastVal = values[values.length - 1] ?? 0;
  const firstVal = values[0] ?? 0;
  const isUp = lastVal >= firstVal;

  return (
    <View style={chartStyles.wrap}>
      {/* Y-axis label */}
      <View style={chartStyles.yLabels}>
        <Text style={chartStyles.axisLabel}>{fmt(max)}</Text>
        <Text style={chartStyles.axisLabel}>{fmt(min)}</Text>
      </View>

      {/* Chart area — drawn with Views as bars for RN compatibility */}
      <View style={chartStyles.barArea}>
        {points.map((p, i) => {
          const normH = Math.max(2, ((p.value - min) / range) * (H - 4));
          const isCurrent = i === points.length - 1;
          return (
            <View key={i} style={chartStyles.barCol}>
              <View
                style={[
                  chartStyles.bar,
                  {
                    height: normH,
                    backgroundColor: isUp ? C.positive : C.negative,
                    opacity: isCurrent ? 1 : 0.55,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* X-axis date labels */}
      <View style={chartStyles.xRow}>
        <Text style={chartStyles.axisLabel}>{formatDateLabel(firstLabel)}</Text>
        <Text style={chartStyles.axisLabel}>{formatDateLabel(lastLabel)}</Text>
      </View>
    </View>
  );
}

function formatDateLabel(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const y = parts[0];
  const m = parts[1];
  const d = parts[2]; // present for weekly (YYYY-MM-DD), absent for monthly (YYYY-MM)
  const mon = months[Number(m) - 1] ?? '';
  return d ? `${d} ${mon}` : `${mon} ${y}`;
}

const chartStyles = StyleSheet.create({
  wrap:    { width: '100%' },
  yLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  axisLabel: { fontSize: 10, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
  barArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 80,
    gap: 2,
    marginBottom: 4,
  },
  barCol: { flex: 1, justifyContent: 'flex-end' },
  bar:    { width: '100%', borderRadius: 2 },
  xRow:   { flexDirection: 'row', justifyContent: 'space-between' },
});

// ─── Highlight card ────────────────────────────────────────────────────────────

function HighlightCard({ item }: { item: InsightsHighlight }) {
  const isUp = item.valueDelta >= 0;
  const deltaColor = isUp ? C.positive : C.negative;
  return (
    <View style={hStyles.card}>
      <Text style={hStyles.hlLabel}>{item.label}</Text>
      <Text style={hStyles.cardName} numberOfLines={2}>{item.cardName}</Text>
      <Text style={hStyles.setName} numberOfLines={1}>{item.set}</Text>
      <Text style={[hStyles.delta, { color: deltaColor }]}>
        {isUp ? '+' : ''}{item.deltaPercent.toFixed(0)}%
      </Text>
      <Text style={[hStyles.deltaAbs, { color: deltaColor }]}>
        {isUp ? '+' : ''}{fmt(item.valueDelta)}
      </Text>
    </View>
  );
}

const hStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    gap: 3,
    minHeight: 110,
  },
  hlLabel:  { fontSize: 10, color: C.mutedForeground, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  cardName: { fontSize: 13, color: C.foreground, fontFamily: 'Inter_600SemiBold', lineHeight: 17 },
  setName:  { fontSize: 11, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
  delta:    { fontSize: 18, fontFamily: 'Rajdhani_700Bold', marginTop: 6 },
  deltaAbs: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});

// ─── Breakdown row ─────────────────────────────────────────────────────────────

function BreakdownSection({ title, rows }: { title: string; rows: InsightsBreakdown[] }) {
  return (
    <View style={bStyles.section}>
      <Text style={bStyles.sectionTitle}>{title}</Text>
      {/* Segmented bar */}
      <View style={bStyles.barTrack}>
        {rows.map(r => (
          <View
            key={r.label}
            style={[bStyles.barSegment, { flex: r.percent, backgroundColor: r.color }]}
          />
        ))}
      </View>
      {/* Legend pills */}
      <View style={bStyles.pills}>
        {rows.map(r => (
          <View key={r.label} style={bStyles.pill}>
            <View style={[bStyles.dot, { backgroundColor: r.color }]} />
            <Text style={bStyles.pillLabel}>{r.label}</Text>
            <Text style={bStyles.pillPct}>{r.percent}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const bStyles = StyleSheet.create({
  section:      { marginBottom: 20 },
  sectionTitle: { fontSize: 13, color: C.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  barTrack:     { flexDirection: 'row', height: 8, borderRadius: 6, overflow: 'hidden', gap: 1, marginBottom: 10 },
  barSegment:   { height: '100%' },
  pills:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:         { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  dot:          { width: 7, height: 7, borderRadius: 4 },
  pillLabel:    { fontSize: 12, color: C.foreground, fontFamily: 'Inter_400Regular' },
  pillPct:      { fontSize: 12, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
});

// ─── Gains row ────────────────────────────────────────────────────────────────

function GainsRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={gStyles.row}>
      <Text style={gStyles.label}>{label}</Text>
      <Text style={[gStyles.value, color ? { color } : null]}>{fmt(value)}</Text>
    </View>
  );
}

const gStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { fontSize: 14, color: C.foreground, fontFamily: 'Inter_400Regular' },
  value: { fontSize: 16, color: C.foreground, fontFamily: 'Rajdhani_700Bold' },
});

// ─── Placeholder used as ProFeaturePreview previewContent ─────────────────────

function BlurredPlaceholder() {
  return (
    <View style={{ gap: 16 }}>
      {/* Fake chart */}
      <View style={[phStyles.block, { height: 110 }]} />
      {/* Fake highlights grid */}
      <View style={phStyles.row}>
        <View style={[phStyles.block, { flex: 1, height: 90 }]} />
        <View style={[phStyles.block, { flex: 1, height: 90 }]} />
      </View>
      <View style={phStyles.row}>
        <View style={[phStyles.block, { flex: 1, height: 90 }]} />
        <View style={[phStyles.block, { flex: 1, height: 90 }]} />
      </View>
      {/* Fake breakdown */}
      <View style={[phStyles.block, { height: 60 }]} />
      {/* Fake gains rows */}
      <View style={[phStyles.block, { height: 40 }]} />
      <View style={[phStyles.block, { height: 40 }]} />
      <View style={[phStyles.block, { height: 40 }]} />
    </View>
  );
}

const phStyles = StyleSheet.create({
  block: { backgroundColor: C.surface, borderRadius: 12 },
  row:   { flexDirection: 'row', gap: 10 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CollectionInsightsScreen() {
  const insets = useSafeAreaInsets();
  const { subscriptionTier } = useApp();
  const [range, setRange] = useState<RangeKey>('3M');

  const d = MOCK_COLLECTION_INSIGHTS;
  const chartPoints = d.chartData[range] ?? [];
  const isUp = d.estimatedGain >= 0;

  // ── Pro content (unlocked) ────────────────────────────────────────────────

  const proContent = (
    <>
      {/* ── Historical Chart ─────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>PORTFOLIO HISTORY</Text>
        {/* Range chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 16 }}
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {RANGE_CHIPS.map(chip => (
            <Pressable
              key={chip}
              onPress={() => setRange(chip)}
              style={[styles.chip, range === chip && styles.chipActive]}
            >
              <Text style={[styles.chipText, range === chip && styles.chipTextActive]}>{chip}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <MiniLineChart points={chartPoints} />
      </View>

      {/* ── Highlights ───────────────────────────── */}
      <Text style={styles.sectionHeader}>Highlights</Text>
      <View style={styles.highlightGrid}>
        <HighlightCard item={d.highlights.bestPerformer} />
        <HighlightCard item={d.highlights.fastestGrowing} />
      </View>
      <View style={[styles.highlightGrid, { marginTop: 10 }]}>
        <HighlightCard item={d.highlights.mostValuable} />
        <HighlightCard item={d.highlights.biggestDecline} />
      </View>

      {/* ── Breakdown ────────────────────────────── */}
      <Text style={[styles.sectionHeader, { marginTop: 24 }]}>Breakdown</Text>
      <View style={styles.card}>
        <BreakdownSection title="Raw vs Graded" rows={d.breakdown.rawVsGraded} />
        <BreakdownSection title="TCG Allocation" rows={d.breakdown.tcgAllocation} />
        <BreakdownSection title="Set Allocation" rows={d.breakdown.setAllocation} />
        <BreakdownSection title="Grading Company" rows={d.breakdown.gradingCompany} />
      </View>

      {/* ── Gains ────────────────────────────────── */}
      <Text style={[styles.sectionHeader, { marginTop: 24 }]}>Gains</Text>
      <View style={styles.card}>
        <GainsRow label="Realised Gains" value={d.gains.realisedGains} color={C.positive} />
        <GainsRow label="Unrealised Gains" value={d.gains.unrealisedGains} color={C.positive} />
        <GainsRow label="Avg. Purchase Price" value={d.gains.avgPurchasePrice} />
      </View>
    </>
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Collection Insights</Text>
          {subscriptionTier === 'pro' && (
            <View style={styles.proBadge}>
              <Text style={styles.proBadgeText}>PRO</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Hero stats — always visible ────────────────────────────────────── */}
      <View style={styles.heroCard}>
        <View style={styles.heroRow}>
          <View style={styles.heroStat}>
            <Text style={styles.heroLabel}>Portfolio Value</Text>
            <Text style={styles.heroValue}>{fmt(d.portfolioValue)}</Text>
            <Text style={styles.heroCurrency}>AUD</Text>
          </View>
          <View style={[styles.heroStat, styles.heroBorder]}>
            <Text style={styles.heroLabel}>Total Invested</Text>
            <Text style={styles.heroValue}>{fmt(d.totalInvested)}</Text>
            <Text style={styles.heroCurrency}>AUD</Text>
          </View>
        </View>

        {/* Gain strip */}
        <View style={[styles.gainStrip, { backgroundColor: isUp ? '#22C55E18' : '#EF444418' }]}>
          <Feather
            name={isUp ? 'trending-up' : 'trending-down'}
            size={15}
            color={isUp ? C.positive : C.negative}
          />
          <Text style={[styles.gainText, { color: isUp ? C.positive : C.negative }]}>
            {fmtDelta(d.estimatedGain, d.estimatedGainPercent)}
          </Text>
          <Text style={styles.gainSubText}>estimated gain</Text>
        </View>

        {/* Card count */}
        <View style={styles.countRow}>
          <Feather name="layers" size={13} color={C.mutedForeground} />
          <Text style={styles.countText}>{d.cardCount} cards in collection</Text>
        </View>
      </View>

      {/* ── Pro gated content ───────────────────────────────────────────────── */}
      <ProFeaturePreview
        featureTitle="Collection Insights"
        description="Unlock portfolio history, highlights, gains breakdowns, and more — available with Verified TCG Pro."
        ctaLabel="Unlock Collection Insights"
        previewContent={<BlurredPlaceholder />}
        lockedContent={proContent}
      />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:  { flex: 1 },
  content: { paddingHorizontal: 20, gap: 0 },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, justifyContent: 'center', alignItems: 'center' },
  headerText:  { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  title:       { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: 0.3 },
  proBadge:    { backgroundColor: C.primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  proBadgeText:{ fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 1 },

  // Hero card
  heroCard:    { backgroundColor: C.card, borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  heroRow:     { flexDirection: 'row' },
  heroStat:    { flex: 1, padding: 18, gap: 4 },
  heroBorder:  { borderLeftWidth: 1, borderLeftColor: C.border },
  heroLabel:   { fontSize: 11, color: C.mutedForeground, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.7 },
  heroValue:   { fontSize: 26, color: C.foreground, fontFamily: 'Rajdhani_700Bold', lineHeight: 30 },
  heroCurrency:{ fontSize: 11, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },

  gainStrip:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 11, gap: 8, borderTopWidth: 1, borderTopColor: C.border },
  gainText:    { fontSize: 16, fontFamily: 'Rajdhani_700Bold' },
  gainSubText: { fontSize: 12, color: C.mutedForeground, fontFamily: 'Inter_400Regular', marginLeft: 2 },

  countRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingBottom: 14 },
  countText:   { fontSize: 12, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },

  // Section headers
  sectionHeader: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.foreground, marginBottom: 12 },

  // Card container
  card:    { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 0 },

  // Section label (inside card)
  sectionLabel: { fontSize: 11, color: C.mutedForeground, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },

  // Range chips
  chip:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface },
  chipActive:    { backgroundColor: C.primary },
  chipText:      { fontSize: 13, color: C.mutedForeground, fontFamily: 'Inter_500Medium' },
  chipTextActive:{ color: '#fff' },

  // Highlight grid
  highlightGrid: { flexDirection: 'row', gap: 10 },
});
