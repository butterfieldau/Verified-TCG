import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const C = colors.dark;

export default function SplashScreen() {
  const insets = useSafeAreaInsets();
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
      <View pointerEvents="none" style={styles.orbitField}>
        <View style={[styles.orbit, styles.orbitOuter]} />
        <View style={[styles.orbit, styles.orbitMiddle]} />
        <View style={styles.orbitGlow} />
        <View style={styles.cornerGlowLeft} />
        <View style={styles.cornerGlowRight} />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 18 }]}>
        <View style={styles.topBrand}>
          <View style={styles.statusDot} />
          <Text style={styles.topBrandText}>Verified TCG</Text>
        </View>
        <Text style={styles.established}>EST. 2024</Text>
      </View>

      <View style={styles.centerContent}>
        <Animated.View style={[styles.logoOrb, logoStyle]}>
          <View style={styles.dashedOrbit} />
          <Logo variant="white" width={210} height={86} />
        </Animated.View>

        <Animated.Text style={[styles.tagline, tagStyle]}>
          THE COLLECTOR'S STANDARD
        </Animated.Text>
        <Animated.Text style={[styles.supportingCopy, tagStyle]}>
          Know what you own. Know what it's worth.
        </Animated.Text>
      </View>

      <Animated.View style={[styles.loading, { paddingBottom: insets.bottom + 28 }, dotStyle]}>
        <View style={styles.dots} accessibilityLabel="Loading">
          {[0, 1, 2].map(i => (
            <View key={i} style={[styles.dot, { backgroundColor: C.primary }, i === 1 && styles.dotActive]} />
          ))}
        </View>
        <Text style={styles.loadingCopy}>PREPARING YOUR COLLECTION</Text>
      </Animated.View>

      {startupError ? (
        <View accessibilityRole="alert" style={[styles.errorPanel, { bottom: insets.bottom + 82 }]}>
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
  },
  orbitField: {
    position: 'absolute',
    top: '17%',
    width: 440,
    height: 440,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: {
    position: 'absolute',
    borderRadius: 300,
    borderWidth: 1,
    borderColor: 'rgba(239,51,64,0.13)',
  },
  orbitOuter: { width: 440, height: 440 },
  orbitMiddle: { width: 344, height: 344, borderColor: 'rgba(239,51,64,0.18)' },
  orbitGlow: {
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(239,51,64,0.09)',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 70,
  },
  cornerGlowLeft: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    left: -230,
    top: -70,
    backgroundColor: 'rgba(127,29,45,0.16)',
  },
  cornerGlowRight: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    right: -250,
    bottom: -90,
    backgroundColor: 'rgba(239,51,64,0.08)',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  topBrandText: {
    color: C.mutedForeground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.1,
    textTransform: 'uppercase',
  },
  established: {
    color: C.mutedForeground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.8,
  },
  centerContent: {
    alignItems: 'center',
    transform: [{ translateY: -12 }],
  },
  logoOrb: {
    width: 224,
    height: 224,
    borderRadius: 112,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23,19,21,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(239,51,64,0.22)',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.26,
    shadowRadius: 40,
  },
  dashedOrbit: {
    position: 'absolute',
    inset: 16,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(239,51,64,0.28)',
    borderStyle: 'dashed',
  },
  logoWrap: {
    alignItems: 'center',
  },
  tagline: {
    marginTop: 32,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 3.8,
    color: C.foreground,
    textTransform: 'uppercase',
  },
  supportingCopy: {
    marginTop: 12,
    maxWidth: 255,
    textAlign: 'center',
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
  },
  loading: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
    gap: 14,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.35,
  },
  dotActive: {
    opacity: 1,
  },
  loadingCopy: {
    color: 'rgba(114,106,108,1)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    letterSpacing: 2.4,
  },
  errorPanel: {
    position: 'absolute',
    bottom: 136,
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
