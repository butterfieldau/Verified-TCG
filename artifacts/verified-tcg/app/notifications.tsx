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

const C = colors.dark;

type NotifType = 'price_alert' | 'trade_offer' | 'watchlist' | 'market' | 'verification' | 'system';

interface MockNotif {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  isRead: boolean;
  time: string;
  actionLabel?: string;
}

const MOCK_NOTIFICATIONS: MockNotif[] = [
  {
    id: 'n-001',
    type: 'price_alert',
    title: 'Price Alert — Umbreon ex',
    body: 'Umbreon ex (Prismatic Evolutions) has increased 8.4% in the past 24 hours. Current estimated value: $1,285 AUD.',
    isRead: false,
    time: '2m ago',
    actionLabel: 'View Card',
  },
  {
    id: 'n-002',
    type: 'trade_offer',
    title: 'New Trade Offer',
    body: '@cardvault_au sent you a trade offer: Pikachu ex TAG 10 for your Charizard ex PSA 10.',
    isRead: false,
    time: '14m ago',
    actionLabel: 'View Offer',
  },
  {
    id: 'n-003',
    type: 'watchlist',
    title: 'Watchlist — Card Listed',
    body: 'A Charizard ex (Obsidian Flames) PSA 10 was just listed for $550 AUD — close to your target of $500.',
    isRead: false,
    time: '1h ago',
    actionLabel: 'View Listing',
  },
  {
    id: 'n-004',
    type: 'market',
    title: 'Recent Sale Recorded',
    body: 'A Pikachu ex (SV: 151) sold for $248 AUD — 6.2% below the last recorded sale price.',
    isRead: true,
    time: '3h ago',
  },
  {
    id: 'n-005',
    type: 'verification',
    title: 'Seller Verification Approved',
    body: 'Your Verified Seller application has been reviewed. Your account has been granted Verified Seller status.',
    isRead: true,
    time: '2d ago',
  },
  {
    id: 'n-006',
    type: 'price_alert',
    title: 'Price Alert — Pikachu ex',
    body: 'Pikachu ex (SV: 151) has dropped 3.1% this week. Current estimated value: $248 AUD.',
    isRead: true,
    time: '2d ago',
    actionLabel: 'View Card',
  },
  {
    id: 'n-007',
    type: 'system',
    title: 'Welcome to Verified TCG',
    body: 'Your account is set up and ready to go. Start by scanning your first card or browsing the market.',
    isRead: true,
    time: '7d ago',
  },
];

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
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [filter, setFilter] = useState<NotifType | 'all'>('all');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.type === filter);

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  }

  function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
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
                onPress={() => markRead(notif.id)}
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
