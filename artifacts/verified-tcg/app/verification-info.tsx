import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

const C = colors.dark;

interface BadgeType {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  tagline: string;
  color: string;
  description: string;
  howItWorks: string[];
  importantNote: string;
}

const BADGE_TYPES: BadgeType[] = [
  {
    id: 'account',
    icon: 'user-check',
    label: 'Verified Account',
    tagline: 'Identity confirmed',
    color: '#22C55E',
    description:
      'A Verified Account badge indicates that this user has completed an identity verification step on the Verified TCG platform.',
    howItWorks: [
      'User submits government-issued ID (prototype: mocked)',
      'Account details are reviewed against submitted information',
      'Badge is applied once verification information is accepted',
    ],
    importantNote:
      'Verification information confirms identity details were provided. It does not guarantee all activity on this account or authenticate any individual listing.',
  },
  {
    id: 'seller',
    icon: 'shield',
    label: 'Verified Seller',
    tagline: 'Trusted marketplace seller',
    color: '#3B82F6',
    description:
      'Verified Sellers have completed additional steps including identity verification and have an established trading history on the platform.',
    howItWorks: [
      'Verified Account status required',
      'Minimum completed trades and positive ratings',
      'Acceptance of Verified TCG seller policies (prototype: mocked)',
    ],
    importantNote:
      "Verified Seller status reflects information provided about a seller's history. It does not guarantee the authenticity of any individual card listed for sale.",
  },
  {
    id: 'ownership',
    icon: 'lock',
    label: 'Verified Ownership',
    tagline: 'Collector provided ownership evidence',
    color: '#F59E0B',
    description:
      'Verified Ownership means a collector has submitted supporting information — such as purchase receipts or grading certificates — as evidence of ownership for a card in their collection.',
    howItWorks: [
      'Collector uploads proof of purchase or grading documentation',
      'Submitted information is reviewed (prototype: mocked)',
      'Badge applied to specific collection entries',
    ],
    importantNote:
      'Verified Ownership reflects documentation submitted by the collector. Verified TCG does not independently authenticate physical cards or guarantee provenance.',
  },
  {
    id: 'listing',
    icon: 'tag',
    label: 'Verified Listing',
    tagline: 'Listing has passed platform checks',
    color: C.primary,
    description:
      'A Verified Listing indicates that the seller provided supporting information about this specific listing — such as grading certificates or provenance documentation.',
    howItWorks: [
      'Seller submits documentation relevant to the listing',
      'Documentation is reviewed against listing details (prototype: mocked)',
      'Badge applied to the specific listing once accepted',
    ],
    importantNote:
      'Verified Listing reflects information provided by the seller for this listing. Verified TCG does not independently physically authenticate cards. Always review listing details carefully.',
  },
];

export default function VerificationInfoScreen() {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<string | null>('account');
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Verification</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Intro */}
      <View style={styles.intro}>
        <View style={[styles.introBadge, { backgroundColor: `${C.positive}22` }]}>
          <Feather name="shield" size={28} color={C.positive} />
        </View>
        <Text style={styles.introTitle}>How Verification Works</Text>
        <Text style={styles.introBody}>
          Verified TCG uses a verification information system to help collectors make informed
          decisions. Verification badges indicate that supporting information has been provided
          and reviewed — they do not constitute a guarantee of authenticity.
        </Text>
      </View>

      {/* Important disclaimer */}
      <View style={[styles.disclaimer, { backgroundColor: `${C.warning}18`, borderColor: `${C.warning}44` }]}>
        <Feather name="info" size={16} color={C.warning} style={{ marginTop: 1 }} />
        <Text style={styles.disclaimerText}>
          Verification information is provided to help collectors assess risk. It does not
          replace your own due diligence. Always review card details, seller history, and
          grading certificates carefully before purchasing.
        </Text>
      </View>

      {/* Badge types */}
      <View style={styles.badgesSection}>
        <Text style={styles.sectionTitle}>Badge Types</Text>
        {BADGE_TYPES.map(badge => {
          const isOpen = expanded === badge.id;
          return (
            <Pressable
              key={badge.id}
              onPress={() => setExpanded(isOpen ? null : badge.id)}
              style={({ pressed }) => [
                styles.badgeCard,
                { backgroundColor: pressed ? C.muted : C.card },
              ]}
            >
              {/* Badge header */}
              <View style={styles.badgeHeader}>
                <View style={[styles.badgeIcon, { backgroundColor: `${badge.color}22` }]}>
                  <Feather name={badge.icon} size={20} color={badge.color} />
                </View>
                <View style={styles.badgeTitleBlock}>
                  <View style={styles.badgeLabelRow}>
                    <Text style={styles.badgeLabel}>{badge.label}</Text>
                    <View style={[styles.badgePill, { backgroundColor: `${badge.color}22` }]}>
                      <Text style={[styles.badgePillText, { color: badge.color }]}>
                        ✓ Verified
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.badgeTagline}>{badge.tagline}</Text>
                </View>
                <Feather
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={C.mutedForeground}
                />
              </View>

              {/* Expanded content */}
              {isOpen && (
                <View style={styles.badgeBody}>
                  <Text style={styles.badgeDescription}>{badge.description}</Text>

                  <Text style={styles.badgeSubheading}>How it works</Text>
                  {badge.howItWorks.map((step, i) => (
                    <View key={i} style={styles.stepRow}>
                      <View style={[styles.stepDot, { backgroundColor: badge.color }]} />
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}

                  <View style={[styles.noteBox, { backgroundColor: `${C.warning}18`, borderColor: `${C.warning}44` }]}>
                    <Feather name="alert-circle" size={13} color={C.warning} style={{ marginTop: 2 }} />
                    <Text style={styles.noteText}>{badge.importantNote}</Text>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Questions */}
      <View style={[styles.faqCard, { backgroundColor: C.card }]}>
        <Text style={styles.faqTitle}>Questions about verification?</Text>
        <Text style={styles.faqBody}>
          Our verification system is continuously improving. If you have questions about a
          specific badge or listing, please contact our support team.
        </Text>
        <Pressable style={[styles.faqBtn, { backgroundColor: C.muted }]}>
          <Feather name="help-circle" size={15} color={C.foreground} />
          <Text style={styles.faqBtnText}>Learn More</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  intro: {
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  introBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  introBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
  },
  disclaimer: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 28,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 19,
  },
  badgesSection: { paddingHorizontal: 20, gap: 10, marginBottom: 24 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 4 },
  badgeCard: { borderRadius: 16, padding: 16 },
  badgeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  badgeTitleBlock: { flex: 1, gap: 4 },
  badgeLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badgeLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  badgePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  badgeTagline: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  badgeBody: { paddingTop: 16, gap: 14 },
  badgeDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 20,
  },
  badgeSubheading: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground, letterSpacing: 0.5 },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  stepText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 20 },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  noteText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },
  faqCard: { marginHorizontal: 20, borderRadius: 16, padding: 18, gap: 10 },
  faqTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  faqBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 20 },
  faqBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 4,
  },
  faqBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
