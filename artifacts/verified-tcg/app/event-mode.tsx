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
import { MOCK_EVENT } from '@/services/matching';
import { useApp } from '@/context/AppContext';

const C = colors.dark;

type EventTab = 'matches' | 'wishlist' | 'want_yours' | 'for_sale' | 'trending';

const TABS: { label: string; value: EventTab }[] = [
  { label: 'Matches', value: 'matches' },
  { label: 'Wishlist', value: 'wishlist' },
  { label: 'Want Yours', value: 'want_yours' },
  { label: 'For Sale', value: 'for_sale' },
  { label: 'Trending', value: 'trending' },
];

export default function EventModeScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [isInEvent, setIsInEvent] = useState(false);
  const [activeTab, setActiveTab] = useState<EventTab>('matches');
  const { watchlist } = useApp();

  // Scale event stats with live wishlist length
  const wishlistCount = watchlist.length;
  const liveStats = {
    collectorsWithYourWants: Math.max(0, Math.round(MOCK_EVENT.stats.collectorsWithYourWants * (wishlistCount / 3))),
    tradeMatches: Math.max(0, Math.round(MOCK_EVENT.stats.tradeMatches * (wishlistCount / 3))),
    wishlistForSale: Math.max(0, Math.round(MOCK_EVENT.stats.wishlistForSale * (wishlistCount / 3))),
    wantYourCards: MOCK_EVENT.stats.wantYourCards,
  };

  if (!isInEvent) {
    return (
      <View style={[styles.screen, { backgroundColor: C.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.title}>Event Mode</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.enterContent} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={[styles.eventHero, { backgroundColor: C.card }]}>
            <View style={[styles.eventBadge, { backgroundColor: `${C.primary}22` }]}>
              <Feather name="map-pin" size={12} color={C.primary} />
              <Text style={[styles.eventBadgeText, { color: C.primary }]}>LIVE EVENT DETECTED</Text>
            </View>
            <Text style={styles.eventName}>{MOCK_EVENT.name}</Text>
            <Text style={styles.eventVenue}>{MOCK_EVENT.venue} · {MOCK_EVENT.city}</Text>
            <Text style={styles.eventDates}>{MOCK_EVENT.dates}</Text>
            <View style={styles.attendeePill}>
              <Feather name="users" size={13} color={C.mutedForeground} />
              <Text style={styles.attendeeText}>{MOCK_EVENT.collectorsPresent} collectors registered</Text>
            </View>
          </View>

          {/* Preview stats */}
          <Text style={styles.previewTitle}>What's available for you</Text>
          {wishlistCount === 0 && (
            <Pressable
              onPress={() => router.push('/wishlist' as any)}
              style={[styles.wishlistNudge, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}44` }]}
            >
              <Feather name="heart" size={14} color={C.primary} />
              <Text style={[styles.wishlistNudgeText, { color: C.primary }]}>
                Add cards to your wishlist to see personalised event stats
              </Text>
              <Feather name="chevron-right" size={14} color={C.primary} />
            </Pressable>
          )}
          <View style={styles.statsGrid}>
            <StatTile icon="heart" value={liveStats.collectorsWithYourWants} label="Collectors with cards you want" color={C.primary} />
            <StatTile icon="repeat" value={liveStats.tradeMatches} label="Trade matches at event" color='#22C55E' />
            <StatTile icon="tag" value={liveStats.wishlistForSale} label="Wishlist cards for sale" color='#F59E0B' />
            <StatTile icon="eye" value={liveStats.wantYourCards} label="Want cards you have" color='#3B82F6' />
          </View>

          {/* What you get */}
          <View style={[styles.featureCard, { backgroundColor: C.card }]}>
            <Text style={styles.featureTitle}>Event Mode unlocks</Text>
            {[
              { icon: 'map-pin', text: 'See who\'s at this event with cards you want' },
              { icon: 'repeat', text: 'Find trade matches on the floor in real time' },
              { icon: 'shopping-bag', text: 'Browse vendor inventory and listings' },
              { icon: 'list', text: 'Post to the Wanted Board for collectors to see' },
              { icon: 'check-square', text: 'Track set completion with on-site availability' },
            ].map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: `${C.primary}22` }]}>
                  <Feather name={f.icon as any} size={14} color={C.primary} />
                </View>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <Pressable onPress={() => setIsInEvent(true)} style={styles.enterBtn}>
            <Feather name="zap" size={18} color="#FFF" />
            <Text style={styles.enterBtnText}>Enter Event Mode</Text>
          </Pressable>

          <Text style={styles.enterDisclaimer}>
            Event Mode uses your wishlist and collection data to surface relevant matches. No GPS is used.
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ── Active Event Dashboard ──────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      {/* Event header */}
      <View style={[styles.eventHeader, { paddingTop: topPad + 8 }]}>
        <View style={styles.eventHeaderLeft}>
          <View style={[styles.liveDot]} />
          <View>
            <Text style={styles.eventHeaderName}>{MOCK_EVENT.name}</Text>
            <Text style={styles.eventHeaderSub}>{MOCK_EVENT.venue} · {MOCK_EVENT.dates}</Text>
          </View>
        </View>
        <Pressable onPress={() => setIsInEvent(false)} style={[styles.leaveBtn, { backgroundColor: `${C.primary}22` }]}>
          <Feather name="log-out" size={14} color={C.primary} />
          <Text style={[styles.leaveBtnText, { color: C.primary }]}>Leave</Text>
        </Pressable>
      </View>

      {/* Stat highlights */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statScroll} contentContainerStyle={styles.statScrollContent}>
        <MiniStat icon="🔥" value={liveStats.collectorsWithYourWants} label="have your wants" onPress={() => setActiveTab('wishlist')} />
        <MiniStat icon="🤝" value={liveStats.tradeMatches} label="trade matches" onPress={() => setActiveTab('matches')} />
        <MiniStat icon="💰" value={liveStats.wishlistForSale} label="wishlist for sale" onPress={() => setActiveTab('for_sale')} />
        <MiniStat icon="👀" value={liveStats.wantYourCards} label="want your cards" onPress={() => setActiveTab('want_yours')} />
      </ScrollView>

      {/* Quick action buttons */}
      <View style={styles.quickActions}>
        <QuickAction icon="search" label="I'm Looking For" onPress={() => router.push('/event/looking-for' as any)} />
        <QuickAction icon="package" label="I Have This" onPress={() => router.push('/event/have-this' as any)} />
        <QuickAction icon="list" label="Wanted Board" onPress={() => router.push('/event/wanted-board' as any)} />
        <QuickAction icon="grid" label="Complete My Set" onPress={() => router.push('/event/complete-my-set' as any)} />
      </View>

      {/* Section tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent}>
        {TABS.map(t => (
          <Pressable
            key={t.value}
            onPress={() => setActiveTab(t.value)}
            style={[styles.tab, activeTab === t.value && { borderBottomColor: C.primary }]}
          >
            <Text style={[styles.tabText, activeTab === t.value && { color: C.foreground }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.tabContent, { paddingBottom: Math.max(insets.bottom, 12) }]} showsVerticalScrollIndicator={false}>
        {/* TRADE MATCHES */}
        {activeTab === 'matches' && (
          <View style={{ gap: 12 }}>
            {MOCK_EVENT.tradeMatchesAtEvent.map(match => (
              <Pressable
                key={match.id}
                onPress={() => router.push('/trade-match' as any)}
                style={[styles.matchCard, { backgroundColor: C.card }]}
              >
                <View style={styles.matchTopRow}>
                  <View style={[styles.matchPill, { backgroundColor: '#22C55E22' }]}>
                    <View style={[styles.matchDot, { backgroundColor: '#22C55E' }]} />
                    <Text style={[styles.matchPctText, { color: '#22C55E' }]}>{match.matchPercent}% Match</Text>
                  </View>
                  <Text style={styles.atEventLabel}>AT THIS EVENT</Text>
                </View>
                <View style={styles.matchMini}>
                  <View style={styles.matchMiniSide}>
                    <View style={[styles.matchMiniThumb, { backgroundColor: match.youWant.color }]} />
                    <View>
                      <Text style={styles.matchMiniLabel}>YOU WANT</Text>
                      <Text style={styles.matchMiniName} numberOfLines={1}>{match.youWant.name}</Text>
                      <Text style={styles.matchMiniGrade}>{match.youWant.grade} · ${match.youWant.value.toLocaleString()}</Text>
                    </View>
                  </View>
                  <Feather name="repeat" size={14} color={C.mutedForeground} />
                  <View style={styles.matchMiniSide}>
                    <View style={[styles.matchMiniThumb, { backgroundColor: match.theyWant.color }]} />
                    <View>
                      <Text style={styles.matchMiniLabel}>THEY WANT</Text>
                      <Text style={styles.matchMiniName} numberOfLines={1}>{match.theyWant.name}</Text>
                      <Text style={styles.matchMiniGrade}>{match.theyWant.grade} · ${match.theyWant.value.toLocaleString()}</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.matchCollectorRow, { borderTopColor: C.border }]}>
                  <View style={[styles.matchAvatar, { backgroundColor: match.collector.avatarColor }]}>
                    <Text style={styles.matchAvatarText}>{match.collector.initials}</Text>
                  </View>
                  <Text style={styles.matchCollectorName}>@{match.collector.username}</Text>
                  {match.collector.isVerified && <Feather name="check-circle" size={12} color={C.positive} />}
                  <View style={{ flex: 1 }} />
                  <Feather name="chevron-right" size={16} color={C.mutedForeground} />
                </View>
              </Pressable>
            ))}
            <Pressable onPress={() => router.push('/trade-match' as any)} style={[styles.viewAllBtn, { borderColor: C.border }]}>
              <Text style={styles.viewAllText}>View All Trade Matches</Text>
              <Feather name="arrow-right" size={14} color={C.mutedForeground} />
            </Pressable>
          </View>
        )}

        {/* WISHLIST NEARBY */}
        {activeTab === 'wishlist' && (
          <View style={{ gap: 10 }}>
            {MOCK_EVENT.wishlistNearby.map(item => (
              <View key={item.id} style={[styles.listCard, { backgroundColor: C.card }]}>
                <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listCardName}>{item.cardName}</Text>
                  <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                  <Text style={styles.listValue}>${item.value.toLocaleString('en-AU')}</Text>
                </View>
                <View style={styles.listRight}>
                  <View style={[styles.availPill, { backgroundColor: `${C.positive}22` }]}>
                    <Text style={[styles.availText, { color: C.positive }]}>{item.availableCount} avail.</Text>
                  </View>
                  <Text style={styles.listSeller}>@{item.sellerUsername}</Text>
                  {item.sellerVerified && <Feather name="check-circle" size={10} color={C.positive} />}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* WANT YOUR CARDS */}
        {activeTab === 'want_yours' && (
          <View style={{ gap: 10 }}>
            {MOCK_EVENT.wantYourCards.map(item => (
              <View key={item.id} style={[styles.listCard, { backgroundColor: C.card }]}>
                <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listCardName}>{item.cardName}</Text>
                  <Text style={styles.listMeta}>{item.grade}</Text>
                  <View style={styles.avatarCluster}>
                    {item.collectors.slice(0, 3).map(c => (
                      <View key={c.username} style={[styles.clusterAvatar, { backgroundColor: c.color }]}>
                        <Text style={styles.clusterInitial}>{c.initials[0]}</Text>
                      </View>
                    ))}
                    <Text style={styles.clusterCount}>{item.collectors.length} collectors</Text>
                  </View>
                </View>
                <Pressable onPress={() => router.push('/event/have-this' as any)} style={[styles.haveThisBtn, { backgroundColor: `${C.primary}22` }]}>
                  <Text style={[styles.haveThisBtnText, { color: C.primary }]}>I Have This</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* FOR SALE */}
        {activeTab === 'for_sale' && (
          <View style={{ gap: 10 }}>
            {MOCK_EVENT.forSaleAtEvent.map(item => (
              <Pressable
                key={item.id}
                onPress={() => item.vendorId
                  ? router.push(`/vendor/${item.vendorId}` as any)
                  : router.push(`/collector/${item.sellerUsername}` as any)
                }
                style={[styles.listCard, { backgroundColor: C.card }]}
              >
                <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listCardName}>{item.cardName}</Text>
                  <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                  {item.booth && <Text style={styles.boothText}>{item.booth}</Text>}
                </View>
                <View style={styles.listRight}>
                  <Text style={styles.listPrice}>${item.askingPrice.toLocaleString('en-AU')}</Text>
                  <Text style={styles.listSeller}>@{item.sellerUsername}</Text>
                  {item.sellerVerified && <Feather name="check-circle" size={10} color={C.positive} />}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* TRENDING */}
        {activeTab === 'trending' && (
          <View style={{ gap: 10 }}>
            {MOCK_EVENT.trending.map((item, i) => (
              <View key={item.id} style={[styles.listCard, { backgroundColor: C.card }]}>
                <Text style={styles.trendRank}>#{i + 1}</Text>
                <View style={[styles.listThumb, { backgroundColor: item.color }]}>
                  <Text style={styles.listInitial}>{item.cardName[0]}</Text>
                </View>
                <View style={styles.listInfo}>
                  <Text style={styles.listCardName}>{item.cardName}</Text>
                  <Text style={styles.listMeta}>{item.set} · {item.grade}</Text>
                  <View style={styles.watcherRow}>
                    <Feather name="eye" size={11} color={C.mutedForeground} />
                    <Text style={styles.watcherText}>{item.watchers} watching</Text>
                  </View>
                </View>
                <Text style={[styles.trendChange, { color: C.positive }]}>{item.change}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StatTile({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  return (
    <View style={[styles.statTile, { backgroundColor: C.card }]}>
      <Feather name={icon as any} size={18} color={color} />
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function MiniStat({ icon, value, label, onPress }: { icon: string; value: number; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.miniStat, { backgroundColor: C.card }]}>
      <Text style={styles.miniStatIcon}>{icon}</Text>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </Pressable>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.quickAction, { backgroundColor: C.card }]}>
      <Feather name={icon as any} size={18} color={C.foreground} />
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
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
  // Enter screen
  enterContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  eventHero: { borderRadius: 20, padding: 20, alignItems: 'center', gap: 10 },
  eventBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  eventBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  eventName: { fontSize: 26, fontFamily: 'Rajdhani_700Bold', color: C.foreground, textAlign: 'center', letterSpacing: -0.3 },
  eventVenue: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  eventDates: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  attendeePill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  attendeeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  previewTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: { width: '47%', borderRadius: 14, padding: 14, alignItems: 'center', gap: 6 },
  statTileValue: { fontSize: 32, fontFamily: 'Inter_700Bold', color: C.foreground },
  statTileLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  featureCard: { borderRadius: 16, padding: 18, gap: 14 },
  featureTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  enterBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 56, borderRadius: 16, backgroundColor: C.primary },
  enterBtnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#FFF' },
  enterDisclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}77`, textAlign: 'center', lineHeight: 18 },
  wishlistNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 4,
  },
  wishlistNudgeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  // Event dashboard
  eventHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  eventHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.positive },
  eventHeaderName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  eventHeaderSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  leaveBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  leaveBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  statScroll: { height: 90, flexShrink: 0 },
  statScrollContent: { paddingHorizontal: 20, gap: 10, paddingBottom: 10 },
  miniStat: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', gap: 2 },
  miniStatIcon: { fontSize: 18 },
  miniStatValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  miniStatLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  quickActions: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 12 },
  quickAction: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', gap: 5 },
  quickActionLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: C.foreground, textAlign: 'center' },
  tabs: { borderBottomWidth: 1, borderBottomColor: C.border },
  tabsContent: { paddingHorizontal: 16 },
  tab: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  tabContent: { paddingHorizontal: 16, paddingTop: 8 },
  // Cards
  matchCard: { borderRadius: 16, padding: 14, gap: 12 },
  matchTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  matchDot: { width: 5, height: 5, borderRadius: 3 },
  matchPctText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  atEventLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1 },
  matchMini: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  matchMiniSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchMiniThumb: { width: 36, height: 50, borderRadius: 6 },
  matchMiniLabel: { fontSize: 8, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1 },
  matchMiniName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  matchMiniGrade: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  matchCollectorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1 },
  matchAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  matchAvatarText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FFF' },
  matchCollectorName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 12, gap: 12 },
  listThumb: { width: 44, height: 62, borderRadius: 7, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  listInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  listInfo: { flex: 1, gap: 3 },
  listCardName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  listMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground },
  listRight: { alignItems: 'flex-end', gap: 4 },
  availPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  availText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  listSeller: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  listPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground },
  boothText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },
  avatarCluster: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  clusterAvatar: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  clusterInitial: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#FFF' },
  clusterCount: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  haveThisBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  haveThisBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  trendRank: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.mutedForeground, width: 24, textAlign: 'center' },
  watcherRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  watcherText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  trendChange: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 12, borderWidth: 1 },
  viewAllText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
});
