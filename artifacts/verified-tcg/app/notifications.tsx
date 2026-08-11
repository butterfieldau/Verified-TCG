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
import { useApp } from '@/context/AppContext';
import type { NotifType } from '@/services/notifications';

const C = colors.dark;

function notifIcon(type: NotifType): { name: keyof typeof Feather.glyphMap; color: string; bg: string } {
  switch (type) {
    case 'price_alert':  return { name: 'trending-up', color: C.positive,  bg: `${C.positive}22` };
    case 'trade_offer':  return { name: 'repeat',       color: C.warning,   bg: `${C.warning}22` };
    case 'watchlist':    return { name: 'eye',           color: '#3B82F6',   bg: '#3B82F622' };
    case 'market':       return { name: 'bar-chart-2',  color: C.mutedForeground, bg: C.muted };
    case 'verification': return { name: 'shield',        color: C.positive,  bg: `${C.positive}22` };
    case 'system':       return { name: 'info',          color: C.mutedForeground, bg: C.muted };
  }
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { notifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead } = useApp();
  const [filter, setFilter] = useState<NotifType | 'all'>('all');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const unreadCount = unreadNotificationCount;

  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.type === filter);

  function markAllRead() {
    markAllNotificationsRead();
  }

  function markRead(id: string) {
    markNotificationRead(id);
  }

  const FILTERS: { label: string; value: NotifType | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Price', value: 'price_alert' },
    { label: 'Trades', value: 'trade_offer' },
    { label: 'Watchlist', value: 'watchlist' },
    { label: 'Market', value: 'market' },
    { label: 'Verified', value: 'verification' },
  ];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
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
          <Pressable onPress={markAllRead}>
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
              filter === f.value && { backgroundColor: C.primary },
              filter !== f.value && { backgroundColor: C.card },
            ]}
          >
            <Text style={[styles.filterText, filter === f.value && { color: '#FFFFFF' }]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Empty state */}
      {filtered.length === 0 && (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: C.card }]}>
            <Feather name="bell-off" size={36} color={C.mutedForeground} />
          </View>
          <Text style={styles.emptyTitle}>No notifications</Text>
          <Text style={styles.emptyBody}>
            You're all caught up. Notifications will appear here when there are price alerts, trade offers, and market updates.
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
                onPress={() => {
                  markRead(notif.id);
                  if (notif.route) {
                    router.push(notif.route as Parameters<typeof router.push>[0]);
                  }
                }}
                style={({ pressed }) => [
                  styles.notifCard,
                  {
                    backgroundColor: pressed ? C.muted : notif.isRead ? C.card : `${C.card}EE`,
                    borderLeftWidth: notif.isRead ? 0 : 3,
                    borderLeftColor: C.primary,
                  },
                ]}
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

      {filtered.length > 0 && (
        <Text style={styles.footerNote}>
          Price alerts and trade notifications require backend integration. Currently showing prototype data.
        </Text>
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
    backgroundColor: C.primary,
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
  footerNote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: `${C.mutedForeground}66`,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
});
