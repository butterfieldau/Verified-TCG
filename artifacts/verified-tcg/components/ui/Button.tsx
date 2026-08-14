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

  // Visual heights — sm is kept compact but gets hitSlop below to reach 44pt minimum
  const heights: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 56 };
  const pads: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 24 };
  const sizes: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

  // WCAG AA: white (#FFF) text must have ≥4.5:1 contrast on the button background.
  // Brand primary #FF1E2D gives only 3.84:1; #CC1826 gives ≈5.25:1.
  // Brand destructive #EF4444 gives only 3.76:1; #DC2626 gives ≈4.58:1.
  // We darken ONLY the button-background values; the primary/destructive design
  // tokens remain unchanged for text/decorative uses (they pass on dark surfaces).
  const bgColor = {
    primary: '#CC1826',
    secondary: colors.secondary,
    outline: 'transparent',
    ghost: 'transparent',
    destructive: '#DC2626',
  }[variant];

  const textColor = {
    primary: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.foreground,
    ghost: colors.foreground,
    destructive: colors.destructiveForeground,
  }[variant];

  // Expand the hit area to ≥44pt for small buttons without changing visual appearance
  const hitSlop = size === 'sm' ? { top: 4, bottom: 4, left: 4, right: 4 } : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
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
