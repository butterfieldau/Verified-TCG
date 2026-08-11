import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { TCG_LIST } from '@/types';
import { getCollectionMatch } from '@/services/matching';
import { getCollectorProfile } from '@/services/collectors';

const C = colors.dark;

type ProfileTab = 'collection' | 'for_sale' | 'activity' | 'about';

const PROFILE_TABS: { label: string; value: ProfileTab }[] = [
  { label: 'Collection', value: 'collection' },
  { label: 'For Sale', value: 'for_sale' },
  { label: 'Activity', value: 'activity' },
  { label: 'About', value: 'about' },
];

export default function CollectorProfileScreen() {
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username: string }>();
  const [activeTab, setActiveTab] = useState<ProfileTab>('collection');
  const [showMatchCards, setShowMatchCards] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const collector = getCollectorProfile(username ?? '');

  const tcgNames = collector.tcgPreferences
    .map(id => TCG_LIST.find(t => t.id === id)?.shortName ?? id)
    .join(' · ');

  const joinYear = new Date(collector.joinedAt).getFullYear();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Collector Profile</Text>
        <Pressable style={styles.moreBtn}>
          <Feather name="more-horizontal" size={20} color={C.foreground} />
        </Pressable>
      </View>

      {/* Profile card */}
      <View style={[styles.profileCard, { backgroundColor: C.card }]}>
        <View style={styles.avatarRow}>
          <View style={[styles.avatar, { backgroundColor: collector.avatarColor }]}>
            <Text style={styles.avatarText}>{collector.initials}</Text>
          </View>
          <View style={styles.nameBlock}>
            <Text style={styles.displayName}>{collector.displayName}</Text>
            <Text style={styles.username}>@{collector.username}</Text>
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={11} color={C.mutedForeground} />
              <Text style={styles.location}>{collector.location}</Text>
            </View>
          </View>
        </View>

        {/* Verification badges */}
        <View style={styles.badgesRow}>
          {collector.isVerifiedAccount && (
            <View style={[styles.badge, { backgroundColor: `${C.positive}22` }]}>
              <Feather name="user-check" size={12} color={C.positive} />
              <Text style={[styles.badgeText, { color: C.positive }]}>Verified Account</Text>
            </View>
          )}
          {collector.isVerifiedSeller && (
            <View style={[styles.badge, { backgroundColor: '#3B82F622' }]}>
              <Feather name="shield" size={12} color="#3B82F6" />
              <Text style={[styles.badgeText, { color: '#3B82F6' }]}>Verified Seller</Text>
            </View>
          )}
        </View>

        {/* TCG preferences */}
        <Text style={styles.tcgPref}>{tcgNames}</Text>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBlock label="Cards" value={String(collector.stats.publicCards)} />
          <View style={styles.divider} />
          <StatBlock label="For Sale" value={String(collector.stats.forSale)} />
          <View style={styles.divider} />
          <StatBlock label="Trades" value={String(collector.stats.completedTrades)} />
          <View style={styles.divider} />
          <View style={styles.ratingBlock}>
            <View style={styles.ratingRow}>
              <Text style={styles.statValue}>{collector.stats.rating.toFixed(1)}</Text>
              <Feather name="star" size={14} color={C.warning} />
            </View>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
        </View>

        {/* Privacy note */}
        <View style={[styles.privacyNote, { backgroundColor: C.muted }]}>
          <Feather name="lock" size={11} color={C.mutedForeground} />
          <Text style={styles.privacyText}>
            Portfolio value is private · Collector since {joinYear}
          </Text>
        </View>
      </View>

      {/* Collection Match block */}
      {(() => {
        const match = getCollectionMatch(collector.username);
        if (!match) return null;
        return (
          <View style={[styles.matchBlock, { backgroundColor: C.card }]}>
            <View style={[styles.matchBlockHeader, { backgroundColor: `${C.primary}18` }]}>
              <Feather name="git-branch" size={14} color={C.primary} />
              <Text style={[styles.matchBlockTitle, { color: C.primary }]}>COLLECTION MATCH</Text>
            </View>
            <View style={styles.matchBlockBody}>
              <View style={styles.matchStat}>
                <Text style={styles.matchStatValue}>{match.cardsYouHaveThatTheyWant}</Text>
                <Text style={styles.matchStatLabel}>cards you have they want</Text>
              </View>
              <View style={[styles.matchDivider, { backgroundColor: C.border }]} />
              <View style={styles.matchStat}>
                <Text style={styles.matchStatValue}>{match.cardsTheyHaveThatYouWant}</Text>
                <Text style={styles.matchStatLabel}>cards they have you want</Text>
              </View>
            </View>
            {showMatchCards && (
              <View style={styles.matchCardsGrid}>
                <Text style={styles.matchCardsLabel}>YOU HAVE → THEY WANT</Text>
                {match.matchCards.youHave.slice(0, 3).map((c, i) => (
                  <View key={i} style={styles.matchCardRow}>
                    <View style={[styles.matchCardThumb, { backgroundColor: c.color }]}>
                      <Text style={styles.matchCardInitial}>{c.name[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matchCardName}>{c.name}</Text>
                      <Text style={styles.matchCardGrade}>{c.grade}</Text>
                    </View>
                    <Text style={styles.matchCardValue}>${c.value.toLocaleString('en-AU')}</Text>
                  </View>
                ))}
                <Text style={[styles.matchCardsLabel, { marginTop: 10 }]}>THEY HAVE → YOU WANT</Text>
                {match.matchCards.theyHave.slice(0, 3).map((c, i) => (
                  <View key={i} style={styles.matchCardRow}>
                    <View style={[styles.matchCardThumb, { backgroundColor: c.color }]}>
                      <Text style={styles.matchCardInitial}>{c.name[0]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matchCardName}>{c.name}</Text>
                      <Text style={styles.matchCardGrade}>{c.grade}</Text>
                    </View>
                    <Text style={styles.matchCardValue}>${c.value.toLocaleString('en-AU')}</Text>
                  </View>
                ))}
              </View>
            )}
            <Pressable
              onPress={() => setShowMatchCards(!showMatchCards)}
              style={[styles.viewMatchesBtn, { backgroundColor: C.primary }]}
            >
              <Feather name={showMatchCards ? 'chevron-up' : 'git-branch'} size={14} color="#FFF" />
              <Text style={styles.viewMatchesBtnText}>{showMatchCards ? 'Hide Matches' : 'View Matches'}</Text>
            </Pressable>
          </View>
        );
      })()}

      {/* Trade / Message actions */}
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionBtn, { backgroundColor: C.primary, flex: 2 }]}
          onPress={() => router.push('/trade' as any)}
        >
          <Feather name="repeat" size={16} color="#FFFFFF" />
          <Text style={styles.actionBtnText}>Propose Trade</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, { backgroundColor: C.card, flex: 1 }]}>
          <Feather name="message-circle" size={16} color={C.foreground} />
          <Text style={[styles.actionBtnText, { color: C.foreground }]}>Message</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsRow}>
        {PROFILE_TABS.map(t => (
          <Pressable
            key={t.value}
            onPress={() => setActiveTab(t.value)}
            style={[
              styles.tab,
              activeTab === t.value && { borderBottomColor: C.primary },
            ]}
          >
            <Text style={[styles.tabText, activeTab === t.value && { color: C.foreground }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── COLLECTION ──────────────────────────────────── */}
      {activeTab === 'collection' && (
        <View style={styles.tabContent}>
          {collector.publicCollection.length === 0 ? (
            <View style={styles.emptyTab}>
              <Feather name="layers" size={28} color={C.mutedForeground} />
              <Text style={styles.emptyText}>No public cards</Text>
            </View>
          ) : collector.publicCollection.map(card => (
            <View key={card.id} style={[styles.cardRow, { backgroundColor: C.card }]}>
              <View style={[styles.cardThumb, { backgroundColor: card.color }]}>
                <Text style={styles.cardInitial}>{card.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{card.name}</Text>
                <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                  <Text style={styles.gradePillText}>{card.grade}</Text>
                </View>
              </View>
              <Text style={styles.cardValue}>${card.value.toLocaleString('en-AU')}</Text>
            </View>
          ))}
          <Text style={styles.tabNote}>
            Only public collection items are shown. Private cards are hidden by the collector.
          </Text>
        </View>
      )}

      {/* ── FOR SALE ────────────────────────────────────── */}
      {activeTab === 'for_sale' && (
        <View style={styles.tabContent}>
          {collector.forSaleListings.length === 0 ? (
            <View style={styles.emptyTab}>
              <Feather name="tag" size={28} color={C.mutedForeground} />
              <Text style={styles.emptyText}>No active listings</Text>
              <Text style={styles.emptySubtext}>This collector has nothing for sale right now.</Text>
            </View>
          ) : collector.forSaleListings.map(listing => (
            <View key={listing.id} style={[styles.cardRow, { backgroundColor: C.card }]}>
              <View style={[styles.cardThumb, { backgroundColor: listing.color }]}>
                <Text style={styles.cardInitial}>{listing.name[0]}</Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{listing.name}</Text>
                <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                  <Text style={styles.gradePillText}>{listing.grade}</Text>
                </View>
              </View>
              <View style={styles.listingPricing}>
                <Text style={styles.listingPrice}>${listing.price.toLocaleString('en-AU')}</Text>
                <Pressable style={[styles.viewBtn, { backgroundColor: `${C.primary}22` }]}>
                  <Text style={[styles.viewBtnText, { color: C.primary }]}>View</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── ACTIVITY ────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <View style={styles.tabContent}>
          {collector.recentActivity.map(a => (
            <View key={a.id} style={[styles.activityRow, { backgroundColor: C.card }]}>
              <View style={[styles.activityDot, { backgroundColor: C.primary }]} />
              <View style={styles.activityInfo}>
                <Text style={styles.activityText}>{a.text}</Text>
                <Text style={styles.activityTime}>{a.time}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── ABOUT ───────────────────────────────────────── */}
      {activeTab === 'about' && (
        <View style={styles.tabContent}>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>BIO</Text>
            <Text style={styles.aboutText}>{collector.bio}</Text>
          </View>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>FAVOURITE TCGs</Text>
            <Text style={styles.aboutText}>{tcgNames || 'Not specified'}</Text>
          </View>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>MEMBER SINCE</Text>
            <Text style={styles.aboutText}>
              {new Date(collector.joinedAt).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Text style={styles.aboutLabel}>SELLER RATING</Text>
            <View style={styles.ratingDetail}>
              <Text style={styles.ratingLarge}>{collector.stats.rating.toFixed(1)}</Text>
              <View>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <Feather
                      key={s}
                      name="star"
                      size={14}
                      color={s <= Math.round(collector.stats.rating) ? C.warning : C.muted}
                    />
                  ))}
                </View>
                <Text style={styles.reviewCount}>{collector.stats.reviewCount} reviews</Text>
              </View>
            </View>
          </View>
          {!collector.isVerifiedSeller && (
            <View style={[styles.privateNote, { backgroundColor: C.card, borderColor: C.border }]}>
              <Feather name="info" size={14} color={C.mutedForeground} />
              <Text style={styles.privateNoteText}>
                Collection value and full portfolio details are private and not shown on public profiles.
              </Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  moreBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: { borderRadius: 16, padding: 18, marginBottom: 14 },
  avatarRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  nameBlock: { flex: 1, gap: 4 },
  displayName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  username: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  location: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  badgesRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  tcgPref: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
    letterSpacing: 0.5,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  statBlock: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  statLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  ratingBlock: { alignItems: 'center', gap: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: { width: 1, height: 32, backgroundColor: C.border },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  privacyText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 13,
  },
  actionBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  tabsRow: { borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 4,
  },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  tabContent: { paddingTop: 16, gap: 8 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardThumb: {
    width: 50,
    height: 70,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInitial: { fontSize: 22, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  cardInfo: { flex: 1, gap: 8 },
  cardName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  gradePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  cardValue: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  listingPricing: { alignItems: 'flex-end', gap: 8 },
  listingPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  viewBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  viewBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  activityInfo: { flex: 1 },
  activityText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.foreground, lineHeight: 20 },
  activityTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 4 },
  aboutCard: { borderRadius: 14, padding: 16, gap: 8 },
  aboutLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 1.5,
  },
  aboutText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground, lineHeight: 22 },
  ratingDetail: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ratingLarge: { fontSize: 36, fontFamily: 'Inter_700Bold', color: C.foreground },
  starsRow: { flexDirection: 'row', gap: 2 },
  reviewCount: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 4 },
  privateNote: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginTop: 4,
  },
  privateNoteText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 19 },
  emptyTab: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.mutedForeground },
  emptySubtext: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  tabNote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}77`,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
  // Collection Match block
  matchBlock: { borderRadius: 16, overflow: 'hidden', marginBottom: 14 },
  matchBlockHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  matchBlockTitle: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  matchBlockBody: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 16, paddingHorizontal: 14,
  },
  matchStat: { alignItems: 'center', gap: 4, flex: 1 },
  matchStatValue: { fontSize: 32, fontFamily: 'Inter_700Bold', color: C.foreground },
  matchStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  matchDivider: { width: 1, height: 48 },
  matchCardsGrid: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  matchCardsLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  matchCardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  matchCardThumb: { width: 32, height: 44, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  matchCardInitial: { fontSize: 14, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  matchCardName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  matchCardGrade: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  matchCardValue: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },
  viewMatchesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, marginHorizontal: 14, marginBottom: 14, height: 42, borderRadius: 11,
  },
  viewMatchesBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
