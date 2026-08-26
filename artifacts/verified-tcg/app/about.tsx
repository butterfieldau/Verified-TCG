import React from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import colors from '@/constants/colors';

const C = colors.dark;

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
const BUILD_DATE = '2026.08';

export default function AboutScreen() {
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
        <Text style={styles.title}>About</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Logo / Brand block */}
      <View style={styles.brandBlock}>
        <View style={styles.logoBox}>
          <Feather name="shield" size={40} color={C.primary} />
        </View>
        <Text style={styles.appName}>Verified TCG</Text>
        <Text style={styles.tagline}>The collector's platform for the modern era</Text>
        <View style={styles.versionRow}>
          <View style={[styles.versionBadge, { backgroundColor: C.card }]}>
            <Text style={styles.versionText}>Version {APP_VERSION}</Text>
          </View>
          <View style={[styles.versionBadge, { backgroundColor: C.card }]}>
            <Text style={styles.versionText}>Build {BUILD_DATE}</Text>
          </View>
        </View>
      </View>

      {/* About copy */}
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <Text style={styles.cardText}>
          Verified TCG is a platform built for serious trading card collectors. We bring together
          portfolio tracking, card authentication, real-time market pricing, and peer-to-peer
          trading tools into one premium app designed for collectors who care about their collections.
        </Text>
        <Text style={[styles.cardText, { marginTop: 12 }]}>
          Whether you're tracking a single binder or a high-value graded collection, Verified TCG
          gives you the tools to know exactly what your cards are worth, keep them authenticated,
          and connect with other collectors for trades.
        </Text>
      </View>

      {/* Links */}
      <Text style={styles.sectionLabel}>Links</Text>
      <View style={[styles.linksCard, { backgroundColor: C.card }]}>
        <Pressable
          onPress={() => Linking.openURL('https://verifiedtcg.co')}
          style={({ pressed }) => [styles.linkRow, styles.linkBorder, { backgroundColor: pressed ? C.muted : 'transparent' }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="globe" size={16} color={C.foreground} />
          </View>
          <Text style={styles.linkLabel}>Website</Text>
          <Feather name="external-link" size={14} color={C.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/terms' as any)}
          style={({ pressed }) => [styles.linkRow, styles.linkBorder, { backgroundColor: pressed ? C.muted : 'transparent' }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="file-text" size={16} color={C.foreground} />
          </View>
          <Text style={styles.linkLabel}>Terms of Service</Text>
          <Feather name="chevron-right" size={14} color={C.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/privacy-policy' as any)}
          style={({ pressed }) => [styles.linkRow, { backgroundColor: pressed ? C.muted : 'transparent' }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="shield" size={16} color={C.foreground} />
          </View>
          <Text style={styles.linkLabel}>Privacy Policy</Text>
          <Feather name="chevron-right" size={14} color={C.mutedForeground} />
        </Pressable>
      </View>

      {/* Support */}
      <Text style={styles.sectionLabel}>Support</Text>
      <View style={[styles.linksCard, { backgroundColor: C.card }]}>
        <Pressable
          onPress={() => router.push('/help-support' as any)}
          style={({ pressed }) => [styles.linkRow, styles.linkBorder, { backgroundColor: pressed ? C.muted : 'transparent' }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="help-circle" size={16} color={C.foreground} />
          </View>
          <Text style={styles.linkLabel}>Help & FAQ</Text>
          <Feather name="chevron-right" size={14} color={C.mutedForeground} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/contact-support' as any)}
          style={({ pressed }) => [styles.linkRow, { backgroundColor: pressed ? C.muted : 'transparent' }]}
        >
          <View style={styles.linkIcon}>
            <Feather name="message-circle" size={16} color={C.foreground} />
          </View>
          <Text style={styles.linkLabel}>Contact Support</Text>
          <Feather name="chevron-right" size={14} color={C.mutedForeground} />
        </Pressable>
      </View>

      {/* Attribution */}
      <Text style={styles.attribution}>
        Card names, artwork, and trademarks belong to their respective owners. Verified TCG is an independent platform not affiliated with or endorsed by Nintendo, Wizards of the Coast, Konami, or other trading card game publishers.
      </Text>

      <Text style={styles.copyright}>
        © 2026 Verified TCG Pty Ltd · All rights reserved
      </Text>
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
    marginBottom: 24,
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
  brandBlock: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 8,
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: `${C.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  appName: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.5 },
  tagline: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  versionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  versionBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  versionText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  card: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  cardText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 21,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  linksCard: { borderRadius: 14, overflow: 'hidden', marginBottom: 24 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  linkBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  linkIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground },
  attribution: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 12,
  },
  copyright: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
  },
});
