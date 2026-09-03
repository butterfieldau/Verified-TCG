import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { VerificationBadge } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Chip';
import { SearchListSkeleton } from '@/components/ui/SkeletonLoader';
import { getMarketMoversCached } from '@/services/market';
import type { MarketMover } from '@/types';
import { handleApiError } from '@/services/errorHandler';
import colors from '@/constants/colors';
import type { Card, SearchCategory } from '@/types';
import {
  catalogCardToAppCard,
  MIN_CATALOG_SEARCH_LENGTH,
  normalizeCatalogQuery,
  CatalogSearchRequestGate,
  searchCatalog,
  type CatalogCard,
} from '@/services/catalogApi';
import { CardImage } from '@/components/ui/CardImage';
import { useSettings } from '@/context/SettingsContext';

const C = colors.dark;
const SEARCH_PAGE_SIZE = 20;

const CATEGORIES: { label: string; value: SearchCategory }[] = [
  { label: 'Cards', value: 'cards' },
  { label: 'Sets', value: 'sets' },
  { label: 'Sealed', value: 'sealed' },
  { label: 'Users', value: 'users' },
];


function CardResultRow({ card, onPress }: { card: Card; onPress: () => void }) {
  const [imgError, setImgError] = useState(false);
  const showImage = !!card.imageUrl && !imgError;
  const hasPrice = card.price.available === true;

  return (
    <Pressable
      style={[styles.resultRow, { backgroundColor: C.card }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.name}, ${card.setName}${card.number ? ` #${card.number}` : ''}, ${hasPrice ? `${card.price.currency} ${card.price.raw.toLocaleString()} raw` : 'price unavailable'}`}
    >
      <View style={[styles.resultThumb, { backgroundColor: card.gradientStart }]}>
        {showImage ? (
          <CardImage
            uri={card.imageUrl}
            style={styles.resultThumbImage}
            contentFit="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <Text style={styles.resultInitial}>{card.name[0]}</Text>
        )}
      </View>
      <View style={styles.resultInfo}>
        <View style={styles.resultNameRow}>
          <Text style={styles.resultName} numberOfLines={1}>{card.name}</Text>
          {card.verificationStatus === 'verified' && <VerificationBadge status="verified" />}
        </View>
        <Text style={styles.resultSet}>{card.setName} · {card.number}</Text>
        <Text style={styles.resultRarity}>{card.rarity.replace(/_/g, ' ')}</Text>
      </View>
      <View style={styles.resultPricing}>
        <Text style={[styles.resultPrice, !hasPrice && styles.resultPriceUnavailable]}>
          {hasPrice ? `${card.price.currency} ${card.price.raw.toLocaleString()}` : 'Unavailable'}
        </Text>
        <Text style={styles.resultPriceLabel}>{hasPrice ? 'Raw' : 'Price'}</Text>
        {hasPrice && card.price.change7d !== undefined && (
          <View style={styles.resultChangeRow}>
            <Feather
              name={card.price.change7d >= 0 ? 'arrow-up' : 'arrow-down'}
              size={9}
              color={card.price.change7d >= 0 ? '#22C55E' : '#EF4444'}
            />
            <Text style={[
              styles.resultChangeText,
              { color: card.price.change7d >= 0 ? '#22C55E' : '#EF4444' },
            ]}>
              {card.price.change7d >= 0 ? '+' : ''}{card.price.change7d.toFixed(1)}% 7d
            </Text>
          </View>
        )}
        {hasPrice && card.price.change30d !== undefined && (
          <View style={styles.resultChangeRow}>
            <Feather
              name={card.price.change30d >= 0 ? 'arrow-up' : 'arrow-down'}
              size={9}
              color={card.price.change30d >= 0 ? '#22C55E' : '#EF4444'}
            />
            <Text style={[
              styles.resultChangeText,
              { color: card.price.change30d >= 0 ? '#22C55E' : '#EF4444' },
            ]}>
              {card.price.change30d >= 0 ? '+' : ''}{card.price.change30d.toFixed(1)}% 30d
            </Text>
          </View>
        )}
        {hasPrice && card.price.psa10 && (
          <>
            <Text style={[styles.resultPrice, { marginTop: 4 }]}>${card.price.psa10.toLocaleString()}</Text>
            <Text style={styles.resultPriceLabel}>PSA 10</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export default function SearchScreen() {
  const { currency } = useSettings();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('cards');

  // Remote catalog results — paginated
  const [remoteResults, setRemoteResults] = useState<CatalogCard[]>([]);
  const [remotePage, setRemotePage] = useState(1);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteLoadingMore, setRemoteLoadingMore] = useState(false);
  const [remoteLoadMoreError, setRemoteLoadMoreError] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [remoteSources, setRemoteSources] = useState<{ catalogue?: string; pricing?: string }>({});
  const [trendingMovers, setTrendingMovers] = useState<MarketMover[]>([]);

  // Ref tracking the current search query so stale requests don't overwrite
  const activeQueryRef = useRef('');
  const activeControllerRef = useRef<AbortController | null>(null);
  const requestGateRef = useRef(new CatalogSearchRequestGate());

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  const cardResults = remoteResults.map(catalogCardToAppCard);

  const isEmpty = query.trim().length === 0;

  // Load trending cards once (used in empty/idle state)
  useEffect(() => {
    getMarketMoversCached(fresh => setTrendingMovers(fresh)).then(setTrendingMovers).catch(() => {});
  }, []);

  // Debounced search — resets pagination on new query
  useEffect(() => {
    const requestId = requestGateRef.current.start();
    const trimmed = normalizeCatalogQuery(query);
    if (trimmed.length < MIN_CATALOG_SEARCH_LENGTH || category !== 'cards') {
      if (activeControllerRef.current) activeControllerRef.current.abort();
      setRemoteResults([]);
      setRemoteError('');
      setRemoteHasMore(false);
      setRemotePage(1);
      setRemoteLoading(false);
      setRemoteLoadMoreError('');
      return;
    }
    // Cancel any in-flight request
    if (activeControllerRef.current) activeControllerRef.current.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    activeQueryRef.current = trimmed;

    setRemoteLoading(true);
    setRemoteError('');
    setRemotePage(1);
    setRemoteHasMore(false);
    setRemoteLoadMoreError('');

    const timer = setTimeout(() => {
      searchCatalog(trimmed, controller.signal, 1, currency)
        .then(result => {
          if (!requestGateRef.current.isCurrent(requestId) || activeQueryRef.current !== trimmed) return; // stale
          setRemoteResults(result.data ?? []);
          setRemoteSources({
            catalogue: result.catalogue_source ?? result.source,
            pricing: result.pricing_source,
          });
          setRemoteHasMore(result.meta?.hasMore ?? false);
          setRemotePage(1);
        })
        .catch(error => {
          if (!requestGateRef.current.isCurrent(requestId) || activeQueryRef.current !== trimmed) return;
          if (error?.name === 'AbortError') return;
          setRemoteResults([]);
          setRemoteSources({});
          setRemoteError(handleApiError(error));
        })
        .finally(() => {
          if (requestGateRef.current.isCurrent(requestId) && activeQueryRef.current === trimmed) {
            setRemoteLoading(false);
          }
        });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, category, currency]);

  const handleLoadMore = useCallback(async () => {
    const trimmed = normalizeCatalogQuery(query);
    if (
      !remoteHasMore ||
      remoteLoadingMore ||
      remoteLoading ||
      trimmed.length < MIN_CATALOG_SEARCH_LENGTH
    ) return;
    setRemoteLoadingMore(true);
    setRemoteLoadMoreError('');
    const nextPage = remotePage + 1;
    try {
      const result = await searchCatalog(trimmed, undefined, nextPage, currency);
      if (activeQueryRef.current !== trimmed) return; // stale
      setRemoteResults(prev => {
        const seen = new Set(prev.map(card => card.id));
        return [...prev, ...(result.data ?? []).filter(card => !seen.has(card.id))];
      });
      setRemoteHasMore(result.meta?.hasMore ?? false);
      setRemotePage(nextPage);
    } catch (error) {
      setRemoteLoadMoreError(handleApiError(error));
    } finally {
      setRemoteLoadingMore(false);
    }
  }, [remoteHasMore, remoteLoadingMore, remoteLoading, remotePage, query, currency]);

  // Flatten into list items for FlashList
  const listData: Card[] = !isEmpty && category === 'cards' ? cardResults : [];

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={2}
        >
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={styles.inputWrap}>
          <Feather name="search" size={16} color={C.mutedForeground} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search cards, sets or products"
            placeholderTextColor={C.mutedForeground}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
            selectionColor={C.primary}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={16} color={C.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Category filter */}
      <View style={styles.categories}>
        {CATEGORIES.map(c => (
          <Chip
            key={c.value}
            label={c.label}
            selected={category === c.value}
            onPress={() => setCategory(c.value)}
            size="sm"
          />
        ))}
      </View>

      <FlashList
        data={listData}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: tabH + 24 }}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={() => (
          <View>
            {/* Empty state — trending from real market movers */}
            {isEmpty && (
              <View>
                {trendingMovers.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>Trending Searches</Text>
                    <View style={styles.trendingTags}>
                      {trendingMovers.slice(0, 6).map(m => (
                        <Pressable
                          key={m.card.id}
                          onPress={() => setQuery(m.card.name)}
                          style={[styles.trendingTag, { backgroundColor: C.card }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Search for ${m.card.name}`}
                        >
                          <Feather name="trending-up" size={13} color={C.primary} />
                          <Text style={styles.trendingTagText}>{m.card.name}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Trending Cards</Text>
                    {trendingMovers.map(m => (
                      <CardResultRow
                        key={m.card.id}
                        card={m.card}
                        onPress={() => router.push({
                          pathname: `/card/${m.card.id}` as any,
                          params: { appCardJson: JSON.stringify(m.card) },
                        })}
                      />
                    ))}
                  </>
                )}
              </View>
            )}

            {/* Set results — no local catalog; show empty state */}
            {!isEmpty && category === 'sets' && (
              <View style={styles.emptyState}>
                <Feather name="package" size={40} color={C.muted} />
                <Text style={styles.emptyTitle}>Set search coming soon</Text>
                <Text style={styles.emptyBody}>Try searching by card name instead</Text>
              </View>
            )}

            {/* Sealed / Users placeholder */}
            {!isEmpty && (category === 'sealed' || category === 'users') && (
              <View style={styles.emptyState}>
                <Feather name="search" size={40} color={C.muted} />
                <Text style={styles.emptyTitle}>
                  No {category === 'sealed' ? 'sealed products' : 'users'} found
                </Text>
                <Text style={styles.emptyBody}>Try a different search or category</Text>
              </View>
            )}

            {/* Cards result header */}
            {!isEmpty && category === 'cards' && (
              <View>
                <Text style={styles.sectionTitle}>
                  {remoteLoading ? 'Searching live catalogue…' : `Cards (${cardResults.length}${remoteHasMore ? '+' : ''})`}
                </Text>
                {remoteError ? (
                  <View style={styles.errorRow}>
                    <Feather name="wifi-off" size={14} color={C.warning} />
                    <Text style={styles.liveError}>{remoteError}</Text>
                  </View>
                ) : null}
                {!remoteError && remoteResults.length > 0 ? (
                  <Text style={styles.liveSource}>
                    Catalogue · {remoteSources.catalogue ?? 'Verified TCG'}  •  Market prices · {remoteSources.pricing ?? 'No verified quotes yet'}
                  </Text>
                ) : null}
              </View>
            )}

            {/* Skeleton while loading first page */}
            {remoteLoading && listData.length === 0 && (
              <SearchListSkeleton count={5} />
            )}
          </View>
        )}
        renderItem={({ item }) => {
          const catalogSource = remoteResults.find(r => r.id === item.id);
          return (
            <CardResultRow
              card={item}
              onPress={() =>
                router.push({
                  pathname: `/card/${item.id}` as never,
                  params: catalogSource ? { catalogJson: JSON.stringify(catalogSource) } : {},
                })
              }
            />
          );
        }}
        ListFooterComponent={() => (
          remoteLoadingMore ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <ActivityIndicator color={C.primary} size="small" />
            </View>
          ) : remoteLoadMoreError ? (
            <View style={styles.loadMoreError}>
              <Text style={styles.liveError}>{remoteLoadMoreError}</Text>
              <Pressable
                onPress={handleLoadMore}
                style={styles.retryButton}
                accessibilityRole="button"
                accessibilityLabel="Retry loading more cards"
              >
                <Feather name="refresh-cw" size={13} color={C.primary} />
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null
        )}
        ListEmptyComponent={() =>
          !isEmpty && category === 'cards' && !remoteLoading ? (
            <View style={styles.emptyState}>
              <Feather name="search" size={40} color={C.muted} />
              <Text style={styles.emptyTitle}>No cards found</Text>
              <Text style={styles.emptyBody}>Try "Pikachu" or "Charizard"</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  loadMoreError: { padding: 16, alignItems: 'center', gap: 8 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  retryButtonText: { color: C.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.foreground,
  },
  categories: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    marginBottom: 12,
  },
  trendingTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trendingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  trendingTagText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.foreground },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  resultThumb: {
    width: 50,
    height: 70,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultThumbImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
  },
  resultInitial: { fontSize: 24, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  setIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInfo: { flex: 1, gap: 3 },
  resultNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    flex: 1,
  },
  resultSet: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  resultRarity: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}99`,
    textTransform: 'capitalize',
  },
  resultPriceUnavailable: {
    color: C.mutedForeground,
    fontSize: 11,
  },
  resultPricing: { alignItems: 'flex-end' },
  resultPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  resultPriceLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  resultChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3 },
  resultChangeText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  noResults: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    marginTop: 20,
  },
  liveSource: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.positive, marginBottom: 10 },
  liveError: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.warning, marginBottom: 10, flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
  },
});
