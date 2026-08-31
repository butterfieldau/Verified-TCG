/**
 * Collection Insights Pro — deep portfolio analytics.
 * Free users see hero stats ungated, then a Pro gate.
 * Pro users get real server performance data (range-selectable),
 * explicit no-history / incomplete-coverage states, real realised/unrealised,
 * cost basis, allocations, and high/low performers — never mock.
 */

import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
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
import { useSettings } from '@/context/SettingsContext';
import colors from '@/constants/colors';
import {
  fetchCollectionSummary,
  fetchCollectionPerformance,
  type CollectionSummary,
  type CollectionPerformance,
  type PerformanceRange,
  type PerformanceAllocation,
  type PerformanceCard,
} from '@/services/collectionPerformance';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const C = colors.dark;

const RANGE_CHIPS: PerformanceRange[] = ['1M', '3M', '6M', '1Y', 'ALL'];

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, currency = 'AUD'): string {
  if (n === null || n === undefined) return '—';
  return `${currency} ${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}

function fmtSigned(n: number | null | undefined, pct: number | null | undefined, currency = 'AUD'): string {
  if (n === null || n === undefined) return '—';
  const sign = n >= 0 ? '+' : '';
  const pctStr = pct !== null && pct !== undefined ? ` (${sign}${pct.toFixed(1)}%)` : '';
  return `${sign}${currency} ${Math.abs(n).toLocaleString('en-AU', { maximumFractionDigits: 0 })}${pctStr}`;
}

// ─── Chart ─────────────────────────────────────────────────────────────────────

function PerformanceChart({ points }: { points: { date: string; value: number }[] }) {
  const [width, setWidth] = React.useState(320);
  if (points.length === 0) return null;
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const H = 80;
  const firstLabel = points[0]?.date ?? '';
  const lastLabel = points[points.length - 1]?.date ?? '';
  const lastVal = values[values.length - 1] ?? 0;
  const firstVal = values[0] ?? 0;
  const isUp = lastVal >= firstVal;

  const linePath = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width;
    const y = 8 + (1 - (point.value - min) / range) * (H - 16);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  return (
    <View style={chartStyles.wrap} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Svg width={width} height={H}>
        <Defs>
          <LinearGradient id="insightsHistoryGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={isUp ? C.positive : C.negative} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={isUp ? C.positive : C.negative} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={`${linePath} L ${width} ${H} L 0 ${H} Z`} fill="url(#insightsHistoryGradient)" />
        <Path
          d={linePath}
          stroke={isUp ? C.positive : C.negative}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
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
  const m = parts[1];
  const y = parts[0];
  const d = parts[2];
  const mon = months[Number(m) - 1] ?? '';
  return d ? `${d} ${mon}` : `${mon} ${y ?? ''}`;
}

const chartStyles = StyleSheet.create({
  wrap: { width: '100%' },
  xRow: { flexDirection: 'row', justifyContent: 'space-between' },
  axisLabel: { fontSize: 10, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
});

// ─── Allocation bar ────────────────────────────────────────────────────────────

function AllocationSection({ rows }: { rows: PerformanceAllocation[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={allocStyles.section}>
      <View style={allocStyles.barTrack}>
        {rows.map(r => (
          <View key={r.label} style={[allocStyles.barSegment, { flex: r.percent / 100, backgroundColor: r.color }]} />
        ))}
      </View>
      <View style={allocStyles.pills}>
        {rows.map(r => (
          <View key={r.label} style={allocStyles.pill}>
            <View style={[allocStyles.dot, { backgroundColor: r.color }]} />
            <Text style={allocStyles.pillLabel}>{r.label}</Text>
            <Text style={allocStyles.pillPct}>{r.percent}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const allocStyles = StyleSheet.create({
  section: { marginBottom: 16 },
  barTrack: { flexDirection: 'row', height: 8, borderRadius: 6, overflow: 'hidden', gap: 1, marginBottom: 10 },
  barSegment: { height: '100%' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillLabel: { fontSize: 12, color: C.foreground, fontFamily: 'Inter_400Regular' },
  pillPct: { fontSize: 12, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
});

// ─── Performer row ─────────────────────────────────────────────────────────────

function PerformerRow({ card, isTop }: { card: PerformanceCard; isTop: boolean }) {
  const color = isTop ? C.positive : C.negative;
  return (
    <View style={perfStyles.row}>
      <View style={{ flex: 1 }}>
        <Text style={perfStyles.name} numberOfLines={1}>{card.name}</Text>
        {card.setName ? <Text style={perfStyles.set} numberOfLines={1}>{card.setName}</Text> : null}
      </View>
      <View style={[perfStyles.badge, { backgroundColor: `${color}18` }]}>
        <Text style={[perfStyles.pct, { color }]}>
          {isTop ? '+' : ''}{card.gainPercent.toFixed(1)}%
        </Text>
      </View>
    </View>
  );
}

const perfStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  name: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  set: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  pct: { fontSize: 13, fontFamily: 'Rajdhani_700Bold' },
});

// ─── Gains row ────────────────────────────────────────────────────────────────

function GainsRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={gStyles.row}>
      <Text style={gStyles.label}>{label}</Text>
      <Text style={[gStyles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const gStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { fontSize: 14, color: C.foreground, fontFamily: 'Inter_400Regular' },
  value: { fontSize: 16, color: C.foreground, fontFamily: 'Rajdhani_700Bold' },
});

// ─── Placeholder for Pro blur preview ─────────────────────────────────────────

function BlurredPlaceholder() {
  return (
    <View style={{ gap: 16 }}>
      <View style={[phStyles.block, { height: 110 }]} />
      <View style={phStyles.row}>
        <View style={[phStyles.block, { flex: 1, height: 70 }]} />
        <View style={[phStyles.block, { flex: 1, height: 70 }]} />
      </View>
      <View style={[phStyles.block, { height: 60 }]} />
      <View style={[phStyles.block, { height: 40 }]} />
      <View style={[phStyles.block, { height: 40 }]} />
    </View>
  );
}
const phStyles = StyleSheet.create({
  block: { backgroundColor: C.surface, borderRadius: 12 },
  row: { flexDirection: 'row', gap: 10 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CollectionInsightsScreen() {
  const insets = useSafeAreaInsets();
  const { subscriptionTier, collection } = useApp();
  const { currency } = useSettings();
  const isPro = subscriptionTier === 'pro';

  const [range, setRange] = useState<PerformanceRange>('3M');
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [performance, setPerformance] = useState<CollectionPerformance | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);

  // Load summary
  useEffect(() => {
    setSummaryLoading(true);
    fetchCollectionSummary(currency)
      .then(s => setSummary(s))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [currency]);

  // Load performance when range changes (Pro only)
  useEffect(() => {
    if (!isPro) return;
    setPerfLoading(true);
    setPerformance(null);
    fetchCollectionPerformance(range, currency)
      .then(p => setPerformance(p))
      .catch(() => setPerformance(null))
      .finally(() => setPerfLoading(false));
  }, [range, currency, isPro]);

  // Hero values: prefer server summary, fall back to collection totals (as unavailable)
  const localCardCount = collection.length;
  const portfolioValue = summary?.totalValue ?? null;
  const totalCost = summary?.totalCost ?? null;
  const unrealisedGain = summary?.unrealizedGain ?? null;
  const unrealisedGainPct = summary?.unrealizedGainPercent ?? null;
  const isGainUp = (unrealisedGain ?? 0) >= 0;

  // ── Pro content ──────────────────────────────────────────────────────────────

  const proContent = (
    <>
      {/* ── Historical Chart ─────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>PORTFOLIO HISTORY</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 14 }}
          contentContainerStyle={{ gap: 8, paddingRight: 4 }}
        >
          {RANGE_CHIPS.map(chip => (
            <Pressable
              key={chip}
              onPress={() => setRange(chip)}
              style={[styles.chip, range === chip && styles.chipActive]}
              accessibilityRole="button"
              accessibilityLabel={`${chip} range`}
            >
              <Text style={[styles.chipText, range === chip && styles.chipTextActive]}>{chip}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {perfLoading ? (
          <View style={{ height: 90, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : performance && performance.historyAvailable && performance.points.length > 0 ? (
          <PerformanceChart points={performance.points.map(pt => ({ date: pt.date, value: pt.value }))} />
        ) : (
          <View style={{ height: 80, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Feather name="bar-chart-2" size={24} color={C.mutedForeground} />
            <Text style={[styles.unavailText, { textAlign: 'center' }]}>
              {performance?.historyUnavailableReason
                ?? performance?.completeness
                ?? 'No performance history available for this period'}
            </Text>
          </View>
        )}
      </View>

      {/* ── Allocations ──────────────────────────── */}
      {performance && performance.allocations.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Allocation</Text>
          <View style={styles.card}>
            <AllocationSection rows={performance.allocations} />
          </View>
        </>
      )}

      {/* ── Performers ───────────────────────────── */}
      {performance && (performance.topPerformers.length > 0 || performance.worstPerformers.length > 0) && (
        <>
          <Text style={[styles.sectionHeader, { marginTop: 18 }]}>Performers</Text>
          <View style={styles.card}>
            {performance.topPerformers.length > 0 && (
              <>
                <Text style={styles.perfSectionLabel}>TOP</Text>
                {performance.topPerformers.slice(0, 3).map(c => (
                  <PerformerRow key={c.cardId} card={c} isTop={true} />
                ))}
              </>
            )}
            {performance.worstPerformers.length > 0 && (
              <>
                <Text style={[styles.perfSectionLabel, { marginTop: 12 }]}>WORST</Text>
                {performance.worstPerformers.slice(0, 3).map(c => (
                  <PerformerRow key={c.cardId} card={c} isTop={false} />
                ))}
              </>
            )}
          </View>
        </>
      )}

      {/* ── Gains ────────────────────────────────── */}
      <Text style={[styles.sectionHeader, { marginTop: 18 }]}>Gains</Text>
      <View style={styles.card}>
        <GainsRow
          label="Realised Gains"
          value={fmt(performance?.realisedGain ?? summary?.realisedGain, currency)}
          color={(performance?.realisedGain ?? summary?.realisedGain ?? 0) >= 0 ? C.positive : C.negative}
        />
        <GainsRow
          label="Unrealised Gains"
          value={fmt(performance?.unrealisedGain ?? summary?.unrealizedGain, currency)}
          color={(performance?.unrealisedGain ?? summary?.unrealizedGain ?? 0) >= 0 ? C.positive : C.negative}
        />
        <GainsRow
          label="Cost Basis"
          value={fmt(performance?.costBasis ?? summary?.totalCost, currency)}
        />
        {summary?.coverage && (
          <View style={[gStyles.row, { borderBottomWidth: 0 }]}>
            <Text style={gStyles.label}>Priced Holdings</Text>
            <Text style={gStyles.value}>
              {summary.coverage.pricedHoldings}/{summary.coverage.totalHoldings}
              {' '}({Math.round(summary.coverage.ratio * 100)}%)
            </Text>
          </View>
        )}
      </View>

      {/* Completeness note */}
      {(performance?.completeness || summary?.completeness) && (
        <View style={styles.completenessNote}>
          <Feather name="info" size={11} color={C.mutedForeground} />
          <Text style={styles.completenessText}>
            {performance?.completeness ?? summary?.completeness}
          </Text>
        </View>
      )}

      {/* Archive link */}
      <Pressable
        onPress={() => router.push('/collection-archive' as any)}
        style={styles.archiveLink}
        accessibilityRole="button"
        accessibilityLabel="View sold holdings archive"
      >
        <Feather name="archive" size={14} color={C.primary} />
        <Text style={styles.archiveLinkText}>View Sold Holdings (Archive)</Text>
        <Feather name="chevron-right" size={14} color={C.primary} />
      </Pressable>
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
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Collection Insights</Text>
          {isPro && (
            <View style={styles.proBadge}>
              <Text style={styles.proBadgeText}>PRO</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Hero stats — always visible ────────────────────────────────────── */}
      <View style={styles.heroCard}>
        {summaryLoading ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : (
          <>
            <View style={styles.heroRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroLabel}>Portfolio Value</Text>
                {portfolioValue !== null ? (
                  <>
                    <Text style={styles.heroValue}>
                      {portfolioValue.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                    </Text>
                    <Text style={styles.heroCurrency}>{currency}</Text>
                  </>
                ) : (
                  <Text style={[styles.heroValue, { color: C.mutedForeground, fontSize: 18 }]}>
                    {localCardCount > 0 ? 'Unavailable' : '—'}
                  </Text>
                )}
              </View>
              <View style={[styles.heroStat, styles.heroBorder]}>
                <Text style={styles.heroLabel}>Total Invested</Text>
                {totalCost !== null ? (
                  <>
                    <Text style={styles.heroValue}>
                      {totalCost.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                    </Text>
                    <Text style={styles.heroCurrency}>{currency}</Text>
                  </>
                ) : (
                  <Text style={[styles.heroValue, { color: C.mutedForeground, fontSize: 18 }]}>—</Text>
                )}
              </View>
            </View>

            {/* Gain strip */}
            {unrealisedGain !== null ? (
              <View style={[styles.gainStrip, { backgroundColor: isGainUp ? '#22C55E18' : '#EF444418' }]}>
                <Feather
                  name={isGainUp ? 'trending-up' : 'trending-down'}
                  size={15}
                  color={isGainUp ? C.positive : C.negative}
                />
                <Text style={[styles.gainText, { color: isGainUp ? C.positive : C.negative }]}>
                  {fmtSigned(unrealisedGain, unrealisedGainPct, currency)}
                </Text>
                <Text style={styles.gainSubText}>unrealised gain</Text>
              </View>
            ) : (
              <View style={[styles.gainStrip, { backgroundColor: `${C.muted}88` }]}>
                <Feather name="info" size={13} color={C.mutedForeground} />
                <Text style={[styles.gainText, { color: C.mutedForeground, fontSize: 13 }]}>
                  Gain data unavailable
                </Text>
              </View>
            )}

            {/* Card count */}
            <View style={styles.countRow}>
              <Feather name="layers" size={13} color={C.mutedForeground} />
              <Text style={styles.countText}>
                {summary ? summary.cardCount : localCardCount} cards in collection
              </Text>
              {summary?.coverage && (
                <>
                  <Text style={styles.countText}> · </Text>
                  <Text style={[styles.countText, { color: summary.coverage.ratio < 0.5 ? '#F59E0B' : C.mutedForeground }]}>
                    {Math.round(summary.coverage.ratio * 100)}% priced
                  </Text>
                </>
              )}
            </View>
          </>
        )}
      </View>

      {/* ── Pro gated content ───────────────────────────────────────────────── */}
      <ProFeaturePreview
        featureTitle="Collection Insights"
        description="Unlock portfolio history, performance by range, realised/unrealised gains, allocations, and top/worst performers — available with Verified TCG Pro."
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
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, justifyContent: 'center', alignItems: 'center' },
  headerText:  { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  title:       { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: 0.3 },
  proBadge:    { backgroundColor: C.primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  proBadgeText:{ fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 1 },
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
  countRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 18, paddingBottom: 14 },
  countText:   { fontSize: 12, color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
  sectionHeader: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.foreground, marginBottom: 12 },
  sectionLabel: { fontSize: 11, color: C.mutedForeground, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  card:    { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 0 },
  chip:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface },
  chipActive:    { backgroundColor: C.primary },
  chipText:      { fontSize: 13, color: C.mutedForeground, fontFamily: 'Inter_500Medium' },
  chipTextActive:{ color: '#fff' },
  unavailText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  perfSectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  completenessNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    paddingHorizontal: 4, marginTop: 8, marginBottom: 8,
  },
  completenessText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, flex: 1, lineHeight: 16 },
  archiveLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${C.primary}12`, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 16,
  },
  archiveLinkText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.primary },
});
