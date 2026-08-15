/**
 * Blocked Users screen — shows the signed-in collector's block list and lets
 * them unblock individual collectors. Accessible from Settings → Privacy.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { getBlockedUsers, unblockCollector, type BlockedUser } from '@/services/communityApi';

const C = colors.dark;

// Deterministic avatar colour from username
const AVATAR_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#84CC16',
];
function avatarColor(name: string): string {
  const code = name.charCodeAt(0) ?? 65;
  return AVATAR_COLORS[code % AVATAR_COLORS.length]!;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBlockedUsers();
      setBlocked(data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load blocked users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUnblock = (user: BlockedUser) => {
    Alert.alert(
      'Unblock Collector',
      `Unblock @${user.username}? They will be able to appear in your search results and community feed again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: async () => {
            setUnblockingId(user.userId);
            try {
              await unblockCollector(user.username);
              setBlocked(prev => prev.filter(u => u.userId !== user.userId));
            } catch {
              Alert.alert('Error', 'Failed to unblock this collector. Please try again.');
            } finally {
              setUnblockingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Blocked Users</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      )}

      {!loading && error && (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={C.mutedForeground} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={[styles.retryText, { color: C.primary }]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {!loading && !error && blocked.length === 0 && (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: C.card }]}>
            <Feather name="user-x" size={32} color={C.mutedForeground} />
          </View>
          <Text style={styles.emptyTitle}>No blocked users</Text>
          <Text style={styles.emptyBody}>
            Collectors you block will appear here. You can unblock them at any time.
          </Text>
        </View>
      )}

      {!loading && !error && blocked.length > 0 && (
        <>
          <Text style={styles.hint}>
            {blocked.length} blocked {blocked.length === 1 ? 'collector' : 'collectors'}
          </Text>
          <View style={[styles.card, { backgroundColor: C.card }]}>
            {blocked.map((user, idx) => (
              <View
                key={user.userId}
                style={[
                  styles.row,
                  idx < blocked.length - 1 && styles.rowBorder,
                ]}
              >
                {user.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: avatarColor(user.displayName) }]}>
                    <Text style={styles.avatarText}>{initials(user.displayName)}</Text>
                  </View>
                )}
                <View style={styles.nameBlock}>
                  <Text style={styles.displayName}>{user.displayName}</Text>
                  <Text style={styles.username}>@{user.username}</Text>
                </View>
                <Pressable
                  onPress={() => handleUnblock(user)}
                  disabled={unblockingId === user.userId}
                  style={({ pressed }) => [
                    styles.unblockBtn,
                    { backgroundColor: pressed ? C.muted : `${C.destructive}18`, borderColor: `${C.destructive}44` },
                  ]}
                >
                  {unblockingId === user.userId ? (
                    <ActivityIndicator size="small" color={C.destructive} />
                  ) : (
                    <Text style={[styles.unblockText, { color: C.destructive }]}>Unblock</Text>
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        </>
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
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  center: { flex: 1, alignItems: 'center', paddingTop: 64, gap: 12 },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  emptyBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, textAlign: 'center', lineHeight: 21, maxWidth: 280,
  },
  hint: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 10,
  },
  card: { borderRadius: 16, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 16, gap: 12,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  nameBlock: { flex: 1 },
  displayName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  username: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1,
    minWidth: 74, alignItems: 'center',
  },
  unblockText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
