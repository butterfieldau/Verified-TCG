/**
 * Event Profile Screen
 *
 * Displays a matched collector's public event profile including:
 * - Display name, username, and avatar
 * - Matched cards (what they have that you want, and vice versa)
 * - Match score (Pro-gated numeric %)
 * - QR code button that links to their public profile URL
 */

import React, { useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { resolveApiOrigin } from '@/services/apiClient';

const C = colors.dark;

interface MatchedCard {
  cardId: string;
  name: string;
  set: string;
  grade: string;
}

// Stable avatar colors based on username char code sum
function avatarColor(username: string): string {
  const colors = ['#3B82F6', '#8B5CF6', '#22C55E', '#F59E0B', '#E63946', '#06B6D4'];
  let sum = 0;
  for (let i = 0; i < username.length; i++) sum += username.charCodeAt(i);
  return colors[sum % colors.length];
}

function getPublicProfileUrl(username: string): string {
  const base = resolveApiOrigin() || 'https://verifiedtcg.co';
  return `${base}/profile/${username}`;
}

function getQrImageUrl(url: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}&color=FFFFFF&bgcolor=1A1A2E&qzone=1`;
}

export default function EventProfileScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { subscriptionTier } = useApp();
  const isPro = subscriptionTier === 'pro';

  const params = useLocalSearchParams<{
    userId: string;
    displayName: string;
    username: string;
    matchScore: string;
    theyHave: string;
    youHave: string;
  }>();

  const { displayName = 'Collector', username = 'collector', matchScore = '0' } = params;
  const score = parseInt(matchScore, 10) || 0;

  const theyHave: MatchedCard[] = (() => {
    try { return JSON.parse(params.theyHave ?? '[]'); } catch { return []; }
  })();

  const youHave: MatchedCard[] = (() => {
    try { return JSON.parse(params.youHave ?? '[]'); } catch { return []; }
  })();

  const initials = displayName.substring(0, 2).toUpperCase();
  const color = avatarColor(username);
  const profileUrl = getPublicProfileUrl(username);
  const qrImageUrl = getQrImageUrl(profileUrl);

  const [qrModalOpen, setQrModalOpen] = useState(false);

  const handleShareProfile = async () => {
    try {
      await Share.share({
        message: `Check out @${username}'s TCG profile: ${profileUrl}`,
        url: profileUrl,
      });
    } catch {}
  };

  const matchColor = (pct: number) =>
    pct >= 80 ? '#22C55E' : pct >= 60 ? '#F59E0B' : '#3B82F6';

  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Event Profile</Text>
        <Pressable onPress={() => setQrModalOpen(true)} style={styles.qrBtn}>
          <Feather name="maximize" size={20} color={C.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={[styles.profileCard, { backgroundColor: C.card }]}>
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={[styles.username, { color: C.mutedForeground }]}>@{username}</Text>

          {/* Match score */}
          {isPro ? (
            <View style={[styles.matchBadge, { backgroundColor: `${matchColor(score)}22`, borderColor: `${matchColor(score)}44` }]}>
              <View style={[styles.matchDot, { backgroundColor: matchColor(score) }]} />
              <Text style={[styles.matchBadgeText, { color: matchColor(score) }]}>{score}% Match</Text>
            </View>
          ) : (
            <View style={[styles.matchBadge, { backgroundColor: `${C.primary}22`, borderColor: `${C.primary}44` }]}>
              <Feather name="repeat" size={11} color={C.primary} />
              <Text style={[styles.matchBadgeText, { color: C.primary }]}>Trade Match</Text>
            </View>
          )}

          <View style={styles.profileActions}>
            <Pressable
              onPress={handleShareProfile}
              style={[styles.actionBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}
            >
              <Feather name="share-2" size={14} color={C.primary} />
              <Text style={[styles.actionBtnText, { color: C.primary }]}>Share</Text>
            </Pressable>
            <Pressable
              onPress={() => setQrModalOpen(true)}
              style={[styles.actionBtn, { backgroundColor: `${C.primary}18`, borderColor: `${C.primary}33` }]}
            >
              <Feather name="maximize" size={14} color={C.primary} />
              <Text style={[styles.actionBtnText, { color: C.primary }]}>QR Profile</Text>
            </Pressable>
          </View>
        </View>

        {/* What they have that you want */}
        {theyHave.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>They Have — You Want</Text>
            <View style={[styles.cardsSection, { backgroundColor: C.card }]}>
              {theyHave.map((card, i) => (
                <View
                  key={card.cardId + i}
                  style={[styles.cardRow, i > 0 && { borderTopColor: C.border, borderTopWidth: 1 }]}
                >
                  <View style={[styles.cardThumb, { backgroundColor: '#22C55E' }]}>
                    <Text style={styles.cardThumbText}>{card.name[0]}</Text>
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardName}>{card.name}</Text>
                    {card.set ? <Text style={styles.cardMeta}>{card.set}</Text> : null}
                    <View style={[styles.gradePill, { backgroundColor: `${C.positive}18` }]}>
                      <Text style={[styles.gradePillText, { color: C.positive }]}>{card.grade}</Text>
                    </View>
                  </View>
                  <View style={[styles.wantTag, { backgroundColor: `${C.positive}18` }]}>
                    <Feather name="heart" size={10} color={C.positive} />
                    <Text style={[styles.wantTagText, { color: C.positive }]}>Want</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* What you have that they want */}
        {youHave.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>You Have — They Want</Text>
            <View style={[styles.cardsSection, { backgroundColor: C.card }]}>
              {youHave.map((card, i) => (
                <View
                  key={card.cardId + i}
                  style={[styles.cardRow, i > 0 && { borderTopColor: C.border, borderTopWidth: 1 }]}
                >
                  <View style={[styles.cardThumb, { backgroundColor: C.primary }]}>
                    <Text style={styles.cardThumbText}>{card.name[0]}</Text>
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardName}>{card.name}</Text>
                    {card.set ? <Text style={styles.cardMeta}>{card.set}</Text> : null}
                    <View style={[styles.gradePill, { backgroundColor: `${C.primary}18` }]}>
                      <Text style={[styles.gradePillText, { color: C.primary }]}>{card.grade}</Text>
                    </View>
                  </View>
                  <View style={[styles.wantTag, { backgroundColor: `${C.primary}18` }]}>
                    <Feather name="tag" size={10} color={C.primary} />
                    <Text style={[styles.wantTagText, { color: C.primary }]}>Trade</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {theyHave.length === 0 && youHave.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: C.card }]}>
            <Feather name="info" size={20} color={C.mutedForeground} />
            <Text style={styles.emptyText}>
              Card details are loaded from event match data. Tap Back and select a match to see specifics.
            </Text>
          </View>
        )}

        {/* Pro gate */}
        {!isPro && (
          <Pressable
            onPress={() => router.push('/pro-subscription' as any)}
            style={[styles.proGateCard, { backgroundColor: C.card, borderColor: `${C.primary}44` }]}
          >
            <View style={[styles.proGateIcon, { backgroundColor: `${C.primary}18` }]}>
              <Feather name="zap" size={18} color={C.primary} />
            </View>
            <Text style={[styles.proGateTitle, { color: C.foreground }]}>Unlock Match Score</Text>
            <Text style={[styles.proGateDesc, { color: C.mutedForeground }]}>
              Pro shows the exact match percentage and value analysis for every potential trade.
            </Text>
            <View style={[styles.proGateCta, { backgroundColor: C.primary }]}>
              <Text style={styles.proGateCtaText}>Upgrade to Pro</Text>
            </View>
          </Pressable>
        )}

        {/* Action footer */}
        <Pressable
          onPress={() => router.push('/trade-match' as any)}
          style={[styles.buildTradeBtn, { backgroundColor: C.primary }]}
        >
          <Feather name="repeat" size={16} color="#FFF" />
          <Text style={styles.buildTradeBtnText}>View All Trade Matches</Text>
        </Pressable>
      </ScrollView>

      {/* QR Profile Modal */}
      <Modal
        visible={qrModalOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setQrModalOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setQrModalOpen(false)}
        >
          <Pressable style={[styles.qrModal, { backgroundColor: C.card }]} onPress={() => {}}>
            <Text style={styles.qrModalTitle}>@{username}</Text>
            <Text style={[styles.qrModalSub, { color: C.mutedForeground }]}>Public Event Profile</Text>

            <View style={[styles.qrImageWrap, { backgroundColor: '#1A1A2E' }]}>
              <Image
                source={{ uri: qrImageUrl }}
                style={styles.qrImage}
                resizeMode="contain"
                accessible
                accessibilityLabel={`QR code for @${username}'s profile`}
              />
            </View>

            <Text style={[styles.qrUrl, { color: C.mutedForeground }]} numberOfLines={1}>
              {profileUrl}
            </Text>

            <View style={styles.qrActions}>
              <Pressable
                onPress={handleShareProfile}
                style={[styles.qrShareBtn, { backgroundColor: C.primary }]}
              >
                <Feather name="share-2" size={14} color="#FFF" />
                <Text style={styles.qrShareBtnText}>Share Profile</Text>
              </Pressable>
              <Pressable
                onPress={() => setQrModalOpen(false)}
                style={[styles.qrCloseBtn, { backgroundColor: C.muted, borderColor: C.border }]}
              >
                <Text style={[styles.qrCloseBtnText, { color: C.mutedForeground }]}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  qrBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
  },

  content: { padding: 16, gap: 16 },

  profileCard: {
    borderRadius: 20, padding: 20, alignItems: 'center', gap: 8,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  avatarText: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: '#FFF' },
  displayName: { fontSize: 22, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  username: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  matchBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, marginTop: 4,
  },
  matchDot: { width: 6, height: 6, borderRadius: 3 },
  matchBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  profileActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1,
  },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6,
  },

  cardsSection: { borderRadius: 16, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  cardThumb: {
    width: 40, height: 40, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  cardThumbText: { fontSize: 18, fontFamily: 'Rajdhani_700Bold', color: '#FFF' },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  gradePill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  wantTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8,
  },
  wantTagText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },

  emptyCard: {
    borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  emptyText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  proGateCard: {
    borderRadius: 18, padding: 18, borderWidth: 1.5, alignItems: 'center', gap: 10,
  },
  proGateIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  proGateTitle: { fontSize: 16, fontFamily: 'Rajdhani_700Bold' },
  proGateDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  proGateCta: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 4,
  },
  proGateCtaText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },

  buildTradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 16, paddingVertical: 14,
  },
  buildTradeBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },

  // QR Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center',
  },
  qrModal: {
    width: '85%', borderRadius: 24, padding: 24, alignItems: 'center', gap: 12,
  },
  qrModalTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  qrModalSub: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  qrImageWrap: {
    width: 220, height: 220, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginVertical: 8, overflow: 'hidden',
  },
  qrImage: { width: 220, height: 220 },
  qrUrl: { fontSize: 11, fontFamily: 'Inter_400Regular', maxWidth: '90%' },
  qrActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  qrShareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 12,
  },
  qrShareBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFF' },
  qrCloseBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  qrCloseBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
