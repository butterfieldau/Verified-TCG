import React, { useState, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { GradeBadge } from '@/components/ui/Badge';
import { CardImage } from '@/components/ui/CardImage';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { EmptyState } from '@/components/ui/EmptyState';
import { CollectionListSkeleton } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { useNetwork } from '@/context/NetworkContext';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import colors from '@/constants/colors';
import { CONDITION_LABELS } from '@/types';
import type { TCGId, CollectionItem } from '@/types';
import { getSealedProducts, getSetProgress } from '@/services/collection';

const C = colors.dark;
const PAGE_SIZE = 20;

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
  const { width: screenWidth } = useWindowDimensions();
  // Use AppContext's collection as the single source of truth.
  // AppContext caches the collection in AsyncStorage so it's available offline.
  const { collection, collectionLoading, refreshCollection, portfolio } = useApp();
  const { isConnected } = useNetwork();

  const [collectionTab, setCollectionTab] = useState<CollectionTab>('cards');
  const [activeTCG, setActiveTCG] = useState<TCGId | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  // Client-side windowing: show first `displayCount` of the fully-filtered list.
  // This is correct for both offline (cache) and online (live) data, and
  // filters work on the complete collection — not just the current page.
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : isLiquidGlassAvailable() ? 0 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  // Apply tab and TCG filters on the full in-memory collection
  const filteredItems = useMemo<CollectionItem[]>(() => {
    const isGraded = collectionTab === 'graded';
    return collection.filter(i => {
      const tcgMatch = activeTCG === 'all' || i.card.tcg === activeTCG;
      const gradedMatch = !isGraded || !!i.grading;
      return tcgMatch && gradedMatch;
    });
  }, [collection, collectionTab, activeTCG]);

  // Windowed slice shown in the list; load-more just extends this window
  const visibleItems = useMemo(
    () => filteredItems.slice(0, displayCount),
    [filteredItems, displayCount],
  );

  const hasMore = displayCount < filteredItems.length;

  // True only on the very first load when we have no data at all yet
  const initialLoading = collectionLoading && collection.length === 0;

  // Reset window when tab or TCG filter changes
  const onTabOrFilterChange = useCallback(() => {
    setDisplayCount(PAGE_SIZE);
  }, []);

  // Trigger a server refresh on focus (keeps portfolio in sync, populates cache)
  useFocusEffect(
    useCallback(() => {
      refreshCollection();
    }, [refreshCollection]),
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setDisplayCount(PAGE_SIZE); // reset window so user sees top of the list
    await refreshCollection();
    setIsRefreshing(false);
  }, [refreshCollection]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || collectionLoading) return;
    setDisplayCount(prev => prev + PAGE_SIZE);
  }, [hasMore, collectionLoading]);

  // ── Header (shared across all tabs) ──────────────────────────────────────

  function renderHeader() {
    return (
      <View style={{ paddingHorizontal: 20 }}>
        {/* Offline indicator */}
        {!isConnected && collection.length > 0 && (
          <View style={[styles.offlineNote, { backgroundColor: `${C.warning}18` }]}>
            <Feather name="cloud-off" size={12} color={C.warning} />
            <Text style={[styles.offlineNoteText, { color: C.warning }]}>
              Offline — showing cached collection
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Collection</Text>
            <Text style={styles.sub}>
              {filteredItems.length} {filteredItems.length === 1 ? 'card' : 'cards'} · ${portfolio.totalValue.toLocaleString('en-AU', { maximumFractionDigits: 0 })} AUD
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/collection-insights' as any)}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Collection Insights"
              hitSlop={2}
            >
              <Feather name="bar-chart-2" size={18} color={C.foreground} />
            </Pressable>
            <Pressable
              onPress={() => setViewMode(v => (v === 'grid' ? 'list' : 'grid'))}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              hitSlop={2}
            >
              <Feather name={viewMode === 'grid' ? 'list' : 'grid'} size={18} color={C.foreground} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => router.push('/add-card')}
              accessibilityRole="button"
              accessibilityLabel="Add a card"
              hitSlop={2}
            >
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
              onPress={() => { setCollectionTab(t.value); onTabOrFilterChange(); }}
              style={[
                styles.typeTab,
                collectionTab === t.value && { borderBottomColor: C.primary },
              ]}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: collectionTab === t.value }}
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
                onPress={() => { setActiveTCG(t.value); onTabOrFilterChange(); }}
                style={[
                  styles.chip,
                  activeTCG === t.value && { backgroundColor: '#CC1826', borderColor: '#CC1826' },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${t.label}`}
                accessibilityState={{ selected: activeTCG === t.value }}
                hitSlop={{ top: 6, bottom: 6 }}
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

        {/* Skeleton while loading the very first time (no cached data yet) */}
        {initialLoading && (
          <View style={{ paddingVertical: 8 }}>
            <CollectionListSkeleton count={6} />
          </View>
        )}

        {/* Offline + no cache yet */}
        {!isConnected && collection.length === 0 && !collectionLoading && (
          <View style={styles.errorBox}>
            <Feather name="wifi-off" size={20} color={C.negative} />
            <Text style={styles.errorText}>
              No cached data available. Connect to the internet to load your collection.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // ── Card list item (list mode) ────────────────────────────────────────────

  function renderCardRow(item: CollectionItem) {
    return (
      <Pressable
        key={item.id}
        style={[styles.itemRow, { backgroundColor: C.card, marginHorizontal: 20 }]}
        onPress={() => {
          const ids = filteredItems.map(i => i.card.id).join(',');
          router.push(`/card/${item.card.id}?cardIds=${ids}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.card.name}, ${item.grading ? `${item.grading.company} ${item.grading.grade}` : item.condition}, $${(item.grading?.grade === 10 ? item.card.price.psa10 ?? item.card.price.raw : item.card.price.raw).toLocaleString('en-AU')}`}
      >
        <View style={styles.cardPlaceholder}>
          <LinearGradient
            colors={[item.card.gradientStart, item.card.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
          />
          <CardImage
            uri={item.card.imageUrl}
            style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
            contentFit="cover"
          />
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
                { color: (item.card.price.change7d ?? 0) >= 0 ? C.positive : C.negative },
              ]}
            >
              {(item.card.price.change7d ?? 0) >= 0 ? '+' : ''}
              {item.card.price.change7d?.toFixed(1)}% 7d
            </Text>
          )}
        </View>
      </Pressable>
    );
  }

  // ── Card grid item ────────────────────────────────────────────────────────

  const gridItemWidth = (screenWidth - 40 - 12) / 2; // 20px padding each side + 12px gap

  function renderCardGrid(item: CollectionItem) {
    return (
      <Pressable
        style={[styles.gridItem, { width: gridItemWidth }]}
        onPress={() => {
          const ids = filteredItems.map(i => i.card.id).join(',');
          router.push(`/card/${item.card.id}?cardIds=${ids}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.card.name}, $${(item.grading?.grade === 10 ? item.card.price.psa10 ?? item.card.price.raw : item.card.price.raw).toLocaleString('en-AU')}`}
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
    );
  }

  // ── Cards / Graded tab — FlashList ────────────────────────────────────────

  if (collectionTab === 'cards' || collectionTab === 'graded') {
    return (
      <View style={[styles.screen, { backgroundColor: C.background }]}>
        {viewMode === 'grid' ? (
          <FlashList
            data={visibleItems}
            numColumns={2}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <View style={{ paddingLeft: 20, paddingBottom: 12 }}>
                {renderCardGrid(item)}
              </View>
            )}
            ListHeaderComponent={() => (
              <>
                {renderHeader()}
                <View style={{ height: 8 }} />
              </>
            )}
            ListEmptyComponent={() =>
              !initialLoading ? (
                <View style={{ paddingHorizontal: 20 }}>
                  <EmptyState
                    icon="layers"
                    title={collectionTab === 'graded' ? 'No graded cards' : 'No cards yet'}
                    description={
                      collectionTab === 'graded'
                        ? 'Add graded cards to see them here'
                        : 'Scan your first card or search the database to start building your collection'
                    }
                    actionLabel="Add Card"
                    onAction={() => router.push('/add-card')}
                  />
                </View>
              ) : null
            }
            ListFooterComponent={() => (
              <View style={{ paddingBottom: TAB_H + 24, paddingTop: 12, alignItems: 'center' }}>
                {collectionLoading && !initialLoading && <ActivityIndicator color={C.primary} />}
                {!hasMore && visibleItems.length > 0 && (
                  <Text style={styles.allLoadedText}>All {filteredItems.length} cards loaded</Text>
                )}
              </View>
            )}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ paddingTop: topPad + 8 }}
          />
        ) : (
          <FlashList
            data={visibleItems}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <View style={{ marginBottom: 10 }}>
                {renderCardRow(item)}
              </View>
            )}
            ListHeaderComponent={() => (
              <>
                {renderHeader()}
                <View style={{ height: 8 }} />
              </>
            )}
            ListEmptyComponent={() =>
              !initialLoading ? (
                <View style={{ paddingHorizontal: 20 }}>
                  <EmptyState
                    icon="layers"
                    title={collectionTab === 'graded' ? 'No graded cards' : 'No cards yet'}
                    description={
                      collectionTab === 'graded'
                        ? 'Add graded cards to see them here'
                        : 'Scan your first card or search the database to start building your collection'
                    }
                    actionLabel="Add Card"
                    onAction={() => router.push('/add-card')}
                  />
                </View>
              ) : null
            }
            ListFooterComponent={() => (
              <View style={{ paddingBottom: TAB_H + 24, paddingTop: 12, alignItems: 'center' }}>
                {collectionLoading && !initialLoading && <ActivityIndicator color={C.primary} />}
                {!hasMore && visibleItems.length > 0 && (
                  <Text style={styles.allLoadedText}>All {filteredItems.length} cards loaded</Text>
                )}
              </View>
            )}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ paddingTop: topPad + 8 }}
          />
        )}
      </View>
    );
  }

  // ── Sealed / Sets tabs — ScrollView ───────────────────────────────────────

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: TAB_H + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Shared header (without skeleton / error for static tabs) */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Collection</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/collection-insights' as any)}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Collection insights"
            hitSlop={2}
          >
            <Feather name="bar-chart-2" size={18} color={C.foreground} />
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => router.push('/add-card')}
            accessibilityRole="button"
            accessibilityLabel="Add a card"
            hitSlop={2}
          >
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
            onPress={() => { setCollectionTab(t.value); onTabOrFilterChange(); }}
            style={[
              styles.typeTab,
              collectionTab === t.value && { borderBottomColor: C.primary },
            ]}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: collectionTab === t.value }}
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
  offlineNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 12,
  },
  offlineNoteText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
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
  gridItem: { gap: 6 },
  gridName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  gridPrice: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  itemRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
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
  errorBox: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 32,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFF',
  },
  allLoadedText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
});
