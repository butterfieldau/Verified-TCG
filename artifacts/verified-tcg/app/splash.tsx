import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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

const C = colors.dark;

export default function SplashScreen() {
  const logoOpacity = useSharedValue(0);
  const logoScale  = useSharedValue(0.82);
  const tagOpacity = useSharedValue(0);
  const dotOpacity = useSharedValue(0);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 700 });
    logoScale.value   = withTiming(1, { duration: 700 });
    tagOpacity.value  = withDelay(550, withTiming(1, { duration: 500 }));
    dotOpacity.value  = withDelay(900, withTiming(1, { duration: 400 }));

    const timer = setTimeout(async () => {
      try {
        const session = await restoreSession();
        const onboarded = await AsyncStorage.getItem('hasOnboarded');
        if (session || onboarded === 'true') {
          router.replace('/(tabs)');
        } else {
          router.replace('/welcome');
        }
      } catch {
        router.replace('/welcome');
      }
    }, 2400);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
});
