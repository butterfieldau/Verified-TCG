import React, { useState, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { MOCK_CARDS } from '@/services/cards';
import colors from '@/constants/colors';
import type { CollectionItem } from '@/types';
import { canUseUnlimitedScanner } from '@/services/subscription';
import ScanLimitBanner from '@/components/ui/ScanLimitBanner';

const C = colors.dark;
const { width: W } = Dimensions.get('window');
const FRAME_W = Math.min(W - 64, 280);
const FRAME_H = FRAME_W * 1.4;

type ScanState = 'idle' | 'scanning' | 'match' | 'confirmed';

const SCAN_RESULT = MOCK_CARDS[0]; // Charizard ex as simulated result

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { addToCollection, incrementScanCount, subscriptionTier, scansUsed, scanLimit, scanResetDate } = useApp();
  const isLimitExhausted = !canUseUnlimitedScanner(subscriptionTier) && scansUsed >= scanLimit;
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [addedToCollection, setAddedToCollection] = useState(false);
  const [showLimitSheet, setShowLimitSheet] = useState(false);

  // Format reset date as "1 Sep", "12 Oct", etc.
  const resetLabel = scanResetDate.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });

  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  // Scan line animation
  useEffect(() => {
    if (scanState === 'scanning') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanLineAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
          Animated.timing(scanLineAnim, { toValue: 0, duration: 1600, useNativeDriver: true }),
        ])
      ).start();
      const timer = setTimeout(() => {
        setScanState('match');
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      }, 2800);
      return () => clearTimeout(timer);
    } else {
      scanLineAnim.setValue(0);
    }
  }, [scanState]);

  // Pulse on match
  useEffect(() => {
    if (scanState === 'match') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [scanState]);

  function startScan() {
    // Free users who have used all their monthly scans cannot start a new scan.
    // ScanLimitBanner already shows the upgrade prompt in this state.
    if (isLimitExhausted) return;
    fadeAnim.setValue(0);
    setScanState('scanning');
  }

  function tryAgain() {
    setAddedToCollection(false);
    setScanState('idle');
  }

  function handleAddToCollection() {
    const item: CollectionItem = {
      id: `col-scan-${Date.now()}`,
      cardId: SCAN_RESULT.id,
      card: SCAN_RESULT,
      quantity: 1,
      condition: 'near_mint',
      acquiredAt: new Date().toISOString().split('T')[0],
      acquiredPrice: SCAN_RESULT.price.raw,
      currency: 'AUD',
    };
    addToCollection(item);
    incrementScanCount();
    setAddedToCollection(true);

    // Free users who just hit the 30th scan see the limit bottom sheet
    // instead of the normal "Added to collection" confirmation screen.
    const willBeExhausted = !canUseUnlimitedScanner(subscriptionTier) && scansUsed + 1 >= scanLimit;
    if (willBeExhausted) {
      // Card is added; surface the limit moment then return to idle (disabled).
      setScanState('idle');
      setShowLimitSheet(true);
    } else {
      setScanState('confirmed');
    }
  }

  function handleDismissLimitSheet() {
    setShowLimitSheet(false);
  }

  function handleUpgradeFromSheet() {
    setShowLimitSheet(false);
    router.push('/pro-subscription');
  }

  function handleCheckValue() {
    router.push(`/card/${SCAN_RESULT.id}`);
  }

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, FRAME_H - 4],
  });

  const isActiveView = scanState === 'idle' || scanState === 'scanning';

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: Math.max(botPad, 16) }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {scanState === 'match' ? 'Match Found' : scanState === 'confirmed' ? 'Added!' : 'Scan Card'}
        </Text>
        <Pressable style={styles.headerBtn} onPress={() => router.push('/add-card')}>
          <Feather name="plus" size={19} color={C.foreground} />
        </Pressable>
      </View>

      {/* Scan limit banner — visible in idle state when in last 20% of quota */}
      {scanState === 'idle' && <ScanLimitBanner />}

      {/* 30th-scan limit bottom sheet */}
      <Modal
        visible={showLimitSheet}
        transparent
        animationType="slide"
        onRequestClose={handleDismissLimitSheet}
      >
        <Pressable style={styles.sheetBackdrop} onPress={handleDismissLimitSheet} />
        <View style={[styles.sheet, { paddingBottom: Math.max(botPad, 24) }]}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetIconWrap}>
            <Feather name="camera-off" size={32} color={C.mutedForeground} />
          </View>

          <Text style={styles.sheetTitle}>Monthly scan limit reached</Text>
          <Text style={styles.sheetBody}>
            You've used your 30 free scans this month.{'\n'}Resets {resetLabel}.
          </Text>

          <Pressable onPress={handleUpgradeFromSheet} style={styles.sheetPrimaryBtn}>
            <Feather name="zap" size={16} color="#FFFFFF" />
            <Text style={styles.sheetPrimaryBtnText}>Unlock Unlimited Scanning</Text>
          </Pressable>

          <Pressable onPress={handleDismissLimitSheet} style={styles.sheetGhostBtn}>
            <Text style={styles.sheetGhostBtnText}>Got it</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Scanner viewfinder */}
      {isActiveView && (
        <View style={styles.viewfinder}>
          <View style={[styles.scanFrame, { width: FRAME_W, height: FRAME_H }]}>
            {/* Corner marks */}
            <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }]} />
            <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }]} />
            <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
            <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }]} />

            {/* Scan line */}
            {scanState === 'scanning' && (
              <Animated.View
                style={[styles.scanLine, { transform: [{ translateY: scanLineTranslateY }] }]}
              />
            )}

            {/* Idle state */}
            {scanState === 'idle' && (
              <View style={styles.idleCenter}>
                <Feather
                  name={isLimitExhausted ? 'camera-off' : 'camera'}
                  size={48}
                  color={isLimitExhausted ? `${C.mutedForeground}55` : `${C.primary}55`}
                />
              </View>
            )}

            {/* Dim overlay when scan limit is exhausted */}
            {isLimitExhausted && (
              <View style={[styles.exhaustedOverlay, { pointerEvents: 'none' }]} />
            )}

            {/* Scanning badge */}
            {scanState === 'scanning' && (
              <View style={styles.scanningBadge}>
                <View style={styles.scanDot} />
                <Text style={styles.scanningText}>SCANNING</Text>
              </View>
            )}
          </View>
          <Text style={styles.hint}>
            {scanState === 'idle'
              ? 'Tap the button below to scan'
              : 'Hold steady — detecting card...'}
          </Text>
        </View>
      )}

      {/* Match result */}
      {scanState === 'match' && (
        <Animated.View style={[styles.matchPanel, { opacity: fadeAnim, transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.confidenceBadge}>
            <Text style={styles.confidenceNum}>98%</Text>
            <Text style={styles.confidenceLabel}>MATCH</Text>
          </View>
          <View style={styles.matchCard}>
            <View style={[styles.matchThumb, { backgroundColor: SCAN_RESULT.gradientStart }]}>
              <Text style={styles.matchInitial}>{SCAN_RESULT.name[0]}</Text>
            </View>
            <View style={styles.matchInfo}>
              <Text style={styles.matchName}>{SCAN_RESULT.name}</Text>
              <Text style={styles.matchSet}>{SCAN_RESULT.setName}</Text>
              <Text style={styles.matchNumber}>{SCAN_RESULT.number}</Text>
              <View style={styles.matchPriceRow}>
                <Text style={styles.matchPrice}>${SCAN_RESULT.price.raw.toLocaleString()} AUD</Text>
                <Text style={styles.matchPriceLabel}>Raw market</Text>
              </View>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Confirmed */}
      {scanState === 'confirmed' && (
        <View style={styles.confirmedPanel}>
          <View style={styles.confirmedIconWrap}>
            <Feather name="check-circle" size={52} color={C.positive} />
          </View>
          <Text style={styles.confirmedTitle}>{SCAN_RESULT.name}</Text>
          <Text style={styles.confirmedSub}>Added to your collection</Text>
          <View style={[styles.confirmedMeta, { backgroundColor: C.card }]}>
            <Text style={styles.confirmedMetaText}>{SCAN_RESULT.setName} · {SCAN_RESULT.number}</Text>
            <Text style={styles.confirmedPrice}>${SCAN_RESULT.price.raw.toLocaleString()} AUD</Text>
          </View>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        {isActiveView && (
          <View>
            <View style={styles.iconRow}>
              <Pressable
                onPress={() => setFlashEnabled(f => !f)}
                disabled={isLimitExhausted}
                style={[
                  styles.iconBtn,
                  flashEnabled && !isLimitExhausted && { backgroundColor: `#F59E0B22`, borderColor: '#F59E0B' },
                  isLimitExhausted && styles.iconBtnDisabled,
                ]}
              >
                <Feather name="zap" size={22} color={isLimitExhausted ? C.mutedForeground : (flashEnabled ? '#F59E0B' : C.foreground)} />
              </Pressable>

              {/* When limit is exhausted, replace the scan trigger with a "Scan limit reached" label */}
              {isLimitExhausted ? (
                <View style={styles.limitReachedLabel}>
                  <Feather name="lock" size={16} color={C.mutedForeground} />
                  <Text style={styles.limitReachedText}>Scan limit reached</Text>
                </View>
              ) : (
                <Pressable
                  onPress={startScan}
                  style={styles.scanTrigger}
                  accessibilityLabel="Start scan"
                >
                  <View style={styles.scanTriggerInner}>
                    <Feather name="camera" size={28} color="#FFFFFF" />
                  </View>
                </Pressable>
              )}

              <Pressable
                disabled={isLimitExhausted}
                style={[styles.iconBtn, isLimitExhausted && styles.iconBtnDisabled]}
                onPress={() => !isLimitExhausted && router.push('/add-card')}
              >
                <Feather name="image" size={22} color={isLimitExhausted ? C.mutedForeground : C.foreground} />
              </Pressable>
            </View>

            {/* Upgrade to Pro link — visible only when limit is exhausted */}
            {isLimitExhausted && (
              <Pressable onPress={() => router.push('/pro-subscription')} style={styles.upgradeLinkRow}>
                <Feather name="zap" size={13} color={C.primary} />
                <Text style={styles.upgradeLinkText}>Upgrade to Pro for unlimited scanning</Text>
                <Feather name="chevron-right" size={13} color={C.primary} />
              </Pressable>
            )}
          </View>
        )}

        {scanState === 'match' && (
          <View style={styles.actionStack}>
            <Pressable onPress={handleAddToCollection} style={styles.primaryActionBtn}>
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={styles.primaryActionText}>Add to Collection</Text>
            </Pressable>
            <Pressable onPress={handleCheckValue} style={styles.secondaryActionBtn}>
              <Text style={styles.secondaryActionText}>Check Value</Text>
            </Pressable>
            <Pressable onPress={tryAgain} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Try Again</Text>
            </Pressable>
          </View>
        )}

        {scanState === 'confirmed' && (
          <View style={styles.actionStack}>
            <Pressable onPress={handleCheckValue} style={styles.primaryActionBtn}>
              <Text style={styles.primaryActionText}>View Card Detail</Text>
            </Pressable>
            <Pressable onPress={tryAgain} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Scan Another Card</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Recent scans (idle only) */}
      {scanState === 'idle' && (
        <View style={styles.recent}>
          <Text style={styles.recentTitle}>Recent Scans</Text>
          {[
            { name: 'Charizard ex', set: 'Obsidian Flames', id: 'charizard-ex-ob' },
            { name: 'Umbreon ex', set: 'Prismatic Evolutions', id: 'umbreon-ex-pe' },
          ].map(item => (
            <Pressable
              key={item.id}
              style={[styles.recentRow, { backgroundColor: C.card }]}
              onPress={() => router.push(`/card/${item.id}`)}
            >
              <Feather name="rotate-ccw" size={15} color={C.mutedForeground} />
              <Text style={styles.recentLabel}>{item.name} · {item.set}</Text>
              <Feather name="chevron-right" size={15} color={C.mutedForeground} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

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
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  },
  idleCenter: { alignItems: 'center', gap: 12 },
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
  matchPanel: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 20,
    marginBottom: 8,
    gap: 16,
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
    alignItems: 'center',
    justifyContent: 'center',
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
  matchPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  matchPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  matchPriceLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
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
  confirmedPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
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
  scanTrigger: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
    borderWidth: 4,
    borderColor: C.background,
  },
  scanTriggerInner: { alignItems: 'center', justifyContent: 'center' },
  scanTriggerDisabled: {
    backgroundColor: C.muted,
    shadowOpacity: 0,
    borderColor: C.border,
    opacity: 0.7,
  },
  actionStack: { gap: 10 },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.primary,
  },
  primaryActionText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  secondaryActionBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  ghostBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  recent: { marginTop: 4 },
  recentTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    marginBottom: 10,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
    gap: 12,
  },
  recentLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.foreground,
  },

  // ── Exhausted overlay ───────────────────────────────────────────────────────
  exhaustedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 18,
  },

  // ── Disabled icon button ────────────────────────────────────────────────────
  iconBtnDisabled: {
    opacity: 0.4,
  },

  // ── "Scan limit reached" label (replaces scan trigger) ─────────────────────
  limitReachedLabel: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  limitReachedText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // ── "Upgrade to Pro" link below the controls ────────────────────────────────
  upgradeLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 14,
  },
  upgradeLinkText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.primary,
  },

  // ── 30th-scan limit bottom sheet ────────────────────────────────────────────
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 24,
  },
  sheetIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
  sheetBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  sheetPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignSelf: 'stretch',
    marginBottom: 10,
  },
  sheetPrimaryBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  sheetGhostBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginBottom: 4,
  },
  sheetGhostBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
  },
});
