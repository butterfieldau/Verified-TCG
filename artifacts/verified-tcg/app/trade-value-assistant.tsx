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
import colors from '@/constants/colors';

const C = colors.dark;

interface OfferCard {
  id: string;
  name: string;
  grade: string;
  value: number;
  color: string;
}

const MY_CARDS_POOL: OfferCard[] = [
  { id: 'mc-001', name: 'Charizard ex', grade: 'PSA 10', value: 1200, color: '#E0540F' },
  { id: 'mc-002', name: 'Pikachu ex', grade: 'TAG 10', value: 850, color: '#FFCC00' },
  { id: 'mc-003', name: 'Rayquaza VMAX', grade: 'BGS 9.5', value: 890, color: '#3AE374' },
  { id: 'mc-004', name: 'Luffy OP01', grade: 'CGC 10', value: 320, color: '#E63946' },
  { id: 'mc-005', name: 'Lugia V', grade: 'PSA 9', value: 220, color: '#B0C4DE' },
];

const THEIR_CARDS_POOL: OfferCard[] = [
  { id: 'tc-001', name: 'Umbreon ex SIR', grade: 'PSA 10', value: 1900, color: '#1A1B4B' },
  { id: 'tc-002', name: 'Pikachu & Zekrom GX', grade: 'PSA 10', value: 1200, color: '#FFD700' },
  { id: 'tc-003', name: 'Eevee ex SIR', grade: 'PSA 9', value: 340, color: '#F5A623' },
  { id: 'tc-004', name: 'Jace, the Mind Sculptor', grade: 'Near Mint', value: 85, color: '#1E40AF' },
];

type Side = 'mine' | 'theirs';

export default function TradeValueAssistantScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [myCards, setMyCards] = useState<OfferCard[]>([MY_CARDS_POOL[0], MY_CARDS_POOL[1]]);
  const [theirCards, setTheirCards] = useState<OfferCard[]>([THEIR_CARDS_POOL[0]]);
  const [myCash, setMyCash] = useState('');
  const [theirCash, setTheirCash] = useState('150');
  const [pickerSide, setPickerSide] = useState<Side | null>(null);
  const [sent, setSent] = useState(false);

  const myTotal = myCards.reduce((s, c) => s + c.value, 0) + (parseFloat(myCash) || 0);
  const theirTotal = theirCards.reduce((s, c) => s + c.value, 0) + (parseFloat(theirCash) || 0);
  const diff = myTotal - theirTotal;

  if (sent) {
    return (
      <View style={[styles.screen, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
        <View style={[styles.sentIcon, { backgroundColor: `${C.positive}22` }]}>
          <Feather name="send" size={40} color={C.positive} />
        </View>
        <Text style={styles.sentTitle}>Offer Sent!</Text>
        <Text style={styles.sentBody}>
          Your trade offer has been submitted.{'\n\n'}
          (Prototype — no real offer sent.)
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.primaryBtn, { paddingHorizontal: 40 }]}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  if (pickerSide) {
    const pool = pickerSide === 'mine' ? MY_CARDS_POOL : THEIR_CARDS_POOL;
    const selected = pickerSide === 'mine' ? myCards : theirCards;
    return (
      <View style={[styles.screen, { backgroundColor: C.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => setPickerSide(null)} style={styles.backBtn}>
            <Feather name="x" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.title}>Add Card</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.pickerHint}>Tap a card to add it to {pickerSide === 'mine' ? 'your offer' : 'their offer'}.</Text>
          {pool.map(card => {
            const alreadyAdded = selected.some(c => c.id === card.id);
            return (
              <Pressable
                key={card.id}
                onPress={() => {
                  if (pickerSide === 'mine') {
                    if (!alreadyAdded) setMyCards(prev => [...prev, card]);
                  } else {
                    if (!alreadyAdded) setTheirCards(prev => [...prev, card]);
                  }
                  setPickerSide(null);
                }}
                style={[styles.pickerRow, { backgroundColor: C.card }, alreadyAdded && { opacity: 0.4 }]}
              >
                <View style={[styles.pickerThumb, { backgroundColor: card.color }]}>
                  <Text style={styles.pickerInitial}>{card.name[0]}</Text>
                </View>
                <View style={styles.pickerInfo}>
                  <Text style={styles.pickerName}>{card.name}</Text>
                  <Text style={styles.pickerGrade}>{card.grade}</Text>
                </View>
                <Text style={styles.pickerValue}>${card.value.toLocaleString('en-AU')}</Text>
                {alreadyAdded && <Text style={styles.addedLabel}>Added</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Trade Value Assistant</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Two-column offer layout */}
        <View style={styles.offerRow}>
          {/* MY OFFER */}
          <View style={[styles.offerCol, { backgroundColor: C.card }]}>
            <Text style={styles.offerLabel}>YOU OFFER</Text>
            <Text style={styles.offerTotal}>${myTotal.toLocaleString('en-AU')}</Text>

            {myCards.map(card => (
              <View key={card.id} style={styles.offerCardRow}>
                <View style={[styles.offerThumb, { backgroundColor: card.color }]}>
                  <Text style={styles.offerInitial}>{card.name[0]}</Text>
                </View>
                <View style={styles.offerCardInfo}>
                  <Text style={styles.offerCardName} numberOfLines={1}>{card.name}</Text>
                  <Text style={styles.offerGrade}>{card.grade}</Text>
                  <Text style={styles.offerCardValue}>${card.value.toLocaleString()}</Text>
                </View>
                <Pressable onPress={() => setMyCards(prev => prev.filter(c => c.id !== card.id))}>
                  <Feather name="x" size={14} color={C.mutedForeground} />
                </Pressable>
              </View>
            ))}

            {myCash ? (
              <View style={[styles.cashRow, { backgroundColor: C.muted }]}>
                <Feather name="dollar-sign" size={12} color={C.positive} />
                <Text style={[styles.cashLabel, { color: C.positive }]}>+${parseFloat(myCash).toLocaleString()} cash</Text>
                <Pressable onPress={() => setMyCash('')}>
                  <Feather name="x" size={12} color={C.mutedForeground} />
                </Pressable>
              </View>
            ) : null}

            <Pressable onPress={() => setPickerSide('mine')} style={[styles.addBtn, { borderColor: C.border }]}>
              <Feather name="plus" size={14} color={C.mutedForeground} />
              <Text style={styles.addBtnText}>Add Card</Text>
            </Pressable>
          </View>

          {/* THEY OFFER */}
          <View style={[styles.offerCol, { backgroundColor: C.card }]}>
            <Text style={styles.offerLabel}>THEY OFFER</Text>
            <Text style={styles.offerTotal}>${theirTotal.toLocaleString('en-AU')}</Text>

            {theirCards.map(card => (
              <View key={card.id} style={styles.offerCardRow}>
                <View style={[styles.offerThumb, { backgroundColor: card.color }]}>
                  <Text style={styles.offerInitial}>{card.name[0]}</Text>
                </View>
                <View style={styles.offerCardInfo}>
                  <Text style={styles.offerCardName} numberOfLines={1}>{card.name}</Text>
                  <Text style={styles.offerGrade}>{card.grade}</Text>
                  <Text style={styles.offerCardValue}>${card.value.toLocaleString()}</Text>
                </View>
                <Pressable onPress={() => setTheirCards(prev => prev.filter(c => c.id !== card.id))}>
                  <Feather name="x" size={14} color={C.mutedForeground} />
                </Pressable>
              </View>
            ))}

            {theirCash ? (
              <View style={[styles.cashRow, { backgroundColor: C.muted }]}>
                <Feather name="dollar-sign" size={12} color={C.positive} />
                <Text style={[styles.cashLabel, { color: C.positive }]}>+${parseFloat(theirCash).toLocaleString()} cash</Text>
                <Pressable onPress={() => setTheirCash('')}>
                  <Feather name="x" size={12} color={C.mutedForeground} />
                </Pressable>
              </View>
            ) : null}

            <Pressable onPress={() => setPickerSide('theirs')} style={[styles.addBtn, { borderColor: C.border }]}>
              <Feather name="plus" size={14} color={C.mutedForeground} />
              <Text style={styles.addBtnText}>Add Card</Text>
            </Pressable>
          </View>
        </View>

        {/* Cash adjustment row */}
        <View style={[styles.cashAdjust, { backgroundColor: C.card }]}>
          <Text style={styles.cashAdjustLabel}>CASH ADJUSTMENT</Text>
          <View style={styles.cashInputRow}>
            <View style={styles.cashInputWrap}>
              <Text style={styles.cashInputSide}>You add</Text>
              <View style={[styles.cashInputField, { borderColor: C.border }]}>
                <Text style={styles.cashCurrency}>$</Text>
                <TextInput
                  value={myCash}
                  onChangeText={setMyCash}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={C.mutedForeground}
                  style={styles.cashInput}
                />
              </View>
            </View>
            <Feather name="repeat" size={16} color={C.mutedForeground} />
            <View style={styles.cashInputWrap}>
              <Text style={styles.cashInputSide}>They add</Text>
              <View style={[styles.cashInputField, { borderColor: C.border }]}>
                <Text style={styles.cashCurrency}>$</Text>
                <TextInput
                  value={theirCash}
                  onChangeText={setTheirCash}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={C.mutedForeground}
                  style={styles.cashInput}
                />
              </View>
            </View>
          </View>
        </View>

        {/* Estimated difference */}
        <View style={[styles.diffCard, {
          backgroundColor: Math.abs(diff) < 50 ? `${C.positive}18` : `${C.warning}18`,
          borderColor: Math.abs(diff) < 50 ? `${C.positive}44` : `${C.warning}44`,
        }]}>
          <Text style={styles.diffLabel}>ESTIMATED DIFFERENCE</Text>
          <Text style={[styles.diffValue, { color: Math.abs(diff) < 50 ? C.positive : C.warning }]}>
            {Math.abs(diff) < 50 ? '$0 — Even Trade' : `$${Math.abs(diff).toLocaleString('en-AU')} ${diff > 0 ? 'in your favour' : 'in their favour'}`}
          </Text>
          {Math.abs(diff) < 50 && (
            <Text style={[styles.diffSub, { color: C.positive }]}>Both sides benefit equally</Text>
          )}
        </View>

        {/* Disclaimer */}
        <View style={[styles.disclaimer, { backgroundColor: `${C.warning}18`, borderColor: `${C.warning}44` }]}>
          <Feather name="info" size={13} color={C.warning} style={{ marginTop: 1 }} />
          <Text style={styles.disclaimerText}>
            Estimated values are based on recent market data and may not reflect actual sale prices. Both parties trade at their own risk.
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: (Platform.OS === 'web' ? 20 : insets.bottom) + 16 }]}>
        <Pressable
          onPress={() => setSent(true)}
          style={styles.primaryBtn}
        >
          <Feather name="send" size={18} color="#FFF" />
          <Text style={styles.primaryBtnText}>Send Offer</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
  offerRow: { flexDirection: 'row', gap: 10 },
  offerCol: { flex: 1, borderRadius: 16, padding: 14, gap: 10 },
  offerLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  offerTotal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground },
  offerCardRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  offerThumb: { width: 36, height: 50, borderRadius: 6, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  offerInitial: { fontSize: 16, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  offerCardInfo: { flex: 1 },
  offerCardName: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  offerGrade: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  offerCardValue: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.foreground },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  cashLabel: { flex: 1, fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 8 },
  addBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  cashAdjust: { borderRadius: 16, padding: 16, gap: 12 },
  cashAdjustLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  cashInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cashInputWrap: { flex: 1, gap: 4 },
  cashInputSide: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  cashInputField: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, height: 40 },
  cashCurrency: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, marginRight: 2 },
  cashInput: { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  diffCard: { borderRadius: 16, padding: 18, alignItems: 'center', gap: 6, borderWidth: 1 },
  diffLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 1.5 },
  diffValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  diffSub: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  disclaimer: { flexDirection: 'row', gap: 8, borderRadius: 12, borderWidth: 1, padding: 12 },
  disclaimerText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.background },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 16, backgroundColor: C.primary },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  // Picker
  pickerHint: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 4 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14 },
  pickerThumb: { width: 44, height: 62, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  pickerInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  pickerInfo: { flex: 1 },
  pickerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  pickerGrade: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  pickerValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  addedLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  // Sent
  sentIcon: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  sentTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  sentBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 22 },
});
