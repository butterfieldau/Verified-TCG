import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { GradeBadge } from '@/components/ui/Badge';
import { CardImage } from '@/components/ui/CardImage';
import { EmptyState } from '@/components/ui/EmptyState';
import { CollectionListSkeleton } from '@/components/ui/SkeletonLoader';
import SellModal from '@/components/ui/SellModal';
import { useApp } from '@/context/AppContext';
import { useNetwork } from '@/context/NetworkContext';
import { useSettings } from '@/context/SettingsContext';
import colors from '@/constants/colors';
import { CONDITION_LABELS } from '@/types';
import type { CollectionItem, WatchlistItem } from '@/types';
import { fetchCollectionSummary, type CollectionSummary } from '@/services/collectionPerformance';
import { tradingCardHeight, tradingCardRadius } from '@/services/collectionLayout';
import { createRequestDeduper } from '@/services/requestDeduper';

const C = colors.dark;
const PAGE_SIZE = 20;
const SUMMARY_STALE_MS = 60_000;

type CollectionFilter = 'all' | 'pokemon' | 'graded' | 'raw' | 'forSale';
type CollectionSort = 'value' | 'name' | 'recent';

const COLLECTION_FILTERS: { label: string; value: CollectionFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'Graded', value: 'graded' },
  { label: 'Raw', value: 'raw' },
  { label: 'For Sale', value: 'forSale' },
];

const SORT_LABELS: Record<CollectionSort, string> = {
  value: 'Value',
  name: 'Name',
  recent: 'Recent',
};


export default function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // Use AppContext's collection as the single source of truth.
  // AppContext caches the collection in AsyncStorage so it's available offline.
  const {
    user,
    collection,
    collectionLoading,
    collectionError,
    refreshCollection,
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
  } = useApp();
  const { isConnected } = useNetwork();
  const { currency } = useSettings();

  const [activeFilter, setActiveFilter] = useState<CollectionFilter>('all');
  const [sortBy, setSortBy] = useState<CollectionSort>('value');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Sell modal state
  const [sellItem, setSellItem] = useState<CollectionItem | null>(null);

  // Server summary for authoritative totals
  const [serverSummary, setServerSummary] = useState<CollectionSummary | null>(null);

  // Client-side windowing: show first `displayCount` of the fully-filtered list.
  // This is correct for both offline (cache) and online (live) data, and
  // filters work on the complete collection — not just the current page.
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const summaryLoadedAt = useRef(0);
  const summaryRequest = useRef<Promise<void> | null>(null);
  const collectionRefreshDeduper = useRef(createRequestDeduper()).current;
  const summaryCurrency = useRef(currency);
  const hasFocusedCollection = useRef(false);

  const loadSummary = useCallback(async (force = false) => {
    if (summaryCurrency.current !== currency) {
      summaryCurrency.current = currency;
      summaryLoadedAt.current = 0;
      summaryRequest.current = null;
      setServerSummary(null);
    }
    if (!force && Date.now() - summaryLoadedAt.current < SUMMARY_STALE_MS) return;
    if (summaryRequest.current) return summaryRequest.current;
    summaryRequest.current = (async () => {
      try {
        const summary = await fetchCollectionSummary(currency);
        if (summaryCurrency.current !== currency) return;
        setServerSummary(summary);
        summaryLoadedAt.current = Date.now();
      } catch {
        // Keep the last successful value stable. A missing first response is
        // represented by the compact unavailable worth state.
        if (summaryCurrency.current !== currency) return;
      } finally {
        summaryRequest.current = null;
      }
    })();
    return summaryRequest.current;
  }, [currency]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const holdingValue = useCallback((item: CollectionItem): number | null => {
    return item.valuation ? item.valuation.price * item.quantity : null;
  }, []);

  // Apply the approved Vault Index filters on the complete cached collection.
  const filteredItems = useMemo<CollectionItem[]>(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matching = collection.filter(item => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.card.name.toLocaleLowerCase().includes(normalizedQuery) ||
        item.card.setName.toLocaleLowerCase().includes(normalizedQuery) ||
        item.card.number.toLocaleLowerCase().includes(normalizedQuery);
      const matchesFilter =
        activeFilter === 'all' ||
        (activeFilter === 'pokemon' && item.card.tcg === 'pokemon') ||
        (activeFilter === 'graded' && !!item.grading) ||
        (activeFilter === 'raw' && !item.grading) ||
        (activeFilter === 'forSale' && !!item.isForSale);
      return matchesQuery && matchesFilter;
    });

    return matching.sort((a, b) => {
      if (sortBy === 'name') return a.card.name.localeCompare(b.card.name);
      if (sortBy === 'recent') {
        return new Date(b.acquiredAt).getTime() - new Date(a.acquiredAt).getTime();
      }
      return (holdingValue(b) ?? -1) - (holdingValue(a) ?? -1);
    });
  }, [collection, activeFilter, query, sortBy, holdingValue]);

  // Windowed slice shown in the list; load-more just extends this window
  const visibleItems = useMemo(
    () => filteredItems.slice(0, displayCount),
    [filteredItems, displayCount],
  );

  const hasMore = displayCount < filteredItems.length;

  // True only on the very first load when we have no data at all yet
  const initialLoading = collectionLoading && collection.length === 0;

  const resetWindow = useCallback(() => {
    setDisplayCount(PAGE_SIZE);
  }, []);

  // AppContext performs the initial authenticated collection load. Subsequent
  // focuses represent a real leave/reopen and request one fresh library load.
  useFocusEffect(
    useCallback(() => {
      if (hasFocusedCollection.current) {
        void refreshCollection();
      } else {
        hasFocusedCollection.current = true;
      }
      void loadSummary(true);
    }, [loadSummary, refreshCollection]),
  );

  const handleRefresh = useCallback(async () => {
    return collectionRefreshDeduper.run(async () => {
      setIsRefreshing(true);
      setDisplayCount(PAGE_SIZE); // reset window so user sees top of the list
      try {
        await Promise.all([refreshCollection(), loadSummary(true)]);
      } finally {
        setIsRefreshing(false);
      }
    });
  }, [collectionRefreshDeduper, refreshCollection, loadSummary]);

  const avatarInitials = useMemo(() => {
    const source = user?.displayName?.trim() || user?.username?.trim() || 'Collector';
    return source
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [user]);

  const toggleSaved = useCallback((item: CollectionItem) => {
    const existing = watchlist.find(entry => entry.cardId === item.card.id);
    if (existing) {
      removeFromWatchlist(existing.id);
      return;
    }
    const entry: WatchlistItem = {
      id: `wl-${Date.now()}-${item.card.id}`,
      cardId: item.card.id,
      card: item.card,
      desiredGrade: item.grading
        ? `${item.grading.company} ${item.grading.grade}`
        : 'Raw',
      addedAt: new Date().toISOString().split('T')[0]!,
      priceAlertEnabled: false,
    };
    addToWatchlist(entry);
  }, [addToWatchlist, removeFromWatchlist, watchlist]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || collectionLoading) return;
    setDisplayCount(prev => prev + PAGE_SIZE);
  }, [hasMore, collectionLoading]);

  // ── Header (shared across all tabs) ──────────────────────────────────────

  function renderHeader() {
    const portfolioCurrency = serverSummary?.currency ?? currency;

    return (
      <View>
        {/* Offline indicator */}
        {!isConnected && collection.length > 0 && (
          <View style={styles.offlineNote}>
            <Feather name="cloud-off" size={12} color={C.warning} />
            <Text style={styles.offlineNoteText}>
              Offline — showing cached collection
            </Text>
          </View>
        )}

        {collectionError && (
          <View style={[styles.errorBox, styles.headerAlert]} accessibilityRole="alert">
            <Feather name="alert-circle" size={20} color={C.negative} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.errorText}>{collectionError.message}</Text>
              {collectionError.endpoint && (
                <Text style={styles.errorDetail}>Failed while refreshing {collectionError.endpoint}</Text>
              )}
              {collectionError.recoverable && (
                <Pressable onPress={() => { void refreshCollection(); }} accessibilityRole="button">
                  <Text style={[styles.errorText, { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>Retry</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        <Animated.View entering={FadeIn.duration(380)} style={styles.header}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarInitials}</Text>
            </View>
            <View>
              <Text style={styles.kicker}>
                {(user?.username || 'COLLECTOR').toUpperCase()} / VAULT
              </Text>
              <Text style={styles.title}>COLLECTION</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                setSearchOpen(open => !open);
                if (searchOpen) setQuery('');
              }}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={searchOpen ? 'Close collection search' : 'Search collection'}
              hitSlop={2}
            >
              <Feather name={searchOpen ? 'x' : 'search'} size={17} color={C.foreground} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/collection-archive' as any)}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel="Collection archive"
              hitSlop={2}
            >
              <Feather name="archive" size={17} color={C.foreground} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => router.push('/add-card')}
              accessibilityRole="button"
              accessibilityLabel="Add a card"
              hitSlop={2}
            >
              <Feather name="plus" size={17} color={C.foreground} />
            </Pressable>
          </View>
        </Animated.View>

        {searchOpen && (
          <Animated.View entering={FadeInDown.duration(220)} style={styles.searchBox}>
            <Feather name="search" size={15} color="#7D7A7D" />
            <TextInput
              autoFocus
              value={query}
              onChangeText={value => {
                setQuery(value);
                resetWindow();
              }}
              placeholder="Search card, set or number"
              placeholderTextColor="#656166"
              style={styles.searchInput}
              returnKeyType="search"
            />
            <Text style={styles.searchCount}>{filteredItems.length}</Text>
          </Animated.View>
        )}

        <Animated.View
          entering={FadeInDown.delay(60).duration(420)}
          style={styles.portfolioSection}
          testID="collection-profile-worth"
        >
          <Text style={styles.portfolioLabel}>Profile worth</Text>
          {serverSummary?.totalValue !== null && serverSummary?.totalValue !== undefined ? (
            <Text style={styles.portfolioValue}>
              {portfolioCurrency} {serverSummary.totalValue.toLocaleString('en-AU', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          ) : (
            <Text style={styles.portfolioUnavailable}>VALUE UNAVAILABLE</Text>
          )}
        </Animated.View>

        <View style={styles.libraryToolbar}>
          <View style={styles.libraryHeading}>
            <Text style={styles.libraryTitle}>LIBRARY</Text>
            <Text style={styles.libraryCount}>{filteredItems.length} OF {collection.length} SHOWING</Text>
          </View>
          <View style={styles.toolbarActions}>
            <Pressable
              onPress={() => {
                setSortBy(current => current === 'value' ? 'name' : current === 'name' ? 'recent' : 'value');
                resetWindow();
              }}
              style={styles.sortButton}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${SORT_LABELS[sortBy]}`}
            >
              <Feather name="shuffle" size={12} color="#DD6974" />
              <Text style={styles.sortText}>{SORT_LABELS[sortBy]}</Text>
              <Feather name="chevron-down" size={12} color="#777278" />
            </Pressable>
            <View style={styles.viewToggle}>
              {(['grid', 'list'] as const).map(mode => (
                <Pressable
                  key={mode}
                  onPress={() => setViewMode(mode)}
                  style={[styles.viewButton, viewMode === mode && styles.viewButtonActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`${mode} view`}
                  accessibilityState={{ selected: viewMode === mode }}
                >
                  <Feather name={mode} size={14} color={viewMode === mode ? '#F5F0E6' : '#656166'} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {COLLECTION_FILTERS.map(filter => {
            const selected = activeFilter === filter.value;
            return (
              <Pressable
                key={filter.value}
                onPress={() => {
                  setActiveFilter(filter.value);
                  resetWindow();
                }}
                style={[styles.filterChip, selected && styles.filterChipActive]}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${filter.label}`}
                accessibilityState={{ selected }}
              >
                {selected && <Feather name="check" size={11} color="#FF9CA4" />}
                <Text style={[styles.filterText, selected && styles.filterTextActive]}>{filter.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Skeleton while loading the very first time (no cached data yet) */}
        {initialLoading && (
          <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
            <CollectionListSkeleton count={6} />
          </View>
        )}

        {/* Offline + no cache yet */}
        {!isConnected && collection.length === 0 && !collectionLoading && (
          <View style={[styles.errorBox, styles.headerAlert]}>
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
        onLongPress={() => setSellItem(item)}
        delayLongPress={600}
        accessibilityRole="button"
        accessibilityLabel={`${item.card.name}, ${item.grading ? `${item.grading.company} ${item.grading.grade}` : item.condition}, ${holdingValue(item) == null ? 'market value unavailable' : `${item.valuation?.currency} ${holdingValue(item)!.toLocaleString('en-AU')}`}`}
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
            {holdingValue(item) != null
              ? `${item.valuation!.currency} ${holdingValue(item)!.toLocaleString('en-AU')}`
              : 'Unavailable'}
          </Text>
          <Text style={styles.itemCost}>
            Cost {item.currency} {(item.acquiredPrice * item.quantity).toLocaleString('en-AU')}
          </Text>
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); setSellItem(item); }}
            style={styles.sellBtn}
            accessibilityRole="button"
            accessibilityLabel={`Sell ${item.card.name}`}
            hitSlop={4}
          >
            <Feather name="dollar-sign" size={11} color={C.primary} />
            <Text style={styles.sellBtnText}>Sell</Text>
          </Pressable>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              router.push({ pathname: '/add-card', params: { editId: item.id } });
            }}
            style={styles.editBtn}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.card.name}`}
            hitSlop={4}
          >
            <Feather name="edit-2" size={11} color={C.mutedForeground} />
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }

  // ── Card grid item ────────────────────────────────────────────────────────

  const gridItemWidth = Math.min((screenWidth - 52) / 2, 220);
  const gridCardRadius = tradingCardRadius(gridItemWidth);

  function renderCardGrid(item: CollectionItem) {
    const isSaved = watchlist.some(entry => entry.cardId === item.card.id);
    return (
      <Pressable
        style={[styles.gridItem, { width: gridItemWidth }]}
        onPress={() => {
          const ids = filteredItems.map(i => i.card.id).join(',');
          router.push(`/card/${item.card.id}?cardIds=${ids}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.card.name}, ${holdingValue(item) == null ? 'market value unavailable' : `${item.valuation?.currency} ${holdingValue(item)!.toLocaleString('en-AU')}`}`}
      >
        <View style={[
          styles.gridArt,
          { height: tradingCardHeight(gridItemWidth), borderRadius: gridCardRadius },
        ]}>
          <LinearGradient
            colors={[item.card.gradientStart, item.card.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <CardImage
            uri={item.card.imageUrl}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.88)']}
            start={{ x: 0.5, y: 0.42 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {item.grading && (
            <View style={styles.gridGrade}>
              <GradeBadge grade={item.grading.grade} company={item.grading.company} size="sm" />
            </View>
          )}
          <Pressable
            onPress={event => {
              event.stopPropagation?.();
              toggleSaved(item);
            }}
            style={[styles.saveButton, isSaved && styles.saveButtonActive]}
            accessibilityRole="button"
            accessibilityLabel={`${isSaved ? 'Remove' : 'Save'} ${item.card.name} ${isSaved ? 'from' : 'to'} wishlist`}
          >
            <Text style={[styles.saveButtonText, isSaved && styles.saveButtonTextActive]}>
              {isSaved ? 'SAVED' : 'SAVE'}
            </Text>
          </Pressable>
          <View style={styles.gridOverlay}>
            <Text style={styles.gridName} numberOfLines={1}>{item.card.name}</Text>
            <Text style={styles.gridMeta} numberOfLines={1}>{item.card.setName} · {item.card.number}</Text>
            <Text style={styles.gridPrice}>
              {holdingValue(item) != null
                ? `${item.valuation!.currency} ${holdingValue(item)!.toLocaleString('en-AU')}`
                : 'VALUE UNAVAILABLE'}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  function renderCollectionEmpty() {
    if (initialLoading || collectionError) return null;
    const filtered = collection.length > 0 && (activeFilter !== 'all' || query.trim().length > 0);
    return (
      <View style={styles.emptyWrap}>
        <EmptyState
          icon={filtered ? 'sliders' : 'layers'}
          title={filtered ? 'No cards match this slice' : 'No cards yet'}
          description={
            filtered
              ? 'Try another filter or clear your search.'
              : 'Scan your first card or search the database to start building your collection.'
          }
          actionLabel={filtered ? 'Reset View' : 'Add Card'}
          onAction={() => {
            if (filtered) {
              setActiveFilter('all');
              setQuery('');
              resetWindow();
            } else {
              router.push('/add-card');
            }
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {viewMode === 'grid' ? (
        <FlashList
          data={visibleItems}
          numColumns={2}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index, 8) * 55).duration(360)}
              layout={LinearTransition.springify().damping(18)}
              style={index % 2 === 0 ? styles.gridCellLeft : styles.gridCellRight}
            >
              {renderCardGrid(item)}
            </Animated.View>
          )}
          ListHeaderComponent={() => renderHeader()}
          ListEmptyComponent={renderCollectionEmpty}
          ListFooterComponent={() => (
            <View style={[styles.listFooter, { paddingBottom: TAB_H + 24 }]}>
              {collectionLoading && !initialLoading && <ActivityIndicator color={C.primary} />}
              {!hasMore && visibleItems.length > 0 && (
                <Text style={styles.allLoadedText}>All {filteredItems.length} cards loaded</Text>
              )}
            </View>
          )}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.primary} colors={[C.primary]} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ paddingTop: topPad + 8 }}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
        />
      ) : (
        <FlashList
          data={visibleItems}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(320)}
              layout={LinearTransition.springify().damping(18)}
              style={styles.listCell}
            >
              {renderCardRow(item)}
            </Animated.View>
          )}
          ListHeaderComponent={() => renderHeader()}
          ListEmptyComponent={renderCollectionEmpty}
          ListFooterComponent={() => (
            <View style={[styles.listFooter, { paddingBottom: TAB_H + 24 }]}>
              {collectionLoading && !initialLoading && <ActivityIndicator color={C.primary} />}
              {!hasMore && visibleItems.length > 0 && (
                <Text style={styles.allLoadedText}>All {filteredItems.length} cards loaded</Text>
              )}
            </View>
          )}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={C.primary} colors={[C.primary]} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ paddingTop: topPad + 8 }}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
        />
      )}
      {sellItem && (
        <SellModal
          item={sellItem}
          displayCurrency={currency}
          onClose={() => setSellItem(null)}
          onSold={() => {
            setSellItem(null);
            void Promise.all([refreshCollection(), loadSummary(true)]);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0D0D0F' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    marginBottom: 16,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#3E252B',
    backgroundColor: '#271317',
  },
  avatarText: {
    color: '#FF8F9A',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  kicker: {
    color: '#7D7A7D',
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.35,
  },
  title: {
    marginTop: 2,
    color: '#F4F1E8',
    fontSize: 34,
    fontFamily: 'Rajdhani_700Bold',
    lineHeight: 34,
    letterSpacing: -0.8,
  },
  headerActions: { flexDirection: 'row', gap: 7 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#29282B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: `${C.warning}18`,
  },
  offlineNoteText: { color: C.warning, fontSize: 12, fontFamily: 'Inter_500Medium' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3B2A2D',
    borderRadius: 12,
    backgroundColor: '#18181B',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    color: '#F4F1E8',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    padding: 0,
  },
  searchCount: {
    borderRadius: 6,
    backgroundColor: '#2A2022',
    paddingHorizontal: 6,
    paddingVertical: 3,
    color: '#FF8F9A',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  portfolioSection: {
    position: 'relative',
    marginHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 2,
  },
  portfolioLabel: {
    color: '#B2A4A5',
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.45,
    textTransform: 'uppercase',
  },
  portfolioValue: {
    position: 'relative',
    marginTop: 5,
    color: '#FFF8F2',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1.5,
  },
  portfolioUnavailable: {
    marginTop: 8,
    color: '#AA888C',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  libraryToolbar: {
    marginTop: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  libraryHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  libraryTitle: { color: '#F5F0E6', fontFamily: 'Rajdhani_700Bold', fontSize: 20 },
  libraryCount: { color: '#6E6B70', fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 0.5 },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#29282B',
    borderRadius: 8,
    backgroundColor: '#18181B',
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  sortText: { color: '#9E999D', fontFamily: 'Inter_700Bold', fontSize: 10 },
  viewToggle: { flexDirection: 'row', gap: 2, borderRadius: 8, backgroundColor: '#18181B', padding: 3 },
  viewButton: { width: 25, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  viewButtonActive: { backgroundColor: '#383438' },
  filterRow: { gap: 7, paddingHorizontal: 20, paddingTop: 13, paddingBottom: 14 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#29282B',
    borderRadius: 999,
    backgroundColor: '#18181B',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  filterChipActive: { borderColor: '#7D2F39', backgroundColor: '#441C23' },
  filterText: { color: '#89858A', fontFamily: 'Inter_700Bold', fontSize: 10 },
  filterTextActive: { color: '#FF9CA4' },
  gridCellLeft: { paddingLeft: 20, paddingRight: 6, paddingBottom: 12 },
  gridCellRight: { paddingLeft: 6, paddingRight: 20, paddingBottom: 12 },
  gridItem: { width: '100%' },
  gridArt: {
    width: '100%',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#302E31',
    borderRadius: 14,
    backgroundColor: '#18181B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  gridGrade: { position: 'absolute', left: 7, top: 7 },
  saveButton: {
    position: 'absolute',
    right: 7,
    top: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.68)',
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  saveButtonActive: { borderColor: '#AD3B49', backgroundColor: '#5A202A' },
  saveButtonText: { color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 8, letterSpacing: 0.4 },
  saveButtonTextActive: { color: '#FFB3B8' },
  gridOverlay: { position: 'absolute', left: 10, right: 10, bottom: 9 },
  gridName: { color: '#F3EEE5', fontFamily: 'Inter_700Bold', fontSize: 13 },
  gridMeta: { marginTop: 2, color: '#AAA2A6', fontFamily: 'Inter_400Regular', fontSize: 9 },
  gridPrice: { marginTop: 5, color: '#FF9098', fontFamily: 'Inter_700Bold', fontSize: 12 },
  listCell: { marginHorizontal: 20, marginBottom: 9 },
  itemRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#28272A',
    borderRadius: 12,
    padding: 9,
    gap: 11,
    alignItems: 'center',
    backgroundColor: '#18181B',
  },
  cardPlaceholder: {
    width: 58,
    height: 80,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cardGrade: { position: 'absolute', top: 2, right: -8 },
  itemInfo: { flex: 1, gap: 3 },
  itemName: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#F3EEE5' },
  itemSet: { fontSize: 10, fontFamily: 'Inter_400Regular', color: '#777278' },
  itemNumber: { fontSize: 9, fontFamily: 'Inter_400Regular', color: '#666166' },
  itemTags: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  itemPricing: { alignItems: 'flex-end', gap: 2 },
  itemCurrentValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FF9098' },
  itemCost: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  sellBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: `${C.primary}55`,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
    marginTop: 2,
  },
  sellBtnText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  editBtn: {
    marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
  },
  editBtnText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  emptyWrap: { paddingHorizontal: 20, paddingTop: 4 },
  listFooter: { paddingTop: 12, alignItems: 'center', gap: 8 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#18181B',
  },
  headerAlert: { marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14 },
  errorText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  errorDetail: {
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  allLoadedText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
});
