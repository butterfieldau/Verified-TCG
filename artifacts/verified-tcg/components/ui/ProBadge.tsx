/**
 * ProBadge — a small "PRO" pill shown next to usernames for Pro subscribers.
 *
 * IMPORTANT: This badge is distinct from verification badges (Verified Account,
 * Verified Seller). Those use the blue/green palette with a shield/check icon
 * and relate to identity trust. This badge signals subscription tier only and
 * uses the Verified-red outline style so it feels premium but never conflates
 * with identity verification.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import colors from '@/constants/colors';

const C = colors.dark;

interface ProBadgeProps {
  /** Optional extra style for the pill wrapper. */
  style?: object;
}

export function ProBadge({ style }: ProBadgeProps) {
  return (
    <View style={[styles.pill, style]}>
      <Text style={styles.label}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderColor: C.primary,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 0.8,
  },
});
