import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

const C = colors.dark;

interface Section {
  heading: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    heading: '1. Information We Collect',
    body: 'We collect information you provide directly to us, such as:\n\n• Account information: name, email address, username, profile photo, and bio.\n• Collection data: cards you add, grades, quantities, and acquisition prices.\n• Usage data: features you use, searches performed, and interaction patterns within the App.\n• Device information: device type, OS version, and app version for diagnostic purposes.\n• Payment information: processed by our payment provider (we do not store card numbers).',
  },
  {
    heading: '2. How We Use Your Information',
    body: "We use the information we collect to:\n\n\u2022 Provide, maintain, and improve the App and its features.\n\u2022 Process subscriptions and payments.\n\u2022 Send you price alerts, trade match notifications, and other communications you've enabled.\n\u2022 Personalise your experience based on your TCG preferences and collection.\n\u2022 Detect, investigate, and prevent fraudulent or harmful activity.\n\u2022 Comply with legal obligations.",
  },
  {
    heading: '3. Sharing of Information',
    body: 'We do not sell your personal information. We may share your information with:\n\n• Service providers: companies that help us operate the App (e.g. hosting, analytics, payment processing), under confidentiality agreements.\n• Other users: only information you choose to make public (your display name, profile, and optionally your collection or wishlist based on your privacy settings).\n• Law enforcement or regulatory bodies: when required by law, subpoena, or other legal process.\n• Successors: in the event of a merger, acquisition, or sale of assets, subject to the same privacy commitments.',
  },
  {
    heading: '4. Your Privacy Controls',
    body: 'You have control over what other collectors can see about you. In Settings → Privacy you can toggle:\n\n• Public profile visibility\n• Whether your collection list is visible\n• Whether your wishlist is visible\n• Whether your for-trade cards are listed\n• Whether your for-sale items are listed\n\nYour portfolio value is never shared with other users, regardless of privacy settings.',
  },
  {
    heading: '5. Data Retention',
    body: 'We retain your account and collection data for as long as your account is active or as needed to provide the App. If you delete your account, we will delete or anonymise your personal information within 30 days, except where we are required to retain it for legal or regulatory reasons.',
  },
  {
    heading: '6. Security',
    body: 'We implement industry-standard security measures including encryption in transit (TLS), hashed passwords, and secure token-based authentication. No security system is perfect, and we cannot guarantee the absolute security of your information. Please use a strong, unique password and enable biometric authentication where available.',
  },
  {
    heading: '7. Children\'s Privacy',
    body: 'The App is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you become aware that a child has provided us with personal information, please contact us and we will take steps to delete that information.',
  },
  {
    heading: '8. Third-Party Services',
    body: 'The App integrates with third-party services for pricing data (eBay, TCGPlayer, Card Market), authentication (OAuth providers), and analytics. These services have their own privacy policies, and we encourage you to review them. We are not responsible for the privacy practices of third parties.',
  },
  {
    heading: '9. Cookies & Local Storage',
    body: 'The App uses local device storage (AsyncStorage) to cache your collection, settings, and session tokens for offline access and performance. This data stays on your device and is not shared with third parties.',
  },
  {
    heading: '10. Your Rights',
    body: 'Depending on your location, you may have the right to:\n\n• Access the personal information we hold about you.\n• Request correction of inaccurate information.\n• Request deletion of your account and data.\n• Object to or restrict certain types of processing.\n• Receive a copy of your data in a portable format.\n\nTo exercise these rights, use Settings → Data & Account → Export My Data, or contact us via Help & Support.',
  },
  {
    heading: '11. Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. We will notify you of material changes via the App or email. The date at the top of this policy indicates when it was last revised.',
  },
  {
    heading: '12. Contact Us',
    body: 'If you have questions or concerns about this Privacy Policy or our data practices, please contact us via Help & Support in the App, or write to: Verified TCG Pty Ltd, Privacy Team, PO Box [TBD], Sydney NSW 2000, Australia.',
  },
];

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Placeholder notice */}
      <View style={[styles.noticeBox, { backgroundColor: `${C.warning}15`, borderColor: `${C.warning}44` }]}>
        <Feather name="alert-triangle" size={14} color={C.warning} />
        <Text style={[styles.noticeText, { color: C.warning }]}>
          Placeholder content — final legal document forthcoming. Last updated: [Date TBD]
        </Text>
      </View>

      <Text style={styles.preamble}>
        This Privacy Policy describes how Verified TCG Pty Ltd collects, uses, and shares your personal information when you use the Verified TCG application.
      </Text>

      {SECTIONS.map(section => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.heading}</Text>
          <Text style={styles.sectionBody}>{section.body}</Text>
        </View>
      ))}

      <View style={styles.footer}>
        <Pressable onPress={() => router.push('/terms' as any)}>
          <Text style={[styles.footerLink, { color: C.primary }]}>Terms of Service</Text>
        </Pressable>
        <Text style={styles.footerSep}>·</Text>
        <Pressable onPress={() => router.push('/about' as any)}>
          <Text style={[styles.footerLink, { color: C.primary }]}>About Verified TCG</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 18 },
  preamble: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 22,
    marginBottom: 24,
  },
  section: { marginBottom: 20 },
  sectionHeading: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 21,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  footerLink: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  footerSep: { fontSize: 13, color: C.mutedForeground },
});
