import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SESSION_KEY = '@verified_tcg/auth_session';

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
}

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

async function persist(session: AuthSession | null): Promise<void> {
  if (session) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else await AsyncStorage.removeItem(SESSION_KEY);
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const response = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
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
      email: email.trim().toLowerCase(),
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
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  if (!response.ok) return parseError(response);
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
}

export async function signOut(): Promise<void> {
  const session = await restoreSession();
  if (session) {
    await request('/auth/v1/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  await persist(null);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await restoreSession();
  return session?.access_token ?? null;
}
