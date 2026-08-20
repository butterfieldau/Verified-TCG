/**
 * Completed eBay sales for a card. This component deliberately has its own
 * source label so Verified Market's retained provider history is never shown
 * as an individual eBay sale.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import type { Card } from '@/types';
import ProFeaturePreview from '@/components/ui/ProFeaturePreview';
import {
  fetchEbaySoldHistory,
  type EbaySoldHistoryPoint,
  type EbaySoldHistoryResult,
} from '@/services/priceHistory';

const C = colors.dark;
const GRADES = [
  { key: 'raw', label: 'Raw' },
  { key: 'psa9', label: 'PSA 9' },
  { key: 'psa10', label: 'PSA 10' },
  { key: 'cgc10', label: 'CGC 10' },
  { key: 'bgs95', label: 'BGS 9.5' },
] as const;
const PERIODS = ['7D', '30D', '90D', '1Y', 'All'] as const;
type Period = (typeof PERIODS)[number];

function formatMoney(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Completed date unavailable';
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function TrendChart({ points, loading }: { points: EbaySoldHistoryPoint[]; loading: boolean }) {
  if (loading) {
    return <View style={styles.chart}><ActivityIndicator size="small" color={C.primary} /></View>;
  }
  if (points.length < 2) {
    return (
      <View style={styles.chart}>
        <Feather name="bar-chart-2" size={24} color={C.mutedForeground} />
        <Text style={styles.chartEmpty}>At least two completed sale dates are needed to draw a trend.</Text>
      </View>
    );
  }

  const width = 320;
  const height = 112;
  const pad = 5;
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const coords = points.map((point, index) => ({
    x: pad + (index / (points.length - 1)) * (width - pad * 2),
    y: pad + ((max - point.price) / range) * (height - pad * 2),
  }));
  let line = `M ${coords[0]!.x} ${coords[0]!.y}`;
  for (let index = 1; index < coords.length; index += 1) {
    const previous = coords[index - 1]!;
    const current = coords[index]!;
    const controlX = (previous.x + current.x) / 2;
    line += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }
  const positive = prices[prices.length - 1]! >= prices[0]!;
  const lineColor = positive ? C.positive : C.negative;
  const area = `${line} L ${coords[coords.length - 1]!.x} ${height - pad} L ${coords[0]!.x} ${height - pad} Z`;

  return (
    <View style={styles.chart}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="ebaySaleTrendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity={0.28} />
            <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>
        <Path d={area} fill="url(#ebaySaleTrendFill)" />
        <Path d={line} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

function Availability({ result }: { result: EbaySoldHistoryResult }) {
  const noResults = result.availability === 'no_results';
  return (
    <View style={styles.availability}>
      <Feather name={noResults ? 'search' : 'alert-circle'} size={24} color={noResults ? C.mutedForeground : C.negative} />
      <Text style={styles.availabilityTitle}>{noResults ? 'No completed sales found' : 'eBay sold history unavailable'}</Text>
      <Text style={styles.availabilityText}>{result.message ?? 'No individual eBay sales are available for this card.'}</Text>
    </View>
  );
}

function SalesContent({ card, displayCurrency }: { card: Card; displayCurrency: string }) {
  const [gradeKey, setGradeKey] = useState<string>('raw');
  const [period, setPeriod] = useState<Period>('30D');
  const [history, setHistory] = useState<EbaySoldHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setHistory(null);
    fetchEbaySoldHistory(card.id, {
      name: card.name,
      set: card.setName,
      game: card.tcg,
      gradeKey,
      period,
      displayCurrency,
    }, controller.signal)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [card.id, card.name, card.setName, card.tcg, displayCurrency, gradeKey, period]);

  const activeGrade = GRADES.find((grade) => grade.key === gradeKey)?.label ?? 'Raw';
  const hasSales = history?.availability === 'available' && history.sales.length > 0;
  const movement = history?.movement;

  return (
    <View style={[styles.card, { backgroundColor: C.card }]}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Feather name="shopping-bag" size={14} color={C.primary} />
          <Text style={styles.label}>EBAY SOLD HISTORY</Text>
        </View>
        {hasSales && <Text style={styles.count}>{history.sales.length} sales</Text>}
      </View>
      <Text style={styles.sourceNote}>Completed eBay listings title-matched to this card — not Verified Market provider history.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {GRADES.map((grade) => (
          <Pressable
            key={grade.key}
            onPress={() => setGradeKey(grade.key)}
            style={[styles.chip, gradeKey === grade.key && styles.chipActive]}
            accessibilityRole="tab"
            accessibilityLabel={`${grade.label} completed sales`}
            accessibilityState={{ selected: gradeKey === grade.key }}
          >
            <Text style={[styles.chipText, gradeKey === grade.key && styles.chipTextActive]}>{grade.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {PERIODS.map((value) => (
          <Pressable
            key={value}
            onPress={() => setPeriod(value)}
            style={[styles.chip, period === value && styles.chipActive]}
            accessibilityRole="button"
            accessibilityLabel={`${value} eBay sold-history period`}
            accessibilityState={{ selected: period === value }}
          >
            <Text style={[styles.chipText, period === value && styles.chipTextActive]}>{value}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <TrendChart points={[]} loading />
      ) : hasSales ? (
        <>
          <View style={styles.summary}>
            <Text style={styles.summaryValue}>{formatMoney(history.sales[0]!.price, history.currency)}</Text>
            <Text style={styles.summaryLabel}>{activeGrade} latest completed sale</Text>
            {movement && (
              <View style={styles.movement}>
                <Feather
                  name={movement.direction === 'up' ? 'trending-up' : movement.direction === 'down' ? 'trending-down' : 'minus'}
                  size={12}
                  color={movement.direction === 'up' ? C.positive : movement.direction === 'down' ? C.negative : C.mutedForeground}
                />
                <Text style={[styles.movementText, { color: movement.direction === 'up' ? C.positive : movement.direction === 'down' ? C.negative : C.mutedForeground }]}>
                  {movement.direction === 'up' ? '+' : ''}{movement.percent.toFixed(1)}% over {period}
                </Text>
              </View>
            )}
          </View>
          <TrendChart points={history.points} loading={false} />
          {history.coverage === 'provider_limited' && (
            <Text style={styles.coverageNote}>{history.message}</Text>
          )}
          <View style={styles.salesHeader}>
            <Text style={styles.salesHeading}>RECENT COMPLETED SALES</Text>
            <Text style={styles.salesCurrency}>{history.currency}</Text>
          </View>
          {history.sales.map((sale) => (
            <Pressable
              key={`${sale.url}:${sale.endedAt}`}
              onPress={() => Linking.openURL(sale.url).catch(() => {})}
              style={styles.sale}
              accessibilityRole="link"
              accessibilityLabel={`Open eBay sale: ${sale.title}`}
            >
              <View style={styles.saleDetails}>
                <Text style={styles.saleTitle} numberOfLines={2}>{sale.title}</Text>
                <Text style={styles.saleMeta}>
                  {formatDate(sale.endedAt)}{sale.condition ? ` · ${sale.condition}` : ''}
                </Text>
              </View>
              <View style={styles.salePrice}>
                <Text style={styles.salePriceText}>{formatMoney(sale.price, sale.currency)}</Text>
                <Feather name="external-link" size={13} color={C.mutedForeground} />
              </View>
            </Pressable>
          ))}
        </>
      ) : history ? (
        <Availability result={history} />
      ) : (
        <View style={styles.availability}>
          <Feather name="alert-circle" size={24} color={C.negative} />
          <Text style={styles.availabilityTitle}>eBay sold history unavailable</Text>
          <Text style={styles.availabilityText}>Couldn’t load completed eBay sales. Check your connection and try again.</Text>
        </View>
      )}
    </View>
  );
}

export default function EbaySoldHistoryCard({
  card,
  displayCurrency,
}: {
  card: Card;
  displayCurrency: string;
}) {
  const preview = (
    <View style={[styles.card, { backgroundColor: C.card }]}>
      <View style={styles.headerTitle}>
        <Feather name="shopping-bag" size={14} color={C.primary} />
        <Text style={styles.label}>EBAY SOLD HISTORY</Text>
      </View>
      <Text style={[styles.sourceNote, { marginBottom: 0 }]}>Unlock completed-sale records, links, and eBay-only price trends.</Text>
    </View>
  );

  return (
    <ProFeaturePreview
      featureTitle="eBay Sold History"
      description="See individual completed eBay sales behind each card trend."
      ctaLabel="Unlock eBay Sold History"
      previewContent={preview}
      lockedContent={<SalesContent card={card} displayCurrency={displayCurrency} />}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 18, marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { color: C.mutedForeground, fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.1 },
  count: { color: C.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 12 },
  sourceNote: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginBottom: 14 },
  chips: { gap: 7, paddingVertical: 4, paddingRight: 4 },
  chip: { borderRadius: 16, borderColor: C.border, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
  chipActive: { borderColor: C.primary, backgroundColor: `${C.primary}1F` },
  chipText: { color: C.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  chipTextActive: { color: C.primary },
  summary: { marginTop: 12, marginBottom: 4 },
  summaryValue: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 22 },
  summaryLabel: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  movement: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  movementText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  chart: { height: 112, alignItems: 'center', justifyContent: 'center', marginVertical: 10 },
  chartEmpty: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 8, paddingHorizontal: 24, textAlign: 'center' },
  coverageNote: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  salesHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingBottom: 6 },
  salesHeading: { color: C.mutedForeground, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  salesCurrency: { color: C.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 10 },
  sale: { alignItems: 'center', borderBottomColor: C.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 64, paddingVertical: 10 },
  saleDetails: { flex: 1 },
  saleTitle: { color: C.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  saleMeta: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  salePrice: { alignItems: 'flex-end', gap: 3 },
  salePriceText: { color: C.positive, fontFamily: 'Inter_700Bold', fontSize: 13 },
  availability: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 28 },
  availabilityTitle: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 10, textAlign: 'center' },
  availabilityText: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
});