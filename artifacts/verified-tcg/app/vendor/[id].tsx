import React from 'react';
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

/**
 * Vendor profiles are intentionally unavailable on the consumer surface until
 * an event-scoped vendor endpoint exists. Admin approval/link records alone do
 * not prove booth, inventory, pricing, ratings, or external verification data.
 */
export default function VendorProfileScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Vendor Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.unavailableCard}>
        <View style={styles.iconWrap}>
          <Feather name="shopping-bag" size={28} color={C.mutedForeground} />
        </View>
        <Text style={styles.title}>Vendor Details Unavailable</Text>
        <Text style={styles.description}>
          Verified TCG does not currently receive event vendor profiles from a
          consumer data source.
        </Text>
        <View style={styles.disclosure}>
          <Feather name="info" size={15} color={C.primary} />
          <Text style={styles.disclosureText}>
            Booth details, inventory, wanted cards, prices, ratings, and
            verification results are not shown until a real event vendor
            integration is available.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.returnBtn, pressed && styles.pressed]}
        >
          <Text style={styles.returnBtnText}>Back to Event Mode</Text>
        </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  unavailableCard: {
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 22,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
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
  returnBtn: {
    width: '100%',
    marginTop: 4,
    minHeight: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primary,
  },
  returnBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: C.primaryForeground,
  },
  pressed: {
    opacity: 0.72,
  },
});