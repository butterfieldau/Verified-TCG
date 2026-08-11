import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Chip } from '@/components/ui/Chip';
import { GradeBadge } from '@/components/ui/Badge';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { CONDITION_LABELS } from '@/types';
import type { TCGId } from '@/types';

const C = colors.dark;

const SORT_OPTIONS = ['Value', 'Name', 'Added', 'Grade'];
const TCG_TABS: { label: string; value: TCGId | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'MTG', value: 'magic' },
  { label: 'One Piece', value: 'onepiece' },
];

export default function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const { collection, portfolio } = useApp();
  const [activeTab, setActiveTab] = useState<TCGId | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const filtered = activeTab === 'all'
    ? collection
    : collection.filter(i => i.card.tcg === activeTab);

  const totalValue = filtered.reduce((sum, item) => {
    const price = item.grading?.grade === 10
      ? item.card.price.psa10 ?? item.card.price.raw
      : item.card.price.raw;
    return sum + price * item.quantity;
  }, 0);

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
          <Text style={styles.sub}>{collection.length} cards · {portfolio.cardCount} total</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
            style={styles.iconBtn}
          >
            <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={18} color={C.foreground} />
          </Pressable>
          <Pressable style={styles.iconBtn}>
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
          <Text style={[styles.gainText, { color: C.positive }]}>
            +{portfolio.totalGainPercent.toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* TCG filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {TCG_TABS.map(t => (
          <Chip
            key={t.value}
            label={t.label}
            selected={activeTab === t.value}
            onPress={() => setActiveTab(t.value)}
            size="sm"
          />
        ))}
      </ScrollView>

      {/* Cards */}
      {filtered.map(item => (
        <Pressable key={item.id} style={[styles.itemRow, { backgroundColor: C.card }]}>
          <View
            style={[
              styles.cardPlaceholder,
              { backgroundColor: item.card.gradientStart },
            ]}
          >
            <Text style={styles.cardInitial}>{item.card.name[0]}</Text>
            {item.grading && (
              <View style={styles.cardGrade}>
                <GradeBadge grade={item.grading.grade} company={item.grading.company} size="sm" />
              </View>
            )}
          </View>

          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={1}>{item.card.name}</Text>
            <Text style={styles.itemSet} numberOfLines={1}>{item.card.setName}</Text>
            <Text style={styles.itemNumber}>{item.card.number}</Text>
            <View style={styles.itemTags}>
              <View style={[styles.tag, { backgroundColor: `${C.muted}` }]}>
                <Text style={styles.tagText}>
                  {item.grading ? `${item.grading.company} ${item.grading.grade}` : CONDITION_LABELS[item.condition]}
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
            <Text style={styles.itemCost}>
              Cost ${item.acquiredPrice.toLocaleString('en-AU')}
            </Text>
            {item.card.price.change7d !== undefined && (
              <Text style={[
                styles.itemChange,
                { color: (item.card.price.change7d ?? 0) >= 0 ? C.positive : C.negative }
              ]}>
                {(item.card.price.change7d ?? 0) >= 0 ? '+' : ''}
                {item.card.price.change7d?.toFixed(1)}% 7d
              </Text>
            )}
          </View>
        </Pressable>
      ))}
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
  valueLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  valueAmount: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  gainBadge: { backgroundColor: `${C.positive}22`, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  gainText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  chips: { marginBottom: 16 },
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
});
