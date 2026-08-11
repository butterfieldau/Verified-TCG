import React from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

const C = colors.dark;
const { width: W } = Dimensions.get('window');
const FRAME = Math.min(W - 80, 280);

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: botPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Scan Card</Text>
        <Pressable style={styles.historyBtn}>
          <Feather name="clock" size={19} color={C.foreground} />
        </Pressable>
      </View>

      {/* Scanner viewfinder mock */}
      <View style={styles.viewfinder}>
        {/* Darkened overlay corners */}
        <View style={[styles.scanFrame, { width: FRAME, height: FRAME * 1.4 }]}>
          {/* Corner markers */}
          {[
            { top: 0, left: 0 },
            { top: 0, right: 0 },
            { bottom: 0, left: 0 },
            { bottom: 0, right: 0 },
          ].map((pos, i) => (
            <View key={i} style={[styles.corner, pos]} />
          ))}

          {/* Camera icon */}
          <View style={styles.cameraCenter}>
            <Feather name="camera" size={40} color={`${C.primary}88`} />
          </View>

          {/* Scan line */}
          <View style={styles.scanLine} />
        </View>

        <Text style={styles.hint}>Point your camera at a trading card</Text>
      </View>

      {/* Manual options */}
      <View style={styles.options}>
        <Text style={styles.optionsLabel}>Or add manually</Text>
        <View style={styles.optionRow}>
          {[
            { icon: 'search', label: 'Search' },
            { icon: 'image', label: 'Gallery' },
            { icon: 'edit-3', label: 'Manual' },
          ].map(o => (
            <Pressable key={o.label} style={({ pressed }) => [styles.optionBtn, { backgroundColor: C.card, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name={o.icon as any} size={22} color={C.foreground} />
              <Text style={styles.optionLabel}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Recent scans */}
      <View style={styles.recent}>
        <Text style={styles.recentTitle}>Recent Scans</Text>
        {['Charizard ex · Obsidian Flames', 'Umbreon ex · Prismatic Evolutions'].map(label => (
          <Pressable key={label} style={[styles.recentRow, { backgroundColor: C.card }]}>
            <Feather name="rotate-ccw" size={15} color={C.mutedForeground} />
            <Text style={styles.recentLabel}>{label}</Text>
            <Feather name="chevron-right" size={15} color={C.mutedForeground} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background, paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: { fontSize: 28, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  historyBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: { alignItems: 'center', marginBottom: 32 },
  scanFrame: {
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: C.primary,
    borderWidth: 3,
    borderRadius: 3,
  },
  cameraCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  scanLine: {
    position: 'absolute',
    top: '45%',
    left: 20,
    right: 20,
    height: 2,
    backgroundColor: `${C.primary}66`,
    borderRadius: 1,
  },
  hint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    textAlign: 'center',
  },
  options: { marginBottom: 28 },
  optionsLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  optionRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  optionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
    maxWidth: 100,
  },
  optionLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.foreground },
  recent: {},
  recentTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    marginBottom: 10,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
    gap: 12,
  },
  recentLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.foreground },
});
