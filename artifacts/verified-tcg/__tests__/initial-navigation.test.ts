import {
  InitialNavigationTimeoutError,
  resolveInitialRoute,
} from '@/services/initialNavigation';

describe('initial navigation decision', () => {
  it('opens the signed-in app when a session is restored', async () => {
    await expect(
      resolveInitialRoute(
        async () => ({ access_token: 'test' }),
        async () => null,
      ),
    ).resolves.toBe('/(tabs)');
  });

  it('opens the app for an onboarded signed-out collector', async () => {
    await expect(
      resolveInitialRoute(
        async () => null,
        async () => 'true',
      ),
    ).resolves.toBe('/(tabs)');
  });

  it('opens welcome for a new collector', async () => {
    await expect(
      resolveInitialRoute(
        async () => null,
        async () => null,
      ),
    ).resolves.toBe('/welcome');
  });

  it('times out instead of leaving the splash screen hanging', async () => {
    await expect(
      resolveInitialRoute(
        () => new Promise(() => {}),
        async () => null,
        5,
      ),
    ).rejects.toBeInstanceOf(InitialNavigationTimeoutError);
  });
});