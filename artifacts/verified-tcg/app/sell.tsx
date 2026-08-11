import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { CONDITION_LABELS } from '@/types';
import type { CardCondition } from '@/types';

const C = colors.dark;

const STEPS = [
  'Select Card',
  'Card Details',
  'Condition',
  'Price',
  'Photos',
  'Preview',
  'Publish',
];

const CONDITIONS: CardCondition[] = ['mint', 'near_mint', 'excellent', 'good', 'light_played', 'played'];

export default function SellScreen() {
  const insets = useSafeAreaInsets();
  const { collection } = useApp();
  const [step, setStep] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [condition, setCondition] = useState<CardCondition>('near_mint');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');
  const [published, setPublished] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const selectedItem = collection.find(i => i.id === selectedItemId);
  const card = selectedItem?.card;

  const canNext =
    step === 0 ? !!selectedItemId :
    step === 1 ? true :
    step === 2 ? !!condition :
    step === 3 ? !!price && parseFloat(price) > 0 :
    true;

  function handleNext() {
    if (step < STEPS.length - 1) setStep(s => s + 1);
  }

  function handleBack() {
    if (step === 0) router.back();
    else setStep(s => s - 1);
  }

  function handlePublish() {
    setPublished(true);
  }

  if (published) {
    return (
      <View style={[styles.screen, { backgroundColor: C.background, paddingTop: topPad }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: `${C.positive}22` }]}>
            <Feather name="check-circle" size={52} color={C.positive} />
          </View>
          <Text style={styles.successTitle}>Listing Published!</Text>
          <Text style={styles.successBody}>
            {card?.name ?? 'Your card'} has been listed for ${parseFloat(price || '0').toLocaleString('en-AU')} AUD.
            {'\n\n'}This is a prototype — no real listing was created.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.successBtn, { backgroundColor: C.primary }]}
          >
            <Text style={styles.successBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={handleBack} style={styles.backBtn}>
          <Feather name={step === 0 ? 'x' : 'arrow-left'} size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Sell a Card</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Step indicator */}
      <View style={styles.stepsRow}>
        {STEPS.map((s, i) => (
          <View
            key={s}
            style={[
              styles.stepDot,
              {
                backgroundColor:
                  i < step ? C.positive :
                  i === step ? C.primary :
                  C.muted,
                flex: i === STEPS.length - 1 ? 0 : 1,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.stepLabel}>
        <Text style={styles.stepNum}>Step {step + 1} of {STEPS.length}</Text>
        <Text style={styles.stepName}>{STEPS[step]}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── STEP 0: Select card ─────────────────────────────── */}
        {step === 0 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepHint}>Choose a card from your collection to list for sale.</Text>
            {collection.map(item => (
              <Pressable
                key={item.id}
                onPress={() => setSelectedItemId(item.id)}
                style={[
                  styles.cardSelectRow,
                  { backgroundColor: C.card },
                  selectedItemId === item.id && { borderColor: C.primary, borderWidth: 2 },
                ]}
              >
                <View style={[styles.cardSelectThumb, { backgroundColor: item.card.gradientStart }]}>
                  <Text style={styles.cardSelectInitial}>{item.card.name[0]}</Text>
                </View>
                <View style={styles.cardSelectInfo}>
                  <Text style={styles.cardSelectName}>{item.card.name}</Text>
                  <Text style={styles.cardSelectMeta}>
                    {item.card.setName} · {item.grading ? `${item.grading.company} ${item.grading.grade}` : CONDITION_LABELS[item.condition]}
                  </Text>
                </View>
                {selectedItemId === item.id && (
                  <Feather name="check-circle" size={20} color={C.primary} />
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* ── STEP 1: Card details ────────────────────────────── */}
        {step === 1 && card && (
          <View style={styles.stepBody}>
            <Text style={styles.stepHint}>Confirm the card details for this listing.</Text>
            <View style={[styles.detailCard, { backgroundColor: C.card }]}>
              <View style={[styles.detailThumb, { backgroundColor: card.gradientStart }]}>
                <Text style={styles.detailInitial}>{card.name[0]}</Text>
              </View>
              <View style={{ gap: 8 }}>
                <DetailRow label="Card" value={card.name} />
                <DetailRow label="Set" value={card.setName} />
                <DetailRow label="Number" value={card.number} />
                <DetailRow label="TCG" value={card.tcg.toUpperCase()} />
                <DetailRow label="Year" value={String(card.year)} />
                <DetailRow label="Market Value" value={`$${card.price.raw.toLocaleString('en-AU')} AUD`} highlight />
              </View>
            </View>
          </View>
        )}

        {/* ── STEP 2: Condition ───────────────────────────────── */}
        {step === 2 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepHint}>Select the condition of this card.</Text>
            {CONDITIONS.map(c => (
              <Pressable
                key={c}
                onPress={() => setCondition(c)}
                style={[
                  styles.conditionRow,
                  { backgroundColor: C.card },
                  condition === c && { borderColor: C.primary, borderWidth: 2 },
                ]}
              >
                <Text style={[styles.conditionLabel, condition === c && { color: C.primary }]}>
                  {CONDITION_LABELS[c]}
                </Text>
                {condition === c && <Feather name="check" size={16} color={C.primary} />}
              </Pressable>
            ))}
          </View>
        )}

        {/* ── STEP 3: Price ───────────────────────────────────── */}
        {step === 3 && card && (
          <View style={styles.stepBody}>
            <Text style={styles.stepHint}>Set your asking price in AUD.</Text>
            <View style={[styles.priceBox, { backgroundColor: C.card }]}>
              <Text style={styles.priceCurrency}>$</Text>
              <TextInput
                style={styles.priceInput}
                value={price}
                onChangeText={setPrice}
                placeholder="0.00"
                placeholderTextColor={C.mutedForeground}
                keyboardType="decimal-pad"
              />
              <Text style={styles.priceSuffix}>AUD</Text>
            </View>
            <Text style={styles.priceHint}>
              Market value: ${card.price.raw.toLocaleString('en-AU')} AUD
            </Text>
            <TextInput
              style={[styles.descInput, { backgroundColor: C.card, color: C.foreground }]}
              value={desc}
              onChangeText={setDesc}
              placeholder="Add a description (optional)"
              placeholderTextColor={C.mutedForeground}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        )}

        {/* ── STEP 4: Photos ──────────────────────────────────── */}
        {step === 4 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepHint}>Add photos of your card to attract buyers.</Text>
            <View style={styles.photosGrid}>
              {[0, 1, 2, 3].map(i => (
                <Pressable
                  key={i}
                  style={[styles.photoSlot, { backgroundColor: C.card, borderColor: C.border }]}
                >
                  <Feather name="camera" size={24} color={C.mutedForeground} />
                  <Text style={styles.photoSlotText}>{i === 0 ? 'Front' : i === 1 ? 'Back' : `Photo ${i + 1}`}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.stepHint, { textAlign: 'center', marginTop: 8 }]}>
              (Photos are mocked in this prototype)
            </Text>
          </View>
        )}

        {/* ── STEP 5: Preview ─────────────────────────────────── */}
        {step === 5 && card && (
          <View style={styles.stepBody}>
            <Text style={styles.stepHint}>Review your listing before publishing.</Text>
            <View style={[styles.previewCard, { backgroundColor: C.card }]}>
              <View style={[styles.previewThumb, { backgroundColor: card.gradientStart }]}>
                <Text style={styles.previewInitial}>{card.name[0]}</Text>
              </View>
              <Text style={styles.previewName}>{card.name}</Text>
              <Text style={styles.previewMeta}>{card.setName} · {CONDITION_LABELS[condition]}</Text>
              <View style={[styles.previewDivider, { backgroundColor: C.border }]} />
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Asking Price</Text>
                <Text style={styles.previewPrice}>${parseFloat(price || '0').toLocaleString('en-AU')} AUD</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Market Value</Text>
                <Text style={styles.previewMuted}>${card.price.raw.toLocaleString('en-AU')} AUD</Text>
              </View>
              {desc ? (
                <View style={[styles.descBox, { backgroundColor: C.muted }]}>
                  <Text style={styles.descText}>{desc}</Text>
                </View>
              ) : null}
              <View style={[styles.verifiedBadge, { backgroundColor: `${C.primary}22` }]}>
                <Feather name="shield" size={13} color={C.primary} />
                <Text style={[styles.verifiedText, { color: C.primary }]}>Verified Seller listing</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── STEP 6: Publish ─────────────────────────────────── */}
        {step === 6 && (
          <View style={styles.stepBody}>
            <View style={styles.publishContainer}>
              <View style={[styles.publishIcon, { backgroundColor: `${C.primary}22` }]}>
                <Feather name="send" size={36} color={C.primary} />
              </View>
              <Text style={styles.publishTitle}>Ready to publish?</Text>
              <Text style={styles.publishBody}>
                Your listing will appear on the Verified TCG marketplace.
                {'\n\n'}This is a prototype — your listing won't actually be published.
              </Text>
            </View>
          </View>
        )}

      </ScrollView>

      {/* Footer CTA */}
      <View style={[styles.footer, { paddingBottom: (Platform.OS === 'web' ? 20 : insets.bottom) + 16 }]}>
        <Pressable
          onPress={step === 6 ? handlePublish : handleNext}
          disabled={!canNext}
          style={({ pressed }) => [
            styles.nextBtn,
            { backgroundColor: canNext ? C.primary : C.muted, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.nextBtnText, { color: canNext ? '#FFFFFF' : C.mutedForeground }]}>
            {step === 6 ? 'Publish Listing' : step === STEPS.length - 2 ? 'Review Listing' : 'Continue'}
          </Text>
          <Feather name={step === 6 ? 'check' : 'arrow-right'} size={18} color={canNext ? '#FFFFFF' : C.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={[detailStyles.value, highlight && { color: C.primary, fontFamily: 'Inter_700Bold' }]}>{value}</Text>
    </View>
  );
}

const detailStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  value: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  stepsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 4,
    height: 4,
    marginBottom: 10,
  },
  stepDot: { height: 4, borderRadius: 2, minWidth: 4 },
  stepLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 20 },
  stepNum: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  stepName: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  stepBody: { gap: 12 },
  stepHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 20 },
  cardSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelectThumb: {
    width: 50,
    height: 70,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSelectInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardSelectInfo: { flex: 1 },
  cardSelectName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardSelectMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  detailCard: { borderRadius: 16, padding: 18, gap: 16 },
  detailThumb: {
    height: 120,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailInitial: { fontSize: 48, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  conditionLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  priceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 8,
  },
  priceCurrency: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.mutedForeground },
  priceInput: {
    flex: 1,
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    textAlign: 'center',
  },
  priceSuffix: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  priceHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  descInput: {
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    minHeight: 100,
  },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoSlot: {
    width: '47%',
    aspectRatio: 3 / 4,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoSlotText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  previewCard: { borderRadius: 16, padding: 20, alignItems: 'center', gap: 10 },
  previewThumb: {
    width: 120,
    height: 170,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  previewInitial: { fontSize: 56, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  previewName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  previewMeta: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  previewDivider: { width: '100%', height: 1, marginVertical: 4 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  previewLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  previewPrice: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  previewMuted: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  descBox: { borderRadius: 10, padding: 12, width: '100%' },
  descText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  verifiedText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  publishContainer: { alignItems: 'center', gap: 16, paddingVertical: 20 },
  publishIcon: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  publishTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: C.foreground },
  publishBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 16,
  },
  nextBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  successIcon: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  successBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
  },
  successBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 16, marginTop: 8 },
  successBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});
