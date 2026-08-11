import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
  isPassword?: boolean;
}

export function Input({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onRightIconPress,
  isPassword,
  style,
  ...props
}: InputProps) {
  const colors = useColors();
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const borderColor = error
    ? colors.destructive
    : isFocused
    ? colors.primary
    : colors.border;

  return (
    <View style={styles.wrapper}>
      {label && (
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.row,
          {
            backgroundColor: colors.input,
            borderColor,
            borderRadius: colors.radius,
          },
        ]}
      >
        {leftIcon && (
          <Feather
            name={leftIcon as any}
            size={18}
            color={colors.mutedForeground}
            style={styles.leftIcon}
          />
        )}
        <TextInput
          {...props}
          secureTextEntry={isPassword && !showPassword}
          onFocus={(e) => { setIsFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setIsFocused(false); props.onBlur?.(e); }}
          style={[
            styles.input,
            { color: colors.foreground },
            leftIcon ? styles.hasLeft : null,
            (rightIcon || isPassword) ? styles.hasRight : null,
            style,
          ]}
          placeholderTextColor={colors.mutedForeground}
        />
        {isPassword ? (
          <Pressable onPress={() => setShowPassword(v => !v)} style={styles.rightIcon}>
            <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : rightIcon ? (
          <Pressable onPress={onRightIconPress} style={styles.rightIcon}>
            <Feather name={rightIcon as any} size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.message, { color: colors.destructive }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.message, { color: colors.mutedForeground }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    height: 52,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    paddingHorizontal: 16,
    height: '100%',
  },
  hasLeft: { paddingLeft: 44 },
  hasRight: { paddingRight: 44 },
  leftIcon: { position: 'absolute', left: 14, zIndex: 1 },
  rightIcon: { position: 'absolute', right: 14, padding: 4 },
  message: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
