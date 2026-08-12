/**
 * ProFeaturePreview — Gated content wrapper for Pro-only features.
 *
 * Usage:
 *   <ProFeaturePreview
 *     featureTitle="Advanced Price History"
 *     description="See 7-day, 30-day, and 90-day price trends for every card."
 *     previewContent={<ChartPreview />}
 *     lockedContent={<FullChart />}
 *     ctaLabel="Unlock with Pro"
 *   />
 *
 * When the user is on Free tier the previewContent is shown with a blurred
 * overlay and a CTA card beneath it. When the user is Pro, lockedContent is
 * rendered transparently with no gate.
 */

import React, { useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import {
  MONTHLY_PRICE_AUD,
  ANNUAL_PRICE_AUD,
  ANNUAL_SAVING_PERCENT,
} from '@/services/subscription';

const C = colors.dark;

interface ProFeaturePreviewProps {
  featureTitle: string;
  description: string;
  /** Shown behind the lock overlay on Free tier; fully visible on Pro. */
  previewContent: ReactNode;
  /** The real unlocked content rendered for Pro users. */
  lockedContent: ReactNode;
  ctaLabel?: string;
}

export default function ProFeaturePreview({
  featureTitle,
  description,
  previewContent,
  lockedContent,
  ctaLabel = 'Unlock with Pro',
}: ProFeaturePreviewProps) {
  const { subscriptionTier } = useApp();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (subscriptionTier === 'pro') {
    return <>{lockedContent}</>;
  }

  // ── Free tier — show preview with lock overlay ────────────────────────────
  return (
    <View style={styles.container}>
      {/* Dimmed preview behind the overlay */}
      <View style={styles.previewWrapper} pointerEvents="none">
        {previewContent}
        <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.dimOverlay} />
      </View>

      {/* Lock badge centred on preview */}
      <View style={styles.lockBadge} pointerEvents="none">
        <View style={styles.lockIconCircle}>
          <Feather name="lock" size={20} color={C.primaryForeground} />
        </View>
        <Text style={styles.lockTitle}>{featureTitle}</Text>
        <Text style={styles.lockDescription}>{description}</Text>
      </View>

      {/* CTA button */}
      <Pressable
        style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
      >
        <Feather name="zap" size={14} color={C.primaryForeground} style={styles.ctaIcon} />
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </Pressable>

      {/* Upgrade sheet */}
      <UpgradeSheet
        visible={sheetOpen}
        featureTitle={featureTitle}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

// ─── Upgrade bottom sheet ─────────────────────────────────────────────────────

function UpgradeSheet({
  visible,
  featureTitle,
  onClose,
}: {
  visible: boolean;
  featureTitle: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />

        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Pro badge */}
          <View style={styles.proBadge}>
            <Feather name="zap" size={16} color={C.primaryForeground} />
            <Text style={styles.proBadgeText}>Verified Pro</Text>
          </View>

          <Text style={styles.sheetTitle}>
            Unlock {featureTitle}
          </Text>
          <Text style={styles.sheetSubtitle}>
            Upgrade to Pro for unlimited access to every premium feature.
          </Text>

          {/* Perks */}
          {PERKS.map(perk => (
            <View key={perk} style={styles.perkRow}>
              <Feather name="check-circle" size={16} color={C.positive} />
              <Text style={styles.perkText}>{perk}</Text>
            </View>
          ))}

          {/* Pricing options */}
          <View style={styles.pricingRow}>
            <View style={styles.pricingCard}>
              <Text style={styles.pricingLabel}>Monthly</Text>
              <Text style={styles.pricingAmount}>
                ${MONTHLY_PRICE_AUD.toFixed(2)}
              </Text>
              <Text style={styles.pricingPer}>AUD / month</Text>
            </View>

            <View style={[styles.pricingCard, styles.pricingCardHighlighted]}>
              <View style={styles.savingsBadge}>
                <Text style={styles.savingsText}>Save {ANNUAL_SAVING_PERCENT}%</Text>
              </View>
              <Text style={styles.pricingLabel}>Annual</Text>
              <Text style={[styles.pricingAmount, styles.pricingAmountHighlighted]}>
                ${ANNUAL_PRICE_AUD.toFixed(2)}
              </Text>
              <Text style={[styles.pricingPer, styles.pricingPerHighlighted]}>AUD / year</Text>
            </View>
          </View>

          {/* CTA */}
          <Pressable
            style={({ pressed }) => [styles.sheetCta, pressed && styles.sheetCtaPressed]}
            accessibilityRole="button"
            accessibilityLabel="Start Pro — coming soon"
          >
            <Text style={styles.sheetCtaText}>Start Pro — Coming Soon</Text>
          </Pressable>

          <Pressable onPress={onClose} style={styles.dismissLink}>
            <Text style={styles.dismissText}>Maybe later</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const PERKS = [
  'Unlimited card scanning',
  'Advanced 90-day price charts',
  'Event Mode+ analytics',
  'Trade Match+ full contact details',
  'Unlimited price alerts',
  'Collection CSV / JSON export',
  'Custom card icons & profile themes',
  'Collection insights & ROI analytics',
  'Verified Drops early access',
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: 12,
  },
  previewWrapper: {
    position: 'relative',
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.45)',
  },
  lockBadge: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: C.surface,
  },
  lockIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  lockTitle: {
    color: C.foreground,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  lockDescription: {
    color: C.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
    paddingVertical: 14,
    marginHorizontal: 20,
    marginVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  ctaButtonPressed: {
    opacity: 0.85,
  },
  ctaIcon: {
    marginRight: 2,
  },
  ctaText: {
    color: C.primaryForeground,
    fontSize: 15,
    fontWeight: '700',
  },

  // Sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  sheetContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 5,
    marginBottom: 16,
  },
  proBadgeText: {
    color: C.primaryForeground,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sheetTitle: {
    color: C.foreground,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  sheetSubtitle: {
    color: C.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  perkText: {
    color: C.foreground,
    fontSize: 14,
    flex: 1,
  },
  pricingRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 20,
  },
  pricingCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  pricingCardHighlighted: {
    borderColor: C.primary,
    position: 'relative',
  },
  savingsBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  savingsText: {
    color: C.primaryForeground,
    fontSize: 11,
    fontWeight: '700',
  },
  pricingLabel: {
    color: C.mutedForeground,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pricingAmount: {
    color: C.foreground,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  pricingAmountHighlighted: {
    color: C.primary,
  },
  pricingPer: {
    color: C.mutedForeground,
    fontSize: 11,
    marginTop: 2,
  },
  pricingPerHighlighted: {
    color: C.primary,
  },
  sheetCta: {
    backgroundColor: C.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetCtaPressed: {
    opacity: 0.85,
  },
  sheetCtaText: {
    color: C.primaryForeground,
    fontSize: 16,
    fontWeight: '700',
  },
  dismissLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dismissText: {
    color: C.mutedForeground,
    fontSize: 14,
  },
});
