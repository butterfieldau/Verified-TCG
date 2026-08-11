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
import { MOCK_TRADE_MATCHES } from '@/services/matching';
import type { TradeMatch } from '@/services/matching';
import { useApp } from '@/context/AppContext';

const C = colors.dark;

export default function TradeMatchScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { watchlist } = useApp();

  // Show up to one match per wishlist item (min 1 so demo is never blank)
  const visibleMatches = MOCK_TRADE_MATCHES.slice(0, Math.max(1, watchlist.length));

  const selectedMatch = visibleMatches.find(m => m.id === selectedId);

  if (selectedMatch) {
    return <MatchDetail match={selectedMatch} onBack={() => setSelectedId(null)} />;
  }

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Trade Matches</Text>
        <View style={[styles.countPill, { backgroundColor: `${C.primary}22` }]}>
          <Text style={[styles.countText, { color: C.primary }]}>{visibleMatches.length}</Text>
        </View>
      </View>

      {/* Subtitle */}
      <View style={styles.subtitleRow}>
        <Feather name="zap" size={14} color={C.primary} />
        <Text style={styles.subtitle}>
          {watchlist.length > 0
            ? `Based on your ${watchlist.length} wishlist ${watchlist.length === 1 ? 'card' : 'cards'} — collectors who have what you want`
            : 'Add cards to your wishlist to find collectors who have what you want'}
        </Text>
      </View>

      {watchlist.length === 0 && (
        <Pressable
          onPress={() => router.push('/wishlist' as any)}
          style={[styles.emptyWishlistBanner, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}
        >
          <Feather name="heart" size={16} color={C.primary} />
          <Text style={[styles.emptyWishlistText, { color: C.primary }]}>
            Build your wishlist to unlock trade matches
          </Text>
          <Feather name="chevron-right" size={16} color={C.primary} />
        </Pressable>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {visibleMatches.map((match, idx) => (
          <Pressable
            key={match.id}
            onPress={() => setSelectedId(match.id)}
            style={[styles.matchCard, { backgroundColor: C.card }]}
          >
            {/* Match % badge */}
            <View style={styles.matchHeader}>
              <View style={[styles.matchPill, { backgroundColor: matchColor(match.matchPercent) + '22' }]}>
                <View style={[styles.matchDot, { backgroundColor: matchColor(match.matchPercent) }]} />
                <Text style={[styles.matchPct, { color: matchColor(match.matchPercent) }]}>
                  {match.matchPercent}% Trade Match
                </Text>
              </View>
              <Text style={styles.matchRank}>#{idx + 1}</Text>
            </View>

            {/* Cards comparison */}
            <View style={styles.cardCompare}>
              <View style={styles.cardSide}>
                <Text style={styles.sideLabel}>YOU WANT</Text>
                <View style={[styles.cardThumb, { backgroundColor: match.youWant.color }]}>
                  <Text style={styles.cardInitial}>{match.youWant.name[0]}</Text>
                </View>
                <Text style={styles.cardName} numberOfLines={2}>{match.youWant.name}</Text>
                <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                  <Text style={styles.gradePillText}>{match.youWant.grade}</Text>
                </View>
                <Text style={styles.cardValue}>${match.youWant.value.toLocaleString('en-AU')}</Text>
              </View>

              <View style={styles.swapCol}>
                <View style={[styles.swapCircle, { backgroundColor: C.muted }]}>
                  <Feather name="repeat" size={16} color={C.mutedForeground} />
                </View>
                {(() => {
                  const diff = Math.abs(match.youWant.value - match.theyWant.value);
                  return (
                    <Text style={[styles.diffText, { color: diff < 100 ? C.positive : C.warning }]}>
                      ${diff} diff
                    </Text>
                  );
                })()}
              </View>

              <View style={styles.cardSide}>
                <Text style={styles.sideLabel}>THEY WANT</Text>
                <View style={[styles.cardThumb, { backgroundColor: match.theyWant.color }]}>
                  <Text style={styles.cardInitial}>{match.theyWant.name[0]}</Text>
                </View>
                <Text style={styles.cardName} numberOfLines={2}>{match.theyWant.name}</Text>
                <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                  <Text style={styles.gradePillText}>{match.theyWant.grade}</Text>
                </View>
                <Text style={styles.cardValue}>${match.theyWant.value.toLocaleString('en-AU')}</Text>
              </View>
            </View>

            {/* Collector info */}
            <View style={[styles.collectorRow, { borderTopColor: C.border }]}>
              <View style={[styles.avatar, { backgroundColor: match.collector.avatarColor }]}>
                <Text style={styles.avatarText}>{match.collector.initials}</Text>
              </View>
              <View style={styles.collectorInfo}>
                <View style={styles.collectorNameRow}>
                  <Text style={styles.collectorName}>@{match.collector.username}</Text>
                  {match.collector.isVerified && (
                    <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                      <Feather name="check-circle" size={10} color={C.positive} />
                      <Text style={[styles.verText, { color: C.positive }]}>Verified</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.collectorMeta}>{match.collector.location} · {match.collector.tradesCount} trades</Text>
              </View>
              <View style={styles.arrowWrap}>
                <Feather name="chevron-right" size={18} color={C.mutedForeground} />
              </View>
            </View>
          </Pressable>
        ))}

        <Text style={styles.disclaimer}>
          Trade matches are based on your wishlist and collection data. All values are estimates only.
        </Text>
      </ScrollView>
    </View>
  );
}

function MatchDetail({ match, onBack }: { match: TradeMatch; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <View style={[styles.screen, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
        <View style={[styles.sentIcon, { backgroundColor: `${C.positive}22` }]}>
          <Feather name="send" size={40} color={C.positive} />
        </View>
        <Text style={styles.sentTitle}>Offer Sent!</Text>
        <Text style={styles.sentBody}>
          Your trade offer has been sent to @{match.collector.username}.{'\n\n'}
          They have 48 hours to respond.{'\n\n'}
          (Prototype — no real offer sent.)
        </Text>
        <Pressable onPress={onBack} style={[styles.primaryBtn, { backgroundColor: C.primary, paddingHorizontal: 40 }]}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const diff = match.youWant.value - match.theyWant.value;

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>View Match</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { gap: 14 }]} showsVerticalScrollIndicator={false}>
        {/* Match score */}
        <View style={[styles.scoreCard, { backgroundColor: matchColor(match.matchPercent) + '18', borderColor: matchColor(match.matchPercent) + '44' }]}>
          <View style={[styles.scoreBadge, { backgroundColor: matchColor(match.matchPercent) }]}>
            <Text style={styles.scoreNum}>{match.matchPercent}%</Text>
          </View>
          <Text style={[styles.scoreLabel, { color: matchColor(match.matchPercent) }]}>Trade Match</Text>
          <Text style={styles.scoreDesc}>Mutual interest detected — you both have cards the other wants.</Text>
        </View>

        {/* Card comparison */}
        <View style={styles.detailCompare}>
          <View style={[styles.detailSide, { backgroundColor: C.card }]}>
            <Text style={styles.sideLabel}>YOU WANT</Text>
            <View style={[styles.detailThumb, { backgroundColor: match.youWant.color }]}>
              <Text style={styles.detailInitial}>{match.youWant.name[0]}</Text>
            </View>
            <Text style={styles.detailCardName} numberOfLines={2}>{match.youWant.name}</Text>
            <Text style={styles.detailSet}>{match.youWant.set}</Text>
            <View style={[styles.gradePill, { backgroundColor: C.muted, alignSelf: 'center' }]}>
              <Text style={styles.gradePillText}>{match.youWant.grade}</Text>
            </View>
            <Text style={styles.detailValue}>${match.youWant.value.toLocaleString('en-AU')}</Text>
            <Text style={styles.detailValueSub}>est. AUD</Text>
          </View>

          <View style={styles.detailSwap}>
            <Feather name="repeat" size={20} color={C.mutedForeground} />
          </View>

          <View style={[styles.detailSide, { backgroundColor: C.card }]}>
            <Text style={styles.sideLabel}>THEY WANT</Text>
            <View style={[styles.detailThumb, { backgroundColor: match.theyWant.color }]}>
              <Text style={styles.detailInitial}>{match.theyWant.name[0]}</Text>
            </View>
            <Text style={styles.detailCardName} numberOfLines={2}>{match.theyWant.name}</Text>
            <Text style={styles.detailSet}>{match.theyWant.set}</Text>
            <View style={[styles.gradePill, { backgroundColor: C.muted, alignSelf: 'center' }]}>
              <Text style={styles.gradePillText}>{match.theyWant.grade}</Text>
            </View>
            <Text style={styles.detailValue}>${match.theyWant.value.toLocaleString('en-AU')}</Text>
            <Text style={styles.detailValueSub}>est. AUD</Text>
          </View>
        </View>

        {/* Value difference */}
        <View style={[styles.diffCard, { backgroundColor: C.card }]}>
          <Text style={styles.diffCardLabel}>VALUE DIFFERENCE</Text>
          <Text style={[styles.diffCardValue, { color: Math.abs(diff) < 100 ? C.positive : C.warning }]}>
            {Math.abs(diff) < 100 ? 'Near-even trade' : `$${Math.abs(diff).toLocaleString('en-AU')} ${diff > 0 ? 'in your favour' : 'in their favour'}`}
          </Text>
          {Math.abs(diff) < 100 && (
            <Text style={[styles.diffCardSub, { color: C.positive }]}>Both parties benefit equally</Text>
          )}
        </View>

        {/* Collector card */}
        <View style={[styles.collectorDetailCard, { backgroundColor: C.card }]}>
          <Text style={styles.sideLabel}>COLLECTOR</Text>
          <View style={styles.collectorDetailRow}>
            <View style={[styles.avatarLg, { backgroundColor: match.collector.avatarColor }]}>
              <Text style={styles.avatarLgText}>{match.collector.initials}</Text>
            </View>
            <View style={styles.collectorDetailInfo}>
              <View style={styles.collectorNameRow}>
                <Text style={styles.collectorDetailName}>@{match.collector.username}</Text>
                {match.collector.isVerified && (
                  <View style={[styles.verBadge, { backgroundColor: `${C.positive}22` }]}>
                    <Feather name="check-circle" size={10} color={C.positive} />
                    <Text style={[styles.verText, { color: C.positive }]}>Verified Collector</Text>
                  </View>
                )}
              </View>
              <Text style={styles.collectorMeta}>{match.collector.location}</Text>
              <View style={styles.ratingRow}>
                <Feather name="star" size={12} color={C.warning} />
                <Text style={styles.ratingText}>{match.collector.rating.toFixed(1)} · {match.collector.tradesCount} completed trades</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Footer actions */}
      <View style={[styles.detailFooter, { paddingBottom: (Platform.OS === 'web' ? 20 : insets.bottom) + 16 }]}>
        <Pressable
          onPress={() => router.push('/trade-value-assistant' as any)}
          style={[styles.secondaryBtn, { backgroundColor: C.card, flex: 1 }]}
        >
          <Feather name="sliders" size={16} color={C.foreground} />
          <Text style={[styles.secondaryBtnText, { color: C.foreground }]}>Value Assistant</Text>
        </Pressable>
        <Pressable
          onPress={() => setSent(true)}
          style={[styles.primaryBtn, { flex: 2 }]}
        >
          <Feather name="send" size={16} color="#FFF" />
          <Text style={styles.primaryBtnText}>Send Trade Offer</Text>
        </Pressable>
      </View>
    </View>
  );
}

function matchColor(pct: number) {
  if (pct >= 90) return '#22C55E';
  if (pct >= 75) return '#F59E0B';
  return '#888888';
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
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  countPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, marginBottom: 14 },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, flex: 1, lineHeight: 18 },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  matchCard: { borderRadius: 18, padding: 16, marginBottom: 14 },
  matchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  matchPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  matchDot: { width: 6, height: 6, borderRadius: 3 },
  matchPct: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  matchRank: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  cardCompare: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
  cardSide: { flex: 1, alignItems: 'center', gap: 6 },
  sideLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  cardThumb: { width: 64, height: 90, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardInitial: { fontSize: 28, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  gradePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  cardValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  swapCol: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 20 },
  swapCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  diffText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  collectorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, borderTopWidth: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorInfo: { flex: 1 },
  collectorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  collectorName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  verBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  collectorMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  arrowWrap: {},
  disclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}77`, textAlign: 'center', lineHeight: 18, marginTop: 8 },
  emptyWishlistBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 8,
    borderRadius: 12, borderWidth: 1, padding: 14,
  },
  emptyWishlistText: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18,
  },
  // Detail view
  scoreCard: { borderRadius: 16, padding: 20, borderWidth: 1, alignItems: 'center', gap: 8 },
  scoreBadge: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  scoreNum: { fontSize: 32, fontFamily: 'Rajdhani_700Bold', color: '#FFF' },
  scoreLabel: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  scoreDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 18 },
  detailCompare: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  detailSide: { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6 },
  detailThumb: { width: 72, height: 100, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  detailInitial: { fontSize: 32, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  detailCardName: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  detailSet: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  detailValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  detailValueSub: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  detailSwap: { alignItems: 'center', justifyContent: 'center', width: 32 },
  diffCard: { borderRadius: 16, padding: 18, alignItems: 'center', gap: 6 },
  diffCardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 1.5 },
  diffCardValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  diffCardSub: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  collectorDetailCard: { borderRadius: 16, padding: 16, gap: 12 },
  collectorDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarLg: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarLgText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorDetailInfo: { flex: 1, gap: 4 },
  collectorDetailName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  detailFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.background,
  },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14, backgroundColor: C.primary },
  primaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 14 },
  secondaryBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  sentIcon: { width: 96, height: 96, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  sentTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  sentBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 22 },
});
