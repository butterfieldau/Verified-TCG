import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useSettings } from '@/context/SettingsContext';
import { CURRENCY_OPTIONS } from '@/utils/currency';

const C = colors.dark;

export default function CurrencySelectScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { currency, updateCurrency } = useSettings();

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
        <Text style={styles.title}>Currency</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.description}>
        Prices throughout the app will be displayed in your selected currency using approximate exchange rates.
      </Text>

      <View style={[styles.card, { backgroundColor: C.card }]}>
        {CURRENCY_OPTIONS.map((opt, idx) => {
          const isSelected = currency === opt.code;
          return (
            <Pressable
              key={opt.code}
              onPress={() => { updateCurrency(opt.code); router.back(); }}
              style={({ pressed }) => [
                styles.row,
                idx < CURRENCY_OPTIONS.length - 1 && styles.rowBorder,
                { backgroundColor: pressed ? C.muted : 'transparent' },
              ]}
            >
              <Text style={styles.flag}>{opt.flag}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, isSelected && { color: C.primary }]}>
                  {opt.code}
                </Text>
                <Text style={styles.rowDesc}>{opt.label}</Text>
              </View>
              {isSelected && <Feather name="check" size={18} color={C.primary} />}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.note}>
        Exchange rates are approximate and for display purposes only. Actual transaction prices may vary.
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
  card: { borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  flag: { fontSize: 26 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 2 },
  rowDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  note: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
});
