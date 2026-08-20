/**
 * VerifiedPricingCard
 *
 * Displays verified market pricing for a card using only server data.
 * Handles all states: available, stale, pending_match, review_required,
 * unavailable, missing_secret, error, and no-data gracefully.
 * Never fabricates prices.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import {
  fetchVerifiedPricing,
  refreshVerifiedPricing,
  fetchVerifiedPriceHistory,
  type CardPricingResult,
  type PricingQuote,
  type CardPriceHistoryResult,
  type HistoryPeriod,
} from '@/services/verifiedPricing';
import type { Card } from '@/types';

const C = colors.dark;

const HISTORY_PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '1M' },
  { value: '90d', label: '3M' },
  { value: '180d', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'ALL' },
];

// ── Mini Line Chart ────────────────────────────────────────────────────────────

interface MiniChartProps {
  points: { date: string; price: number }[];
  width: number;
  height: number;
  loading?: boolean;
}

function MiniLineChart({ points, width, height, loading }: MiniChartProps) {
  if (loading) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={C.primary} />
      </View>
    );
  }
  if (points.length < 2) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Feather name="bar-chart-2" size={22} color="rgba(255,255,255,0.18)" />
        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
          History not yet available
        </Text>
      </View>
    );
  }

  const PAD = { top: 4, right: 2, bottom: 4, left: 2 };
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;
  const prices = points.map(p => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const rangeP = maxP - minP || 1;

  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * chartW;
  const toY = (p: number) => PAD.top + ((maxP - p) / rangeP) * chartH;
  const coords = points.map((pt, i) => ({ x: toX(i), y: toY(pt.price) }));

  function makePath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  }

  const linePath = makePath(coords);
  const bottom = PAD.top + chartH;
  const firstX = coords[0]!.x;
  const lastX = coords[coords.length - 1]!.x;
  const areaPath = `${linePath} L ${lastX} ${bottom} L ${firstX} ${bottom} Z`;
  const isUp = prices[prices.length - 1]! >= prices[0]!;
  const lineColor = isUp ? '#22c55e' : '#ef4444';

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="vpChartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
          <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Path d={areaPath} fill="url(#vpChartFill)" />
      <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── Status badge helpers ────────────────────────────────────────────────────────

function StatusBanner({ result }: { result: CardPricingResult }) {
  const { status, isStale, message, errorCode } = result;

  if (status === 'available' && !isStale) return null;

  let icon: string;
  let color: string;
  let label: string;

  if (isStale && status === 'available') {
    icon = 'clock'; color = '#F59E0B';
    label = 'Pricing data may be outdated';
  } else if (status === 'stale') {
    icon = 'clock'; color = '#F59E0B';
    label = 'Stale — refresh for latest prices';
  } else if (status === 'pending_match') {
    icon = 'loader'; color = C.primary;
    label = 'Matching in progress — check back shortly';
  } else if (status === 'review_required') {
    icon = 'eye'; color = '#F59E0B';
    label = 'Price under review — data may change';
  } else if (errorCode === 'missing_secret' || errorCode === 'config_error') {
    icon = 'settings'; color = C.negative;
    label = 'Pricing not configured for this card';
  } else if (status === 'unavailable') {
    icon = 'alert-circle'; color = C.mutedForeground;
    label = message ?? 'Verified pricing unavailable';
  } else {
    return null;
  }

  return (
    <View style={[bannerStyles.row, { backgroundColor: `${color}14` }]}>
      <Feather name={icon as any} size={13} color={color} />
      <Text style={[bannerStyles.text, { color }]}>{label}</Text>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    marginBottom: 10,
  },
  text: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },
});

// ── Main Component ─────────────────────────────────────────────────────────────

interface VerifiedPricingCardProps {
  card: Card;
  displayCurrency: string;
  isPro: boolean;
  onUpgradePress: () => void;
  chartWidth: number;
}

export default function VerifiedPricingCard({
  card,
  displayCurrency,
  isPro,
  onUpgradePress,
  chartWidth,
}: VerifiedPricingCardProps) {
  const [pricing, setPricing] = useState<CardPricingResult | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedGradeKey, setSelectedGradeKey] = useState<string>('raw');
  const [history, setHistory] = useState<CardPriceHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('30d');

  // Load pricing on mount / card change
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPricingLoading(true);
    setPricingError(false);

    fetchVerifiedPricing(
      card.id,
      {
        name: card.name,
        set: card.setName,
        number: card.number,
        game: card.tcg,
        displayCurrency,
      },
      controller.signal,
    )
      .then(result => {
        if (cancelled) return;
        setPricing(result);
        // Default to first quote's gradeKey
        if (result.quotes.length > 0 && result.quotes[0]) {
          setSelectedGradeKey(result.quotes[0].gradeKey);
        }
      })
      .catch(() => {
        if (!cancelled) setPricingError(true);
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });

    return () => { cancelled = true; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, displayCurrency]);

  // Load history when grade or period changes (Pro only)
  useEffect(() => {
    if (!isPro) return;
    let cancelled = false;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistory(null);

    fetchVerifiedPriceHistory(card.id, selectedGradeKey, historyPeriod, displayCurrency, controller.signal)
      .then(result => { if (!cancelled) setHistory(result); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHistoryLoading(false); });

    return () => { cancelled = true; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, selectedGradeKey, historyPeriod, displayCurrency, isPro]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshVerifiedPricing(card.id, {
        name: card.name,
        set: card.setName,
        number: card.number,
        game: card.tcg,
        displayCurrency,
      });
      setPricing(result);
    } catch {
      // silently keep old data
    } finally {
      setRefreshing(false);
    }
  }, [card, displayCurrency]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (pricingLoading) {
    return (
      <View style={[vpStyles.card, { backgroundColor: C.card }]}>
        <View style={vpStyles.loadingRow}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={vpStyles.loadingText}>Loading Verified Market price…</Text>
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (pricingError || !pricing) {
    return (
      <View style={[vpStyles.card, { backgroundColor: C.card }]}>
        <View style={vpStyles.sectionHeader}>
          <Feather name="shield" size={14} color={C.primary} />
          <Text style={vpStyles.sectionLabel}>VERIFIED MARKET</Text>
        </View>
        <View style={vpStyles.unavailableBlock}>
          <Feather name="alert-circle" size={28} color={C.mutedForeground} />
          <Text style={vpStyles.unavailableTitle}>Price Unavailable</Text>
          <Text style={vpStyles.unavailableText}>Unable to load pricing data. Check connection.</Text>
        </View>
      </View>
    );
  }

  const selectedQuote: PricingQuote | undefined =
    pricing.quotes.find(q => q.gradeKey === selectedGradeKey) ?? pricing.quotes[0];
  const selectedMarket =
    (pricing.verifiedMarket ?? []).find(value => value.gradeKey === selectedGradeKey)
    ?? pricing.verifiedMarket?.[0];

  const hasQuotes = pricing.quotes.length > 0;
  const isAvailable = pricing.status === 'available' || pricing.status === 'stale';

  // Movement from history
  const movement = history?.movement ?? null;

  return (
    <View style={[vpStyles.card, { backgroundColor: C.card }]}>
      {/* Header */}
      <View style={vpStyles.header}>
        <View style={vpStyles.sectionHeader}>
          <Feather name="shield" size={13} color={C.primary} />
          <Text style={vpStyles.sectionLabel}>VERIFIED MARKET</Text>
          {selectedMarket && (
            <Text style={vpStyles.sourceChip}>
              {selectedMarket.confidence.providerCount} source
            </Text>
          )}
        </View>
        <Pressable
          onPress={handleRefresh}
          disabled={refreshing}
          style={vpStyles.refreshBtn}
          accessibilityRole="button"
          accessibilityLabel="Refresh pricing"
          hitSlop={8}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <Feather name="refresh-cw" size={14} color={C.mutedForeground} />
          )}
        </Pressable>
      </View>

      {/* Status banner */}
      <StatusBanner result={pricing} />

      {/* Grade selector (only if quotes available) */}
      {hasQuotes && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={vpStyles.gradeScroll}
          contentContainerStyle={vpStyles.gradeScrollContent}
        >
          {pricing.quotes.map(q => (
            <Pressable
              key={q.gradeKey}
              onPress={() => setSelectedGradeKey(q.gradeKey)}
              style={[
                vpStyles.gradeChip,
                selectedGradeKey === q.gradeKey && vpStyles.gradeChipActive,
              ]}
              accessibilityRole="tab"
              accessibilityLabel={`${q.label}: ${q.currency} ${q.price.toLocaleString('en-AU')}`}
              accessibilityState={{ selected: selectedGradeKey === q.gradeKey }}
            >
              <Text style={[
                vpStyles.gradeChipLabel,
                selectedGradeKey === q.gradeKey && vpStyles.gradeChipLabelActive,
              ]}>
                {q.label}
              </Text>
              <Text style={[
                vpStyles.gradeChipPrice,
                selectedGradeKey === q.gradeKey && vpStyles.gradeChipPriceActive,
              ]}>
                {q.currency} {q.price.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Current price display */}
      {selectedQuote ? (
        <View style={vpStyles.priceBlock}>
          <Text style={vpStyles.priceLabel}>
             {selectedQuote.label} · {selectedMarket?.currency ?? selectedQuote.currency}
          </Text>
          <Text style={vpStyles.priceValue}>
             {(selectedMarket?.verifiedMarketValue ?? selectedQuote.price)
               .toLocaleString('en-AU', { minimumFractionDigits: 2 })}
          </Text>
           {selectedMarket?.range && (
             <Text style={vpStyles.marketRange}>
               Retained range {selectedMarket.range.currency}{' '}
               {(selectedMarket.range.lowCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
               {' – '}
               {(selectedMarket.range.highCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
               {' · '}{selectedMarket.range.sampleCount} snapshots
             </Text>
           )}
          {selectedQuote.originalCurrency !== selectedQuote.currency && (
            <Text style={vpStyles.conversionNote}>
              Originally {selectedQuote.originalCurrency}{' '}
              {(selectedQuote.originalPriceCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
            </Text>
          )}
          {movement && (
            <View style={vpStyles.movementRow}>
              <Feather
                name={movement.direction === 'up' ? 'trending-up' : movement.direction === 'down' ? 'trending-down' : 'minus'}
                size={12}
                color={movement.direction === 'up' ? C.positive : movement.direction === 'down' ? C.negative : C.mutedForeground}
              />
              <Text style={[
                vpStyles.movementText,
                { color: movement.direction === 'up' ? C.positive : movement.direction === 'down' ? C.negative : C.mutedForeground },
              ]}>
                {movement.direction !== 'flat' ? (movement.direction === 'up' ? '+' : '') : ''}
                 {movement.percent.toFixed(1)}% (
                 {HISTORY_PERIODS.find(period => period.value === historyPeriod)?.label ?? historyPeriod})
              </Text>
            </View>
          )}
        </View>
      ) : !isAvailable ? (
        <View style={vpStyles.unavailableBlock}>
          <Feather name={
            pricing.status === 'pending_match' ? 'loader' :
            pricing.status === 'review_required' ? 'eye' : 'alert-circle'
          } size={26} color={C.mutedForeground} />
          <Text style={vpStyles.unavailableTitle}>
            {pricing.status === 'pending_match' ? 'Matching in Progress'
              : pricing.status === 'review_required' ? 'Under Review'
              : 'No Pricing Data'}
          </Text>
          <Text style={vpStyles.unavailableText}>
            {pricing.message ?? 'Verified pricing is not currently available for this card.'}
          </Text>
        </View>
      ) : null}

      {/* Confidence indicator */}
      {selectedMarket && selectedQuote && (
        <View style={vpStyles.confidenceRow}>
          <View style={[vpStyles.confidenceDot, {
            backgroundColor:
               selectedMarket.confidence.level === 'high' ? C.positive :
               selectedMarket.confidence.level === 'medium' ? '#F59E0B' : C.negative,
          }]} />
          <Text style={vpStyles.confidenceText}>
             {selectedMarket.confidence.score}% market confidence
          </Text>
          {pricing.updatedAt && (
            <Text style={vpStyles.updatedText}>
              · Updated {formatRelative(pricing.updatedAt)}
            </Text>
          )}
        </View>
      )}

      {selectedMarket && (
        <View style={vpStyles.insightsBlock}>
          <Text style={vpStyles.insightsLabel}>MARKET INSIGHTS</Text>
          {selectedMarket.insights.slice(0, 2).map(insight => (
            <View key={insight} style={vpStyles.insightRow}>
              <View style={vpStyles.insightDot} />
              <Text style={vpStyles.insightText}>{insight}</Text>
            </View>
          ))}
          {selectedMarket.confidence.reasons.slice(0, 2).map(reason => (
            <View key={reason} style={vpStyles.insightRow}>
              <View style={vpStyles.insightDot} />
              <Text style={vpStyles.insightText}>{reason}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Price history — Pro only */}
      {isPro && hasQuotes && (
        <View style={vpStyles.historyBlock}>
          <View style={vpStyles.historyHeader}>
            <Text style={vpStyles.historyLabel}>VERIFIED MARKET HISTORY</Text>
          </View>

          {/* Period selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={vpStyles.periodScroll}>
            {HISTORY_PERIODS.map(period => (
              <Pressable
                key={period.value}
                onPress={() => setHistoryPeriod(period.value)}
                style={[vpStyles.periodChip, historyPeriod === period.value && vpStyles.periodChipActive]}
                accessibilityRole="button"
                accessibilityLabel={`${period.label} period`}
                hitSlop={{ top: 6, bottom: 6 }}
              >
                <Text style={[vpStyles.periodChipText, historyPeriod === period.value && { color: '#FFF' }]}>
                  {period.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Chart */}
          <MiniLineChart
            points={history?.points.map(pt => ({ date: pt.date, price: pt.price })) ?? []}
            width={chartWidth}
            height={100}
            loading={historyLoading}
          />

          {history && !history.historyAvailable && !historyLoading && (
            <Text style={vpStyles.historyUnavailableText}>
              History not yet available for this period
            </Text>
          )}
        </View>
      )}

      {/* Pro gate for history */}
      {!isPro && hasQuotes && (
        <Pressable
          onPress={onUpgradePress}
          style={vpStyles.proGate}
          accessibilityRole="button"
          accessibilityLabel="Upgrade to Pro to see price history"
        >
          <Feather name="lock" size={14} color={C.primary} />
          <Text style={vpStyles.proGateText}>Upgrade to Pro for full price history</Text>
          <Feather name="chevron-right" size={14} color={C.primary} />
        </Pressable>
      )}

      {selectedMarket && (
        <View style={vpStyles.sourceDisclosure}>
          <Text style={vpStyles.sourceDisclosureLabel}>PRICING SOURCES</Text>
          <Text style={vpStyles.sourceDisclosureText}>
            Verified Market uses normalized {selectedMarket.providers.map(provider => provider.label).join(', ')}
            {' '}quotes. Current values are based on {selectedMarket.confidence.providerCount}
            {' '}provider{selectedMarket.confidence.providerCount === 1 ? '' : 's'}; ranges appear only from
            retained snapshots. Original quote currency is preserved above.
          </Text>
        </View>
      )}
    </View>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const vpStyles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginBottom: 16 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionLabel: {
    fontSize: 10, fontFamily: 'Inter_700Bold',
    color: C.primary, letterSpacing: 1.2, textTransform: 'uppercase',
  },
  sourceChip: {
    fontSize: 10, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, marginLeft: 4,
  },
  refreshBtn: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  gradeScroll: { marginBottom: 12 },
  gradeScrollContent: { gap: 8, paddingRight: 4 },
  gradeChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface, alignItems: 'center', minWidth: 72,
  },
  gradeChipActive: { borderColor: C.primary, backgroundColor: `${C.primary}18` },
  gradeChipLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, marginBottom: 2 },
  gradeChipLabelActive: { color: C.primary },
  gradeChipPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.mutedForeground },
  gradeChipPriceActive: { color: C.foreground },
  priceBlock: { marginBottom: 10 },
  priceLabel: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 4,
  },
  priceValue: { fontSize: 30, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: -0.5 },
  marketRange: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground, marginTop: 3 },
  conversionNote: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  movementRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  movementText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  confidenceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 8,
  },
  confidenceDot: { width: 7, height: 7, borderRadius: 4 },
  confidenceText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  updatedText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}88` },
  insightsBlock: {
    backgroundColor: C.surface, borderRadius: 10, padding: 10, gap: 6, marginBottom: 12,
  },
  insightsLabel: {
    fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground,
    letterSpacing: 0.8, marginBottom: 1,
  },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  insightDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.primary, marginTop: 5 },
  insightText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  unavailableBlock: {
    alignItems: 'center', paddingVertical: 20, gap: 8,
  },
  unavailableTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  unavailableText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  historyBlock: { marginTop: 4 },
  historyHeader: { marginBottom: 8 },
  historyLabel: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  periodScroll: { marginBottom: 8 },
  periodChip: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, backgroundColor: C.surface, marginRight: 7,
  },
  periodChipActive: { backgroundColor: '#CC1826' },
  periodChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  historyUnavailableText: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground,
    textAlign: 'center', paddingVertical: 8,
  },
  proGate: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${C.primary}12`, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 4,
  },
  proGateText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  sourceDisclosure: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border,
    marginTop: 12, paddingTop: 12, gap: 4,
  },
  sourceDisclosureLabel: {
    fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 0.8,
  },
  sourceDisclosureText: {
    fontSize: 10, lineHeight: 15, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}CC`,
  },
});
