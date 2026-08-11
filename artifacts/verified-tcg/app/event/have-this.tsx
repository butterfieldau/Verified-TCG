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
import { MOCK_I_HAVE_THIS_RESULTS } from '@/services/matching';
import { getHaveThisCards } from '@/services/event';

const C = colors.dark;

const MY_CARDS = getHaveThisCards();

export default function HaveThisScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [selectedCard, setSelectedCard] = useState<typeof MY_CARDS[0] | null>(null);

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>I Have This</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Select a card you own to see which collectors at this event want it.
        </Text>

        <Text style={styles.sectionLabel}>YOUR COLLECTION</Text>
        <View style={{ gap: 10 }}>
          {MY_CARDS.map(card => (
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

        {selectedCard && (
          <View style={{ gap: 12, marginTop: 8 }}>
            {/* Result summary */}
            <View style={[styles.resultBanner, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}>
              <Text style={[styles.resultBannerValue, { color: C.primary }]}>{MOCK_I_HAVE_THIS_RESULTS.length}</Text>
              <Text style={[styles.resultBannerLabel, { color: C.primary }]}>
                collectors here want {selectedCard.name}
              </Text>
            </View>

            {/* Trade match count */}
            <View style={[styles.matchSummary, { backgroundColor: C.card }]}>
              <View style={styles.matchSumRow}>
                <View style={[styles.matchSumIcon, { backgroundColor: `${C.positive}22` }]}>
                  <Feather name="repeat" size={14} color={C.positive} />
                </View>
                <View>
                  <Text style={styles.matchSumValue}>{MOCK_I_HAVE_THIS_RESULTS.filter(r => r.hasTradeMatch).length} Trade Matches</Text>
                  <Text style={styles.matchSumSub}>They own cards on your wishlist too</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>INTERESTED COLLECTORS</Text>
            {MOCK_I_HAVE_THIS_RESULTS.map(result => (
              <View key={result.id} style={[styles.resultCard, { backgroundColor: C.card }]}>
                <View style={[styles.resultAvatar, { backgroundColor: result.collectorColor }]}>
                  <Text style={styles.resultAvatarText}>{result.collectorInitials}</Text>
                </View>
                <View style={styles.resultInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.resultUsername}>@{result.collectorUsername}</Text>
                    {result.isVerified && (
                      <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                        <Feather name="check-circle" size={9} color={C.positive} />
                        <Text style={[styles.verText, { color: C.positive }]}>Verified</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.wantedGrade}>Wants: {result.wantedGrade}</Text>
                  {result.hasTradeMatch && (
                    <View style={[styles.tradeMatchBadge, { backgroundColor: `${C.positive}22` }]}>
                      <Feather name="zap" size={9} color={C.positive} />
                      <Text style={[styles.tradeMatchText, { color: C.positive }]}>Trade Match</Text>
                    </View>
                  )}
                </View>
                <Pressable
                  onPress={() => router.push('/trade-match' as any)}
                  style={[styles.matchBtn, { backgroundColor: result.hasTradeMatch ? C.primary : C.card, borderColor: result.hasTradeMatch ? 'transparent' : C.border }]}
                >
                  <Text style={[styles.matchBtnText, { color: result.hasTradeMatch ? '#FFF' : C.mutedForeground }]}>
                    {result.hasTradeMatch ? 'Match' : 'View'}
                  </Text>
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={() => router.push('/trade-match' as any)}
              style={[styles.findBtn, { backgroundColor: C.primary }]}
            >
              <Feather name="zap" size={16} color="#FFF" />
              <Text style={styles.findBtnText}>Find Matches</Text>
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
  resultBanner: {
    borderRadius: 14, borderWidth: 1, padding: 16, alignItems: 'center', gap: 4,
  },
  resultBannerValue: { fontSize: 40, fontFamily: 'Inter_700Bold' },
  resultBannerLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center' },
  matchSummary: { borderRadius: 14, padding: 14 },
  matchSumRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  matchSumIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  matchSumValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  matchSumSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  resultCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, gap: 12 },
  resultAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  resultAvatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  resultInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultUsername: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  verBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  wantedGrade: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  tradeMatchBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  tradeMatchText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  matchBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  matchBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  findBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 52, borderRadius: 14,
  },
  findBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
