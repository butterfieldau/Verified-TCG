import React, { useState } from 'react';
import {
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/Logo';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import type { OAuthProvider } from '@/services/auth';

const C = colors.dark;

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { signIn, signInWithProvider } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      await AsyncStorage.setItem('hasOnboarded', 'true');
      router.replace((next as string | undefined) ?? '/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = async (provider: OAuthProvider) => {
    setError('');
    setLoading(true);
    try {
      const signedIn = await signInWithProvider(provider);
      if (!signedIn) return;
      await AsyncStorage.setItem('hasOnboarded', 'true');
      router.replace((next as string | undefined) ?? '/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Back button */}
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Feather name="arrow-left" size={22} color={C.foreground} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Logo variant="white" width={130} height={58} style={styles.logo} />

        <Text style={styles.heading}>Sign In</Text>
        <Text style={styles.sub}>Welcome back to Verified TCG</Text>

        <View style={styles.form}>
          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            leftIcon="mail"
          />
          <Input
            label="Password"
            placeholder="Your password"
            value={password}
            onChangeText={setPassword}
            isPassword
            leftIcon="lock"
          />

          {error ? (
            <Text style={[styles.errorText, { color: C.destructive }]}>{error}</Text>
          ) : null}

          <Pressable
            onPress={() => router.push('/forgot-password')}
            style={styles.forgotRow}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          <Button fullWidth size="lg" onPress={handleSignIn} loading={loading}>
            Sign In
          </Button>
        </View>

        <View style={styles.divider}>
          <View style={[styles.divLine, { backgroundColor: C.border }]} />
          <Text style={styles.divText}>or continue with</Text>
          <View style={[styles.divLine, { backgroundColor: C.border }]} />
        </View>

        <View style={styles.socialRow}>
          {[
            { icon: 'globe', label: 'Google', provider: 'google' as const },
            { icon: 'smartphone', label: 'Apple', provider: 'apple' as const },
          ].map(s => (
            <Pressable
              key={s.label}
              onPress={() => handleOAuthSignIn(s.provider)}
              style={({ pressed }) => [styles.socialBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name={s.icon as any} size={18} color={C.foreground} />
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => router.push('/create-account')} style={styles.createRow}>
          <Text style={styles.createText}>
            Don't have an account?{' '}
            <Text style={styles.createLink}>Create one</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  back: { padding: 8, marginLeft: 16, alignSelf: 'flex-start' },
  content: { paddingHorizontal: 28 },
  logo: { marginBottom: 32 },
  heading: {
    fontSize: 36,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginBottom: 32,
  },
  form: { gap: 16 },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  forgotRow: { alignSelf: 'flex-end', marginTop: -8 },
  forgotText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.primary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 28,
    gap: 12,
  },
  divLine: { flex: 1, height: 1 },
  divText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 32,
  },
  socialBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createRow: { alignItems: 'center' },
  createText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  createLink: { fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
