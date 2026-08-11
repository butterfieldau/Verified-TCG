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

const skeletonStyles = StyleSheet.create({
  card: { gap: 4 },
  mt8: { marginTop: 8 },
  mt4: { marginTop: 4 },
});
