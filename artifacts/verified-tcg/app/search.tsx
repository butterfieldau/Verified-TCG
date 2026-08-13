import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { VerificationBadge } from '@/components/ui/Badge';
import { Chip } from '@/components/ui/Chip';
import { getMarketMovers } from '@/services/market';
import type { MarketMover } from '@/types';
import { searchCards, CARD_SETS } from '@/services/cards';
import colors from '@/constants/colors';
import type { Card, SearchCategory } from '@/types';
import { catalogCardToAppCard, searchCatalog, type CatalogCard } from '@/services/catalogApi';
import { proxyImageUrl } from '@/services/imageProxy';

const C = colors.dark;

const CATEGORIES: { label: string; value: SearchCategory }[] = [
  { label: 'Cards', value: 'cards' },
  { label: 'Sets', value: 'sets' },
  { label: 'Sealed', value: 'sealed' },
  { label: 'Users', value: 'users' },
];

const TRENDING_SEARCHES = ['Umbreon ex', 'Pikachu', 'Charizard', 'Luffy', 'Black Lotus'];

function CardResultRow({ card, onPress }: { card: Card; onPress: () => void }) {
  const [imgError, setImgError] = useState(false);
  const imgUri = proxyImageUrl(card.imageUrl);
  const showImage = !!imgUri && !imgError;

  return (
    <Pressable style={[styles.resultRow, { backgroundColor: C.card }]} onPress={onPress}>
      <View style={[styles.resultThumb, { backgroundColor: card.gradientStart }]}>
        {showImage ? (
          <Image
            source={{ uri: imgUri }}
            style={styles.resultThumbImage}
            resizeMode="cover"
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
        <Text style={styles.resultPrice}>${card.price.raw.toLocaleString()}</Text>
        <Text style={styles.resultPriceLabel}>Raw</Text>
        {card.price.change7d !== undefined && (
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
        {card.price.change30d !== undefined && (
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
        {card.price.psa10 && (
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
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('cards');
  const [remoteResults, setRemoteResults] = useState<CatalogCard[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [trendingMovers, setTrendingMovers] = useState<MarketMover[]>([]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  const localCardResults = query.trim().length > 0 ? searchCards(query) : [];
  const cardResults = remoteResults.length > 0 ? remoteResults.map(catalogCardToAppCard) : localCardResults;
  const setResults = query.trim().length > 0
    ? CARD_SETS.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  const isEmpty = query.trim().length === 0;

  // Load trending cards once (used in empty/idle state)
  useEffect(() => {
    getMarketMovers().then(setTrendingMovers).catch(() => {});
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || category !== 'cards') {
      setRemoteResults([]);
      setRemoteError('');
      return;
    }
    const controller = new AbortController();
    setRemoteLoading(true);
    setRemoteError('');
    const timer = setTimeout(() => {
      searchCatalog(trimmed, controller.signal)
        .then(result => setRemoteResults(result.data ?? []))
        .catch(error => {
          if (error?.name !== 'AbortError') {
            setRemoteResults([]);
            setRemoteError('Live catalogue unavailable — showing local results.');
          }
        })
        .finally(() => setRemoteLoading(false));
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, category]);

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
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
            <Pressable onPress={() => setQuery('')}>
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

      <FlatList
        keyboardShouldPersistTaps="handled"
        data={!isEmpty && category === 'cards' ? cardResults : []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: tabH + 24 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View>
            {/* Empty state — trending */}
            {isEmpty && (
              <View>
                <Text style={styles.sectionTitle}>Trending Searches</Text>
                <View style={styles.trendingTags}>
                  {TRENDING_SEARCHES.map(t => (
                    <Pressable
                      key={t}
                      onPress={() => setQuery(t)}
                      style={[styles.trendingTag, { backgroundColor: C.card }]}
                    >
                      <Feather name="trending-up" size={13} color={C.primary} />
                      <Text style={styles.trendingTagText}>{t}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Trending Cards</Text>
                {trendingMovers.map(m => (
                  <CardResultRow
                    key={m.card.id}
                    card={m.card}
                    onPress={() => router.push(`/card/${m.card.id}`)}
                  />
                ))}
              </View>
            )}

            {/* Set results */}
            {!isEmpty && category === 'sets' && (
              <View>
                <Text style={styles.sectionTitle}>Sets ({setResults.length})</Text>
                {setResults.map(s => (
                  <View key={s.id} style={[styles.resultRow, { backgroundColor: C.card }]}>
                    <View style={[styles.setIcon, { backgroundColor: C.muted }]}>
                      <Feather name="package" size={20} color={C.primary} />
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{s.name}</Text>
                      <Text style={styles.resultSet}>
                        {s.series ?? s.tcg} · {s.totalCards} cards
                      </Text>
                      <Text style={styles.resultRarity}>
                        {new Date(s.releaseDate).getFullYear()}
                      </Text>
                    </View>
                  </View>
                ))}
                {setResults.length === 0 && (
                  <Text style={styles.noResults}>No sets found for "{query}"</Text>
                )}
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
                <Text style={styles.sectionTitle}>{remoteLoading ? 'Searching live catalogue…' : `Cards (${cardResults.length})`}</Text>
                {remoteError ? <Text style={styles.liveError}>{remoteError}</Text> : null}
                {!remoteError && remoteResults.length > 0 ? <Text style={styles.liveSource}>Live catalogue and pricing · JustTCG</Text> : null}
              </View>
            )}
          </View>
        )}
        renderItem={({ item }) => {
          // Find the original CatalogCard so the detail page receives the full
          // card data immediately and doesn't need a second API call.
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
        ListEmptyComponent={() =>
          !isEmpty && category === 'cards' ? (
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
  liveError: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#E6A817', marginBottom: 10 },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
  },
});
