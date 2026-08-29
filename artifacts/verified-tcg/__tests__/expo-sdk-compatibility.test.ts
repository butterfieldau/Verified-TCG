import packageJson from '../package.json';

describe('Expo SDK compatibility', () => {
  it('pins expo-network to the Expo SDK 54 compatible release line', () => {
    expect(packageJson.dependencies['expo-network']).toBe('~8.0.8');
  });
});