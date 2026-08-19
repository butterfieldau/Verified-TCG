/**
 * Collection Archive — sold holdings with realised P/L, sale details,
 * current Verified Market value (where available), and restore action.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CardImage } from '@/components/ui/CardImage';
import colors from '@/constants/colors';
import {
  fetchArchive,
  restoreArchivedHolding,
  type ArchivedHolding,
} from '@/services/collectionPerformance';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';

const C = colors.dark;

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function gainColor(gain: number): string {
  if (gain > 0) return C.positive;
  if (gain < 0) return C.negative;
  return C.mutedForeground;
}

interface ArchivedItemCardProps {
  item: ArchivedHolding;
  onRestore: (id: string) => void;
  restoring: boolean;
}

function ArchivedItemCard({ item, onRestore, restoring }: ArchivedItemCardProps) {
  const hasGain = item.realisedGain !== null && item.realisedGainPercent !== null;
  const isProfit = (item.realisedGain ?? 0) >= 0;
  const gainClr = hasGain ? gainColor(item.realisedGain!) : C.mutedForeground;

  return (
    <View style={[itemStyles.card, { backgroundColor: C.card }]}>
      {/* Row 1 — Card image + basic info */}
      <View style={itemStyles.topRow}>
        <View style={itemStyles.imageWrap}>
          <LinearGradient
            colors={[item.card.gradientStart ?? '#1a1a2e', item.card.gradientEnd ?? '#16213e']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
          />
          <CardImage
            uri={item.card.imageUrl}
            style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
            contentFit="cover"
          />
        </View>

        <View style={itemStyles.infoBlock}>
          <Text style={itemStyles.cardName} numberOfLines={1}>{item.card.name}</Text>
          <Text style={itemStyles.cardMeta} numberOfLines={1}>
            {item.card.setName} · {item.card.number}
          </Text>
          {item.grading ? (
            <Text style={itemStyles.conditionTag}>
              {item.grading.company} {item.grading.grade}
            </Text>
          ) : (
            <Text style={itemStyles.conditionTag}>{item.condition ?? 'Raw'}</Text>
          )}
          <Text style={itemStyles.soldDate}>
            Sold {formatDate(item.soldAt)}
            {item.venue ? ` · ${item.venue}` : ''}
          </Text>
        </View>

        {/* P/L badge */}
        <View style={[itemStyles.plBadge, { backgroundColor: `${gainClr}18` }]}>
          <Text style={[itemStyles.plPct, { color: gainClr }]}>
            {hasGain ? `${isProfit ? '+' : ''}${item.realisedGainPercent!.toFixed(1)}%` : 'P/L —'}
          </Text>
          <Text style={[itemStyles.plAbs, { color: gainClr }]}>
            {hasGain
              ? `${isProfit ? '+' : ''}${fmtMoney(item.realisedGain!, item.displayCurrency)}`
              : 'Currency conversion unavailable'}
          </Text>
        </View>
      </View>

      {/* Row 2 — Sale details */}
      <View style={[itemStyles.detailRow, { borderTopColor: C.border }]}>
        <View style={itemStyles.detailCell}>
          <Text style={itemStyles.detailLabel}>SOLD FOR</Text>
          <Text style={itemStyles.detailValue}>{fmtMoney(item.salePrice, item.salePriceCurrency)}</Text>
        </View>
        <View style={itemStyles.detailCell}>
          <Text style={itemStyles.detailLabel}>COST BASIS</Text>
          <Text style={itemStyles.detailValue}>{fmtMoney(item.acquiredPrice, item.acquiredPriceCurrency)}</Text>
        </View>
        <View style={itemStyles.detailCell}>
          <Text style={itemStyles.detailLabel}>CURRENT MKT</Text>
          {item.currentMarketValue !== null ? (
            <Text style={itemStyles.detailValue}>
              {fmtMoney(item.currentMarketValue, item.currentMarketCurrency ?? item.displayCurrency)}
            </Text>
          ) : (
            <Text style={[itemStyles.detailValue, { color: C.mutedForeground }]}>—</Text>
          )}
        </View>
      </View>

      {/* Row 3 — Notes + restore action */}
      <View style={itemStyles.actionRow}>
        {item.notes ? (
          <Text style={itemStyles.notes} numberOfLines={2}>{item.notes}</Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <TouchableOpacity
          onPress={() => onRestore(item.id)}
          onPressIn={Platform.OS === 'web' ? () => onRestore(item.id) : undefined}
          disabled={restoring}
          activeOpacity={0.7}
          style={[itemStyles.restoreBtn, restoring && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={`Restore ${item.card.name} to collection`}
          hitSlop={4}
        >
          {restoring ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <>
              <Feather name="rotate-ccw" size={13} color={C.primary} />
              <Text style={itemStyles.restoreBtnText}>Restore</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const itemStyles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, marginBottom: 12 },
  topRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  imageWrap: {
    width: 56, height: 78, borderRadius: 8,
    position: 'relative', overflow: 'hidden',
  },
  infoBlock: { flex: 1, gap: 2 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  conditionTag: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  soldDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  plBadge: {
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    alignItems: 'flex-end', justifyContent: 'center', minWidth: 72,
  },
  plPct: { fontSize: 14, fontFamily: 'Rajdhani_700Bold' },
  plAbs: { fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 1 },
  detailRow: {
    flexDirection: 'row', borderTopWidth: 1,
    paddingTop: 10, marginBottom: 10,
  },
  detailCell: { flex: 1, gap: 2 },
  detailLabel: {
    fontSize: 9, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, letterSpacing: 0.6, textTransform: 'uppercase',
  },
  detailValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notes: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  restoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: C.primary,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
  restoreBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
});

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function CollectionArchiveScreen() {
  const insets = useSafeAreaInsets();
  const { currency } = useSettings();
  const { refreshCollection } = useApp();

  const [archive, setArchive] = useState<ArchivedHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const restoreInFlight = useRef(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const loadArchive = useCallback(async () => {
    try {
      setError(null);
      const items = await fetchArchive(currency);
      setArchive(items);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to load archive');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currency]);

  useEffect(() => {
    loadArchive();
  }, [loadArchive]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadArchive();
  }, [loadArchive]);

  const handleRestore = useCallback(async (id: string) => {
    const item = archive.find(a => a.id === id);
    if (!item || restoreInFlight.current) return;

    // Restore is reversible and non-destructive, so perform it directly. This
    // avoids React Native's system Alert action callbacks, which are not
    // consistently dispatched by react-native-web.
    restoreInFlight.current = true;
    setRestoringId(id);
    try {
      await restoreArchivedHolding(id);
      setArchive(prev => prev.filter(a => a.id !== id));
      await refreshCollection();
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error).message ?? 'Failed to restore');
    } finally {
      restoreInFlight.current = false;
      setRestoringId(null);
    }
  }, [archive, refreshCollection]);

  // Summary stats
  const totalProceeds = archive.reduce((s, a) => s + a.salePrice, 0);
  const hasCompleteProceeds = archive.every(a => a.salePriceCurrency === currency);
  const hasCompleteRealisedGain = archive.every(a => a.realisedGain !== null);
  const totalRealisedGain = archive.reduce((s, a) => s + (a.realisedGain ?? 0), 0);
  const gainColor = totalRealisedGain >= 0 ? C.positive : C.negative;

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* Header */}
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
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Archive</Text>
            <Text style={styles.subtitle}>Sold holdings</Text>
          </View>
        </View>

        {/* Summary card (only when data exists) */}
        {!loading && archive.length > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: C.card }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryLabel}>TOTAL PROCEEDS</Text>
                <Text style={styles.summaryValue}>
                  {hasCompleteProceeds
                    ? `${currency} ${totalProceeds.toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
                    : 'Unavailable'}
                </Text>
              </View>
              <View style={[styles.summaryStat, { borderLeftWidth: 1, borderLeftColor: C.border }]}>
                <Text style={styles.summaryLabel}>REALISED GAIN</Text>
                <Text style={[styles.summaryValue, { color: gainColor }]}>
                  {hasCompleteRealisedGain
                    ? `${totalRealisedGain >= 0 ? '+' : ''}${currency} ${Math.abs(totalRealisedGain).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`
                    : 'Unavailable'}
                </Text>
              </View>
            </View>
            <View style={styles.summaryFooter}>
              <Feather name="layers" size={12} color={C.mutedForeground} />
              <Text style={styles.summaryFooterText}>
                {archive.length} sold holding{archive.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>
        )}

        {/* Loading state */}
        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.loadingText}>Loading archive…</Text>
          </View>
        )}

        {/* Error state */}
        {!loading && error && (
          <View style={styles.centered}>
            <Feather name="alert-circle" size={32} color={C.negative} />
            <Text style={[styles.loadingText, { color: C.negative }]}>{error}</Text>
            <Pressable
              onPress={loadArchive}
              style={[styles.retryBtn, { backgroundColor: C.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Retry"
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Empty state */}
        {!loading && !error && archive.length === 0 && (
          <View style={styles.centered}>
            <Feather name="archive" size={44} color={C.mutedForeground} />
            <Text style={styles.emptyTitle}>No sold holdings</Text>
            <Text style={styles.emptyText}>
              When you record a sale from your collection, sold cards appear here with their realised P/L.
            </Text>
            <Pressable
              onPress={() => router.push('/(tabs)/collection' as any)}
              style={[styles.retryBtn, { backgroundColor: C.primary }]}
              accessibilityRole="button"
              accessibilityLabel="View Collection"
            >
              <Text style={styles.retryBtnText}>View Collection</Text>
            </Pressable>
          </View>
        )}

        {/* Archive list */}
        {!loading && !error && archive.map(item => (
          <ArchivedItemCard
            key={item.id}
            item={item}
            onRestore={handleRestore}
            restoring={restoringId === item.id}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surface,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },
  summaryCard: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 20,
  },
  summaryRow: { flexDirection: 'row' },
  summaryStat: { flex: 1, padding: 16, gap: 4 },
  summaryLabel: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, letterSpacing: 0.8, textTransform: 'uppercase',
  },
  summaryValue: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  summaryFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingBottom: 12, borderTopWidth: 1, borderTopColor: C.border,
    paddingTop: 10,
  },
  summaryFooterText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptyText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground,
    textAlign: 'center', lineHeight: 19, paddingHorizontal: 20,
  },
  retryBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 12, minHeight: 44, justifyContent: 'center',
  },
  retryBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
