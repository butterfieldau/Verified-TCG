import React from 'react';
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
import { Logo } from '@/components/Logo';
import colors from '@/constants/colors';

const C = colors.dark;

function SocialButton({
  icon,
  label,
  dark = false,
  onPress,
}: {
  icon: string;
  label: string;
  dark?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialBtn,
        dark ? styles.socialDark : styles.socialLight,
        { opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Feather
        name={icon as any}
        size={18}
        color={dark ? '#FFFFFF' : '#111111'}
      />
      <Text style={[styles.socialLabel, { color: dark ? '#FFFFFF' : '#111111' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  const handleMockAuth = () => {
    router.push('/onboarding');
  };

  const handleSignIn = () => {
    router.push('/sign-in');
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Background decorations */}
      <View style={styles.decorRight} />
      <View style={styles.decorLeft} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: botPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <Logo variant="white" width={150} height={66} style={styles.logo} />

        {/* Hero copy */}
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>The definitive collection app</Text>
          <Text style={styles.headline}>
            YOUR{'\n'}
            <Text style={styles.headlineAccent}>COLLECTION.</Text>
            {'\n'}VERIFIED.
          </Text>
          <Text style={styles.sub}>
            Track every card. Know every value.{'\n'}
            Build a collection that speaks for itself.
          </Text>
        </View>

        {/* Social auth buttons */}
        <View style={styles.buttons}>
          <SocialButton
            icon="globe"
            label="Continue with Google"
            onPress={handleMockAuth}
          />
          <SocialButton
            icon="smartphone"
            label="Continue with Apple"
            dark
            onPress={handleMockAuth}
          />
          <SocialButton
            icon="twitter"
            label="Continue with X"
            dark
            onPress={handleMockAuth}
          />
        </View>

        {/* Sign in link */}
        <Pressable onPress={handleSignIn} style={styles.signinRow}>
          <Text style={styles.signinText}>
            Already have an account?{' '}
            <Text style={styles.signinLink}>Sign in </Text>
          </Text>
          <Feather name="arrow-right" size={13} color={C.foreground} />
        </Pressable>

        {/* Legal */}
        <Text style={styles.legal}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  decorRight: {
    position: 'absolute',
    top: 120,
    right: -80,
    width: 220,
    height: 320,
    borderRadius: 20,
    backgroundColor: 'rgba(255,30,45,0.12)',
    transform: [{ rotate: '12deg' }],
  },
  decorLeft: {
    position: 'absolute',
    top: 350,
    left: -100,
    width: 200,
    height: 290,
    borderRadius: 20,
    backgroundColor: 'rgba(99,102,241,0.10)',
    transform: [{ rotate: '-12deg' }],
  },
  content: {
    paddingHorizontal: 28,
    paddingBottom: 40,
    minHeight: '100%',
  },
  logo: { marginTop: 8 },
  hero: { marginTop: 80, marginBottom: 48 },
  eyebrow: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 3.5,
    color: C.primary,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  headline: {
    fontSize: 52,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    lineHeight: 50,
    letterSpacing: -0.5,
  },
  headlineAccent: {
    color: C.primary,
  },
  sub: {
    marginTop: 20,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 24,
    maxWidth: 300,
  },
  buttons: {
    gap: 10,
    marginBottom: 28,
  },
  socialBtn: {
    height: 50,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  socialLight: { backgroundColor: '#F0F0F0' },
  socialDark: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  socialLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  signinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  signinText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  signinLink: {
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  legal: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 16,
    opacity: 0.7,
  },
});
