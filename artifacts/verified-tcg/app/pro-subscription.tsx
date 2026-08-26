/**
 * Pro Subscription Screen — Verified TCG
 *
 * Shows Pro benefits and the Free vs Pro comparison.
 * Billing/payment is not yet active — the transactional purchase UI
 * (pricing, trial CTA, auto-renewal terms) is intentionally omitted until
 * in-app billing is integrated (task #229).
 *
 * "Restore Purchases" is present as a required Apple/Google affordance:
 * it re-reads the user's subscription_tier from Verified TCG's own database.
 * It does NOT communicate with StoreKit or Google Play — that requires the
 * future billing integration. It is useful for fixing a mismatch between
 * local app state and the server after a reinstall or sign-in on a new device.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import colors from '@/constants/colors';
import { SUBSCRIPTION_CONFIG } from '@/services/subscription';
import { restorePurchases } from '@/services/auth';
import { useApp } from '@/context/AppContext';

const C = colors.dark;

// ─── Icon names ───────────────────────────────────────────────────────────────
type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ProSubscriptionScreen() {
  const [restoring, setRestoring] = useState(false);
  const { isAuthenticated, subscriptionTier, setSubscriptionTier } = useApp();
  const isPro = subscriptionTier === 'pro';

  async function handleRestorePurchases() {
    if (!isAuthenticated) {
      router.push({ pathname: '/sign-in', params: { next: '/pro-subscription' } } as any);
      return;
    }
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.restored) {
        setSubscriptionTier('pro');
        Alert.alert(
          'Pro Active',
          'Your Verified TCG Pro subscription is active on this account and has been applied to this device.',
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert(
          'No Active Subscription',
          'No active Pro subscription was found on your Verified TCG account.',
          [{ text: 'OK' }],
        );
      }
    } catch {
      Alert.alert('Sync Failed', 'Unable to check your subscription. Please check your connection and try again.', [{ text: 'OK' }]);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />

      {/* Back / close */}
      <Pressable
        style={styles.closeBtn}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={12}
      >
        <Feather name="x" size={22} color={C.mutedForeground} />
      </Pressable>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={styles.heroSection}>
          <View style={styles.proBadge}>
            <Feather name="zap" size={13} color={C.primaryForeground} />
            <Text style={styles.proBadgeText}>Verified TCG Pro</Text>
          </View>
          {isPro ? (
            <>
              <Text style={styles.headline}>You're on{'\n'}Verified Pro.</Text>
              <Text style={styles.subheadline}>
                Your Pro membership is active. Enjoy unlimited scanning, full price history, and all Pro features.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.headline}>Collect smarter.{'\n'}Trade faster.</Text>
              <Text style={styles.subheadline}>
                Everything a serious collector needs in one subscription.
              </Text>
            </>
          )}
        </View>

        {/* ── Coming soon notice (non-Pro only) ── */}
        {!isPro && (
          <View style={styles.comingSoonBanner}>
            <Feather name="clock" size={16} color={C.mutedForeground} />
            <Text style={styles.comingSoonText}>
              In-app billing is coming soon. Join our early-access list to be notified when Pro subscriptions open.
            </Text>
          </View>
        )}

        {/* ── Benefit cards ── */}
        <View style={styles.benefitsSection}>
          {SUBSCRIPTION_CONFIG.benefits.map(benefit => (
            <BenefitCard
              key={benefit.key}
              title={benefit.title}
              subtitle={benefit.subtitle}
              icon={benefit.icon as FeatherIconName}
            />
          ))}
        </View>

        {/* ── Status / action row ── */}
        <View style={styles.ctaSection}>
          {isPro ? (
            <Pressable
              style={({ pressed }) => [styles.ctaButton, styles.ctaButtonPro, pressed && styles.ctaButtonPressed]}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="You're already on Verified Pro"
            >
              <Feather name="check-circle" size={16} color={C.primaryForeground} />
              <Text style={styles.ctaButtonText}>YOU'RE ON VERIFIED PRO</Text>
            </Pressable>
          ) : (
            <View style={styles.ctaComingSoonBox}>
              <Feather name="clock" size={18} color={C.mutedForeground} />
              <Text style={styles.ctaComingSoonLabel}>Pro Purchasing Coming Soon</Text>
            </View>
          )}

          <Text style={styles.ctaSecondary}>
            {isPro
              ? 'Your Pro membership is active.'
              : 'Billing integration is in development. No purchases are available yet.'}
          </Text>

          {/* Subscription Terms link */}
          <Pressable
            onPress={() => {
              const domain = process.env.EXPO_PUBLIC_DOMAIN ?? 'verifiedtcg.co';
              Linking.openURL(`https://${domain}/subscription-terms`);
            }}
            style={styles.termsLink}
          >
            <Text style={styles.termsLinkText}>Subscription Terms</Text>
            <Feather name="external-link" size={11} color={C.mutedForeground} />
          </Pressable>

          {/* ── Restore Purchases ──────────────────────────────────────────
              Required UI affordance — Apple App Store Review Guidelines §3.1.1.
              Re-reads the subscription_tier stored in Verified TCG's own database
              and applies it on this device. Does NOT query StoreKit or Google Play;
              store-side receipt validation is added with the billing integration
              in task #229. Useful after a reinstall or device switch: sign back
              in, then tap this to re-apply a previously granted Pro tier.
          ─────────────────────────────────────────────────────────────────── */}
          {isAuthenticated && !isPro && (
            <Pressable
              onPress={handleRestorePurchases}
              disabled={restoring}
              style={({ pressed }) => [styles.restoreBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="Restore Purchases"
            >
              {restoring
                ? <ActivityIndicator size="small" color={C.mutedForeground} />
                : <Text style={styles.restoreBtnText}>Restore Purchases</Text>
              }
            </Pressable>
          )}
        </View>

        {/* ── Pro Benefits quick links ── */}
        <View style={styles.proBenefitsSection}>
          <Text style={styles.proBenefitsHeading}>What's Included</Text>
          <Text style={styles.proBenefitsSub}>
            Explore your Pro membership benefits
          </Text>
          <View style={styles.proBenefitsRow}>
            <Pressable
              style={({ pressed }) => [styles.proBenefitCard, pressed && { opacity: 0.8 }]}
              onPress={() => router.push('/verified-drops')}
            >
              <View style={styles.proBenefitIcon}>
                <Feather name="gift" size={20} color={C.primaryForeground} />
              </View>
              <Text style={styles.proBenefitLabel}>Verified{'\n'}Drops</Text>
              <Feather name="chevron-right" size={14} color={C.mutedForeground} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.proBenefitCard, pressed && { opacity: 0.8 }]}
              onPress={() => router.push('/pro-perks')}
            >
              <View style={styles.proBenefitIcon}>
                <Feather name="star" size={20} color={C.primaryForeground} />
              </View>
              <Text style={styles.proBenefitLabel}>Pro{'\n'}Perks</Text>
              <Feather name="chevron-right" size={14} color={C.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {/* ── Free vs Pro comparison ── */}
        <View style={styles.comparisonSection}>
          <Text style={styles.comparisonHeading}>Free vs Pro</Text>

          {/* Column headers */}
          <View style={styles.comparisonHeaderRow}>
            <Text style={styles.comparisonFeatureHeader}>Feature</Text>
            <Text style={styles.comparisonColHeader}>Free</Text>
            <Text style={[styles.comparisonColHeader, styles.comparisonColHeaderPro]}>Pro</Text>
          </View>

          {SUBSCRIPTION_CONFIG.comparison.map(group => (
            <View key={group.category} style={styles.comparisonGroup}>
              {/* Category divider */}
              <View style={styles.categoryDivider}>
                <Text style={styles.categoryLabel}>{group.category}</Text>
              </View>

              {group.rows.map((row, idx) => (
                <ComparisonRow
                  key={row.feature}
                  feature={row.feature}
                  free={row.free}
                  pro={row.pro}
                  shade={idx % 2 === 1}
                />
              ))}
            </View>
          ))}
        </View>

        {/* Bottom padding */}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Benefit card ─────────────────────────────────────────────────────────────

function BenefitCard({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: FeatherIconName;
}) {
  return (
    <View style={styles.benefitCard}>
      {/* Red accent line */}
      <View style={styles.benefitAccent} />
      <View style={styles.benefitIcon}>
        <Feather name={icon} size={18} color={C.primary} />
      </View>
      <View style={styles.benefitText}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

// ─── Comparison row ───────────────────────────────────────────────────────────

type CellValue = boolean | string;

function ComparisonRow({
  feature,
  free,
  pro,
  shade,
}: {
  feature: string;
  free: CellValue;
  pro: CellValue;
  shade: boolean;
}) {
  return (
    <View style={[styles.comparisonRow, shade && styles.comparisonRowShaded]}>
      <Text style={styles.comparisonFeature} numberOfLines={2}>
        {feature}
      </Text>
      <View style={styles.comparisonCell}>
        <CellDisplay value={free} isPro={false} />
      </View>
      <View style={styles.comparisonCell}>
        <CellDisplay value={pro} isPro />
      </View>
    </View>
  );
}

function CellDisplay({ value, isPro }: { value: CellValue; isPro: boolean }) {
  if (value === true) {
    return (
      <Feather
        name="check"
        size={15}
        color={isPro ? C.primary : C.foreground}
      />
    );
  }
  if (value === false) {
    return <Feather name="lock" size={13} color={C.border} />;
  }
  // String value
  return (
    <Text style={[styles.cellString, isPro && styles.cellStringPro]}>
      {value}
    </Text>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    padding: 4,
  },
  scrollContent: {
    paddingTop: 24,
    paddingHorizontal: 20,
  },

  // Hero
  heroSection: {
    marginTop: 8,
    marginBottom: 20,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 5,
    gap: 5,
    marginBottom: 16,
  },
  proBadgeText: {
    color: C.primaryForeground,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  headline: {
    color: C.foreground,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 40,
    marginBottom: 10,
  },
  subheadline: {
    color: C.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
  },

  // Coming Soon banner
  comingSoonBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: `${C.primary}10`,
    borderWidth: 1,
    borderColor: `${C.primary}30`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  comingSoonText: {
    flex: 1,
    color: C.mutedForeground,
    fontSize: 13,
    lineHeight: 19,
  },

  // Benefits
  benefitsSection: {
    gap: 10,
    marginBottom: 28,
  },
  benefitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    gap: 14,
  },
  benefitAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: C.primary,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,30,45,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 14,
  },
  benefitTitle: {
    color: C.foreground,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  benefitSubtitle: {
    color: C.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
  },

  // CTA
  ctaSection: {
    marginBottom: 36,
    alignItems: 'center',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
    paddingVertical: 18,
    borderRadius: 14,
    gap: 8,
    marginBottom: 14,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    alignSelf: 'stretch',
  },
  ctaButtonPro: {
    backgroundColor: '#2a6e3f',
  },
  ctaButtonComingSoon: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  ctaButtonText: {
    color: C.primaryForeground,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  ctaSecondary: {
    color: C.mutedForeground,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  ctaComingSoonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 18,
    marginBottom: 14,
    alignSelf: 'stretch',
  },
  ctaComingSoonLabel: {
    color: C.mutedForeground,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  termsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
    marginBottom: 4,
  },
  termsLinkText: {
    color: C.mutedForeground,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  restoreBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  restoreBtnText: {
    color: C.mutedForeground,
    fontSize: 13,
    textDecorationLine: 'underline',
  },

  // Pro Benefits quick-links
  proBenefitsSection: {
    marginBottom: 28,
  },
  proBenefitsHeading: {
    color: C.foreground,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  proBenefitsSub: {
    color: C.mutedForeground,
    fontSize: 13,
    marginBottom: 14,
  },
  proBenefitsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  proBenefitCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
  },
  proBenefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBenefitLabel: {
    flex: 1,
    color: C.foreground,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },

  // Comparison table
  comparisonSection: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  comparisonHeading: {
    color: C.foreground,
    fontSize: 18,
    fontWeight: '800',
    padding: 16,
    paddingBottom: 12,
  },
  comparisonHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: C.surface,
  },
  comparisonFeatureHeader: {
    flex: 1,
    color: C.mutedForeground,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  comparisonColHeader: {
    width: 52,
    color: C.mutedForeground,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  comparisonColHeaderPro: {
    color: C.primary,
  },
  comparisonGroup: {},
  categoryDivider: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: `${C.muted}80`,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  categoryLabel: {
    color: C.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  comparisonRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  comparisonRowShaded: {
    backgroundColor: `${C.muted}40`,
  },
  comparisonFeature: {
    flex: 1,
    color: C.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  comparisonCell: {
    width: 52,
    alignItems: 'center',
  },
  cellString: {
    color: C.foreground,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  cellStringPro: {
    color: C.primary,
  },
});
