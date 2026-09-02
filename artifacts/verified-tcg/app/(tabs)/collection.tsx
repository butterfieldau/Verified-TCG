import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
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
import { filterCollectionItems, sortCollectionItems } from '@/services/collectionOrganizer';
import { fetchCollectionListSubtotal, type CollectionListSubtotal } from '@/services/collectionOrganizer';

const C = colors.dark;
const PAGE_SIZE = 20;
const SUMMARY_STALE_MS = 60_000;

type CollectionFilter = 'all' | 'pokemon' | 'graded' | 'raw' | 'forSale' | 'forTrade';
type CollectionSort = 'value' | 'name' | 'recent' | 'quantity' | 'gain';

const COLLECTION_FILTERS: { label: string; value: CollectionFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'Graded', value: 'graded' },
  { label: 'Raw', value: 'raw' },
  { label: 'For Sale', value: 'forSale' },
  { label: 'For Trade', value: 'forTrade' },
];

const SORT_LABELS: Record<CollectionSort, string> = {
  value: 'Value',
  name: 'Name',
  recent: 'Recent',
  quantity: 'Quantity',
  gain: 'Gain',
};


export default function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // Use AppContext's collection as the single source of truth.
  // AppContext caches the collection in AsyncStorage so it's available offline.
  const {
    collection,
    collectionLoading,
    collectionError,
    refreshCollection,
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    collectionOrganizerPreferences,
    setCollectionOrganizerPreferences,
    collectionLists,
    collectionListMemberships,
    createCollectionList,
    deleteCollectionList,
    updateCollectionListMembership,
    bulkUpdateCollectionHoldings,
    bulkDeleteCollectionHoldings,
    renameCollectionList,
    reorderCollectionLists,
  } = useApp();
  const { isConnected } = useNetwork();
  const { currency } = useSettings();

  const [activeFilter, setActiveFilter] = useState<CollectionFilter>('all');
  const sortBy: CollectionSort = collectionOrganizerPreferences.sort.field === 'date'
    ? 'recent'
    : collectionOrganizerPreferences.sort.field;
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const viewMode = collectionOrganizerPreferences.viewMode;
  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<'holdings' | 'list' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [destinationListOpen, setDestinationListOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [listSubtotals, setListSubtotals] = useState<Record<string, CollectionListSubtotal | null>>({});
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
    const filters = {
      ...collectionOrganizerPreferences.filters,
      ...(activeFilter === 'pokemon' ? { tcg: 'pokemon' as const } : {}),
      ...(activeFilter === 'graded' ? { graded: true } : {}),
      ...(activeFilter === 'raw' ? { graded: false } : {}),
      ...(activeFilter === 'forSale' ? { forSale: true } : {}),
      ...(activeFilter === 'forTrade' ? { forTrade: true } : {}),
    };
    const field = sortBy === 'recent' ? 'date' : sortBy;
    const memberships = collectionOrganizerPreferences.selectedListId
      ? new Set(collectionListMemberships[collectionOrganizerPreferences.selectedListId] ?? []) : undefined;
    return sortCollectionItems(filterCollectionItems(collection, filters, normalizedQuery, memberships), field, collectionOrganizerPreferences.sort.direction);
  }, [collection, activeFilter, query, sortBy, collectionOrganizerPreferences, collectionListMemberships]);

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
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const runBulk = useCallback(async (operation: 'sale' | 'trade' | 'removeList') => {
    try {
      setWriting(true);
      const ids = [...selectedIds];
      if (operation === 'sale') await bulkUpdateCollectionHoldings(ids, { isForSale: true, isForTrade: false });
      if (operation === 'trade') await bulkUpdateCollectionHoldings(ids, { isForSale: false, isForTrade: true });
      if (operation === 'removeList' && collectionOrganizerPreferences.selectedListId) {
        await updateCollectionListMembership(collectionOrganizerPreferences.selectedListId, ids, 'remove');
      }
      setSelectedIds(new Set());
    } catch (error) { setActionError(error instanceof Error ? error.message : 'That update could not be saved.'); }
    finally { setWriting(false); }
  }, [bulkUpdateCollectionHoldings, collectionOrganizerPreferences.selectedListId, selectedIds, updateCollectionListMembership]);

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
            <View>
              <Text style={styles.kicker}>YOUR VAULT</Text>
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
            <Pressable onPress={() => { setSelectionMode(true); setSelectedIds(new Set()); }} style={styles.sortButton} accessibilityRole="button"><Text style={styles.sortText}>Select</Text></Pressable>
            <Pressable onPress={() => { setListSheetOpen(true); collectionLists.forEach(list => { setListSubtotals(current => ({ ...current, [list.id]: current[list.id] === undefined ? null : current[list.id] })); void fetchCollectionListSubtotal(list.id, currency).then(value => setListSubtotals(current => ({ ...current, [list.id]: value }))).catch(() => setListSubtotals(current => ({ ...current, [list.id]: null }))); }); }} style={styles.sortButton} accessibilityRole="button" accessibilityLabel="Choose or manage collection list">
              <Feather name="folder" size={12} color={C.primary} />
              <Text style={styles.sortText}>{collectionLists.find(list => list.id === collectionOrganizerPreferences.selectedListId)?.name ?? 'All Collection'}</Text>
            </Pressable>
            <Pressable
              onPress={() => setSortOpen(true)}
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
                  onPress={() => setCollectionOrganizerPreferences({ viewMode: mode })}
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
        <View style={styles.organizerSummary}>
          <Pressable style={styles.filterChip} onPress={() => setAdvancedOpen(true)} accessibilityRole="button">
            <Feather name="sliders" size={12} color={C.primary}/><Text style={styles.filterText}>Advanced filters</Text>
          </Pressable>
          {(Object.keys(collectionOrganizerPreferences.filters).length > 0 || activeFilter !== 'all') && <Pressable onPress={() => { setActiveFilter('all'); setCollectionOrganizerPreferences({ filters: {}, selectedListId: null }); }}><Text style={styles.bulkAction}>Clear filters</Text></Pressable>}
          <Text style={styles.sheetMeta}>{filteredItems.length} results · {collectionOrganizerPreferences.sort.direction === 'asc' ? 'Ascending' : 'Descending'}</Text>
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
        style={[styles.itemRow, { backgroundColor: C.card, marginHorizontal: 20 }, selectedIds.has(item.id) && { borderColor: C.primary, borderWidth: 1 }]}
        onPress={() => {
          if (selectionMode) { toggleSelection(item.id); return; }
          // Keep Passport swipes in exactly the rendered, deterministic order.
          const ids = filteredItems.map(i => i.card.id).join(',');
          router.push(`/card/${item.card.id}?cardIds=${ids}`);
        }}
        onLongPress={() => {
          setSelectionMode(true);
          toggleSelection(item.id);
        }}
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
        style={[styles.gridItem, { width: gridItemWidth }, selectedIds.has(item.id) && { borderColor: C.primary, borderWidth: 2, borderRadius: gridCardRadius }]}
        onPress={() => {
          if (selectionMode) { toggleSelection(item.id); return; }
          // Keep Passport swipes in exactly the rendered, deterministic order.
          const ids = filteredItems.map(i => i.card.id).join(',');
          router.push(`/card/${item.card.id}?cardIds=${ids}`);
        }}
        onLongPress={() => {
          setSelectionMode(true);
          toggleSelection(item.id);
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
            <View style={index % 2 === 0 ? styles.gridCellLeft : styles.gridCellRight}>
              {renderCardGrid(item)}
            </View>
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
          renderItem={({ item }) => (
            <View style={styles.listCell}>
              {renderCardRow(item)}
            </View>
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
      {selectionMode && (
        <View style={[styles.bulkBar, { bottom: TAB_H + 10 }]} accessibilityRole="toolbar">
          <Text style={styles.bulkText}>{selectedIds.size} selected</Text>
          <Pressable onPress={() => setSelectedIds(new Set(filteredItems.map(item => item.id)))}><Text style={styles.bulkAction}>All</Text></Pressable>
          {collectionOrganizerPreferences.selectedListId && <Pressable onPress={() => void runBulk('removeList')}><Text style={styles.bulkAction}>Remove list</Text></Pressable>}
          {collectionLists.length > 0 && (
            <Pressable disabled={writing || selectedIds.size === 0} onPress={() => setDestinationListOpen(true)}>
              <Text style={[styles.bulkAction, selectedIds.size === 0 && { color: C.mutedForeground }]}>Add to list</Text>
            </Pressable>
          )}
          <Pressable disabled={writing} onPress={() => void runBulk('sale')}><Text style={styles.bulkAction}>For sale</Text></Pressable>
          <Pressable disabled={writing} onPress={() => void runBulk('trade')}><Text style={styles.bulkAction}>Trade</Text></Pressable>
          <Pressable disabled={writing || selectedIds.size === 0} onPress={() => setDeleteTarget('holdings')}>
            <Text style={[styles.bulkAction, { color: selectedIds.size ? C.destructive : C.mutedForeground }]}>Delete</Text>
          </Pressable>
          <Pressable onPress={() => { setSelectedIds(new Set()); setSelectionMode(false); }}><Feather name="x" size={18} color={C.foreground} /></Pressable>
        </View>
      )}
      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <View style={styles.sheetBackdrop}><View style={styles.sheet}>
          <View style={styles.sheetHead}><Text style={styles.sheetTitle}>SORT COLLECTION</Text><Pressable onPress={() => setSortOpen(false)}><Feather name="x" size={20} color={C.foreground}/></Pressable></View>
          {(['name', 'value', 'recent', 'quantity', 'gain'] as CollectionSort[]).map(field => <Pressable key={field} style={styles.sheetRow} onPress={() => { setCollectionOrganizerPreferences({ sort: { field: field === 'recent' ? 'date' : field, direction: collectionOrganizerPreferences.sort.direction } }); setSortOpen(false); }}><Text style={styles.sheetText}>{SORT_LABELS[field]}</Text>{sortBy === field && <Feather name="check" color={C.primary} size={16}/>}</Pressable>)}
          <Pressable style={styles.sheetRow} onPress={() => setCollectionOrganizerPreferences({ sort: { ...collectionOrganizerPreferences.sort, direction: collectionOrganizerPreferences.sort.direction === 'asc' ? 'desc' : 'asc' } })}><Text style={styles.sheetText}>{collectionOrganizerPreferences.sort.direction === 'asc' ? 'Ascending ↑' : 'Descending ↓'}</Text><Text style={styles.sheetMeta}>Tap to reverse</Text></Pressable>
        </View></View>
      </Modal>
      <Modal visible={destinationListOpen} transparent animationType="slide" onRequestClose={() => setDestinationListOpen(false)}>
        <View style={styles.sheetBackdrop}><View style={styles.sheet}>
          <View style={styles.sheetHead}><Text style={styles.sheetTitle}>ADD TO LIST</Text><Pressable onPress={() => setDestinationListOpen(false)}><Feather name="x" size={20} color={C.foreground}/></Pressable></View>
          <Text style={styles.sheetMeta}>Choose a destination for {selectedIds.size} selected holding{selectedIds.size === 1 ? '' : 's'}.</Text>
          {collectionLists.map(list => (
            <Pressable
              key={list.id}
              style={styles.sheetRow}
              disabled={writing}
              onPress={() => {
                setWriting(true);
                void updateCollectionListMembership(list.id, [...selectedIds], 'add')
                  .then(() => {
                    setSelectedIds(new Set());
                    setSelectionMode(false);
                    setDestinationListOpen(false);
                  })
                  .catch(error => setActionError(error instanceof Error ? error.message : 'That list could not be updated.'))
                  .finally(() => setWriting(false));
              }}
            >
              <Text style={styles.sheetText}>{list.name}</Text>
              <Text style={styles.sheetMeta}>{list.itemCount ?? list.holdingIds.length} holdings</Text>
            </Pressable>
          ))}
        </View></View>
      </Modal>
      <Modal visible={advancedOpen} transparent animationType="slide" onRequestClose={() => setAdvancedOpen(false)}>
        <View style={styles.sheetBackdrop}><ScrollView style={styles.sheet}><View style={styles.sheetHead}><Text style={styles.sheetTitle}>ADVANCED FILTERS</Text><Pressable onPress={() => setAdvancedOpen(false)}><Feather name="x" size={20} color={C.foreground}/></Pressable></View>
          <Text style={styles.sheetMeta}>Condition, grading company, grade, value and acquisition date</Text>
          <View style={styles.filterInputRow}>
            <TextInput placeholder="Condition (e.g. near_mint)" placeholderTextColor={C.mutedForeground} style={styles.createInput} value={collectionOrganizerPreferences.filters.conditions?.[0] ?? ''} onChangeText={text => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, conditions: text ? [text as any] : undefined } })}/>
            <TextInput placeholder="Company (e.g. PSA)" placeholderTextColor={C.mutedForeground} style={styles.createInput} value={collectionOrganizerPreferences.filters.gradingCompanies?.[0] ?? ''} onChangeText={text => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, gradingCompanies: text ? [text as any] : undefined } })}/>
          </View>
          {(['minGrade','maxGrade','minValue','maxValue'] as const).map(key => <TextInput key={key} placeholder={key} placeholderTextColor={C.mutedForeground} keyboardType="decimal-pad" style={styles.createInput} value={collectionOrganizerPreferences.filters[key]?.toString() ?? ''} onChangeText={text => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, [key]: text ? Number(text) : undefined } })}/>)}
          {(['acquiredAfter','acquiredBefore'] as const).map(key => <TextInput key={key} placeholder={`${key} (YYYY-MM-DD)`} placeholderTextColor={C.mutedForeground} style={styles.createInput} value={collectionOrganizerPreferences.filters[key] ?? ''} onChangeText={text => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, [key]: text || undefined } })}/>)}
          <View style={styles.filterInputRow}>{(['priced','unpriced'] as const).map(value => <Pressable key={value} style={styles.filterChip} onPress={() => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, pricing: collectionOrganizerPreferences.filters.pricing === value ? undefined : value } })}><Text style={styles.filterText}>{value}</Text></Pressable>)}{(['fresh','stale'] as const).map(value => <Pressable key={value} style={styles.filterChip} onPress={() => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, pricingFreshness: collectionOrganizerPreferences.filters.pricingFreshness === value ? undefined : value } })}><Text style={styles.filterText}>{value} pricing</Text></Pressable>)}</View>
          <TextInput placeholder="Freshness days (default 30)" placeholderTextColor={C.mutedForeground} keyboardType="number-pad" style={styles.createInput} value={collectionOrganizerPreferences.filters.freshnessDays?.toString() ?? ''} onChangeText={text => setCollectionOrganizerPreferences({ filters: { ...collectionOrganizerPreferences.filters, freshnessDays: text ? Number(text) : undefined } })}/>
          <Pressable onPress={() => { setCollectionOrganizerPreferences({ filters: {}, selectedListId: null }); setAdvancedOpen(false); }}><Text style={styles.bulkAction}>Reset all filters</Text></Pressable>
        </ScrollView></View>
      </Modal>
      <Modal visible={listSheetOpen} transparent animationType="slide" onRequestClose={() => setListSheetOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}><Text style={styles.sheetTitle}>COLLECTION LISTS</Text><Pressable onPress={() => setListSheetOpen(false)}><Feather name="x" size={20} color={C.foreground} /></Pressable></View>
            <Pressable style={styles.sheetRow} onPress={() => { setCollectionOrganizerPreferences({ selectedListId: null, filters: { ...collectionOrganizerPreferences.filters, listId: undefined } }); setListSheetOpen(false); }}>
              <Text style={styles.sheetText}>All Collection</Text><Text style={styles.sheetMeta}>{collection.length} holdings</Text>
            </Pressable>
            {collectionLists.map((list, index) => <View key={list.id} style={styles.sheetRow}>
              <Pressable style={{ flex: 1 }} onPress={() => { setCollectionOrganizerPreferences({ selectedListId: list.id, filters: { ...collectionOrganizerPreferences.filters, listId: list.id } }); setListSheetOpen(false); }}>
                {renamingListId === list.id ? <TextInput autoFocus value={renameValue} onChangeText={setRenameValue} onSubmitEditing={() => void renameCollectionList(list.id, renameValue).then(() => setRenamingListId(null)).catch(error => setActionError(error.message))} style={styles.renameInput}/> : <Text style={styles.sheetText}>{list.name}</Text>}
                <Text style={styles.sheetMeta}>{list.itemCount ?? list.holdingIds.length} holdings · {listSubtotals[list.id] === undefined ? 'Subtotal loading…' : listSubtotals[list.id]?.totalValue == null ? 'Subtotal unavailable' : `${listSubtotals[list.id]!.currency} ${(listSubtotals[list.id]?.totalValue ?? 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`}</Text>
              </Pressable>
              <Pressable onPress={() => { setRenamingListId(list.id); setRenameValue(list.name); }}><Feather name="edit-2" size={15} color={C.mutedForeground}/></Pressable>
              <Pressable disabled={writing || index === 0} onPress={() => void reorderCollectionLists(collectionLists.map((entry, position) => position === index ? collectionLists[index - 1]!.id : position === index - 1 ? list.id : entry.id)).catch(error => setActionError(error.message))}><Feather name="chevron-up" size={18} color={index === 0 ? C.mutedForeground : C.foreground}/></Pressable>
              <Pressable disabled={writing || index === collectionLists.length - 1} onPress={() => void reorderCollectionLists(collectionLists.map((entry, position) => position === index ? collectionLists[index + 1]!.id : position === index + 1 ? list.id : entry.id)).catch(error => setActionError(error.message))}><Feather name="chevron-down" size={18} color={index === collectionLists.length - 1 ? C.mutedForeground : C.foreground}/></Pressable>
            </View>)}
            <View style={styles.createRow}><TextInput value={newListName} onChangeText={setNewListName} placeholder="New list name" placeholderTextColor={C.mutedForeground} style={styles.createInput}/><Pressable onPress={() => void createCollectionList(newListName).then(() => setNewListName('')).catch(error => setActionError(error.message))}><Feather name="plus-circle" size={24} color={C.primary}/></Pressable></View>
            {collectionOrganizerPreferences.selectedListId && <Pressable onPress={() => { setDeleteTarget('list'); setListSheetOpen(false); }}><Text style={[styles.bulkAction, { color: C.destructive }]}>Delete selected list</Text></Pressable>}
          </View>
        </View>
      </Modal>
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <View style={styles.sheetBackdrop}><View style={styles.confirmCard}>
          <Text style={styles.sheetTitle}>Confirm delete</Text>
          <Text style={styles.sheetMeta}>{deleteTarget === 'holdings' ? `Delete ${selectedIds.size} selected holding${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.` : 'Delete this collection list? Holdings will be kept.'}</Text>
          <View style={styles.confirmActions}>
            <Pressable onPress={() => setDeleteTarget(null)}><Text style={styles.bulkAction}>Cancel</Text></Pressable>
            <Pressable
              disabled={writing || (deleteTarget === 'holdings' && selectedIds.size === 0)}
              onPress={() => {
                const action = deleteTarget === 'holdings'
                  ? bulkDeleteCollectionHoldings([...selectedIds]).then(() => {
                    setSelectedIds(new Set());
                    setSelectionMode(false);
                  })
                  : deleteCollectionList(collectionOrganizerPreferences.selectedListId!);
                void action.then(() => setDeleteTarget(null)).catch(error => setActionError(error.message));
              }}
            >
              <Text style={[styles.bulkAction, { color: C.destructive }]}>Delete</Text>
            </Pressable>
          </View>
        </View></View>
      </Modal>
      {!!actionError && <View style={styles.notice}><Text style={styles.errorText}>{actionError}</Text><Pressable onPress={() => setActionError(null)}><Feather name="x" size={16} color={C.foreground}/></Pressable></View>}
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
  bulkBar: { position: 'absolute', left: 12, right: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.surfaceRaised, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 },
  bulkText: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 12 },
  bulkAction: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12, padding: 5 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: { backgroundColor: C.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10, maxHeight: '80%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sheetTitle: { color: C.foreground, fontFamily: 'Rajdhani_700Bold', fontSize: 22, letterSpacing: .5 },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  sheetText: { color: C.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sheetMeta: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 6 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  organizerSummary: { paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  filterInputRow: { flexDirection: 'row', gap: 8, marginVertical: 5 },
  createInput: { flex: 1, minHeight: 44, borderRadius: 10, paddingHorizontal: 12, color: C.foreground, backgroundColor: C.input, fontFamily: 'Inter_400Regular' },
  renameInput: { color: C.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14, padding: 0 },
  confirmCard: { margin: 20, borderRadius: 18, backgroundColor: C.surfaceRaised, padding: 22, gap: 12 },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 4 },
  notice: { position: 'absolute', left: 20, right: 20, top: 76, borderRadius: 12, padding: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.destructive, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
