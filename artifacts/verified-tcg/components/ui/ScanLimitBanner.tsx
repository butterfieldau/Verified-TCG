/**
 * ScanLimitBanner — Shows remaining scan quota when the collector is running low.
 *
 * Renders only when:
 *   - The user is on the Free tier, AND
 *   - scansUsed / scanLimit >= 0.8 (last 20% of monthly quota)
 *
 * When all scans are exhausted (scansUsed >= scanLimit) it replaces the
 * counter with an upgrade prompt using ProFeaturePreview.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { SCAN_LIMIT_BANNER_THRESHOLD } from '@/services/subscription';
import ProFeaturePreview from './ProFeaturePreview';

const C = colors.dark;

export default function ScanLimitBanner() {
  const { subscriptionTier, scansUsed, scanLimit, scanResetDate } = useApp();

  // Only relevant for Free users
  if (subscriptionTier === 'pro') return null;

  const ratio = scansUsed / scanLimit;

  // Don't render until the collector is in the last 20%
  if (ratio < SCAN_LIMIT_BANNER_THRESHOLD) return null;

  const remaining = Math.max(0, scanLimit - scansUsed);
  const isExhausted = remaining === 0;

  // Format reset date as "1 Sep", "12 Oct", etc.
  const resetLabel = scanResetDate.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });

  // ── Exhausted: show upgrade prompt ────────────────────────────────────────
  if (isExhausted) {
    return (
      <ProFeaturePreview
        featureTitle="Unlimited Scanning"
        description="You've used all 30 of your free scans this month. Upgrade to Pro for unlimited scanning."
        previewContent={<ExhaustedPreview resetLabel={resetLabel} />}
        lockedContent={null}
        ctaLabel="Upgrade to Pro — Unlimited Scans"
      />
    );
  }

  // ── Low scans: show inline banner ─────────────────────────────────────────
  const isWarning = remaining <= 3;

  return (
    <View style={[styles.banner, isWarning && styles.bannerWarning]}>
      <Feather
        name="camera"
        size={14}
        color={isWarning ? C.warning : C.mutedForeground}
        style={styles.icon}
      />
      <Text style={[styles.text, isWarning && styles.textWarning]}>
        {scansUsed} / {scanLimit} scans used · resets {resetLabel}
      </Text>
    </View>
  );
}

/** Minimal placeholder shown behind the lock overlay when scans are exhausted. */
function ExhaustedPreview({ resetLabel }: { resetLabel: string }) {
  return (
    <View style={styles.exhaustedPreview}>
      <Feather name="camera-off" size={28} color={C.mutedForeground} />
      <Text style={styles.exhaustedTitle}>30 / 30 scans used</Text>
      <Text style={styles.exhaustedSub}>Resets {resetLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  bannerWarning: {
    borderColor: C.warning,
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    color: C.mutedForeground,
    fontSize: 13,
    flex: 1,
  },
  textWarning: {
    color: C.warning,
  },

  // Exhausted preview (shown behind lock overlay)
  exhaustedPreview: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 6,
  },
  exhaustedTitle: {
    color: C.mutedForeground,
    fontSize: 15,
    fontWeight: '600',
  },
  exhaustedSub: {
    color: C.mutedForeground,
    fontSize: 13,
  },
});
