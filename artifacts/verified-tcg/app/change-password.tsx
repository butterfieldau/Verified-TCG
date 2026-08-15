import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import colors from '@/constants/colors';
import { changePassword } from '@/services/auth';

const C = colors.dark;

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('All fields are required.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      // Navigate back to Settings after a brief moment to show the success state
      setTimeout(() => {
        router.replace('/settings' as any);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content}>
        {success ? (
          <View style={styles.successBox}>
            <View style={styles.successIcon}>
              <Feather name="check-circle" size={32} color={C.primary} />
            </View>
            <Text style={styles.successTitle}>Password Updated</Text>
            <Text style={styles.successBody}>
              Your password has been changed. You'll be redirected to Settings.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.infoBox, { backgroundColor: `${C.primary}10`, borderColor: `${C.primary}30` }]}>
              <Feather name="shield" size={15} color={C.primary} />
              <Text style={styles.infoText}>
                For security, all other devices will be signed out after your password is changed.
              </Text>
            </View>

            <View style={styles.form}>
              <Input
                label="Current Password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                leftIcon="lock"
                autoCapitalize="none"
                autoComplete="current-password"
              />
              <Input
                label="New Password"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                leftIcon="key"
                autoCapitalize="none"
                autoComplete="new-password"
              />
              <Input
                label="Confirm New Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                leftIcon="key"
                autoCapitalize="none"
                autoComplete="new-password"
              />
              {error ? (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={14} color={C.destructive} />
                  <Text style={styles.error}>{error}</Text>
                </View>
              ) : null}
              <Button fullWidth size="lg" onPress={handleSave} loading={saving}>
                Update Password
              </Button>
            </View>
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  content: { padding: 24, paddingBottom: 48, gap: 20 },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 18,
  },
  form: { gap: 16 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.destructive, flex: 1 },
  successBox: { alignItems: 'center', paddingVertical: 48, gap: 16 },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${C.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  successBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
});
