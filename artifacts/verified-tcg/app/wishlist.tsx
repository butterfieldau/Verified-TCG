/**
 * Wishlist screen — lets collectors search for cards and add them with a
 * desired grade and optional target price. Changes propagate to Trade Match
 * and Event Mode via AppContext.
 */
import React, { useState, useMemo } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { MOCK_CARDS } from '@/services/cards';
import colors from '@/constants/colors';
import type { WatchlistItem, Card } from '@/types';

const C = colors.dark;

const GRADE_OPTIONS = [
  'Raw', 'PSA 8', 'PSA 9', 'PSA 10', 'BGS 9', 'BGS 9.5', 'CGC 9', 'CGC 10',
];

// ── Add-card panel ────────────────────────────────────────────────────────────

function AddPanel({
  onClose,
  onAdd,
  existingCardIds,
}: {
  onClose: () => void;
  onAdd: (item: WatchlistItem) => void;
  existingCardIds: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [grade, setGrade] = useState<string>('Raw');
  const [targetPriceText, setTargetPriceText] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOCK_CARDS;
    return MOCK_CARDS.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.setName.toLowerCase().includes(q) ||
        c.tcg.toLowerCase().includes(q),
    );
  }, [query]);

  function handleConfirm() {
    if (!selectedCard) return;
    const targetPrice = parseFloat(targetPriceText);
    const item: WatchlistItem = {
      id: `wl-${Date.now()}`,
      cardId: selectedCard.id,
      card: selectedCard,
      desiredGrade: grade,
      targetPrice: isNaN(targetPrice) || targetPrice <= 0 ? undefined : targetPrice,
      addedAt: new Date().toISOString().split('T')[0],
      priceAlertEnabled: false,
    };
    onAdd(item);
    onClose();
  }

  // ── Grade / price form ───────────────────────────────────────────────────
  if (selectedCard) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.panelOverlay}
      >
        <Pressable style={styles.panelBackdrop} onPress={() => setSelectedCard(null)} />
        <View style={[styles.panel, { backgroundColor: C.card }]}>
          <View style={styles.panelHandle} />
          <Text style={styles.panelTitle}>Add to Wishlist</Text>

          {/* Card preview */}
          <View style={styles.selectedCardRow}>
            <View style={[styles.selectedThumb, { backgroundColor: selectedCard.gradientStart }]}>
              <Text style={styles.selectedInitial}>{selectedCard.name[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName} numberOfLines={1}>{selectedCard.name}</Text>
              <Text style={styles.selectedSet}>{selectedCard.setName} · {selectedCard.tcg.toUpperCase()}</Text>
              <Text style={styles.selectedPrice}>
                Market: ${selectedCard.price.raw.toLocaleString('en-AU')} AUD
              </Text>
            </View>
            <Pressable onPress={() => setSelectedCard(null)} hitSlop={8}>
              <Feather name="x" size={18} color={C.mutedForeground} />
            </Pressable>
          </View>

          {/* Grade picker */}
          <Text style={styles.formLabel}>Desired Grade</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gradeChipsRow}>
            {GRADE_OPTIONS.map(g => (
              <Pressable
                key={g}
                onPress={() => setGrade(g)}
                style={[
                  styles.gradeChip,
                  grade === g
                    ? { backgroundColor: C.primary }
                    : { backgroundColor: C.muted },
                ]}
              >
                <Text style={[
                  styles.gradeChipText,
                  grade === g ? { color: '#FFF' } : { color: C.mutedForeground },
                ]}>
                  {g}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Target price */}
          <Text style={styles.formLabel}>Target Price <Text style={styles.optionalLabel}>(optional)</Text></Text>
          <View style={[styles.priceInputRow, { backgroundColor: C.muted }]}>
            <Text style={styles.currencyPrefix}>$</Text>
            <TextInput
              style={styles.priceInput}
              value={targetPriceText}
              onChangeText={setTargetPriceText}
              placeholder="e.g. 450"
              placeholderTextColor={C.mutedForeground}
              keyboardType="decimal-pad"
              returnKeyType="done"
            />
            <Text style={styles.currencySuffix}>AUD</Text>
          </View>

          {/* Actions */}
          <View style={styles.panelActions}>
            <Pressable
              onPress={() => setSelectedCard(null)}
              style={[styles.panelSecondaryBtn, { backgroundColor: C.muted }]}
            >
              <Text style={[styles.panelSecondaryBtnText, { color: C.foreground }]}>Back</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              style={[styles.panelPrimaryBtn, { backgroundColor: C.primary }]}
            >
              <Feather name="heart" size={15} color="#FFF" />
              <Text style={styles.panelPrimaryBtnText}>Add to Wishlist</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Card search list ─────────────────────────────────────────────────────
  return (
    <View style={styles.panelOverlay}>
      <Pressable style={styles.panelBackdrop} onPress={onClose} />
      <View style={[styles.panel, styles.panelTall, { backgroundColor: C.card }]}>
        <View style={styles.panelHandle} />
        <Text style={styles.panelTitle}>Search Cards</Text>

        <View style={[styles.searchBox, { backgroundColor: C.muted }]}>
          <Feather name="search" size={16} color={C.mutedForeground} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Card name, set or game…"
            placeholderTextColor={C.mutedForeground}
            autoFocus
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x" size={14} color={C.mutedForeground} />
            </Pressable>
          )}
        </View>

        <ScrollView
          style={styles.searchResults}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {filtered.map(card => {
            const already = existingCardIds.has(card.id);
            return (
              <Pressable
                key={card.id}
                onPress={() => !already && setSelectedCard(card)}
                style={({ pressed }) => [
                  styles.searchResultRow,
                  { backgroundColor: pressed && !already ? C.muted : 'transparent' },
                  already && { opacity: 0.45 },
                ]}
              >
                <View style={[styles.resultThumb, { backgroundColor: card.gradientStart }]}>
                  <Text style={styles.resultInitial}>{card.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName} numberOfLines={1}>{card.name}</Text>
                  <Text style={styles.resultMeta}>{card.setName} · {card.tcg.toUpperCase()}</Text>
                </View>
                <View style={styles.resultRight}>
                  <Text style={styles.resultPrice}>${card.price.raw.toLocaleString('en-AU')}</Text>
                  {already && (
                    <View style={[styles.alreadyBadge, { backgroundColor: `${C.positive}22` }]}>
                      <Feather name="check" size={9} color={C.positive} />
                      <Text style={[styles.alreadyText, { color: C.positive }]}>Added</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// ── Wishlist entry card ───────────────────────────────────────────────────────

function WishCard({
  item,
  onRemove,
}: {
  item: WatchlistItem;
  onRemove: () => void;
}) {
  const price = item.card.price.raw;
  const change = item.card.price.change7d ?? 0;
  const isUp = change >= 0;
  const atTarget = item.targetPrice ? price <= item.targetPrice : false;

  return (
    <Pressable
      onPress={() => router.push(`/card/${item.card.id}` as any)}
      style={({ pressed }) => [
        styles.wishCard,
        { backgroundColor: pressed ? C.muted : C.card },
      ]}
    >
      {/* Thumb */}
      <View style={[styles.thumb, { backgroundColor: item.card.gradientStart }]}>
        <Text style={styles.thumbInitial}>{item.card.name[0]}</Text>
      </View>

      {/* Info */}
      <View style={styles.wishInfo}>
        <Text style={styles.wishName} numberOfLines={1}>{item.card.name}</Text>
        <Text style={styles.wishSet} numberOfLines={1}>{item.card.setName}</Text>

        {item.desiredGrade && (
          <View style={styles.gradeRow}>
            <Feather name="award" size={11} color={C.primary} />
            <Text style={styles.gradeText}>{item.desiredGrade}</Text>
          </View>
        )}

        {item.targetPrice && (
          <View style={styles.targetRow}>
            <Feather
              name="target"
              size={11}
              color={atTarget ? C.positive : C.mutedForeground}
            />
            <Text style={[styles.targetText, atTarget && { color: C.positive }]}>
              Target: ${item.targetPrice.toLocaleString('en-AU')}
            </Text>
            {atTarget && (
              <View style={[styles.targetMetBadge, { backgroundColor: `${C.positive}22` }]}>
                <Text style={[styles.targetMetText, { color: C.positive }]}>At target</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Pricing + remove */}
      <View style={styles.wishPricing}>
        <Text style={styles.wishPrice}>${price.toLocaleString('en-AU')}</Text>
        <View style={[
          styles.changePill,
          { backgroundColor: isUp ? `${C.positive}22` : `${C.negative}22` },
        ]}>
          <Feather
            name={isUp ? 'trending-up' : 'trending-down'}
            size={11}
            color={isUp ? C.positive : C.negative}
          />
          <Text style={[styles.changeText, { color: isUp ? C.positive : C.negative }]}>
            {isUp ? '+' : ''}{change.toFixed(1)}%
          </Text>
        </View>
        <Pressable onPress={onRemove} style={styles.removeBtn} hitSlop={10}>
          <Feather name="trash-2" size={13} color={C.mutedForeground} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
  const insets = useSafeAreaInsets();
  const { watchlist, addToWatchlist, removeFromWatchlist } = useApp();
  const [sortBy, setSortBy] = useState<'added' | 'value' | 'change'>('added');
  const [showAddPanel, setShowAddPanel] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const existingCardIds = useMemo(
    () => new Set(watchlist.map(w => w.cardId)),
    [watchlist],
  );

  const sorted = useMemo(() => {
    return [...watchlist].sort((a, b) => {
      if (sortBy === 'value') return b.card.price.raw - a.card.price.raw;
      if (sortBy === 'change')
        return (b.card.price.change7d ?? 0) - (a.card.price.change7d ?? 0);
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });
  }, [watchlist, sortBy]);

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 8, paddingBottom: 40 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.title}>Wishlist</Text>
          <View style={[styles.countBadge, { backgroundColor: C.card }]}>
            <Text style={styles.countText}>{watchlist.length}</Text>
          </View>
          <Pressable
            onPress={() => setShowAddPanel(true)}
            style={[styles.addBtn, { backgroundColor: C.primary }]}
          >
            <Feather name="plus" size={18} color="#FFF" />
          </Pressable>
        </View>

        {/* Hint strip */}
        <View style={[styles.hintStrip, { backgroundColor: `${C.primary}14`, borderColor: `${C.primary}33` }]}>
          <Feather name="info" size={13} color={C.primary} />
          <Text style={styles.hintText}>
            Cards here power your Trade Match and Event Mode suggestions. Tap{' '}
            <Text style={{ color: C.primary }}>+</Text> to add a card you're looking for.
          </Text>
        </View>

        {watchlist.length === 0 ? (
          // ── Empty state ──────────────────────────────────────────────────
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIcon, { backgroundColor: C.card }]}>
              <Feather name="heart" size={36} color={C.mutedForeground} />
            </View>
            <Text style={styles.emptyTitle}>Your wishlist is empty</Text>
            <Text style={styles.emptyBody}>
              Add cards you're hunting for. We'll use your wishlist to find trade
              matches and surface them at events.
            </Text>
            <Pressable
              onPress={() => setShowAddPanel(true)}
              style={[styles.emptyBtn, { backgroundColor: C.primary }]}
            >
              <Feather name="plus" size={16} color="#FFF" />
              <Text style={styles.emptyBtnText}>Add Your First Card</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Sort controls */}
            <View style={styles.sortRow}>
              <Text style={styles.sortLabel}>Sort:</Text>
              {(['added', 'value', 'change'] as const).map(s => (
                <Pressable
                  key={s}
                  onPress={() => setSortBy(s)}
                  style={[
                    styles.sortChip,
                    sortBy === s
                      ? { backgroundColor: C.primary }
                      : { backgroundColor: C.card },
                  ]}
                >
                  <Text style={[
                    styles.sortChipText,
                    sortBy === s && { color: '#FFF' },
                  ]}>
                    {s === 'added' ? 'Recent' : s === 'value' ? 'Value' : '7d Change'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Entries */}
            {sorted.map(item => (
              <WishCard
                key={item.id}
                item={item}
                onRemove={() => removeFromWatchlist(item.id)}
              />
            ))}

            <Text style={styles.footerNote}>
              Prices are estimated market values. Wishlist data is used locally to power
              Trade Match and Event Mode.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Add panel overlay */}
      {showAddPanel && (
        <AddPanel
          onClose={() => setShowAddPanel(false)}
          onAdd={addToWatchlist}
          existingCardIds={existingCardIds}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    flex: 1, fontSize: 28,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground, letterSpacing: -0.3,
  },
  countBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },
  countText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  addBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  hintStrip: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 8, borderRadius: 12, borderWidth: 1,
    padding: 12, marginBottom: 16,
  },
  hintText: {
    flex: 1, fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 18,
  },

  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sortLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  sortChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },

  wishCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderRadius: 14, padding: 14, gap: 12, marginBottom: 10,
  },
  thumb: {
    width: 54, height: 76, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbInitial: { fontSize: 24, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },

  wishInfo: { flex: 1, gap: 3 },
  wishName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  wishSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  gradeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  gradeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  targetText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  targetMetBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  targetMetText: { fontSize: 10, fontFamily: 'Inter_700Bold' },

  wishPricing: { alignItems: 'flex-end', gap: 6 },
  wishPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  changePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  changeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  removeBtn: {
    width: 28, height: 28,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },

  emptyContainer: { alignItems: 'center', paddingTop: 56, gap: 14 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptyBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 8,
  },
  emptyBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  footerNote: {
    fontSize: 11, fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}88`,
    textAlign: 'center', marginTop: 12, lineHeight: 18,
  },

  // ── Add panel ──
  panelOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  panelBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panel: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, gap: 14,
    maxHeight: '75%',
  },
  panelTall: { maxHeight: '85%' },
  panelHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.border, alignSelf: 'center', marginBottom: 4,
  },
  panelTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },

  selectedCardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, padding: 12, backgroundColor: C.muted,
  },
  selectedThumb: {
    width: 44, height: 62, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  selectedInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  selectedName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  selectedSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  selectedPrice: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary, marginTop: 3 },

  formLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, letterSpacing: 0.5, textTransform: 'uppercase',
  },
  optionalLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', textTransform: 'none', letterSpacing: 0 },
  gradeChipsRow: { gap: 8, paddingBottom: 4 },
  gradeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  gradeChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  priceInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  currencyPrefix: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  priceInput: {
    flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  } as any,
  currencySuffix: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  panelActions: { flexDirection: 'row', gap: 10 },
  panelSecondaryBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  panelSecondaryBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  panelPrimaryBtn: {
    flex: 2, height: 50, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  panelPrimaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  searchInput: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
    color: C.foreground,
  } as any,
  searchResults: { flex: 1 },
  searchResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderRadius: 10, paddingHorizontal: 4,
  },
  resultThumb: {
    width: 38, height: 54, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  resultInitial: { fontSize: 16, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  resultName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  resultMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  resultRight: { alignItems: 'flex-end', gap: 4 },
  resultPrice: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  alreadyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  alreadyText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});
