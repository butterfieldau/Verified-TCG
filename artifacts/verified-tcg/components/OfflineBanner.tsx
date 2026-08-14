import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNetwork } from '@/context/NetworkContext';
import colors from '@/constants/colors';

const C = colors.dark;

function formatLastSeen(isoString: string | null): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function OfflineBanner() {
  const { isConnected, lastOnlineAt } = useNetwork();
  const [dismissed, setDismissed] = useState(false);
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const prevConnected = useRef(isConnected);

  // Show banner when offline; re-show when connectivity drops again after being dismissed
  useEffect(() => {
    if (!isConnected && prevConnected.current) {
      // Just went offline — show and reset dismissed state
      setDismissed(false);
    }
    prevConnected.current = isConnected;
  }, [isConnected]);

  const visible = !isConnected && !dismissed;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : -80,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [visible, slideAnim]);

  const lastSeenText = lastOnlineAt ? `Last updated ${formatLastSeen(lastOnlineAt)}` : 'Showing cached data';

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Feather name="wifi-off" size={14} color="#FFF" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>You're offline</Text>
          <Text style={styles.sub}>{lastSeenText}</Text>
        </View>
        <Pressable onPress={() => setDismissed(true)} hitSlop={12} style={styles.close}>
          <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFF',
  },
  sub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },
  close: {
    padding: 4,
  },
});
