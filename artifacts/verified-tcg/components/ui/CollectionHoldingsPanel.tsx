import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import {
  COLLECTION_GRADE_OPTIONS,
  findMatchingCollectionHolding,
  formatCollectionHoldingLabel,
  getItemCurrentValue,
  summarizeCollectionHoldings,
  type CollectionGradeOption,
} from '@/services/collection';
import { fetchVerifiedPricing, type CardPricingResult } from '@/services/verifiedPricing';
import type { Card, CollectionItem } from '@/types';
import colors from '@/constants/colors';

const C = colors.dark;

interface CollectionHoldingsPanelProps {
  card: Card;
  compact?: boolean;
}

function formatMoney(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function exactQuote(pricing: CardPricingResult | null, gradeKey: string): number | null {
  if (!pricing || (pricing.status !== 'available' && pricing.status !== 'stale')) return null;
  const quote = pricing.quotes.find(item => item.gradeKey === gradeKey);
  if (!quote) return null;
  const market = pricing.verifiedMarket.find(item => item.gradeKey === gradeKey);
  return market?.verifiedMarketValue ?? quote.price;
}

export default function CollectionHoldingsPanel({ card, compact = false }: CollectionHoldingsPanelProps) {
  const {
    collection,
    collectionLoading,
    collectionError,
    isAuthenticated,
    refreshCollection,
    addToCollection,
    updateCollectionHolding,
    removeFromCollection,
  } = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<CardPricingResult | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [pendingGradeKey, setPendingGradeKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeConfirmationId, setRemoveConfirmationId] = useState<string | null>(null);
  const pendingRef = useRef(new Set<string>());
  const pickerPendingRef = useRef(false);

  const holdings = useMemo(
    () => collection.filter(item => item.cardId === card.id),
    [collection, card.id],
  );
  const summary = summarizeCollectionHoldings(holdings);
  const totalCurrency = summary.currency ?? 'AUD';

  function setPending(id: string, pending: boolean) {
    if (pending) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPendingIds(new Set(pendingRef.current));
  }

  async function changeQuantity(item: CollectionItem, delta: 1 | -1) {
    if (pendingRef.current.has(item.id)) return;
    if (delta === -1 && item.quantity === 1) {
      setRemoveConfirmationId(item.id);
      return;
    }
    setPending(item.id, true);
    setSaveError(null);
    try {
      await updateCollectionHolding(item.id, { quantity: item.quantity + delta });
    } catch {
      setSaveError('Quantity could not be saved. Your collection has been restored; please try again.');
    } finally {
      setPending(item.id, false);
    }
  }

  async function confirmRemove(item: CollectionItem) {
    if (pendingRef.current.has(item.id)) return;
    setPending(item.id, true);
    setRemoveConfirmationId(null);
    setSaveError(null);
    try {
      await removeFromCollection(item.id);
    } catch {
      setSaveError('This copy could not be removed. Your collection has been restored; please try again.');
    } finally {
      setPending(item.id, false);
    }
  }

  async function openPicker() {
    if (pickerOpen) return;
    setPickerOpen(true);
    setPickerError(null);
    setPickerLoading(true);
    try {
      const result = await fetchVerifiedPricing(card.id, {
        name: card.name,
        set: card.setName,
        number: card.number,
        game: card.tcg,
        displayCurrency: totalCurrency,
      });
      setPricing(result);
    } catch {
      setPickerError('Exact prices could not be checked. You can still track any grade.');
    } finally {
      setPickerLoading(false);
    }
  }

  function closePicker() {
    if (pendingGradeKey) return;
    setPickerOpen(false);
    setPickerError(null);
    setPricing(null);
  }

  async function chooseGrade(option: CollectionGradeOption) {
    if (pickerPendingRef.current) return;
    pickerPendingRef.current = true;
    setPendingGradeKey(option.identityKey);
    setSaveError(null);
    const matching = findMatchingCollectionHolding(holdings, card.id, option.identityKey);
    try {
      if (matching) {
        await updateCollectionHolding(matching.id, { quantity: matching.quantity + 1 });
      } else {
        const today = new Date().toISOString().slice(0, 10);
        await addToCollection({
          id: `holding-${Date.now()}`,
          cardId: card.id,
          card,
          quantity: 1,
          condition: 'near_mint',
          acquiredAt: today,
          acquiredPrice: 0,
          currency: 'AUD',
          grading: option.gradeKey === 'raw'
            ? undefined
            : {
                company: option.company,
                grade: option.grade ?? 10,
                certNumber: '',
                gradedAt: today,
                ...(option.designation ? { designation: option.designation } : {}),
              },
        });
        }
      setPickerOpen(false);
      setPickerError(null);
    } catch {
      setPickerError('Could not save this holding. Nothing was changed; please try again.');
    } finally {
      pickerPendingRef.current = false;
      setPendingGradeKey(null);
    }
  }

  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      <View style={styles.header}>
        <View>
          <View style={styles.kickerRow}>
            <Feather name="layers" size={13} color={C.primary} />
            <Text style={styles.kicker}>YOUR HOLDINGS</Text>
          </View>
          <Text style={styles.title}>Owned copies</Text>
        </View>
        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>{summary.quantity} {summary.quantity === 1 ? 'copy' : 'copies'}</Text>
          <Text style={styles.totalValue}>
            {summary.totalValue != null ? formatMoney(summary.totalValue, totalCurrency) : 'Value unavailable'}
          </Text>
        </View>
      </View>

      {!isAuthenticated ? (
        <View style={styles.emptyState}>
          <Feather name="lock" size={24} color={C.mutedForeground} />
          <Text style={styles.emptyTitle}>Sign in to manage holdings</Text>
          <Text style={styles.emptyText}>Your exact grades and quantities are saved to your collection.</Text>
        </View>
      ) : collectionLoading && holdings.length === 0 ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={C.primary} />
          <Text style={styles.statusText}>Loading your holdings…</Text>
        </View>
      ) : collectionError && holdings.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="cloud-off" size={24} color={C.warning} />
          <Text style={styles.emptyTitle}>Holdings could not be loaded</Text>
          <Text style={styles.emptyText}>{collectionError.message}</Text>
          <Pressable onPress={() => void refreshCollection()} style={styles.retryButton} accessibilityRole="button">
            <Feather name="refresh-cw" size={14} color={C.primaryForeground} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : holdings.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="inbox" size={24} color={C.mutedForeground} />
          <Text style={styles.emptyTitle}>No copies tracked yet</Text>
          <Text style={styles.emptyText}>Choose a raw or exact graded variant to start tracking this card.</Text>
        </View>
      ) : (
        <>
          {(collectionError || saveError) && (
            <View style={styles.warningRow} accessibilityRole="alert">
              <Feather name="alert-circle" size={13} color={C.warning} />
              <Text style={styles.warningText}>{saveError ?? collectionError?.message}</Text>
            </View>
          )}
          {holdings.map(item => {
            const unitValue = getItemCurrentValue(item);
            const busy = pendingIds.has(item.id);
            const isConfirming = removeConfirmationId === item.id;
            const label = formatCollectionHoldingLabel(item);
            return (
              <View key={item.id} style={styles.holdingRow}>
                <View style={[styles.variantMark, item.grading && styles.variantMarkGraded]}>
                  <Text style={styles.variantMarkText}>{item.grading?.company ?? 'RAW'}</Text>
                </View>
                <View style={styles.holdingCopy}>
                  <Text style={styles.holdingTitle}>{label}</Text>
                  <Text style={styles.holdingMeta}>
                    {unitValue != null
                      ? `${formatMoney(unitValue, item.valuation?.currency ?? totalCurrency)} each`
                      : 'Exact price unavailable'}
                  </Text>
                  {isConfirming && (
                    <View style={styles.confirmRow}>
                      <Text style={styles.confirmText}>Remove final copy?</Text>
                      <Pressable onPress={() => setRemoveConfirmationId(null)} accessibilityRole="button" accessibilityLabel="Keep copy">
                        <Text style={styles.keepText}>Keep</Text>
                      </Pressable>
                      <Pressable onPress={() => void confirmRemove(item)} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
                        <Text style={styles.removeText}>Remove</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
                <View style={styles.quantityControls}>
                  <Pressable
                    onPress={() => void changeQuantity(item, -1)}
                    disabled={busy || isConfirming}
                    style={[styles.quantityButton, (busy || isConfirming) && styles.disabledButton]}
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease ${label} quantity`}
                  >
                    <Feather name="minus" size={15} color={C.foreground} />
                  </Pressable>
                  <Text style={styles.quantityText}>{busy ? '…' : item.quantity}</Text>
                  <Pressable
                    onPress={() => void changeQuantity(item, 1)}
                    disabled={busy || isConfirming}
                    style={[styles.quantityButton, (busy || isConfirming) && styles.disabledButton]}
                    accessibilityRole="button"
                    accessibilityLabel={`Increase ${label} quantity`}
                  >
                    <Feather name="plus" size={15} color={C.foreground} />
                  </Pressable>
                </View>
                <View style={styles.valueBlock}>
                  <Text style={styles.holdingValue}>
                    {unitValue != null
                      ? formatMoney(unitValue * item.quantity, item.valuation?.currency ?? totalCurrency)
                      : 'Unavailable'}
                  </Text>
                  <Text style={styles.valueLabel}>{unitValue != null ? 'market value' : 'not included'}</Text>
                </View>
              </View>
            );
          })}
          {summary.unavailableVariants > 0 && (
            <Text style={styles.disclaimer}>
              {summary.unavailableVariants} variant{summary.unavailableVariants === 1 ? '' : 's'} has no trustworthy exact quote and is excluded from the total.
            </Text>
          )}
        </>
      )}

      {isAuthenticated && (
        <Pressable
          onPress={() => void openPicker()}
          disabled={pendingGradeKey != null}
          style={styles.chooseButton}
          accessibilityRole="button"
          accessibilityLabel="Choose another grade"
        >
          <Feather name="plus-circle" size={16} color={C.primary} />
          <Text style={styles.chooseText}>Choose another grade</Text>
          <Feather name="chevron-right" size={15} color={C.primary} />
        </Pressable>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={closePicker}>
        <View style={styles.modalBackdrop}>
          <View style={styles.picker}>
            <View style={styles.pickerHeader}>
              <View>
                <Text style={styles.pickerKicker}>ADD TO HOLDINGS</Text>
                <Text style={styles.pickerTitle}>Choose another grade</Text>
              </View>
              <Pressable onPress={closePicker} disabled={pendingGradeKey != null} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close grade picker">
                <Feather name="x" size={18} color={C.foreground} />
              </Pressable>
            </View>
            <Text style={styles.pickerDescription}>
              Select the exact variant you own. A missing price never prevents collection tracking.
            </Text>
            {pickerLoading ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.statusText}>Checking exact grades…</Text>
              </View>
            ) : (
              <>
                {pickerError && (
                  <View style={styles.warningRow} accessibilityRole="alert">
                    <Feather name="alert-circle" size={13} color={C.warning} />
                    <Text style={styles.warningText}>{pickerError}</Text>
                  </View>
                )}
                <ScrollView style={styles.optionList} showsVerticalScrollIndicator={false}>
                  {COLLECTION_GRADE_OPTIONS.map(option => {
                    const existing = findMatchingCollectionHolding(holdings, card.id, option.identityKey);
                    const quote = existing?.valuation?.price ?? exactQuote(pricing, option.gradeKey);
                    const quoteCurrency = existing?.valuation?.currency ?? pricing?.conversion?.displayCurrency ?? totalCurrency;
                    return (
                      <Pressable
                        key={option.identityKey}
                        onPress={() => void chooseGrade(option)}
                        disabled={pendingGradeKey != null}
                        style={[styles.gradeOption, existing && styles.gradeOptionOwned]}
                        accessibilityRole="button"
                        accessibilityLabel={`${option.label}, ${quote != null ? formatMoney(quote, quoteCurrency) : 'price unavailable'}`}
                      >
                        <View style={styles.optionIcon}>
                          <Feather name={existing ? 'check' : 'plus'} size={14} color={existing ? C.positive : C.primary} />
                        </View>
                        <View style={styles.optionCopy}>
                          <Text style={styles.optionLabel}>{option.label}</Text>
                          <Text style={styles.optionMeta}>{existing ? `${existing.quantity} tracked · adds one copy` : 'Adds one copy'}</Text>
                        </View>
                        <Text style={[styles.optionPrice, quote == null && styles.optionUnavailable]}>
                          {pendingGradeKey === option.identityKey ? 'Saving…' : quote != null ? formatMoney(quote, quoteCurrency) : 'Unavailable'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 14 },
  panelCompact: { marginBottom: 0 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 1.2 },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginTop: 3 },
  totalBlock: { alignItems: 'flex-end' },
  totalLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  totalValue: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground, marginTop: 3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 18 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  emptyState: { alignItems: 'center', gap: 7, paddingVertical: 18 },
  emptyTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  emptyText: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', maxWidth: 290 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 4 },
  retryText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primaryForeground },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: `${C.warning}14`, borderRadius: 9, padding: 9 },
  warningText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', color: C.warning },
  holdingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 13 },
  variantMark: { width: 39, height: 39, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${C.primary}18` },
  variantMarkGraded: { backgroundColor: `${C.positive}18` },
  variantMarkText: { fontSize: 8, fontFamily: 'Inter_700Bold', color: C.primary, textAlign: 'center' },
  holdingCopy: { flex: 1, minWidth: 92 },
  holdingTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  holdingMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  quantityButton: { width: 27, height: 27, borderRadius: 8, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.45 },
  quantityText: { minWidth: 18, textAlign: 'center', fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  valueBlock: { minWidth: 76, alignItems: 'flex-end' },
  holdingValue: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary, textAlign: 'right' },
  valueLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  confirmText: { width: '100%', fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.warning },
  keepText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.foreground },
  removeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.negative },
  disclaimer: { fontSize: 10, lineHeight: 15, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  chooseButton: { minHeight: 44, borderWidth: 1, borderColor: `${C.primary}66`, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 2 },
  chooseText: { flex: 1, fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  picker: { maxHeight: '86%', backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  pickerKicker: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 1.2 },
  pickerTitle: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  pickerDescription: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  optionList: { flexGrow: 0 },
  gradeOption: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingVertical: 10 },
  gradeOptionOwned: { backgroundColor: `${C.primary}08` },
  optionIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1 },
  optionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  optionMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  optionPrice: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.primary, textAlign: 'right' },
  optionUnavailable: { color: C.mutedForeground },
});