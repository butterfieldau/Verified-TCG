import React, { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
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
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GradeBadge, VerificationBadge } from '@/components/ui/Badge';
import { useApp } from '@/context/AppContext';
import { getCardById } from '@/services/cards';
import { MOCK_LISTINGS } from '@/services/listings';
import { getCardPassport } from '@/services/matching';
import colors from '@/constants/colors';
import { RARITY_LABELS } from '@/types';
import type { CollectionItem, WatchlistItem, Card } from '@/types';

const GRADE_OPTIONS = [
  'Raw', 'PSA 8', 'PSA 9', 'PSA 10', 'BGS 9', 'BGS 9.5', 'CGC 9', 'CGC 10',
];

// ─── Inline Wishlist Panel ────────────────────────────────────────────────────

interface WishlistPanelProps {
  card: Card;
  onClose: () => void;
  onAdd: (item: WatchlistItem) => void;
}

function WishlistPanel({ card, onClose, onAdd }: WishlistPanelProps) {
  const [grade, setGrade] = useState('Raw');
  const [targetPriceText, setTargetPriceText] = useState('');

  function handleConfirm() {
    const targetPrice = parseFloat(targetPriceText);
    const item: WatchlistItem = {
      id: `wl-${Date.now()}`,
      cardId: card.id,
      card,
      desiredGrade: grade,
      targetPrice: isNaN(targetPrice) || targetPrice <= 0 ? undefined : targetPrice,
      addedAt: new Date().toISOString().split('T')[0],
      priceAlertEnabled: false,
    };
    onAdd(item);
    onClose();
  }

  const C2 = colors.dark;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={panelStyles.overlay}
    >
      <Pressable style={panelStyles.backdrop} onPress={onClose} />
      <View style={[panelStyles.panel, { backgroundColor: C2.card }]}>
        <View style={panelStyles.handle} />
        <Text style={panelStyles.title}>Add to Wishlist</Text>

        {/* Card preview */}
        <View style={panelStyles.cardRow}>
          <View style={[panelStyles.thumb, { backgroundColor: card.gradientStart }]}>
            <Text style={panelStyles.thumbInitial}>{card.name[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={panelStyles.cardName} numberOfLines={1}>{card.name}</Text>
            <Text style={panelStyles.cardMeta}>{card.setName} · {card.tcg.toUpperCase()}</Text>
            <Text style={panelStyles.cardPrice}>
              Market: ${card.price.raw.toLocaleString('en-AU')} AUD
            </Text>
          </View>
        </View>

        {/* Grade picker */}
        <Text style={panelStyles.label}>Desired Grade</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={panelStyles.gradeRow}>
          {GRADE_OPTIONS.map(g => (
            <Pressable
              key={g}
              onPress={() => setGrade(g)}
              style={[
                panelStyles.gradeChip,
                grade === g
                  ? { backgroundColor: C2.primary }
                  : { backgroundColor: C2.muted },
              ]}
            >
              <Text style={[
                panelStyles.gradeChipText,
                grade === g ? { color: '#FFF' } : { color: C2.mutedForeground },
              ]}>
                {g}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Target price */}
        <Text style={panelStyles.label}>
          Target Price <Text style={panelStyles.optional}>(optional)</Text>
        </Text>
        <View style={[panelStyles.priceRow, { backgroundColor: C2.muted }]}>
          <Text style={panelStyles.currencyPrefix}>$</Text>
          <TextInput
            style={panelStyles.priceInput}
            value={targetPriceText}
            onChangeText={setTargetPriceText}
            placeholder="e.g. 450"
            placeholderTextColor={C2.mutedForeground}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          <Text style={panelStyles.currencySuffix}>AUD</Text>
        </View>

        {/* Actions */}
        <View style={panelStyles.actions}>
          <Pressable
            onPress={onClose}
            style={[panelStyles.cancelBtn, { backgroundColor: C2.muted }]}
          >
            <Text style={[panelStyles.cancelBtnText, { color: C2.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            style={[panelStyles.confirmBtn, { backgroundColor: C2.primary }]}
          >
            <Feather name="heart" size={15} color="#FFF" />
            <Text style={panelStyles.confirmBtnText}>Add to Wishlist</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const panelStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
    gap: 0,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Rajdhani_700Bold',
    color: colors.dark.foreground,
    marginBottom: 16,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  thumb: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbInitial: {
    fontSize: 20, fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.8)',
  },
  cardName: {
    fontSize: 15, fontFamily: 'Inter_600SemiBold',
    color: colors.dark.foreground,
  },
  cardMeta: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    color: colors.dark.mutedForeground, marginTop: 2,
  },
  cardPrice: {
    fontSize: 12, fontFamily: 'Inter_500Medium',
    color: colors.dark.primary, marginTop: 2,
  },
  label: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    color: colors.dark.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 10,
  },
  optional: {
    fontSize: 11, fontFamily: 'Inter_400Regular',
    color: colors.dark.mutedForeground, textTransform: 'none',
  },
  gradeRow: { gap: 8, marginBottom: 20 },
  gradeChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  gradeChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  priceRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, paddingHorizontal: 14, marginBottom: 24, height: 48,
  },
  currencyPrefix: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold',
    color: colors.dark.mutedForeground, marginRight: 4,
  },
  priceInput: {
    flex: 1, fontSize: 16, fontFamily: 'Inter_400Regular',
    color: colors.dark.foreground,
  },
  currencySuffix: {
    fontSize: 13, fontFamily: 'Inter_500Medium',
    color: colors.dark.mutedForeground,
  },
  actions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  confirmBtn: {
    flex: 2, height: 50, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  confirmBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
});

const C = colors.dark;
const { width: W } = Dimensions.get('window');

/** Card aspect ratio: 2.5 wide × 3.5 tall */
const CARD_W = W - 40;
const CARD_H = CARD_W * (3.5 / 2.5);

const MIN_SCALE = 1;
const MAX_SCALE = 4;

type PriceTab = 'Raw' | 'PSA 9' | 'PSA 10' | 'CGC 10' | 'BGS 9.5';

const PRICE_TABS: PriceTab[] = ['Raw', 'PSA 9', 'PSA 10', 'CGC 10', 'BGS 9.5'];

function getTabPrice(card: any, tab: PriceTab): number | undefined {
  switch (tab) {
    case 'Raw': return card.price.raw;
    case 'PSA 9': return card.price.psa9;
    case 'PSA 10': return card.price.psa10;
    case 'CGC 10': return card.price.cgc10;
    case 'BGS 9.5': return card.price.bgs95;
    default: return card.price.raw;
  }
}

// ─── Zoomable card image ──────────────────────────────────────────────────────

interface ZoomableCardImageProps {
  imageUrl: string;
  gradientStart: string;
  gradientEnd: string;
}

function ZoomableCardImage({ imageUrl, gradientStart, gradientEnd }: ZoomableCardImageProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < MIN_SCALE) {
        scale.value = withSpring(MIN_SCALE);
        savedScale.value = MIN_SCALE;
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinchGesture, doubleTapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const showImage = !imageError;

  return (
    <View style={imgStyles.container}>
      {/* Gradient fallback always behind image */}
      <LinearGradient
        colors={[gradientStart, gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {showImage ? (
        <GestureDetector gesture={composed}>
          <Animated.View style={[imgStyles.imageWrap, animatedStyle]}>
            <Image
              source={{ uri: imageUrl }}
              style={imgStyles.image}
              resizeMode="contain"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            {!imageLoaded && (
              <View style={imgStyles.spinner}>
                <ActivityIndicator size="large" color="rgba(255,255,255,0.6)" />
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      ) : (
        // Fallback: gradient + card initial (image failed)
        <View style={imgStyles.fallbackContent}>
          <Text style={imgStyles.fallbackHint}>No image available</Text>
        </View>
      )}

      {/* Zoom hint shown only while image is usable and loaded */}
      {showImage && imageLoaded && (
        <View style={imgStyles.zoomHint}>
          <Feather name="zoom-in" size={11} color="rgba(255,255,255,0.55)" />
          <Text style={imgStyles.zoomHintText}>Pinch or double-tap to zoom</Text>
        </View>
      )}
    </View>
  );
}

// ─── Gradient-only fallback (no imageUrl at all) ─────────────────────────────

interface CardArtFallbackProps {
  cardName: string;
  cardNumber: string;
  gradientStart: string;
  gradientEnd: string;
  verificationStatus?: string;
}

function CardArtFallback({ cardName, cardNumber, gradientStart, gradientEnd, verificationStatus }: CardArtFallbackProps) {
  return (
    <View style={imgStyles.container}>
      <LinearGradient
        colors={[gradientStart, gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.12)', 'transparent']}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={imgStyles.cardNumberBadge}>
        <Text style={imgStyles.cardNumberText}>{cardNumber}</Text>
      </View>
      {verificationStatus === 'verified' && (
        <View style={imgStyles.verifiedOverlay}>
          <VerificationBadge status="verified" />
        </View>
      )}
      <Text style={imgStyles.cardInitialLarge}>{cardName[0]}</Text>
      <Text style={imgStyles.cardNameFallback} numberOfLines={2}>{cardName}</Text>
    </View>
  );
}

const imgStyles = StyleSheet.create({
  container: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 20,
  },
  imageWrap: {
    width: CARD_W,
    height: CARD_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: CARD_W,
    height: CARD_H,
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
  },
  zoomHint: {
    position: 'absolute',
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  zoomHintText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.55)',
  },
  cardNumberBadge: {
    position: 'absolute',
    top: 14,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  cardNumberText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.75)',
  },
  verifiedOverlay: {
    position: 'absolute',
    top: 10,
    right: 12,
  },
  cardInitialLarge: {
    fontSize: 120,
    fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.2)',
  },
  cardNameFallback: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    fontSize: 22,
    fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

// ─── Page indicator ───────────────────────────────────────────────────────────

const MAX_DOTS = 7;

interface PageIndicatorProps {
  total: number;
  current: number;
}

function PageIndicator({ total, current }: PageIndicatorProps) {
  if (total <= 1) return null;

  // Show at most MAX_DOTS dots, centred on the current index
  const half = Math.floor(MAX_DOTS / 2);
  let start = Math.max(0, current - half);
  const end = Math.min(total - 1, start + MAX_DOTS - 1);
  start = Math.max(0, end - MAX_DOTS + 1);

  const dots: number[] = [];
  for (let i = start; i <= end; i++) dots.push(i);

  return (
    <View style={dotStyles.row}>
      {dots.map(i => (
        <View
          key={i}
          style={[
            dotStyles.dot,
            i === current
              ? dotStyles.dotActive
              : dotStyles.dotInactive,
            // smaller dots near the edges when window is shifted
            (i === start && start > 0) || (i === end && end < total - 1)
              ? dotStyles.dotEdge
              : null,
          ]}
        />
      ))}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 4,
  },
  dot: {
    borderRadius: 99,
  },
  dotActive: {
    width: 20,
    height: 5,
    backgroundColor: C.primary,
  },
  dotInactive: {
    width: 5,
    height: 5,
    backgroundColor: C.border,
  },
  dotEdge: {
    width: 4,
    height: 4,
    opacity: 0.5,
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { addToCollection, addToWatchlist, watchlist, collection } = useApp();
  const [priceTab, setPriceTab] = useState<PriceTab>('Raw');
  const [localInCollection, setLocalInCollection] = useState(false);
  const [localInWatchlist, setLocalInWatchlist] = useState(false);
  const [showAddedBanner, setShowAddedBanner] = useState(false);
  const [showWishlistAddedBanner, setShowWishlistAddedBanner] = useState(false);
  const [showWishlistPanel, setShowWishlistPanel] = useState(false);

  const [card, setCard] = useState(
    () => getCardById(id ?? '') ?? getCardById('charizard-ex-ob')!,
  );
  const cardListings = MOCK_LISTINGS.filter(l => l.card.id === card.id);
  const allListings = cardListings.length > 0 ? cardListings : MOCK_LISTINGS.slice(0, 2);
  const hasPassport = getCardPassport(card.id) !== null;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  // ── Swipe navigation between collection cards ──────────────────────────────
  // Swiping updates card state in-place — no navigation, so back always works.
  const collectionCards = collection.map(item => item.card);
  const currentIndex = collectionCards.findIndex(c => c.id === card.id);
  const prevCardId = currentIndex > 0 ? collectionCards[currentIndex - 1].id : null;
  const nextCardId = currentIndex < collectionCards.length - 1 ? collectionCards[currentIndex + 1].id : null;
  const inCollection = currentIndex !== -1;

  const translateX = useSharedValue(0);

  function switchCard(newCardId: string, fromRight: boolean) {
    const newCard = getCardById(newCardId);
    if (!newCard) return;
    setCard(newCard);
    setPriceTab('Raw');
    setLocalInCollection(false);
    setLocalInWatchlist(false);
    setShowAddedBanner(false);
    setShowWishlistAddedBanner(false);
    setShowWishlistPanel(false);
    // Snap to opposite edge then animate to centre — seamless slide-in
    translateX.value = fromRight ? W : -W;
    translateX.value = withSpring(0, { damping: 20 });
  }

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      if ((e.translationX > 0 && prevCardId) || (e.translationX < 0 && nextCardId)) {
        translateX.value = e.translationX * 0.6; // slight resistance
      }
    })
    .onEnd((e) => {
      const THRESHOLD = 80;
      if (e.translationX > THRESHOLD && prevCardId) {
        translateX.value = withSpring(W, { damping: 20 }, () => {
          runOnJS(switchCard)(prevCardId, false);
        });
      } else if (e.translationX < -THRESHOLD && nextCardId) {
        translateX.value = withSpring(-W, { damping: 20 }, () => {
          runOnJS(switchCard)(nextCardId, true);
        });
      } else {
        translateX.value = withSpring(0, { damping: 20 });
      }
    });

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const activePrice = getTabPrice(card, priceTab);

  const isOwned = localInCollection || collection.some(i => i.cardId === card.id);
  const isWatched = localInWatchlist || watchlist.some(w => w.cardId === card.id);

  function handleAddToCollection() {
    const newItem: CollectionItem = {
      id: `col-${Date.now()}`,
      cardId: card.id,
      card,
      quantity: 1,
      condition: 'near_mint',
      acquiredAt: new Date().toISOString().split('T')[0],
      acquiredPrice: card.price.raw,
      currency: 'AUD',
    };
    addToCollection(newItem);
    setLocalInCollection(true);
    setShowAddedBanner(true);
    setTimeout(() => setShowAddedBanner(false), 2500);
  }

  function handleWishlistToggle() {
    if (isWatched) {
      // Already on wishlist — navigate there
      router.push('/wishlist' as any);
    } else {
      // Open inline grade/price prompt
      setShowWishlistPanel(true);
    }
  }

  function handleWishlistAdd(item: WatchlistItem) {
    addToWatchlist(item);
    setLocalInWatchlist(true);
    setShowWishlistAddedBanner(true);
    setTimeout(() => setShowWishlistAddedBanner(false), 2500);
  }

  const gain24h = card.price.change24h;
  const gain7d = card.price.change7d;

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: C.background }, slideStyle]}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: tabH + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Nav */}
        <View style={styles.nav}>
          <Pressable onPress={() => router.back()} style={styles.navBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <View style={styles.navRight}>
            <Pressable
              onPress={handleWishlistToggle}
              style={[styles.navBtn, isWatched && { backgroundColor: `${C.primary}22` }]}
            >
              <Feather name="heart" size={20} color={isWatched ? C.primary : C.foreground} />
            </Pressable>
            <Pressable style={styles.navBtn}>
              <Feather name="share-2" size={20} color={C.foreground} />
            </Pressable>
          </View>
        </View>

        {/* Card artwork — swipe left/right here to move between collection cards */}
        <GestureDetector gesture={panGesture}>
          <View style={styles.cardStage}>
            {card.imageUrl ? (
              <ZoomableCardImage
                imageUrl={card.imageUrl}
                gradientStart={card.gradientStart}
                gradientEnd={card.gradientEnd}
              />
            ) : (
              <CardArtFallback
                cardName={card.name}
                cardNumber={card.number}
                gradientStart={card.gradientStart}
                gradientEnd={card.gradientEnd}
                verificationStatus={card.verificationStatus}
              />
            )}

            {/* Swipe edge hints — only when prev/next exists */}
            {prevCardId && (
              <View style={[styles.swipeHint, styles.swipeHintLeft]}>
                <Feather name="chevron-left" size={18} color="rgba(255,255,255,0.5)" />
              </View>
            )}
            {nextCardId && (
              <View style={[styles.swipeHint, styles.swipeHintRight]}>
                <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.5)" />
              </View>
            )}
          </View>
        </GestureDetector>

        {/* Page indicator — only when card is in collection */}
        {inCollection && (
          <PageIndicator total={collectionCards.length} current={currentIndex} />
        )}

        {/* Title block */}
        <View style={styles.titleBlock}>
          <Text style={styles.cardName}>{card.name}</Text>
          <Text style={styles.cardMeta}>{card.setName} · {card.number}</Text>
          <View style={styles.tagRow}>
            <View style={[styles.tag, { backgroundColor: C.muted }]}>
              <Text style={styles.tagText}>{RARITY_LABELS[card.rarity]}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: C.muted }]}>
              <Text style={styles.tagText}>{card.year}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: C.muted }]}>
              <Text style={styles.tagText}>
                {card.tcg === 'pokemon' ? 'Pokémon' : card.tcg === 'magic' ? 'MTG' : 'One Piece'}
              </Text>
            </View>
          </View>
        </View>

        {/* Condition/grade price tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.priceTabs}
          contentContainerStyle={styles.priceTabsContent}
        >
          {PRICE_TABS.map(t => {
            const price = getTabPrice(card, t);
            if (!price) return null;
            return (
              <Pressable
                key={t}
                onPress={() => setPriceTab(t)}
                style={[
                  styles.priceTab,
                  priceTab === t && { borderColor: C.primary, backgroundColor: `${C.primary}18` },
                ]}
              >
                <Text style={[styles.priceTabLabel, priceTab === t && { color: C.primary }]}>{t}</Text>
                <Text style={[styles.priceTabValue, priceTab === t && { color: C.foreground }]}>
                  ${price.toLocaleString('en-AU')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Market value card */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          <View style={styles.marketHeader}>
            <View>
              <Text style={styles.marketLabel}>Market Value</Text>
              <Text style={styles.marketValue}>
                ${activePrice?.toLocaleString('en-AU', { minimumFractionDigits: 2 }) ?? '—'} AUD
              </Text>
            </View>
            <View style={styles.changeCol}>
              {gain24h !== undefined && (
                <Text style={[styles.changeBadge, { color: gain24h >= 0 ? C.positive : C.negative }]}>
                  {gain24h >= 0 ? '+' : ''}{gain24h.toFixed(1)}% 24h
                </Text>
              )}
              {gain7d !== undefined && (
                <Text style={[styles.changeBadge, { color: gain7d >= 0 ? C.positive : C.negative }]}>
                  {gain7d >= 0 ? '+' : ''}{gain7d.toFixed(1)}% 7d
                </Text>
              )}
            </View>
          </View>

          {/* Bar chart */}
          <View style={styles.chartWrap}>
            <View style={styles.chartLine}>
              {Array.from({ length: 20 }, (_, i) => {
                const noise = Math.sin(i * 0.8 + 1.5) * 0.3 + Math.sin(i * 0.3) * 0.5 + i / 20;
                const h = Math.max(12 + noise * 30, 4);
                return (
                  <View
                    key={i}
                    style={[
                      styles.chartBar,
                      {
                        height: h,
                        backgroundColor: (gain7d ?? 0) >= 0 ? `${C.positive}99` : `${C.negative}99`,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Raw</Text>
              <Text style={styles.statValue}>${card.price.raw.toLocaleString()}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>PSA 10</Text>
              <Text style={styles.statValue}>
                {card.price.psa10 ? `$${card.price.psa10.toLocaleString()}` : '—'}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>30d Change</Text>
              <Text style={[
                styles.statValue,
                { color: (card.price.change30d ?? 0) >= 0 ? C.positive : C.negative },
              ]}>
                {card.price.change30d !== undefined
                  ? `${card.price.change30d >= 0 ? '+' : ''}${card.price.change30d.toFixed(1)}%`
                  : '—'}
              </Text>
            </View>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            onPress={handleAddToCollection}
            style={[styles.primaryBtn, isOwned && { backgroundColor: C.muted }]}
            disabled={isOwned}
          >
            <Feather name={isOwned ? 'check' : 'plus'} size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>{isOwned ? 'In Collection' : 'Add to Collection'}</Text>
          </Pressable>
          <Pressable
            onPress={handleWishlistToggle}
            style={[
              styles.wishlistBtn,
              isWatched
                ? { backgroundColor: `${C.primary}22`, borderColor: C.primary }
                : { backgroundColor: C.card, borderColor: C.border },
            ]}
          >
            <Feather
              name="heart"
              size={16}
              color={isWatched ? C.primary : C.foreground}
            />
            <Text style={[styles.wishlistBtnText, isWatched && { color: C.primary }]}>
              {isWatched ? 'On Wishlist' : 'Wishlist'}
            </Text>
          </Pressable>
        </View>

        {/* Card Passport link — only for cards with a graded passport record */}
        {hasPassport && <Pressable
          onPress={() => router.push(`/card-passport/${card.id}` as any)}
          style={[styles.passportBanner, { backgroundColor: '#D4AF3722', borderColor: '#D4AF3744' }]}
        >
          <View style={[styles.passportIcon, { backgroundColor: '#D4AF3722' }]}>
            <Feather name="book-open" size={14} color="#D4AF37" />
          </View>
          <View style={styles.passportInfo}>
            <Text style={[styles.passportTitle, { color: '#D4AF37' }]}>Card Passport</Text>
            <Text style={styles.passportSub}>Ownership history, grading record & provenance</Text>
          </View>
          <Feather name="chevron-right" size={16} color="#D4AF37" />
        </Pressable>}

        {/* For Sale listings */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Cards For Sale</Text>
            <Text style={styles.sectionCount}>{allListings.length} listing{allListings.length !== 1 ? 's' : ''}</Text>
          </View>
          {allListings.map(listing => (
            <Pressable key={listing.id} style={[styles.listingRow, { backgroundColor: C.card }]}>
              <View style={styles.listingLeft}>
                <Text style={styles.listingSellerName}>{listing.sellerName}</Text>
                <View style={styles.listingMeta}>
                  {listing.grading && (
                    <GradeBadge grade={listing.grading.grade} company={listing.grading.company} size="sm" />
                  )}
                  {listing.isVerifiedSeller && (
                    <View style={styles.verifiedTag}>
                      <Feather name="shield" size={11} color={C.positive} />
                      <Text style={[styles.verifiedTagText, { color: C.positive }]}>Verified</Text>
                    </View>
                  )}
                  {listing.sellerRating && (
                    <View style={styles.ratingRow}>
                      <Feather name="star" size={11} color="#F59E0B" />
                      <Text style={styles.ratingText}>{listing.sellerRating.toFixed(1)}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.listingWatchers}>
                  {listing.watchCount} watching · {listing.views} views
                </Text>
              </View>
              <View style={styles.listingRight}>
                <Text style={styles.listingPrice}>${listing.askingPrice.toLocaleString('en-AU')}</Text>
                <Text style={styles.listingCurrency}>AUD</Text>
                <Pressable style={styles.buyBtn}>
                  <Text style={styles.buyBtnText}>Buy</Text>
                </Pressable>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Added to collection banner */}
      {showAddedBanner && (
        <View style={styles.banner}>
          <Feather name="check-circle" size={16} color={C.positive} />
          <Text style={styles.bannerText}>Added to collection!</Text>
        </View>
      )}

      {/* Added to wishlist banner */}
      {showWishlistAddedBanner && (
        <View style={[styles.banner, { bottom: 140 }]}>
          <Feather name="heart" size={16} color={C.primary} />
          <Text style={styles.bannerText}>Added to wishlist!</Text>
        </View>
      )}

      {/* Wishlist grade/price panel */}
      {showWishlistPanel && (
        <WishlistPanel
          card={card}
          onClose={() => setShowWishlistPanel(false)}
          onAdd={handleWishlistAdd}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 20 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  navRight: { flexDirection: 'row', gap: 8 },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardStage: {
    alignItems: 'center',
    marginBottom: 8,
    position: 'relative',
  },
  swipeHint: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 16,
  },
  swipeHintLeft: { left: -8 },
  swipeHintRight: { right: -8 },
  titleBlock: { marginBottom: 20 },
  cardName: {
    fontSize: 26,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
  },
  cardMeta: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 2,
    marginBottom: 10,
  },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  priceTabs: { marginBottom: 20 },
  priceTabsContent: { gap: 8, paddingRight: 4 },
  priceTab: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: 'center',
    minWidth: 80,
  },
  priceTabLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    marginBottom: 3,
  },
  priceTabValue: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
  },
  card: { borderRadius: 16, padding: 18, marginBottom: 16 },
  marketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  marketLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  marketValue: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    letterSpacing: -0.5,
  },
  changeCol: { alignItems: 'flex-end', gap: 4 },
  changeBadge: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  chartWrap: { height: 52, marginVertical: 16 },
  chartLine: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  chartBar: { flex: 1, borderRadius: 2, minHeight: 4 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center' },
  statLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  statValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.primary,
  },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  wishlistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  wishlistBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  sectionCount: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingRow: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listingLeft: { flex: 1, gap: 5 },
  listingSellerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listingMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  verifiedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedTagText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  listingWatchers: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listingRight: { alignItems: 'flex-end', gap: 4 },
  listingPrice: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  listingCurrency: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  buyBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
  },
  buyBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  passportBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 20,
  },
  passportIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  passportInfo: { flex: 1 },
  passportTitle: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  passportSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  banner: {
    position: 'absolute',
    bottom: 100,
    left: 40,
    right: 40,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  bannerText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
