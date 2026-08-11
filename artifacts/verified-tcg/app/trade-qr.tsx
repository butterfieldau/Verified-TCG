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
import { getCollectorMatches } from '@/services/trade';

const C = colors.dark;

type ViewMode = 'my-qr' | 'scanned';

// Mock QR grid (visual representation)
function QRGrid() {
  return (
    <View style={styles.qrGrid}>
      {/* Corner squares */}
      <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'space-between' }]}>
        {/* Top row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={styles.cornerSquare} />
          <View style={styles.cornerSquare} />
        </View>
        {/* Bottom row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={styles.cornerSquare} />
          <View style={{ width: 48, height: 48 }} />
        </View>
      </View>
      {/* Inner dots pattern */}
      <View style={styles.qrInner}>
        {Array.from({ length: 7 }).map((_, row) => (
          <View key={row} style={styles.qrRow}>
            {Array.from({ length: 7 }).map((_, col) => {
              const filled = (row + col * 2 + row * col) % 3 === 0;
              return (
                <View
                  key={col}
                  style={[styles.qrDot, { backgroundColor: filled ? '#FFFFFF' : 'transparent' }]}
                />
              );
            })}
          </View>
        ))}
      </View>
      {/* Logo overlay */}
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={[styles.qrLogo, { backgroundColor: C.background }]}>
          <View style={[styles.qrLogoInner, { backgroundColor: C.primary }]}>
            <Text style={styles.qrLogoText}>V</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const COLLECTOR_MATCHES = getCollectorMatches();

export default function TradeQRScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [mode, setMode] = useState<ViewMode>('my-qr');
  const [scannedAction, setScannedAction] = useState<string | null>(null);

  if (mode === 'scanned') {
    return (
      <View style={[styles.screen, { backgroundColor: C.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <Pressable onPress={() => { setMode('my-qr'); setScannedAction(null); }} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={C.foreground} />
          </Pressable>
          <Text style={styles.title}>Scanned Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scannedContent} showsVerticalScrollIndicator={false}>
          {/* Collector identity */}
          <View style={[styles.collectorCard, { backgroundColor: C.card }]}>
            <View style={[styles.collectorAvatar, { backgroundColor: '#3B82F6' }]}>
              <Text style={styles.collectorAvatarText}>CS</Text>
            </View>
            <View style={styles.collectorInfo}>
              <View style={styles.tradingWith}>
                <Text style={styles.tradingWithLabel}>You're trading with</Text>
              </View>
              <Text style={styles.collectorHandle}>@cardvaultsydney</Text>
              <View style={styles.verRow}>
                <Feather name="check-circle" size={12} color={C.positive} />
                <Text style={[styles.verLabel, { color: C.positive }]}>Verified Collector</Text>
                <Text style={styles.verSep}>·</Text>
                <Feather name="star" size={11} color={C.warning} />
                <Text style={styles.ratingLabel}>4.9</Text>
              </View>
            </View>
          </View>

          {/* Match highlight */}
          <View style={[styles.matchHighlight, { backgroundColor: `${C.positive}18`, borderColor: `${C.positive}44` }]}>
            <Feather name="zap" size={14} color={C.positive} />
            <Text style={[styles.matchHighlightText, { color: C.positive }]}>
              92% Trade Match · 3 wishlist overlaps found
            </Text>
          </View>

          {/* Action buttons */}
          {scannedAction ? (
            <View style={[styles.actionResult, { backgroundColor: C.card }]}>
              <Feather name="check-circle" size={24} color={C.positive} />
              <Text style={styles.actionResultTitle}>{scannedAction}</Text>
              <Text style={styles.actionResultSub}>Opening collector profile...</Text>
            </View>
          ) : (
            <View style={styles.actionGrid}>
              {[
                { icon: 'heart', label: 'View Wishlist Matches', action: 'Viewing wishlist matches' },
                { icon: 'repeat', label: 'View For Trade', action: 'Viewing trade items' },
                { icon: 'tag', label: 'View For Sale', action: 'Viewing for sale items' },
                { icon: 'zap', label: 'Start Trade', action: 'Starting trade offer' },
              ].map(btn => (
                <Pressable
                  key={btn.action}
                  onPress={() => {
                    setScannedAction(btn.action);
                    setTimeout(() => router.push('/trade-match' as any), 1200);
                  }}
                  style={[styles.actionBtn, { backgroundColor: btn.label === 'Start Trade' ? C.primary : C.card }]}
                >
                  <Feather name={btn.icon as any} size={18} color={btn.label === 'Start Trade' ? '#FFF' : C.foreground} />
                  <Text style={[styles.actionBtnText, { color: btn.label === 'Start Trade' ? '#FFF' : C.foreground }]}>
                    {btn.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Matching cards preview */}
          <Text style={styles.sectionLabel}>WISHLIST MATCHES</Text>
          {COLLECTOR_MATCHES.map(match => (
            <View key={match.id} style={[styles.matchCard, { backgroundColor: C.card }]}>
              <View style={[styles.matchThumb, { backgroundColor: match.color }]}>
                <Text style={styles.matchInitial}>{match.cardName[0]}</Text>
              </View>
              <View style={styles.matchInfo}>
                <Text style={styles.matchName}>{match.cardName}</Text>
                <View style={[styles.gradePill, { backgroundColor: C.muted }]}>
                  <Text style={styles.gradePillText}>{match.grade}</Text>
                </View>
              </View>
              <View style={styles.matchRight}>
                <Text style={styles.matchValue}>${match.value.toLocaleString('en-AU')}</Text>
                <View style={[styles.typePill, {
                  backgroundColor: match.type === 'wishlist' ? `${C.primary}22`
                    : match.type === 'for_trade' ? `${C.positive}22`
                    : `${C.warning}22`,
                }]}>
                  <Text style={[styles.typePillText, {
                    color: match.type === 'wishlist' ? C.primary
                      : match.type === 'for_trade' ? C.positive
                      : C.warning,
                  }]}>
                    {match.type === 'wishlist' ? 'Wishlist' : match.type === 'for_trade' ? 'For Trade' : 'For Sale'}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── MY QR CODE ──────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Trade QR</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.myQrContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.myQrSubtitle}>
          Share your collector QR code so others can scan and start a trade instantly.
        </Text>

        {/* QR card */}
        <View style={[styles.qrCard, { backgroundColor: C.card }]}>
          <QRGrid />
          <Text style={styles.qrHandle}>@omar_tcg</Text>
          <Text style={styles.qrName}>Omar · Verified Collector</Text>
          <View style={[styles.verifiedRow, { backgroundColor: `${C.positive}22` }]}>
            <Feather name="check-circle" size={12} color={C.positive} />
            <Text style={[styles.verifiedText, { color: C.positive }]}>Verified TCG Profile</Text>
          </View>
        </View>

        {/* My stats */}
        <View style={[styles.statsCard, { backgroundColor: C.card }]}>
          <View style={styles.statRow}>
            <Feather name="layers" size={14} color={C.mutedForeground} />
            <Text style={styles.statText}>127 public cards in collection</Text>
          </View>
          <View style={styles.statRow}>
            <Feather name="heart" size={14} color={C.mutedForeground} />
            <Text style={styles.statText}>18 cards on wishlist</Text>
          </View>
          <View style={styles.statRow}>
            <Feather name="repeat" size={14} color={C.mutedForeground} />
            <Text style={styles.statText}>4 cards available for trade</Text>
          </View>
        </View>

        {/* Simulate scan button */}
        <Pressable
          onPress={() => setMode('scanned')}
          style={[styles.simulateBtn, { backgroundColor: C.muted }]}
        >
          <Feather name="camera" size={16} color={C.foreground} />
          <Text style={styles.simulateBtnText}>Simulate Scanning Another QR</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          When someone scans your QR, they see your public profile, available cards for trade/sale, and any wishlist matches. No personal information is shared without your consent.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.2 },
  myQrContent: { paddingHorizontal: 20, paddingBottom: 48, gap: 16, alignItems: 'center' },
  myQrSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'center', lineHeight: 20 },
  qrCard: { borderRadius: 24, padding: 24, alignItems: 'center', gap: 14, width: '100%', maxWidth: 320 },
  qrGrid: { width: 200, height: 200, backgroundColor: '#111', borderRadius: 12, overflow: 'hidden', padding: 14 },
  cornerSquare: { width: 48, height: 48, borderRadius: 8, borderWidth: 4, borderColor: '#FFFFFF', backgroundColor: 'transparent' },
  qrInner: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 4 },
  qrRow: { flexDirection: 'row', gap: 4 },
  qrDot: { width: 10, height: 10, borderRadius: 2 },
  qrLogo: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', padding: 4 },
  qrLogoInner: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  qrLogoText: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: '#FFF' },
  qrHandle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  qrName: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  verifiedText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  statsCard: { borderRadius: 16, padding: 16, gap: 12, width: '100%' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.foreground },
  simulateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 50, borderRadius: 14, width: '100%',
  },
  simulateBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  disclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: `${C.mutedForeground}77`, textAlign: 'center', lineHeight: 18 },
  // Scanned view
  scannedContent: { paddingHorizontal: 20, paddingBottom: 48, gap: 14 },
  collectorCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16 },
  collectorAvatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  collectorAvatarText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF' },
  collectorInfo: { flex: 1, gap: 4 },
  tradingWith: {},
  tradingWithLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  collectorHandle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  verRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  verSep: { fontSize: 11, color: C.mutedForeground },
  ratingLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  matchHighlight: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  matchHighlightText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  actionResult: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
  actionResultTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  actionResultSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  actionGrid: { gap: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, padding: 16,
  },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.mutedForeground, letterSpacing: 1.5 },
  matchCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, gap: 12 },
  matchThumb: { width: 44, height: 62, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  matchInitial: { fontSize: 20, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.9)' },
  matchInfo: { flex: 1, gap: 6 },
  matchName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  gradePill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  gradePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  matchRight: { alignItems: 'flex-end', gap: 6 },
  matchValue: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.foreground },
  typePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typePillText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
});
