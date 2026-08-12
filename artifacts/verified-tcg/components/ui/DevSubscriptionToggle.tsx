/**
 * DevSubscriptionToggle — DEV-ONLY floating pill to flip subscription tier.
 *
 * Renders only when __DEV__ is true (i.e. never in production builds).
 * Displayed as a clearly amber-coloured "DEV" pill fixed in the bottom-right
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
};

export default function DevSubscriptionToggle() {
  // Guard: never render outside of development
  if (!__DEV__) return null;

  return <DevToggleInner />;
}

function DevToggleInner() {
  const { subscriptionTier, setSubscriptionTier } = useApp();
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
});
