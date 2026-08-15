import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import DevSubscriptionToggle from '@/components/ui/DevSubscriptionToggle';

// Custom raised Scan button — matches the mockup's -top-5 treatment.
// Accept the broader event type that Expo Router passes to tabBarButton.
function ScanTabButton({ onPress }: { onPress?: (e: any) => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.scanWrapper}
      accessibilityRole="button"
      accessibilityLabel="Scan"
    >
      <View style={styles.scanCircle}>
        <Feather name="camera" size={24} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

// Tab bar (all platforms — 6 tabs fit without overflow)
function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          // Taller bar to accommodate the raised Scan button
          height: isWeb ? 84 : 74,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={22} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: 'Market',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.line.uptrend.xyaxis" tintColor={color} size={22} />
            ) : (
              <Feather name="trending-up" size={22} color={color} />
            ),
        }}
      />
      {/* Emphasized Scan tab — raised red circle */}
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarButton: (props) => (
            <ScanTabButton onPress={props.onPress ?? undefined} />
          ),
        }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          title: 'Collection',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="square.stack" tintColor={color} size={22} />
            ) : (
              <Feather name="layers" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.2" tintColor={color} size={22} />
            ) : (
              <Feather name="users" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={22} />
            ) : (
              <Feather name="user" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1 }}>
      <ClassicTabLayout />
      <DevSubscriptionToggle />
    </View>
  );
}

const styles = StyleSheet.create({
  // Raised scan button — lifts 24px above the tab bar
  scanWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
  },
  scanCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FF1E2D',
    alignItems: 'center',
    justifyContent: 'center',
    // Outer ring that blends with the dark tab bar
    borderWidth: 4,
    borderColor: '#0A0A0A',
    shadowColor: '#FF1E2D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
});
