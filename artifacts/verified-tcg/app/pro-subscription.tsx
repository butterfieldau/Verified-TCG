/**
 * Pro Subscription Screen — Verified TCG
 *
 * Full upgrade screen with pricing toggle, benefit cards, CTA, and
 * Free vs Pro feature comparison. All pricing constants come from
 * SUBSCRIPTION_CONFIG so copy can be updated in one place.
 *
 * Out of scope: real payment / billing SDK, trial enforcement.
 */

import React, { useState } from 'react';
import {
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
import { useApp } from '@/context/AppContext';

const C = colors.dark;

type BillingCycle = 'monthly' | 'annual';

// ─── Icon names used in benefit cards ────────────────────────────────────────
// Feather icon type is a string union; cast to satisfy TypeScript.
type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ProSubscriptionScreen() {
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const { isAuthenticated, setSubscriptionTier } = useApp();

  const monthly = SUBSCRIPTION_CONFIG.monthlyPriceAUD;
  const annual = SUBSCRIPTION_CONFIG.annualPriceAUD;
  const equiv = SUBSCRIPTION_CONFIG.annualMonthlyEquiv;
  const saving = SUBSCRIPTION_CONFIG.annualSavingPercent;

  function handleStartTrial() {
    if (!isAuthenticated) {
      router.push({ pathname: '/create-account', params: { next: '/pro-subscription' } } as any);
      return;
    }
    // Billing is not connected yet; keep the entitlement transition explicit
    // so the complete upgrade experience can be tested end to end.
    setSubscriptionTier('pro');
    router.back();
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
          <Text style={styles.headline}>Collect smarter.{'\n'}Trade faster.</Text>
          <Text style={styles.subheadline}>
            Everything a serious collector needs in one subscription.
          </Text>
        </View>

        {/* ── Billing toggle ── */}
        <View style={styles.toggleContainer}>
          <Pressable
            style={[styles.toggleSegment, cycle === 'monthly' && styles.toggleSegmentActive]}
            onPress={() => setCycle('monthly')}
            accessibilityRole="radio"
            accessibilityState={{ checked: cycle === 'monthly' }}
          >
            <Text style={[styles.toggleLabel, cycle === 'monthly' && styles.toggleLabelActive]}>
              MONTHLY
            </Text>
          </Pressable>

          <Pressable
            style={[styles.toggleSegment, cycle === 'annual' && styles.toggleSegmentActive]}
            onPress={() => setCycle('annual')}
            accessibilityRole="radio"
            accessibilityState={{ checked: cycle === 'annual' }}
          >
            <Text style={[styles.toggleLabel, cycle === 'annual' && styles.toggleLabelActive]}>
              ANNUAL
            </Text>
            {/* Save badge */}
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>Save {saving}%</Text>
            </View>
          </Pressable>
        </View>

        {/* ── Price display ── */}
        <View style={styles.priceBlock}>
          {cycle === 'annual' ? (
            <>
              <View style={styles.priceRow}>
                <Text style={styles.priceCurrency}>$</Text>
                <Text style={styles.priceAmount}>{annual.toFixed(2)}</Text>
                <Text style={styles.pricePer}> AUD / year</Text>
              </View>
              <Text style={styles.priceEquiv}>${equiv.toFixed(2)} / mo — billed annually</Text>
              <View style={styles.recommendedChip}>
                <Text style={styles.recommendedText}>Recommended</Text>
              </View>
            </>
          ) : (
            <View style={styles.priceRow}>
              <Text style={styles.priceCurrency}>$</Text>
              <Text style={styles.priceAmount}>{monthly.toFixed(2)}</Text>
              <Text style={styles.pricePer}> AUD / month</Text>
            </View>
          )}
        </View>

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

        {/* ── CTA ── */}
        <View style={styles.ctaSection}>
          <Pressable
            style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}
            onPress={handleStartTrial}
            accessibilityRole="button"
            accessibilityLabel="Start 7-day free trial"
          >
            <Feather name="zap" size={16} color={C.primaryForeground} />
            <Text style={styles.ctaButtonText}>START 7-DAY FREE TRIAL</Text>
          </Pressable>

          <Text style={styles.ctaSecondary}>
            {isAuthenticated ? 'Keep using Verified TCG Free anytime.' : 'Create a free account before starting your trial.'}
          </Text>
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
    marginBottom: 28,
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

  // Toggle
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleSegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9,
    gap: 6,
  },
  toggleSegmentActive: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.primary,
  },
  toggleLabel: {
    color: C.mutedForeground,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  toggleLabelActive: {
    color: C.foreground,
  },
  saveBadge: {
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  saveBadgeText: {
    color: C.primaryForeground,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // Price
  priceBlock: {
    alignItems: 'center',
    marginBottom: 28,
    minHeight: 72,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  priceCurrency: {
    color: C.foreground,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  priceAmount: {
    color: C.foreground,
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1.5,
    lineHeight: 52,
  },
  pricePer: {
    color: C.mutedForeground,
    fontSize: 15,
    marginBottom: 10,
  },
  priceEquiv: {
    color: C.mutedForeground,
    fontSize: 13,
    marginTop: 4,
  },
  recommendedChip: {
    marginTop: 8,
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.primary,
  },
  recommendedText: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
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
  },

  // Comparison
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
    letterSpacing: -0.3,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  comparisonHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  comparisonFeatureHeader: {
    flex: 1,
    color: C.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  comparisonColHeader: {
    width: 64,
    color: C.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  comparisonColHeaderPro: {
    color: C.primary,
  },
  comparisonGroup: {},
  categoryDivider: {
    backgroundColor: C.surface,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  categoryLabel: {
    color: C.mutedForeground,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  comparisonRowShaded: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  comparisonFeature: {
    flex: 1,
    color: C.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  comparisonCell: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellString: {
    color: C.mutedForeground,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  cellStringPro: {
    color: C.primary,
  },

  // Pro Benefits quick links
  proBenefitsSection: {
    marginBottom: 32,
  },
  proBenefitsHeading: {
    color: C.foreground,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  proBenefitsSub: {
    color: C.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  proBenefitsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  proBenefitCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  proBenefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBenefitLabel: {
    flex: 1,
    color: C.foreground,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
});
