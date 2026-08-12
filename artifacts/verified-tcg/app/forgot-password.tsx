import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import colors from '@/constants/colors';

const C = colors.dark;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setError('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);
    setSent(true);
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Feather name="arrow-left" size={22} color={C.foreground} />
      </Pressable>

      <View style={styles.content}>
        {sent ? (
          <>
            <View style={[styles.successIcon, { backgroundColor: `${C.positive}22` }]}>
              <Feather name="check-circle" size={40} color={C.positive} />
            </View>
            <Text style={styles.heading}>Check your email</Text>
            <Text style={styles.sub}>
              We sent a reset link to{'\n'}
              <Text style={styles.email}>{email}</Text>
            </Text>
            <Button fullWidth size="lg" onPress={() => router.push('/sign-in')} style={styles.mt24}>
              Back to Sign In
            </Button>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: `${C.primary}22` }]}>
              <Feather name="key" size={32} color={C.primary} />
            </View>
            <Text style={styles.heading}>Forgot password?</Text>
            <Text style={styles.sub}>
              Enter your email and we'll send you a reset link.
            </Text>
            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon="mail"
              error={error}
              style={styles.input}
            />
            <Button fullWidth size="lg" onPress={handleSubmit} loading={loading} style={styles.mt24}>
              Send Reset Link
            </Button>
            <Pressable onPress={() => router.back()} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  back: { padding: 8, marginLeft: 16, alignSelf: 'flex-start' },
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 24 },
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
  email: {
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  input: { marginBottom: 0 },
  mt24: { marginTop: 24 },
  cancelBtn: { alignItems: 'center', marginTop: 16 },
  cancelText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});
