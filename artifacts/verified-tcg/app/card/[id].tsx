import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
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
import { useApp } from '@/context/AppContext';
import { getCardById } from '@/services/cards';
import { fetchCatalogCard, catalogCardToAppCard } from '@/services/catalogApi';
import { fetchGradedPrices } from '@/services/gradedPricing';
import { MOCK_LISTINGS } from '@/services/listings';
import { getCardPassport } from '@/services/matching';
import colors from '@/constants/colors';
import { RARITY_LABELS } from '@/types';
import type { Card, CollectionItem, WatchlistItem } from '@/types';
import ProFeaturePreview from '@/components/ui/ProFeaturePreview';
import {
  getMockPricingPlus,
  GRADERS,
  type PricePoint,
} from '@/services/pricingPlus';
import { canViewAdvancedPricing } from '@/services/subscription';
import {
  fetchPriceHistory,
  triggerPriceSnapshot,
  buildEbaySearchUrl,
  formatUpdatedAt,
  type PricePeriod,
  type PricePoint as HistoryPoint,
} from '@/services/priceHistory';

const GRADE_OPTIONS = [
  'Raw', 'PSA 8', 'PSA 9', 'PSA 10', 'BGS 9', 'BGS 9.5', 'CGC 9', 'CGC 10',
];

// ── Chart period selector ─────────────────────────────────────────────────────

const CHART_PERIODS: PricePeriod[] = ['7D', '30D', '90D', '1Y', 'All'];
const FREE_PERIOD: PricePeriod = '7D';

/** Map PriceTab label → grade key used by the price-history API */
function gradeKeyFromTab(tab: PriceTab): string {
  switch (tab) {
    case 'PSA 9':   return 'psa9';
    case 'PSA 10':  return 'psa10';
    case 'CGC 10':  return 'cgc10';
    case 'BGS 9.5': return 'bgs95';
    default:        return 'raw';
  }
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────

interface PriceLineChartProps {
  points: HistoryPoint[];
  width: number;
  height: number;
  loading?: boolean;
}

function PriceLineChart({ points, width, height, loading }: PriceLineChartProps) {
  if (loading) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="small" color={colors.dark.primary} />
      </View>
    );
  }
  if (points.length < 2) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Feather name="bar-chart-2" size={28} color="rgba(255,255,255,0.2)" />
        <Text style={{
          fontSize: 12, fontFamily: 'Inter_400Regular',
          color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 18,
        }}>
          Price history not yet available{'\n'}for this card
        </Text>
      </View>
    );
  }

  const PAD = { top: 6, right: 2, bottom: 6, left: 2 };
  const chartW = width - PAD.left - PAD.right;
  const chartH = height - PAD.top - PAD.bottom;

  const prices = points.map(p => p.price);
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);
  const range  = maxP - minP || 1;

  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * chartW;
  const toY = (p: number) => PAD.top + ((maxP - p) / range) * chartH;

  const coords = points.map((pt, i) => ({ x: toX(i), y: toY(pt.price) }));

  // Smooth cubic bezier path
  function makePath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const cpx  = (prev.x + curr.x) / 2;
      d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return d;
  }

  const linePath = makePath(coords);
  const bottom   = PAD.top + chartH;
  const firstX   = coords[0]!.x;
  const lastX    = coords[coords.length - 1]!.x;
  const areaPath = `${linePath} L ${lastX} ${bottom} L ${firstX} ${bottom} Z`;

  const isUp     = prices[prices.length - 1]! >= prices[0]!;
  const lineColor = isUp ? '#22c55e' : '#ef4444';

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lineColor} stopOpacity={0.28} />
          <Stop offset="1" stopColor={lineColor} stopOpacity={0.0} />
        </SvgLinearGradient>
      </Defs>
      <Path d={areaPath} fill="url(#chartFill)" />
      <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

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

// Helper — keeps raw stat rows DRY across preview/locked content
function RAW_STAT_ROWS(p: ReturnType<typeof getMockPricingPlus>) {
  return [
    { label: '7-Day Avg',    value: `$${p.rawStats.avg7d.toLocaleString('en-AU')}` },
    { label: '30-Day Avg',   value: `$${p.rawStats.avg30d.toLocaleString('en-AU')}` },
    { label: '90-Day Avg',   value: `$${p.rawStats.avg90d.toLocaleString('en-AU')}` },
    { label: '52-Week High', value: `$${p.rawStats.high52w.toLocaleString('en-AU')}` },
    { label: '52-Week Low',  value: `$${p.rawStats.low52w.toLocaleString('en-AU')}` },
    { label: 'Sales Vol.',   value: `${p.rawStats.salesVolume} sold/30d` },
  ];
}

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
  const { addToCollection, addToWatchlist, watchlist, collection, subscriptionTier } = useApp();
  const [priceTab, setPriceTab] = useState<PriceTab>('Raw');
  const [localInCollection, setLocalInCollection] = useState(false);
  const [localInWatchlist, setLocalInWatchlist] = useState(false);
  const [showAddedBanner, setShowAddedBanner] = useState(false);
  const [showWishlistAddedBanner, setShowWishlistAddedBanner] = useState(false);
  const [showWishlistPanel, setShowWishlistPanel] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PricePeriod>('7D');
  const [priceHistory, setPriceHistory] = useState<HistoryPoint[]>([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryUpdatedAt, setPriceHistoryUpdatedAt] = useState<string | null>(null);

  // Catalog API fetch state — populated when the card ID isn't in the local mock store.
  // Two inline param strategies:
  //   catalogJson  — raw CatalogCard JSON (from search results)
  //   appCardJson  — already-converted Card JSON (from home/market screen taps)
  // Either bypasses the loading state and avoids a round-trip to the API.
  const [catalogCard, setCatalogCard] = useState<Card | null>(() => {
    if (appCardJson) {
      try { return JSON.parse(appCardJson as string) as Card; } catch { /* fall through */ }
    }
    if (!catalogJson) return null;
    try {
      const parsed = JSON.parse(catalogJson as string) as import('@/services/catalogApi').CatalogCard;
      return catalogCardToAppCard(parsed);
    } catch {
      return null;
    }
  });
  const [catalogLoading, setCatalogLoading] = useState(!getCardById(id ?? '') && !catalogJson && !appCardJson);
  const [catalogError, setCatalogError] = useState(false);
  const [liveGradedPrices, setLiveGradedPrices] = useState<Record<string, number>>({});
  const [gradedLoading, setGradedLoading] = useState(false);

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

  // Fetch card from live catalog when it isn't in the local mock store and
  // wasn't passed through navigation params (e.g. opened from collection/wishlist).
  useEffect(() => {
    if (getCardById(id ?? '')) return; // found locally — no fetch needed
    if (catalogJson) return;           // already initialised from navigation param (CatalogCard)
    if (appCardJson) return;           // already initialised from navigation param (Card)
    if (!id) { setCatalogLoading(false); setCatalogError(true); return; }
    const controller = new AbortController();
    setCatalogLoading(true);
    fetchCatalogCard(id, controller.signal)
      .then((data) => {
        if (data) setCatalogCard(catalogCardToAppCard(data));
        else setCatalogError(true);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') setCatalogError(true);
      })
      .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [id, catalogJson, appCardJson]);

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
    const resolvedCard = getCardById(id ?? '') ?? catalogCard;
    if (!resolvedCard) return;
    const controller = new AbortController();
    setGradedLoading(true);
    setLiveGradedPrices({});
    fetchGradedPrices(
      resolvedCard.id,
      resolvedCard.name,
      resolvedCard.setName,
      resolvedCard.tcg,
      controller.signal,
    )
      .then(prices => setLiveGradedPrices(prices))
      .catch(() => {})
      .finally(() => setGradedLoading(false));
    return () => controller.abort();
  // re-fetch when the card identity changes (navigation between cards)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, catalogCard?.id]);

  // Fetch price history when grade tab or period changes
  useEffect(() => {
    const resolvedCard = getCardById(id ?? '') ?? catalogCard;
    if (!resolvedCard) return;
    const controller = new AbortController();
    setPriceHistoryLoading(true);
    setPriceHistory([]);
    fetchPriceHistory(resolvedCard.id, gradeKeyFromTab(priceTab), selectedPeriod, controller.signal)
      .then(result => {
        setPriceHistory(result.points);
        setPriceHistoryUpdatedAt(result.updatedAt);
      })
      .catch(() => {})
      .finally(() => setPriceHistoryLoading(false));
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, catalogCard?.id, priceTab, selectedPeriod]);

  // Trigger a background price snapshot on first card view so history accumulates
  useEffect(() => {
    const resolvedCard = getCardById(id ?? '') ?? catalogCard;
    if (!resolvedCard) return;
    triggerPriceSnapshot(resolvedCard.id, resolvedCard.name, resolvedCard.setName, resolvedCard.tcg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Resolve card: prefer local mock (instant), fall back to catalog API result.
  // Use a separate rawCard for the null-guard so TypeScript narrows 'card' to
  // type Card after the guards — closures below then capture Card, not Card|null.
  const localCard = getCardById(id ?? '');
  const rawCard = localCard ?? catalogCard;
  const isCatalogCard = !localCard;

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
        <Pressable onPress={() => router.back()} style={{ marginTop: 24, backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
          <Text style={{ color: '#FFF', fontFamily: 'Inter_700Bold', fontSize: 15 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // rawCard is narrowed to Card here; closures below capture Card (not Card|null)
  const card = rawCard;

  const cardListings = MOCK_LISTINGS.filter(l => l.card.id === card.id);
  // For live catalog cards, don't substitute random mock listings from other cards
  const allListings = isCatalogCard
    ? []
    : (cardListings.length > 0 ? cardListings : MOCK_LISTINGS.slice(0, 2));
  // Passport records only exist for local mock cards
  const hasPassport = !isCatalogCard && getCardPassport(card.id) !== null;
  const pricingPlus = getMockPricingPlus(card.id, card.price.raw);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const tabH = Platform.OS === 'web' ? 84 : 74;

  // Prefer real eBay-sourced prices; fall back to card.price fields for Raw/tab display
  function effectiveTabPrice(tab: PriceTab): number | undefined {
    switch (tab) {
      case 'Raw':     return card.price.raw;
      case 'PSA 9':   return liveGradedPrices['psa9']  ?? card.price.psa9;
      case 'PSA 10':  return liveGradedPrices['psa10'] ?? card.price.psa10;
      case 'CGC 10':  return liveGradedPrices['cgc10'] ?? card.price.cgc10;
      case 'BGS 9.5': return liveGradedPrices['bgs95'] ?? card.price.bgs95;
      default:        return card.price.raw;
    }
  }
  const activePrice = effectiveTabPrice(priceTab);

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
            <Pressable
              style={styles.navBtn}
              onPress={() => {
                const url = `https://verifiedtcg.com/cards/${card.id}`;
                Share.share({
                  title: `${card.name} — Verified TCG`,
                  message: `Check out ${card.name} on Verified TCG!\n${card.setName} · ${card.number}\nMarket: $${card.price.raw.toLocaleString('en-AU')} AUD\n${url}`,
                  url,
                }).catch(() => {});
              }}
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
              >
                <Text style={[styles.priceTabLabel, priceTab === t && { color: C.primary }]}>{t}</Text>
                <Text style={[styles.priceTabValue, priceTab === t && { color: C.foreground }]}>
                  ${price.toLocaleString('en-AU')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Price History Chart ──────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: C.card }]}>
          {/* Header row */}
          <View style={styles.marketHeader}>
            <View>
              <Text style={styles.marketLabel}>Market Value · {priceTab}</Text>
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

          {/* Period selector */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.rangeTabsScroll}
            contentContainerStyle={[styles.rangeTabsContent, { marginTop: 12, marginBottom: 4 }]}
          >
            {CHART_PERIODS.map(period => {
              const isFree     = period === FREE_PERIOD;
              const isSelected = selectedPeriod === period;
              const locked     = !isFree && !hasAdvancedPricing;
              return (
                <Pressable
                  key={period}
                  onPress={() => {
                    if (locked) { router.push('/pro-subscription'); return; }
                    setSelectedPeriod(period);
                  }}
                  style={[
                    styles.rangeChip,
                    isSelected && { backgroundColor: C.primary, borderColor: C.primary },
                  ]}
                >
                  {locked && <Feather name="lock" size={9} color={C.mutedForeground} style={{ marginRight: 3 }} />}
                  <Text style={[styles.rangeChipText, isSelected && { color: '#FFF' }]}>
                    {period}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* SVG line chart */}
          <View style={styles.chartAreaWrap}>
            <PriceLineChart
              points={priceHistory}
              width={W - 40 - 36}
              height={120}
              loading={priceHistoryLoading}
            />
          </View>

          {/* Source footer */}
          <View style={styles.chartFooter}>
            <Feather name="info" size={10} color={C.mutedForeground} />
            <Text style={styles.chartFooterText}>
              Prices from eBay sold listings
              {priceHistoryUpdatedAt
                ? ` · Updated ${formatUpdatedAt(priceHistoryUpdatedAt)}`
                : ''}
            </Text>
          </View>
        </View>

        {/* ── View Listings on eBay ────────────────────────────────────── */}
        <Pressable
          onPress={() => {
            const url = buildEbaySearchUrl(card.name, card.setName, priceTab);
            Linking.openURL(url).catch(() => {});
          }}
          style={styles.ebayBtn}
        >
          <Feather name="external-link" size={14} color="#FFF" />
          <Text style={styles.ebayBtnText}>View Listings on eBay</Text>
        </Pressable>

        {/* RAW pricing card */}
        <View style={[styles.card, { backgroundColor: C.card, marginBottom: 12, marginTop: 12 }]}>
          <View style={styles.rawHeader}>
            <View style={styles.rawBadge}>
              <Text style={styles.rawBadgeText}>RAW</Text>
            </View>
            <Text style={styles.sectionTitle}>Market Stats</Text>
          </View>

          {/* Always-visible: market estimate */}
          <View style={styles.rawStatRow}>
            <Text style={styles.rawStatLabel}>Market Estimate</Text>
            <Text style={styles.rawStatValue}>
              ${pricingPlus.rawStats.marketEstimate.toLocaleString('en-AU')} AUD
            </Text>
          </View>

          {/* Pro-gated stats — preview shows labels with blurred values */}
          <ProFeaturePreview
            featureTitle="Advanced Raw Stats"
            description="7-day, 30-day, 90-day averages, highs, lows and sales volume for serious collectors."
            ctaLabel="Unlock with Pro"
            previewContent={
              <View style={styles.rawGatedPreview}>
                {RAW_STAT_ROWS(pricingPlus).map(row => (
                  <View key={row.label} style={styles.rawStatRow}>
                    <Text style={styles.rawStatLabel}>{row.label}</Text>
                    <Text style={styles.rawStatValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            }
            lockedContent={
              <View>
                {RAW_STAT_ROWS(pricingPlus).map(row => (
                  <View key={row.label} style={styles.rawStatRow}>
                    <Text style={styles.rawStatLabel}>{row.label}</Text>
                    <Text style={styles.rawStatValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            }
          />
        </View>

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
              ) : Object.keys(liveGradedPrices).length === 0 ? (
                <Text style={[styles.gradedLabel, { textAlign: 'center', paddingVertical: 12, color: C.mutedForeground }]}>
                  Graded price data unavailable
                </Text>
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
              >
                <Feather name="zap" size={13} color="#FFF" />
                <Text style={styles.gradedCtaText}>Unlock graded pricing</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Recent Sales — full section gated via ProFeaturePreview */}
        <View style={{ marginBottom: 24 }}>
          <ProFeaturePreview
            featureTitle="Recent Sales"
            description="See what this card actually sold for across eBay, TCGPlayer, Whatnot and more."
            ctaLabel="Unlock Recent Sales"
            previewContent={
              <View style={[styles.card, { backgroundColor: C.card }]}>
                <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Recent Sales</Text>
                {pricingPlus.recentSales.slice(0, 2).map(sale => (
                  <View key={sale.id} style={styles.saleRow}>
                    <View style={styles.saleLeft}>
                      <Text style={styles.saleGrade}>{sale.gradeLabel}</Text>
                      <Text style={styles.saleMeta}>{sale.marketplace} · {sale.daysAgo}d ago</Text>
                    </View>
                    <Text style={styles.salePrice}>${sale.soldPrice.toLocaleString('en-AU')}</Text>
                  </View>
                ))}
              </View>
            }
            lockedContent={
              <View style={[styles.card, { backgroundColor: C.card }]}>
                <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Recent Sales</Text>
                {pricingPlus.recentSales.map(sale => (
                  <View key={sale.id} style={styles.saleRow}>
                    <View style={styles.saleLeft}>
                      <Text style={styles.saleGrade}>{sale.gradeLabel}</Text>
                      <Text style={styles.saleMeta}>{sale.marketplace} · {sale.daysAgo}d ago</Text>
                    </View>
                    <Text style={styles.salePrice}>${sale.soldPrice.toLocaleString('en-AU')}</Text>
                  </View>
                ))}
              </View>
            }
          />
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
            {allListings.length > 0 && (
              <Text style={styles.sectionCount}>{allListings.length} listing{allListings.length !== 1 ? 's' : ''}</Text>
            )}
          </View>
          {allListings.length === 0 ? (
            <View style={[styles.emptyListings, { backgroundColor: C.card }]}>
              <Feather name="shopping-bag" size={28} color={C.mutedForeground} />
              <Text style={styles.emptyListingsText}>No marketplace listings yet</Text>
            </View>
          ) : (
            allListings.map(listing => (
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
            ))
          )}
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
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 12,
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
