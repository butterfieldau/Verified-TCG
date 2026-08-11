import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  size?: 'sm' | 'md';
}

export function Chip({ label, selected = false, onPress, size = 'md' }: ChipProps) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.selectionAsync();
    onPress?.();
  };

  const sm = size === 'sm';

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.muted,
          borderColor: selected ? colors.primary : colors.border,
          paddingVertical: sm ? 5 : 8,
          paddingHorizontal: sm ? 10 : 14,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: selected ? colors.primaryForeground : colors.mutedForeground,
            fontSize: sm ? 12 : 13,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 20,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
});
