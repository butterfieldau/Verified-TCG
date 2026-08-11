import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

interface LogoProps {
  variant?: 'white' | 'color';
  width?: number;
  height?: number;
  style?: StyleProp<ImageStyle>;
}

export function Logo({ variant = 'white', width = 160, height = 70, style }: LogoProps) {
  return (
    <Image
      source={
        variant === 'white'
          ? require('../assets/images/logo-white.png')
          : require('../assets/images/logo-color.png')
      }
      style={[{ width, height }, style]}
      resizeMode="contain"
    />
  );
}
