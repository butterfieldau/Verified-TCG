import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { catalogCardToAppCard, MIN_CATALOG_SEARCH_LENGTH, searchCatalog } from '@/services/catalogApi';
import colors from '@/constants/colors';
import type { Card, CollectionItem, GradingCompany, CardCondition } from '@/types';

const C = colors.dark;

type Step = 'search' | 'details';
type CardType = 'raw' | 'graded';

const GRADERS: { label: string; value: GradingCompany }[] = [
  { label: 'PSA', value: 'PSA' },
  { label: 'BGS', value: 'BGS' },
  { label: 'CGC', value: 'CGC' },
];

const CONDITIONS: { label: string; value: CardCondition }[] = [
  { label: 'Mint', value: 'mint' },
  { label: 'Near Mint', value: 'near_mint' },
  { label: 'Excellent', value: 'excellent' },
  { label: 'Good', value: 'good' },
  { label: 'Played', value: 'played' },
];

const GRADES = [10, 9.5, 9, 8.5, 8, 7];

export default function AddCardScreen() {
  const insets = useSafeAreaInsets();
  const { editId, cardJson } = useLocalSearchParams<{ editId?: string; cardJson?: string }>();
  const { addToCollection, collection, updateCollectionHolding } = useApp();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [cardType, setCardType] = useState<CardType>('raw');
  const [condition, setCondition] = useState<CardCondition>('near_mint');
  const [grader, setGrader] = useState<GradingCompany>('PSA');
  const [grade, setGrade] = useState(10);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseCurrency, setPurchaseCurrency] = useState('AUD');
  const [acquisitionDate, setAcquisitionDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const [quantity, setQuantity] = useState('1');
  const [certNumber, setCertNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [success, setSuccess] = useState(false);
  const [results, setResults] = useState<Card[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const editingItem = editId ? collection.find(item => item.id === editId) : undefined;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  useEffect(() => {
    if (!editingItem) return;
    setSelectedCard(editingItem.card);
    setCardType(editingItem.grading ? 'graded' : 'raw');
    setCondition(editingItem.condition);
    setGrader(editingItem.grading?.company ?? 'PSA');
    setGrade(Number(editingItem.grading?.grade ?? 10));
    setCertNumber(editingItem.grading?.certNumber ?? '');
    setPurchasePrice(String(editingItem.acquiredPrice));
    setPurchaseCurrency(editingItem.currency);
    setAcquisitionDate(editingItem.acquiredAt);
    setQuantity(String(editingItem.quantity));
    setNotes(editingItem.notes ?? '');
    setStep('details');
  }, [editingItem]);

  useEffect(() => {
    if (editingItem || !cardJson) return;
    try {
      const card = JSON.parse(cardJson) as Card;
      if (!card?.id || !card?.name) throw new Error('Invalid card');
      setSelectedCard(card);
      setStep('details');
    } catch {
      setSearchError('This card could not be prepared for adding. Please search for it again.');
      setStep('search');
    }
  }, [cardJson, editingItem]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_CATALOG_SEARCH_LENGTH) {
      setResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    setResults([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalog(trimmed)
        .then(response => { if (!cancelled) setResults(response.data.map(catalogCardToAppCard)); })
        .catch(() => { if (!cancelled) setSearchError('Card search is unavailable. Please try again.'); })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  function selectCard(card: Card) {
    setSelectedCard(card);
    setSearchError(null);
    setStep('details');
  }

  async function handleAdd() {
    if (!selectedCard) return;
    const parsedPrice = Number(purchasePrice);
    const parsedQuantity = Number(quantity);
    const currency = purchaseCurrency.trim().toUpperCase();
    const parsedDate = new Date(`${acquisitionDate}T00:00:00.000Z`);
    const isValidDate =
      /^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate) &&
      !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.toISOString().slice(0, 10) === acquisitionDate;
    if (!purchasePrice.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedQuantity) || parsedQuantity < 1 || !/^[A-Z]{3}$/.test(currency) || !isValidDate) {
      setSearchError('Enter a valid unit price, 3-letter currency, quantity, and acquisition date.');
      return;
    }
    const item: CollectionItem = {
      id: `col-add-${Date.now()}`,
      cardId: selectedCard.id,
      card: selectedCard,
      quantity: parsedQuantity,
      condition,
      acquiredAt: acquisitionDate,
      // Purchase price is consistently stored as a per-card cost. The API and
      // portfolio multiply it by quantity for known cost basis.
      acquiredPrice: parsedPrice,
      currency,
      notes: notes || undefined,
      grading: cardType === 'graded' ? {
        company: grader,
        grade,
        certNumber,
        gradedAt: new Date().toISOString().split('T')[0],
      } : undefined,
    };
    try {
      if (editingItem) {
        await updateCollectionHolding(editingItem.id, {
          quantity: item.quantity,
          condition: item.condition,
          grading: item.grading,
          acquiredAt: item.acquiredAt,
          acquiredPrice: item.acquiredPrice,
          currency: item.currency,
          notes: item.notes,
        });
      } else {
        await addToCollection(item);
      }
      setSuccess(true);
      setTimeout(() => router.back(), 1600);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not save this card. Please try again.');
    }
  }

  if (success) {
    return (
      <View style={[styles.screen, styles.successScreen]}>
        <View style={styles.successIcon}>
          <Feather name="check-circle" size={64} color={C.positive} />
        </View>
        <Text style={styles.successTitle}>{editingItem ? 'Card Updated!' : 'Card Added!'}</Text>
        <Text style={styles.successSub}>
          {selectedCard?.name} {editingItem ? 'updated in' : 'added to'} your collection
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 'search' ? router.back() : setStep('search'))}
          style={styles.closeBtn}
        >
          <Feather name={step === 'search' ? 'x' : 'arrow-left'} size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>{editingItem ? 'Edit Card' : step === 'search' ? 'Add Card' : 'Card Details'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        {(['search', 'details'] as Step[]).map((s, i) => (
          <React.Fragment key={s}>
            <View style={styles.stepItem}>
              <View style={[
                styles.stepDot,
                step === s
                  ? { backgroundColor: C.primary }
                  : (i === 0 && step === 'details')
                    ? { backgroundColor: C.positive }
                    : { backgroundColor: C.border },
              ]}>
                {i === 0 && step === 'details'
                  ? <Feather name="check" size={12} color="#FFFFFF" />
                  : <Text style={styles.stepNum}>{i + 1}</Text>
                }
              </View>
              <Text style={[
                styles.stepLabel,
                step === s ? { color: C.foreground } : { color: C.mutedForeground },
              ]}>
                {s === 'search' ? 'Search' : 'Details'}
              </Text>
            </View>
            {i === 0 && <View style={styles.stepLine} />}
          </React.Fragment>
        ))}
      </View>

      {/* Search step */}
      {step === 'search' && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.searchBar}>
            <Feather name="search" size={16} color={C.mutedForeground} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search card name or set..."
              placeholderTextColor={C.mutedForeground}
              value={query}
              onChangeText={setQuery}
              autoFocus
              selectionColor={C.primary}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')}>
                <Feather name="x" size={15} color={C.mutedForeground} />
              </Pressable>
            )}
          </View>

          <Text style={styles.sectionLabel}>
            {query.trim().length >= MIN_CATALOG_SEARCH_LENGTH ? `Results (${results.length})` : 'Search the catalogue'}
          </Text>

          {searchLoading && <Text style={styles.searchStatus}>Searching cards…</Text>}
          {!searchLoading && query.trim().length < MIN_CATALOG_SEARCH_LENGTH && (
            <Text style={styles.searchStatus}>Enter at least {MIN_CATALOG_SEARCH_LENGTH} characters to search real catalogue cards.</Text>
          )}
          {!searchLoading && searchError && <Text style={styles.searchStatus}>{searchError}</Text>}
          {!searchLoading && !searchError && query.trim().length >= MIN_CATALOG_SEARCH_LENGTH && results.length === 0 && (
            <Text style={styles.searchStatus}>No catalogue cards found.</Text>
          )}

          {results.map(card => (
            <Pressable
              key={card.id}
              onPress={() => selectCard(card)}
              style={[styles.cardRow, { backgroundColor: C.card }]}
            >
              <View style={[styles.cardThumb, { backgroundColor: card.gradientStart }]}>
                <Text style={styles.cardInitial}>{card.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{card.name}</Text>
                <Text style={styles.cardSet}>{card.setName} · {card.number}</Text>
                <Text style={styles.cardRarity}>{card.rarity.replace(/_/g, ' ')}</Text>
              </View>
              <View style={styles.cardPricing}>
                <Text style={styles.cardPrice}>${card.price.raw.toLocaleString()}</Text>
                <Text style={styles.cardPriceLabel}>Raw</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.mutedForeground} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Details step */}
      {step === 'details' && selectedCard && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {searchError && <Text style={[styles.searchStatus, { color: C.negative }]}>{searchError}</Text>}
          {/* Selected card preview */}
          <View style={[styles.selectedCard, { backgroundColor: C.card }]}>
            <View style={[styles.selectedThumb, { backgroundColor: selectedCard.gradientStart }]}>
              <Text style={styles.selectedInitial}>{selectedCard.name[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName}>{selectedCard.name}</Text>
              <Text style={styles.selectedSet}>{selectedCard.setName} · {selectedCard.number}</Text>
            </View>
            {!editingItem && (
              <Pressable onPress={() => setStep('search')}>
                <Text style={[styles.changeLink, { color: C.primary }]}>Change</Text>
              </Pressable>
            )}
          </View>

          {/* Card type toggle */}
          <Text style={styles.fieldLabel}>Card Type</Text>
          <View style={styles.toggleRow}>
            {(['raw', 'graded'] as CardType[]).map(t => (
              <Pressable
                key={t}
                onPress={() => setCardType(t)}
                style={[
                  styles.toggleBtn,
                  cardType === t && { backgroundColor: C.primary, borderColor: C.primary },
                ]}
              >
                <Text style={[styles.toggleText, cardType === t && { color: '#FFFFFF' }]}>
                  {t === 'raw' ? 'Raw / Ungraded' : 'Graded'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Raw — condition */}
          {cardType === 'raw' && (
            <View>
              <Text style={styles.fieldLabel}>Condition</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {CONDITIONS.map(c => (
                    <Pressable
                      key={c.value}
                      onPress={() => setCondition(c.value)}
                      style={[
                        styles.chip,
                        condition === c.value && { backgroundColor: C.primary, borderColor: C.primary },
                      ]}
                    >
                      <Text style={[styles.chipText, condition === c.value && { color: '#FFFFFF' }]}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Graded — company + grade + cert */}
          {cardType === 'graded' && (
            <View>
              <Text style={styles.fieldLabel}>Grading Company</Text>
              <View style={styles.toggleRow}>
                {GRADERS.map(g => (
                  <Pressable
                    key={g.value}
                    onPress={() => setGrader(g.value)}
                    style={[
                      styles.toggleBtn,
                      grader === g.value && { backgroundColor: C.primary, borderColor: C.primary },
                    ]}
                  >
                    <Text style={[styles.toggleText, grader === g.value && { color: '#FFFFFF' }]}>
                      {g.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Grade</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {GRADES.map(g => (
                    <Pressable
                      key={g}
                      onPress={() => setGrade(g)}
                      style={[
                        styles.chip,
                        grade === g && { backgroundColor: C.primary, borderColor: C.primary },
                      ]}
                    >
                      <Text style={[styles.chipText, grade === g && { color: '#FFFFFF' }]}>{g}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.fieldLabel}>Cert Number (optional)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. 88245612"
                placeholderTextColor={C.mutedForeground}
                value={certNumber}
                onChangeText={setCertNumber}
                selectionColor={C.primary}
              />
            </View>
          )}

          {/* Acquisition details — price is a unit price, not total lot cost. */}
          <Text style={styles.fieldLabel}>Purchase Price per Card</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. 100.00"
            placeholderTextColor={C.mutedForeground}
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            keyboardType="decimal-pad"
            selectionColor={C.primary}
          />

          <Text style={styles.fieldLabel}>Acquisition Currency</Text>
          <TextInput
            style={styles.textInput}
            placeholder="AUD"
            placeholderTextColor={C.mutedForeground}
            value={purchaseCurrency}
            onChangeText={value => setPurchaseCurrency(value.toUpperCase())}
            autoCapitalize="characters"
            maxLength={3}
            selectionColor={C.primary}
          />

          <Text style={styles.fieldLabel}>Acquisition Date</Text>
          <TextInput
            style={styles.textInput}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.mutedForeground}
            value={acquisitionDate}
            onChangeText={setAcquisitionDate}
            selectionColor={C.primary}
          />

          <Text style={styles.fieldLabel}>Quantity</Text>
          <TextInput
            style={styles.textInput}
            placeholder="1"
            placeholderTextColor={C.mutedForeground}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            selectionColor={C.primary}
          />

          {/* Notes */}
          <Text style={styles.fieldLabel}>Notes (optional)</Text>
          <TextInput
            style={[styles.textInput, styles.textInputMulti]}
            placeholder="Condition notes, provenance, etc."
            placeholderTextColor={C.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            selectionColor={C.primary}
          />

          {/* Add button */}
          <Pressable onPress={handleAdd} style={styles.addBtn}>
            <Feather name="plus" size={18} color="#FFFFFF" />
            <Text style={styles.addBtnText}>{editingItem ? 'Save Changes' : 'Add to Collection'}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  successScreen: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  successIcon: { marginBottom: 8 },
  successTitle: { fontSize: 26, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  successSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  stepLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  stepLine: { flex: 1, height: 1, backgroundColor: C.border, marginHorizontal: 10 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.foreground,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  searchStatus: {
    color: C.mutedForeground,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingVertical: 20,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  cardThumb: {
    width: 48,
    height: 68,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  cardRarity: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}88`,
    textTransform: 'capitalize',
  },
  cardPricing: { alignItems: 'flex-end' },
  cardPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  cardPriceLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 22,
  },
  selectedThumb: {
    width: 48,
    height: 68,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  selectedName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  selectedSet: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 2,
  },
  changeLink: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  fieldLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 18,
  },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
  },
  toggleText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.foreground },
  textInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.foreground,
    borderWidth: 1,
    borderColor: C.border,
  },
  textInputMulti: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 14,
    backgroundColor: C.primary,
    marginTop: 28,
  },
  addBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
