import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GradeBadge } from '@/components/ui/Badge';
import { CardImage } from '@/components/ui/CardImage';
import { useApp } from '@/context/AppContext';
import { fetchCatalogCard, catalogCardToAppCard, recordCatalogCardLookup } from '@/services/catalogApi';
import colors from '@/constants/colors';
import { RARITY_LABELS } from '@/types';
import type { Card, WatchlistItem } from '@/types';
import { canViewAdvancedPricing } from '@/services/subscription';
import VerifiedPricingCard, { type VerifiedPricingSummary } from '@/components/ui/VerifiedPricingCard';
import CollectionHoldingsPanel from '@/components/ui/CollectionHoldingsPanel';
import { useSettings } from '@/context/SettingsContext';
import { triggerPriceSnapshot } from '@/services/priceHistory';

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
      <Pressable
        style={panelStyles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />
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
                  ? { backgroundColor: '#CC1826' }
                  : { backgroundColor: C2.muted },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Grade ${g}`}
              accessibilityState={{ selected: grade === g }}
              hitSlop={{ top: 4, bottom: 4 }}
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
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[panelStyles.cancelBtnText, { color: C2.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            style={[panelStyles.confirmBtn, { backgroundColor: '#CC1826' }]}
            accessibilityRole="button"
            accessibilityLabel="Add to Wishlist"
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


/** Passport hero card matches the approved 170 × 238 portrait treatment. */
const CARD_W = Math.min(W - 48, 170);
const CARD_H = CARD_W * (3.5 / 2.5);

const MIN_SCALE = 1;
const MAX_SCALE = 4;

type DetailMode = 'Raw' | 'Graded' | 'POP';

// ─── Zoomable card image ──────────────────────────────────────────────────────

interface ZoomableCardImageProps {
  imageUrl: string;
  gradientStart: string;
  gradientEnd: string;
  cardName: string;
  cardNumber: string;
}

function ZoomableCardImage({ imageUrl, gradientStart, gradientEnd, cardName, cardNumber }: ZoomableCardImageProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Helper: clamp translation to the valid bounds for the current scale
  function clampTranslation(tx: number, ty: number, s: number): { x: number; y: number } {
    'worklet';
    const maxX = Math.max(0, (s * CARD_W - CARD_W) / 2);
    const maxY = Math.max(0, (s * CARD_H - CARD_H) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, tx)),
      y: Math.min(maxY, Math.max(-maxY, ty)),
    };
  }

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      const finalScale = scale.value;
      savedScale.value = finalScale;
      if (finalScale <= MIN_SCALE) {
        // Fully zoomed out — snap back to center
        scale.value = withSpring(MIN_SCALE);
        savedScale.value = MIN_SCALE;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Reclamp existing translation to the new (smaller/larger) scale bounds
        const clamped = clampTranslation(translateX.value, translateY.value, finalScale);
        translateX.value = withSpring(clamped.x);
        translateY.value = withSpring(clamped.y);
        savedTranslateX.value = clamped.x;
        savedTranslateY.value = clamped.y;
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  // Pan is gated: only activates when the image is zoomed in (scale > 1).
  // At scale 1 the gesture fails immediately so outer card-navigation swipes are unaffected.
  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (scale.value > 1) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onUpdate((e) => {
      // Clamp continuously so the background never peeks through during a drag
      const clamped = clampTranslation(
        savedTranslateX.value + e.translationX,
        savedTranslateY.value + e.translationY,
        scale.value,
      );
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      // Persist the already-clamped position
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composed = Gesture.Simultaneous(pinchGesture, doubleTapGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const showImage = !imageError;

  return (
    <View style={imgStyles.container}>
      {/* Gradient background — always rendered as fallback layer */}
      <LinearGradient
        colors={[gradientStart, gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
      />

      {/* Shimmer highlight over gradient — visible while loading or on error */}
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.14)', 'transparent']}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 18 }]}
      />

      {showImage ? (
        <GestureDetector gesture={composed}>
          <Animated.View style={[imgStyles.imageWrap, animatedStyle]}>
            <CardImage
              uri={imageUrl}
              resizeWidth={1000}
              style={imgStyles.image}
              contentFit="contain"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          </Animated.View>
        </GestureDetector>
      ) : (
        // Fallback: gradient + card name/number (image failed)
        <>
          <View style={imgStyles.cardNumberBadge}>
            <Text style={imgStyles.cardNumberText}>{cardNumber}</Text>
          </View>
          <Text style={imgStyles.cardInitialLarge}>{cardName[0]}</Text>
          <Text style={imgStyles.cardNameFallback} numberOfLines={2}>{cardName}</Text>
        </>
      )}

      {/* Card name/number overlay while image is still loading */}
      {showImage && !imageLoaded && !imageError && (
        <>
          <View style={imgStyles.cardNumberBadge}>
            <Text style={imgStyles.cardNumberText}>{cardNumber}</Text>
          </View>
          <Text style={imgStyles.cardInitialLarge}>{cardName[0]}</Text>
          <Text style={imgStyles.cardNameFallback} numberOfLines={2}>{cardName}</Text>
        </>
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
}

function CardArtFallback({ cardName, cardNumber, gradientStart, gradientEnd }: CardArtFallbackProps) {
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
      <Text style={imgStyles.cardInitialLarge}>{cardName[0]}</Text>
      <Text style={imgStyles.cardNameFallback} numberOfLines={2}>{cardName}</Text>
    </View>
  );
}

const imgStyles = StyleSheet.create({
  container: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 14,
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
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 14,
  },
  spinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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

export default function CardDetailScreen() {
  const { id, cardIds, catalogJson, appCardJson } = useLocalSearchParams<{ id: string; cardIds?: string; catalogJson?: string; appCardJson?: string }>();
  const insets = useSafeAreaInsets();
  const { addToWatchlist, watchlist, collection, subscriptionTier, refreshCollection } = useApp();
  const { currency: displayCurrency } = useSettings();
  const [detailMode, setDetailMode] = useState<DetailMode>('Raw');
  const modeTabIndex: Record<DetailMode, number> = { Raw: 0, Graded: 1, POP: 2 };
  const modeIndicatorX = useSharedValue(0);
  const modeTabWidth = useSharedValue(0);
  const [marketSummary, setMarketSummary] = useState<VerifiedPricingSummary | null>(null);
  const syncedMarketSummaryRef = useRef<string | null>(null);
  const handleRawMarketSummaryChange = useCallback((summary: VerifiedPricingSummary | null) => {
    setMarketSummary(summary);
    if (!summary || !id) return;
    const signature = `${id}:${summary.currency}:${summary.price}`;
    if (syncedMarketSummaryRef.current === signature) return;
    syncedMarketSummaryRef.current = signature;
    // The passport pricing request may have just persisted the card's first
    // verified quote. Reload canonical holding valuations so Home, Collection,
    // and the collapsed passport summary show the same price immediately.
    void refreshCollection();
  }, [id, refreshCollection]);
  const [localInCollection, setLocalInCollection] = useState(false);
  const [localInWatchlist, setLocalInWatchlist] = useState(false);
  const [showAddedBanner, setShowAddedBanner] = useState(false);
  const [showCardActions, setShowCardActions] = useState(false);
  const [showWishlistAddedBanner, setShowWishlistAddedBanner] = useState(false);
  const [showWishlistPanel, setShowWishlistPanel] = useState(false);
  const [priceChartGestureActive, setPriceChartGestureActive] = useState(false);
  const handlePriceChartInteractionStart = useCallback(() => {
    setPriceChartGestureActive(true);
  }, []);
  const handlePriceChartInteractionEnd = useCallback(() => {
    setPriceChartGestureActive(false);
  }, []);

  // Catalog API fetch state. Navigation may include an API-shaped card for a
  // fast first paint, but the app never resolves a release card from fixtures.
  // Two inline param strategies:
  //   catalogJson  — raw CatalogCard JSON (from search results)
  //   appCardJson  — already-converted Card JSON (from home/market screen taps)
  // Either bypasses the loading state and avoids a round-trip to the API.
  const [catalogCard, setCatalogCard] = useState<Card | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);

  const hasAdvancedPricing = canViewAdvancedPricing(subscriptionTier);

  // ── Swipe-between-cards state ────────────────────────────────────────────
  // cardIds is a comma-separated list of card IDs from the filtered/sorted
  // collection view. When present, swiping navigates only within that subset.
  const swipeIds = cardIds ? (cardIds as string).split(',').filter(Boolean) : [];
  const currentIndex = swipeIds.length > 0 ? swipeIds.indexOf(id ?? '') : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < swipeIds.length - 1;
  const cardIdsParam = cardIds as string | undefined;

  // ── Swipe hint state ─────────────────────────────────────────────────────
  const SWIPE_HINT_KEY = 'swipe_hint_seen_v1';
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const hintOpacity = useSharedValue(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function dismissHint() {
    hintOpacity.value = withTiming(0, { duration: 300 });
    setTimeout(() => setShowSwipeHint(false), 320);
    AsyncStorage.setItem(SWIPE_HINT_KEY, '1').catch(() => {});
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
  }

  // Fetch cards from the Verified TCG catalogue when navigation did not include
  // an API result (for example, a persisted collection or wishlist card ID).
  useEffect(() => {
    if (!id) { setCatalogLoading(false); setCatalogError(true); return; }
    setCatalogError(false);
    let inlineCard: Card | null = null;
    if (appCardJson) {
      try {
        const parsed = JSON.parse(appCardJson as string) as Card;
        if (parsed.id === id && parsed.name) inlineCard = parsed;
      } catch { /* fetch authoritative catalogue data below */ }
    }
    if (!inlineCard && catalogJson) {
      try {
        const parsed = JSON.parse(catalogJson as string) as import('@/services/catalogApi').CatalogCard;
        if (parsed.id === id && parsed.name) inlineCard = catalogCardToAppCard(parsed);
      } catch { /* fetch authoritative catalogue data below */ }
    }
    if (inlineCard) {
      setCatalogCard(inlineCard);
      setCatalogLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setCatalogCard(null);
    setCatalogLoading(true);
    fetchCatalogCard(id, controller.signal, displayCurrency)
      .then((data) => {
        if (cancelled) return;
        if (data) setCatalogCard(catalogCardToAppCard(data));
        else setCatalogError(true);
      })
      .catch((err: unknown) => {
        if (!cancelled && (err as Error)?.name !== 'AbortError') setCatalogError(true);
      })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [id, catalogJson, appCardJson, displayCurrency]);

  useEffect(() => {
    if (!id) return;
    recordCatalogCardLookup(id).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (swipeIds.length <= 1) return;
    AsyncStorage.getItem(SWIPE_HINT_KEY).then((val) => {
      if (!val) {
        setShowSwipeHint(true);
        hintOpacity.value = withTiming(1, { duration: 400 });
        hintTimerRef.current = setTimeout(() => dismissHint(), 3000);
      }
    }).catch(() => {});
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A detail view is a natural, low-frequency opportunity to retain truthful
  // completed-sale medians for its chart. The API records nothing when eBay
  // is unavailable or no supported raw/grade evidence exists.
  useEffect(() => {
    const resolvedCard = catalogCard;
    if (!resolvedCard) return;
    void triggerPriceSnapshot(
      resolvedCard.id,
      resolvedCard.name,
      resolvedCard.setName,
      resolvedCard.tcg,
      resolvedCard.number,
    );
  }, [id, catalogCard?.id]);

  const hintAnimStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));
  const modeIndicatorStyle = useAnimatedStyle(() => ({
    width: modeTabWidth.value,
    transform: [{ translateX: modeIndicatorX.value }],
  }));

  function goToPrev() {
    if (!hasPrev) return;
    router.replace(`/card/${swipeIds[currentIndex - 1]}?cardIds=${cardIdsParam}` as any);
  }

  function goToNext() {
    if (!hasNext) return;
    router.replace(`/card/${swipeIds[currentIndex + 1]}?cardIds=${cardIdsParam}` as any);
  }

  // Horizontal pan gesture for swipe-to-navigate (doesn't interfere with the
  // vertical ScrollView since we fail on primarily-vertical movement)
  const swipeGesture = Gesture.Pan()
    .enabled(!priceChartGestureActive)
    .activeOffsetX([-25, 25])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      if (e.translationX < -60 && Math.abs(e.translationX) > Math.abs(e.translationY)) {
        runOnJS(dismissHint)();
        runOnJS(goToNext)();
      } else if (e.translationX > 60 && Math.abs(e.translationX) > Math.abs(e.translationY)) {
        runOnJS(dismissHint)();
        runOnJS(goToPrev)();
      }
    });

  // Resolve cards from the API result. Use a separate rawCard for the null-guard so TypeScript narrows 'card' to
  // type Card after the guards — closures below then capture Card, not Card|null.
  const rawCard = catalogCard;

  // ── Loading / error guards (all hooks already called above) ──────────────
  if (!rawCard && catalogLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={{ color: C.mutedForeground, marginTop: 14, fontFamily: 'Inter_400Regular', fontSize: 14 }}>
          Loading card…
        </Text>
      </View>
    );
  }
  if (!rawCard) {
    return (
      <View style={{ flex: 1, backgroundColor: C.background, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Feather name="alert-circle" size={44} color={C.mutedForeground} />
        <Text style={{ color: C.foreground, marginTop: 16, fontFamily: 'Inter_700Bold', fontSize: 18 }}>Card not found</Text>
        <Text style={{ color: C.mutedForeground, marginTop: 8, fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' }}>
          This card couldn't be loaded. Try searching again.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{ marginTop: 24, backgroundColor: '#CC1826', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, minHeight: 44, justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={{ color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 15 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // rawCard is narrowed to Card here; closures below capture Card (not Card|null)
  const card = rawCard;

  // Every card can have a live Passport holdings record. The Passport screen
  // owns the same collection-backed controls as this detail screen.
  const hasPassport = true;

  const topPad = Platform.OS === 'web' ? 0 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  const isOwned = localInCollection || collection.some(i => i.cardId === card.id);
  const isWatched = localInWatchlist || watchlist.some(w => w.cardId === card.id);
  const ownedItems = collection.filter(item => item.cardId === card.id);
  const ownedQuantity = ownedItems.reduce((sum, item) => sum + item.quantity, 0);
  const populationRecords = ownedItems.filter(item => item.grading?.population != null);
  const topMarketSummary = marketSummary ?? (
    card.price.available
      ? { label: 'Raw / Ungraded', price: card.price.raw, currency: card.price.currency }
      : null
  );

  function selectDetailMode(mode: DetailMode) {
    setDetailMode(mode);
    modeIndicatorX.value = withTiming(
      modeTabIndex[mode] * modeTabWidth.value,
      {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      },
    );
  }

  function handleModeTabsLayout(width: number) {
    const itemWidth = Math.max((width - 8) / 3, 0);
    modeTabWidth.value = itemWidth;
    modeIndicatorX.value = modeTabIndex[detailMode] * itemWidth;
  }

  function handleAddToCollection() {
    // Acquisition cost is collector-entered data. Never silently use the
    // current market quote as historical cost basis.
    router.push({
      pathname: '/add-card',
      params: { cardJson: JSON.stringify(card) },
    });
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

  // Dot indicator helpers
  const showDots = swipeIds.length > 1;
  const useDots = showDots && swipeIds.length <= 20;

  return (
    <GestureDetector gesture={swipeGesture}>
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: tabH + 24 }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!priceChartGestureActive}
      >
        {/* Nav */}
        <View style={styles.nav}>
          <Pressable
            onPress={() => router.back()}
            style={styles.navBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={2}
          >
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <View style={styles.navContext}>
            <Text style={styles.navKicker}>CARD PASSPORT</Text>
            <View style={styles.navDot} />
            <Text style={styles.navVerified}>VERIFIED</Text>
          </View>
          <View style={styles.navRight}>
            <Pressable
              style={styles.navBtn}
              onPress={() => {
                const url = `https://verifiedtcg.co/cards/${card.id}`;
                Share.share({
                  title: `${card.name} — Verified TCG`,
                  message: `Check out ${card.name} on Verified TCG!\n${card.setName} · ${card.number}\nMarket: ${card.price.available ? `${card.price.currency} ${card.price.raw.toLocaleString('en-AU')}` : 'Unavailable'}\n${url}`,
                  url,
                }).catch(() => {});
              }}
              accessibilityRole="button"
              accessibilityLabel="Share this card"
              hitSlop={2}
            >
              <Feather name="share-2" size={17} color={C.foreground} />
            </Pressable>
            <Pressable
              style={styles.navBtn}
              onPress={() => setShowCardActions(previous => !previous)}
              accessibilityRole="button"
              accessibilityLabel="More card actions"
              accessibilityState={{ expanded: showCardActions }}
              hitSlop={2}
            >
              <Feather name="more-horizontal" size={18} color={C.foreground} />
            </Pressable>
          </View>
        </View>

        {showCardActions && (
          <View style={styles.cardActionsMenu}>
            <Pressable
              onPress={() => {
                setShowCardActions(false);
                void handleWishlistToggle();
              }}
              style={styles.cardActionsMenuItem}
              accessibilityRole="button"
            >
              <Feather name={isWatched ? 'list' : 'bookmark'} size={16} color={C.foreground} />
              <Text style={styles.cardActionsMenuText}>
                {isWatched ? 'Open Wishlist' : 'Add to Wishlist'}
              </Text>
            </Pressable>
            <View style={styles.cardActionsMenuDivider} />
            <Pressable
              onPress={() => {
                setShowCardActions(false);
                router.push({
                  pathname: '/contact-support',
                  params: {
                    subject: `Card data issue: ${card.name}`,
                    cardId: card.id,
                  },
                } as any);
              }}
              style={styles.cardActionsMenuItem}
              accessibilityRole="button"
            >
              <Feather name="flag" size={16} color={C.foreground} />
              <Text style={styles.cardActionsMenuText}>Report a data issue</Text>
            </Pressable>
          </View>
        )}

        {/* Card artwork + swipe navigation overlays */}
        <View style={styles.cardStage}>
          <View style={styles.heroGlow} />
          <View style={styles.heroRingOuter} />
          <View style={styles.heroRingInner} />
          <View style={styles.heroCardOffset} />
          <View style={styles.heroCardTilt}>
            {card.imageUrl ? (
              <ZoomableCardImage
                imageUrl={card.imageUrl}
                gradientStart={card.gradientStart}
                gradientEnd={card.gradientEnd}
                cardName={card.name}
                cardNumber={card.number}
              />
            ) : (
              <CardArtFallback
                cardName={card.name}
                cardNumber={card.number}
                gradientStart={card.gradientStart}
                gradientEnd={card.gradientEnd}
              />
            )}
          </View>

          <Text style={styles.passportSerial}>PASSPORT / {card.number.toUpperCase()}</Text>
          <View style={styles.inspectCaption}>
            <Feather name="maximize" size={12} color="#AAA5A2" />
            <Text style={styles.inspectCaptionText}>Tap to inspect</Text>
          </View>
          <View style={styles.identityStamp}>
            <Feather name="check" size={12} color={C.positive} />
            <Text style={styles.identityStampText}>IDENTITY MATCHED</Text>
          </View>

          {/* Prev/next arrow buttons */}
          {hasPrev && (
            <Pressable
              onPress={goToPrev}
              style={styles.swipeArrowLeft}
              hitSlop={{ top: 24, bottom: 24, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Previous card"
            >
              <View style={styles.swipeArrowInner}>
                <Feather name="chevron-left" size={20} color="rgba(255,255,255,0.9)" />
              </View>
            </Pressable>
          )}
          {hasNext && (
            <Pressable
              onPress={goToNext}
              style={styles.swipeArrowRight}
              hitSlop={{ top: 24, bottom: 24, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Next card"
            >
              <View style={styles.swipeArrowInner}>
                <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.9)" />
              </View>
            </Pressable>
          )}
        </View>

        {/* Dot / position indicator */}
        {showDots && (
          <View style={styles.dotRow}>
            {useDots ? (
              swipeIds.map((sid, i) => (
                <View
                  key={sid}
                  style={[
                    styles.dot,
                    i === currentIndex ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              ))
            ) : (
              <Text style={styles.dotCounter}>
                {currentIndex + 1} / {swipeIds.length}
              </Text>
            )}
          </View>
        )}

        {/* One-time swipe hint */}
        {showSwipeHint && (
          <Animated.View style={[styles.swipeHint, hintAnimStyle]}>
            <Feather name="chevron-left" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={styles.swipeHintText}>Swipe to browse your collection</Text>
            <Feather name="chevron-right" size={13} color="rgba(255,255,255,0.7)" />
          </Animated.View>
        )}

        {/* Card identity and raw market value */}
        <View style={styles.identityCard}>
          <View style={styles.identityTop}>
            <View style={styles.identityCopy}>
              <Text style={styles.identityEyebrow}>
                {card.tcg === 'pokemon' ? 'POKÉMON' : card.tcg === 'magic' ? 'MAGIC: THE GATHERING' : card.tcg.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}
                {' · '}{card.setName.toUpperCase()}
              </Text>
              <Text style={styles.cardName}>{card.name}</Text>
              <Text style={styles.cardMeta}>
                {RARITY_LABELS[card.rarity]} · {card.number} · {card.year}
              </Text>
            </View>
            <Pressable
              onPress={handleWishlistToggle}
              style={styles.favoriteButton}
              accessibilityRole="button"
              accessibilityLabel={isWatched ? 'Open wishlist' : 'Add to wishlist'}
              accessibilityState={{ selected: isWatched }}
              hitSlop={8}
            >
              <Feather name="bookmark" size={20} color={C.primary} />
            </Pressable>
          </View>

          <View style={styles.valueRow}>
            <View>
              <Text style={styles.valueLabel}>Raw / Ungraded value</Text>
              <Text style={styles.valueAmount}>
                {topMarketSummary
                  ? `${topMarketSummary.currency} ${topMarketSummary.price.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : 'Price unavailable'}
              </Text>
            </View>
          </View>
        </View>

        <View
          style={styles.modeTabs}
          onLayout={event => handleModeTabsLayout(event.nativeEvent.layout.width)}
          accessibilityRole="tablist"
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.modeTabIndicator, modeIndicatorStyle]}
          />
          {(['Raw', 'Graded', 'POP'] as DetailMode[]).map(mode => (
            <Pressable
              key={mode}
              onPress={() => selectDetailMode(mode)}
              style={styles.modeTab}
              accessibilityRole="tab"
              accessibilityLabel={`${mode} card details`}
              accessibilityState={{ selected: detailMode === mode }}
            >
              <Text style={[styles.modeTabLabel, detailMode === mode && styles.modeTabLabelActive]}>{mode}</Text>
              <Text style={[styles.modeTabCaption, detailMode === mode && styles.modeTabCaptionActive]}>
                {mode === 'Raw' ? 'market' : mode === 'Graded' ? 'slabs' : 'population'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Verified Market Pricing ──────────────────────────────────── */}
        {detailMode !== 'POP' && (
          <VerifiedPricingCard
            card={card}
            displayCurrency={displayCurrency}
            isPro={hasAdvancedPricing}
            onUpgradePress={() => router.push('/pro-subscription')}
            chartWidth={W - 40 - 36}
            mode={detailMode === 'Graded' ? 'graded' : 'raw'}
            onRawMarketSummaryChange={handleRawMarketSummaryChange}
            onPriceChartInteractionStart={handlePriceChartInteractionStart}
            onPriceChartInteractionEnd={handlePriceChartInteractionEnd}
            populationRecords={populationRecords.flatMap(item =>
              item.grading?.company != null
              && item.grading.grade != null
              && item.grading.population != null
                ? [{
                    company: item.grading.company,
                    grade: item.grading.grade,
                    population: item.grading.population,
                  }]
                : [],
            )}
          />
        )}

        {detailMode === 'POP' && (
          <View style={[styles.card, styles.marketPanel]}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelKicker}>SCARCITY INDEX</Text>
                <Text style={styles.panelTitle}>Population report</Text>
              </View>
              <Feather name="bar-chart-2" size={18} color={C.primary} />
            </View>
            {populationRecords.length > 0 ? (
              populationRecords.map(item => (
                <View key={item.id} style={styles.populationRow}>
                  <View style={styles.populationGrade}>
                    <Text style={styles.populationGradeText}>
                      {item.grading?.company} {item.grading?.grade}
                    </Text>
                  </View>
                  <View style={styles.populationCopy}>
                    <Text style={styles.populationLabel}>Recorded population</Text>
                    <Text style={styles.populationValue}>{item.grading?.population?.toLocaleString('en-AU')}</Text>
                  </View>
                  <Text style={styles.populationQuantity}>×{item.quantity}</Text>
                </View>
              ))
            ) : (
              <View style={styles.populationEmpty}>
                <Feather name="bar-chart" size={26} color={C.mutedForeground} />
                <Text style={styles.populationEmptyTitle}>No verified population record</Text>
                <Text style={styles.populationEmptyText}>
                  Population data appears here when a graded copy in your collection has a verified grading record.
                </Text>
              </View>
            )}
          </View>
        )}

        <CollectionHoldingsPanel card={card} compact />

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            onPress={handleAddToCollection}
            style={[styles.primaryBtn, isOwned && { backgroundColor: C.muted }]}
            disabled={isOwned}
            accessibilityRole="button"
            accessibilityLabel={isOwned ? 'Already in collection' : 'Add to Collection'}
            accessibilityState={{ disabled: isOwned }}
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
            accessibilityRole="button"
            accessibilityLabel={isWatched ? 'Remove from wishlist' : 'Add to wishlist'}
            accessibilityState={{ selected: isWatched }}
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
          onPress={() => router.push({
            pathname: `/card-passport/${card.id}`,
            params: { appCardJson: JSON.stringify(card) },
          } as any)}
          style={[styles.passportBanner, { backgroundColor: '#D4AF3722', borderColor: '#D4AF3744' }]}
          accessibilityRole="button"
          accessibilityLabel="Card Passport — ownership history, grading record and provenance"
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

        {/* For Sale listings — marketplace coming soon */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Cards For Sale</Text>
          </View>
          <View style={[styles.emptyListings, { backgroundColor: C.card }]}>
            <Feather name="shopping-bag" size={28} color={C.mutedForeground} />
            <Text style={styles.emptyListingsText}>Marketplace coming soon</Text>
          </View>
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
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 12 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 8,
  },
  navContext: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  navKicker: {
    color: C.primary,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.7,
  },
  navDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.primary,
  },
  navVerified: {
    color: C.mutedForeground,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.7,
  },
  navRight: { flexDirection: 'row', gap: 8 },
  cardActionsMenu: {
    position: 'absolute',
    top: 64,
    right: 20,
    zIndex: 60,
    width: 214,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3B373F',
    borderRadius: 14,
    backgroundColor: '#211F25',
    paddingVertical: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 24,
  },
  cardActionsMenuItem: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
  },
  cardActionsMenuText: {
    color: C.foreground,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  cardActionsMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#3B373F',
    marginHorizontal: 12,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardStage: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 310,
    marginBottom: 0,
    position: 'relative',
    overflow: 'hidden',
    paddingTop: 14,
    paddingBottom: 47,
  },
  heroGlow: {
    position: 'absolute',
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: `${C.primary}12`,
  },
  heroRingOuter: {
    position: 'absolute',
    width: 318,
    height: 318,
    borderRadius: 159,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${C.primary}2E`,
  },
  heroRingInner: {
    position: 'absolute',
    width: 244,
    height: 244,
    borderRadius: 122,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${C.primary}3D`,
  },
  heroCardOffset: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: 14,
    backgroundColor: `${C.primary}22`,
    transform: [{ translateX: 14 }, { translateY: 17 }, { rotate: '3deg' }],
  },
  heroCardTilt: {
    transform: [{ rotate: '3deg' }],
  },
  passportSerial: {
    position: 'absolute',
    left: 8,
    bottom: 24,
    color: '#716E76',
    fontFamily: 'SpaceMono_400Regular',
    fontSize: 8,
    letterSpacing: 1.25,
  },
  inspectCaption: {
    position: 'absolute',
    bottom: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inspectCaptionText: {
    color: '#AAA5A2',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  identityStamp: {
    position: 'absolute',
    right: 8,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  identityStampText: {
    color: C.positive,
    fontFamily: 'Inter_700Bold',
    fontSize: 8,
    letterSpacing: 1,
  },
  swipeArrowLeft: {
    position: 'absolute',
    left: -10,
    top: '50%',
    marginTop: -22,
    zIndex: 10,
  },
  swipeArrowRight: {
    position: 'absolute',
    right: -10,
    top: '50%',
    marginTop: -22,
    zIndex: 10,
  },
  swipeArrowInner: {
    width: 36,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  dot: {
    borderRadius: 4,
  },
  dotActive: {
    width: 18,
    height: 5,
    backgroundColor: C.primary,
  },
  dotInactive: {
    width: 5,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  dotCounter: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
  },
  identityCard: {
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  identityTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  identityCopy: { flex: 1 },
  identityEyebrow: {
    color: C.mutedForeground,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1,
    lineHeight: 13,
  },
  favoriteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    marginRight: -5,
  },
  cardName: {
    fontSize: 30,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.5,
    lineHeight: 31,
    marginTop: 7,
  },
  cardMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 5,
    textTransform: 'capitalize',
  },
  tagRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 12 },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
  tagText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 26,
  },
  valueLabel: {
    color: C.mutedForeground,
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    marginBottom: 4,
  },
  valueAmount: {
    color: C.foreground,
    fontFamily: 'Rajdhani_700Bold',
    fontSize: 32,
    lineHeight: 34,
  },
  modeTabs: {
    position: 'relative',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.surface,
    marginBottom: 12,
    padding: 4,
  },
  modeTabIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 10,
    backgroundColor: C.foreground,
  },
  modeTab: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 8,
    zIndex: 1,
  },
  modeTabLabel: { color: C.mutedForeground, fontFamily: 'Inter_700Bold', fontSize: 12 },
  modeTabLabelActive: { color: C.background },
  modeTabCaption: {
    color: `${C.mutedForeground}99`,
    fontFamily: 'Inter_400Regular',
    fontSize: 8,
    marginTop: 2,
  },
  modeTabCaptionActive: { color: C.muted },
  priceTabs: { marginBottom: 12 },
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
  priceTabActive: { borderColor: C.primary, backgroundColor: `${C.primary}18` },
  priceTabLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    marginBottom: 3,
  },
  priceTabLabelActive: { color: C.primary },
  priceTabValue: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
  },
  priceTabValueActive: { color: C.foreground },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 18,
    marginBottom: 12,
  },
  marketPanel: { backgroundColor: C.card },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  panelKicker: {
    color: C.mutedForeground,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1,
  },
  panelTitle: {
    color: C.foreground,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    marginTop: 5,
  },
  populationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingVertical: 12,
  },
  populationGrade: {
    minWidth: 62,
    minHeight: 28,
    borderRadius: 7,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  populationGradeText: { color: C.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 10 },
  populationCopy: { flex: 1 },
  populationLabel: { color: C.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 10 },
  populationValue: { color: C.foreground, fontFamily: 'Rajdhani_700Bold', fontSize: 22, marginTop: 2 },
  populationQuantity: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 12 },
  populationEmpty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 22 },
  populationEmptyTitle: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 10 },
  populationEmptyText: {
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
    textAlign: 'center',
  },
  holdingsPanel: { backgroundColor: C.card },
  holdingsCount: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 11 },
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingVertical: 11,
  },
  holdingMark: {
    minWidth: 42,
    height: 26,
    borderRadius: 6,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  holdingMarkGraded: { backgroundColor: C.primary },
  holdingMarkText: { color: C.foreground, fontFamily: 'Inter_700Bold', fontSize: 9 },
  holdingCopy: { flex: 1 },
  holdingTitle: { color: C.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  holdingMeta: {
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 3,
    textTransform: 'capitalize',
  },
  holdingValue: { color: C.primary, fontFamily: 'Rajdhani_700Bold', fontSize: 16 },
  holdingsEmpty: {
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    paddingVertical: 8,
  },
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
    backgroundColor: '#CC1826', // WCAG AA: white text on #FF1E2D only 3.84:1; #CC1826 gives 5.25:1
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
    backgroundColor: '#CC1826', // WCAG AA: #CC1826 gives 5.25:1 with white text
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 4,
    minHeight: 44,
    justifyContent: 'center',
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
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    alignSelf: 'center',
    marginTop: -8,
    marginBottom: 12,
  },
  swipeHintText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.75)',
  },
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

  // ── Pricing+ ──────────────────────────────────────────────────────────
  pricingPlusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  pricingPlusTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  proBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  rangeTabsScroll: { marginBottom: 12 },
  rangeTabsContent: { gap: 6, paddingRight: 4 },
  rangeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  rangeChipText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  chartRangeLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chartWrapLg: { height: 52, marginBottom: 8 },
  rangeFreeNote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    marginTop: 4,
  },
  rawHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  rawBadge: {
    backgroundColor: `${C.positive}22`,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  rawBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.positive,
    letterSpacing: 0.5,
  },
  rawStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  rawStatLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  rawStatValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  rawGatedPreview: {},
  gradedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  gradedLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
  },
  gradedValue: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  gradedUnavailable: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  gradedRetry: {
    alignItems: 'center',
    borderColor: C.primary,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 13,
  },
  gradedRetryText: {
    color: C.primary,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  gradedBlurred: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gradedBlurText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 2,
  },
  gradedCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#CC1826', // WCAG AA: #CC1826 gives 5.25:1 with white text
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 12,
    minHeight: 44,
  },
  gradedCtaText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
  saleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  saleLeft: { gap: 2 },
  saleGrade: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  saleMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  salePrice: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: C.positive,
  },
  emptyListings: {
    borderRadius: 14,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyListingsText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },

  // ── Price history chart ───────────────────────────────────────────────
  chartAreaWrap: {
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  chartFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  chartFooterText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    flex: 1,
  },

  // ── eBay listing button ───────────────────────────────────────────────
  ebayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E53238', // eBay red
    marginBottom: 16,
  },
  ebayBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
});
