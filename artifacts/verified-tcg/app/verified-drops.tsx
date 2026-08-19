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
import colors from '@/constants/colors';

const C = colors.dark;

/**
 * Verified Drop records are managed by authorised staff, but the consumer app
 * does not yet have a published-drop feed or durable entry API. Until those
 * endpoints exist, this screen must not invent drops, countdowns, or entries.
 */
export default function VerifiedDropsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.backBtn}
        onPress={() => router.back()}
        hitSlop={12}
      >
        <Feather name="arrow-left" size={20} color={C.foreground} />
      </Pressable>

      <View style={styles.pageHeader}>
        <View style={styles.titleRow}>
          <Feather name="gift" size={22} color={C.primary} />
          <Text style={styles.pageTitle}>VERIFIED DROPS</Text>
        </View>
      </View>

      <View style={styles.unavailableCard}>
        <View style={styles.iconWrap}>
          <Feather name="gift" size={30} color={C.mutedForeground} />
        </View>
        <Text style={styles.title}>Drop Feed Unavailable</Text>
        <Text style={styles.description}>
          Verified TCG does not currently have a consumer data source for
          published drops or collector entries.
        </Text>
        <View style={styles.disclosure}>
          <Feather name="info" size={15} color={C.primary} />
          <Text style={styles.disclosureText}>
            Giveaway details, countdowns, eligibility, and entry actions are not
            shown until the mobile drop service is available.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  pageHeader: {
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pageTitle: {
    fontSize: 26,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: 1,
  },
  unavailableCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.muted,
    marginBottom: 2,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
  },
  disclosure: {
    width: '100%',
    marginTop: 4,
    padding: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: `${C.primary}14`,
  },
  disclosureText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
});