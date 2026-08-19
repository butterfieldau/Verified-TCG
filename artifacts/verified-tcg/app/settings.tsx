import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { useApp } from '@/context/AppContext';
import { useSettings } from '@/context/SettingsContext';
import type { NotificationPrefs, PrivacyPrefs } from '@/services/settingsStore';
import { CURRENCY_CONFIGS } from '@/utils/currency';
import { fetchNotificationPreferences, setPushPreference } from '@/services/notifications';

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
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
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
        accessibilityLabel={label}
        accessibilityRole="switch"
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
    masterPushEnabled,
    notifications,
    privacy,
    setMasterPushEnabled,
    updateNotificationPref,
    updatePrivacyPref,
  } = useSettings();
  const [pushPrefSaving, setPushPrefSaving] = useState(false);
  const [pushPrefError, setPushPrefError] = useState<string | null>(null);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  useEffect(() => {
    if (!isAuthenticated) {
      setPushPrefError(null);
      return;
    }
    let active = true;
    setPushPrefError(null);
    fetchNotificationPreferences()
      .then(pref => {
        if (active && pref) setMasterPushEnabled(pref.pushEnabled);
      })
      .catch(() => {
        if (active) setPushPrefError('Could not load the saved push preference.');
      });
    return () => {
      active = false;
    };
  }, [isAuthenticated, setMasterPushEnabled]);

  /**
   * Toggle the master push preference. Persists to server immediately and
   * updates local state. Shows a visible Alert on failure so the collector
   * knows the toggle did not take effect.
   */
  const handleMasterPushToggle = async (value: boolean) => {
    if (pushPrefSaving) return;
    if (!isAuthenticated) {
      Alert.alert('Account required', 'Sign in to change your push notification preference.');
      return;
    }
    // Optimistic local update so the toggle responds instantly
    setPushPrefError(null);
    setMasterPushEnabled(value);
    setPushPrefSaving(true);
    try {
      await setPushPreference(value);
    } catch (err) {
      // Revert optimistic update and inform the collector
      setMasterPushEnabled(!value);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setPushPrefError('The saved push preference could not be updated.');
      Alert.alert(
        'Could not save preference',
        `The notification setting could not be saved to the server.\n\n${message}\n\nYour change has been reverted.`,
        [{ text: 'OK' }],
      );
    } finally {
      setPushPrefSaving(false);
    }
  };

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
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={2}
        >
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
          <Pressable
            onPress={() => router.push('/sign-in')}
            style={styles.accountSignIn}
            accessibilityRole="button"
            accessibilityLabel="Already have an account? Sign in"
          >
            <Text style={styles.accountSignInText}>Already have an account? Sign in</Text>
          </Pressable>
        </View>
      )}

      {/* Notifications */}
      <Text style={styles.sectionLabel}>Notifications</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <ToggleRow
          icon="bell"
          label="Enable Push Notifications"
          value={masterPushEnabled}
          onChange={handleMasterPushToggle}
        />
        {pushPrefError && (
          <Text style={styles.pushPreferenceError}>{pushPrefError}</Text>
        )}
        <ToggleRow
          icon="trending-up"
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
        />
        <SettingRow
          icon="user-x"
          label="Blocked Users"
          onPress={() => requireAccount('/blocked-users')}
          isLast
        />
      </View>

      {/* Security */}
      <Text style={styles.sectionLabel}>Security</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow
          icon="key"
          label="Change Password"
          onPress={() => requireAccount('/change-password')}
          isLast
        />
      </View>

      {/* Account */}
      <Text style={styles.sectionLabel}>Account</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="user" label="Edit Profile" onPress={() => requireAccount('/edit-profile')} />
        <SettingRow icon="credit-card" label="Payment Methods" onPress={() => requireAccount('/pro-subscription')} />
        <SettingRow icon="help-circle" label="Help & Support" onPress={() => router.push('/help-support' as any)} />
        <SettingRow
          icon="refresh-cw"
          label="Replay Feature Tour"
          onPress={() => {
            Alert.alert(
              'Restart Intro Tour',
              'This will restart the onboarding tour next time you open the app.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Restart Tour',
                  onPress: async () => {
                    await AsyncStorage.removeItem('hasOnboarded');
                    router.replace('/onboarding');
                  },
                },
              ],
            );
          }}
        />
        <SettingRow icon="info" label="About Verified TCG" onPress={() => router.push('/about' as any)} />
        <SettingRow icon="file-text" label="Terms of Service" onPress={() => router.push('/terms' as any)} />
        <SettingRow icon="shield" label="Privacy Policy" onPress={() => router.push('/privacy-policy' as any)} isLast />
      </View>

      {/* Data */}
      <Text style={styles.sectionLabel}>Data & Account</Text>
      <View style={[styles.card, { backgroundColor: C.card }]}>
        <SettingRow icon="list" label="Export Collection (CSV)" onPress={() => requireAccount('/export-collection')} />
        <SettingRow icon="download" label="Export Account Data" onPress={() => requireAccount('/export-account')} />
        <Pressable
          style={[styles.row]}
          onPress={() => {
            if (!isAuthenticated) { router.push('/create-account'); return; }
            router.push('/delete-account' as any);
          }}
          accessibilityRole="button"
          accessibilityLabel="Delete account"
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
  pushPreferenceError: {
    color: C.negative,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
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
