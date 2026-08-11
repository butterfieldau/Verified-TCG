import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

const C = colors.dark;

function SettingRow({
  icon,
  label,
  value,
  onPress,
  isLast = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowBorder,
        { backgroundColor: pressed ? C.muted : 'transparent' },
      ]}
    >
      <View style={styles.rowIcon}>
        <Feather name={icon as any} size={16} color={C.foreground} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {value && <Text style={styles.rowValue}>{value}</Text>}
        <Feather name="chevron-right" size={16} color={C.mutedForeground} />
      </View>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onChange,
  isLast = false,
}: {
  icon: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={styles.rowIcon}>
        <Feather name={icon as any} size={16} color={C.foreground} />
      </View>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.border, true: `${C.primary}88` }}
        thumbColor={value ? C.primary : C.mutedForeground}
        ios_backgroundColor={C.border}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [priceAlerts, setPriceAlerts] = useState(true);
  const [verificationAlerts, setVerificationAlerts] = useState(true);
  const [marketUpdates, setMarketUpdates] = useState(false);
  const [publicCollection, setPublicCollection] = useState(true);
  const [showPortfolioValue, setShowPortfolioValue] = useState(false);
  const [faceIdEnabled, setFaceIdEnabled] = useState(true);

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
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* General */}
      <Text style={styles.sectionLabel}>General</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="dollar-sign" label="Currency" value="AUD" onPress={() => {}} />
        <SettingRow icon="globe" label="Language" value="English" onPress={() => {}} />
        <SettingRow icon="moon" label="Appearance" value="Dark" onPress={() => {}} isLast />
      </View>

      {/* Notifications */}
      <Text style={styles.sectionLabel}>Notifications</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <ToggleRow icon="bell" label="Price Alerts" value={priceAlerts} onChange={setPriceAlerts} />
        <ToggleRow
          icon="shield"
          label="Verification Updates"
          value={verificationAlerts}
          onChange={setVerificationAlerts}
        />
        <ToggleRow
          icon="trending-up"
          label="Market Updates"
          value={marketUpdates}
          onChange={setMarketUpdates}
          isLast
        />
      </View>

      {/* Privacy */}
      <Text style={styles.sectionLabel}>Privacy</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <ToggleRow
          icon="users"
          label="Public Collection"
          value={publicCollection}
          onChange={setPublicCollection}
        />
        <ToggleRow
          icon="eye-off"
          label="Show Portfolio Value Publicly"
          value={showPortfolioValue}
          onChange={setShowPortfolioValue}
          isLast
        />
      </View>

      {/* Security */}
      <Text style={styles.sectionLabel}>Security</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <ToggleRow
          icon="lock"
          label="Face ID / Touch ID"
          value={faceIdEnabled}
          onChange={setFaceIdEnabled}
        />
        <SettingRow icon="key" label="Change Password" onPress={() => {}} isLast />
      </View>

      {/* Account */}
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="user" label="Edit Profile" onPress={() => {}} />
        <SettingRow icon="credit-card" label="Payment Methods" onPress={() => {}} />
        <SettingRow icon="help-circle" label="Help & Support" onPress={() => {}} />
        <SettingRow icon="file-text" label="Terms of Service" onPress={() => {}} />
        <SettingRow icon="shield" label="Privacy Policy" onPress={() => {}} isLast />
      </View>

      {/* Data */}
      <Text style={styles.sectionLabel}>Data & Account</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="download" label="Export My Data" onPress={() => {}} />
        <Pressable style={[styles.row]}>
          <View style={[styles.rowIcon, { backgroundColor: `${C.destructive}22` }]}>
            <Feather name="trash-2" size={16} color={C.destructive} />
          </View>
          <Text style={[styles.rowLabel, { color: C.destructive, flex: 1 }]}>Delete Account</Text>
        </Pressable>
      </View>

      <Text style={styles.version}>Verified TCG v1.0.0 · Build 2026.08</Text>
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
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 22,
  },
  card: { borderRadius: 16, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  rowValue: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  version: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    marginTop: 32,
  },
});
