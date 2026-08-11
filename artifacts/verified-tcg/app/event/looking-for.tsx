import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { MOCK_LOOKING_FOR_RESULTS } from '@/services/matching';

const C = colors.dark;

const CARDS_TO_SEARCH = [
  { id: 'lf-c1', name: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', color: '#1A1B4B' },
  { id: 'lf-c2', name: 'Pikachu & Zekrom GX', set: 'Sun & Moon', grade: 'PSA 10', color: '#FFD700' },
  { id: 'lf-c3', name: 'Eevee ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 9', color: '#F5A623' },
  { id: 'lf-c4', name: 'Charizard ex', set: 'Obsidian Flames', grade: 'Raw NM', color: '#E0540F' },
];

export default function LookingForScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [selectedCard, setSelectedCard] = useState<typeof CARDS_TO_SEARCH[0] | null>(null);

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>I'm Looking For</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Select a card from your wishlist to see who has it at this event.
        </Text>

        {/* Card picker */}
        <Text style={styles.sectionLabel}>YOUR WISHLIST</Text>
        <View style={{ gap: 10 }}>
          {CARDS_TO_SEARCH.map(card => (
            <Pressable
              key={card.id}
              onPress={() => setSelectedCard(card)}
              style={[
                styles.cardRow,
                { backgroundColor: C.card },
                selectedCard?.id === card.id && { borderColor: C.primary, borderWidth: 2 },
              ]}
            >
              <View style={[styles.cardThumb, { backgroundColor: card.color }]}>
                <Text style={styles.cardInitial}>{card.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{card.name}</Text>
                <Text style={styles.cardMeta}>{card.set} · {card.grade}</Text>
              </View>
              {selectedCard?.id === card.id && (
                <Feather name="check-circle" size={20} color={C.primary} />
              )}
            </Pressable>
          ))}
        </View>

        {/* Results */}
        {selectedCard && (
          <View style={{ gap: 12, marginTop: 8 }}>
            <View style={[styles.resultHeader, { backgroundColor: `${C.positive}18`, borderColor: `${C.positive}44` }]}>
              <Feather name="map-pin" size={14} color={C.positive} />
              <Text style={[styles.resultHeaderText, { color: C.positive }]}>
                {MOCK_LOOKING_FOR_RESULTS.length} available at this event
              </Text>
            </View>

            <Text style={styles.sectionLabel}>AVAILABLE NOW</Text>
            {MOCK_LOOKING_FOR_RESULTS.map(result => (
              <View key={result.id} style={[styles.resultCard, { backgroundColor: C.card }]}>
                <View style={[styles.resultAvatar, { backgroundColor: result.collectorColor }]}>
                  <Text style={styles.resultAvatarText}>{result.collectorInitials}</Text>
                </View>
                <View style={styles.resultInfo}>
                  <View style={styles.resultNameRow}>
                    <Text style={styles.resultUsername}>@{result.collectorUsername}</Text>
                    {result.isVerified && (
                      <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                        <Feather name="check-circle" size={9} color={C.positive} />
                        <Text style={[styles.verText, { color: C.positive }]}>Verified</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.resultMeta}>{result.grade} · ${result.estimatedValue.toLocaleString('en-AU')} est.</Text>
                  {result.booth && (
                    <View style={styles.boothRow}>
                      <Feather name="map-pin" size={10} color={C.primary} />
                      <Text style={styles.boothText}>{result.booth}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.resultRight}>
                  <View style={[
                    styles.typePill,
                    { backgroundColor: result.type === 'for_sale' ? `${C.warning}22` : `${C.positive}22` },
                  ]}>
                    <Text style={[
                      styles.typePillText,
                      { color: result.type === 'for_sale' ? C.warning : C.positive },
                    ]}>
                      {result.type === 'for_sale' ? 'For Sale' : 'For Trade'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}

            <Pressable
              onPress={() => router.push('/trade-match' as any)}
              style={[styles.findMatchesBtn, { backgroundColor: C.primary }]}
            >
              <Feather name="zap" size={16} color="#FFF" />
              <Text style={styles.findMatchesBtnText}>Find Trade Matches</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 20 },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, gap: 12,
    borderWidth: 2, borderColor: 'transparent',
  },
  cardThumb: { width: 50, height: 70, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },
  resultHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  resultHeaderText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  resultCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, gap: 12 },
  resultAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  resultAvatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  resultInfo: { flex: 1, gap: 3 },
  resultNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultUsername: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  verBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  resultMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  boothRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  boothText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  resultRight: { alignItems: 'flex-end' },
  typePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  typePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  findMatchesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 52, borderRadius: 14,
  },
  findMatchesBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
