import React from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { CardThumbnail } from '@/components/ui/CardThumbnail';
import { StatusBadge } from '@/components/ui/Badge';
import { ProBadge } from '@/components/ui/ProBadge';
import { Button } from '@/components/ui/Button';
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
  { icon: 'bell', label: 'Notifications', badge: null as string | null, route: '/notifications', dynamicBadge: true },
  { icon: 'heart', label: 'Wishlist', route: '/wishlist' },
  { icon: 'zap', label: 'Event Mode', badge: 'LIVE', route: '/event-mode', highlight: true },
  { icon: 'git-branch', label: 'Trade Matches', badge: '4', route: '/trade-match' },
  { icon: 'maximize', label: 'Trade QR', route: '/trade-qr' },
  { icon: 'package', label: 'My Listings', route: '/sell' },
  { icon: 'repeat', label: 'Trade Offers', route: '/trade' },
  { icon: 'shield', label: 'Verification', route: '/verification-info' },
  { icon: 'pie-chart', label: 'Portfolio', route: '/portfolio' },
  { icon: 'award', label: 'Pro Identity', route: '/pro-identity', proOnly: true },
  { icon: 'settings', label: 'Settings', route: '/settings' },
  { icon: 'help-circle', label: 'Help & Support', route: '/help-support' },
];

const PRO_BENEFITS_ITEMS = [
  { icon: 'gift', label: 'Verified Drops', description: 'Giveaways & exclusive drops', route: '/verified-drops' },
  { icon: 'star', label: 'Pro Perks', description: 'Partner offers & discounts', route: '/pro-perks' },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const {
    user, isAuthenticated, signOut, watchlist, collection, portfolio,
    subscriptionTier, profileTheme,
    selectedIcon, foundingMemberClaimed,
    scansUsed, scanLimit, scanResetDate,
    unreadNotificationCount,
  } = useApp();
  const isPro = subscriptionTier === 'pro';

  // Format reset date as "1 Sep", "12 Oct", etc.
  const scanResetLabel = scanResetDate.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
  const scansRemaining = Math.max(0, scanLimit - scansUsed);
  const scansExhausted = scansRemaining === 0;
  const scansLow = scansRemaining <= 3 && !scansExhausted;

  // Human-readable label for the active in-app icon selection
  const ICON_LABELS: Record<string, string> = {
    original: 'Verified Red',
    black: 'Verified Black',
    white: 'Verified White',
    gold: 'Verified Gold',
    stealth: 'Stealth',
    event: 'Event Edition',
    founding: 'Founding Member',
  };

  // Map profileTheme id → card background colour for the profile header area.
  // Intentionally kept minimal — the theme tints the profile card, not the whole screen.
  const THEME_CARD_COLORS: Record<string, string> = {
    default:         C.card,
    carbon:          '#1C1C1E',
    deep_red:        '#1A0000',
    collector_black: '#000000',
    chrome:          '#222222',
  };
  const profileCardBg = THEME_CARD_COLORS[profileTheme] ?? C.card;

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
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {isAuthenticated && user?.username && (
            <Pressable
              onPress={() => {
                const url = `https://verifiedtcg.co/c/${user.username}`;
                Share.share({
                  title: `${user.displayName ?? user.username}'s Verified TCG Profile`,
                  message: `Check out my Verified TCG profile!\n${url}`,
                  url,
                }).catch(() => {});
              }}
              style={styles.editBtn}
              accessibilityRole="button"
              accessibilityLabel="Share profile"
              hitSlop={2}
            >
              <Feather name="share-2" size={17} color={C.foreground} />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push('/edit-profile' as any)}
            style={styles.editBtn}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            hitSlop={2}
          >
            <Feather name="edit-2" size={17} color={C.foreground} />
          </Pressable>
        </View>
      </View>

      {!isAuthenticated && (
        <View style={styles.guestBanner}>
          <View style={styles.guestBannerIcon}>
            <Feather name="user-plus" size={18} color={C.primary} />
          </View>
          <View style={styles.guestBannerCopy}>
            <Text style={styles.guestBannerTitle}>You’re exploring as a guest</Text>
            <Text style={styles.guestBannerText}>Create a free account to save your profile and collection across devices.</Text>
          </View>
          <Button size="sm" onPress={() => router.push('/create-account' as any)}>Create Account</Button>
        </View>
      )}

      {/* Profile card — background tinted by the collector's chosen profile theme */}
      <View style={[styles.profileCard, { backgroundColor: profileCardBg }]}>
        <View style={styles.avatarRow}>
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.displayName?.[0] ?? 'U'}</Text>
            </View>
          )}
          <View style={styles.nameBlock}>
            <View style={styles.nameRow}>
                <Text style={styles.displayName}>{user?.displayName ?? 'Guest Collector'}</Text>
              {/* PRO badge — subscription tier indicator, distinct from Verified Seller/Account identity badges */}
              {isPro && <ProBadge />}
              {user?.isVerifiedSeller && (
                <StatusBadge label="Verified Seller" color={C.verifiedBadge} variant="subtle" />
              )}
            </View>
            <Text style={styles.username}>{user?.username ? `@${user.username}` : 'Guest mode'}</Text>
            {/* Founding Member badge — shown when Pro user has claimed their badge */}
            {isPro && foundingMemberClaimed && (
              <View style={styles.foundingRow}>
                <Feather name="award" size={11} color="#D4AF37" />
                <Text style={styles.foundingText}>Founding Member #00381</Text>
              </View>
            )}
            {/* Active in-app icon indicator — shows which icon identity is selected */}
            {isPro && selectedIcon !== 'original' && (
              <View style={styles.iconRow}>
                <Feather name="image" size={10} color={C.mutedForeground} />
                <Text style={styles.iconLabel}>{ICON_LABELS[selectedIcon] ?? selectedIcon} icon</Text>
              </View>
            )}
            <Text style={styles.location}>
              <Feather name="map-pin" size={11} color={C.mutedForeground} />{' '}
              {user?.location ?? 'Explore freely'}
            </Text>
          </View>
        </View>

        {user?.bio && (
          <Text style={styles.bio}>{user.bio}</Text>
        )}

        <Text style={styles.tcgPref}>{tcgNames}</Text>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatBlock label="Cards" value={user?.stats.collectionCount ?? collection.length} />
          <View style={styles.statDivider} />
          <StatBlock label="Value" value={`$${((user?.stats.collectionValue ?? portfolio.totalValue) / 1000).toFixed(1)}k`} />
          <View style={styles.statDivider} />
          <StatBlock label="Trades" value={user?.stats.tradesCount ?? 0} />
          <View style={styles.statDivider} />
          <StatBlock label="Rating" value={user?.stats.rating?.toFixed(1) ?? '—'} />
        </View>
      </View>

      {/* Wishlist preview */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Wishlist</Text>
          <Pressable
            onPress={() => router.push('/wishlist' as any)}
            accessibilityRole="button"
            accessibilityLabel={watchlist.length > 0 ? `See all ${watchlist.length} wishlist cards` : 'Add cards to wishlist'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.seeAll}>
              {watchlist.length > 0 ? `See all (${watchlist.length})` : 'Add cards'}
            </Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
          {watchlist.map(w => (
            <Pressable
              key={w.id}
              style={{ gap: 8 }}
              onPress={() => router.push(`/card/${w.card.id}` as any)}
              accessibilityRole="button"
              accessibilityLabel={`${w.card.name}${w.targetPrice ? `, target $${w.targetPrice.toLocaleString()}` : ''}`}
            >
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

      {/* Pro Benefits */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Pro Benefits</Text>
          {!isPro && (
            <Pressable
              onPress={() => router.push('/pro-subscription' as any)}
              accessibilityRole="button"
              accessibilityLabel="Upgrade to Pro"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAll}>Upgrade</Text>
            </Pressable>
          )}
        </View>
        <View style={[styles.menuCard, { backgroundColor: C.card }]}>
          {/* Scan quota row — Free users only */}
          {!isPro && (
            <Pressable
              onPress={() => router.push('/pro-subscription' as any)}
              style={({ pressed }) => [
                styles.menuRow,
                styles.menuDivider,
                { backgroundColor: pressed ? C.muted : 'transparent', borderColor: C.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel={scansExhausted ? 'No scans left this month — upgrade to Pro' : `Scans: ${scansUsed} of ${scanLimit} used — upgrade to Pro`}
            >
              <View style={[styles.menuIcon, {
                backgroundColor: scansExhausted
                  ? 'rgba(239,68,68,0.12)'
                  : scansLow
                  ? 'rgba(245,158,11,0.12)'
                  : C.muted,
              }]}>
                <Feather
                  name="camera"
                  size={16}
                  color={scansExhausted ? C.destructive : scansLow ? C.warning : C.foreground}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[
                  styles.menuLabel,
                  scansExhausted && { color: C.destructive },
                  scansLow && !scansExhausted && { color: C.warning },
                ]}>
                  {scansExhausted
                    ? 'No scans left this month'
                    : `Scans: ${scansUsed} / ${scanLimit} used`}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 }}>
                  {scansExhausted
                    ? `Resets ${scanResetLabel} · Upgrade for unlimited`
                    : `${scansRemaining} remaining · resets ${scanResetLabel}`}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.mutedForeground} style={styles.menuChevron} />
            </Pressable>
          )}
          {PRO_BENEFITS_ITEMS.map((item, idx) => (
            <Pressable
              key={item.label}
              onPress={() => router.push(item.route as any)}
              style={({ pressed }) => [
                styles.menuRow,
                idx < PRO_BENEFITS_ITEMS.length - 1 ? styles.menuDivider : null,
                { backgroundColor: pressed ? C.muted : 'transparent', borderColor: C.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}${!isPro ? ' — Pro feature' : ''}`}
            >
              <View style={[styles.menuIcon, { backgroundColor: `${C.primary}22` }]}>
                <Feather name={item.icon as any} size={16} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.menuLabel, { color: C.foreground }]}>{item.label}</Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 }}>
                  {item.description}
                </Text>
              </View>
              {!isPro && (
                <View style={[styles.menuBadge, { backgroundColor: C.primary }]}>
                  <Text style={styles.menuBadgeText}>PRO</Text>
                </View>
              )}
              <Feather name="chevron-right" size={16} color={C.mutedForeground} style={styles.menuChevron} />
            </Pressable>
          ))}
        </View>
      </View>

      {/* Menu */}
      <View style={styles.section}>
        <View style={[styles.menuCard, { backgroundColor: C.card }]}>
          {MENU_ITEMS.map((item, idx) => {
            // Use real unread count for the Notifications row
            const badgeValue = (item as any).dynamicBadge
              ? (unreadNotificationCount > 0 ? String(unreadNotificationCount) : null)
              : item.badge;
            return (
              <Pressable
                key={item.label}
                onPress={() => {
                  if ((item as any).proOnly && !isPro) {
                    router.push('/pro-subscription' as any);
                  } else if (item.route) {
                    router.push(item.route as any);
                  }
                }}
                style={({ pressed }) => [
                  styles.menuRow,
                  idx < MENU_ITEMS.length - 1 ? styles.menuDivider : null,
                  { backgroundColor: pressed ? C.muted : 'transparent', borderColor: C.border },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}${badgeValue ? `, ${badgeValue} unread` : ''}`}
              >
                <View style={[styles.menuIcon, { backgroundColor: (item as any).highlight ? `${C.primary}22` : C.muted }]}>
                  <Feather name={item.icon as any} size={16} color={(item as any).highlight ? C.primary : C.foreground} />
                </View>
                <Text style={[styles.menuLabel, (item as any).highlight && { color: C.primary }]}>{item.label}</Text>
                {badgeValue && (
                  <View style={[styles.menuBadge, { backgroundColor: C.primary }]}>
                    <Text style={styles.menuBadgeText}>{badgeValue}</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={16} color={C.mutedForeground} style={styles.menuChevron} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {isAuthenticated ? (
        <Pressable
          onPress={() => {
            Alert.alert(
              'Sign Out',
              'Are you sure you want to sign out?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign Out',
                  style: 'destructive',
                  onPress: () => { signOut(); router.replace('/welcome'); },
                },
              ],
            );
          }}
          style={[styles.signOutBtn, { backgroundColor: C.card, borderColor: `${C.destructive}44` }]}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Feather name="log-out" size={16} color={C.destructive} />
          <Text style={[styles.signOutText, { color: C.destructive }]}>Sign Out</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/sign-in' as any)}
          style={[styles.signOutBtn, { backgroundColor: C.card, borderColor: C.border }]}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Feather name="log-in" size={16} color={C.foreground} />
          <Text style={[styles.signOutText, { color: C.foreground }]}>Sign In</Text>
        </Pressable>
      )}

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
  guestBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: `${C.primary}12`, borderWidth: 1, borderColor: `${C.primary}33`, marginBottom: 18 },
  guestBannerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: `${C.primary}22`, alignItems: 'center', justifyContent: 'center' },
  guestBannerCopy: { flex: 1 },
  guestBannerTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 3 },
  guestBannerText: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  avatarRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 64, height: 64, borderRadius: 32 },
  avatarText: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  nameBlock: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  displayName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  username: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  location: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  foundingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  foundingText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#D4AF37' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  iconLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
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
