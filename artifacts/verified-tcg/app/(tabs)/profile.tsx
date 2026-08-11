import React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { getWatchlist } from '@/services/profile';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { StatusBadge } from '@/components/ui/Badge';
import colors from '@/constants/colors';
import { TCG_LIST } from '@/types';

const C = colors.dark;

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={statStyles.block}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  block: { alignItems: 'center', gap: 2 },
  value: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  label: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground, letterSpacing: 0.5, textTransform: 'uppercase' },
});

const MENU_ITEMS = [
  { icon: 'bell', label: 'Notifications', badge: '3', route: null },
  { icon: 'star', label: 'Watchlist', route: null },
  { icon: 'package', label: 'My Listings', route: null },
  { icon: 'repeat', label: 'Trade Offers', route: null },
  { icon: 'shield', label: 'Verification History', route: null },
  { icon: 'credit-card', label: 'Payment Methods', route: null },
  { icon: 'settings', label: 'Settings', route: '/settings' },
  { icon: 'help-circle', label: 'Help & Support', route: null },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useApp();
  const watchlist = getWatchlist();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const TAB_H = Platform.OS === 'web' ? 84 : 74;

  const tcgNames = (user?.tcgPreferences ?? [])
    .map(id => TCG_LIST.find(t => t.id === id)?.shortName ?? id)
    .join(' · ');

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: TAB_H + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <Pressable style={styles.editBtn}>
          <Feather name="edit-2" size={17} color={C.foreground} />
        </Pressable>
      </View>

      {/* Profile card */}
      <View style={[styles.profileCard, { backgroundColor: C.card }]}>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.displayName?.[0] ?? 'U'}</Text>
          </View>
          <View style={styles.nameBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>{user?.displayName}</Text>
              {user?.isVerifiedSeller && (
                <StatusBadge label="Verified Seller" color={C.verifiedBadge} variant="subtle" />
              )}
            </View>
            <Text style={styles.username}>@{user?.username}</Text>
            <Text style={styles.location}>
              <Feather name="map-pin" size={11} color={C.mutedForeground} />{' '}
              {user?.location}
            </Text>
          </View>
        </View>

        {user?.bio && (
          <Text style={styles.bio}>{user.bio}</Text>
        )}

        <Text style={styles.tcgPref}>{tcgNames}</Text>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBlock label="Cards" value={user?.stats.collectionCount ?? 0} />
          <View style={styles.statDivider} />
          <StatBlock label="Value" value={`$${((user?.stats.collectionValue ?? 0) / 1000).toFixed(1)}k`} />
          <View style={styles.statDivider} />
          <StatBlock label="Trades" value={user?.stats.tradesCount ?? 0} />
          <View style={styles.statDivider} />
          <StatBlock label="Rating" value={user?.stats.rating?.toFixed(1) ?? '—'} />
        </View>
      </View>

      {/* Watchlist preview */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Watchlist</Text>
          <Pressable>
            <Text style={styles.seeAll}>See all ({watchlist.length})</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
          {watchlist.map(w => (
            <Pressable key={w.id} style={{ gap: 8 }}>
              <CardThumbnail card={w.card} compact />
              <View>
                <Text style={styles.watchName} numberOfLines={1}>{w.card.name}</Text>
                {w.targetPrice && (
                  <Text style={styles.watchTarget}>Target: ${w.targetPrice.toLocaleString()}</Text>
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Menu */}
      <View style={styles.section}>
        <View style={[styles.menuCard, { backgroundColor: C.card }]}>
          {MENU_ITEMS.map((item, idx) => (
            <Pressable
              key={item.label}
              onPress={() => { if (item.route) router.push(item.route as any); }}
              style={({ pressed }) => [
                styles.menuRow,
                idx < MENU_ITEMS.length - 1 ? styles.menuDivider : null,
                { backgroundColor: pressed ? C.muted : 'transparent', borderColor: C.border },
              ]}
            >
              <View style={[styles.menuIcon, { backgroundColor: C.muted }]}>
                <Feather name={item.icon as any} size={16} color={C.foreground} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              {item.badge && (
                <View style={styles.menuBadge}>
                  <Text style={styles.menuBadgeText}>{item.badge}</Text>
                </View>
              )}
              <Feather name="chevron-right" size={16} color={C.mutedForeground} style={styles.menuChevron} />
            </Pressable>
          ))}
        </View>
      </View>

      {/* Sign out */}
      <Pressable
        onPress={() => { signOut(); router.replace('/welcome'); }}
        style={[styles.signOutBtn, { backgroundColor: C.card, borderColor: `${C.destructive}44` }]}
      >
        <Feather name="log-out" size={16} color={C.destructive} />
        <Text style={[styles.signOutText, { color: C.destructive }]}>Sign Out</Text>
      </Pressable>

      <Text style={styles.versionText}>Verified TCG v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  title: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  editBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: { borderRadius: 16, padding: 18, marginBottom: 24 },
  avatarRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  nameBlock: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  displayName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  username: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  location: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  bio: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 20,
    marginBottom: 12,
  },
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
  },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.foreground },
  seeAll: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  watchName: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground, width: 110 },
  watchTarget: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.primary, marginTop: 2 },
  menuCard: { borderRadius: 16, overflow: 'hidden' },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
  },
  menuDivider: { borderBottomWidth: 1 },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground },
  menuBadge: {
    backgroundColor: C.primary,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: 'center',
  },
  menuBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  menuChevron: {},
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  signOutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  versionText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
    marginBottom: 8,
  },
});
