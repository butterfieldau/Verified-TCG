jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3' } },
}));

import { ApiClientError, apiJson, apiRequest, resolveApiOrigin } from '../services/apiClient';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.verified.test/api/';
  delete process.env.EXPO_PUBLIC_DOMAIN;
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
});

describe('shared mobile API client', () => {
  it('normalizes an accidental /api suffix without generating /api/api', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as Response);
    await apiJson('/api/catalog/cards', { accessToken: 'access-token' });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(resolveApiOrigin()).toBe('https://api.verified.test');
    expect(url).toBe('https://api.verified.test/api/catalog/cards');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(headers.get('x-app-version')).toBe('1.2.3');
  });

  it('rejects an editor-domain fallback when the explicit public origin is absent', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    process.env.EXPO_PUBLIC_DOMAIN = 'editor.replit.dev';
    expect(resolveApiOrigin()).toBe('');
  });

  it('keeps a real zero-result success distinct from provider failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) } as Response);
    await expect(apiJson('/api/catalog/cards?q=none')).resolves.toEqual({ data: [] });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({ message: 'Provider unavailable' }) } as unknown as Response);
    await expect(apiRequest('/api/catalog/cards?q=none')).rejects.toMatchObject<ApiClientError>({
      kind: 'provider_unavailable',
      status: 503,
    });
  });
});
