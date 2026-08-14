import React from 'react';
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
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import type { NotificationPrefs, PrivacyPrefs } from '@/services/settingsStore';
import { CURRENCY_CONFIGS } from '@/utils/currency';

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

const APPEARANCE_LABELS: Record<string, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useApp();
  const {
    appearance,
    currency,
    notifications,
    privacy,
    updateNotificationPref,
    updatePrivacyPref,
  } = useSettings();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const requireAccount = (destination?: string) => {
    if (isAuthenticated && destination) router.push(destination as any);
    else if (!isAuthenticated) router.push('/create-account');
  };

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
        <SettingRow
          icon="dollar-sign"
          label="Currency"
          value={currency}
          onPress={() => router.push('/currency-select' as any)}
        />
        <SettingRow
          icon="globe"
          label="Language"
          value="English"
          onPress={() => {}}
        />
        <SettingRow
          icon="moon"
          label="Appearance"
          value={APPEARANCE_LABELS[appearance] ?? 'Dark'}
          onPress={() => router.push('/appearance' as any)}
          isLast
        />
      </View>

      {!isAuthenticated && (
        <View style={styles.accountPrompt}>
          <View style={styles.accountPromptIcon}>
            <Feather name="user-plus" size={18} color={C.primary} />
          </View>
          <Text style={styles.accountPromptTitle}>Create your free account</Text>
          <Text style={styles.accountPromptBody}>
            Keep exploring as a guest, or create an account to edit your profile, sync your collection, and unlock account features.
          </Text>
          <Button fullWidth onPress={() => router.push('/create-account')}>Create an Account</Button>
          <Pressable onPress={() => router.push('/sign-in')} style={styles.accountSignIn}>
            <Text style={styles.accountSignInText}>Already have an account? Sign in</Text>
          </Pressable>
        </View>
      )}

      {/* Notifications */}
      <Text style={styles.sectionLabel}>Notifications</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <ToggleRow
          icon="bell"
          label="Price Alerts"
          value={notifications.priceAlerts}
          onChange={v => updateNotificationPref('priceAlerts', v)}
        />
        <ToggleRow
          icon="git-branch"
          label="Trade Matches"
          value={notifications.tradeMatches}
          onChange={v => updateNotificationPref('tradeMatches', v)}
        />
        <ToggleRow
          icon="zap"
          label="Events"
          value={notifications.events}
          onChange={v => updateNotificationPref('events', v)}
        />
        <ToggleRow
          icon="users"
          label="Community"
          value={notifications.community}
          onChange={v => updateNotificationPref('community', v)}
        />
        <ToggleRow
          icon="gift"
          label="Giveaways & Drops"
          value={notifications.giveaways}
          onChange={v => updateNotificationPref('giveaways', v)}
        />
        <ToggleRow
          icon="trending-up"
          label="Marketing Updates"
          value={notifications.marketing}
          onChange={v => updateNotificationPref('marketing', v)}
          isLast
        />
      </View>

      {/* Privacy */}
      <Text style={styles.sectionLabel}>Privacy</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <ToggleRow
          icon="user"
          label="Public Profile"
          value={privacy.publicProfile}
          onChange={v => updatePrivacyPref('publicProfile', v)}
        />
        <ToggleRow
          icon="layers"
          label="Show My Collection"
          value={privacy.showCollection}
          onChange={v => updatePrivacyPref('showCollection', v)}
        />
        <ToggleRow
          icon="heart"
          label="Show My Wishlist"
          value={privacy.showWishlist}
          onChange={v => updatePrivacyPref('showWishlist', v)}
        />
        <ToggleRow
          icon="repeat"
          label="Show For-Trade Cards"
          value={privacy.showForTrade}
          onChange={v => updatePrivacyPref('showForTrade', v)}
        />
        <ToggleRow
          icon="tag"
          label="Show For-Sale Cards"
          value={privacy.showForSale}
          onChange={v => updatePrivacyPref('showForSale', v)}
          isLast
        />
      </View>

      {/* Security */}
      <Text style={styles.sectionLabel}>Security</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow
          icon="key"
          label="Change Password"
          onPress={() => requireAccount('/forgot-password')}
          isLast
        />
      </View>

      {/* Account */}
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="user" label="Edit Profile" onPress={() => requireAccount('/edit-profile')} />
        <SettingRow icon="credit-card" label="Payment Methods" onPress={() => requireAccount('/pro-subscription')} />
        <SettingRow icon="help-circle" label="Help & Support" onPress={() => router.push('/help-support' as any)} />
        <SettingRow icon="info" label="About Verified TCG" onPress={() => router.push('/about' as any)} />
        <SettingRow icon="file-text" label="Terms of Service" onPress={() => router.push('/terms' as any)} />
        <SettingRow icon="shield" label="Privacy Policy" onPress={() => router.push('/privacy-policy' as any)} isLast />
      </View>

      {/* Data */}
      <Text style={styles.sectionLabel}>Data & Account</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="download" label="Export My Data" onPress={() => requireAccount('/portfolio')} />
        <Pressable
          style={[styles.row]}
          onPress={() => {
            if (!isAuthenticated) { router.push('/create-account'); return; }
            router.push('/delete-account' as any);
          }}
        >
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
  accountPrompt: { marginTop: 22, padding: 18, borderRadius: 16, backgroundColor: `${C.primary}12`, borderWidth: 1, borderColor: `${C.primary}33` },
  accountPromptIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: `${C.primary}22`, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  accountPromptTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 6 },
  accountPromptBody: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 16 },
  accountSignIn: { alignItems: 'center', paddingTop: 16 },
  accountSignInText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
