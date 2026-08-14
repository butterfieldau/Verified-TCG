import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useSettings } from '@/context/SettingsContext';
import type { AppearanceMode } from '@/services/settingsStore';

const C = colors.dark;

const APPEARANCE_OPTIONS: { value: AppearanceMode; label: string; description: string; icon: string; available: boolean }[] = [
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme', icon: 'moon', available: true },
  { value: 'system', label: 'System Default', description: 'Light/system mode — coming in a future update', icon: 'smartphone', available: false },
  { value: 'light', label: 'Light', description: 'Light mode — coming in a future update', icon: 'sun', available: false },
];

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { appearance, updateAppearance } = useSettings();

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
        <Text style={styles.title}>Appearance</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.description}>
        Choose how Verified TCG looks. Your preference is saved and will apply when more themes become available.
      </Text>

      <View style={[styles.card, { backgroundColor: C.card }]}>
        {APPEARANCE_OPTIONS.map((option, idx) => {
          const isSelected = appearance === option.value;
          const isAvailable = option.available;
          return (
            <Pressable
              key={option.value}
              onPress={() => isAvailable && updateAppearance(option.value)}
              style={({ pressed }) => [
                styles.row,
                idx < APPEARANCE_OPTIONS.length - 1 && styles.rowBorder,
                { backgroundColor: pressed && isAvailable ? C.muted : 'transparent', opacity: isAvailable ? 1 : 0.45 },
              ]}
            >
              <View style={[styles.iconBox, isSelected && isAvailable && { backgroundColor: `${C.primary}22` }]}>
                <Feather
                  name={option.icon as any}
                  size={18}
                  color={isSelected && isAvailable ? C.primary : C.foreground}
                />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, isSelected && isAvailable && { color: C.primary }]}>
                  {option.label}
                  {!isAvailable && <Text style={styles.comingSoon}> · Coming soon</Text>}
                </Text>
                <Text style={styles.rowDesc}>{option.description}</Text>
              </View>
              {isSelected && isAvailable && (
                <Feather name="check" size={18} color={C.primary} />
              )}
            </Pressable>
          );
        })}
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
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  description: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 21,
    marginBottom: 20,
  },
  card: { borderRadius: 16, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground, marginBottom: 2 },
  rowDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 17 },
  comingSoon: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});
