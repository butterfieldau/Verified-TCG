import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import type { CollectionItem } from '@/types';
import { canUseUnlimitedScanner } from '@/services/subscription';
import ScanLimitBanner from '@/components/ui/ScanLimitBanner';
import { getAccessToken } from '@/services/auth';
import {
  type RecentScan,
  loadRecentScans,
  appendRecentScan,
  clearRecentScans,
  getScanGeneration,
} from '@/services/scanStatePersistence';

const C = colors.dark;
const { width: W } = Dimensions.get('window');
const FRAME_W = Math.min(W - 64, 280);
const FRAME_H = FRAME_W * 1.4;

// Height of the absolute-positioned tab bar (matches _layout.tsx)
const TAB_BAR_HEIGHT = Platform.OS === 'web' ? 84 : 74;

// API base — same pattern as other service files
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

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
  /** True when GPT returned no readable text — image was likely blurry/dark/out-of-frame. */
  imageUnreadable: boolean;
  extracted: { name: string; setName: string; number: string };
  scansUsed: number;
  scanLimit: number | null;
  scansRemaining: number | null;
}

/**
 * Minimum base64 character count for a plausible card photo.
 *
 * A completely black or featureless JPEG compresses to ~1–3 KB; a real card
 * at expo-camera quality=0.5 will be at least 30 KB.  We use 8 000 chars
 * (~6 KB binary) as a conservative cut-off that avoids false positives while
 * flagging genuinely blank/dark captures before wasting an API call.
 */
const MIN_IMAGE_B64_CHARS = 8_000;

/**
 * Classify what kind of error occurred after a failed scan so the UI can show
 * a targeted message and tips.
 *
 * - image_quality : client detected a suspiciously small image (blank/dark)
 * - unreadable    : API returned imageUnreadable=true (GPT read no text)
 * - no_match      : GPT read text but nothing matched in the catalog
 * - api_error     : network / server / vision-API failure
 */
type ScanErrorCode = 'image_quality' | 'unreadable' | 'no_match' | 'api_error' | '';

// ── API error type ────────────────────────────────────────────────────────────

/** Error thrown by recognizeCard for all non-200 responses. */
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

/**
 * Send a card image to the recognition endpoint and return the result.
 *
 * All non-200 responses are thrown as `ScanApiError` with the full quota
 * payload preserved (scansUsed / scanLimit / scansRemaining) so the caller
 * can sync client state even when recognition fails after a scan was charged.
 */
async function recognizeCard(base64Image: string): Promise<ScanResult> {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE}/api/scan/recognize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ image: base64Image, mimeType: 'image/jpeg' }),
  });

  if (!response.ok) {
    // Parse the full error body — every server error path should include
    // quota fields so the client can stay in sync even after a charged failure.
    const body = await response.json().catch(() => ({})) as {
      message?: string;
      scansUsed?: number;
      scanLimit?: number | null;
      scansRemaining?: number | null;
    };

    throw new ScanApiError(
      body.message ?? `Recognition failed (${response.status})`,
      {
        code: response.status === 403 ? 'LIMIT_REACHED' : undefined,
        scansUsed: body.scansUsed,
        scanLimit: body.scanLimit,
        scansRemaining: body.scansRemaining,
      },
    );
  }

  return response.json() as Promise<ScanResult>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { user, addToCollection, addToWatchlist, subscriptionTier, scansUsed, scanLimit, scanResetDate, syncScanCount } = useApp();

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

  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  // Incremented on each sign-out so stale async callbacks can detect they
  // belong to an old session and discard their results.
  const sessionIdRef = useRef(0);

  const cameraRef = useRef<CameraView>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // ── Recent scans ─────────────────────────────────────────────────────────

  // Load persisted scans on first mount.  Discard the result if the session
  // has already been invalidated (sign-out happened while the load was in
  // flight) by comparing the captured sessionId to the current ref value.
  useEffect(() => {
    const mySession = sessionIdRef.current;
    loadRecentScans()
      .then(scans => {
        if (sessionIdRef.current === mySession) setRecentScans(scans);
      })
      .catch(() => {});
  }, []);

  // Wipe in-memory recent scans when the user signs out.
  // AsyncStorage is already cleared by AppContext.signOut() — this only resets
  // the React state so the tab doesn't show the previous user's list while
  // still mounted.  The session ID is bumped so any in-flight load or append
  // that completes after sign-out cannot repopulate the list.
  useEffect(() => {
    if (!user) {
      sessionIdRef.current += 1;
      setRecentScans([]);
    }
  }, [user]);

  const resetLabel = scanResetDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  // ── Animations ───────────────────────────────────────────────────────────

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

  const scanLineY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME_H - 4] });

  // ── Capture & recognize ──────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (isLimitExhausted || scanState !== 'idle') return;

    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }

    // Capture both the React session ref AND the module-level scan generation
    // BEFORE any await.  The module generation is the authoritative guard for
    // AsyncStorage writes (it is incremented synchronously by clearRecentScans
    // inside AppContext.signOut, before any React effects run).  The React ref
    // guards in-memory state updates.
    const sessionAtCapture = sessionIdRef.current;
    const scanGenAtCapture = getScanGeneration();

    setScanState('capturing');

    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.5, // compress to reduce payload size
        skipProcessing: true,
      });

      if (!photo?.base64) {
        setErrorMessage('Could not capture image. Please try again.');
        setErrorCode('api_error');
        setScanState('error');
        return;
      }

      // ── Client-side image quality pre-flight ────────────────────────────
      // A JPEG with almost no content (dark/blank frame) compresses to a
      // very small file.  If the base64 string is shorter than our minimum
      // threshold we skip the API call and surface a targeted tip instead.
      if (photo.base64.length < MIN_IMAGE_B64_CHARS) {
        setErrorMessage('The image looks too dark or blank.');
        setErrorCode('image_quality');
        setScanState('error');
        return;
      }

      setScanState('recognizing');

      const result = await recognizeCard(photo.base64);

      // Discard all post-recognition work if sign-out ran while the
      // network request was in flight.  The module generation advances
      // synchronously inside clearRecentScans (called from AppContext.signOut)
      // — this fires before any React effect, so the comparison is reliable
      // even if the component's user-watcher effect hasn't run yet.
      if (getScanGeneration() !== scanGenAtCapture) return;

      // Sync scan count from server-authoritative response.
      // The server atomically incremented the count (even on recognition failure),
      // so we always use the returned value rather than a local increment — this
      // keeps the gate accurate across device switches and charged failures.
      if (!canUseUnlimitedScanner(subscriptionTier) && typeof result.scansUsed === 'number') {
        syncScanCount(result.scansUsed);
      }

      setScanResult(result);

      if (!result.topMatch) {
        if (result.imageUnreadable) {
          // GPT returned no text — image was likely blurry/dark/out-of-frame
          setErrorMessage('Card may be blurry or out of frame.');
          setErrorCode('unreadable');
          setScanState('error');
        } else {
          // GPT read some text but nothing matched the catalog.
          // If any fields were extracted, auto-navigate to search with them pre-filled.
          const { name, setName, number } = result.extracted;
          const hasExtracted = [name, setName, number].some(f => f.trim() !== '');
          if (hasExtracted) {
            const query = [name, setName, number].filter(f => f.trim() !== '').join(' ');
            setScanState('auto_searching');
            setTimeout(() => {
              router.push(`/search?q=${encodeURIComponent(query)}`);
              // Reset scan state so the user returns to the idle scanner
              setScanResult(null);
              setErrorMessage('');
              setErrorCode('');
              setScanState('idle');
            }, 2000);
          } else {
            // Nothing at all was extracted — show the standard error
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

      // Persist a recent-scan entry for every recognised card (including
      // low-confidence matches) so the collector can revisit it.
      //
      // Pass scanGenAtCapture — the generation at scan-start — to
      // appendRecentScan.  It compares this against the current generation
      // at both the start and end of its async read, so a clear that ran at
      // any point since scan-start causes the write to be aborted.
      if (result.topMatch) {
        const raw = result.topMatch.card;
        const entry: RecentScan = {
          cardId: String(raw.id ?? ''),
          name: String(raw.name ?? ''),
          setName: String(raw.set_name ?? raw.set ?? ''),
          number: String(raw.number ?? ''),
          imageUrl: raw.image_url ? String(raw.image_url) : undefined,
          scannedAt: new Date().toISOString(),
        };
        appendRecentScan(entry, scanGenAtCapture)
          .then(updated => {
            // Guard the in-memory state update against the React session ref
            // (covers the case where the effect has run and incremented it).
            if (sessionIdRef.current === sessionAtCapture) setRecentScans(updated);
          })
          .catch(() => {});
      }
    } catch (err: unknown) {
      const e = err as Error & { code?: string; scansUsed?: number };
      if (e.code === 'LIMIT_REACHED') {
        // Server returned 403 before calling vision API — no scan was charged
        setScanState('idle');
        setShowLimitSheet(true);
      } else {
        // If the server charged the scan and included a count in the error
        // body (503 from vision API), sync it so the client stays accurate.
        if (!canUseUnlimitedScanner(subscriptionTier) && typeof e.scansUsed === 'number') {
          syncScanCount(e.scansUsed);
        }
        setErrorMessage(e.message ?? 'Recognition failed. Please try again or search manually.');
        setErrorCode('api_error');
        setScanState('error');
      }
    }
  }, [isLimitExhausted, scanState, permission, subscriptionTier, syncScanCount, requestPermission]);

  // ── Actions after match ──────────────────────────────────────────────────

  function getMatchedCard() {
    return scanResult?.topMatch?.card ?? null;
  }

  function handleConfirm() {
    setShowActionSheet(true);
  }

  function handleSearchManually() {
    const extracted = scanResult?.extracted;
    const query = [extracted?.name, extracted?.setName, extracted?.number].filter(Boolean).join(' ');
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  }

  /** Build a typed Card from a raw catalog result, filling required fields with safe defaults. */
  function buildCard(raw: Record<string, unknown>): import('@/types').Card {
    return {
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      setId: String(raw.set ?? raw.set_id ?? ''),
      setName: String(raw.set_name ?? raw.set ?? ''),
      tcg: (String(raw.game ?? 'pokemon').toLowerCase().includes('magic') ? 'magic' : String(raw.game ?? 'pokemon').toLowerCase().includes('yugioh') || String(raw.game ?? '').toLowerCase().includes('yu-gi-oh') ? 'yugioh' : 'pokemon') as import('@/types').TCGId,
      number: String(raw.number ?? ''),
      rarity: 'rare',
      year: new Date().getFullYear(),
      imageUrl: raw.image_url ? String(raw.image_url) : undefined,
      gradientStart: '#1e293b',
      gradientEnd: '#0f172a',
      price: { raw: 0, currency: 'AUD', updatedAt: new Date().toISOString() },
    };
  }

  function handleAddToCollection() {
    const raw = getMatchedCard();
    if (!raw) return;

    const card = buildCard(raw);
    const item: CollectionItem = {
      id: `col-scan-${Date.now()}`,
      cardId: card.id,
      card,
      quantity: 1,
      condition: 'near_mint',
      acquiredAt: new Date().toISOString().split('T')[0],
      acquiredPrice: 0,
      currency: 'AUD',
    };

    addToCollection(item);
    setShowActionSheet(false);
    setConfirmedAction('collection');
    setScanState('confirmed');
  }

  function handleAddToWishlist() {
    const raw = getMatchedCard();
    if (!raw) return;

    const card = buildCard(raw);
    addToWatchlist({
      id: `wish-scan-${Date.now()}`,
      cardId: card.id,
      card,
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

  // ── Permission prompt ────────────────────────────────────────────────────

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { paddingTop: topPad, paddingBottom: Math.max(botPad, 16) }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan Card</Text>
        </View>
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

  // ── Main render ──────────────────────────────────────────────────────────

  const isActiveView = scanState === 'idle' || scanState === 'capturing' || scanState === 'recognizing';
  const isMatchView = scanState === 'match' || scanState === 'low_confidence';
  const topMatch = scanResult?.topMatch;
  const scansLeft = scanResult?.scansRemaining ?? (scanLimit - scansUsed);

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: Math.max(botPad + TAB_BAR_HEIGHT, 16) }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {isMatchView ? 'Match Found' : scanState === 'confirmed' ? (confirmedAction === 'collection' ? 'Added!' : confirmedAction === 'wishlist' ? 'Saved!' : 'Done!') : 'Scan Card'}
        </Text>
        <View style={styles.headerRight}>
          {/* Scan counter for free users */}
          {!canUseUnlimitedScanner(subscriptionTier) && scanState === 'idle' && (
            <Pressable
              style={styles.scanCountBadge}
              onPress={() => router.push('/pro-subscription')}
              accessibilityRole="button"
              accessibilityLabel={`${Math.max(0, scansLeft)} scans remaining. Upgrade to Pro for unlimited`}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Feather name="camera" size={12} color={scansLeft <= 5 ? '#F59E0B' : C.mutedForeground} />
              <Text style={[styles.scanCountText, scansLeft <= 5 && { color: '#F59E0B' }]}>
                {Math.max(0, scansLeft)} left
              </Text>
            </Pressable>
          )}
          <Pressable
            style={styles.headerBtn}
            onPress={() => router.push('/add-card')}
            accessibilityRole="button"
            accessibilityLabel="Add card manually"
            hitSlop={2}
          >
            <Feather name="plus" size={19} color={C.foreground} />
          </Pressable>
        </View>
      </View>

      {/* Scan limit banner */}
      {scanState === 'idle' && <ScanLimitBanner />}

      {/* 30th-scan limit sheet */}
      <Modal visible={showLimitSheet} transparent animationType="slide" onRequestClose={() => setShowLimitSheet(false)}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setShowLimitSheet(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
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
          <Pressable
            onPress={() => setShowLimitSheet(false)}
            style={styles.sheetGhostBtn}
            accessibilityRole="button"
            accessibilityLabel="Got it, dismiss"
          >
            <Text style={styles.sheetGhostBtnText}>Got it</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Action sheet */}
      <Modal visible={showActionSheet} transparent animationType="slide" onRequestClose={() => setShowActionSheet(false)}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setShowActionSheet(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(botPad, 24) }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>What would you like to do?</Text>
          {topMatch && (
            <Text style={styles.sheetCardName}>{String(topMatch.card.name ?? '')}</Text>
          )}

          <Pressable
            onPress={handleAddToCollection}
            style={styles.sheetActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Add to collection"
          >
            <Feather name="layers" size={18} color={C.foreground} />
            <Text style={styles.sheetActionText}>Add to Collection</Text>
            <Feather name="chevron-right" size={16} color={C.mutedForeground} />
          </Pressable>

          <Pressable
            onPress={handleAddToWishlist}
            style={styles.sheetActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Add to wishlist"
          >
            <Feather name="heart" size={18} color={C.foreground} />
            <Text style={styles.sheetActionText}>Add to Wishlist</Text>
            <Feather name="chevron-right" size={16} color={C.mutedForeground} />
          </Pressable>

          <Pressable
            onPress={handleViewCard}
            style={styles.sheetActionBtn}
            accessibilityRole="button"
            accessibilityLabel="View card detail"
          >
            <Feather name="eye" size={18} color={C.foreground} />
            <Text style={styles.sheetActionText}>View Card Detail</Text>
            <Feather name="chevron-right" size={16} color={C.mutedForeground} />
          </Pressable>

          <Pressable
            onPress={() => setShowActionSheet(false)}
            style={styles.sheetGhostBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.sheetGhostBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Active state: viewfinder + capture controls + recent scans ───────── */}
      {isActiveView && (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: TAB_BAR_HEIGHT }}
        >
          {/* Viewfinder */}
          <View style={styles.viewfinder}>
            <View style={[styles.scanFrame, { width: FRAME_W, height: FRAME_H }]}>
              {/* Live camera feed */}
              {!isLimitExhausted && (
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing={facing}
                  flash={flashEnabled ? 'on' : 'off'}
                />
              )}

              {/* Corner marks */}
              <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }]} />
              <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }]} />
              <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
              <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }]} />

              {/* Scan line during recognition */}
              {scanState === 'recognizing' && (
                <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]} />
              )}

              {/* Idle placeholder when limit exhausted */}
              {isLimitExhausted && (
                <View style={styles.idleCenter}>
                  <Feather name="camera-off" size={48} color={`${C.mutedForeground}55`} />
                </View>
              )}

              {/* Dim overlay when limit exhausted */}
              {isLimitExhausted && (
                <View style={[styles.exhaustedOverlay, { pointerEvents: 'none' }]} />
              )}

              {/* Capturing / recognizing badge */}
              {(scanState === 'capturing' || scanState === 'recognizing') && (
                <View style={styles.scanningBadge}>
                  <View style={styles.scanDot} />
                  <Text style={styles.scanningText}>
                    {scanState === 'capturing' ? 'CAPTURING' : 'IDENTIFYING'}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.hint}>
              {isLimitExhausted
                ? 'Scan limit reached for this month'
                : scanState === 'idle'
                ? 'Position card in frame, then tap capture'
                : scanState === 'capturing'
                ? 'Hold steady…'
                : 'Identifying card…'}
            </Text>

            {/* Identifying spinner */}
            {scanState === 'recognizing' && (
              <ActivityIndicator size="small" color={C.primary} style={{ marginTop: 8 }} />
            )}
          </View>

          {/* Capture controls */}
          <View style={styles.controls}>
            <View style={styles.iconRow}>
              <Pressable
                onPress={() => setFlashEnabled(f => !f)}
                disabled={isLimitExhausted || scanState !== 'idle'}
                style={[
                  styles.iconBtn,
                  flashEnabled && !isLimitExhausted && { backgroundColor: '#F59E0B22', borderColor: '#F59E0B' },
                  (isLimitExhausted || scanState !== 'idle') && styles.iconBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={flashEnabled ? 'Flash on' : 'Flash off'}
                accessibilityState={{ disabled: isLimitExhausted || scanState !== 'idle' }}
              >
                <Feather name="zap" size={22} color={isLimitExhausted ? C.mutedForeground : (flashEnabled ? '#F59E0B' : C.foreground)} />
              </Pressable>

              {isLimitExhausted ? (
                <View style={styles.limitReachedLabel}>
                  <Feather name="lock" size={16} color={C.mutedForeground} />
                  <Text style={styles.limitReachedText}>Scan limit reached</Text>
                </View>
              ) : (
                <Pressable
                  onPress={handleCapture}
                  disabled={scanState !== 'idle'}
                  style={[styles.scanTrigger, scanState !== 'idle' && styles.scanTriggerDisabled]}
                  accessibilityLabel="Capture card"
                >
                  <View style={styles.scanTriggerInner}>
                    {scanState === 'idle'
                      ? <Feather name="camera" size={28} color="#FFFFFF" />
                      : <ActivityIndicator size="small" color="#FFFFFF" />
                    }
                  </View>
                </Pressable>
              )}

              <Pressable
                disabled={isLimitExhausted || scanState !== 'idle'}
                style={[styles.iconBtn, (isLimitExhausted || scanState !== 'idle') && styles.iconBtnDisabled]}
                onPress={() => router.push('/search')}
                accessibilityRole="button"
                accessibilityLabel="Search cards manually"
                accessibilityState={{ disabled: isLimitExhausted || scanState !== 'idle' }}
              >
                <Feather name="search" size={22} color={isLimitExhausted ? C.mutedForeground : C.foreground} />
              </Pressable>
            </View>

            {/* Pro upgrade nudge when ≤5 scans remain */}
            {!canUseUnlimitedScanner(subscriptionTier) && scansLeft <= 5 && scansLeft > 0 && (
              <Pressable
                onPress={() => router.push('/pro-subscription')}
                style={styles.upgradeLinkRow}
                accessibilityRole="button"
                accessibilityLabel={scansLeft === 1 ? '1 scan remaining. Upgrade to Pro for unlimited' : `${scansLeft} scans remaining. Upgrade to Pro for unlimited`}
              >
                <Feather name="zap" size={13} color={C.primary} />
                <Text style={styles.upgradeLinkText}>
                  {scansLeft === 1 ? '1 scan remaining — upgrade for unlimited' : `${scansLeft} scans remaining — upgrade for unlimited`}
                </Text>
                <Feather name="chevron-right" size={13} color={C.primary} />
              </Pressable>
            )}

            {/* Exhausted upgrade link */}
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

          {/* ── Recent Scans ── shown in idle state only ────────────────────── */}
          {scanState === 'idle' && recentScans.length > 0 && (
            <View style={styles.recentSection}>
              <Text style={styles.recentTitle}>Recent Scans</Text>
              {recentScans.slice(0, 5).map((scan) => (
                <Pressable
                  key={`${scan.cardId}-${scan.scannedAt}`}
                  onPress={() => router.push(`/card/${scan.cardId}`)}
                  style={styles.recentRow}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${scan.name}`}
                >
                  {/* Thumbnail */}
                  {scan.imageUrl ? (
                    <Image
                      source={{ uri: scan.imageUrl }}
                      style={styles.recentThumb}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.recentThumb, styles.recentThumbFallback]}>
                      <Text style={styles.recentThumbInitial}>
                        {scan.name ? scan.name[0].toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}

                  {/* Card info */}
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentName} numberOfLines={1}>{scan.name}</Text>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {[scan.setName, scan.number ? `#${scan.number}` : ''].filter(Boolean).join(' · ')}
                    </Text>
                  </View>

                  <Feather name="chevron-right" size={16} color={C.mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Match result ─────────────────────────────────────────────────────── */}
      {isMatchView && topMatch && (
        <Animated.View style={[styles.matchPanel, { opacity: fadeAnim, transform: [{ scale: pulseAnim }] }]}>
          {/* Low confidence warning */}
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
            {/* Card image or initial fallback */}
            {topMatch.card.image_url ? (
              <Image
                source={{ uri: String(topMatch.card.image_url) }}
                style={styles.matchThumb}
                contentFit="cover"
              />
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
            </View>
          </View>

          {/* Low-confidence: show raw extracted text so collector can verify */}
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

          {/* All candidates if multiple */}
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
        </Animated.View>
      )}

      {/* ── Error state ──────────────────────────────────────────────────────── */}
      {scanState === 'error' && (() => {
        // Per-error-code config: icon, title, tips
        const errorConfig: Record<ScanErrorCode, {
          icon: React.ComponentProps<typeof Feather>['name'];
          iconColor: string;
          title: string;
          tips: string[];
        }> = {
          image_quality: {
            icon: 'sun',
            iconColor: '#F59E0B',
            title: 'Image too dark or blank',
            tips: [
              'Move to a brighter area or enable flash',
              'Make sure the card is fully inside the frame',
              'Hold the phone steady before tapping Capture',
            ],
          },
          unreadable: {
            icon: 'eye-off',
            iconColor: '#F59E0B',
            title: 'Card may be blurry or out of frame',
            tips: [
              'Center the card inside the guide corners',
              'Hold steady — avoid moving while capturing',
              'Try turning on flash for low-light conditions',
            ],
          },
          no_match: {
            icon: 'search',
            iconColor: C.mutedForeground,
            title: 'No matching card found',
            tips: [
              'Use Search Manually to find it by name',
              'Check spelling if you type the name yourself',
            ],
          },
          api_error: {
            icon: 'alert-circle',
            iconColor: C.mutedForeground,
            title: 'Couldn\'t identify card',
            tips: [
              'Check your connection and try again',
              'Or use Search Manually to find the card',
            ],
          },
          '': {
            icon: 'alert-circle',
            iconColor: C.mutedForeground,
            title: 'Couldn\'t identify card',
            tips: [],
          },
        };

        const cfg = errorConfig[errorCode] ?? errorConfig[''];
        // For no_match we surface any partial text GPT extracted
        const partialText = errorCode === 'no_match'
          ? [scanResult?.extracted?.name, scanResult?.extracted?.setName].filter(Boolean).join(' — ')
          : '';

        return (
          <View style={styles.errorPanel}>
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

      {/* ── Auto-searching state: show extracted text toast before navigating ─── */}
      {scanState === 'auto_searching' && scanResult && (() => {
        const { name, setName, number } = scanResult.extracted;
        const parts = [name, setName, number].filter(f => f.trim() !== '');
        const readText = parts.join(' · ');
        return (
          <View style={styles.autoSearchPanel}>
            <View style={styles.autoSearchIconWrap}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
            <Text style={styles.autoSearchTitle}>Reading card…</Text>
            <View style={styles.autoSearchExtractedWrap}>
              <Text style={styles.autoSearchExtractedLabel}>Found:</Text>
              <Text style={styles.autoSearchExtractedText}>{readText}</Text>
            </View>
            <Text style={styles.autoSearchHint}>Taking you to search…</Text>
          </View>
        );
      })()}

      {/* ── Confirmed state ──────────────────────────────────────────────────── */}
      {scanState === 'confirmed' && topMatch && (
        <View style={styles.confirmedPanel}>
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

      {/* ── Controls for match / error / confirmed states ─────────────────────── */}
      {!isActiveView && scanState !== 'auto_searching' && (
        <View style={styles.controls}>
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
              <Pressable
                onPress={tryAgain}
                style={styles.ghostBtn}
                accessibilityRole="button"
                accessibilityLabel="Scan again"
              >
                <Text style={styles.ghostBtnText}>Scan Again</Text>
              </Pressable>
            </View>
          )}

          {/* Error actions */}
          {scanState === 'error' && (
            <View style={styles.actionStack}>
              <Pressable
                onPress={tryAgain}
                style={styles.primaryActionBtn}
                accessibilityRole="button"
                accessibilityLabel={
                  errorCode === 'image_quality' ? 'Try capturing again' :
                  errorCode === 'unreadable' ? 'Try again with better positioning' :
                  'Try scanning again'
                }
              >
                <Feather name="camera" size={18} color="#FFFFFF" />
                <Text style={styles.primaryActionText}>
                  {errorCode === 'image_quality' || errorCode === 'unreadable'
                    ? 'Try Again'
                    : 'Scan Again'}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSearchManually}
                style={styles.secondaryActionBtn}
                accessibilityRole="button"
                accessibilityLabel={
                  errorCode === 'no_match' && scanResult?.extracted?.name
                    ? `Search for ${scanResult.extracted.name}`
                    : 'Search manually'
                }
              >
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
          {scanState === 'confirmed' && (
            <View style={styles.actionStack}>
              {topMatch && (
                <Pressable
                  onPress={() => router.push(`/card/${topMatch.card.id}`)}
                  style={styles.primaryActionBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`View details for ${String(topMatch.card.name ?? '')}`}
                >
                  <Text style={styles.primaryActionText}>View Card Detail</Text>
                </Pressable>
              )}
              <Pressable
                onPress={tryAgain}
                style={styles.ghostBtn}
                accessibilityRole="button"
                accessibilityLabel="Scan another card"
              >
                <Text style={styles.ghostBtnText}>Scan Another Card</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scanCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  scanCountText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
  },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Permission screen
  permissionPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 16,
  },
  permissionIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: `${C.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 22,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    textAlign: 'center',
  },
  permissionBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  permissionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#CC1826',
    alignSelf: 'stretch',
    marginTop: 8,
  },
  permissionBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  // Viewfinder
  viewfinder: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  scanFrame: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 18,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: C.primary,
    borderRadius: 3,
    zIndex: 2,
  },
  scanLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    zIndex: 3,
  },
  idleCenter: { alignItems: 'center', gap: 12 },
  exhaustedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 1,
  },
  scanningBadge: {
    position: 'absolute',
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 4,
  },
  scanDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  scanningText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  hint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
  },
  // Match panel
  matchPanel: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 20,
    marginBottom: 8,
    gap: 12,
  },
  lowConfBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F59E0B18',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#F59E0B44',
  },
  lowConfText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#F59E0B',
  },
  confidenceBadge: { alignItems: 'center' },
  confidenceNum: { fontSize: 40, fontFamily: 'Inter_700Bold', color: C.positive },
  confidenceLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  matchThumb: {
    width: 70,
    height: 98,
    borderRadius: 10,
  },
  matchInitial: {
    fontSize: 36,
    fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.8)',
  },
  matchInfo: { flex: 1, gap: 4 },
  matchName: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  matchSet: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  matchNumber: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}88` },
  altsList: { marginTop: 4 },
  altChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  altChipText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
    maxWidth: 120,
  },
  altChipConf: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  // Error panel
  errorPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: 4 },
  errorTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginBottom: 4, textAlign: 'center' },
  errorBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Partial extracted text (shown on no_match)
  errorPartialWrap: {
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: 'stretch',
    marginTop: 6,
  },
  errorPartialLabel: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  errorPartialText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
  },
  // Tips list
  errorTipsList: {
    alignSelf: 'stretch',
    gap: 8,
    marginTop: 10,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  errorTipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  errorTipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    marginTop: 6,
  },
  errorTipText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 19,
  },
  // Confirmed panel
  confirmedPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  confirmedIconWrap: { marginBottom: 4 },
  confirmedTitle: { fontSize: 24, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  confirmedSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  confirmedMeta: {
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  confirmedMetaText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  // Controls
  controls: { paddingVertical: 20 },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  iconBtn: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  iconBtnDisabled: { opacity: 0.4 },
  scanTrigger: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#CC1826',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#CC1826',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
    borderWidth: 4,
    borderColor: C.background,
  },
  scanTriggerInner: { alignItems: 'center', justifyContent: 'center' },
  scanTriggerDisabled: { backgroundColor: C.muted, shadowOpacity: 0, borderColor: C.border, opacity: 0.7 },
  limitReachedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.card,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  limitReachedText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  upgradeLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 14,
  },
  upgradeLinkText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  actionStack: { gap: 10 },
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
    borderColor: C.border,
    backgroundColor: C.card,
  },
  secondaryActionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  ghostBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  // Modals / sheets
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 4,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  sheetTitle: {
    fontSize: 20,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    textAlign: 'center',
    marginBottom: 8,
  },
  sheetCardName: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
    textAlign: 'center',
    marginBottom: 12,
  },
  sheetBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  sheetActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  sheetActionText: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
  },
  sheetPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#CC1826',
    alignSelf: 'stretch',
    marginBottom: 10,
  },
  sheetPrimaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  sheetGhostBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginBottom: 4,
  },
  sheetGhostBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  // Recent scans
  recentSection: {
    marginTop: 24,
    paddingBottom: 12,
  },
  recentTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  recentThumb: {
    width: 44,
    height: 62,
    borderRadius: 7,
  },
  recentThumbFallback: {
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentThumbInitial: {
    fontSize: 22,
    fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.7)',
  },
  recentInfo: {
    flex: 1,
    gap: 3,
  },
  recentName: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  recentMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  // Auto-searching state (transient — shown before auto-navigating to search)
  autoSearchPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  autoSearchIconWrap: {
    marginBottom: 8,
  },
  autoSearchTitle: {
    fontSize: 22,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    textAlign: 'center',
  },
  autoSearchExtractedWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  autoSearchExtractedLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
  },
  autoSearchExtractedText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    textAlign: 'center',
  },
  autoSearchHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    marginTop: 4,
  },
  // Low-confidence extracted text (shown beneath card preview)
  lcExtractedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 4,
    flexWrap: 'wrap',
  },
  lcExtractedLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
    marginTop: 1,
  },
  lcExtractedText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}CC`,
    lineHeight: 17,
  },
});
