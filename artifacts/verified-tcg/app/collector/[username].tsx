import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  blockCollector,
  unblockCollector,
  reportCollector,
  type PublicCollector,
} from '@/services/communityApi';

const C = colors.dark;

type ProfileTab = 'about' | 'activity';

const PROFILE_TABS: { label: string; value: ProfileTab }[] = [
  { label: 'About', value: 'about' },
  { label: 'Activity', value: 'activity' },
];

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'spam', label: 'Spam or fake account' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'fraud', label: 'Fraud or suspicious activity' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Other' },
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

// ── Report modal ──────────────────────────────────────────────────────────────

function ReportModal({
  visible,
  username,
  displayName,
  onClose,
}: {
  visible: boolean;
  username: string;
  displayName: string;
  onClose: () => void;
}) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) return;
    Alert.alert(
      'Submit Report',
      `Report @${username} for "${REPORT_REASONS.find(r => r.value === selectedReason)?.label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await reportCollector(username, selectedReason, note.trim() || undefined);
              onClose();
              Alert.alert(
                'Report Submitted',
                'Thank you for your report. Our team will review it shortly.',
              );
            } catch {
              Alert.alert('Error', 'Failed to submit report. Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const handleClose = () => {
    setSelectedReason(null);
    setNote('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={reportStyles.overlay}>
        <Pressable style={reportStyles.backdrop} onPress={handleClose} />
        <View style={[reportStyles.sheet, { backgroundColor: C.card }]}>
          <View style={reportStyles.handle} />
          <Text style={reportStyles.title}>Report @{username}</Text>
          <Text style={reportStyles.subtitle}>
            Why are you reporting {displayName}?
          </Text>

          <View style={reportStyles.reasons}>
            {REPORT_REASONS.map(r => (
              <Pressable
                key={r.value}
                onPress={() => setSelectedReason(r.value)}
                style={[
                  reportStyles.reasonRow,
                  selectedReason === r.value && { backgroundColor: `${C.primary}14` },
                ]}
              >
                <View style={[
                  reportStyles.radio,
                  { borderColor: selectedReason === r.value ? C.primary : C.border },
                ]}>
                  {selectedReason === r.value && (
                    <View style={[reportStyles.radioDot, { backgroundColor: C.primary }]} />
                  )}
                </View>
                <Text style={[
                  reportStyles.reasonText,
                  selectedReason === r.value && { color: C.foreground },
                ]}>
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={reportStyles.noteLabel}>
            Additional notes <Text style={reportStyles.optional}>(optional)</Text>
          </Text>
          <TextInput
            style={[reportStyles.noteInput, { backgroundColor: C.muted, color: C.foreground }]}
            value={note}
            onChangeText={setNote}
            placeholder="Describe the issue..."
            placeholderTextColor={C.mutedForeground}
            multiline
            maxLength={500}
            numberOfLines={3}
          />

          <View style={reportStyles.actions}>
            <Pressable
              onPress={handleClose}
              style={[reportStyles.cancelBtn, { backgroundColor: C.muted }]}
            >
              <Text style={[reportStyles.cancelBtnText, { color: C.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!selectedReason || submitting}
              style={[
                reportStyles.submitBtn,
                { backgroundColor: selectedReason ? C.destructive : C.muted },
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={reportStyles.submitBtnText}>Submit Report</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const reportStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 200 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center', marginBottom: 20,
  },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginBottom: 6 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 16 },
  reasons: { gap: 2, marginBottom: 16 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  reasonText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, flex: 1 },
  noteLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  optional: { fontSize: 11, fontFamily: 'Inter_400Regular', textTransform: 'none', letterSpacing: 0 },
  noteInput: {
    borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular',
    minHeight: 80, textAlignVertical: 'top', marginBottom: 20,
  },
  actions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  submitBtn: {
    flex: 2, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

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

  // Three-dot menu state — isBlocked is initialised from the API response
  const [menuVisible, setMenuVisible] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);

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
      setIsBlocked((data as any).isBlocked ?? false);
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

  const handleBlock = () => {
    setMenuVisible(false);
    const actionLabel = isBlocked ? 'Unblock' : 'Block';
    Alert.alert(
      `${actionLabel} @${username}`,
      isBlocked
        ? `Unblock @${username}? They will be able to appear in your search results and community feed again.`
        : `Block @${username}? They won't appear in your search results, community feed, or event matches.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionLabel,
          style: 'destructive',
          onPress: async () => {
            setBlockLoading(true);
            try {
              if (isBlocked) {
                await unblockCollector(username!);
                setIsBlocked(false);
              } else {
                await blockCollector(username!);
                setIsBlocked(true);
              }
            } catch {
              Alert.alert('Error', `Failed to ${actionLabel.toLowerCase()} this collector.`);
            } finally {
              setBlockLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleReport = () => {
    setMenuVisible(false);
    setTimeout(() => setReportVisible(true), 300);
  };

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: topPad + 8 }]}>
        <Header username={username ?? ''} isAuthenticated={isAuthenticated} isOwnProfile={false} showMenu={false} onMenuPress={() => {}} />
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      </View>
    );
  }

  if (error || !collector) {
    return (
      <View style={[styles.screen, { paddingTop: topPad + 8 }]}>
        <Header username={username ?? ''} isAuthenticated={isAuthenticated} isOwnProfile={false} showMenu={false} onMenuPress={() => {}} />
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
        <Header
          username={username ?? ''}
          isAuthenticated={isAuthenticated}
          isOwnProfile={isOwnProfile}
          showMenu={!isOwnProfile && isAuthenticated}
          onMenuPress={() => setMenuVisible(true)}
        />
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

        {/* Three-dot menu modal */}
        {menuVisible && (
          <ThreeDotMenu
            username={collector.username}
            displayName={collector.displayName}
            isBlocked={isBlocked}
            blockLoading={blockLoading}
            onBlock={handleBlock}
            onReport={handleReport}
            onClose={() => setMenuVisible(false)}
          />
        )}
        <ReportModal
          visible={reportVisible}
          username={collector.username}
          displayName={collector.displayName}
          onClose={() => setReportVisible(false)}
        />
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
      <Header
        username={username ?? ''}
        isAuthenticated={isAuthenticated}
        isOwnProfile={isOwnProfile}
        showMenu={!isOwnProfile && isAuthenticated}
        onMenuPress={() => setMenuVisible(true)}
      />

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

      {/* Three-dot menu modal */}
      {menuVisible && (
        <ThreeDotMenu
          username={collector.username}
          displayName={collector.displayName}
          isBlocked={isBlocked}
          blockLoading={blockLoading}
          onBlock={handleBlock}
          onReport={handleReport}
          onClose={() => setMenuVisible(false)}
        />
      )}

      <ReportModal
        visible={reportVisible}
        username={collector.username}
        displayName={collector.displayName}
        onClose={() => setReportVisible(false)}
      />
    </ScrollView>
  );
}

// ── Three-dot context menu ────────────────────────────────────────────────────

function ThreeDotMenu({
  username,
  displayName,
  isBlocked,
  blockLoading,
  onBlock,
  onReport,
  onClose,
}: {
  username: string;
  displayName: string;
  isBlocked: boolean;
  blockLoading: boolean;
  onBlock: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={menuStyles.overlay}>
        <Pressable style={menuStyles.backdrop} onPress={onClose} />
        <View style={[menuStyles.menu, { backgroundColor: C.card }]}>
          <Text style={menuStyles.menuTitle}>@{username}</Text>

          <Pressable
            onPress={onBlock}
            disabled={blockLoading}
            style={({ pressed }) => [
              menuStyles.menuItem,
              menuStyles.menuBorder,
              { backgroundColor: pressed ? C.muted : 'transparent' },
            ]}
          >
            {blockLoading ? (
              <ActivityIndicator size="small" color={C.destructive} />
            ) : (
              <Feather name={isBlocked ? 'user-check' : 'user-x'} size={18} color={C.destructive} />
            )}
            <Text style={[menuStyles.menuItemText, { color: C.destructive }]}>
              {isBlocked ? `Unblock @${username}` : `Block @${username}`}
            </Text>
          </Pressable>

          <Pressable
            onPress={onReport}
            style={({ pressed }) => [
              menuStyles.menuItem,
              { backgroundColor: pressed ? C.muted : 'transparent' },
            ]}
          >
            <Feather name="flag" size={18} color={C.destructive} />
            <Text style={[menuStyles.menuItemText, { color: C.destructive }]}>
              Report @{username}
            </Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              menuStyles.cancelItem,
              { backgroundColor: pressed ? C.muted : `${C.muted}88` },
            ]}
          >
            <Text style={menuStyles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const menuStyles = StyleSheet.create({
  overlay: {
    flex: 1, justifyContent: 'flex-end', padding: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  menu: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 8,
  },
  menuTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground,
    textAlign: 'center', paddingVertical: 14, paddingHorizontal: 20,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, paddingHorizontal: 20,
  },
  menuBorder: { borderTopWidth: 1, borderTopColor: C.border },
  menuItemText: { fontSize: 16, fontFamily: 'Inter_500Medium' },
  cancelItem: {
    alignItems: 'center', paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  cancelText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});

// ── Shared sub-components ─────────────────────────────────────────────────────

function Header({
  isAuthenticated,
  isOwnProfile,
  showMenu,
  onMenuPress,
}: {
  username: string;
  isAuthenticated: boolean;
  isOwnProfile: boolean;
  showMenu: boolean;
  onMenuPress: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={20} color={C.foreground} />
      </Pressable>
      <Text style={styles.headerTitle}>Collector Profile</Text>
      {showMenu ? (
        <Pressable onPress={onMenuPress} style={styles.menuBtn}>
          <Feather name="more-horizontal" size={20} color={C.foreground} />
        </Pressable>
      ) : (
        <View style={{ width: 40 }} />
      )}
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
  menuBtn: {
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
    lineHeight: 19,
  },
});
