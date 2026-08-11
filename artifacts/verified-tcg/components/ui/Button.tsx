import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  style,
  children,
  onPress,
  disabled,
  ...props
}: ButtonProps) {
  const colors = useColors();

  const handlePress: PressableProps['onPress'] = (e) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.(e);
  };

  const heights: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 56 };
  const pads: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 24 };
  const sizes: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

  const bgColor = {
    primary: colors.primary,
    secondary: colors.secondary,
    outline: 'transparent',
    ghost: 'transparent',
    destructive: colors.destructive,
  }[variant];

  const textColor = {
    primary: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.foreground,
    ghost: colors.foreground,
    destructive: colors.destructiveForeground,
  }[variant];

  return (
    <Pressable
      {...props}
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: pads[size],
          borderRadius: colors.radius,
          backgroundColor: bgColor,
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: variant === 'outline' ? colors.border : 'transparent',
          opacity: disabled || loading ? 0.5 : pressed ? 0.78 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          ...(fullWidth ? { width: '100%' as const } : {}),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : typeof children === 'string' ? (
        <Text style={[styles.label, { color: textColor, fontSize: sizes[size] }]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
});
