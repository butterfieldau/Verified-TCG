jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3' } },
}));

describe('platform runtime controls', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.verified.test';
  });

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    jest.restoreAllMocks();
  });

  test('adds the app-generated version to every first-party API request', async () => {
    const { createVersionedApiFetch } = require('@/services/platformRuntime') as typeof import('@/services/platformRuntime');
    const response = new Response('{}', { status: 200 });
    const original = jest.fn().mockResolvedValue(response);
    const versionedFetch = createVersionedApiFetch(original, jest.fn());

    await versionedFetch('https://api.verified.test/api/catalog/cards', {
      headers: { 'x-app-version': '999.0.0', Accept: 'application/json' },
    });

    const init = original.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('x-app-version')).toBe('1.2.3');
    expect(headers.get('accept')).toBe('application/json');
  });

  test('does not attach the version to third-party requests', async () => {
    const { createVersionedApiFetch } = require('@/services/platformRuntime') as typeof import('@/services/platformRuntime');
    const original = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const versionedFetch = createVersionedApiFetch(original, jest.fn());

    await versionedFetch('https://images.example.test/card.png');

    expect(original.mock.calls[0]?.[1]).toBeUndefined();
  });

  test('turns runtime version policy into a blocking update requirement', () => {
    const { updateRequirementFromConfig } = require('@/services/platformRuntime') as typeof import('@/services/platformRuntime');
    const requirement = updateRequirementFromConfig({
      maintenanceMode: false,
      maintenanceMessage: null,
      scannerEnabled: true,
      pricingEnabled: true,
      communityEnabled: true,
      minimumAppVersion: '2.0.0',
      latestAppVersion: '2.1.0',
      forceUpdate: false,
      remoteAnnouncement: null,
    });

    expect(requirement).toMatchObject({
      currentVersion: '1.2.3',
      minimumVersion: '2.0.0',
    });
  });
});
