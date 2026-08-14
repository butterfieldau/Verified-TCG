import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';

interface SkeletonLoaderProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonLoader({
  width = '100%',
  height = 16,
  borderRadius,
  style,
}: SkeletonLoaderProps) {
  const colors = useColors();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700 }),
        withTiming(0.3, { duration: 700 }),
      ),
      -1,
      false,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: borderRadius ?? 6,
          backgroundColor: colors.muted,
        },
        animStyle,
        style,
      ]}
    />
  );
}

// Pre-built card skeleton for list/grid use
export function CardSkeleton() {
  return (
    <View style={skeletonStyles.card}>
      <SkeletonLoader height={190} borderRadius={12} />
      <SkeletonLoader width="70%" height={13} style={skeletonStyles.mt8} />
      <SkeletonLoader width="50%" height={11} style={skeletonStyles.mt4} />
    </View>
  );
}

/** Skeleton for a single collection list row */
export function CollectionRowSkeleton() {
  return (
    <View style={skeletonStyles.row}>
      {/* Thumbnail */}
      <SkeletonLoader width={52} height={72} borderRadius={8} />
      {/* Info */}
      <View style={skeletonStyles.rowInfo}>
        <SkeletonLoader width="65%" height={14} />
        <SkeletonLoader width="45%" height={11} style={skeletonStyles.mt6} />
        <SkeletonLoader width="30%" height={10} style={skeletonStyles.mt4} />
        <SkeletonLoader width="40%" height={22} borderRadius={6} style={skeletonStyles.mt6} />
      </View>
      {/* Pricing */}
      <View style={skeletonStyles.rowPricing}>
        <SkeletonLoader width={64} height={18} />
        <SkeletonLoader width={48} height={11} style={skeletonStyles.mt4} />
      </View>
    </View>
  );
}

/** Skeleton list of N collection rows */
export function CollectionListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <CollectionRowSkeleton key={i} />
      ))}
    </View>
  );
}

/** Skeleton for a search result row */
export function SearchResultSkeleton() {
  return (
    <View style={skeletonStyles.searchRow}>
      <SkeletonLoader width={50} height={70} borderRadius={8} />
      <View style={skeletonStyles.rowInfo}>
        <SkeletonLoader width="60%" height={14} />
        <SkeletonLoader width="40%" height={11} style={skeletonStyles.mt6} />
        <SkeletonLoader width="25%" height={10} style={skeletonStyles.mt4} />
      </View>
      <View style={skeletonStyles.rowPricing}>
        <SkeletonLoader width={56} height={16} />
        <SkeletonLoader width={40} height={11} style={skeletonStyles.mt4} />
      </View>
    </View>
  );
}

/** Skeleton list for search results */
export function SearchListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: 8, paddingHorizontal: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SearchResultSkeleton key={i} />
      ))}
    </View>
  );
}

/** Skeleton for a market mover card (horizontal scroll) */
export function MarketMoverSkeleton() {
  return (
    <View style={skeletonStyles.moverCard}>
      <SkeletonLoader width={110} height={150} borderRadius={12} />
      <SkeletonLoader width="80%" height={12} style={skeletonStyles.mt8} />
      <SkeletonLoader width="60%" height={10} style={skeletonStyles.mt4} />
      <SkeletonLoader width="50%" height={14} style={skeletonStyles.mt4} />
    </View>
  );
}

/** Skeleton for a notification row */
export function NotificationSkeleton() {
  return (
    <View style={skeletonStyles.notifRow}>
      <SkeletonLoader width={44} height={44} borderRadius={22} />
      <View style={skeletonStyles.rowInfo}>
        <SkeletonLoader width="70%" height={13} />
        <SkeletonLoader width="50%" height={11} style={skeletonStyles.mt6} />
        <SkeletonLoader width="30%" height={10} style={skeletonStyles.mt4} />
      </View>
    </View>
  );
}

export function NotificationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: 2 }}>
      {Array.from({ length: count }).map((_, i) => (
        <NotificationSkeleton key={i} />
      ))}
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  card: { gap: 4 },
  mt8: { marginTop: 8 },
  mt6: { marginTop: 6 },
  mt4: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 14,
    gap: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  searchRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 12,
    gap: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rowInfo: { flex: 1 },
  rowPricing: { alignItems: 'flex-end', gap: 0 },
  moverCard: { width: 110 },
  notifRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
});
