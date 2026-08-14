import React, { useState, useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import colors from '@/constants/colors';
import { resetPassword } from '@/services/auth';

const C = colors.dark;

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new reset link.');
    }
  }, [token]);

  const handleSubmit = async () => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new reset link.');
      return;
    }
    if (!password) {
      setError('Please enter a new password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Pressable
        onPress={() => router.replace('/sign-in')}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="arrow-left" size={22} color={C.foreground} />
      </Pressable>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={topPad}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {done ? (
          <>
            <View style={[styles.successIcon, { backgroundColor: `${C.positive}22` }]}>
              <Feather name="check-circle" size={40} color={C.positive} />
            </View>
            <Text style={styles.heading}>Password updated</Text>
            <Text style={styles.sub}>
              Your password has been reset successfully. You can now sign in with your new password.
            </Text>
            <Button fullWidth size="lg" onPress={() => router.replace('/sign-in')} style={styles.mt24}>
              Sign In
            </Button>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: `${C.primary}22` }]}>
              <Feather name="lock" size={32} color={C.primary} />
            </View>
            <Text style={styles.heading}>New password</Text>
            <Text style={styles.sub}>
              Choose a strong password for your account.
            </Text>
            <Input
              label="New password"
              placeholder="At least 8 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              leftIcon="lock"
              error={error}
              style={styles.input}
            />
            <Input
              label="Confirm password"
              placeholder="Repeat your new password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              leftIcon="lock"
              style={styles.inputConfirm}
            />
            <Button
              fullWidth
              size="lg"
              onPress={handleSubmit}
              loading={loading}
              style={styles.mt24}
              disabled={!token}
            >
              Reset Password
            </Button>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              style={styles.cancelBtn}
              accessibilityRole="link"
              accessibilityLabel="Back to sign in"
            >
              <Text style={styles.cancelText}>Back to Sign In</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  back: { padding: 8, marginLeft: 16, alignSelf: 'flex-start' },
  content: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 40 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    alignSelf: 'center',
  },
  heading: {
    fontSize: 36,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  sub: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 24,
    marginBottom: 32,
  },
  input: { marginBottom: 16 },
  inputConfirm: { marginBottom: 0 },
  mt24: { marginTop: 24 },
  cancelBtn: { alignItems: 'center', marginTop: 16 },
  cancelText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});
