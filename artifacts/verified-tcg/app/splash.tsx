import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logo } from '@/components/Logo';
import colors from '@/constants/colors';
import { restoreSession } from '@/services/auth';
import { resolveInitialRoute } from '@/services/initialNavigation';
import { recordStartupPhase } from '@/services/startupDiagnostics';

const C = colors.dark;

export default function SplashScreen() {
  const logoOpacity = useSharedValue(0);
  const logoScale  = useSharedValue(0.82);
  const tagOpacity = useSharedValue(0);
  const dotOpacity = useSharedValue(0);
  const [startupError, setStartupError] = React.useState<string | null>(null);

  const finishInitialNavigation = React.useCallback(async () => {
    setStartupError(null);
    recordStartupPhase('initial-navigation', 'started');
    try {
      const destination = await resolveInitialRoute(
        restoreSession,
        () => AsyncStorage.getItem('hasOnboarded'),
      );
      router.replace(destination);
      recordStartupPhase('initial-navigation', 'success');
    } catch (error) {
      recordStartupPhase('initial-navigation', 'failure', error, false);
      setStartupError(
        'Verified TCG could not finish checking your saved session. Try again, or continue to sign in.',
      );
    }
  }, []);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 700 });
    logoScale.value   = withTiming(1, { duration: 700 });
    tagOpacity.value  = withDelay(550, withTiming(1, { duration: 500 }));
    dotOpacity.value  = withDelay(900, withTiming(1, { duration: 400 }));

    const timer = setTimeout(() => {
      void finishInitialNavigation();
    }, 2400);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishInitialNavigation]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const tagStyle = useAnimatedStyle(() => ({ opacity: tagOpacity.value }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  return (
    <View style={styles.container}>
      {/* Radial red glow behind logo */}
      <View style={styles.glow} />

      <Animated.View style={[styles.logoWrap, logoStyle]}>
        <Logo variant="white" width={260} height={120} />
      </Animated.View>

      <Animated.Text style={[styles.tagline, tagStyle]}>
        COLLECT. VERIFY. TRADE.
      </Animated.Text>

      {/* Pulsing dots */}
      <Animated.View style={[styles.dots, dotStyle]}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[styles.dot, { backgroundColor: C.primary }]} />
        ))}
      </Animated.View>

      {startupError ? (
        <View accessibilityRole="alert" style={styles.errorPanel}>
          <Text style={styles.errorText}>{startupError}</Text>
          <View style={styles.errorActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void finishInitialNavigation()}
              style={styles.primaryAction}
            >
              <Text style={styles.primaryActionText}>Try again</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.replace('/welcome');
                recordStartupPhase('initial-navigation', 'success');
              }}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryActionText}>Continue to sign in</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'web' ? 67 : 0,
  },
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(255,30,45,0.12)',
    shadowColor: '#FF1E2D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 80,
  },
  logoWrap: {
    alignItems: 'center',
  },
  tagline: {
    marginTop: 24,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 5,
    color: C.mutedForeground,
    textTransform: 'uppercase',
  },
  dots: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 80 : 100,
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  errorPanel: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 116 : 136,
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 24,
    gap: 14,
  },
  errorText: {
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  primaryAction: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: colors.radius,
    backgroundColor: C.primary,
    paddingHorizontal: 18,
  },
  primaryActionText: {
    color: C.primaryForeground,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  secondaryAction: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: colors.radius,
    borderColor: C.border,
    borderWidth: 1,
    paddingHorizontal: 18,
  },
  secondaryActionText: {
    color: C.foreground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
