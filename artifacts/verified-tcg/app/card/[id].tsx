import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GradeBadge, VerificationBadge } from '@/components/ui/Badge';
import { CardImage } from '@/components/ui/CardImage';
import { useApp } from '@/context/AppContext';
import { fetchCatalogCard, catalogCardToAppCard, recordCatalogCardLookup } from '@/services/catalogApi';
import { fetchGradedPrices, type GradedPricingAvailability } from '@/services/gradedPricing';
import colors from '@/constants/colors';
import { RARITY_LABELS } from '@/types';
import type { Card, WatchlistItem } from '@/types';
import {
  GRADERS,
} from '@/services/pricingPlus';
import { canViewAdvancedPricing } from '@/services/subscription';
import VerifiedPricingCard from '@/components/ui/VerifiedPricingCard';
import EbaySoldHistoryCard from '@/components/ui/EbaySoldHistoryCard';
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
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 18,
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
  const { addToWatchlist, watchlist, collection, subscriptionTier } = useApp();
  const { currency: displayCurrency } = useSettings();
  const [priceTab, setPriceTab] = useState<PriceTab>('Raw');
  const [localInCollection, setLocalInCollection] = useState(false);
  const [localInWatchlist, setLocalInWatchlist] = useState(false);
  const [showAddedBanner, setShowAddedBanner] = useState(false);
  const [showWishlistAddedBanner, setShowWishlistAddedBanner] = useState(false);
  const [showWishlistPanel, setShowWishlistPanel] = useState(false);

  // Catalog API fetch state. Navigation may include an API-shaped card for a
  // fast first paint, but the app never resolves a release card from fixtures.
  // Two inline param strategies:
  //   catalogJson  — raw CatalogCard JSON (from search results)
  //   appCardJson  — already-converted Card JSON (from home/market screen taps)
  // Either bypasses the loading state and avoids a round-trip to the API.
  const [catalogCard, setCatalogCard] = useState<Card | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [liveGradedPrices, setLiveGradedPrices] = useState<Record<string, number>>({});
  const [gradedLoading, setGradedLoading] = useState(false);
  const [gradedRequiresUpgrade, setGradedRequiresUpgrade] = useState(false);
  const [gradedAvailability, setGradedAvailability] = useState<GradedPricingAvailability>('available');
  const [gradedMessage, setGradedMessage] = useState<string | null>(null);
  const [gradedRetryNonce, setGradedRetryNonce] = useState(0);

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
    fetchCatalogCard(id, controller.signal)
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
  }, [id, catalogJson, appCardJson]);

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

  // Fetch real graded prices from eBay sold listings (via API server)
  useEffect(() => {
    const resolvedCard = catalogCard;
    if (!resolvedCard) return;
    const controller = new AbortController();
    let cancelled = false;
    setGradedLoading(true);
    setLiveGradedPrices({});
    setGradedRequiresUpgrade(false);
    setGradedMessage(null);
    fetchGradedPrices(
      resolvedCard.id,
      resolvedCard.name,
      resolvedCard.setName,
      resolvedCard.tcg,
      resolvedCard.number,
      controller.signal,
      gradedRetryNonce > 0,
    )
      .then(result => {
        if (cancelled) return;
        setLiveGradedPrices(result.prices);
        setGradedRequiresUpgrade(result.requiresUpgrade);
        setGradedAvailability(result.availability);
        setGradedMessage(result.message);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setGradedLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  // re-fetch when the card identity changes (navigation between cards)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, catalogCard?.id, gradedRetryNonce]);

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

  // Card passports are shown only when the server supplies one; fixtures are
  // intentionally never used as a fallback in release builds.
  const hasPassport = false;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  // Pro completed-sale price rows intentionally never fall back to fixture or
  // provider-market values. Missing grades are omitted until eBay returns a
  // verified completed sale for that exact condition.
  function effectiveTabPrice(tab: PriceTab): number | undefined {
    if (hasAdvancedPricing) {
      switch (tab) {
        case 'Raw': return liveGradedPrices.raw;
        case 'PSA 9': return liveGradedPrices.psa9;
        case 'PSA 10': return liveGradedPrices.psa10;
        case 'CGC 10': return liveGradedPrices.cgc10;
        case 'BGS 9.5': return liveGradedPrices.bgs95;
        default: return undefined;
      }
    }
    switch (tab) {
      case 'Raw':     return card.price.available ? card.price.raw : undefined;
      case 'PSA 9':   return liveGradedPrices['psa9']  ?? card.price.psa9;
      case 'PSA 10':  return liveGradedPrices['psa10'] ?? card.price.psa10;
      case 'CGC 10':  return liveGradedPrices['cgc10'] ?? card.price.cgc10;
      case 'BGS 9.5': return liveGradedPrices['bgs95'] ?? card.price.bgs95;
      default:        return card.price.available ? card.price.raw : undefined;
    }
  }
  const activePrice = effectiveTabPrice(priceTab);

  const isOwned = localInCollection || collection.some(i => i.cardId === card.id);
  const isWatched = localInWatchlist || watchlist.some(w => w.cardId === card.id);

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
          <View style={styles.navRight}>
            <Pressable
              onPress={handleWishlistToggle}
              style={[styles.navBtn, isWatched && { backgroundColor: `${C.primary}22` }]}
              accessibilityRole="button"
              accessibilityLabel={isWatched ? 'Remove from wishlist' : 'Add to wishlist'}
              hitSlop={2}
            >
              <Feather name="heart" size={20} color={isWatched ? C.primary : C.foreground} />
            </Pressable>
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
              <Feather name="share-2" size={20} color={C.foreground} />
            </Pressable>
          </View>
        </View>

        {/* Card artwork + swipe navigation overlays */}
        <View style={styles.cardStage}>
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
              verificationStatus={card.verificationStatus}
            />
          )}

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
            const price = effectiveTabPrice(t);
            if (!price) return null;
            return (
              <Pressable
                key={t}
                onPress={() => setPriceTab(t)}
                style={[
                  styles.priceTab,
                  priceTab === t && { borderColor: C.primary, backgroundColor: `${C.primary}18` },
                ]}
                accessibilityRole="tab"
                accessibilityLabel={`${t} price: $${price.toLocaleString('en-AU')}`}
                accessibilityState={{ selected: priceTab === t }}
              >
                <Text style={[styles.priceTabLabel, priceTab === t && { color: C.primary }]}>{t}</Text>
                <Text style={[styles.priceTabValue, priceTab === t && { color: C.foreground }]}>
                  ${price.toLocaleString('en-AU')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Verified Market Pricing ──────────────────────────────────── */}
        <VerifiedPricingCard
          card={card}
          displayCurrency={displayCurrency}
          isPro={hasAdvancedPricing}
          onUpgradePress={() => router.push('/pro-subscription')}
          chartWidth={W - 40 - 36}
        />

        <EbaySoldHistoryCard card={card} displayCurrency={displayCurrency} />

        {/* GRADED pricing section */}
        <View style={[styles.card, { backgroundColor: C.card, marginBottom: 12 }]}>
          <View style={styles.rawHeader}>
            <View style={[styles.rawBadge, { backgroundColor: `${C.primary}22` }]}>
              <Text style={[styles.rawBadgeText, { color: C.primary }]}>GRADED</Text>
            </View>
            <Text style={styles.sectionTitle}>Graded Prices</Text>
          </View>

          {hasAdvancedPricing ? (
            <View>
              {gradedLoading ? (
                <ActivityIndicator
                  color={C.primary}
                  style={{ marginVertical: 14, alignSelf: 'center' }}
                />
              ) : gradedRequiresUpgrade ? (
                <>
                  {GRADERS.map(grader => (
                    <View key={grader.key} style={styles.gradedRow}>
                      <Text style={styles.gradedLabel}>{grader.label}</Text>
                      <View style={styles.gradedBlurred}>
                        <Text style={styles.gradedBlurText}>••••</Text>
                        <Feather name="lock" size={12} color={C.mutedForeground} />
                      </View>
                    </View>
                  ))}
                  <Pressable
                    onPress={() => router.push('/pro-subscription')}
                    style={styles.gradedCta}
                    accessibilityRole="button"
                    accessibilityLabel="Upgrade to Pro to unlock graded pricing"
                  >
                    <Feather name="zap" size={13} color="#FFF" />
                    <Text style={styles.gradedCtaText}>Upgrade to Pro</Text>
                  </Pressable>
                </>
              ) : Object.keys(liveGradedPrices).length === 0 ? (
                <View style={styles.gradedUnavailable}>
                  <Text style={[styles.gradedLabel, { textAlign: 'center', color: C.mutedForeground }]}>
                    {gradedMessage ?? (
                      gradedAvailability === 'no_results'
                        ? 'No matching eBay completed sales found for these grades.'
                        : 'Graded price data unavailable'
                    )}
                  </Text>
                  {gradedAvailability !== 'configuration_error' && (
                    <Pressable
                      onPress={() => setGradedRetryNonce((current) => current + 1)}
                      style={styles.gradedRetry}
                      accessibilityRole="button"
                      accessibilityLabel="Retry eBay graded pricing"
                    >
                      <Feather name="refresh-cw" size={13} color={C.primary} />
                      <Text style={styles.gradedRetryText}>Retry eBay sales</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                GRADERS.filter(g => liveGradedPrices[g.key] !== undefined).map(grader => {
                  // Map grader key to price tab so tapping a grader row switches the chart
                  const tabMap: Record<string, PriceTab> = {
                    psa9: 'PSA 9', psa10: 'PSA 10', cgc10: 'CGC 10', bgs95: 'BGS 9.5',
                  };
                  const tab = tabMap[grader.key];
                  const isActive = tab && priceTab === tab;
                  return (
                    <Pressable
                      key={grader.key}
                      onPress={() => tab && setPriceTab(tab)}
                      style={[styles.gradedRow, isActive && { backgroundColor: `${C.primary}12`, borderRadius: 8, marginHorizontal: -4, paddingHorizontal: 4 }]}
                    >
                      <Text style={[styles.gradedLabel, isActive && { color: C.primary }]}>{grader.label}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.gradedValue, isActive && { color: C.primary }]}>
                          ${(liveGradedPrices[grader.key]!).toLocaleString('en-AU')} AUD
                        </Text>
                        {tab && <Feather name="bar-chart-2" size={12} color={isActive ? C.primary : C.mutedForeground} />}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : (
            <>
              {GRADERS.map(grader => (
                <View key={grader.key} style={styles.gradedRow}>
                  <Text style={styles.gradedLabel}>{grader.label}</Text>
                  <View style={styles.gradedBlurred}>
                    <Text style={styles.gradedBlurText}>••••</Text>
                    <Feather name="lock" size={12} color={C.mutedForeground} />
                  </View>
                </View>
              ))}
              <Pressable
                onPress={() => router.push('/pro-subscription')}
                style={styles.gradedCta}
                accessibilityRole="button"
                accessibilityLabel="Unlock graded pricing with Pro"
              >
                <Feather name="zap" size={13} color="#FFF" />
                <Text style={styles.gradedCtaText}>Unlock graded pricing</Text>
              </Pressable>
            </>
          )}
        </View>

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
          onPress={() => router.push(`/card-passport/${card.id}` as any)}
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
