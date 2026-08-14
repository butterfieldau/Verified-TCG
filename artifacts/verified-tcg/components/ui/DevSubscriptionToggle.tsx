/**
 * DevSubscriptionToggle — DEV-ONLY floating pill to flip subscription tier
 * and control the scan counter for testing the scan-limit flow.
 *
 * Renders only when __DEV__ is true (i.e. never in production builds).
 * Displayed as clearly amber-coloured "DEV" pills fixed in the bottom-right
 * corner above the tab bar so it's never confused for real product UI.
 *
 * To remove before production: delete this file and remove the
 * <DevSubscriptionToggle /> import from app/(tabs)/_layout.tsx.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';

/** Amber dev palette — intentionally distinct from the product's red/black. */
const DEV = {
  bg: '#92400E',        // amber-800
  pill: '#F59E0B',      // amber-400
  pillText: '#1C1917',  // stone-900
  label: '#FDE68A',     // amber-200
  scanPill: '#065F46',  // emerald-800 — distinct from tier toggle amber
  scanPillText: '#D1FAE5', // emerald-100
};

export default function DevSubscriptionToggle() {
  // Guard: never render outside of development
  if (!__DEV__) return null;

  return <DevToggleInner />;
}

function DevToggleInner() {
  const { subscriptionTier, setSubscriptionTier, scansUsed, scanLimit, resetScanCount, devSetScansUsed } = useApp();
  const isPro = subscriptionTier === 'pro';

  function toggle() {
    setSubscriptionTier(isPro ? 'free' : 'pro');
  }

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {/* View Pro Screen shortcut */}
      <Pressable
        onPress={() => router.push('/pro-subscription')}
        style={({ pressed }) => [styles.pill, styles.pillScreen, pressed && styles.pillPressed]}
        accessibilityRole="button"
        accessibilityLabel="DEV: Open Pro subscription screen"
      >
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
        <Feather name="star" size={12} color={DEV.pillText} />
        <Text style={styles.tierText}>Pro Screen</Text>
      </Pressable>

      {/* Tier toggle */}
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
        accessibilityRole="button"
        accessibilityLabel={`DEV: Switch to ${isPro ? 'Free' : 'Pro'} tier`}
      >
        {/* DEV label */}
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>

        {/* Current tier indicator */}
        <Feather
          name={isPro ? 'zap' : 'zap-off'}
          size={12}
          color={DEV.pillText}
          style={styles.icon}
        />
        <Text style={styles.tierText}>
          {isPro ? 'Pro' : 'Free'}
        </Text>

        {/* Tap hint */}
        <Feather name="refresh-cw" size={10} color={DEV.pillText} style={styles.refreshIcon} />
      </Pressable>

      {/* Scan count controls — three quick-set presets */}
      <View style={[styles.pill, styles.scanPill]}>
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV</Text>
        </View>
        <Feather name="camera" size={12} color={DEV.scanPillText} style={styles.icon} />
        <Text style={styles.scanLabel}>
          {scansUsed}/{scanLimit}
        </Text>

        {/* Reset → 0 */}
        <Pressable
          onPress={resetScanCount}
          style={({ pressed }) => [styles.scanBtn, pressed && styles.pillPressed]}
          accessibilityRole="button"
          accessibilityLabel="DEV: Reset scan count to 0"
        >
          <Text style={styles.scanBtnText}>↺0</Text>
        </Pressable>

        {/* Set → 29 (1 remaining — amber banner visible) */}
        <Pressable
          onPress={() => devSetScansUsed(29)}
          style={({ pressed }) => [styles.scanBtn, styles.scanBtnAmber, pressed && styles.pillPressed]}
          accessibilityRole="button"
          accessibilityLabel="DEV: Set scan count to 29 (1 remaining)"
        >
          <Text style={styles.scanBtnText}>29</Text>
        </Pressable>

        {/* Set → 30 (exhausted — scanner disabled) */}
        <Pressable
          onPress={() => devSetScansUsed(30)}
          style={({ pressed }) => [styles.scanBtn, styles.scanBtnRed, pressed && styles.pillPressed]}
          accessibilityRole="button"
          accessibilityLabel="DEV: Set scan count to 30 (exhausted)"
        >
          <Text style={styles.scanBtnText}>30</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 90,   // above the 74px tab bar
    right: 12,
    zIndex: 9999,
    gap: 6,
    alignItems: 'flex-end',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DEV.pill,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  pillPressed: {
    opacity: 0.8,
  },
  pillScreen: {
    backgroundColor: '#6D28D9', // purple — distinct from tier toggle amber
  },
  scanPill: {
    backgroundColor: DEV.scanPill,
  },
  devBadge: {
    backgroundColor: DEV.bg,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginRight: 2,
  },
  devBadgeText: {
    color: DEV.label,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  icon: {
    marginRight: 1,
  },
  tierText: {
    color: DEV.pillText,
    fontSize: 13,
    fontWeight: '700',
  },
  refreshIcon: {
    marginLeft: 2,
    opacity: 0.7,
  },
  // Scan controls
  scanLabel: {
    color: DEV.scanPillText,
    fontSize: 12,
    fontWeight: '700',
    marginRight: 2,
  },
  scanBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  scanBtnAmber: {
    backgroundColor: 'rgba(245,158,11,0.45)', // amber tint
  },
  scanBtnRed: {
    backgroundColor: 'rgba(220,38,38,0.55)',  // red tint
  },
  scanBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
});
