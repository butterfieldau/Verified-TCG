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
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle, Line as SvgLine } from 'react-native-svg';
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

interface GradedScaleOption {
  key: string;
  grader: string;
  grade: string;
  label: string;
  quote?: PricingQuote;
}

const HALF_POINT_GRADES = [
  '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5',
  '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10',
] as const;

const GRADING_SCALES: Record<string, readonly string[]> = {
  PSA: ['Authentic', ...HALF_POINT_GRADES.filter(grade => grade !== '9.5')],
  BGS: ['Authentic', ...HALF_POINT_GRADES, '10 Black Label'],
  CGC: ['Authentic', ...HALF_POINT_GRADES, 'Pristine 10'],
  SGC: ['Authentic', ...HALF_POINT_GRADES],
  TAG: ['Authentic', ...HALF_POINT_GRADES],
  ACE: ['Authentic', ...HALF_POINT_GRADES],
};

const GRADING_COMPANIES = Object.keys(GRADING_SCALES);

function normalizedGrade(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getGradedQuoteOption(quote: PricingQuote): GradedQuoteOption {
  const label = quote.label.trim();
  const specialMatch = label.match(/^(.*?)\s+(Authentic|Pristine(?:\s+10)?|10\s+Black\s+Label)$/i);
  if (specialMatch) {
    const rawGrader = specialMatch[1]!.trim();
    const grader = rawGrader.toUpperCase() === 'BECKETT' ? 'BGS' : rawGrader;
    return { quote, grader, grade: specialMatch[2]! };
  }
  const match = label.match(/^(.*?)(?:\s+)(\d+(?:\.\d+)?)$/);
  if (!match) return { quote, grader: label || 'Graded', grade: label || '—' };

  const rawGrader = match[1]!.replace(/\s+graded$/i, '').trim() || 'Graded';
  const grader = rawGrader.toUpperCase() === 'BECKETT' ? 'BGS' : rawGrader;
  return { quote, grader, grade: match[2]! };
}

function getGradedScaleOptions(
  grader: string,
  quotedOptions: GradedQuoteOption[],
): GradedScaleOption[] {
  const configuredGrades = GRADING_SCALES[grader] ?? [];
  const configured = configuredGrades.map(grade => {
    const quoteOption = quotedOptions.find(option =>
      option.grader.toLowerCase() === grader.toLowerCase()
      && normalizedGrade(option.grade) === normalizedGrade(grade),
    );
    return {
      key: quoteOption?.quote.gradeKey
        ?? `${grader.toLowerCase()}_${grade.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      grader,
      grade,
      label: `${grader} ${grade}`,
      quote: quoteOption?.quote,
    };
  });
  const extras = quotedOptions
    .filter(option =>
      option.grader.toLowerCase() === grader.toLowerCase()
      && !configuredGrades.some(grade => normalizedGrade(grade) === normalizedGrade(option.grade)),
    )
    .map(option => ({
      key: option.quote.gradeKey,
      grader,
      grade: option.grade,
      label: option.quote.label,
      quote: option.quote,
    }));
  return [...configured, ...extras];
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
  points: { date: string; price: number; currency?: string }[];
  width: number;
  height: number;
  loading?: boolean;
  graded?: boolean;
}

function MiniLineChart({ points, width, height, loading, graded = false }: MiniChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
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

  // One observation establishes a current quote, not market history. Drawing
  // it as a full-width filled chart made a newly captured value look broken
  // and implied movement that the provider has not supplied.
  if (points.length === 1) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: graded ? C.primary : '#22c55e' }} />
        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.42)', textAlign: 'center' }}>
          One retained market observation
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
  const activePoint = activeIndex == null ? null : points[activeIndex] ?? null;
  const activeCoord = activeIndex == null ? null : coords[activeIndex] ?? null;
  const selectAtX = (x: number) => {
    const ratio = Math.max(0, Math.min(1, (x - PAD.left) / Math.max(chartW, 1)));
    setActiveIndex(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };

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
  const lineColor = graded ? C.primary : isUp ? '#22c55e' : '#ef4444';

  return (
    <View
      style={{ width, height, position: 'relative' }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={event => selectAtX(event.nativeEvent.locationX)}
      onResponderMove={event => selectAtX(event.nativeEvent.locationX)}
      onResponderRelease={() => setActiveIndex(null)}
      onResponderTerminate={() => setActiveIndex(null)}
      accessibilityRole="adjustable"
      accessibilityLabel="Interactive price history chart. Hold and drag to inspect a retained market observation."
    >
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="vpChartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
          <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      {maxP !== minP && <Path d={areaPath} fill="url(#vpChartFill)" />}
      <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {activeCoord && activePoint && (
        <>
          <SvgLine x1={activeCoord.x} y1={PAD.top} x2={activeCoord.x} y2={PAD.top + chartH} stroke={lineColor} strokeWidth={1} strokeDasharray="3,3" opacity={0.75} />
          <Circle cx={activeCoord.x} cy={activeCoord.y} r={8} fill={lineColor} opacity={0.22} />
          <Circle cx={activeCoord.x} cy={activeCoord.y} r={4} fill={lineColor} />
          <Circle cx={activeCoord.x} cy={activeCoord.y} r={2} fill="#FFFFFF" />
        </>
      )}
    </Svg>
    {activePoint && (
      <View pointerEvents="none" style={vpStyles.chartTooltip}>
        <Text style={vpStyles.chartTooltipPrice}>{formatPrice(activePoint.price, activePoint.currency ?? 'AUD')}</Text>
        <Text style={vpStyles.chartTooltipDate}>{new Date(activePoint.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
      </View>
    )}
    </View>
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
      ? matchingQuotes.find(quote => quote.gradeKey === 'psa_10')
        ?? matchingQuotes.find(quote => getGradedQuoteOption(quote).grader === 'PSA' && getGradedQuoteOption(quote).grade === '10')
        ?? matchingQuotes[0]
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
      if (previous && GRADING_COMPANIES.includes(previous)) return previous;
      return matchingQuotes.some(quote => getGradedQuoteOption(quote).grader === 'PSA')
        ? 'PSA'
        : fallbackQuote ? getGradedQuoteOption(fallbackQuote).grader : GRADING_COMPANIES[0]!;
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
  const graderOptions = GRADING_COMPANIES;
  const activeGrader = selectedGrader || graderOptions[0] || '';
  const activeGraderQuotes = gradedQuoteOptions.filter(option => option.grader === activeGrader);
  const activeGraderGrades = getGradedScaleOptions(activeGrader, gradedQuoteOptions);
  const selectedGradeOption = activeGraderGrades.find(option => option.key === selectedGradeKey)
    ?? activeGraderGrades[activeGraderGrades.length - 1];
  const selectedQuote: PricingQuote | undefined =
    visibleQuotes.find(q => q.gradeKey === selectedGradeKey)
    ?? (mode === 'raw' ? visibleQuotes[0] : undefined);
  const selectedMarket =
    (pricing.verifiedMarket ?? []).find(value => value.gradeKey === selectedGradeKey)
    ?? (mode === 'raw'
      ? (pricing.verifiedMarket ?? []).find(value =>
          visibleQuotes.some(quote => quote.gradeKey === value.gradeKey),
        )
      : undefined);

  const hasQuotes = visibleQuotes.length > 0;
  const isAvailable = pricing.status === 'available' || pricing.status === 'stale';

  // Movement from history
  const movement = history?.movement ?? null;

  const ebaySearchUrl = `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent([
    card.name,
    card.setName,
    card.number,
    mode === 'graded' ? selectedGradeOption?.label : null,
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
    const grades = getGradedScaleOptions(grader, gradedQuoteOptions);
    const quotedGrades = grades.filter(option => option.quote);
    const next = quotedGrades.find(option => option.grade === '10')
      ?? quotedGrades[0]
      ?? grades.find(option => option.grade === '10')
      ?? grades[0];
    setSelectedGrader(grader);
    setOpenGradedSelect(null);
    if (next) {
      setSelectedGradeKey(next.key);
      setSelectedGradeKeys(next.quote ? [next.quote.gradeKey] : []);
    }
  };

  const choosePrimaryGrade = (option: GradedScaleOption) => {
    setSelectedGradeKey(option.key);
    setSelectedGradeKeys(option.quote ? [option.quote.gradeKey] : []);
    setOpenGradedSelect(null);
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
          <Text style={vpStyles.marketSignalTitle}>Graded market</Text>
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
      {mode === 'graded' ? (
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
            <Text style={vpStyles.gradedFieldLabel}>Grade</Text>
            <Pressable
              onPress={() => setOpenGradedSelect(current => current === 'grade' ? null : 'grade')}
              style={vpStyles.gradedSelectControl}
              accessibilityRole="button"
              accessibilityLabel={`Grade, ${selectedGradeOption?.label ?? 'unavailable'}`}
              accessibilityState={{ expanded: openGradedSelect === 'grade' }}
            >
              <Text style={vpStyles.gradedSelectText} numberOfLines={1}>
                {selectedGradeOption?.label ?? 'Select grade'}
              </Text>
              <Feather name="chevron-down" size={15} color={C.foreground} />
            </Pressable>
            {openGradedSelect === 'grade' && (
              <View style={vpStyles.gradedDropdownMenu}>
                  <ScrollView
                    style={vpStyles.gradedDropdownScroll}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    {activeGraderGrades.map(option => (
                      <Pressable
                        key={option.key}
                        onPress={() => choosePrimaryGrade(option)}
                        style={[
                          vpStyles.gradedDropdownOption,
                          option.key === selectedGradeOption?.key && vpStyles.gradedDropdownOptionActive,
                        ]}
                      >
                        <Text style={vpStyles.gradedDropdownText}>{option.label}</Text>
                        <View style={vpStyles.gradedDropdownStatus}>
                          {!option.quote && <Text style={vpStyles.gradedNoQuoteText}>No quote</Text>}
                          {option.key === selectedGradeOption?.key && (
                            <Feather name="check" size={14} color={C.primary} />
                          )}
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
              </View>
            )}
          </View>
        </View>
      ) : null}

      {mode !== 'graded' && hasQuotes ? (
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
           {mode !== 'graded' && selectedMarket?.range && (
             <Text style={vpStyles.marketRange}>
               Retained range {selectedMarket.range.currency}{' '}
               {(selectedMarket.range.lowCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
               {' – '}
               {(selectedMarket.range.highCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
               {' · '}{selectedMarket.range.sampleCount} snapshots
             </Text>
           )}
          {mode !== 'graded' && selectedQuote.originalCurrency !== selectedQuote.currency && (
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
      ) : mode === 'graded' && selectedGradeOption ? (
        <View style={vpStyles.gradeUnavailableBlock}>
          <Text style={vpStyles.gradeUnavailableLabel}>{selectedGradeOption.label}</Text>
          <Text style={vpStyles.gradeUnavailableText}>Verified market price unavailable</Text>
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

      {mode !== 'graded' && selectedMarket && (
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
      {isPro && hasQuotes && (mode !== 'graded' || selectedQuote) && (
        mode === 'graded' ? (
          <View style={[vpStyles.historyBlock, vpStyles.gradedHistoryBlock]}>
            <MiniLineChart
              points={history?.points.map(pt => ({ date: pt.date, price: pt.price, currency: pt.currency })) ?? []}
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
              points={history?.points.map(pt => ({ date: pt.date, price: pt.price, currency: pt.currency })) ?? []}
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
    padding: 18,
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
    marginBottom: 14,
  },
  marketSignalTitle: {
    color: C.foreground,
    fontSize: 20,
    lineHeight: 24,
    fontFamily: 'Inter_700Bold',
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
    maxHeight: 276,
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
  gradedDropdownScroll: { maxHeight: 264 },
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
    flex: 1,
    color: '#E7E1DC',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  gradedDropdownStatus: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  gradedNoQuoteText: {
    color: C.mutedForeground,
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
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
  gradeUnavailableBlock: {
    minHeight: 78,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.surface,
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  gradeUnavailableLabel: { color: C.foreground, fontSize: 14, fontFamily: 'Inter_700Bold' },
  gradeUnavailableText: {
    marginTop: 4,
    color: C.mutedForeground,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
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
  chartTooltip: {
    position: 'absolute', top: 8, left: 8, right: 8,
    alignItems: 'center', pointerEvents: 'none',
  },
  chartTooltipPrice: {
    color: C.foreground, fontSize: 13, fontFamily: 'Inter_700Bold',
    backgroundColor: 'rgba(10,10,10,0.88)', borderRadius: 8,
    paddingHorizontal: 9, paddingTop: 5, paddingBottom: 2,
  },
  chartTooltipDate: {
    color: C.mutedForeground, fontSize: 10, fontFamily: 'Inter_400Regular',
    backgroundColor: 'rgba(10,10,10,0.88)', borderRadius: 8,
    paddingHorizontal: 9, paddingBottom: 5,
  },
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
