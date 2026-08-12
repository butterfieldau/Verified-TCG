import React, { useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { GradeBadge } from '@/components/ui/Badge';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { EmptyState } from '@/components/ui/EmptyState';
import { useApp } from '@/context/AppContext';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import colors from '@/constants/colors';
import { CONDITION_LABELS } from '@/types';
import type { TCGId } from '@/types';
import { getSealedProducts, getSetProgress } from '@/services/collection';

const C = colors.dark;

type CollectionTab = 'cards' | 'sealed' | 'sets' | 'graded';

const COLLECTION_TABS: { label: string; value: CollectionTab }[] = [
  { label: 'Cards', value: 'cards' },
  { label: 'Sealed', value: 'sealed' },
  { label: 'Sets', value: 'sets' },
  { label: 'Graded', value: 'graded' },
];

const TCG_CHIPS: { label: string; value: TCGId | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'MTG', value: 'magic' },
  { label: 'One Piece', value: 'onepiece' },
];

const SEALED_PRODUCTS = getSealedProducts();
const SET_PROGRESS = getSetProgress();

export default function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const { collection, portfolio } = useApp();
  const [collectionTab, setCollectionTab] = useState<CollectionTab>('cards');
  const [activeTCG, setActiveTCG] = useState<TCGId | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  // NativeTabs (iOS 26+ liquid glass) already accounts for the safe area —
  // adding insets.top on top of that creates a large black gap.
  const topPad = Platform.OS === 'web' ? 67 : isLiquidGlassAvailable() ? 0 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const baseFiltered =
    activeTCG === 'all' ? collection : collection.filter(i => i.card.tcg === activeTCG);

  const filteredCards =
    collectionTab === 'graded' ? baseFiltered.filter(i => !!i.grading) : baseFiltered;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: TAB_H + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Collection</Text>
          <Text style={styles.sub}>
            {collection.length} cards · ${portfolio.totalValue.toLocaleString('en-AU', { maximumFractionDigits: 0 })} AUD
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setViewMode(v => (v === 'grid' ? 'list' : 'grid'))}
            style={styles.iconBtn}
          >
            <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={18} color={C.foreground} />
          </Pressable>
          <Pressable style={styles.iconBtn} onPress={() => router.push('/add-card')}>
            <Feather name="plus" size={18} color={C.foreground} />
          </Pressable>
        </View>
      </View>

      {/* Portfolio value strip */}
      <View style={[styles.valueStrip, { backgroundColor: C.card }]}>
        <View>
          <Text style={styles.valueLabel}>Total Value</Text>
          <Text style={styles.valueAmount}>
            ${portfolio.totalValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })} AUD
          </Text>
        </View>
        <View style={styles.gainBadge}>
          <Text style={[styles.gainText, { color: portfolio.totalGain >= 0 ? C.positive : C.negative }]}>
            {portfolio.totalGain >= 0 ? '+' : ''}{portfolio.totalGainPercent.toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Collection type tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.typeTabsRow, { borderBottomColor: C.border }]}
      >
        {COLLECTION_TABS.map(t => (
          <Pressable
            key={t.value}
            onPress={() => setCollectionTab(t.value)}
            style={[
              styles.typeTab,
              collectionTab === t.value && { borderBottomColor: C.primary },
            ]}
          >
            <Text
              style={[
                styles.typeTabText,
                collectionTab === t.value && { color: C.foreground },
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* TCG chips (cards + graded tabs) */}
      {(collectionTab === 'cards' || collectionTab === 'graded') && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {TCG_CHIPS.map(t => (
            <Pressable
              key={t.value}
              onPress={() => setActiveTCG(t.value)}
              style={[
                styles.chip,
                activeTCG === t.value && { backgroundColor: C.primary, borderColor: C.primary },
              ]}
            >
              <Text
                style={[styles.chipText, activeTCG === t.value && { color: '#FFFFFF' }]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* ── CARDS / GRADED ── */}
      {(collectionTab === 'cards' || collectionTab === 'graded') && (
        <View>
          {filteredCards.length === 0 && (
            <EmptyState
              icon="layers"
              title={collectionTab === 'graded' ? 'No graded cards' : 'No cards yet'}
              description={
                collectionTab === 'graded'
                  ? 'Add graded cards to see them here'
                  : 'Scan or add your first card to get started'
              }
              actionLabel="Add Card"
              onAction={() => router.push('/add-card')}
            />
          )}

          {viewMode === 'grid' ? (
            <View style={styles.grid}>
              {filteredCards.map(item => (
                <Pressable
                  key={item.id}
                  style={styles.gridItem}
                  onPress={() => {
                    const ids = filteredCards.map(i => i.card.id).join(',');
                    router.push(`/card/${item.card.id}?cardIds=${ids}`);
                  }}
                >
                  <CardThumbnail card={item.card} grading={item.grading} />
                  <Text style={styles.gridName} numberOfLines={1}>{item.card.name}</Text>
                  <Text style={styles.gridPrice}>
                    ${(item.grading?.grade === 10
                      ? item.card.price.psa10 ?? item.card.price.raw
                      : item.card.price.raw
                    ).toLocaleString('en-AU')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            filteredCards.map(item => (
              <Pressable
                key={item.id}
                style={[styles.itemRow, { backgroundColor: C.card }]}
                onPress={() => {
                  const ids = filteredCards.map(i => i.card.id).join(',');
                  router.push(`/card/${item.card.id}?cardIds=${ids}`);
                }}
              >
                <View style={styles.cardPlaceholder}>
                  {/* Gradient fallback — always rendered as base layer */}
                  <LinearGradient
                    colors={[item.card.gradientStart, item.card.gradientEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
                  />
                  {/* Card artwork on top of gradient */}
                  {!!item.card.imageUrl && (
                    <Image
                      source={{ uri: item.card.imageUrl }}
                      style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
                      resizeMode="cover"
                    />
                  )}
                  {item.grading && (
                    <View style={styles.cardGrade}>
                      <GradeBadge
                        grade={item.grading.grade}
                        company={item.grading.company}
                        size="sm"
                      />
                    </View>
                  )}
                </View>

                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.card.name}</Text>
                  <Text style={styles.itemSet} numberOfLines={1}>{item.card.setName}</Text>
                  <Text style={styles.itemNumber}>{item.card.number}</Text>
                  <View style={styles.itemTags}>
                    <View style={[styles.tag, { backgroundColor: C.muted }]}>
                      <Text style={styles.tagText}>
                        {item.grading
                          ? `${item.grading.company} ${item.grading.grade}`
                          : CONDITION_LABELS[item.condition]}
                      </Text>
                    </View>
                    {item.isForSale && (
                      <View style={[styles.tag, { backgroundColor: `${C.primary}22` }]}>
                        <Text style={[styles.tagText, { color: C.primary }]}>For Sale</Text>
                      </View>
                    )}
                    {item.isForTrade && (
                      <View style={[styles.tag, { backgroundColor: `${C.warning}22` }]}>
                        <Text style={[styles.tagText, { color: C.warning }]}>Trade</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.itemPricing}>
                  <Text style={styles.itemCurrentValue}>
                    ${(item.grading?.grade === 10
                      ? item.card.price.psa10 ?? item.card.price.raw
                      : item.card.price.raw
                    ).toLocaleString('en-AU')}
                  </Text>
                  <Text style={styles.itemCost}>Cost ${item.acquiredPrice.toLocaleString('en-AU')}</Text>
                  {item.card.price.change7d !== undefined && (
                    <Text
                      style={[
                        styles.itemChange,
                        {
                          color: (item.card.price.change7d ?? 0) >= 0 ? C.positive : C.negative,
                        },
                      ]}
                    >
                      {(item.card.price.change7d ?? 0) >= 0 ? '+' : ''}
                      {item.card.price.change7d?.toFixed(1)}% 7d
                    </Text>
                  )}
                </View>
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* ── SEALED ── */}
      {collectionTab === 'sealed' && (
        <View>
          {SEALED_PRODUCTS.map(p => (
            <View key={p.id} style={[styles.sealedRow, { backgroundColor: C.card }]}>
              <View style={[styles.sealedIcon, { backgroundColor: C.muted }]}>
                <Feather name="package" size={22} color={C.foreground} />
              </View>
              <View style={styles.sealedInfo}>
                <Text style={styles.sealedName}>{p.name}</Text>
                <Text style={styles.sealedMeta}>{p.tcg} · Qty: {p.qty}</Text>
              </View>
              <Text style={styles.sealedValue}>${p.value.toLocaleString()}</Text>
            </View>
          ))}
          {SEALED_PRODUCTS.length === 0 && (
            <EmptyState
              icon="package"
              title="No sealed products"
              description="Add sealed boxes, ETBs and products"
              actionLabel="Add Product"
              onAction={() => router.push('/add-card')}
            />
          )}
        </View>
      )}

      {/* ── SETS ── */}
      {collectionTab === 'sets' && (
        <View>
          {SET_PROGRESS.map(s => {
            const pct = (s.owned / s.total) * 100;
            return (
              <View key={s.id} style={[styles.setRow, { backgroundColor: C.card }]}>
                <View style={styles.setHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.setName}>{s.name}</Text>
                    <Text style={styles.setMeta}>{s.tcg} · {s.owned}/{s.total} cards</Text>
                  </View>
                  <Text style={[styles.setPct, { color: C.primary }]}>
                    {Math.round(pct)}%
                  </Text>
                </View>
                <View style={[styles.progressBar, { backgroundColor: C.muted }]}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${pct}%`, backgroundColor: C.primary },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  sub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  valueLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  valueAmount: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  gainBadge: {
    backgroundColor: `${C.positive}22`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  gainText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  typeTabsRow: {
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  typeTab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 4,
  },
  typeTabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  chipRow: { marginBottom: 16, marginTop: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    marginRight: 8,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.foreground },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { width: '47%', gap: 6 },
  gridName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  gridPrice: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  itemRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    alignItems: 'center',
  },
  cardPlaceholder: {
    width: 52,
    height: 72,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cardInitial: { fontSize: 24, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardGrade: { position: 'absolute', top: 2, right: -8 },
  itemInfo: { flex: 1, gap: 3 },
  itemName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  itemSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  itemNumber: { fontSize: 10, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}88` },
  itemTags: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  itemPricing: { alignItems: 'flex-end', gap: 2 },
  itemCurrentValue: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  itemCost: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  itemChange: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  sealedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  sealedIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sealedInfo: { flex: 1 },
  sealedName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  sealedMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 3,
  },
  sealedValue: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  setRow: { borderRadius: 14, padding: 16, marginBottom: 10 },
  setHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  setName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  setMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  setPct: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
});
