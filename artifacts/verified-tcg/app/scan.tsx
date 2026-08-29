import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  CameraView,
  type CameraType,
  useCameraPermissions,
} from 'expo-camera';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { canUseUnlimitedScanner } from '@/services/subscription';
import ScanLimitBanner from '@/components/ui/ScanLimitBanner';
import { getAccessToken } from '@/services/auth';
import { ApiClientError, apiRequest } from '@/services/apiClient';
import {
  type RecentScan,
  loadRecentScans,
  appendRecentScan,
  getScanGeneration,
} from '@/services/scanStatePersistence';

const C = colors.dark;
const { width: W, height: SCREEN_H } = Dimensions.get('window');

// Guide frame insets — all derived from screen edges
const GUIDE_X   = 36;   // horizontal padding for guide
const GUIDE_SIDE_W = GUIDE_X; // alias used in mask rects

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanState = 'idle' | 'capturing' | 'recognizing' | 'match' | 'low_confidence' | 'error' | 'auto_searching' | 'confirmed';

interface RecognizedCard {
  card: Record<string, unknown>;
  confidence: number;
}

interface ScanResult {
  topMatch: RecognizedCard | null;
  matches: RecognizedCard[];
  lowConfidence: boolean;
  imageUnreadable: boolean;
  extracted: { name: string; setName: string; number: string };
  scansUsed: number;
  scanLimit: number | null;
  scansRemaining: number | null;
}

const MIN_IMAGE_B64_CHARS = 8_000;

type ScanErrorCode = 'image_quality' | 'unreadable' | 'no_match' | 'api_error' | '';

// ── API error type ────────────────────────────────────────────────────────────

class ScanApiError extends Error {
  code?: string;
  scansUsed?: number;
  scanLimit?: number | null;
  scansRemaining?: number | null;

  constructor(
    message: string,
    opts?: {
      code?: string;
      scansUsed?: number;
      scanLimit?: number | null;
      scansRemaining?: number | null;
    },
  ) {
    super(message);
    this.name = 'ScanApiError';
    this.code = opts?.code;
    this.scansUsed = opts?.scansUsed;
    this.scanLimit = opts?.scanLimit;
    this.scansRemaining = opts?.scansRemaining;
  }
}

// ── API call ──────────────────────────────────────────────────────────────────

async function recognizeCard(base64Image: string): Promise<ScanResult> {
  const token = await getAccessToken();
  try {
    const response = await apiRequest('/api/scan/recognize', {
      method: 'POST',
      accessToken: token,
      body: JSON.stringify({ image: base64Image, mimeType: 'image/jpeg' }),
    });
    return response.json() as Promise<ScanResult>;
  } catch (error) {
    const apiError = error as ApiClientError;
    throw new ScanApiError(
      error instanceof Error ? error.message : 'Recognition failed. Please try again.',
      { code: apiError.status === 403 ? 'LIMIT_REACHED' : undefined },
    );
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const {
    user,
    addToWatchlist,
    subscriptionTier,
    scansUsed,
    scanLimit,
    scanResetDate,
    syncScanCount,
  } = useApp();

  const isLimitExhausted = !canUseUnlimitedScanner(subscriptionTier) && scansUsed >= scanLimit;

  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>('back');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showLimitSheet, setShowLimitSheet] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [confirmedAction, setConfirmedAction] = useState<string>('');
  const [errorCode, setErrorCode] = useState<ScanErrorCode>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  const sessionIdRef = useRef(0);
  const cameraRef = useRef<CameraView>(null);

  // ── Animations ────────────────────────────────────────────────────────────
  const fadeAnim      = useRef(new Animated.Value(0)).current;
  const pulseAnim     = useRef(new Animated.Value(1)).current;
  const scanLineAnim  = useRef(new Animated.Value(0)).current;
  const shutterGlow   = useRef(new Animated.Value(1)).current;
  const drawerAnim    = useRef(new Animated.Value(0)).current; // 0=closed, 1=open

  // Safe-area derived layout
  const topPad  = Platform.OS === 'web' ? 67 : insets.top;
  const botPad  = Platform.OS === 'web' ? 34 : insets.bottom;

  // Guide frame bounds (absolute screen coords)
  const GUIDE_T  = topPad + 80;  // below floating header
  const GUIDE_B  = Math.max(botPad, 32) + 158; // above bottom controls
  const GUIDE_H  = Math.max(SCREEN_H - GUIDE_T - GUIDE_B, 100);

  const DRAWER_H = 300;

  const resetLabel = scanResetDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  // ── Load recent scans ─────────────────────────────────────────────────────

  useEffect(() => {
    const mySession = sessionIdRef.current;
    loadRecentScans()
      .then(scans => { if (sessionIdRef.current === mySession) setRecentScans(scans); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) {
      sessionIdRef.current += 1;
      setRecentScans([]);
    }
  }, [user]);

  // ── Scan line animation ───────────────────────────────────────────────────

  useEffect(() => {
    if (scanState === 'recognizing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      scanLineAnim.setValue(0);
    }
  }, [scanState]);

  // ── Match panel fade/pulse ────────────────────────────────────────────────

  useEffect(() => {
    if (scanState === 'match' || scanState === 'low_confidence') {
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.02, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      fadeAnim.setValue(0);
      pulseAnim.setValue(1);
    }
  }, [scanState]);

  // ── Shutter glow pulse ────────────────────────────────────────────────────

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shutterGlow, { toValue: 1.14, duration: 1500, useNativeDriver: true }),
        Animated.timing(shutterGlow, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  // ── Drawer toggle ─────────────────────────────────────────────────────────

  function toggleDrawer() {
    if (drawerOpen) {
      Animated.timing(drawerAnim, {
        toValue: 0, duration: 360,
        useNativeDriver: true,
      }).start(() => setDrawerOpen(false));
    } else {
      setDrawerOpen(true);
      Animated.timing(drawerAnim, {
        toValue: 1, duration: 360,
        useNativeDriver: true,
      }).start();
    }
  }

  const drawerTranslateY = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [DRAWER_H, 0],
  });

  const scanLineY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, GUIDE_H - 2],
  });

  // ── Capture & recognize ───────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (isLimitExhausted || scanState !== 'idle') return;

    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }

    const sessionAtCapture  = sessionIdRef.current;
    const scanGenAtCapture  = getScanGeneration();

    setScanState('capturing');

    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.5,
        skipProcessing: true,
      });

      if (!photo?.base64) {
        setErrorMessage('Could not capture image. Please try again.');
        setErrorCode('api_error');
        setScanState('error');
        return;
      }

      if (photo.base64.length < MIN_IMAGE_B64_CHARS) {
        setErrorMessage('The image looks too dark or blank.');
        setErrorCode('image_quality');
        setScanState('error');
        return;
      }

      setScanState('recognizing');

      const result = await recognizeCard(photo.base64);

      if (getScanGeneration() !== scanGenAtCapture) return;

      if (!canUseUnlimitedScanner(subscriptionTier) && typeof result.scansUsed === 'number') {
        syncScanCount(result.scansUsed);
      }

      setScanResult(result);

      if (!result.topMatch) {
        if (result.imageUnreadable) {
          setErrorMessage('Card may be blurry or out of frame.');
          setErrorCode('unreadable');
          setScanState('error');
        } else {
          const { name, setName, number } = result.extracted;
          const hasExtracted = [name, setName, number].some(f => f.trim() !== '');
          if (hasExtracted) {
            const query = [name, setName, number].filter(f => f.trim() !== '').join(' ');
            setScanState('auto_searching');
            setTimeout(() => {
              router.push(`/search?q=${encodeURIComponent(query)}`);
              setScanResult(null);
              setErrorMessage('');
              setErrorCode('');
              setScanState('idle');
            }, 2000);
          } else {
            setErrorMessage('No matching card found in our catalog.');
            setErrorCode('no_match');
            setScanState('error');
          }
        }
      } else if (result.lowConfidence) {
        setScanState('low_confidence');
      } else {
        setScanState('match');
      }

      if (result.topMatch) {
        const raw = result.topMatch.card;
        const entry: RecentScan = {
          cardId:    String(raw.id ?? ''),
          name:      String(raw.name ?? ''),
          setName:   String(raw.set_name ?? raw.set ?? ''),
          number:    String(raw.number ?? ''),
          imageUrl:  raw.image_url ? String(raw.image_url) : undefined,
          scannedAt: new Date().toISOString(),
        };
        appendRecentScan(entry, scanGenAtCapture)
          .then(updated => {
            if (sessionIdRef.current === sessionAtCapture) setRecentScans(updated);
          })
          .catch(() => {});
      }
    } catch (err: unknown) {
      const e = err as Error & { code?: string; scansUsed?: number };
      if (e.code === 'LIMIT_REACHED') {
        setScanState('idle');
        setShowLimitSheet(true);
      } else {
        if (!canUseUnlimitedScanner(subscriptionTier) && typeof e.scansUsed === 'number') {
          syncScanCount(e.scansUsed);
        }
        setErrorMessage(e.message ?? 'Recognition failed. Please try again or search manually.');
        setErrorCode('api_error');
        setScanState('error');
      }
    }
  }, [isLimitExhausted, scanState, permission, subscriptionTier, syncScanCount, requestPermission]);

  // ── Post-match actions ────────────────────────────────────────────────────

  function getMatchedCard() { return scanResult?.topMatch?.card ?? null; }

  function handleConfirm()       { setShowActionSheet(true); }
  function handleSearchManually() {
    const extracted = scanResult?.extracted;
    const query = [extracted?.name, extracted?.setName, extracted?.number].filter(Boolean).join(' ');
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  }

  function buildCard(raw: Record<string, unknown>): import('@/types').Card {
    return {
      id:      String(raw.id ?? ''),
      name:    String(raw.name ?? ''),
      setId:   String(raw.set ?? raw.set_id ?? ''),
      setName: String(raw.set_name ?? raw.set ?? ''),
      tcg:     (String(raw.game ?? 'pokemon').toLowerCase().includes('magic')
                  ? 'magic'
                  : String(raw.game ?? '').toLowerCase().includes('yugioh') || String(raw.game ?? '').toLowerCase().includes('yu-gi-oh')
                    ? 'yugioh'
                    : 'pokemon') as import('@/types').TCGId,
      number:        String(raw.number ?? ''),
      rarity:        'rare',
      year:          new Date().getFullYear(),
      imageUrl:      raw.image_url ? String(raw.image_url) : undefined,
      gradientStart: '#1e293b',
      gradientEnd:   '#0f172a',
      price:         { raw: 0, currency: 'AUD', updatedAt: new Date().toISOString() },
    };
  }

  function handleAddToCollection() {
    const raw = getMatchedCard();
    if (!raw) return;
    const card = buildCard(raw);
    setShowActionSheet(false);
    router.push({
      pathname: '/add-card',
      params: { cardJson: JSON.stringify(card) },
    });
  }

  function handleAddToWishlist() {
    const raw = getMatchedCard();
    if (!raw) return;
    const card = buildCard(raw);
    addToWatchlist({
      id: `wish-scan-${Date.now()}`,
      cardId: card.id, card,
      addedAt: new Date().toISOString(),
      priceAlertEnabled: false,
    });
    setShowActionSheet(false);
    setConfirmedAction('wishlist');
    setScanState('confirmed');
  }

  function handleViewCard() {
    const card = getMatchedCard();
    if (!card) return;
    setShowActionSheet(false);
    router.push(`/card/${card.id}`);
  }

  function tryAgain() {
    setScanResult(null);
    setErrorMessage('');
    setErrorCode('');
    setConfirmedAction('');
    setScanState('idle');
  }

  // ── Permission screen ─────────────────────────────────────────────────────

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { paddingTop: topPad, paddingBottom: Math.max(botPad, 16) }]}>
        {/* Back button */}
        <Pressable
          style={[styles.permissionBackBtn, { marginHorizontal: 20, marginBottom: 8 }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={styles.permissionPanel}>
          <View style={styles.permissionIconWrap}>
            <Feather name="camera" size={52} color={C.primary} />
          </View>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionBody}>
            To scan and identify your trading cards, Verified TCG needs camera access. Your photos are only used for card recognition and are never stored.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={styles.permissionBtn}
            accessibilityRole="button"
            accessibilityLabel="Enable camera access"
          >
            <Feather name="camera" size={16} color="#FFFFFF" />
            <Text style={styles.permissionBtnText}>Enable Camera</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/add-card')}
            style={styles.ghostBtn}
            accessibilityRole="button"
            accessibilityLabel="Add card manually instead"
          >
            <Text style={styles.ghostBtnText}>Add card manually instead</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const isActiveView = scanState === 'idle' || scanState === 'capturing' || scanState === 'recognizing';
  const isMatchView  = scanState === 'match' || scanState === 'low_confidence';
  const topMatch     = scanResult?.topMatch;
  const scansLeft    = scanResult?.scansRemaining ?? (scanLimit - scansUsed);

  const hintText = isLimitExhausted
    ? 'Scan limit reached for this month'
    : scanState === 'idle'
    ? 'Position card in frame, then tap capture'
    : scanState === 'capturing'
    ? 'Hold steady…'
    : 'Identifying card…';

  const headerTitle = isMatchView
    ? 'Match Found'
    : scanState === 'confirmed'
    ? (confirmedAction === 'collection' ? 'Added!' : confirmedAction === 'wishlist' ? 'Saved!' : 'Done!')
    : 'Scan Card';

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Full-bleed camera ── */}
      {!isLimitExhausted ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flashEnabled ? 'on' : 'off'}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#040405' }]} />
      )}

      {/* ── Dim mask — 4 rects around the guide frame ── */}
      {isActiveView && (<>
        {/* Top */}
        <View style={[styles.mask, { top: 0, left: 0, right: 0, height: GUIDE_T }]} />
        {/* Bottom */}
        <View style={[styles.mask, { left: 0, right: 0, bottom: 0, height: GUIDE_B }]} />
        {/* Left */}
        <View style={[styles.mask, { top: GUIDE_T, left: 0, width: GUIDE_X, bottom: GUIDE_B }]} />
        {/* Right */}
        <View style={[styles.mask, { top: GUIDE_T, right: 0, width: GUIDE_X, bottom: GUIDE_B }]} />
      </>)}

      {/* Vignette */}
      <View style={styles.vignette} pointerEvents="none" />

      {/* ── Corner brackets ── */}
      {isActiveView && ([
        { top: GUIDE_T,          left: GUIDE_X,  bt: true,  bl: true  },
        { top: GUIDE_T,          right: GUIDE_X, bt: true,  bl: false },
        { bottom: GUIDE_B,       left: GUIDE_X,  bt: false, bl: true  },
        { bottom: GUIDE_B,       right: GUIDE_X, bt: false, bl: false },
      ] as Array<{ top?: number; bottom?: number; left?: number; right?: number; bt: boolean; bl: boolean }>)
        .map((c, i) => (
          <View key={`corner-${i}`} style={[
            styles.corner,
            {
              ...(c.top    !== undefined ? { top:    c.top    } : { bottom: c.bottom }),
              ...(c.left   !== undefined ? { left:   c.left   } : { right:  c.right  }),
              borderTopWidth:    c.bt ? 2 : 0,
              borderBottomWidth: c.bt ? 0 : 2,
              borderLeftWidth:   c.bl ? 2 : 0,
              borderRightWidth:  c.bl ? 0 : 2,
              borderTopLeftRadius:     (c.bt && c.bl)  ? 9 : 0,
              borderTopRightRadius:    (c.bt && !c.bl) ? 9 : 0,
              borderBottomLeftRadius:  (!c.bt && c.bl) ? 9 : 0,
              borderBottomRightRadius: (!c.bt && !c.bl)? 9 : 0,
            },
          ]} />
        ))
      }

      {/* Brand dots at corners */}
      {isActiveView && ([
        { top: GUIDE_T    - 3, left:  GUIDE_X  - 3 },
        { top: GUIDE_T    - 3, right: GUIDE_X  - 3 },
        { bottom: GUIDE_B - 3, left:  GUIDE_X  - 3 },
        { bottom: GUIDE_B - 3, right: GUIDE_X  - 3 },
      ] as Array<{ top?: number; bottom?: number; left?: number; right?: number }>)
        .map((p, i) => (
          <View key={`dot-${i}`} style={[styles.cornerDot, p]} />
        ))
      }

      {/* ── Animated scan beam (recognizing state) ── */}
      {scanState === 'recognizing' && (
        <Animated.View
          style={[
            styles.scanLine,
            {
              top:   GUIDE_T,
              left:  GUIDE_X,
              right: GUIDE_X,
              transform: [{ translateY: scanLineY }],
            },
          ]}
        />
      )}

      {/* ── Hint text (idle / capturing / recognizing) ── */}
      {isActiveView && (
        <View style={[styles.hintRow, { bottom: GUIDE_B - 22 }]} pointerEvents="none">
          <Text style={styles.hint}>{hintText}</Text>
          {scanState === 'recognizing' && (
            <ActivityIndicator size="small" color={C.primary} style={{ marginTop: 6 }} />
          )}
        </View>
      )}

      {/* ── Capturing / recognizing badge over frame ── */}
      {(scanState === 'capturing' || scanState === 'recognizing') && (
        <View style={[styles.scanningBadge, { top: GUIDE_T + 12 }]} pointerEvents="none">
          <View style={styles.scanDot} />
          <Text style={styles.scanningText}>
            {scanState === 'capturing' ? 'CAPTURING' : 'IDENTIFYING'}
          </Text>
        </View>
      )}

      {/* ── Limit exhausted overlay inside guide area ── */}
      {isLimitExhausted && isActiveView && (
        <View style={[styles.exhaustedOverlay, { top: GUIDE_T, left: GUIDE_X, right: GUIDE_X, bottom: GUIDE_B }]}>
          <Feather name="camera-off" size={48} color={`${C.mutedForeground}55`} />
        </View>
      )}

      {/* ── Scan limit banner ── */}
      {scanState === 'idle' && (
        <View style={[styles.bannerWrap, { top: topPad + 64 }]}>
          <ScanLimitBanner />
        </View>
      )}

      {/* ── Match result (floats over camera) ── */}
      {isMatchView && topMatch && (
        <Animated.View style={[
          styles.overlayPanel,
          { top: GUIDE_T, bottom: GUIDE_B, opacity: fadeAnim, transform: [{ scale: pulseAnim }] },
        ]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {scanState === 'low_confidence' && (
              <View style={styles.lowConfBanner}>
                <Feather name="alert-triangle" size={14} color="#F59E0B" />
                <Text style={styles.lowConfText}>Low confidence — please verify</Text>
              </View>
            )}
            <View style={styles.confidenceBadge}>
              <Text style={[styles.confidenceNum, scanState === 'low_confidence' && { color: '#F59E0B' }]}>
                {topMatch.confidence}%
              </Text>
              <Text style={styles.confidenceLabel}>MATCH</Text>
            </View>
            <View style={styles.matchCard}>
              {topMatch.card.image_url ? (
                <Image source={{ uri: String(topMatch.card.image_url) }} style={styles.matchThumb} contentFit="cover" />
              ) : (
                <View style={[styles.matchThumb, { backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={styles.matchInitial}>{String(topMatch.card.name ?? '?')[0]}</Text>
                </View>
              )}
              <View style={styles.matchInfo}>
                <Text style={styles.matchName}>{String(topMatch.card.name ?? '')}</Text>
                <Text style={styles.matchSet}>{String(topMatch.card.set_name ?? topMatch.card.set ?? '')}</Text>
                {topMatch.card.number ? (
                  <Text style={styles.matchNumber}>#{String(topMatch.card.number)}</Text>
                ) : null}
                {typeof topMatch.card.price === 'number' && topMatch.card.price > 0 ? (
                  <Text style={styles.matchPrice}>${topMatch.card.price.toFixed(2)} USD</Text>
                ) : null}
              </View>
            </View>
            {scanState === 'low_confidence' && scanResult?.extracted && (() => {
              const { name, setName, number } = scanResult.extracted;
              const parts = [name, setName, number ? `#${number}` : ''].filter(f => f.trim() !== '');
              if (parts.length === 0) return null;
              return (
                <View style={styles.lcExtractedRow}>
                  <Text style={styles.lcExtractedLabel}>AI read:</Text>
                  <Text style={styles.lcExtractedText} numberOfLines={2}>{parts.join(' · ')}</Text>
                </View>
              );
            })()}
            {(scanResult?.matches?.length ?? 0) > 1 && (
              <ScrollView style={styles.altsList} horizontal showsHorizontalScrollIndicator={false}>
                {scanResult!.matches.slice(1).map((m, i) => (
                  <View key={i} style={styles.altChip}>
                    <Text style={styles.altChipText} numberOfLines={1}>{String(m.card.name ?? '')}</Text>
                    <Text style={styles.altChipConf}>{m.confidence}%</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </ScrollView>
        </Animated.View>
      )}

      {/* ── Error state (floats over camera) ── */}
      {scanState === 'error' && (() => {
        const errorConfig: Record<ScanErrorCode, {
          icon: React.ComponentProps<typeof Feather>['name'];
          iconColor: string;
          title: string;
          tips: string[];
        }> = {
          image_quality: {
            icon: 'sun', iconColor: '#F59E0B',
            title: 'Image too dark or blank',
            tips: ['Move to a brighter area or enable flash', 'Make sure the card is fully inside the frame', 'Hold the phone steady before tapping Capture'],
          },
          unreadable: {
            icon: 'eye-off', iconColor: '#F59E0B',
            title: 'Card may be blurry or out of frame',
            tips: ['Center the card inside the guide corners', 'Hold steady — avoid moving while capturing', 'Try turning on flash for low-light conditions'],
          },
          no_match: {
            icon: 'search', iconColor: C.mutedForeground,
            title: 'No matching card found',
            tips: ['Use Search Manually to find it by name', 'Check spelling if you type the name yourself'],
          },
          api_error: {
            icon: 'alert-circle', iconColor: C.mutedForeground,
            title: 'Couldn\'t identify card',
            tips: ['Check your connection and try again', 'Or use Search Manually to find the card'],
          },
          '': { icon: 'alert-circle', iconColor: C.mutedForeground, title: 'Couldn\'t identify card', tips: [] },
        };
        const cfg = errorConfig[errorCode] ?? errorConfig[''];
        const partialText = errorCode === 'no_match'
          ? [scanResult?.extracted?.name, scanResult?.extracted?.setName].filter(Boolean).join(' — ')
          : '';
        return (
          <View style={[styles.overlayPanel, { top: GUIDE_T, bottom: GUIDE_B, alignItems: 'center', justifyContent: 'center', gap: 4 }]}>
            <Feather name={cfg.icon} size={44} color={cfg.iconColor} style={{ marginBottom: 12 }} />
            <Text style={styles.errorTitle}>{cfg.title}</Text>
            {partialText ? (
              <View style={styles.errorPartialWrap}>
                <Text style={styles.errorPartialLabel}>Text read from card:</Text>
                <Text style={styles.errorPartialText}>{partialText}</Text>
              </View>
            ) : null}
            {cfg.tips.length > 0 && (
              <View style={styles.errorTipsList}>
                {cfg.tips.map((tip, i) => (
                  <View key={i} style={styles.errorTipRow}>
                    <View style={styles.errorTipDot} />
                    <Text style={styles.errorTipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })()}

      {/* ── Auto-searching state (floats over camera) ── */}
      {scanState === 'auto_searching' && scanResult && (() => {
        const { name, setName, number } = scanResult.extracted;
        const parts = [name, setName, number].filter(f => f.trim() !== '');
        return (
          <View style={[styles.overlayPanel, { top: GUIDE_T, bottom: GUIDE_B, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.autoSearchTitle}>Reading card…</Text>
            <View style={styles.autoSearchExtractedWrap}>
              <Text style={styles.autoSearchExtractedLabel}>Found:</Text>
              <Text style={styles.autoSearchExtractedText}>{parts.join(' · ')}</Text>
            </View>
            <Text style={styles.autoSearchHint}>Taking you to search…</Text>
          </View>
        );
      })()}

      {/* ── Confirmed state (floats over camera) ── */}
      {scanState === 'confirmed' && topMatch && (
        <View style={[styles.overlayPanel, { top: GUIDE_T, bottom: GUIDE_B, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
          <View style={styles.confirmedIconWrap}>
            <Feather name="check-circle" size={52} color={C.positive} />
          </View>
          <Text style={styles.confirmedTitle}>{String(topMatch.card.name ?? '')}</Text>
          <Text style={styles.confirmedSub}>
            {confirmedAction === 'collection' ? 'Added to your collection' : confirmedAction === 'wishlist' ? 'Added to your wishlist' : 'Done!'}
          </Text>
          <View style={[styles.confirmedMeta, { backgroundColor: C.card }]}>
            <Text style={styles.confirmedMetaText}>
              {String(topMatch.card.set_name ?? topMatch.card.set ?? '')}
              {topMatch.card.number ? ` · #${topMatch.card.number}` : ''}
            </Text>
          </View>
        </View>
      )}

      {/* ── Floating header ── */}
      <View style={[styles.header, { top: topPad + 8 }]}>
        {/* Back button */}
        <Pressable
          style={styles.glassBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
        >
          <Feather name="chevron-left" size={20} color="#fff" />
        </Pressable>

        <Text style={styles.title}>{headerTitle}</Text>

        <View style={styles.headerRight}>
          {!canUseUnlimitedScanner(subscriptionTier) && scanState === 'idle' && (
            <Pressable
              style={styles.scanCountPill}
              onPress={() => router.push('/pro-subscription')}
              accessibilityRole="button"
              accessibilityLabel={`${Math.max(0, scansLeft)} scans remaining`}
              hitSlop={8}
            >
              <Feather name="camera" size={12} color={scansLeft <= 5 ? '#F59E0B' : 'rgba(255,255,255,0.65)'} />
              <Text style={[styles.scanCountText, scansLeft <= 5 && { color: '#F59E0B' }]}>
                {Math.max(0, scansLeft)} left
              </Text>
            </Pressable>
          )}
          <Pressable
            style={styles.glassBtn}
            onPress={() => router.push('/add-card')}
            accessibilityRole="button"
            accessibilityLabel="Add card manually"
            hitSlop={8}
          >
            <Feather name="plus" size={19} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* ── Bottom controls ── */}
      <View style={[styles.controls, { bottom: Math.max(botPad, 32) }]}>

        {/* Recent scans toggle (idle only) */}
        {scanState === 'idle' && recentScans.length > 0 && (
          <Pressable
            onPress={toggleDrawer}
            style={styles.recentToggle}
            accessibilityRole="button"
            accessibilityLabel={drawerOpen ? 'Hide recent scans' : 'Show recent scans'}
          >
            <Feather name="clock" size={12} color="rgba(255,255,255,0.5)" />
            <Text style={styles.recentToggleText}>Recent scans</Text>
            <Feather
              name={drawerOpen ? 'chevron-down' : 'chevron-up'}
              size={13}
              color="rgba(255,255,255,0.4)"
            />
          </Pressable>
        )}

        {/* Flash · Shutter · Search (active state) */}
        {isActiveView && (
          <View style={styles.iconRow}>
            {/* Flash */}
            <Pressable
              onPress={() => setFlashEnabled(f => !f)}
              disabled={isLimitExhausted || scanState !== 'idle'}
              style={[
                styles.sideBtn,
                flashEnabled && !isLimitExhausted && styles.sideBtnFlash,
                (isLimitExhausted || scanState !== 'idle') && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={flashEnabled ? 'Flash on' : 'Flash off'}
            >
              <Feather
                name="zap"
                size={22}
                color={
                  isLimitExhausted
                    ? 'rgba(255,255,255,0.3)'
                    : flashEnabled
                    ? '#F59E0B'
                    : 'rgba(255,255,255,0.8)'
                }
              />
            </Pressable>

            {/* Shutter */}
            {isLimitExhausted ? (
              <View style={styles.limitReachedLabel}>
                <Feather name="lock" size={16} color={C.mutedForeground} />
                <Text style={styles.limitReachedText}>Scan limit reached</Text>
              </View>
            ) : (
              <View>
                {/* Pulsing glow ring */}
                <Animated.View style={[styles.shutterGlowRing, { transform: [{ scale: shutterGlow }] }]} />
                <Pressable
                  onPress={handleCapture}
                  disabled={scanState !== 'idle'}
                  style={[styles.shutterBtn, scanState !== 'idle' && styles.btnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Capture card"
                >
                  <View style={styles.shutterInnerRing} />
                  {scanState === 'idle'
                    ? <Feather name="camera" size={30} color="#fff" />
                    : <ActivityIndicator size="small" color="#fff" />}
                </Pressable>
              </View>
            )}

            {/* Search */}
            <Pressable
              onPress={() => router.push('/search')}
              disabled={isLimitExhausted || scanState !== 'idle'}
              style={[
                styles.sideBtn,
                (isLimitExhausted || scanState !== 'idle') && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Search cards manually"
            >
              <Feather name="search" size={22} color={isLimitExhausted ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)'} />
            </Pressable>
          </View>
        )}

        {/* Match actions */}
        {isMatchView && (
          <View style={styles.actionStack}>
            <Pressable
              onPress={handleConfirm}
              style={styles.primaryActionBtn}
              accessibilityRole="button"
              accessibilityLabel="Confirm match and save card"
            >
              <Feather name="check" size={18} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>That's the one — save it</Text>
            </Pressable>
            <Pressable
              onPress={handleSearchManually}
              style={styles.secondaryActionBtn}
              accessibilityRole="button"
              accessibilityLabel="Not right? Search manually"
            >
              <Feather name="search" size={16} color={C.foreground} />
              <Text style={styles.secondaryActionText}>Not right? Search manually</Text>
            </Pressable>
            <Pressable onPress={tryAgain} style={styles.ghostBtn} accessibilityRole="button" accessibilityLabel="Scan again">
              <Text style={styles.ghostBtnText}>Scan Again</Text>
            </Pressable>
          </View>
        )}

        {/* Error actions */}
        {scanState === 'error' && (
          <View style={styles.actionStack}>
            <Pressable onPress={tryAgain} style={styles.primaryActionBtn} accessibilityRole="button" accessibilityLabel="Try scanning again">
              <Feather name="camera" size={18} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>
                {errorCode === 'image_quality' || errorCode === 'unreadable' ? 'Try Again' : 'Scan Again'}
              </Text>
            </Pressable>
            <Pressable onPress={handleSearchManually} style={styles.secondaryActionBtn} accessibilityRole="button" accessibilityLabel="Search manually">
              <Feather name="search" size={16} color={C.foreground} />
              <Text style={styles.secondaryActionText}>
                {errorCode === 'no_match' && scanResult?.extracted?.name
                  ? `Search "${scanResult.extracted.name}"`
                  : 'Search Manually'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Confirmed actions */}
        {scanState === 'confirmed' && topMatch && (
          <View style={styles.actionStack}>
            <Pressable
              onPress={() => router.push(`/card/${topMatch.card.id}`)}
              style={styles.primaryActionBtn}
              accessibilityRole="button"
              accessibilityLabel={`View details for ${String(topMatch.card.name ?? '')}`}
            >
              <Text style={styles.primaryActionText}>View Card Detail</Text>
            </Pressable>
            <Pressable onPress={tryAgain} style={styles.ghostBtn} accessibilityRole="button" accessibilityLabel="Scan another card">
              <Text style={styles.ghostBtnText}>Scan Another Card</Text>
            </Pressable>
          </View>
        )}

        {/* Pro upgrade nudge when ≤5 scans remain */}
        {!canUseUnlimitedScanner(subscriptionTier) && scansLeft <= 5 && scansLeft > 0 && scanState === 'idle' && (
          <Pressable
            onPress={() => router.push('/pro-subscription')}
            style={styles.upgradeLinkRow}
            accessibilityRole="button"
            accessibilityLabel={`${scansLeft} scans remaining. Upgrade to Pro`}
          >
            <Feather name="zap" size={13} color={C.primary} />
            <Text style={styles.upgradeLinkText}>
              {scansLeft === 1 ? '1 scan remaining — upgrade for unlimited' : `${scansLeft} scans remaining — upgrade for unlimited`}
            </Text>
            <Feather name="chevron-right" size={13} color={C.primary} />
          </Pressable>
        )}

        {isLimitExhausted && (
          <Pressable
            onPress={() => router.push('/pro-subscription')}
            style={styles.upgradeLinkRow}
            accessibilityRole="button"
            accessibilityLabel="Upgrade to Pro for unlimited scanning"
          >
            <Feather name="zap" size={13} color={C.primary} />
            <Text style={styles.upgradeLinkText}>Upgrade to Pro for unlimited scanning</Text>
            <Feather name="chevron-right" size={13} color={C.primary} />
          </Pressable>
        )}
      </View>

      {/* ── Recent scans slide-up drawer ── */}
      {drawerOpen && (
        <Animated.View
          style={[
            styles.drawer,
            { height: DRAWER_H, transform: [{ translateY: drawerTranslateY }] },
          ]}
        >
          <View style={styles.drawerHandle} />
          <View style={styles.drawerHeader}>
            <Feather name="clock" size={13} color="rgba(255,255,255,0.35)" />
            <Text style={styles.drawerTitle}>Recent Scans</Text>
          </View>
          {recentScans.slice(0, 5).map((scan) => (
            <Pressable
              key={`${scan.cardId}-${scan.scannedAt}`}
              onPress={() => { toggleDrawer(); router.push(`/card/${scan.cardId}`); }}
              style={styles.recentRow}
              accessibilityRole="button"
              accessibilityLabel={`View ${scan.name}`}
            >
              {scan.imageUrl ? (
                <Image source={{ uri: scan.imageUrl }} style={styles.recentThumb} contentFit="cover" />
              ) : (
                <View style={[styles.recentThumb, styles.recentThumbFallback]}>
                  <Text style={styles.recentThumbInitial}>
                    {scan.name ? scan.name[0].toUpperCase() : '?'}
                  </Text>
                </View>
              )}
              <View style={styles.recentInfo}>
                <Text style={styles.recentName} numberOfLines={1}>{scan.name}</Text>
                <Text style={styles.recentMeta} numberOfLines={1}>
                  {[scan.setName, scan.number ? `#${scan.number}` : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.2)" />
            </Pressable>
          ))}
        </Animated.View>
      )}

      {/* ── Scan limit modal ── */}
      <Modal visible={showLimitSheet} transparent animationType="slide" onRequestClose={() => setShowLimitSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowLimitSheet(false)} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, { paddingBottom: Math.max(botPad, 24) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetIconWrap}>
            <Feather name="camera-off" size={32} color={C.mutedForeground} />
          </View>
          <Text style={styles.sheetTitle}>Monthly scan limit reached</Text>
          <Text style={styles.sheetBody}>
            You've used your 30 free scans this month.{'\n'}Resets {resetLabel}.
          </Text>
          <Pressable
            onPress={() => { setShowLimitSheet(false); router.push('/pro-subscription'); }}
            style={styles.sheetPrimaryBtn}
            accessibilityRole="button"
            accessibilityLabel="Unlock unlimited scanning"
          >
            <Feather name="zap" size={16} color="#FFFFFF" />
            <Text style={styles.sheetPrimaryBtnText}>Unlock Unlimited Scanning</Text>
          </Pressable>
          <Pressable onPress={() => setShowLimitSheet(false)} style={styles.sheetGhostBtn} accessibilityRole="button" accessibilityLabel="Got it">
            <Text style={styles.sheetGhostBtnText}>Got it</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Action sheet ── */}
      <Modal visible={showActionSheet} transparent animationType="slide" onRequestClose={() => setShowActionSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowActionSheet(false)} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, { paddingBottom: Math.max(botPad, 24) }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>What would you like to do?</Text>
          {topMatch && (
            <Text style={styles.sheetCardName}>{String(topMatch.card.name ?? '')}</Text>
          )}
          <Pressable onPress={handleAddToCollection} style={styles.sheetActionBtn} accessibilityRole="button" accessibilityLabel="Add to collection">
            <Feather name="layers" size={18} color={C.foreground} />
            <Text style={styles.sheetActionText}>Add to Collection</Text>
            <Feather name="chevron-right" size={16} color={C.mutedForeground} />
          </Pressable>
          <Pressable onPress={handleAddToWishlist} style={styles.sheetActionBtn} accessibilityRole="button" accessibilityLabel="Add to wishlist">
            <Feather name="heart" size={18} color={C.foreground} />
            <Text style={styles.sheetActionText}>Add to Wishlist</Text>
            <Feather name="chevron-right" size={16} color={C.mutedForeground} />
          </Pressable>
          <Pressable onPress={handleViewCard} style={styles.sheetActionBtn} accessibilityRole="button" accessibilityLabel="View card detail">
            <Feather name="eye" size={18} color={C.foreground} />
            <Text style={styles.sheetActionText}>View Card Detail</Text>
            <Feather name="chevron-right" size={16} color={C.mutedForeground} />
          </Pressable>
          <Pressable onPress={() => setShowActionSheet(false)} style={styles.sheetGhostBtn} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.sheetGhostBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Overlays
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // can't do radial gradient in RN — light vignette via edges
  },

  // Corner guide brackets
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'rgba(255,255,255,0.82)',
  },
  cornerDot: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#CC1826',
    shadowColor: '#CC1826',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },

  // Scan beam
  scanLine: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#CC1826',
    shadowColor: '#CC1826',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    borderRadius: 1,
    zIndex: 3,
  },

  // Hint text
  hintRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.2,
    textAlign: 'center',
  },

  // Capturing badge
  scanningBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 4,
  },
  scanDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#CC1826',
  },
  scanningText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 2,
  },

  // Exhausted overlay
  exhaustedOverlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  // Scan limit banner
  bannerWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 20,
  },

  // Floating header
  header: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  glassBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scanCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  scanCountText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.65)',
  },

  // Bottom controls
  controls: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    gap: 16,
    zIndex: 20,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  sideBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBtnFlash: {
    backgroundColor: 'rgba(245,158,11,0.16)',
    borderColor: 'rgba(245,158,11,0.45)',
  },
  btnDisabled: { opacity: 0.35 },

  // Shutter
  shutterGlowRing: {
    position: 'absolute',
    top: -8, left: -8, right: -8, bottom: -8,
    borderRadius: 50,
    backgroundColor: 'rgba(204,24,38,0.18)',
    zIndex: 0,
  },
  shutterBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#CC1826',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#CC1826',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 18,
    elevation: 10,
    zIndex: 1,
  },
  shutterInnerRing: {
    position: 'absolute',
    top: 5, left: 5, right: 5, bottom: 5,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  limitReachedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  limitReachedText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },

  // Recent scans toggle
  recentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  recentToggleText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.5)',
  },

  // Upgrade nudge
  upgradeLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  upgradeLinkText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },

  // Action buttons
  actionStack: { gap: 10, alignSelf: 'stretch' },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#CC1826',
  },
  primaryActionText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  secondaryActionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  ghostBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.45)' },

  // Overlay panels (match / error / confirmed / auto-search)
  overlayPanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: 'rgba(8,8,12,0.88)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  // Match panel
  lowConfBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F59E0B18', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#F59E0B44',
  },
  lowConfText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#F59E0B' },
  confidenceBadge: { alignItems: 'center' },
  confidenceNum: { fontSize: 40, fontFamily: 'Inter_700Bold', color: C.positive },
  confidenceLabel: {
    fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground,
    letterSpacing: 2, textTransform: 'uppercase',
  },
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  matchThumb: { width: 70, height: 98, borderRadius: 10 },
  matchInitial: { fontSize: 36, fontFamily: 'Rajdhani_700Bold', color: 'rgba(255,255,255,0.8)' },
  matchInfo: { flex: 1, gap: 4 },
  matchName: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  matchSet: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  matchNumber: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}88` },
  matchPrice: { fontSize: 16, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginTop: 2 },
  altsList: { marginTop: 4 },
  altChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    marginRight: 8, borderWidth: 1, borderColor: C.border,
  },
  altChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.foreground, maxWidth: 120 },
  altChipConf: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  lcExtractedRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10, flexWrap: 'wrap',
  },
  lcExtractedLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground, marginTop: 1 },
  lcExtractedText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}CC`, lineHeight: 17 },

  // Error panel
  errorTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginBottom: 4, textAlign: 'center' },
  errorPartialWrap: {
    backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
    alignSelf: 'stretch', marginTop: 6,
  },
  errorPartialLabel: {
    fontSize: 10, fontFamily: 'Inter_500Medium', color: C.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  errorPartialText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground },
  errorTipsList: {
    alignSelf: 'stretch', gap: 8, marginTop: 10,
    backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border,
  },
  errorTipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  errorTipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary, marginTop: 6 },
  errorTipText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 19 },

  // Auto-search
  autoSearchTitle: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, textAlign: 'center' },
  autoSearchExtractedWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border, flexWrap: 'wrap', justifyContent: 'center',
  },
  autoSearchExtractedLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  autoSearchExtractedText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  autoSearchHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', marginTop: 4 },

  // Confirmed
  confirmedIconWrap: { marginBottom: 4 },
  confirmedTitle: { fontSize: 24, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  confirmedSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  confirmedMeta: {
    alignItems: 'center', gap: 4, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 20, marginTop: 4,
  },
  confirmedMetaText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Recent scans drawer
  drawer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,8,10,0.97)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingTop: 10,
    paddingHorizontal: 20,
    zIndex: 30,
  },
  drawerHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center', marginBottom: 16,
  },
  drawerHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12,
  },
  drawerTitle: {
    fontSize: 11, fontFamily: 'Inter_700Bold',
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  recentThumb: { width: 40, height: 54, borderRadius: 7 },
  recentThumbFallback: { backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
  recentThumbInitial: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: 'rgba(255,255,255,0.7)' },
  recentInfo: { flex: 1, gap: 3 },
  recentName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  recentMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.38)' },

  // Modals / sheets
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20, gap: 4,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: C.border, alignSelf: 'center', marginBottom: 16,
  },
  sheetIconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: C.border,
  },
  sheetTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, textAlign: 'center', marginBottom: 8 },
  sheetCardName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.mutedForeground, textAlign: 'center', marginBottom: 12 },
  sheetBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  sheetActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  sheetActionText: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: C.foreground },
  sheetPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: '#CC1826',
    alignSelf: 'stretch', marginBottom: 10,
  },
  sheetPrimaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  sheetGhostBtn: { height: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', marginBottom: 4 },
  sheetGhostBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.mutedForeground },

  // Permission screen
  permissionBackBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  permissionPanel: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, gap: 16,
  },
  permissionIconWrap: {
    width: 96, height: 96, borderRadius: 28,
    backgroundColor: `${C.primary}15`,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  permissionTitle: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground, textAlign: 'center' },
  permissionBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 20 },
  permissionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 14, backgroundColor: '#CC1826',
    alignSelf: 'stretch', marginTop: 8,
  },
  permissionBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
