/**
 * Verified Drops — Verified TCG Pro benefit screen.
 *
 * Shows a curated feed of giveaways and exclusive drops for Pro members.
 * Open drops are accessible to all tiers; Pro-exclusive drops are locked
 * behind ProFeaturePreview for Free users.
 *
 * Countdown timers are static mock values (prototype only).
 */

import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';

const C = colors.dark;

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Drop {
  id: string;
  title: string;
  description: string;
  endsIn: string;
  isProExclusive: boolean;
  category: string;
}

const MOCK_DROPS: Drop[] = [
  {
    id: '1',
    title: 'August Drop — PSA 10 Pikachu',
    description: 'One lucky collector wins a PSA 10 graded Base Set Pikachu. Authenticated and shipped directly from our vault.',
    endsIn: '4d 12h',
    isProExclusive: false,
    category: 'Graded Card',
  },
  {
    id: '2',
    title: 'TAG Grading Pack',
    description: '5 grading vouchers for TAG Authentication Group. Submit any 5 cards for PSA or BGS grading — no minimum value.',
    endsIn: '2d 8h',
    isProExclusive: true,
    category: 'Grading',
  },
  {
    id: '3',
    title: 'TCXPO Sydney — VIP Passes',
    description: '2 × VIP passes to TCXPO Sydney, including early-access floor time, meet & greet access, and a collector gift pack.',
    endsIn: '6d 3h',
    isProExclusive: true,
    category: 'Event',
  },
  {
    id: '4',
    title: 'Vintage Lot — Jungle Set',
    description: 'A sealed Jungle booster pack lot, authenticated and graded. 10 packs from the original 1999 print run.',
    endsIn: '1d 22h',
    isProExclusive: true,
    category: 'Sealed',
  },
  {
    id: '5',
    title: 'Collector of the Month',
    description: 'Feature your collection on our social channels. One collector chosen monthly from verified members.',
    endsIn: '12d 0h',
    isProExclusive: false,
    category: 'Feature',
  },
  {
    id: '6',
    title: 'Card Storage Bundle',
    description: 'Premium card storage set: 200 × Perfect Fit sleeves, 100 × top loaders, and 2 × binder portfolios.',
    endsIn: '3d 17h',
    isProExclusive: true,
    category: 'Accessories',
  },
];

// ─── Drop Card Component ──────────────────────────────────────────────────────

function DropCard({ drop, isPro }: { drop: Drop; isPro: boolean }) {
  const isLocked = drop.isProExclusive && !isPro;

  return (
    <View style={[styles.card, isLocked && styles.cardLocked]}>
      {/* Header row: category + badges */}
      <View style={styles.cardHeader}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{drop.category.toUpperCase()}</Text>
        </View>
        {drop.isProExclusive && (
          <View style={styles.proExclusiveBadge}>
            <Feather name="zap" size={10} color={C.primaryForeground} />
            <Text style={styles.proExclusiveText}>PRO EXCLUSIVE</Text>
          </View>
        )}
      </View>

      {/* Title */}
      <Text style={[styles.cardTitle, isLocked && styles.cardTitleLocked]}>
        {drop.title}
      </Text>

      {/* Description */}
      <Text style={[styles.cardDescription, isLocked && styles.cardDescriptionLocked]} numberOfLines={isLocked ? 2 : 3}>
        {drop.description}
      </Text>

      {/* Footer: countdown + CTA */}
      <View style={styles.cardFooter}>
        <View style={styles.countdownBadge}>
          <Feather name="clock" size={11} color={C.warning} />
          <Text style={styles.countdownText}>Ends in {drop.endsIn}</Text>
        </View>

        {isLocked ? (
          <Pressable
            style={styles.lockedCta}
            onPress={() => router.push('/pro-subscription')}
          >
            <Feather name="lock" size={12} color={C.primaryForeground} />
            <Text style={styles.lockedCtaText}>Unlock Pro</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.enterCta}>
            <Text style={styles.enterCtaText}>Enter Drop</Text>
          </Pressable>
        )}
      </View>

      {/* Lock overlay strip for Pro-exclusive when free */}
      {isLocked && (
        <View style={styles.lockStrip} pointerEvents="none">
          <Feather name="lock" size={14} color={C.mutedForeground} />
          <Text style={styles.lockStripText}>Pro members only — upgrade to enter</Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VerifiedDropsScreen() {
  const insets = useSafeAreaInsets();
  const { subscriptionTier } = useApp();
  const isPro = subscriptionTier === 'pro';

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const openDrops = MOCK_DROPS.filter(d => !d.isProExclusive);
  const proDrops = MOCK_DROPS.filter(d => d.isProExclusive);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Back nav */}
      <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={12}>
        <Feather name="arrow-left" size={20} color={C.foreground} />
      </Pressable>

      {/* Page header */}
      <View style={styles.pageHeader}>
        <View style={styles.titleRow}>
          <Feather name="gift" size={22} color={C.primary} />
          <Text style={styles.pageTitle}>VERIFIED DROPS</Text>
        </View>
        <Text style={styles.pageSubtitle}>
          Exclusive giveaways and drops for Verified TCG members
        </Text>
      </View>

      {/* Pro member banner */}
      {isPro ? (
        <View style={[styles.memberBanner, styles.memberBannerPro]}>
          <Feather name="zap" size={16} color={C.primaryForeground} />
          <View style={styles.memberBannerText}>
            <Text style={styles.memberBannerTitle}>PRO MEMBER</Text>
            <Text style={styles.memberBannerSub}>You have full access to all drops</Text>
          </View>
        </View>
      ) : (
        <Pressable
          style={[styles.memberBanner, styles.memberBannerFree]}
          onPress={() => router.push('/pro-subscription')}
        >
          <Feather name="lock" size={16} color={C.warning} />
          <View style={styles.memberBannerText}>
            <Text style={[styles.memberBannerTitle, { color: C.warning }]}>FREE MEMBER</Text>
            <Text style={styles.memberBannerSub}>Upgrade to enter Pro-exclusive drops</Text>
          </View>
          <Feather name="chevron-right" size={16} color={C.mutedForeground} />
        </Pressable>
      )}

      {/* Open drops — all tiers */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Open to All</Text>
        <View style={styles.sectionBadge}>
          <Text style={styles.sectionBadgeText}>{openDrops.length} active</Text>
        </View>
      </View>

      {openDrops.map(drop => (
        <DropCard key={drop.id} drop={drop} isPro={isPro} />
      ))}

      {/* Pro-exclusive drops */}
      <View style={[styles.sectionHeader, { marginTop: 8 }]}>
        <Text style={styles.sectionTitle}>Pro Exclusive</Text>
        <View style={[styles.sectionBadge, { backgroundColor: `${C.primary}22` }]}>
          <Feather name="zap" size={10} color={C.primary} />
          <Text style={[styles.sectionBadgeText, { color: C.primary }]}>{proDrops.length} active</Text>
        </View>
      </View>

      {proDrops.map(drop => (
        <DropCard key={drop.id} drop={drop} isPro={isPro} />
      ))}

      {/* T&Cs note */}
      <Text style={styles.tcNote}>T&Cs apply. Drops are for members only. One entry per account.</Text>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  pageHeader: { marginBottom: 20 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  pageTitle: {
    fontSize: 26,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: 1,
  },
  pageSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 20,
  },

  memberBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
  },
  memberBannerPro: {
    backgroundColor: `${C.primary}18`,
    borderColor: `${C.primary}44`,
  },
  memberBannerFree: {
    backgroundColor: `${C.warning}12`,
    borderColor: `${C.warning}33`,
  },
  memberBannerText: { flex: 1 },
  memberBannerTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
    letterSpacing: 0.8,
  },
  memberBannerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginTop: 1,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  sectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.muted,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sectionBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
  },

  // Drop card
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  cardLocked: {
    opacity: 0.75,
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  categoryBadge: {
    backgroundColor: C.muted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    letterSpacing: 0.6,
  },
  proExclusiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  proExclusiveText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
    letterSpacing: 0.6,
  },

  cardTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  cardTitleLocked: {
    color: C.mutedForeground,
  },
  cardDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 19,
    marginBottom: 14,
  },
  cardDescriptionLocked: {
    color: `${C.mutedForeground}99`,
  },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: `${C.warning}18`,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countdownText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.warning,
  },

  enterCta: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  enterCtaText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
  },
  lockedCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.muted,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  lockedCtaText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
  },

  lockStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  lockStripText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    fontStyle: 'italic',
  },

  tcNote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}88`,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 16,
  },
});
