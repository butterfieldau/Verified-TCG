import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import DevSubscriptionToggle from '@/components/ui/DevSubscriptionToggle';

const isIOS = Platform.OS === 'ios';
const isWeb = Platform.OS === 'web';

// ── Scan button ───────────────────────────────────────────────────────────────
// Floats 14 px above the glass pill — the red circle acts as a visual anchor.

function ScanTabButton({ onPress }: { onPress?: (e: any) => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.scanWrapper}
      accessibilityRole="button"
      accessibilityLabel="Scan"
    >
      {/* Outer halo ring — adds depth behind the pill edge */}
      <View style={styles.scanHalo} />
      <View style={styles.scanCircle}>
        {isIOS ? (
          <SymbolView name="camera.viewfinder" tintColor="#FFFFFF" size={22} />
        ) : (
          <Feather name="camera" size={22} color="#FFFFFF" />
        )}
      </View>
    </Pressable>
  );
}

// ── Glass background ──────────────────────────────────────────────────────────
// BlurView gives the frosted glass body; an absolutely-positioned border
// overlay creates the luminous edge without clipping the blur.

function GlassBackground() {
  return (
    <>
      {/* Frosted body */}
      <BlurView
        intensity={isIOS ? 72 : 80}
        tint="dark"
        style={[StyleSheet.absoluteFill, styles.glassPill]}
      />
      {/* Luminous border overlay — sits on top of the blur */}
      <View style={[StyleSheet.absoluteFill, styles.glassBorder]} pointerEvents="none" />
    </>
  );
}

// ── Tab layout ────────────────────────────────────────────────────────────────

function TabLayout() {
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.40)',
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => <GlassBackground />,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="house" featherName="home" color={color} focused={focused} sfSelected="house.fill" />
          ),
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="chart.line.uptrend.xyaxis" featherName="trending-up" color={color} focused={focused} sfSelected="chart.line.uptrend.xyaxis" />
          ),
        }}
      />
      {/* Scan — raised red orb */}
      <Tabs.Screen
        name="scan"
        options={{
          tabBarButton: (props) => (
            <ScanTabButton onPress={props.onPress ?? undefined} />
          ),
        }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="square.stack" featherName="layers" color={color} focused={focused} sfSelected="square.stack.fill" />
          ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="person.2" featherName="users" color={color} focused={focused} sfSelected="person.2.fill" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="person" featherName="user" color={color} focused={focused} sfSelected="person.fill" />
          ),
        }}
      />
    </Tabs>
  );
}

// ── Icon with active dot ──────────────────────────────────────────────────────

function TabIcon({
  name,
  featherName,
  color,
  focused,
  sfSelected,
}: {
  name: string;
  featherName: string;
  color: string;
  focused: boolean;
  sfSelected: string;
}) {
  return (
    <View style={styles.iconWrap}>
      {isIOS ? (
        <SymbolView
          name={focused ? sfSelected : name}
          tintColor={color}
          size={22}
          animationSpec={focused ? { effect: { type: 'bounce' } } : undefined}
        />
      ) : (
        <Feather name={featherName as any} size={22} color={color} />
      )}
      {/* Active indicator dot */}
      {focused && <View style={styles.dot} />}
    </View>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function RootTabLayout() {
  return (
    <View style={{ flex: 1 }}>
      <TabLayout />
      <DevSubscriptionToggle />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PILL_HEIGHT   = 64;
const PILL_RADIUS   = 36;
const BOTTOM_OFFSET = isWeb ? 16 : 28;
const H_MARGIN      = 20;

const styles = StyleSheet.create({
  // The floating pill container — transparent so the BlurView shows through
  tabBar: {
    position: 'absolute',
    bottom: BOTTOM_OFFSET,
    left: H_MARGIN,
    right: H_MARGIN,
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    backgroundColor: 'transparent',
    // Remove the default full-width hairline
    borderTopWidth: 0,
    elevation: 0,
    // Soft drop shadow for depth
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    // Must be visible so the scan circle can float above
    overflow: 'visible',
  },

  // Frosted glass pill body — clips to PILL_RADIUS
  glassPill: {
    borderRadius: PILL_RADIUS,
    overflow: 'hidden',
    // Very subtle dark tint on top of the blur
    backgroundColor: 'rgba(10,10,12,0.30)',
  },

  // Luminous border — 0.5 px white shimmer around the pill edge
  glassBorder: {
    borderRadius: PILL_RADIUS,
    borderWidth: 0.75,
    borderColor: 'rgba(255,255,255,0.18)',
    // Second inner highlight along the top edge only
    borderTopColor: 'rgba(255,255,255,0.32)',
  },

  // Each tab item fills equal width; vertically centered
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 0,
  },

  // Icon + dot wrapper
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },

  // Tiny active indicator beneath the icon
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FF1E2D',
  },

  // ── Scan button ─────────────────────────────────────────────────────────────

  scanWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Float the circle 14 px above the pill's top edge
    marginTop: -(PILL_HEIGHT / 2) - 14,
  },

  // Soft red glow halo — renders behind the circle
  scanHalo: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,30,45,0.22)',
  },

  scanCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FF1E2D',
    alignItems: 'center',
    justifyContent: 'center',
    // Thin white ring separates circle from content
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.20)',
    shadowColor: '#FF1E2D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.70,
    shadowRadius: 14,
    elevation: 12,
  },
});
