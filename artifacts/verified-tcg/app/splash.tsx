import React, { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logo } from '@/components/Logo';
import { restoreSession } from '@/services/auth';

// ── Graded slab data ─────────────────────────────────────────────────────────
const SLABS = [
  {
    id: 'charizard',
    grader: 'BGS' as const,
    grade: '9.5',
    label: 'GEM MINT',
    name: 'Charizard Holo',
    set: '1999 Pokémon Base Set',
    cardNo: '#4/102',
    certNo: '0010283477',
    subGrades: { centering: '9', corners: '9.5', edges: '10', surface: '9.5' },
    imgUrl: 'https://images.pokemontcg.io/base1/4.png',
    artColors: ['#8B2500', '#D44500', '#FF7A3D'] as const,
    rotation: '-15deg',
    offsetX: -130,
    offsetY: 20,
    delay: 0,
    zIndex: 1,
    headerBg: '#001F5C',
    gradeBg: ['#C8960C', '#F5D13A', '#C8960C'] as const,
    gradeTextColor: '#001F5C',
  },
  {
    id: 'black-lotus',
    grader: 'PSA' as const,
    grade: '10',
    label: 'GEM MT',
    name: 'Black Lotus',
    set: 'Magic: The Gathering Alpha',
    cardNo: '#232/295',
    certNo: '70491827',
    subGrades: null,
    imgUrl: 'https://cards.scryfall.io/large/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg',
    artColors: ['#0F0F0F', '#1C1C1C', '#2D2D2D'] as const,
    rotation: '3deg',
    offsetX: 0,
    offsetY: -8,
    delay: 200,
    zIndex: 3,
    headerBg: '#CC0000',
    gradeBg: ['#AA0000', '#FF2222'] as const,
    gradeTextColor: '#FFFFFF',
  },
  {
    id: 'blue-eyes',
    grader: 'CGC' as const,
    grade: '10',
    label: 'PRISTINE',
    name: 'Blue-Eyes White Dragon',
    set: 'Legend of Blue Eyes 1st Ed.',
    cardNo: 'LOB-001',
    certNo: 'CGC-8843271',
    subGrades: null,
    imgUrl: 'https://images.ygoprodeck.com/images/cards/89631139.jpg',
    artColors: ['#0D1B6E', '#2D3FA0', '#6579E0'] as const,
    rotation: '17deg',
    offsetX: 130,
    offsetY: 14,
    delay: 100,
    zIndex: 1,
    headerBg: '#2D1B4E',
    gradeBg: ['#5B21B6', '#8B5CF6'] as const,
    gradeTextColor: '#FFFFFF',
  },
];

// ── Graded Slab (React Native) ───────────────────────────────────────────────
function GradedSlab({ slab, delay }: { slab: typeof SLABS[0]; delay: number }) {
  const translateY = useSharedValue(400);
  const opacity    = useSharedValue(0);
  const floatY     = useSharedValue(0);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    translateY.value = withDelay(delay, withTiming(0, { duration: 850, easing: Easing.out(Easing.back(1.2)) }));
    opacity.value    = withDelay(delay, withTiming(1, { duration: 600 }));
    floatY.value     = withDelay(delay + 850, withRepeat(
      withSequence(
        withTiming(-9, { duration: 3200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0,  { duration: 3200, easing: Easing.inOut(Easing.sin) }),
      ), -1, false,
    ));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value + floatY.value },
      { rotate: slab.rotation },
    ],
  }));

  return (
    <Animated.View style={[slabStyles.slab, { zIndex: slab.zIndex }, animStyle]}>
      {/* Housing */}
      <View style={slabStyles.housing}>

        {/* Grader header */}
        <View style={[slabStyles.graderHeader, { backgroundColor: slab.headerBg }]}>
          <View>
            <Text style={slabStyles.graderLogo}>{slab.grader}</Text>
            <Text style={slabStyles.graderSub}>GRADING</Text>
          </View>
          {/* Holo sticker dot */}
          <LinearGradient
            colors={['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#C77DFF']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={slabStyles.holoSticker}
          />
        </View>

        {/* Label body */}
        <View style={[slabStyles.labelBody, { backgroundColor: '#FFFFFF' }]}>
          <View style={slabStyles.labelCardInfo}>
            <Text style={slabStyles.labelSet} numberOfLines={1}>{slab.set}</Text>
            <Text style={slabStyles.labelName} numberOfLines={1}>{slab.name}</Text>
            <Text style={slabStyles.labelCardNo}>{slab.cardNo}</Text>
            {slab.subGrades && (
              <View style={slabStyles.subGrades}>
                {Object.entries(slab.subGrades).map(([k, v]) => (
                  <View key={k} style={slabStyles.subGradeItem}>
                    <Text style={slabStyles.subGradeLabel}>{k.slice(0,3).toUpperCase()}</Text>
                    <Text style={slabStyles.subGradeVal}>{v}</Text>
                  </View>
                ))}
              </View>
            )}
            <Text style={slabStyles.certNo}>#{slab.certNo}</Text>
          </View>

          {/* Grade badge */}
          <LinearGradient colors={slab.gradeBg} style={slabStyles.gradeBadge}>
            <Text style={[slabStyles.gradeLabel, { color: slab.gradeTextColor }]}>{slab.label}</Text>
            <Text style={[slabStyles.gradeNumber, { color: slab.gradeTextColor }]}>{slab.grade}</Text>
          </LinearGradient>
        </View>

        {/* Card art */}
        <View style={slabStyles.artArea}>
          <LinearGradient colors={slab.artColors} style={StyleSheet.absoluteFillObject} />
          {!imgError && (
            <Image
              source={{ uri: slab.imgUrl }}
              style={slabStyles.cardImage}
              resizeMode="contain"
              onError={() => setImgError(true)}
            />
          )}
          {/* Holo foil sheen */}
          <LinearGradient
            colors={['transparent','rgba(255,255,255,0.18)','transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          {/* Inner border */}
          <View style={slabStyles.artInnerBorder} />
        </View>

        {/* Edge highlights */}
        <View style={slabStyles.edgeLeft} />
        <View style={slabStyles.edgeTop} />
      </View>
    </Animated.View>
  );
}

// ── Splash Screen ────────────────────────────────────────────────────────────
export default function SplashScreen() {
  const logoOpacity  = useSharedValue(0);
  const logoScale    = useSharedValue(0.82);
  const tagOpacity   = useSharedValue(0);
  const ctaOpacity   = useSharedValue(0);
  const ctaTranslate = useSharedValue(24);

  const [isNewUser, setIsNewUser] = useState<boolean | null>(null);

  useEffect(() => {
    // Logo animation
    logoOpacity.value  = withDelay(700, withTiming(1, { duration: 700 }));
    logoScale.value    = withDelay(700, withTiming(1, { duration: 700 }));
    tagOpacity.value   = withDelay(1000, withTiming(1, { duration: 600 }));
    ctaOpacity.value   = withDelay(1200, withTiming(1, { duration: 600 }));
    ctaTranslate.value = withDelay(1200, withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));

    // Check session
    const check = async () => {
      try {
        const [session, onboarded] = await Promise.all([
          restoreSession(),
          AsyncStorage.getItem('hasOnboarded'),
        ]);
        if (session || onboarded === 'true') {
          // Returning user — auto-navigate after animation settles
          setTimeout(() => router.replace('/(tabs)'), 1800);
        } else {
          setIsNewUser(true);
        }
      } catch {
        setIsNewUser(true);
      }
    };
    check();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const tagStyle = useAnimatedStyle(() => ({ opacity: tagOpacity.value }));

  const ctaStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateY: ctaTranslate.value }],
  }));

  const handleEnterVault = async () => {
    await AsyncStorage.setItem('hasOnboarded', 'true');
    router.replace('/welcome');
  };

  const handleGuest = async () => {
    await AsyncStorage.setItem('hasOnboarded', 'true');
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.root}>
      {/* Background glow */}
      <View style={styles.glow} />
      <View style={styles.glowInner} />

      {/* Graded card slabs */}
      <View style={styles.cardStack}>
        {SLABS.map(slab => (
          <View
            key={slab.id}
            style={[styles.slabPosition, { left: '50%', marginLeft: slab.offsetX - 88, marginTop: slab.offsetY }]}
          >
            <GradedSlab slab={slab} delay={slab.delay} />
          </View>
        ))}
      </View>

      {/* Logo + tagline */}
      <Animated.View style={[styles.brandBlock, logoStyle]}>
        <Logo variant="white" width={240} height={108} />
      </Animated.View>

      <Animated.Text style={[styles.tagline, tagStyle]}>
        THE COLLECTOR'S STANDARD
      </Animated.Text>

      {/* CTA (new users only) */}
      {isNewUser && (
        <Animated.View style={[styles.ctaBlock, ctaStyle]}>
          <Pressable
            onPress={handleEnterVault}
            style={({ pressed }) => [styles.enterBtn, { opacity: pressed ? 0.88 : 1 }]}
          >
            <Text style={styles.enterBtnText}>ENTER VAULT  →</Text>
          </Pressable>
          <Pressable onPress={handleGuest} style={styles.guestBtn}>
            <Text style={styles.guestBtnText}>Continue as guest</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#06060A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'web' ? 67 : 0,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    top: '20%',
    left: '50%',
    marginLeft: -210,
    marginTop: -210,
    backgroundColor: 'rgba(204,0,0,0.14)',
    shadowColor: '#CC0000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 100,
  },
  glowInner: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: '20%',
    left: '50%',
    marginLeft: -120,
    marginTop: -120,
    backgroundColor: 'rgba(251,146,60,0.08)',
  },
  cardStack: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    height: 340,
  },
  slabPosition: {
    position: 'absolute',
    top: 0,
  },
  brandBlock: {
    marginTop: 200,
    alignItems: 'center',
  },
  tagline: {
    marginTop: 12,
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 4.5,
    color: 'rgba(255,255,255,0.30)',
    textTransform: 'uppercase',
  },
  ctaBlock: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 60 : 72,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 14,
  },
  enterBtn: {
    backgroundColor: '#CC0000',
    borderRadius: 50,
    paddingHorizontal: 44,
    paddingVertical: 16,
    shadowColor: '#CC0000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 10,
  },
  enterBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 3,
    color: '#FFFFFF',
  },
  guestBtn: {
    paddingVertical: 8,
  },
  guestBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.30)',
  },
});

// ── Slab styles ──────────────────────────────────────────────────────────────
const slabStyles = StyleSheet.create({
  slab: {
    width: 176,
  },
  housing: {
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    padding: 7,
    gap: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.9,
    shadowRadius: 40,
    elevation: 20,
    overflow: 'hidden',
  },
  graderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  graderLogo: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  graderSub: {
    fontSize: 5,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  holoSticker: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  labelBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 5,
    padding: 7,
    gap: 5,
  },
  labelCardInfo: {
    flex: 1,
    gap: 1.5,
    overflow: 'hidden',
  },
  labelSet: {
    fontSize: 6.5,
    fontFamily: 'Inter_600SemiBold',
    color: '#999999',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  labelName: {
    fontSize: 10.5,
    fontFamily: 'Inter_700Bold',
    color: '#111111',
    letterSpacing: -0.2,
  },
  labelCardNo: {
    fontSize: 7,
    fontFamily: 'Inter_600SemiBold',
    color: '#666666',
  },
  subGrades: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 3,
  },
  subGradeItem: {
    alignItems: 'center',
  },
  subGradeLabel: {
    fontSize: 5,
    fontFamily: 'Inter_700Bold',
    color: '#AAAAAA',
    letterSpacing: 0.3,
  },
  subGradeVal: {
    fontSize: 7.5,
    fontFamily: 'Inter_700Bold',
    color: '#111111',
  },
  certNo: {
    fontSize: 6,
    fontFamily: 'Inter_400Regular',
    color: '#AAAAAA',
    marginTop: 2,
  },
  gradeBadge: {
    width: 44,
    height: 44,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  gradeLabel: {
    fontSize: 5.5,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  gradeNumber: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    lineHeight: 26,
  },
  artArea: {
    height: 170,
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.5)',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  artInnerBorder: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  edgeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  edgeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
