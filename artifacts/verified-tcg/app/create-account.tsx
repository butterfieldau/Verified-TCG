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
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/Logo';
import colors from '@/constants/colors';

const C = colors.dark;

export default function CreateAccountScreen() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleCreate = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    router.push('/onboarding');
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Feather name="arrow-left" size={22} color={C.foreground} />
      </Pressable>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: botPad + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Logo variant="white" width={130} height={58} style={styles.logo} />

        <Text style={styles.heading}>Create Account</Text>
        <Text style={styles.sub}>Join the collector community</Text>

        <View style={styles.form}>
          <Input
            label="Display Name"
            placeholder="How collectors know you"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            leftIcon="user"
          />
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
            placeholder="8+ characters"
            value={password}
            onChangeText={setPassword}
            isPassword
            leftIcon="lock"
            hint="Use at least 8 characters."
          />

          {error ? (
            <Text style={[styles.errorText, { color: C.destructive }]}>{error}</Text>
          ) : null}

          <Button fullWidth size="lg" onPress={handleCreate} loading={loading}>
            Create Account
          </Button>
        </View>

        <Text style={styles.legal}>
          By creating an account you agree to our{' '}
          <Text style={styles.legalLink}>Terms of Service</Text> and{' '}
          <Text style={styles.legalLink}>Privacy Policy</Text>.
        </Text>

        <Pressable onPress={() => router.push('/sign-in')} style={styles.signInRow}>
          <Text style={styles.signInText}>
            Already have an account?{' '}
            <Text style={styles.signInLink}>Sign in</Text>
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
  legal: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 24,
    marginBottom: 16,
  },
  legalLink: { color: C.foreground, fontFamily: 'Inter_500Medium' },
  signInRow: { alignItems: 'center' },
  signInText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  signInLink: { fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
