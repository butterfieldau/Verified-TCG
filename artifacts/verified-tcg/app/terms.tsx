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
    heading: '1. Acceptance of Terms',
    body: 'By downloading, installing, or using the Verified TCG application ("App"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the App. These Terms constitute a legally binding agreement between you and Verified TCG Pty Ltd ("we", "us", or "our").',
  },
  {
    heading: '2. Eligibility',
    body: 'You must be at least 13 years of age to create an account and use the App. If you are under 18, you must have the consent of a parent or legal guardian. By using the App, you represent that you meet these eligibility requirements.',
  },
  {
    heading: '3. Your Account',
    body: 'When you create an account, you must provide accurate, current, and complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. Notify us immediately of any unauthorised access to your account.',
  },
  {
    heading: '4. Acceptable Use',
    body: 'You agree not to: (a) use the App for any unlawful purpose; (b) post or transmit content that is fraudulent, misleading, or infringes on any third party\'s intellectual property rights; (c) attempt to reverse-engineer, decompile, or otherwise derive source code from the App; (d) use automated tools to scrape or extract data from the App without our prior written consent; or (e) engage in any activity that disrupts or interferes with the App\'s operation.',
  },
  {
    heading: '5. User-Generated Content',
    body: 'You retain ownership of content you submit to the App (collection data, trade listings, messages, etc.). By submitting content, you grant us a non-exclusive, worldwide, royalty-free licence to use, display, and distribute that content solely for the purpose of operating the App. We reserve the right to remove content that violates these Terms.',
  },
  {
    heading: '6. Pricing Data Disclaimer',
    body: 'Price data displayed in the App is sourced from third-party providers and is provided for informational purposes only. We make no representations about the accuracy, completeness, or timeliness of pricing information. Do not rely on App pricing data for financial or investment decisions. Actual transaction values may differ.',
  },
  {
    heading: '7. Grading & Verification',
    body: 'The App\'s card verification and grading features are provided as a convenience tool only. Verification results are not a guarantee of card authenticity or condition. Always seek professional grading services for high-value purchases. We are not liable for losses arising from reliance on in-App verification results.',
  },
  {
    heading: '8. Subscriptions & Payments',
    body: 'Verified Pro subscriptions are billed on a recurring basis. You authorise us (or our payment processor) to charge your payment method for recurring subscription fees. Cancellations take effect at the end of the current billing period. Refunds are handled in accordance with applicable consumer protection laws.',
  },
  {
    heading: '9. Intellectual Property',
    body: 'The App, including its design, graphics, user interface, and content (excluding user-generated content), is owned by Verified TCG Pty Ltd and protected by copyright and other intellectual property laws. Card names, artwork, and related trademarks are the property of their respective owners (Nintendo, Wizards of the Coast, Konami, etc.). Verified TCG is not affiliated with or endorsed by these companies.',
  },
  {
    heading: '10. Disclaimer of Warranties',
    body: 'THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE ERROR-FREE, SECURE, OR CONTINUOUSLY AVAILABLE.',
  },
  {
    heading: '11. Limitation of Liability',
    body: 'TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF YOUR USE OF THE APP. OUR TOTAL LIABILITY FOR ANY CLAIM RELATED TO THE APP SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE 12 MONTHS PRECEDING THE CLAIM.',
  },
  {
    heading: '12. Termination',
    body: 'We may suspend or terminate your account at any time for violation of these Terms. You may delete your account at any time from Settings → Data & Account → Delete Account. Upon termination, your right to use the App ceases immediately.',
  },
  {
    heading: '13. Changes to Terms',
    body: 'We may update these Terms from time to time. We will notify you of material changes via the App or by email. Continued use of the App after the effective date of updated Terms constitutes your acceptance of the changes.',
  },
  {
    heading: '14. Governing Law',
    body: 'These Terms are governed by the laws of New South Wales, Australia. Any disputes shall be resolved in the courts of New South Wales, Australia, unless otherwise required by applicable consumer protection legislation.',
  },
  {
    heading: '15. Contact',
    body: 'If you have questions about these Terms, please contact us via Help & Support in the App, or write to: Verified TCG Pty Ltd, PO Box [TBD], Sydney NSW 2000, Australia.',
  },
];

export default function TermsScreen() {
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
        <Text style={styles.title}>Terms of Service</Text>
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
        These Terms of Service govern your use of the Verified TCG mobile application and related services. Please read them carefully before using the App.
      </Text>

      {SECTIONS.map(section => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.sectionHeading}>{section.heading}</Text>
          <Text style={styles.sectionBody}>{section.body}</Text>
        </View>
      ))}

      <View style={styles.footer}>
        <Pressable onPress={() => router.push('/privacy-policy' as any)}>
          <Text style={[styles.footerLink, { color: C.primary }]}>Privacy Policy</Text>
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
