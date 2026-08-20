import React, { useState, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import type { NotifType, CollectorAnnouncement } from '@/services/notifications';
import { fetchNotifications, fetchCollectorAnnouncements } from '@/services/notifications';
import type { Notification } from '@/services/notifications';

const C = colors.dark;

function relativeAnnouncementTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// All types that can appear from the server + client-generated aliases
type FilterType = NotifType | 'all';

function notifIcon(type: string): { name: keyof typeof Feather.glyphMap; color: string; bg: string } {
  switch (type) {
    case 'price_alert':  return { name: 'trending-up', color: C.positive,  bg: `${C.positive}22` };
    case 'trade_match':  return { name: 'repeat',       color: C.warning,   bg: `${C.warning}22` };
    case 'follower':     return { name: 'user-plus',    color: '#3B82F6',   bg: '#3B82F622' };
    case 'community':   return { name: 'heart',         color: C.primary,   bg: `${C.primary}22` };
    case 'system':       return { name: 'info',          color: C.mutedForeground, bg: C.muted };
    // Legacy client-generated types (graceful fallback)
    case 'trade_offer':  return { name: 'repeat',       color: C.warning,   bg: `${C.warning}22` };
    case 'watchlist':    return { name: 'eye',           color: '#3B82F6',   bg: '#3B82F622' };
    case 'market':       return { name: 'bar-chart-2',  color: C.mutedForeground, bg: C.muted };
    case 'verification': return { name: 'shield',        color: C.positive,  bg: `${C.positive}22` };
    default:             return { name: 'bell',          color: C.mutedForeground, bg: C.muted };
  }
}

const FILTERS: { label: string; value: FilterType }[] = [
  { label: 'All',      value: 'all' },
  { label: 'Prices',   value: 'price_alert' },
  { label: 'Trades',   value: 'trade_match' },
  { label: 'Followers',value: 'follower' },
  { label: 'Community',value: 'community' },
  { label: 'System',   value: 'system' },
];

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const {
    notifications,
    unreadNotificationCount,
    notificationsHasMore: initialHasMore,
    markNotificationRead,
    markAllNotificationsRead,
    refreshNotifications,
    isAuthenticated,
  } = useApp();

  const [filter, setFilter] = useState<FilterType>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [extraNotifications, setExtraNotifications] = useState<Notification[]>([]);

  // ── In-app announcements ─────────────────────────────────────────────────
  const [announcements, setAnnouncements] = useState<CollectorAnnouncement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async () => {
    if (!isAuthenticated) return;
    setAnnouncementsLoading(true);
    setAnnouncementsError(null);
    try {
      const resp = await fetchCollectorAnnouncements();
      setAnnouncements(resp.announcements);
    } catch {
      setAnnouncementsError('Announcements could not be loaded.');
    } finally {
      setAnnouncementsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadAnnouncements();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Sync hasMore when context updates (e.g. after first-page load completes)
  React.useEffect(() => {
    setHasMore(initialHasMore);
  }, [initialHasMore]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // Merge base notifications (from context) + extra pages loaded locally
  const allNotifications = React.useMemo(() => {
    const ids = new Set(notifications.map(n => n.id));
    const deduped = extraNotifications.filter(n => !ids.has(n.id));
    return [...notifications, ...deduped];
  }, [notifications, extraNotifications]);

  const filtered = filter === 'all'
    ? allNotifications
    : allNotifications.filter(n => n.type === filter);

  const unreadCount = unreadNotificationCount;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setExtraNotifications([]);
    setPage(1);
    setHasMore(false);
    await Promise.all([refreshNotifications(), loadAnnouncements()]);
    setIsRefreshing(false);
  }, [refreshNotifications, loadAnnouncements]);

  // When context marks all read, also clear extraNotifications unread state
  const handleMarkAllRead = useCallback(() => {
    markAllNotificationsRead();
    setExtraNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  }, [markAllNotificationsRead]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !isAuthenticated) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const result = await fetchNotifications(nextPage, 20);
      if (result.notifications.length > 0) {
        setExtraNotifications(prev => [...prev, ...result.notifications]);
        setPage(nextPage);
        setHasMore(result.hasMore);
      } else {
        setHasMore(false);
      }
    } catch {
      // silently ignore
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, page, isAuthenticated]);

  function handleTap(notif: Notification) {
    // Pass notif.isRead so markNotificationRead correctly decrements
    // serverUnreadCount even for page-2+ entries not in context.notifications.
    markNotificationRead(notif.id, notif.isRead);
    // Also mark read in extraNotifications (pages 2+) which live in local state
    if (!notif.isRead) {
      setExtraNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, isRead: true } : n),
      );
    }
    if (notif.route) {
      router.push(notif.route as Parameters<typeof router.push>[0]);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 40 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={C.primary}
          colors={[C.primary]}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={2}
        >
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 && (
          <Pressable
            onPress={handleMarkAllRead}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersRow}
        contentContainerStyle={{ paddingRight: 4 }}
      >
        {FILTERS.map(f => (
          <Pressable
            key={f.value}
            onPress={() => setFilter(f.value)}
            style={[
              styles.filterChip,
              filter === f.value && { backgroundColor: '#CC1826' },
              filter !== f.value && { backgroundColor: C.card },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${f.label}`}
            accessibilityState={{ selected: filter === f.value }}
            hitSlop={{ top: 6, bottom: 6 }}
          >
            <Text style={[styles.filterText, filter === f.value && { color: '#FFFFFF' }]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Not signed in */}
      {!isAuthenticated && (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: C.card }]}>
            <Feather name="lock" size={36} color={C.mutedForeground} />
          </View>
          <Text style={styles.emptyTitle}>Sign in to see notifications</Text>
          <Text style={styles.emptyBody}>
            Create an account or sign in to receive price alerts, trade matches, and more.
          </Text>
        </View>
      )}

      {/* Empty state */}
      {isAuthenticated && filtered.length === 0 && !isRefreshing && (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: C.card }]}>
            <Feather name="bell-off" size={36} color={C.mutedForeground} />
          </View>
          <Text style={styles.emptyTitle}>No notifications</Text>
          <Text style={styles.emptyBody}>
            You're all caught up. Notifications will appear here for price alerts, trade matches, and account updates.
          </Text>
        </View>
      )}

      {/* Notification list */}
      {filtered.length > 0 && (
        <View style={styles.list}>
          {filtered.map(notif => {
            const icon = notifIcon(notif.type);
            return (
              <Pressable
                key={notif.id}
                onPress={() => handleTap(notif)}
                style={({ pressed }) => [
                  styles.notifCard,
                  {
                    backgroundColor: pressed ? C.muted : notif.isRead ? C.card : `${C.card}EE`,
                    borderLeftWidth: notif.isRead ? 0 : 3,
                    borderLeftColor: C.primary,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${notif.title}: ${notif.body}${notif.actionLabel ? `. ${notif.actionLabel}` : ''}`}
                accessibilityState={{ checked: notif.isRead }}
              >
                <View style={[styles.notifIcon, { backgroundColor: icon.bg }]}>
                  <Feather name={icon.name} size={18} color={icon.color} />
                </View>
                <View style={styles.notifBody}>
                  <View style={styles.notifTitleRow}>
                    <Text style={[
                      styles.notifTitle,
                      !notif.isRead && { fontFamily: 'Inter_700Bold' },
                    ]} numberOfLines={1}>
                      {notif.title}
                    </Text>
                    {!notif.isRead && <View style={[styles.unreadDot, { backgroundColor: C.primary }]} />}
                  </View>
                  <Text style={styles.notifText} numberOfLines={3}>{notif.body}</Text>
                  <View style={styles.notifFooter}>
                    <Text style={styles.notifTime}>{notif.time}</Text>
                    {notif.actionLabel && (
                      <Text style={[styles.notifAction, { color: C.primary }]}>
                        {notif.actionLabel} →
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* In-app Announcements */}
      {isAuthenticated && (announcements.length > 0 || announcementsLoading || announcementsError) && (
        <View style={styles.announcementsSection}>
          <View style={styles.announcementsHeader}>
            <Feather name="volume-2" size={14} color={C.mutedForeground} />
            <Text style={styles.announcementsSectionTitle}>Announcements</Text>
            {announcementsLoading && (
              <ActivityIndicator size="small" color={C.mutedForeground} style={{ marginLeft: 6 }} />
            )}
          </View>
          {announcementsError && (
            <Text style={styles.announcementsError}>{announcementsError}</Text>
          )}
          {announcements.map(a => (
            <View key={a.id} style={[styles.announcementCard, { backgroundColor: C.card }]}>
              <View style={styles.announcementTitleRow}>
                <View style={[styles.announcementIcon, { backgroundColor: `${C.primary}22` }]}>
                  <Feather name="bell" size={14} color={C.primary} />
                </View>
                <Text style={styles.announcementTitle} numberOfLines={2}>{a.title}</Text>
              </View>
              <Text style={styles.announcementContent} numberOfLines={4}>{a.content}</Text>
              <Text style={styles.announcementTime}>
                {relativeAnnouncementTime(a.publishedAt)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Load more */}
      {filtered.length > 0 && (hasMore || isLoadingMore) && (
        <Pressable
          onPress={handleLoadMore}
          disabled={isLoadingMore}
          style={[styles.loadMoreBtn, { backgroundColor: C.card }]}
          accessibilityRole="button"
          accessibilityLabel={isLoadingMore ? 'Loading more notifications' : 'Load more notifications'}
          accessibilityState={{ disabled: isLoadingMore }}
        >
          {isLoadingMore
            ? <ActivityIndicator size="small" color={C.primary} />
            : <Text style={[styles.loadMoreText, { color: C.primary }]}>Load more</Text>
          }
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  unreadBadge: {
    backgroundColor: '#CC1826',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  unreadText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  markAllText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  filtersRow: { marginBottom: 20 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginRight: 8,
  },
  filterText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 14 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  list: { gap: 8 },
  notifCard: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    overflow: 'hidden',
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notifBody: { flex: 1, gap: 6 },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  unreadDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  notifText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 19,
  },
  notifFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notifTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}88` },
  notifAction: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  loadMoreBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  announcementsSection: { marginTop: 24 },
  announcementsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  announcementsSectionTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  announcementsError: {
    color: C.negative,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginBottom: 10,
  },
  announcementCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  announcementTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  announcementIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  announcementTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    lineHeight: 19,
  },
  announcementContent: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 18,
  },
  announcementTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}88`,
  },
});
