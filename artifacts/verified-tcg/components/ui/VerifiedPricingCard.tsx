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
  Linking,
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

const GRADED_HISTORY_PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: '30d', label: '1M' },
  { value: '90d', label: '3M' },
  { value: '180d', label: '6M' },
  { value: '1y', label: '12M' },
  { value: 'all', label: 'MAX' },
];

interface GradedQuoteOption {
  quote: PricingQuote;
  grader: string;
  grade: string;
}

function getGradedQuoteOption(quote: PricingQuote): GradedQuoteOption {
  const label = quote.label.trim();
  const match = label.match(/^(.*?)(?:\s+)(\d+(?:\.\d+)?)$/);
  if (!match) return { quote, grader: label || 'Graded', grade: label || '—' };

  const grader = match[1]!.replace(/\s+graded$/i, '').trim() || 'Graded';
  return { quote, grader, grade: match[2]! };
}

interface VerifiedGradePopulation {
  company: string;
  grade: string | number;
  population: number;
}

function getGradePopulation(
  option: GradedQuoteOption,
  populations: VerifiedGradePopulation[],
): string {
  // Population is grading-company evidence, not pricing-provider data.
  // Never turn a quote or collection quantity into a POP claim.
  const match = populations.find(record =>
    record.company.trim().toLowerCase() === option.grader.trim().toLowerCase()
    && String(record.grade).trim() === option.grade.trim(),
  );
  return match ? match.population.toLocaleString('en-AU') : '—';
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// ── Mini Line Chart ────────────────────────────────────────────────────────────

interface MiniChartProps {
  points: { date: string; price: number }[];
  width: number;
  height: number;
  loading?: boolean;
  graded?: boolean;
}

function MiniLineChart({ points, width, height, loading, graded = false }: MiniChartProps) {
  if (loading) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={C.primary} />
      </View>
    );
  }
  if (points.length === 0) {
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

  const toX = (i: number) =>
    points.length === 1 ? PAD.left + chartW / 2 : PAD.left + (i / (points.length - 1)) * chartW;
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

  const linePath = points.length === 1
    ? `M ${PAD.left} ${coords[0]!.y} L ${PAD.left + chartW} ${coords[0]!.y}`
    : makePath(coords);
  const bottom = PAD.top + chartH;
  const firstX = coords[0]!.x;
  const lastX = coords[coords.length - 1]!.x;
  const areaPath = `${linePath} L ${lastX} ${bottom} L ${firstX} ${bottom} Z`;
  const isUp = prices[prices.length - 1]! >= prices[0]!;
  const lineColor = graded ? C.primary : isUp ? '#22c55e' : '#ef4444';

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
  mode?: 'raw' | 'graded';
  onRawMarketSummaryChange?: (summary: VerifiedPricingSummary | null) => void;
  populationRecords?: VerifiedGradePopulation[];
}

export interface VerifiedPricingSummary {
  label: string;
  price: number;
  currency: string;
}

/**
 * The detail page header always shows the raw/ungraded market value. Keep this
 * separate from the lower card's selected quote, which may be a graded quote.
 */
export function getRawMarketSummary(
  pricing: CardPricingResult | null,
): VerifiedPricingSummary | null {
  if (!pricing) return null;

  const rawQuote = pricing.quotes.find(quote => quote.gradeKey === 'raw');
  if (!rawQuote) return null;

  const rawMarket = pricing.verifiedMarket.find(value => value.gradeKey === 'raw');
  return {
    label: 'Raw / Ungraded',
    price: rawMarket?.verifiedMarketValue ?? rawQuote.price,
    currency: rawMarket?.currency ?? rawQuote.currency,
  };
}

export default function VerifiedPricingCard({
  card,
  displayCurrency,
  isPro,
  onUpgradePress,
  chartWidth,
  mode = 'raw',
  onRawMarketSummaryChange,
  populationRecords = [],
}: VerifiedPricingCardProps) {
  const [pricing, setPricing] = useState<CardPricingResult | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);

  const [selectedGradeKey, setSelectedGradeKey] = useState<string>('raw');
  const [selectedGradeKeys, setSelectedGradeKeys] = useState<string[]>([]);
  const [selectedGrader, setSelectedGrader] = useState('');
  const [openGradedSelect, setOpenGradedSelect] = useState<'grader' | 'grade' | null>(null);
  const [history, setHistory] = useState<CardPriceHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>(
    mode === 'graded' ? '90d' : '30d',
  );

  const pricingOptions = {
    name: card.name,
    set: card.setName,
    number: card.number,
    game: card.tcg,
    displayCurrency,
  };

  const quoteMatchesMode = useCallback((quote: PricingQuote) =>
    mode === 'raw' ? quote.gradeKey === 'raw' : quote.gradeKey !== 'raw', [mode]);

  const updatePricing = useCallback((result: CardPricingResult) => {
    setPricing(result);
    const matchingQuotes = result.quotes.filter(quoteMatchesMode);
    const fallbackQuote = mode === 'graded'
      ? matchingQuotes[matchingQuotes.length - 1]
      : matchingQuotes[0];
    setSelectedGradeKey(previous => {
      const nextQuote = matchingQuotes.find(quote => quote.gradeKey === previous) ?? fallbackQuote;
      return nextQuote?.gradeKey ?? (mode === 'raw' ? 'raw' : '');
    });
    setSelectedGradeKeys(previous => {
      const valid = previous.filter(key => matchingQuotes.some(quote => quote.gradeKey === key));
      return valid.length > 0 ? valid : fallbackQuote ? [fallbackQuote.gradeKey] : [];
    });
    setSelectedGrader(previous => {
      const graders = matchingQuotes.map(quote => getGradedQuoteOption(quote).grader);
      if (previous && graders.includes(previous)) return previous;
      return fallbackQuote ? getGradedQuoteOption(fallbackQuote).grader : '';
    });
    setPollAttempt(result.status === 'pending_match' || result.queued ? 1 : 0);
  }, [mode, quoteMatchesMode]);

  useEffect(() => {
    setHistoryPeriod(mode === 'graded' ? '90d' : '30d');
    setOpenGradedSelect(null);
  }, [mode]);

  // Load pricing on mount / card change
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPricing(null);
    setPricingLoading(true);
    setPricingError(false);

    fetchVerifiedPricing(
      card.id,
      {
        ...pricingOptions,
      },
      controller.signal,
    )
      .then(result => {
        if (cancelled) return;
        updatePricing(result);
      })
      .catch(() => {
        if (!cancelled) setPricingError(true);
      })
      .finally(() => {
        if (!cancelled) setPricingLoading(false);
      });

    return () => { cancelled = true; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, displayCurrency, updatePricing]);

  // The first pricing read starts the server-side match asynchronously. Poll a
  // small, bounded number of times so a real provider result appears on the
  // card that initiated it instead of requiring the collector to leave/reopen
  // the screen. Pending results are deliberately never stored in the client
  // cache (see verifiedPricing.ts).
  useEffect(() => {
    if (!pricing || pollAttempt === 0 || pollAttempt > 3) return;
    if (pricing.status !== 'pending_match' && !pricing.queued) return;

    let cancelled = false;
    const delay = [1_500, 3_000, 6_000][pollAttempt - 1] ?? 6_000;
    const timer = setTimeout(() => {
      fetchVerifiedPricing(card.id, pricingOptions)
        .then(result => {
          if (cancelled) return;
          updatePricing(result);
          if (result.status === 'pending_match' || result.queued) {
            setPollAttempt(previous => previous + 1);
          }
        })
        .catch(() => { if (!cancelled) setPricingError(true); });
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, pricing?.status, pricing?.queued, pollAttempt, updatePricing]);

  // Load history when grade or period changes (Pro only)
  useEffect(() => {
    if (!isPro) return;
    let cancelled = false;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(false);
    setHistory(null);

    fetchVerifiedPriceHistory(card.id, selectedGradeKey, historyPeriod, displayCurrency, controller.signal)
      .then(result => { if (!cancelled) setHistory(result); })
      .catch(() => { if (!cancelled) setHistoryError(true); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });

    return () => { cancelled = true; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, selectedGradeKey, historyPeriod, displayCurrency, isPro]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshVerifiedPricing(card.id, pricingOptions);
      updatePricing(result);
    } catch {
      setPricingError(true);
    } finally {
      setRefreshing(false);
    }
  }, [card.id, pricingOptions, updatePricing]);

  useEffect(() => {
    onRawMarketSummaryChange?.(getRawMarketSummary(pricing));
  }, [onRawMarketSummaryChange, pricing]);

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

  const visibleQuotes = pricing.quotes.filter(quoteMatchesMode);
  const gradedQuoteOptions = mode === 'graded'
    ? visibleQuotes.map(getGradedQuoteOption)
    : [];
  const graderOptions = [...new Set(gradedQuoteOptions.map(option => option.grader))];
  const activeGrader = selectedGrader || graderOptions[0] || '';
  const activeGraderQuotes = gradedQuoteOptions.filter(option => option.grader === activeGrader);
  const selectedQuote: PricingQuote | undefined =
    visibleQuotes.find(q => q.gradeKey === selectedGradeKey) ?? visibleQuotes[0];
  const selectedMarket =
    (pricing.verifiedMarket ?? []).find(value => value.gradeKey === selectedGradeKey)
    ?? (pricing.verifiedMarket ?? []).find(value =>
      visibleQuotes.some(quote => quote.gradeKey === value.gradeKey),
    );

  const hasQuotes = visibleQuotes.length > 0;
  const isAvailable = pricing.status === 'available' || pricing.status === 'stale';

  // Movement from history
  const movement = history?.movement ?? null;

  const ebaySearchUrl = `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent([
    card.name,
    card.setName,
    card.number,
    mode === 'graded' ? selectedQuote?.label : null,
  ].filter(Boolean).join(' '))}&LH_Complete=1&LH_Sold=1`;

  const selectedComparisonKeys = selectedGradeKeys.filter(key =>
    activeGraderQuotes.some(option => option.quote.gradeKey === key),
  );
  const historyMonthLabels = [...new Set(
    (history?.points ?? []).map(point =>
      new Date(point.date).toLocaleDateString('en-AU', { month: 'short' }),
    ),
  )].filter(Boolean);
  const visibleMonthLabels = historyMonthLabels.length <= 4
    ? historyMonthLabels
    : [0, 1, 2, 3].map(index =>
        historyMonthLabels[Math.round(index * (historyMonthLabels.length - 1) / 3)]!,
      );

  const chooseGrader = (grader: string) => {
    const quotes = gradedQuoteOptions.filter(option => option.grader === grader);
    const next = quotes[quotes.length - 1];
    setSelectedGrader(grader);
    setOpenGradedSelect(null);
    if (next) {
      setSelectedGradeKey(next.quote.gradeKey);
      setSelectedGradeKeys([next.quote.gradeKey]);
    }
  };

  const choosePrimaryGrade = (option: GradedQuoteOption) => {
    setSelectedGradeKey(option.quote.gradeKey);
    setSelectedGradeKeys(previous =>
      previous.includes(option.quote.gradeKey)
        ? previous
        : [...previous, option.quote.gradeKey],
    );
    setOpenGradedSelect(null);
  };

  const toggleComparedGrade = (option: GradedQuoteOption) => {
    setSelectedGradeKey(option.quote.gradeKey);
    setSelectedGradeKeys(previous => {
      if (!previous.includes(option.quote.gradeKey)) {
        return [...previous, option.quote.gradeKey];
      }
      return previous.length === 1
        ? previous
        : previous.filter(key => key !== option.quote.gradeKey);
    });
  };

  return (
    <View style={[
      vpStyles.card,
      { backgroundColor: C.card },
      mode === 'graded' && vpStyles.gradedCard,
    ]}>
      {/* Header */}
      {mode === 'graded' ? (
        <View style={vpStyles.marketSignalHeader}>
          <View>
            <Text style={vpStyles.marketSignalKicker}>MARKET SIGNAL</Text>
            <Text style={vpStyles.marketSignalTitle}>Graded market</Text>
          </View>
          <Text style={vpStyles.marketSignalMeta}>Verified history</Text>
        </View>
      ) : (
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
      )}

      {/* Status banner */}
      <StatusBanner result={pricing} />

      {/* Exact graded-market controls from the selected card-detail design. */}
      {mode === 'graded' && hasQuotes ? (
        <View style={vpStyles.gradedControls}>
          <View style={[vpStyles.gradedSelectField, { zIndex: 4 }]}>
            <Text style={vpStyles.gradedFieldLabel}>Grading company</Text>
            <Pressable
              onPress={() => setOpenGradedSelect(current => current === 'grader' ? null : 'grader')}
              style={vpStyles.gradedSelectControl}
              accessibilityRole="button"
              accessibilityLabel={`Grading company, ${activeGrader}`}
              accessibilityState={{ expanded: openGradedSelect === 'grader' }}
            >
              <Text style={vpStyles.gradedSelectText}>{activeGrader}</Text>
              <Feather name="chevron-down" size={15} color={C.foreground} />
            </Pressable>
            {openGradedSelect === 'grader' && (
              <View style={vpStyles.gradedDropdownMenu}>
                {graderOptions.map(grader => (
                  <Pressable
                    key={grader}
                    onPress={() => chooseGrader(grader)}
                    style={[
                      vpStyles.gradedDropdownOption,
                      grader === activeGrader && vpStyles.gradedDropdownOptionActive,
                    ]}
                  >
                    <Text style={vpStyles.gradedDropdownText}>{grader}</Text>
                    {grader === activeGrader && (
                      <Feather name="check" size={14} color={C.primary} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={[vpStyles.gradedSelectField, { zIndex: 3 }]}>
            <Text style={vpStyles.gradedFieldLabel}>Primary grade</Text>
            <Pressable
              onPress={() => setOpenGradedSelect(current => current === 'grade' ? null : 'grade')}
              style={vpStyles.gradedSelectControl}
              accessibilityRole="button"
              accessibilityLabel={`Primary grade, ${selectedQuote?.label ?? 'unavailable'}`}
              accessibilityState={{ expanded: openGradedSelect === 'grade' }}
            >
              <Text style={vpStyles.gradedSelectText} numberOfLines={1}>
                {selectedQuote?.label ?? 'Select grade'}
              </Text>
              <Feather name="chevron-down" size={15} color={C.foreground} />
            </Pressable>
            {openGradedSelect === 'grade' && (
              <View style={vpStyles.gradedDropdownMenu}>
                {activeGraderQuotes.map(option => (
                  <Pressable
                    key={option.quote.gradeKey}
                    onPress={() => choosePrimaryGrade(option)}
                    style={[
                      vpStyles.gradedDropdownOption,
                      option.quote.gradeKey === selectedGradeKey && vpStyles.gradedDropdownOptionActive,
                    ]}
                  >
                    <Text style={vpStyles.gradedDropdownText}>{option.quote.label}</Text>
                    {option.quote.gradeKey === selectedGradeKey && (
                      <Feather name="check" size={14} color={C.primary} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {mode === 'graded' && hasQuotes ? (
        <View style={vpStyles.gradedOptionList}>
          {activeGraderQuotes.map(option => {
            const isSelected = selectedGradeKeys.includes(option.quote.gradeKey);
            return (
              <Pressable
                key={option.quote.gradeKey}
                onPress={() => toggleComparedGrade(option)}
                style={[vpStyles.gradedOption, isSelected && vpStyles.gradedOptionActive]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${option.quote.label}, population ${getGradePopulation(option, populationRecords)}`}
              >
                <Text style={[vpStyles.gradedOptionGrade, isSelected && vpStyles.gradedOptionGradeActive]}>
                  {option.quote.label}
                </Text>
                <Text style={[vpStyles.gradedOptionPop, isSelected && vpStyles.gradedOptionPopActive]}>
                  POP {getGradePopulation(option, populationRecords)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : hasQuotes ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={vpStyles.gradeScroll}
          contentContainerStyle={vpStyles.gradeScrollContent}
        >
          {visibleQuotes.map(q => (
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
      ) : null}

      {mode === 'graded' && hasQuotes && (
        <View style={vpStyles.gradedComparisonRow}>
          <View style={vpStyles.gradedAvailabilityDot} />
          <Text style={vpStyles.gradedComparisonText}>
            <Text style={vpStyles.gradedComparisonStrong}>
              {Math.max(selectedComparisonKeys.length, 1)} grades compared
            </Text>
            {' · tap to toggle'}
          </Text>
        </View>
      )}

      {/* Current price display */}
      {selectedQuote ? (
        <View style={[vpStyles.priceBlock, mode === 'graded' && vpStyles.gradedPriceBlock]}>
          <Text style={vpStyles.priceLabel}>
             {selectedQuote.label} · {selectedMarket?.currency ?? selectedQuote.currency}
          </Text>
          <Text style={vpStyles.priceValue}>
             {formatPrice(
               selectedMarket?.verifiedMarketValue ?? selectedQuote.price,
               selectedMarket?.currency ?? selectedQuote.currency,
             )}
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
        mode === 'graded' ? (
          <View style={[vpStyles.historyBlock, vpStyles.gradedHistoryBlock]}>
            <MiniLineChart
              points={history?.points.map(pt => ({ date: pt.date, price: pt.price })) ?? []}
              width={chartWidth}
              height={168}
              loading={historyLoading}
              graded
            />

            {selectedComparisonKeys.length > 0 && (
              <View style={vpStyles.gradedLegend}>
                {selectedComparisonKeys.map(key => {
                  const option = activeGraderQuotes.find(item => item.quote.gradeKey === key);
                  return option ? (
                    <View key={key} style={vpStyles.gradedLegendItem}>
                      <View style={vpStyles.gradedLegendDot} />
                      <Text style={vpStyles.gradedLegendText}>{option.quote.label}</Text>
                    </View>
                  ) : null;
                })}
              </View>
            )}

            {visibleMonthLabels.length > 0 && (
              <View style={vpStyles.gradedMonthLabels}>
                {visibleMonthLabels.map((label, index) => (
                  <Text key={`${label}-${index}`} style={vpStyles.gradedMonthLabel}>{label}</Text>
                ))}
              </View>
            )}

            <View style={vpStyles.gradedPeriodRow}>
              {GRADED_HISTORY_PERIODS.map(period => {
                const active = historyPeriod === period.value;
                return (
                  <Pressable
                    key={period.value}
                    onPress={() => setHistoryPeriod(period.value)}
                    style={[vpStyles.gradedPeriodChip, active && vpStyles.gradedPeriodChipActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`${period.label} period`}
                  >
                    <Text style={[
                      vpStyles.gradedPeriodChipText,
                      active && vpStyles.gradedPeriodChipTextActive,
                    ]}>
                      {period.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {historyError && !historyLoading ? (
              <Text style={vpStyles.historyUnavailableText}>
                Unable to load price history. Please try again.
              </Text>
            ) : history && !history.historyAvailable && !historyLoading && (
              <Text style={vpStyles.historyUnavailableText}>
                History not yet available for this period
              </Text>
            )}
          </View>
        ) : (
          <View style={vpStyles.historyBlock}>
            <View style={vpStyles.historyHeader}>
              <Text style={vpStyles.historyLabel}>VERIFIED MARKET HISTORY</Text>
            </View>

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

            <MiniLineChart
              points={history?.points.map(pt => ({ date: pt.date, price: pt.price })) ?? []}
              width={chartWidth}
              height={100}
              loading={historyLoading}
            />

            {historyError && !historyLoading ? (
              <Text style={vpStyles.historyUnavailableText}>
                Unable to load price history. Please try again.
              </Text>
            ) : history && !history.historyAvailable && !historyLoading && (
              <Text style={vpStyles.historyUnavailableText}>
                History not yet available for this period
              </Text>
            )}
          </View>
        )
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

      <View style={vpStyles.sourceDisclosure}>
        <Text style={vpStyles.sourceDisclosureLabel}>PRICING SOURCES</Text>
        <Text style={vpStyles.sourceDisclosureText}>
          {selectedMarket ? (
            <>
            Verified Market uses normalized {selectedMarket.providers.map(provider => provider.label).join(', ')}
            {' '}quotes. Current values are based on {selectedMarket.confidence.providerCount}
            {' '}provider{selectedMarket.confidence.providerCount === 1 ? '' : 's'}; ranges appear only from
            retained snapshots. Original quote currency is preserved above.
            </>
          ) : (
            'Pricing is not currently available for this condition.'
          )}
        </Text>
        <Pressable
          onPress={() => void Linking.openURL(ebaySearchUrl)}
          style={vpStyles.ebayButton}
          accessibilityRole="link"
          accessibilityLabel={`View completed eBay listings for ${card.name}`}
        >
          <Feather name="tag" size={15} color={C.primaryForeground} />
          <Text style={vpStyles.ebayButtonText}>View sold listings on eBay</Text>
          <Feather name="external-link" size={14} color={C.primaryForeground} />
        </Pressable>
      </View>
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
  gradedCard: {
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 18,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8,
  },
  marketSignalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  marketSignalKicker: {
    color: '#A8A3AA',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.4,
  },
  marketSignalTitle: {
    marginTop: 6,
    color: C.foreground,
    fontSize: 20,
    lineHeight: 24,
    fontFamily: 'Inter_700Bold',
  },
  marketSignalMeta: {
    color: '#817E85',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter_400Regular',
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
  gradedControls: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  gradedSelectField: {
    flex: 1,
    position: 'relative',
  },
  gradedFieldLabel: {
    marginBottom: 7,
    color: '#85818A',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter_400Regular',
  },
  gradedSelectControl: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#39353E',
    borderRadius: 9,
    backgroundColor: '#29262D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  gradedSelectText: {
    flex: 1,
    color: C.foreground,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: 'Inter_700Bold',
  },
  gradedDropdownMenu: {
    position: 'absolute',
    top: 74,
    left: 0,
    right: 0,
    padding: 5,
    borderWidth: 1,
    borderColor: '#423D47',
    borderRadius: 10,
    backgroundColor: '#242127',
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  gradedDropdownOption: {
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gradedDropdownOptionActive: {
    backgroundColor: 'rgba(237,64,80,0.12)',
  },
  gradedDropdownText: {
    color: '#E7E1DC',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  gradedOptionList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  gradedOption: {
    minWidth: 94,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#3B3740',
    borderRadius: 8,
    backgroundColor: '#1D1B20',
  },
  gradedOptionActive: {
    borderColor: C.primary,
    backgroundColor: 'rgba(237,64,80,0.14)',
  },
  gradedOptionGrade: {
    color: '#BDB7B3',
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'Inter_700Bold',
  },
  gradedOptionGradeActive: { color: '#FFFFFF' },
  gradedOptionPop: {
    marginTop: 3,
    color: '#989299',
    fontSize: 11,
    lineHeight: 14,
    fontFamily: 'Inter_400Regular',
  },
  gradedOptionPopActive: { color: '#FF9AA0' },
  gradedComparisonRow: {
    minHeight: 42,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  gradedAvailabilityDot: {
    width: 7,
    height: 7,
    marginTop: 4,
    borderRadius: 4,
    backgroundColor: '#7AC4AA',
  },
  gradedComparisonText: {
    color: '#9B969C',
    fontSize: 13,
    lineHeight: 17,
    fontFamily: 'Inter_400Regular',
  },
  gradedComparisonStrong: {
    color: '#EEE9E4',
    fontFamily: 'Inter_700Bold',
  },
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
  gradedPriceBlock: { marginTop: 8, marginBottom: 14 },
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
  gradedHistoryBlock: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  gradedLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 10,
  },
  gradedLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gradedLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  gradedLegendText: {
    color: '#99949A',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  gradedMonthLabels: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gradedMonthLabel: {
    color: '#716D75',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  gradedPeriodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  gradedPeriodChip: {
    minWidth: 42,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
    alignItems: 'center',
  },
  gradedPeriodChipActive: {
    backgroundColor: '#EDE8E1',
  },
  gradedPeriodChipText: {
    color: '#817C84',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  gradedPeriodChipTextActive: {
    color: '#1B191D',
  },
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
  ebayButton: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  ebayButtonText: {
    color: C.primaryForeground,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
});
