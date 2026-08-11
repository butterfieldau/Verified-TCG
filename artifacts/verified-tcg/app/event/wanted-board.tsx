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
import { MOCK_WANTED_BOARD } from '@/services/matching';

const C = colors.dark;

export default function WantedBoardScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [responded, setResponded] = useState<string[]>([]);

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Wanted Board</Text>
        <View style={[styles.countPill, { backgroundColor: `${C.primary}22` }]}>
          <Text style={[styles.countText, { color: C.primary }]}>{MOCK_WANTED_BOARD.length}</Text>
        </View>
      </View>

      <View style={[styles.infoBanner, { backgroundColor: C.card }]}>
        <Feather name="info" size={13} color={C.mutedForeground} />
        <Text style={styles.infoBannerText}>
          Collectors at TCXPO Sydney are looking for these cards. Tap "I Have This" if you own one.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {MOCK_WANTED_BOARD.map(item => {
          const hasResponded = responded.includes(item.id);
          return (
            <View key={item.id} style={[styles.wantCard, { backgroundColor: C.card }]}>
              <View style={styles.wantTop}>
                <View style={[styles.avatar, { backgroundColor: item.collectorColor }]}>
                  <Text style={styles.avatarText}>{item.collectorInitials}</Text>
                </View>
                <View style={styles.collectorInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.collectorName}>@{item.collectorUsername}</Text>
                    {item.isVerified && (
                      <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                        <Feather name="check-circle" size={9} color={C.positive} />
                        <Text style={[styles.verText, { color: C.positive }]}>Verified</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.lookingLabel}>Looking for:</Text>
                </View>
              </View>

              <View style={styles.cardWant}>
                <View style={[styles.cardThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.cardInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.cardWantInfo}>
                  <Text style={styles.cardWantName}>{item.cardName}</Text>
                  <Text style={styles.cardWantMeta}>{item.set}</Text>
                  <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                    <Text style={styles.gradePillText}>{item.grade}</Text>
                  </View>
                  {item.maxBudget && (
                    <Text style={styles.budgetText}>Budget: up to ${item.maxBudget.toLocaleString('en-AU')}</Text>
                  )}
                </View>
              </View>

              <Pressable
                onPress={() => {
                  setResponded(prev => [...prev, item.id]);
                }}
                style={[
                  styles.haveThisBtn,
                  { backgroundColor: hasResponded ? `${C.positive}22` : C.primary },
                ]}
              >
                {hasResponded ? (
                  <>
                    <Feather name="check-circle" size={14} color={C.positive} />
                    <Text style={[styles.haveThisBtnText, { color: C.positive }]}>Response Sent</Text>
                  </>
                ) : (
                  <>
                    <Feather name="zap" size={14} color="#FFF" />
                    <Text style={[styles.haveThisBtnText, { color: '#FFF' }]}>I Have This</Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}

        {/* Post your own want */}
        <Pressable style={[styles.postWantBtn, { borderColor: C.border }]}>
          <Feather name="plus-circle" size={18} color={C.primary} />
          <View>
            <Text style={styles.postWantTitle}>Post to Wanted Board</Text>
            <Text style={styles.postWantSub}>Let collectors know what you're looking for</Text>
          </View>
        </Pressable>
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
  countPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: 20, marginBottom: 14, borderRadius: 12, padding: 12,
  },
  infoBannerText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },
  content: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  wantCard: { borderRadius: 18, padding: 16, gap: 12 },
  wantTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  collectorName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  verBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  lookingLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  cardWant: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardThumb: { width: 52, height: 72, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontSize: 24, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardWantInfo: { flex: 1, gap: 4 },
  cardWantName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  cardWantMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  gradePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  budgetText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.positive },
  haveThisBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 44, borderRadius: 12,
  },
  haveThisBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  postWantBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16,
    borderWidth: 1, borderStyle: 'dashed',
  },
  postWantTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  postWantSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
});
