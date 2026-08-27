import { Platform } from 'react-native';

export function supportsLiquidGlassTabs(): boolean {
  if (Platform.OS !== 'ios') {
    return false;
  }

  const majorVersion = Number.parseInt(String(Platform.Version), 10);
  return Number.isFinite(majorVersion) && majorVersion >= 26;
}