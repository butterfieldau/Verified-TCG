import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import type { Card } from '@/types';
import {
  fetchEbaySoldHistory,
  type EbaySale,
  type EbaySoldHistoryResult,
} from '@/services/priceHistory';

const C = colors.dark;
const MAX_VISIBLE_SALES = 12;

export const EBAY_GRADE_GROUPS = [
  {
    key: 'raw',
    label: 'Raw',
    grades: [{ key: 'raw', label: 'Ungraded' }],
  },
  {
    key: 'psa',
    label: 'PSA',
    grades: [
      { key: 'psa8', label: '8' },
      { key: 'psa9', label: '9' },
      { key: 'psa10', label: '10' },
    ],
  },
  {
    key: 'bgs',
    label: 'BGS',
    grades: [
      { key: 'bgs95', label: '9.5' },
      { key: 'bgs10', label: '10' },
    ],
  },
  {
    key: 'cgc',
    label: 'CGC',
    grades: [{ key: 'cgc10', label: '10' }],
  },
] as const;

export type EbayGradeGroupKey = (typeof EBAY_GRADE_GROUPS)[number]['key'];

export function ebayGradeKeyForSelection(
  groupKey: EbayGradeGroupKey,
  requestedGradeKey?: string,
): string {
  const group = EBAY_GRADE_GROUPS.find((entry) => entry.key === groupKey) ?? EBAY_GRADE_GROUPS[0];
  return group.grades.find((grade) => grade.key === requestedGradeKey)?.key
    ?? group.grades[0].key;
}

export function latestEbaySales(sales: EbaySale[]): EbaySale[] {
  return [...sales]
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
    .slice(0, MAX_VISIBLE_SALES);
}

export function isSafeEbayListingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && (hostname === 'ebay.com'
        || hostname.endsWith('.ebay.com')
        || hostname.match(/^ebay\.[a-z]{2,3}(?:\.[a-z]{2})?$/) !== null
        || hostname.match(/\.ebay\.[a-z]{2,3}(?:\.[a-z]{2})?$/) !== null);
  } catch {
    return false;
  }
}

export function openEbayListing(
  url: string,
  openUrl: (value: string) => Promise<unknown> = Linking.openURL,
): Promise<unknown> {
  if (!isSafeEbayListingUrl(url)) return Promise.resolve(false);
  return openUrl(url);
}

function availabilityCopy(result: EbaySoldHistoryResult): {
  title: string;
  message: string;
  retryable: boolean;
} {
  switch (result.availability) {
    case 'no_results':
      return {
        title: 'No completed sales found',
        message: result.message ?? 'No matching completed eBay sales were found for this card and grade.',
        retryable: true,
      };
    case 'configuration_error':
      return {
        title: 'eBay sales aren’t configured',
        message: result.message ?? 'Completed-sale pricing is not configured for this app.',
        retryable: false,
      };
    case 'authorization_error':
      return {
        title: 'eBay access needs attention',
        message: result.message ?? 'eBay could not authorize completed-sale access.',
        retryable: true,
      };
    case 'permission_error':
      return {
        title: 'Completed-sale access denied',
        message: result.message ?? 'eBay access does not have permission to read completed sales.',
        retryable: true,
      };
    case 'conversion_error':
      return {
        title: 'Sale currency unavailable',
        message: result.message ?? 'Completed sales could not be converted to your selected currency.',
        retryable: true,
      };
    case 'network_error':
      return {
        title: 'Couldn’t reach eBay sales',
        message: result.message ?? 'Check your connection and try again.',
        retryable: true,
      };
    case 'sign_in_required':
      return {
        title: 'Sign in to view sales',
        message: result.message ?? 'Sign in again to view completed eBay sales.',
        retryable: true,
      };
    default:
      return {
        title: 'eBay sold listings unavailable',
        message: result.message ?? 'Completed eBay sales are temporarily unavailable. Please try again.',
        retryable: true,
      };
  }
}

function formatMoney(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function gradeLabel(group: EbayGradeGroupKey, gradeKey: string): string {
  const selectedGroup = EBAY_GRADE_GROUPS.find((entry) => entry.key === group);
  const selectedGrade = selectedGroup?.grades.find((entry) => entry.key === gradeKey);
  return selectedGroup?.key === 'raw'
    ? 'Raw'
    : `${selectedGroup?.label ?? ''} ${selectedGrade?.label ?? ''}`.trim();
}

function Availability({
  result,
  onRetry,
  onUpgrade,
}: {
  result: EbaySoldHistoryResult;
  onRetry: () => void;
  onUpgrade: () => void;
}) {
  const copy = availabilityCopy(result);
  const requiresUpgrade = result.requiresUpgrade || result.availability === 'permission_error';
  const noResults = result.availability === 'no_results';

  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: noResults ? C.muted : `${C.negative}18` }]}>
        <Feather
          name={noResults ? 'search' : requiresUpgrade ? 'lock' : 'alert-circle'}
          size={20}
          color={noResults ? C.mutedForeground : requiresUpgrade ? C.primary : C.negative}
        />
      </View>
      <Text style={styles.emptyTitle}>
        {requiresUpgrade ? 'Sold listings are a Pro feature' : copy.title}
      </Text>
      <Text style={styles.emptyText}>
        {requiresUpgrade
          ? 'Unlock individual completed sales, grade filters, and direct eBay links.'
          : copy.message}
      </Text>
      {requiresUpgrade ? (
        <Pressable
          onPress={onUpgrade}
          style={styles.primaryAction}
          accessibilityRole="button"
          accessibilityLabel="Upgrade to Pro to view sold listings"
        >
          <Text style={styles.primaryActionText}>View Pro</Text>
          <Feather name="arrow-up-right" size={14} color={C.primaryForeground} />
        </Pressable>
      ) : copy.retryable ? (
        <Pressable
          onPress={onRetry}
          style={styles.retryAction}
          accessibilityRole="button"
          accessibilityLabel="Retry eBay sold listings"
        >
          <Feather name="refresh-cw" size={14} color={C.primary} />
          <Text style={styles.retryActionText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SaleRow({
  sale,
  index,
}: {
  sale: EbaySale;
  index: number;
}) {
  const openListing = () => {
    void openEbayListing(sale.url).catch(() => {});
  };

  return (
    <Pressable
      onPress={openListing}
      style={({ pressed }) => [styles.saleRow, pressed && styles.saleRowPressed]}
      accessibilityRole="link"
      accessibilityLabel={`Open completed eBay sale ${index + 1}: ${sale.title}`}
    >
      <View style={styles.saleBrand}>
        <View style={styles.ebayMark}>
          <Text style={styles.ebayMarkText}>e</Text>
        </View>
        <Text style={styles.saleSource}>eBay</Text>
      </View>
      <View style={styles.saleDetails}>
        <Text style={styles.saleTitle} numberOfLines={2}>{sale.title}</Text>
        <Text style={styles.saleMeta}>
          Completed {formatDate(sale.endedAt)}{sale.condition ? ` · ${sale.condition}` : ''}
        </Text>
      </View>
      <View style={styles.saleAmount}>
        <Text style={styles.salePrice}>{formatMoney(sale.price, sale.currency)}</Text>
        <View style={styles.saleLink}>
          <Text style={styles.saleLinkText}>Open</Text>
          <Feather name="arrow-up-right" size={12} color={C.primary} />
        </View>
      </View>
    </Pressable>
  );
}

export default function EbaySoldListingsSheet({
  visible,
  card,
  displayCurrency,
  isPro,
  onClose,
  onUpgrade,
}: {
  visible: boolean;
  card: Card;
  displayCurrency: string;
  isPro: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [groupKey, setGroupKey] = useState<EbayGradeGroupKey>('raw');
  const [gradeKey, setGradeKey] = useState('raw');
  const [history, setHistory] = useState<EbaySoldHistoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const animation = useRef(new Animated.Value(0)).current;

  const activeGroup = EBAY_GRADE_GROUPS.find((group) => group.key === groupKey) ?? EBAY_GRADE_GROUPS[0];
  const selectedGradeKey = ebayGradeKeyForSelection(groupKey, gradeKey);
  const selectedGrade = activeGroup.grades.find((grade) => grade.key === selectedGradeKey)
    ?? activeGroup.grades[0];
  const visibleSales = useMemo(
    () => latestEbaySales(history?.sales ?? []),
    [history?.sales],
  );

  useEffect(() => {
    if (!visible) return;
    animation.setValue(0);
    Animated.timing(animation, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animation, visible]);

  useEffect(() => {
    if (!visible || !isPro) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setHistory(null);
    fetchEbaySoldHistory(card.id, {
      name: card.name,
      set: card.setName,
      game: card.tcg,
      number: card.number,
      gradeKey,
      period: '30D',
      displayCurrency,
    }, controller.signal, retryNonce > 0)
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((error: unknown) => {
        if (active && (error as Error)?.name !== 'AbortError') {
          setHistory(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    card.id,
    card.name,
    card.number,
    card.setName,
    card.tcg,
    displayCurrency,
    gradeKey,
    isPro,
    retryNonce,
    visible,
  ]);

  const selectGroup = (nextGroup: EbayGradeGroupKey) => {
    const next = EBAY_GRADE_GROUPS.find((group) => group.key === nextGroup) ?? EBAY_GRADE_GROUPS[0];
    setGroupKey(next.key);
    setGradeKey(ebayGradeKeyForSelection(next.key));
  };

  const sheetStyle = {
    opacity: animation,
    transform: [{
      translateY: animation.interpolate({ inputRange: [0, 1], outputRange: [44, 0] }),
    }],
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: animation.interpolate({ inputRange: [0, 1], outputRange: [0, 0.72] }) }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close sold listings"
          />
        </Animated.View>
        <Animated.View style={[styles.sheet, sheetStyle, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.eyebrow}>MARKET EVIDENCE</Text>
              <Text style={styles.sheetTitle}>Sold listings</Text>
              <Text style={styles.sheetSubtitle} numberOfLines={1}>
                {card.name} · {card.number}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close sold listings"
              hitSlop={8}
            >
              <Feather name="x" size={19} color={C.foreground} />
            </Pressable>
          </View>

          <View style={styles.selectionPanel}>
            <Text style={styles.selectionLabel}>GRADE COMPANY</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.groupRow}
              accessibilityLabel="Grade company selector"
            >
              {EBAY_GRADE_GROUPS.map((group) => (
                <Pressable
                  key={group.key}
                  onPress={() => selectGroup(group.key)}
                  style={[styles.groupButton, groupKey === group.key && styles.groupButtonActive]}
                  accessibilityRole="tab"
                  accessibilityLabel={`${group.label} grade company`}
                  accessibilityState={{ selected: groupKey === group.key }}
                >
                  <Text style={[styles.groupButtonText, groupKey === group.key && styles.groupButtonTextActive]}>
                    {group.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.gradeHeader}>
              <Text style={styles.selectionLabel}>GRADE NUMBER</Text>
              <Text style={styles.activeGrade}>{gradeLabel(groupKey, selectedGrade.key)}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.gradeRow}
              accessibilityLabel="Grade number selector"
            >
              {activeGroup.grades.map((grade) => (
                <Pressable
                  key={grade.key}
                  onPress={() => setGradeKey(grade.key)}
                  style={[styles.gradeButton, gradeKey === grade.key && styles.gradeButtonActive]}
                  accessibilityRole="radio"
                  accessibilityLabel={`${activeGroup.label} grade ${grade.label}`}
                  accessibilityState={{ selected: gradeKey === grade.key }}
                >
                  <Text style={[styles.gradeButtonText, gradeKey === grade.key && styles.gradeButtonTextActive]}>
                    {grade.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.loadingText}>Finding {gradeLabel(groupKey, selectedGrade.key)} sales…</Text>
            </View>
          ) : !isPro ? (
            <Availability
              result={{
                cardId: card.id,
                gradeKey,
                period: '30D',
                currency: displayCurrency,
                source: 'ebay_completed_sales',
                configured: true,
                availability: 'permission_error',
                coverage: 'returned_results',
                message: null,
                sales: [],
                points: [],
                movement: null,
                returnedAt: null,
                requiresUpgrade: true,
              }}
              onRetry={() => {}}
              onUpgrade={onUpgrade}
            />
          ) : history?.availability === 'available' && visibleSales.length > 0 ? (
            <>
              <View style={styles.resultHeader}>
                <View>
                  <Text style={styles.resultTitle}>Recent completed sales</Text>
                  <Text style={styles.resultSubtitle}>Showing the latest {visibleSales.length} verified matches</Text>
                </View>
                <View style={styles.resultBadge}>
                  <Text style={styles.resultBadgeText}>{history.currency}</Text>
                </View>
              </View>
              <ScrollView
                style={styles.salesList}
                contentContainerStyle={styles.salesListContent}
                showsVerticalScrollIndicator={false}
              >
                {visibleSales.map((sale, index) => (
                  <SaleRow key={`${sale.url}:${sale.endedAt}`} sale={sale} index={index} />
                ))}
              </ScrollView>
            </>
          ) : history ? (
            <Availability
              result={history}
              onRetry={() => setRetryNonce((current) => current + 1)}
              onUpgrade={onUpgrade}
            />
          ) : (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.loadingText}>Loading sold listings…</Text>
            </View>
          )}

          <Pressable
            onPress={onClose}
            style={styles.doneButton}
            accessibilityRole="button"
            accessibilityLabel="Close sold listings"
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050607' },
  sheet: {
    maxHeight: '91%',
    minHeight: 420,
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 16,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  sheetHeaderCopy: { flex: 1, paddingRight: 16 },
  eyebrow: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.6 },
  sheetTitle: { color: C.foreground, fontFamily: 'Rajdhani_700Bold', fontSize: 27, lineHeight: 31, marginTop: 3 },
  sheetSubtitle: { color: C.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 4 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.muted,
  },
  selectionPanel: {
    backgroundColor: C.muted,
    borderRadius: 17,
    padding: 13,
    marginBottom: 14,
  },
  selectionLabel: { color: C.mutedForeground, fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 1.2 },
  groupRow: { gap: 7, paddingTop: 9 },
  groupButton: {
    minWidth: 65,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 13,
    paddingVertical: 9,
    alignItems: 'center',
  },
  groupButtonActive: { backgroundColor: C.card, borderColor: C.primary },
  groupButtonText: { color: C.mutedForeground, fontFamily: 'Inter_700Bold', fontSize: 12 },
  groupButtonTextActive: { color: C.primary },
  gradeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  activeGrade: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 11 },
  gradeRow: { gap: 7, paddingTop: 9 },
  gradeButton: {
    minWidth: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: 'center',
  },
  gradeButtonActive: { backgroundColor: C.primary, borderColor: C.primary },
  gradeButtonText: { color: C.mutedForeground, fontFamily: 'Inter_700Bold', fontSize: 13 },
  gradeButtonTextActive: { color: C.primaryForeground },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 8 },
  resultTitle: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 15 },
  resultSubtitle: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  resultBadge: { borderRadius: 8, backgroundColor: `${C.primary}18`, paddingHorizontal: 8, paddingVertical: 5 },
  resultBadgeText: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.7 },
  salesList: { flex: 1 },
  salesListContent: { paddingBottom: 12 },
  saleRow: {
    minHeight: 73,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingVertical: 10,
  },
  saleRowPressed: { opacity: 0.65 },
  saleBrand: { width: 40, alignItems: 'center', justifyContent: 'center' },
  ebayMark: { width: 25, height: 21, alignItems: 'center', justifyContent: 'center' },
  ebayMarkText: { color: '#E53238', fontFamily: 'Rajdhani_700Bold', fontSize: 22, fontStyle: 'italic' },
  saleSource: { color: C.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 9, marginTop: -2 },
  saleDetails: { flex: 1, minWidth: 0 },
  saleTitle: { color: C.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 16 },
  saleMeta: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 4 },
  saleAmount: { minWidth: 76, alignItems: 'flex-end' },
  salePrice: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 12 },
  saleLink: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  saleLinkText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  loadingState: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: C.mutedForeground, fontFamily: 'Inter_500Medium', fontSize: 12 },
  emptyState: { minHeight: 210, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 15, textAlign: 'center', marginTop: 12 },
  emptyText: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  primaryAction: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 11, paddingHorizontal: 15, paddingVertical: 10, marginTop: 14 },
  primaryActionText: { color: C.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 12 },
  retryAction: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 14 },
  retryActionText: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 12 },
  doneButton: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, marginTop: 10 },
  doneButtonText: { color: C.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 14 },
});