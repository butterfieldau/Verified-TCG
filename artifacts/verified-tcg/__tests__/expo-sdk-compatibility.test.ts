import packageJson from '../package.json';
import appJson from '../app.json';

describe('Expo SDK compatibility', () => {
  it('pins expo-network to the Expo SDK 54 compatible release line', () => {
    expect(packageJson.dependencies['expo-network']).toBe('~8.0.8');
  });

  it('keeps FlashList v2 on React Native New Architecture', () => {
    const flashListVersion = packageJson.dependencies['@shopify/flash-list'];
    const flashListMajor = Number(flashListVersion.match(/\d+/)?.[0]);

    expect(flashListMajor).toBe(2);
    expect(appJson.expo.newArchEnabled).toBe(true);
  });

  it('uses the Expo SDK 54 New Architecture animation stack', () => {
    expect(packageJson.devDependencies['react-native-reanimated']).toBe('~4.1.1');
    expect(packageJson.devDependencies['react-native-worklets']).toBe('0.5.1');
    expect(packageJson.expo).toBeUndefined();
  });

  it('keeps the TestFlight API origin in versioned Expo configuration', () => {
    expect(appJson.expo.extra.apiBaseUrl).toBe('https://app.verifiedtcg.co');
  });
});