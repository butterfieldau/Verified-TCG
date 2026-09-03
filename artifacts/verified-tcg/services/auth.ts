import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Alert, Platform } from "react-native";
import { ApiClientError, apiRequest, resolveApiOrigin, setUnauthorizedRecovery } from './apiClient';

// ── Config ───────────────────────────────────────────────────────────────────

// AsyncStorage keys may use the app's @-scoped convention, but Expo
// SecureStore keys have a stricter character allow-list and reject "@". Keep
// the two names separate so a successful login/signup can always be persisted.
const ASYNC_SESSION_KEY = "@verified_tcg/auth_session";
const SECURE_SESSION_KEY = "verified_tcg_auth_session";
const USE_SECURE_SESSION_STORAGE = Platform.OS !== "web";

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
export type OAuthProvider = "google" | "apple" | "twitter";

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the explicit public API origin shared by native and web builds.
 * There is intentionally no Expo/Replit-domain fallback: native authentication
 * must never send a relative request to the app host or editor preview.
 */
export const resolveAuthApiBase = resolveApiOrigin;

async function request(
  path: string,
  init: RequestInit & { accessToken?: string },
): Promise<Response> {
  return apiRequest(path, init);
}

export async function readPersistedSession(
  useSecureSessionStorage = USE_SECURE_SESSION_STORAGE,
): Promise<string | null> {
  if (!useSecureSessionStorage) {
    return AsyncStorage.getItem(ASYNC_SESSION_KEY);
  }

  const secureValue = await SecureStore.getItemAsync(SECURE_SESSION_KEY);
  if (secureValue) return secureValue;

  // Migrate sessions written by earlier releases without retaining an
  // access/refresh token in plaintext app storage.
  const legacyValue = await AsyncStorage.getItem(ASYNC_SESSION_KEY);
  if (legacyValue) {
    await SecureStore.setItemAsync(SECURE_SESSION_KEY, legacyValue);
    await AsyncStorage.removeItem(ASYNC_SESSION_KEY);
  }
  return legacyValue;
}

async function persist(session: AuthSession | null): Promise<void> {
  if (!session) {
    if (USE_SECURE_SESSION_STORAGE) {
      await SecureStore.deleteItemAsync(SECURE_SESSION_KEY);
    }
    await AsyncStorage.removeItem(ASYNC_SESSION_KEY);
    return;
  }

  const expiresAt =
    session.expires_at ??
    (session.expires_in
      ? Math.floor(Date.now() / 1000) + session.expires_in
      : undefined);
  const serialized = JSON.stringify({ ...session, expires_at: expiresAt });

  if (USE_SECURE_SESSION_STORAGE) {
    await SecureStore.setItemAsync(SECURE_SESSION_KEY, serialized);
    await AsyncStorage.removeItem(ASYNC_SESSION_KEY);
    return;
  }

  await AsyncStorage.setItem(ASYNC_SESSION_KEY, serialized);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthSession> {
  const response = await request("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const session = (await response.json()) as AuthSession;
  await persist(session);
  return session;
}

export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  username: string,
): Promise<AuthSession | null> {
  const response = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      username: username.trim().replace(/^@+/, "").toLowerCase(),
    }),
  });
  const result = (await response.json()) as AuthSession;
  if (result.access_token) await persist(result);
  return result.access_token ? result : null;
}

export async function checkUsernameAvailability(username: string): Promise<boolean> {
  const normalized = username.trim().replace(/^@+/, "").toLowerCase();
  const response = await request(
    `/api/auth/username-availability?username=${encodeURIComponent(normalized)}`,
    {},
  );
  const result = (await response.json()) as { available: boolean };
  return result.available;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await request("/api/auth/recover", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const response = await request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const session = await restoreSession();
  if (!session)
    throw new Error("You need to be signed in to change your password.");

  const response = await request("/api/auth/change-password", {
    method: "POST",
    accessToken: session.access_token,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function uploadAvatar(
  base64: string,
  mimeType: string,
): Promise<string> {
  const session = await restoreSession();
  if (!session) throw new Error("You need to be signed in to upload a photo.");

  const response = await request("/api/auth/avatar", {
    method: "POST",
    accessToken: session.access_token,
    body: JSON.stringify({ base64, mimeType }),
  });
  const result = (await response.json()) as { avatar_url: string };

  // Persist the new avatar URL to the cached session
  session.user.user_metadata = {
    ...(session.user.user_metadata ?? {}),
    avatar_url: result.avatar_url,
  };
  await persist(session);

  return result.avatar_url;
}

export async function updateUserMetadata(
  data: Record<string, unknown>,
): Promise<void> {
  const session = await restoreSession();
  if (!session) throw new Error("You need an account to edit your profile.");

  const response = await request("/api/auth/user", {
    method: "PUT",
    accessToken: session.access_token,
    body: JSON.stringify({ data }),
  });
  const updated = (await response.json()) as AuthSession["user"];
  session.user = updated;
  await persist(session);
}

/**
 * Social login is not yet supported on this backend.
 * Shows a friendly alert and returns null so the app stays on the sign-in screen.
 */
export async function signInWithOAuth(
  _provider: OAuthProvider,
): Promise<AuthSession | null> {
  Alert.alert(
    "Coming Soon",
    "Social sign-in will be available in a future update. Please sign in with your email and password.",
    [{ text: "OK" }],
  );
  return null;
}

export async function restoreSession(forceRefresh = false): Promise<AuthSession | null> {
  const raw = await readPersistedSession();
  if (!raw) return null;

  let session: AuthSession;
  try {
    session = JSON.parse(raw) as AuthSession;
  } catch {
    await persist(null);
    return null;
  }

  const expiresAt = session.expires_at ?? 0;
  if (!forceRefresh && expiresAt > Math.floor(Date.now() / 1000) + 60) return session;

  // Token approaching expiry — attempt refresh
  try {
    const response = await request("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const refreshed = (await response.json()) as AuthSession;
    await persist(refreshed);
    return refreshed;
  } catch (error) {
    if (error instanceof ApiClientError && error.kind === 'unauthorized') {
      await persist(null);
      return null;
    }
    // Network unavailable — return the stale session so the user stays logged in offline
    return session;
  }
}

// A 401 from an authenticated route may mean the server invalidated an access
// token before its recorded expiry. Let the common request client ask this
// module for one single refresh and replay the failed request. A failed refresh
// still clears the session as before, so this never extends an invalid login.
setUnauthorizedRecovery(async () => {
  const refreshed = await restoreSession(true);
  return refreshed?.access_token ?? null;
});

/** All non-sensitive AsyncStorage keys owned by this app — cleared on sign-out or account deletion. */
export const ALL_STORAGE_KEYS = [
  ASYNC_SESSION_KEY,
  "@verified_tcg/watchlist",
  "@verified_tcg/prices_v2",
  // Legacy price keys (written by older app versions)
  "@verified_tcg/collection_prices",
  "@verified_tcg/watchlist_prices",
  "@verified_tcg/prices_last_updated",
  // Collection cache is user-scoped in memory but the key itself is shared;
  // clear it on sign-out so a later account can never see the previous
  // account's holdings while the server request is loading.
  "@verified_tcg/collection_cache",
  "@verified_tcg/scan_state",
  "@verified_tcg/alerts",
  // Home-screen dismissal banners
  "@verified_tcg/event_banner_dismissed_event_id",
  "@verified_tcg/trade_matches_dismissed_count",
  // Onboarding TCG game selections (must be cleared on sign-out so the
  // next account holder's choices are not mistakenly pushed to the server)
  "@verified_tcg/preferred_tcgs",
] as const;

export async function signOut(): Promise<void> {
  try {
    const raw = await readPersistedSession();
    if (raw) {
      const session = JSON.parse(raw) as AuthSession;
      await request("/api/auth/signout", {
        method: "POST",
        accessToken: session.access_token,
      }).catch(() => {});
    }
  } catch {}
  await persist(null).catch(() => {});
  // Clear every local key so the next user starts completely fresh
  await AsyncStorage.multiRemove([...ALL_STORAGE_KEYS]).catch(() => {});
}

export async function deleteAccount(password: string): Promise<void> {
  const session = await restoreSession();
  if (!session)
    throw new Error("You must be signed in to delete your account.");

  const response = await request("/api/auth/account", {
    method: "DELETE",
    accessToken: session.access_token,
    body: JSON.stringify({ password }),
  });

  // Wipe all local data after the server confirms deletion
  await persist(null).catch(() => {});
  await AsyncStorage.multiRemove([...ALL_STORAGE_KEYS]).catch(() => {});
}

export async function getAccessToken(): Promise<string | null> {
  const session = await restoreSession();
  return session?.access_token ?? null;
}

/**
 * Fetch the current user's full profile from the server.
 *
 * Calls GET /api/auth/user with the stored access token and returns the
 * server's authoritative user object (including all profile fields that
 * may have been edited on another device or via the web app).
 *
 * Returns null if the network is unavailable, the session has expired, or
 * no session exists — callers should fall back gracefully to cached data.
 *
 * The persisted secure session is NOT updated here; the returned
 * data is intended for updating in-memory state only.
 */
export async function fetchCurrentUser(): Promise<AuthSession["user"] | null> {
  const session = await restoreSession();
  if (!session) return null;
  try {
    const response = await request("/api/auth/user", {
      accessToken: session.access_token,
    });
    return (await response.json()) as AuthSession["user"];
  } catch {
    // Network unavailable — caller falls back to cached session data
    return null;
  }
}

/**
 * Upgrade the authenticated user's subscription to Pro.
 *
 * Calls POST /api/subscription/upgrade on the server which sets
 * subscription_tier = 'pro' in the database.  Also updates the cached
 * secure session so subsequent restoreSession() calls return the
 * new tier without needing an extra round-trip.
 *
 * In production this would be triggered after a successful payment
 * webhook rather than called directly from the client.
 *
 * @returns The updated subscription_tier and is_founding_member values.
 */
export async function upgradeToPro(): Promise<{
  subscription_tier: string;
  is_founding_member: boolean;
}> {
  const session = await restoreSession();
  if (!session) throw new Error("You must be signed in to upgrade.");

  const response = await request("/api/subscription/upgrade", {
    method: "POST",
    accessToken: session.access_token,
  });

  const result = (await response.json()) as {
    subscription_tier: string;
    is_founding_member: boolean;
  };

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

/**
 * Restore Purchases — required by Apple App Store Review Guidelines §3.1.1.
 *
 * Re-fetches the user's current subscription_tier from the server so that
 * after a reinstall / device switch the Pro status can be confirmed without
 * requiring a new purchase.
 *
 * @returns { subscription_tier, is_founding_member, restored }
 *   `restored` is true when the server confirmed an active Pro subscription.
 */
export async function restorePurchases(): Promise<{
  subscription_tier: string;
  is_founding_member: boolean;
  restored: boolean;
}> {
  const session = await restoreSession();
  if (!session) throw new Error("You must be signed in to restore purchases.");

  const response = await request("/api/subscription/restore", {
    method: "POST",
    accessToken: session.access_token,
  });

  const result = (await response.json()) as {
    subscription_tier: string;
    is_founding_member: boolean;
    restored: boolean;
  };

  // Sync the cached session with the authoritative tier from the server
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
