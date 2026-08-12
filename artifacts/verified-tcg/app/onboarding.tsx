import React, { useState } from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import colors from '@/constants/colors';

const C = colors.dark;
const { width: SCREEN_W } = Dimensions.get('window');

const TCG_OPTIONS = [
  'Pokémon',
  'Magic: The Gathering',
  'Yu-Gi-Oh!',
  'One Piece TCG',
  'Disney Lorcana',
  'Dragon Ball Super',
];

interface StepProps {
  step: number;
  selectedGames: string[];
  onToggleGame: (g: string) => void;
}

function Step1() {
  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.iconCircle}>
        <Feather name="trending-up" size={36} color={C.primary} />
      </View>
      <Text style={stepStyles.eyebrow}>Step 1 of 3</Text>
      <Text style={stepStyles.heading}>KNOW YOUR{'\n'}CARDS' WORTH.</Text>
      <Text style={stepStyles.body}>
        Track your collection and understand its current market value in real time.
        Never undersell or overpay again.
      </Text>
      {/* Decorative mock price cards */}
      <View style={stepStyles.mockCard}>
        <View style={[stepStyles.mockCardInner, { backgroundColor: '#1A1B4B' }]}>
          <Text style={stepStyles.mockCardName}>Umbreon ex</Text>
          <Text style={stepStyles.mockCardSet}>Prismatic Evolutions</Text>
          <Text style={stepStyles.mockCardPrice}>$1,450</Text>
          <Text style={[stepStyles.mockCardChange, { color: C.positive }]}>+8.4% ↑</Text>
        </View>
        <View style={[stepStyles.mockCardSmall, { backgroundColor: '#E0540F' }]}>
          <Text style={stepStyles.mockCardName}>Charizard ex</Text>
          <Text style={stepStyles.mockCardPrice}>$580</Text>
          <Text style={[stepStyles.mockCardChange, { color: C.positive }]}>+2.4% ↑</Text>
        </View>
      </View>
    </View>
  );
}

function Step2({ selectedGames, onToggleGame }: Pick<StepProps, 'selectedGames' | 'onToggleGame'>) {
  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.eyebrow}>Step 2 of 3</Text>
      <Text style={stepStyles.heading}>WHAT DO{'\n'}YOU COLLECT?</Text>
      <Text style={stepStyles.body}>Pick all the games in your vault.</Text>
      <View style={stepStyles.gameGrid}>
        {TCG_OPTIONS.map(game => {
          const selected = selectedGames.includes(game);
          return (
            <Pressable
              key={game}
              onPress={() => { Haptics.selectionAsync(); onToggleGame(game); }}
              style={({ pressed }) => [
                stepStyles.gameChip,
                selected ? stepStyles.gameChipSelected : stepStyles.gameChipDefault,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[stepStyles.gameLabel, { color: selected ? '#FFFFFF' : C.mutedForeground }]}>
                {game}
              </Text>
              <Text style={[stepStyles.gameCheck, { color: selected ? '#FFFFFF' : C.mutedForeground }]}>
                {selected ? '✓' : '+'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Step3() {
  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.iconCircle}>
        <Feather name="layers" size={36} color={C.primary} />
      </View>
      <Text style={stepStyles.eyebrow}>Step 3 of 3</Text>
      <Text style={stepStyles.heading}>YOUR ENTIRE{'\n'}COLLECTION.{'\n'}ONE PLACE.</Text>
      <Text style={stepStyles.body}>
        Track raw cards, graded slabs, and sealed products — all in one premium portfolio.
      </Text>
      <View style={stepStyles.featureList}>
        {[
          { icon: 'shield', text: 'Graded card tracking (PSA, BGS, CGC)' },
          { icon: 'bar-chart-2', text: 'Real-time AUD portfolio value' },
          { icon: 'eye', text: 'Verification tools for every card' },
        ].map(f => (
          <View key={f.text} style={stepStyles.featureRow}>
            <View style={stepStyles.featureIcon}>
              <Feather name={f.icon as any} size={16} color={C.primary} />
            </View>
            <Text style={stepStyles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [selectedGames, setSelectedGames] = useState<string[]>(['Pokémon', 'One Piece TCG']);
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const toggleGame = (g: string) => {
    setSelectedGames(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g],
    );
  };

  const handleNext = () => {
    if (step < 2) {
      setStep(s => s + 1);
    }
  };

  const handleGetStarted = () => {
    setLoading(true);
    router.replace('/sign-in');
  };

  const handleBack = () => {
    if (step > 0) setStep(s => s - 1);
    else router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Progress bar */}
      <View style={styles.progress}>
        {[0, 1, 2].map(i => (
          <View
            key={i}
            style={[
              styles.progressBar,
              { backgroundColor: i <= step ? C.primary : C.muted },
            ]}
          />
        ))}
      </View>

      {/* Back */}
      <Pressable onPress={handleBack} style={styles.backBtn}>
        <Feather name="chevron-left" size={22} color={C.foreground} />
      </Pressable>

      {/* Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: botPad + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && <Step1 />}
        {step === 1 && <Step2 selectedGames={selectedGames} onToggleGame={toggleGame} />}
        {step === 2 && <Step3 />}
      </ScrollView>

      {/* Bottom CTAs */}
      <View style={[styles.bottom, { paddingBottom: botPad + 16, paddingTop: 12 }]}>
        {step < 2 ? (
          <>
            <Button fullWidth onPress={handleNext} size="lg">
              Next
            </Button>
            <Pressable onPress={() => setStep(2)} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip for now</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Button fullWidth onPress={handleGetStarted} size="lg" loading={loading}>
              Get Started
            </Button>
            <Pressable onPress={() => router.push('/sign-in')} style={styles.skipBtn}>
              <Text style={styles.skipText}>I already have an account</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  progress: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 6,
    marginBottom: 8,
  },
  progressBar: { flex: 1, height: 3, borderRadius: 2 },
  backBtn: {
    padding: 8,
    marginLeft: 16,
    alignSelf: 'flex-start',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  bottom: {
    paddingHorizontal: 24,
    gap: 8,
    backgroundColor: C.background,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  skipBtn: { alignItems: 'center', paddingVertical: 6 },
  skipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});

const stepStyles = StyleSheet.create({
  container: { paddingTop: 24 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: `${C.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 2.5,
    color: C.mutedForeground,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  heading: {
    fontSize: 42,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    lineHeight: 40,
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 24,
    marginBottom: 28,
  },
  mockCard: {
    flexDirection: 'row',
    gap: 10,
  },
  mockCardInner: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  mockCardSmall: {
    width: 110,
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  mockCardName: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.9)',
  },
  mockCardSet: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.55)',
  },
  mockCardPrice: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    marginTop: 8,
  },
  mockCardChange: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  gameGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  gameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: (SCREEN_W - 24 * 2 - 10) / 2,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  gameChipDefault: { borderColor: C.border, backgroundColor: C.card },
  gameChipSelected: { borderColor: C.primary, backgroundColor: `${C.primary}22` },
  gameLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  gameCheck: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  featureList: { gap: 14, marginTop: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${C.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
    flex: 1,
  },
});
