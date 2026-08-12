import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SESSION_KEY = '@verified_tcg/auth_session';

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
}

export type OAuthProvider = 'google' | 'apple' | 'twitter';

function assertConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Authentication is not configured for this build.');
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  assertConfigured();
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function parseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({})) as { msg?: string; message?: string; error_description?: string };
  throw new Error(body.error_description ?? body.msg ?? body.message ?? `Authentication failed (${response.status})`);
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getRedirectUrl(): string {
  return Linking.createURL('auth/callback', { scheme: 'verified-tcg' });
}

function parseSessionFromUrl(url: string): AuthSession | null {
  const parsed = Linking.parse(url);
  const values = new URLSearchParams([
    ...Object.entries(parsed.queryParams ?? {}).map(([key, value]) => [key, String(value)]),
  ]);
  const hash = url.split('#')[1];
  if (hash) {
    for (const [key, value] of new URLSearchParams(hash)) values.set(key, value);
  }

  const accessToken = values.get('access_token');
  const refreshToken = values.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Number(values.get('expires_at') ?? 0) || undefined,
    user: { id: '' },
  };
}

async function persist(session: AuthSession | null): Promise<void> {
  if (session) {
    const expiresAt = session.expires_at ?? (
      session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : undefined
    );
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: expiresAt }));
  }
  else await AsyncStorage.removeItem(SESSION_KEY);
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const response = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: normaliseEmail(email), password }),
  });
  if (!response.ok) return parseError(response);
  const session = await response.json() as AuthSession;
  await persist(session);
  return session;
}

export async function signUp(email: string, password: string, displayName: string): Promise<AuthSession | null> {
  const response = await request('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: normaliseEmail(email),
      password,
      data: { display_name: displayName.trim() },
    }),
  });
  if (!response.ok) return parseError(response);
  const result = await response.json() as AuthSession;
  if (result.access_token) await persist(result);
  return result.access_token ? result : null;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await request('/auth/v1/recover', {
    method: 'POST',
    body: JSON.stringify({
      email: normaliseEmail(email),
      redirect_to: getRedirectUrl(),
    }),
  });
  if (!response.ok) return parseError(response);
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<AuthSession | null> {
  assertConfigured();
  const redirectTo = getRedirectUrl();
  const authorizeUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`;
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectTo);
  if (result.type !== 'success') return null;

  const session = parseSessionFromUrl(result.url);
  if (!session) {
    throw new Error('Supabase did not return a complete sign-in session. Check the provider redirect settings.');
  }
  const userResponse = await request('/auth/v1/user', {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!userResponse.ok) return parseError(userResponse);
  session.user = await userResponse.json() as AuthSession['user'];
  await persist(session);
  return session;
}

export async function restoreSession(): Promise<AuthSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  let session: AuthSession;
  try {
    session = JSON.parse(raw) as AuthSession;
  } catch {
    await persist(null);
    return null;
  }

  const expiresAt = session.expires_at ?? 0;
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return session;

  // Token expired — try refresh
  try {
    const response = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!response.ok) {
      await persist(null);
      return null;
    }
    const refreshed = await response.json() as AuthSession;
    await persist(refreshed);
    return refreshed;
  } catch {
    // Network error — return existing session so the user stays logged in offline
    return session;
  }
}

export async function signOut(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw) as AuthSession;
      await request('/auth/v1/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {});
    }
  } catch {}
  await persist(null);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await restoreSession();
  return session?.access_token ?? null;
}
