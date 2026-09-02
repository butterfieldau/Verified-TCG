import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
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
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
  const [pickerCompany, setPickerCompany] = useState('PSA');
  const [pickerGradeIdentity, setPickerGradeIdentity] = useState('');
  const [openPickerSelect, setOpenPickerSelect] = useState<'company' | 'grade' | null>(null);
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
  const rawHolding = holdings.find(item => !item.grading);
  const gradedHoldings = holdings.filter(item => item.grading);
  const slabQuantity = gradedHoldings.reduce((total, item) => total + item.quantity, 0);
  const gradedTotalValue = gradedHoldings.reduce<number | null>((total, item) => {
    const unitValue = getItemCurrentValue(item);
    return total != null && unitValue != null ? total + unitValue * item.quantity : null;
  }, 0);
  const gradedOptions = COLLECTION_GRADE_OPTIONS.filter(option => option.gradeKey !== 'raw');
  const pickerCompanies = [...new Set(gradedOptions.map(option => option.company))];
  const companyGradeOptions = gradedOptions.filter(option => option.company === pickerCompany);
  const selectedPickerGrade = companyGradeOptions.find(
    option => option.identityKey === pickerGradeIdentity,
  ) ?? companyGradeOptions[companyGradeOptions.length - 1];
  const rawOption = COLLECTION_GRADE_OPTIONS.find(option => option.gradeKey === 'raw');
  const removeCandidate = removeConfirmationId
    ? holdings.find(item => item.id === removeConfirmationId) ?? null
    : null;

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
    const defaultCompany = pickerCompanies.includes('PSA') ? 'PSA' : pickerCompanies[0] ?? '';
    const defaults = gradedOptions.filter(option => option.company === defaultCompany);
    setPickerCompany(defaultCompany);
    setPickerGradeIdentity(defaults[defaults.length - 1]?.identityKey ?? '');
    setOpenPickerSelect(null);
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
    setOpenPickerSelect(null);
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
      setOpenPickerSelect(null);
    } catch {
      if (pickerOpen) {
        setPickerError('Could not save this holding. Nothing was changed; please try again.');
      } else {
        setSaveError('Could not save this holding. Nothing was changed; please try again.');
      }
    } finally {
      pickerPendingRef.current = false;
      setPendingGradeKey(null);
    }
  }

  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>YOUR HOLDINGS</Text>
          <Text style={styles.title}>Your collection</Text>
        </View>
        <Text style={styles.totalLabel}>
          {slabQuantity} {slabQuantity === 1 ? 'slab' : 'slabs'} · tracked
        </Text>
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
      ) : (
        <>
          {(collectionError || saveError) && (
            <View style={styles.warningRow} accessibilityRole="alert">
              <Feather name="alert-circle" size={13} color={C.warning} />
              <Text style={styles.warningText}>{saveError ?? collectionError?.message}</Text>
            </View>
          )}

          <View style={styles.rawRow}>
            <View style={styles.rawMark}>
              <Text style={styles.rawMarkText}>RAW</Text>
            </View>
            <View style={styles.rawCopy}>
              <Text style={styles.rawTitle}>Ungraded</Text>
              <Text style={styles.rawMeta}>{card.isHolo ? 'Holofoil' : card.isFoil ? 'Foil' : 'Raw'}</Text>
            </View>
            <View style={styles.quantityControls}>
              <Pressable
                onPress={() => rawHolding && void changeQuantity(rawHolding, -1)}
                disabled={!rawHolding || pendingIds.has(rawHolding.id)}
                style={[styles.quantityButton, (!rawHolding || pendingIds.has(rawHolding.id)) && styles.disabledButton]}
                accessibilityRole="button"
                accessibilityLabel="Decrease raw quantity"
              >
                <Feather name="minus" size={14} color={C.primary} />
              </Pressable>
              <Text style={styles.quantityText}>
                {rawHolding && pendingIds.has(rawHolding.id) ? '…' : rawHolding?.quantity ?? 0}
              </Text>
              <Pressable
                onPress={() => {
                  if (rawHolding) void changeQuantity(rawHolding, 1);
                  else if (rawOption) void chooseGrade(rawOption);
                }}
                disabled={pendingGradeKey === rawOption?.identityKey || (rawHolding ? pendingIds.has(rawHolding.id) : false)}
                style={[
                  styles.quantityButton,
                  (pendingGradeKey === rawOption?.identityKey || (rawHolding ? pendingIds.has(rawHolding.id) : false))
                    && styles.disabledButton,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Increase raw quantity"
              >
                <Feather name="plus" size={14} color={C.primary} />
              </Pressable>
            </View>
            <Text style={styles.rawValue}>
              {rawHolding && getItemCurrentValue(rawHolding) != null
                ? formatMoney(
                    getItemCurrentValue(rawHolding)! * rawHolding.quantity,
                    rawHolding.valuation?.currency ?? totalCurrency,
                  )
                : '—'}
            </Text>
          </View>

          <View style={styles.slabsCard}>
            <View style={styles.slabsHeader}>
              <View>
                <Text style={styles.slabsKicker}>GRADED COPIES</Text>
                <Text style={styles.slabsTitle}>Your slabs</Text>
              </View>
              <Text style={styles.slabsOwned}>{slabQuantity} owned</Text>
            </View>

            <View style={styles.slabsColumnLabels}>
              <Text style={styles.slabsColumnGrade}>GRADE · POPULATION</Text>
              <Text style={styles.slabsColumnOwned}>OWNED</Text>
              <Text style={styles.slabsColumnValue}>VALUE</Text>
            </View>

            {gradedHoldings.length > 0 ? gradedHoldings.map(item => {
              const unitValue = getItemCurrentValue(item);
              const busy = pendingIds.has(item.id);
              const isConfirming = removeConfirmationId === item.id;
              const label = formatCollectionHoldingLabel(item);
              return (
                <View key={item.id} style={styles.slabRow}>
                  <View style={styles.slabMark}>
                    <Text style={styles.slabMarkText}>{item.grading?.company ?? 'SLAB'}</Text>
                  </View>
                  <View style={styles.slabCopy}>
                    <Text style={styles.slabTitle} numberOfLines={1}>{label}</Text>
                    <Text style={styles.slabMeta} numberOfLines={1} ellipsizeMode="tail">
                      {item.grading?.population != null
                        ? `Pop. ${item.grading.population.toLocaleString('en-AU')} · exact match`
                        : 'Population unavailable · exact grade'}
                    </Text>
                  </View>
                  <View style={styles.quantityControls}>
                    <Pressable
                      onPress={() => void changeQuantity(item, -1)}
                      disabled={busy || isConfirming}
                      style={[styles.quantityButton, (busy || isConfirming) && styles.disabledButton]}
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease ${label} quantity`}
                    >
                      <Feather name="minus" size={14} color={C.primary} />
                    </Pressable>
                    <Text style={styles.quantityText}>{busy ? '…' : item.quantity}</Text>
                    <Pressable
                      onPress={() => void changeQuantity(item, 1)}
                      disabled={busy || isConfirming}
                      style={[styles.quantityButton, (busy || isConfirming) && styles.disabledButton]}
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${label} quantity`}
                    >
                      <Feather name="plus" size={14} color={C.primary} />
                    </Pressable>
                  </View>
                  <Text style={[styles.slabValue, unitValue == null && styles.slabValueUnavailable]}>
                    {unitValue != null
                      ? formatMoney(unitValue * item.quantity, item.valuation?.currency ?? totalCurrency)
                      : '—'}
                  </Text>
                </View>
              );
            }) : (
              <View style={styles.slabsEmpty}>
                <Text style={styles.slabsEmptyText}>No graded copies tracked yet</Text>
              </View>
            )}

            <View style={styles.slabsFooter}>
              <Text style={styles.slabsFooterLabel}>Combined holding value</Text>
              <Text style={styles.slabsFooterValue}>
                {gradedTotalValue != null ? formatMoney(gradedTotalValue, totalCurrency) : '—'}
              </Text>
            </View>
          </View>

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
          <Feather name="plus" size={16} color={C.foreground} />
          <Text style={styles.chooseText}>Choose another grade</Text>
          <Feather name="arrow-right" size={16} color={C.foreground} />
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
              Select the grading company and exact grade for the slab you own.
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
                <View style={styles.pickerFields}>
                  <View style={[styles.pickerField, { zIndex: 4 }]}>
                    <Text style={styles.pickerFieldLabel}>Grading company</Text>
                    <Pressable
                      onPress={() => setOpenPickerSelect(current => current === 'company' ? null : 'company')}
                      style={styles.pickerSelect}
                      accessibilityRole="button"
                      accessibilityLabel={`Grading company, ${pickerCompany}`}
                      accessibilityState={{ expanded: openPickerSelect === 'company' }}
                    >
                      <Text style={styles.pickerSelectText}>{pickerCompany}</Text>
                      <Feather name="chevron-down" size={16} color={C.foreground} />
                    </Pressable>
                    {openPickerSelect === 'company' && (
                      <View style={styles.pickerDropdown}>
                        {pickerCompanies.map(company => (
                          <Pressable
                            key={company}
                            onPress={() => {
                              const options = gradedOptions.filter(option => option.company === company);
                              setPickerCompany(company);
                              setPickerGradeIdentity(options[options.length - 1]?.identityKey ?? '');
                              setOpenPickerSelect(null);
                            }}
                            style={[styles.pickerDropdownOption, company === pickerCompany && styles.pickerDropdownOptionActive]}
                          >
                            <Text style={styles.pickerDropdownText}>{company}</Text>
                            {company === pickerCompany && <Feather name="check" size={14} color={C.primary} />}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  <View style={[styles.pickerField, { zIndex: 3 }]}>
                    <Text style={styles.pickerFieldLabel}>Grade</Text>
                    <Pressable
                      onPress={() => setOpenPickerSelect(current => current === 'grade' ? null : 'grade')}
                      style={styles.pickerSelect}
                      accessibilityRole="button"
                      accessibilityLabel={`Grade, ${selectedPickerGrade?.label ?? 'not selected'}`}
                      accessibilityState={{ expanded: openPickerSelect === 'grade' }}
                    >
                      <Text style={styles.pickerSelectText} numberOfLines={1}>
                        {selectedPickerGrade?.label ?? 'Select grade'}
                      </Text>
                      <Feather name="chevron-down" size={16} color={C.foreground} />
                    </Pressable>
                    {openPickerSelect === 'grade' && (
                      <View style={styles.pickerDropdown}>
                        {companyGradeOptions.map(option => (
                          <Pressable
                            key={option.identityKey}
                            onPress={() => {
                              setPickerGradeIdentity(option.identityKey);
                              setOpenPickerSelect(null);
                            }}
                            style={[
                              styles.pickerDropdownOption,
                              option.identityKey === selectedPickerGrade?.identityKey && styles.pickerDropdownOptionActive,
                            ]}
                          >
                            <Text style={styles.pickerDropdownText}>{option.label}</Text>
                            {option.identityKey === selectedPickerGrade?.identityKey
                              && <Feather name="check" size={14} color={C.primary} />}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                {selectedPickerGrade && (() => {
                  const existing = findMatchingCollectionHolding(
                    holdings,
                    card.id,
                    selectedPickerGrade.identityKey,
                  );
                  const quote = existing?.valuation?.price ?? exactQuote(pricing, selectedPickerGrade.gradeKey);
                  const quoteCurrency = existing?.valuation?.currency
                    ?? pricing?.conversion?.displayCurrency
                    ?? totalCurrency;
                  return (
                    <View style={styles.pickerSelectionSummary}>
                      <View>
                        <Text style={styles.pickerSelectionLabel}>{selectedPickerGrade.label}</Text>
                        <Text style={styles.pickerSelectionMeta}>
                          {existing ? `${existing.quantity} already tracked` : 'New graded holding'}
                        </Text>
                      </View>
                      <Text style={[styles.pickerSelectionPrice, quote == null && styles.optionUnavailable]}>
                        {quote != null ? formatMoney(quote, quoteCurrency) : 'Price unavailable'}
                      </Text>
                    </View>
                  );
                })()}

                <Pressable
                  onPress={() => selectedPickerGrade && void chooseGrade(selectedPickerGrade)}
                  disabled={!selectedPickerGrade || pendingGradeKey != null}
                  style={[
                    styles.addGradeButton,
                    (!selectedPickerGrade || pendingGradeKey != null) && styles.disabledButton,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${selectedPickerGrade?.label ?? 'selected grade'} to holdings`}
                >
                  {pendingGradeKey ? (
                    <ActivityIndicator size="small" color={C.primaryForeground} />
                  ) : (
                    <Feather name="plus" size={16} color={C.primaryForeground} />
                  )}
                  <Text style={styles.addGradeButtonText}>
                    {pendingGradeKey ? 'Adding grade…' : 'Add grade'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={removeCandidate != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRemoveConfirmationId(null)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmSheet}>
            <View style={styles.confirmIcon}>
              <Feather name="trash-2" size={17} color={C.primary} />
            </View>
            <Text style={styles.confirmTitle}>Remove final copy?</Text>
            <Text style={styles.confirmDescription}>
              This will remove {removeCandidate ? formatCollectionHoldingLabel(removeCandidate) : 'this holding'} from your collection.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setRemoveConfirmationId(null)}
                style={styles.confirmKeepButton}
                accessibilityRole="button"
                accessibilityLabel="Keep copy"
              >
                <Text style={styles.confirmKeepText}>Keep copy</Text>
              </Pressable>
              <Pressable
                onPress={() => removeCandidate && void confirmRemove(removeCandidate)}
                disabled={removeCandidate ? pendingIds.has(removeCandidate.id) : true}
                style={[styles.confirmRemoveButton, removeCandidate && pendingIds.has(removeCandidate.id) && styles.disabledButton]}
                accessibilityRole="button"
                accessibilityLabel="Remove copy"
              >
                {removeCandidate && pendingIds.has(removeCandidate.id) ? (
                  <ActivityIndicator size="small" color={C.primaryForeground} />
                ) : (
                  <Text style={styles.confirmRemoveText}>Remove</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 18,
    padding: 26,
    gap: 16,
  },
  panelCompact: { marginBottom: 0, gap: 13 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  kicker: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.mutedForeground, letterSpacing: 1.2 },
  title: { fontSize: 19, lineHeight: 24, fontFamily: 'Inter_700Bold', color: C.foreground, marginTop: 8 },
  totalLabel: { fontSize: 11, lineHeight: 15, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 18 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  emptyState: { alignItems: 'center', gap: 7, paddingVertical: 18 },
  emptyTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  emptyText: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', maxWidth: 290 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 4 },
  retryText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primaryForeground },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: `${C.warning}14`, borderRadius: 9, padding: 9 },
  warningText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', color: C.warning },
  rawRow: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingTop: 16,
  },
  rawMark: {
    width: 57,
    height: 39,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.muted,
  },
  rawMarkText: { color: C.foreground, fontSize: 11, fontFamily: 'Inter_700Bold' },
  rawCopy: { flex: 1, minWidth: 74 },
  rawTitle: { color: C.foreground, fontSize: 13, fontFamily: 'Inter_700Bold' },
  rawMeta: { color: C.mutedForeground, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 4 },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  quantityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  disabledButton: { opacity: 0.45 },
  quantityText: { minWidth: 22, textAlign: 'center', fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  rawValue: { minWidth: 55, color: C.foreground, fontSize: 14, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  slabsCard: {
    borderWidth: 1,
    borderColor: `${C.primary}55`,
    borderRadius: 12,
    backgroundColor: `${C.primary}05`,
    padding: 16,
  },
  slabsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  slabsKicker: {
    color: C.mutedForeground,
    fontSize: 9,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 1.2,
  },
  slabsTitle: {
    marginTop: 8,
    color: C.foreground,
    fontSize: 20,
    lineHeight: 25,
    fontFamily: 'Rajdhani_700Bold',
  },
  slabsOwned: { color: C.primary, fontSize: 11, fontFamily: 'Inter_700Bold' },
  slabsColumnLabels: {
    minHeight: 46,
    paddingLeft: 68,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  slabsColumnGrade: {
    flex: 1,
    color: `${C.mutedForeground}AA`,
    fontSize: 8,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.7,
  },
  slabsColumnOwned: {
    width: 82,
    color: `${C.mutedForeground}AA`,
    fontSize: 8,
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.7,
  },
  slabsColumnValue: {
    width: 86,
    color: `${C.mutedForeground}AA`,
    fontSize: 8,
    textAlign: 'right',
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.7,
  },
  slabRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  slabMark: {
    width: 58,
    height: 37,
    borderRadius: 7,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slabMarkText: {
    color: C.primaryForeground,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  slabCopy: { flex: 1, minWidth: 0 },
  slabTitle: { color: C.foreground, fontSize: 12, fontFamily: 'Inter_700Bold' },
  slabMeta: {
    marginTop: 3,
    color: C.mutedForeground,
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
  },
  slabValue: {
    width: 86,
    color: C.primary,
    fontSize: 15,
    fontFamily: 'Rajdhani_700Bold',
    textAlign: 'right',
  },
  slabValueUnavailable: { color: C.mutedForeground },
  slabsEmpty: {
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  slabsEmptyText: { color: C.mutedForeground, fontSize: 11, fontFamily: 'Inter_400Regular' },
  slabsFooter: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slabsFooterLabel: { color: C.mutedForeground, fontSize: 10, fontFamily: 'Inter_400Regular' },
  slabsFooterValue: { color: C.primary, fontSize: 18, fontFamily: 'Rajdhani_700Bold' },
  disclaimer: { fontSize: 10, lineHeight: 15, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  chooseButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: -2,
  },
  chooseText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  picker: {
    maxHeight: '86%',
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    padding: 22,
    paddingBottom: 30,
    gap: 14,
  },
  pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  pickerKicker: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary, letterSpacing: 1.2 },
  pickerTitle: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  pickerDescription: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  pickerFields: { gap: 12 },
  pickerField: { position: 'relative' },
  pickerFieldLabel: {
    marginBottom: 7,
    color: C.mutedForeground,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  pickerSelect: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pickerSelectText: { flex: 1, color: C.foreground, fontSize: 14, fontFamily: 'Inter_700Bold' },
  pickerDropdown: {
    position: 'absolute',
    top: 76,
    left: 0,
    right: 0,
    maxHeight: 220,
    padding: 5,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.surfaceRaised,
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  pickerDropdownOption: {
    minHeight: 42,
    paddingHorizontal: 11,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerDropdownOptionActive: { backgroundColor: `${C.primary}14` },
  pickerDropdownText: { color: C.foreground, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  pickerSelectionSummary: {
    minHeight: 62,
    paddingHorizontal: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: `${C.primary}05`,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pickerSelectionLabel: { color: C.foreground, fontSize: 13, fontFamily: 'Inter_700Bold' },
  pickerSelectionMeta: { marginTop: 3, color: C.mutedForeground, fontSize: 10, fontFamily: 'Inter_400Regular' },
  pickerSelectionPrice: { color: C.primary, fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  optionUnavailable: { color: C.mutedForeground },
  addGradeButton: {
    minHeight: 50,
    borderRadius: 11,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addGradeButtonText: { color: C.primaryForeground, fontSize: 14, fontFamily: 'Inter_700Bold' },
  confirmBackdrop: {
    flex: 1,
    padding: 22,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmSheet: {
    width: '100%',
    maxWidth: 360,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    backgroundColor: C.card,
    gap: 10,
  },
  confirmIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${C.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmTitle: { color: C.foreground, fontSize: 18, fontFamily: 'Inter_700Bold' },
  confirmDescription: { color: C.mutedForeground, fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  confirmKeepButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmKeepText: { color: C.foreground, fontSize: 12, fontFamily: 'Inter_700Bold' },
  confirmRemoveButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRemoveText: { color: C.primaryForeground, fontSize: 12, fontFamily: 'Inter_700Bold' },
});