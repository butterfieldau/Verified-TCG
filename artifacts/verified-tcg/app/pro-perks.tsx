/**
 * Pro Perks — Verified TCG Pro benefit screen.
 *
 * Lists partner offer cards for Pro members. All perks are Pro-gated;
 * Free users see a teaser with an upgrade prompt.
 *
 * Partner integrations are prototypes — "View Offer" shows a toast only.
 */

import React from 'react';
import {
  Alert,
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

interface Perk {
  id: string;
  partnerName: string;
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  highlight?: boolean;
}

const MOCK_PERKS: Perk[] = [
  {
    id: '1',
    partnerName: 'TAG Authentication Group',
    title: '10% off grading submission',
    description: 'Save on every grading submission to TAG Authentication Group. Apply at checkout with your Pro member code.',
    icon: 'award',
    highlight: true,
  },
  {
    id: '2',
    partnerName: 'VaultShip Partners',
    title: 'Free express shipping over $50',
    description: 'Complimentary express tracked shipping on all orders over $50. No code required — automatically applied at checkout.',
    icon: 'package',
  },
  {
    id: '3',
    partnerName: 'TCXPO Events',
    title: 'Early TCXPO ticket access',
    description: 'Get 24-hour early access to TCXPO ticket sales before they open to the general public. Pro members only.',
    icon: 'calendar',
    highlight: true,
  },
  {
    id: '4',
    partnerName: 'CardDisplay Co.',
    title: 'Card display discount',
    description: 'Exclusive 15% discount on premium card display cases, frames, and UV-protective storage from CardDisplay Co.',
    icon: 'grid',
  },
  {
    id: '5',
    partnerName: 'ProSleeve Accessories',
    title: 'Accessories partner offer',
    description: 'Free starter sleeve pack (100 units) with your first order. Premium Japanese-import card sleeves.',
    icon: 'star',
  },
  {
    id: '6',
    partnerName: 'CollectorInsure',
    title: 'Discounted collection insurance',
    description: 'Protect your collection with a specialised card insurance policy. Pro members receive reduced rates.',
    icon: 'shield',
  },
];

// ─── Perk Card ────────────────────────────────────────────────────────────────

function PerkCard({ perk }: { perk: Perk }) {
  function handleViewOffer() {
    Alert.alert(
      'Partner Offer',
      `${perk.partnerName}\n\nThis is a prototype — partner integrations are coming soon.`,
      [{ text: 'OK' }],
    );
  }

  return (
    <View style={[styles.perkCard, perk.highlight && styles.perkCardHighlight]}>
      {perk.highlight && (
        <View style={styles.highlightBadge}>
          <Text style={styles.highlightBadgeText}>FEATURED</Text>
        </View>
      )}

      {/* Partner icon + name */}
      <View style={styles.perkHeader}>
        <View style={[styles.perkIconBg, perk.highlight && styles.perkIconBgHighlight]}>
          <Feather name={perk.icon} size={18} color={perk.highlight ? C.primaryForeground : C.foreground} />
        </View>
        <Text style={styles.partnerName}>{perk.partnerName}</Text>
      </View>

      {/* Offer details */}
      <Text style={styles.perkTitle}>{perk.title}</Text>
      <Text style={styles.perkDescription}>{perk.description}</Text>

      {/* CTA */}
      <Pressable
        style={({ pressed }) => [styles.viewOfferBtn, pressed && styles.viewOfferBtnPressed]}
        onPress={handleViewOffer}
        accessibilityRole="button"
        accessibilityLabel={`View offer from ${perk.partnerName}`}
      >
        <Text style={styles.viewOfferText}>View Offer</Text>
        <Feather name="external-link" size={13} color={C.foreground} />
      </Pressable>
    </View>
  );
}

// ─── Free teaser card ─────────────────────────────────────────────────────────

function PerkCardTeaser({ perk }: { perk: Perk }) {
  return (
    <View style={[styles.perkCard, styles.perkCardTeaser]}>
      <View style={styles.perkHeader}>
        <View style={styles.perkIconBg}>
          <Feather name={perk.icon} size={18} color={C.mutedForeground} />
        </View>
        <Text style={[styles.partnerName, { color: `${C.mutedForeground}88` }]}>{perk.partnerName}</Text>
      </View>
      <Text style={[styles.perkTitle, styles.teaserTitle]}>{perk.title}</Text>
      <View style={styles.teaserBlur}>
        <Text style={styles.teaserBlurText}>████████████████████████ ████████████</Text>
      </View>
      <View style={[styles.viewOfferBtn, styles.viewOfferBtnLocked]}>
        <Feather name="lock" size={13} color={C.mutedForeground} />
        <Text style={[styles.viewOfferText, { color: C.mutedForeground }]}>Pro Only</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProPerksScreen() {
  const insets = useSafeAreaInsets();
  const { subscriptionTier } = useApp();
  const isPro = subscriptionTier === 'pro';

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

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
          <Feather name="star" size={22} color={C.primary} />
          <Text style={styles.pageTitle}>PRO PERKS</Text>
        </View>
        <Text style={styles.pageSubtitle}>
          Exclusive partner offers included with your Pro membership
        </Text>
      </View>

      {/* Pro member banner */}
      {isPro ? (
        <View style={[styles.memberBanner, styles.memberBannerPro]}>
          <Feather name="zap" size={16} color={C.primaryForeground} />
          <View style={styles.memberBannerText}>
            <Text style={styles.memberBannerTitle}>PRO MEMBER</Text>
            <Text style={styles.memberBannerSub}>All {MOCK_PERKS.length} partner perks unlocked</Text>
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
            <Text style={styles.memberBannerSub}>Upgrade to unlock all {MOCK_PERKS.length} partner perks</Text>
          </View>
          <Feather name="chevron-right" size={16} color={C.mutedForeground} />
        </Pressable>
      )}

      {/* Perks list */}
      {isPro ? (
        MOCK_PERKS.map(perk => (
          <PerkCard key={perk.id} perk={perk} />
        ))
      ) : (
        <>
          {/* Show first perk as teaser, rest locked */}
          <PerkCardTeaser perk={MOCK_PERKS[0]} />

          {/* Upgrade gate */}
          <View style={styles.upgradeGate}>
            <View style={styles.upgradeIconCircle}>
              <Feather name="lock" size={24} color={C.primaryForeground} />
            </View>
            <Text style={styles.upgradeTitle}>Unlock Pro Perks</Text>
            <Text style={styles.upgradeDescription}>
              {MOCK_PERKS.length} exclusive partner offers are waiting for you. Upgrade to Pro to access every perk instantly.
            </Text>

            {/* Preview locked perks */}
            <View style={styles.lockedPerksList}>
              {MOCK_PERKS.slice(1).map(perk => (
                <View key={perk.id} style={styles.lockedPerkRow}>
                  <Feather name="lock" size={12} color={C.mutedForeground} />
                  <Text style={styles.lockedPerkRowText}>{perk.title}</Text>
                  <Text style={styles.lockedPerkPartner}>— {perk.partnerName}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [styles.unlockCta, pressed && { opacity: 0.85 }]}
              onPress={() => router.push('/pro-subscription')}
            >
              <Feather name="zap" size={15} color={C.primaryForeground} />
              <Text style={styles.unlockCtaText}>Unlock Pro Perks</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* T&Cs note */}
      <Text style={styles.tcNote}>Partner offers are subject to availability. T&Cs apply per partner.</Text>
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

  // Perk card
  perkCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  perkCardHighlight: {
    borderColor: `${C.primary}55`,
    backgroundColor: `${C.primary}0A`,
  },
  perkCardTeaser: {
    opacity: 0.6,
  },
  highlightBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: C.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  highlightBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
    letterSpacing: 0.6,
  },

  perkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  perkIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkIconBgHighlight: {
    backgroundColor: C.primary,
  },
  partnerName: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
    flex: 1,
  },

  perkTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  teaserTitle: {
    color: C.mutedForeground,
  },
  perkDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 19,
    marginBottom: 14,
  },

  teaserBlur: {
    marginBottom: 14,
  },
  teaserBlurText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}44`,
    lineHeight: 19,
  },

  viewOfferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.muted,
    borderRadius: 10,
    paddingVertical: 10,
  },
  viewOfferBtnPressed: {
    opacity: 0.8,
  },
  viewOfferBtnLocked: {
    backgroundColor: `${C.muted}88`,
  },
  viewOfferText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },

  // Upgrade gate
  upgradeGate: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: `${C.primary}33`,
  },
  upgradeIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  upgradeTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  upgradeDescription: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },

  lockedPerksList: {
    width: '100%',
    marginBottom: 20,
    gap: 8,
  },
  lockedPerkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedPerkRowText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
  },
  lockedPerkPartner: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}77`,
    flex: 1,
  },

  unlockCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
  },
  unlockCtaText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
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
