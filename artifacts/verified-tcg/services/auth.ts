import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

// ── Config ───────────────────────────────────────────────────────────────────

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const SESSION_KEY = '@verified_tcg/auth_session';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown> & {
      subscription_tier?: string;
      is_founding_member?: boolean;
    };
  };
}

/** Kept for AppContext compatibility — social login is not yet supported. */
export type OAuthProvider = 'google' | 'apple' | 'twitter';

// ── Internal helpers ─────────────────────────────────────────────────────────

async function request(
  path: string,
  init: RequestInit & { accessToken?: string },
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.accessToken) headers['Authorization'] = `Bearer ${init.accessToken}`;
  return fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

async function parseError(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({})) as {
    msg?: string;
    message?: string;
    error_description?: string;
  };
  throw new Error(
    body.error_description ?? body.message ?? body.msg ?? `Authentication failed (${response.status})`,
  );
}

async function persist(session: AuthSession | null): Promise<void> {
  if (session) {
    const expiresAt =
      session.expires_at ??
      (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : undefined);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: expiresAt }));
  } else {
    await AsyncStorage.removeItem(SESSION_KEY);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const response = await request('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!response.ok) return parseError(response);
  const session = (await response.json()) as AuthSession;
  await persist(session);
  return session;
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthSession | null> {
  const response = await request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      display_name: displayName.trim(),
    }),
  });
  if (!response.ok) return parseError(response);
  const result = (await response.json()) as AuthSession;
  if (result.access_token) await persist(result);
  return result.access_token ? result : null;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await request('/api/auth/recover', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  if (!response.ok) return parseError(response);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const response = await request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!response.ok) return parseError(response);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const session = await restoreSession();
  if (!session) throw new Error('You need to be signed in to change your password.');

  const response = await request('/api/auth/change-password', {
    method: 'POST',
    accessToken: session.access_token,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) return parseError(response);
}

export async function uploadAvatar(base64: string, mimeType: string): Promise<string> {
  const session = await restoreSession();
  if (!session) throw new Error('You need to be signed in to upload a photo.');

  const response = await request('/api/auth/avatar', {
    method: 'POST',
    accessToken: session.access_token,
    body: JSON.stringify({ base64, mimeType }),
  });
  if (!response.ok) return parseError(response);
  const result = (await response.json()) as { avatar_url: string };

  // Persist the new avatar URL to the cached session
  session.user.user_metadata = {
    ...(session.user.user_metadata ?? {}),
    avatar_url: result.avatar_url,
  };
  await persist(session);

  return result.avatar_url;
}

export async function updateUserMetadata(data: Record<string, unknown>): Promise<void> {
  const session = await restoreSession();
  if (!session) throw new Error('You need an account to edit your profile.');

  const response = await request('/api/auth/user', {
    method: 'PUT',
    accessToken: session.access_token,
    body: JSON.stringify({ data }),
  });
  if (!response.ok) return parseError(response);
  const updated = (await response.json()) as AuthSession['user'];
  session.user = updated;
  await persist(session);
}

/**
 * Social login is not yet supported on this backend.
 * Shows a friendly alert and returns null so the app stays on the sign-in screen.
 */
export async function signInWithOAuth(_provider: OAuthProvider): Promise<AuthSession | null> {
  Alert.alert(
    'Coming Soon',
    'Social sign-in will be available in a future update. Please sign in with your email and password.',
    [{ text: 'OK' }],
  );
  return null;
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

  // Token approaching expiry — attempt refresh
  try {
    const response = await request('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!response.ok) {
      await persist(null);
      return null;
    }
    const refreshed = (await response.json()) as AuthSession;
    await persist(refreshed);
    return refreshed;
  } catch {
    // Network unavailable — return the stale session so the user stays logged in offline
    return session;
  }
}

/** All AsyncStorage keys owned by this app — cleared on sign-out or account deletion. */
export const ALL_STORAGE_KEYS = [
  '@verified_tcg/auth_session',
  '@verified_tcg/watchlist',
  '@verified_tcg/prices_v2',
  // Legacy price keys (written by older app versions)
  '@verified_tcg/collection_prices',
  '@verified_tcg/watchlist_prices',
  '@verified_tcg/prices_last_updated',
  '@verified_tcg/scan_state',
  '@verified_tcg/alerts',
  // Home-screen dismissal banners
  '@verified_tcg/event_banner_dismissed_event_id',
  '@verified_tcg/trade_matches_dismissed_count',
] as const;

export async function signOut(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) {
      const session = JSON.parse(raw) as AuthSession;
      await request('/api/auth/signout', {
        method: 'POST',
        accessToken: session.access_token,
      }).catch(() => {});
    }
  } catch {}
  // Clear every local key so the next user starts completely fresh
  await AsyncStorage.multiRemove([...ALL_STORAGE_KEYS]).catch(() => {});
}

export async function deleteAccount(password: string): Promise<void> {
  const session = await restoreSession();
  if (!session) throw new Error('You must be signed in to delete your account.');

  const response = await request('/api/auth/account', {
    method: 'DELETE',
    accessToken: session.access_token,
    body: JSON.stringify({ password }),
  });
  if (!response.ok) return parseError(response);

  // Wipe all local data after the server confirms deletion
  await AsyncStorage.multiRemove([...ALL_STORAGE_KEYS]).catch(() => {});
}

export async function getAccessToken(): Promise<string | null> {
  const session = await restoreSession();
  return session?.access_token ?? null;
}

/**
 * Upgrade the authenticated user's subscription to Pro.
 *
 * Calls POST /api/subscription/upgrade on the server which sets
 * subscription_tier = 'pro' in the database.  Also updates the cached
 * session in AsyncStorage so subsequent restoreSession() calls return the
 * new tier without needing an extra round-trip.
 *
 * In production this would be triggered after a successful payment
 * webhook rather than called directly from the client.
 *
 * @returns The updated subscription_tier and is_founding_member values.
 */
export async function upgradeToPro(): Promise<{ subscription_tier: string; is_founding_member: boolean }> {
  const session = await restoreSession();
  if (!session) throw new Error('You must be signed in to upgrade.');

  const response = await request('/api/subscription/upgrade', {
    method: 'POST',
    accessToken: session.access_token,
  });
  if (!response.ok) return parseError(response);

  const result = (await response.json()) as { subscription_tier: string; is_founding_member: boolean };

  // Update the cached session so the new tier is available on next restore
  const updatedSession: AuthSession = {
    ...session,
    user: {
      ...session.user,
      user_metadata: {
        ...(session.user.user_metadata ?? {}),
        subscription_tier: result.subscription_tier,
        is_founding_member: result.is_founding_member,
      },
    },
  };
  await persist(updatedSession);

  return result;
}
