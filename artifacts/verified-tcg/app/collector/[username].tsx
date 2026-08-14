import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { ProBadge } from '@/components/ui/ProBadge';
import { useApp } from '@/context/AppContext';
import {
  fetchCollectorProfile,
  followCollector,
  unfollowCollector,
  type PublicCollector,
} from '@/services/communityApi';

const C = colors.dark;

type ProfileTab = 'about' | 'activity';

const PROFILE_TABS: { label: string; value: ProfileTab }[] = [
  { label: 'About', value: 'about' },
  { label: 'Activity', value: 'activity' },
];

// Deterministic avatar colour from username
const AVATAR_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#84CC16',
];
function avatarColor(initials: string): string {
  const code = (initials.charCodeAt(0) ?? 65) + (initials.charCodeAt(1) ?? 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length]!;
}

// Month name from "YYYY-MM" string
function formatCollectorSince(value: string | null | undefined): string | null {
  if (!value) return null;
  const [year, month] = value.split('-');
  if (!year || !month) return null;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthName = monthNames[parseInt(month, 10) - 1];
  return monthName ? `${monthName} ${year}` : null;
}

const TCG_LABELS: Record<string, string> = {
  pokemon: 'Pokémon',
  onepiece: 'One Piece',
  magic: 'Magic: The Gathering',
  yugioh: 'Yu-Gi-Oh!',
  lorcana: 'Disney Lorcana',
  dragonball: 'Dragon Ball Super',
  sports: 'Sports',
  other: 'Other',
};

export default function CollectorProfileScreen() {
  const insets = useSafeAreaInsets();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user, isAuthenticated } = useApp();
  const [activeTab, setActiveTab] = useState<ProfileTab>('about');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [collector, setCollector] = useState<PublicCollector | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const isOwnProfile = isAuthenticated && user?.username === username;

  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCollectorProfile(username);
      setCollector(data);
      setIsFollowing(data.isFollowing ?? false);
      setFollowerCount(data.followerCount ?? 0);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { load(); }, [load]);

  const handleFollow = async () => {
    if (!collector || followLoading) return;
    setFollowLoading(true);
    const wasFollowing = isFollowing;
    setIsFollowing(!isFollowing);
    setFollowerCount(c => wasFollowing ? c - 1 : c + 1);
    try {
      if (wasFollowing) {
        const { followerCount: newCount } = await unfollowCollector(collector.username);
        setFollowerCount(newCount);
      } else {
        const { followerCount: newCount } = await followCollector(collector.username);
        setFollowerCount(newCount);
      }
    } catch {
      setIsFollowing(wasFollowing);
      setFollowerCount(c => wasFollowing ? c + 1 : c - 1);
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: topPad + 8 }]}>
        <Header />
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      </View>
    );
  }

  if (error || !collector) {
    return (
      <View style={[styles.screen, { paddingTop: topPad + 8 }]}>
        <Header />
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={C.mutedForeground} />
          <Text style={styles.errorText}>{error ?? 'Collector not found'}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={[styles.retryText, { color: C.primary }]}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Private profile — show minimal info only
  if ((collector as any).isPrivate) {
    return (
      <ScrollView
        style={[styles.screen, { backgroundColor: C.background }]}
        contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 48 }]}
      >
        <Header />
        <View style={[styles.profileCard, { backgroundColor: C.card }]}>
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: avatarColor(collector.initials) }]}>
              <Text style={styles.avatarText}>{collector.initials}</Text>
            </View>
            <View style={styles.nameBlock}>
              <Text style={styles.displayName}>{collector.displayName}</Text>
              <Text style={styles.username}>@{collector.username}</Text>
            </View>
          </View>
          <View style={[styles.privateBox, { backgroundColor: C.muted }]}>
            <Feather name="lock" size={18} color={C.mutedForeground} />
            <Text style={styles.privateBoxTitle}>This profile is private</Text>
            <Text style={styles.privateBoxBody}>
              This collector has set their profile to private.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  const color = avatarColor(collector.initials);
  const collectorSinceLabel = formatCollectorSince(collector.collectorSince);
  const favTcgLabel = collector.favouriteTcg ? TCG_LABELS[collector.favouriteTcg] ?? collector.favouriteTcg : null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      <Header />

      {/* Profile card */}
      <View style={[styles.profileCard, { backgroundColor: C.card }]}>
        <View style={styles.avatarRow}>
          {collector.avatarUrl ? (
            <Image source={{ uri: collector.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: color }]}>
              <Text style={styles.avatarText}>{collector.initials}</Text>
            </View>
          )}
          <View style={styles.nameBlock}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <Text style={styles.displayName}>{collector.displayName}</Text>
              {collector.subscriptionTier === 'pro' && <ProBadge />}
            </View>
            <Text style={styles.username}>@{collector.username}</Text>
            {collector.isFoundingMember && (
              <View style={styles.foundingRow}>
                <Feather name="award" size={11} color="#D4AF37" />
                <Text style={styles.foundingText}>Founding Member</Text>
              </View>
            )}
            {collector.location ? (
              <View style={styles.locationRow}>
                <Feather name="map-pin" size={11} color={C.mutedForeground} />
                <Text style={styles.location}>{collector.location}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Stats: followers / following / posts */}
        <View style={styles.statsRow}>
          <StatBlock label="Followers" value={String(followerCount)} />
          <View style={styles.divider} />
          <StatBlock label="Following" value={String(collector.followingCount ?? 0)} />
          <View style={styles.divider} />
          <StatBlock label="Posts" value={String(collector.postCount ?? 0)} />
        </View>

        {/* Member info row */}
        <View style={[styles.memberRow, { backgroundColor: C.muted }]}>
          <Feather name="clock" size={11} color={C.mutedForeground} />
          <Text style={styles.memberText}>
            {collectorSinceLabel
              ? `Collecting since ${collectorSinceLabel}`
              : `Member since ${new Date(collector.joinedAt).getFullYear()}`}
          </Text>
          {favTcgLabel ? (
            <>
              <Text style={[styles.memberText, { color: C.border }]}> · </Text>
              <Text style={[styles.memberText, { color: C.primary }]}>{favTcgLabel}</Text>
            </>
          ) : null}
        </View>
      </View>

      {/* Actions */}
      {!isOwnProfile && isAuthenticated && (
        <View style={styles.actionsRow}>
          <Pressable
            style={[
              styles.followBtn,
              isFollowing
                ? { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }
                : { backgroundColor: C.primary },
            ]}
            onPress={handleFollow}
            disabled={followLoading}
          >
            {followLoading
              ? <ActivityIndicator size="small" color={isFollowing ? C.foreground : '#FFF'} />
              : (
                <>
                  <Feather
                    name={isFollowing ? 'user-check' : 'user-plus'}
                    size={16}
                    color={isFollowing ? C.foreground : '#FFF'}
                  />
                  <Text style={[styles.followBtnText, { color: isFollowing ? C.foreground : '#FFF' }]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </>
              )
            }
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: C.card, flex: 1 }]}
            onPress={() => router.push('/trade' as any)}
          >
            <Feather name="repeat" size={16} color={C.foreground} />
            <Text style={[styles.actionBtnText, { color: C.foreground }]}>Propose Trade</Text>
          </Pressable>
        </View>
      )}

      {/* Own profile — show edit button */}
      {isOwnProfile && (
        <Pressable
          style={[styles.editProfileBtn, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => router.push('/edit-profile' as any)}
        >
          <Feather name="edit-2" size={15} color={C.foreground} />
          <Text style={styles.editProfileText}>Edit Profile</Text>
        </Pressable>
      )}

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

      {/* ── ABOUT ───────────────────────────────────────── */}
      {activeTab === 'about' && (
        <View style={styles.tabContent}>
          {collector.bio ? (
            <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
              <Text style={styles.aboutLabel}>BIO</Text>
              <Text style={styles.aboutText}>{collector.bio}</Text>
            </View>
          ) : null}

          {collectorSinceLabel ? (
            <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
              <Text style={styles.aboutLabel}>COLLECTING SINCE</Text>
              <Text style={styles.aboutText}>{collectorSinceLabel}</Text>
            </View>
          ) : (
            <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
              <Text style={styles.aboutLabel}>MEMBER SINCE</Text>
              <Text style={styles.aboutText}>
                {new Date(collector.joinedAt).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
              </Text>
            </View>
          )}

          {favTcgLabel ? (
            <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
              <Text style={styles.aboutLabel}>FAVOURITE TCG</Text>
              <Text style={styles.aboutText}>{favTcgLabel}</Text>
            </View>
          ) : null}

          {!isAuthenticated && (
            <View style={[styles.privateNote, { backgroundColor: C.card, borderColor: C.border }]}>
              <Feather name="info" size={14} color={C.mutedForeground} />
              <Text style={styles.privateNoteText}>
                Sign in to follow this collector and see their activity.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── ACTIVITY ────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <View style={styles.tabContent}>
          <View style={[styles.aboutCard, { backgroundColor: C.card }]}>
            <Feather name="rss" size={20} color={C.mutedForeground} />
            <Text style={styles.aboutText}>
              Follow this collector to see their posts and activity in your Community feed.
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={20} color={C.foreground} />
      </Pressable>
      <Text style={styles.headerTitle}>Collector Profile</Text>
      <View style={{ width: 40 }} />
    </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
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
  profileCard: { borderRadius: 16, padding: 18, marginBottom: 14 },
  avatarRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  nameBlock: { flex: 1, gap: 4 },
  displayName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  username: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  location: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  foundingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  foundingText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#D4AF37' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
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
  divider: { width: 1, height: 32, backgroundColor: C.border },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  memberText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  followBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 13,
  },
  followBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 13,
  },
  actionBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 16,
  },
  editProfileText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
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
  aboutCard: { borderRadius: 14, padding: 14, gap: 8 },
  aboutLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  aboutText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground, lineHeight: 20 },
  privateNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  privateNoteText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 18,
  },
  privateBox: {
    alignItems: 'center',
    borderRadius: 14,
    padding: 24,
    gap: 10,
    marginTop: 4,
  },
  privateBoxTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  privateBoxBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 18,
  },
});
