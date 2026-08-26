import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Alert, Platform } from "react-native";

// ── Config ───────────────────────────────────────────────────────────────────

const SESSION_KEY = "@verified_tcg/auth_session";
const USE_SECURE_SESSION_STORAGE = Platform.OS !== "web";
const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

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
 * Resolve the public API origin shared by native and web builds.  Auth used to
 * read only EXPO_PUBLIC_API_BASE_URL while the rest of the app also supports
 * EXPO_PUBLIC_DOMAIN. When the explicit setting was absent, native auth sent a
 * relative /api request to the Expo/Replit host instead of the API deployment.
 */
export function resolveAuthApiBase(): string {
  const explicit = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();
  const configured = explicit || process.env.EXPO_PUBLIC_DOMAIN?.trim() || "";
  if (!configured) return "";

  const withScheme = /^https?:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  try {
    const url = new URL(withScheme);
    // EXPO_PUBLIC_API_BASE_URL is an origin. Tolerate an accidental /api
    // suffix without ever producing /api/api/auth/... requests.
    const pathname = url.pathname.replace(/\/$/, "");
    if (pathname && pathname !== "/api") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function authRequestDiagnostic(
  path: string,
  response: Response,
): void {
  if (!__DEV__) return;
  let hostname = "unconfigured";
  try {
    hostname = new URL(resolveAuthApiBase()).hostname || hostname;
  } catch {
    // Keep the diagnostic safe if the build configuration is invalid.
  }
  console.warn("Verified TCG authentication request failed", {
    status: response.status,
    contentType: response.headers?.get?.("content-type") ?? "unknown",
    endpoint: path,
    hostname,
  });
}

async function request(
  path: string,
  init: RequestInit & { accessToken?: string },
): Promise<Response> {
  const apiBase = resolveAuthApiBase();
  if (!apiBase) {
    throw new Error("The authentication service is not configured for this build.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-app-version": APP_VERSION,
  };
  if (init.accessToken) headers["Authorization"] = `Bearer ${init.accessToken}`;
  return fetch(`${apiBase}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
}

async function parseError(response: Response, path: string): Promise<never> {
  const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    authRequestDiagnostic(path, response);
    if (response.status === 403) {
      throw new Error("The authentication service could not be reached. Please try again.");
    }
    throw new Error("The authentication service returned an unexpected response. Please try again.");
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    msg?: string;
    message?: string;
    error_description?: string;
  };
  if (response.status === 401) {
    throw new Error("Incorrect email or password.");
  }
  throw new Error(
    body.error_description ??
    body.message ??
    body.msg ??
      body.error ??
      "The authentication service could not be reached. Please try again.",
  );
}

export async function readPersistedSession(
  useSecureSessionStorage = USE_SECURE_SESSION_STORAGE,
): Promise<string | null> {
  if (!useSecureSessionStorage) {
    return AsyncStorage.getItem(SESSION_KEY);
  }

  const secureValue = await SecureStore.getItemAsync(SESSION_KEY);
  if (secureValue) return secureValue;

  // Migrate sessions written by earlier releases without retaining an
  // access/refresh token in plaintext app storage.
  const legacyValue = await AsyncStorage.getItem(SESSION_KEY);
  if (legacyValue) {
    await SecureStore.setItemAsync(SESSION_KEY, legacyValue);
    await AsyncStorage.removeItem(SESSION_KEY);
  }
  return legacyValue;
}

async function persist(session: AuthSession | null): Promise<void> {
  if (!session) {
    if (USE_SECURE_SESSION_STORAGE) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
    await AsyncStorage.removeItem(SESSION_KEY);
    return;
  }

  const expiresAt =
    session.expires_at ??
    (session.expires_in
      ? Math.floor(Date.now() / 1000) + session.expires_in
      : undefined);
  const serialized = JSON.stringify({ ...session, expires_at: expiresAt });

  if (USE_SECURE_SESSION_STORAGE) {
    await SecureStore.setItemAsync(SESSION_KEY, serialized);
    await AsyncStorage.removeItem(SESSION_KEY);
    return;
  }

  await AsyncStorage.setItem(SESSION_KEY, serialized);
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
  if (!response.ok) return parseError(response, "/api/auth/signin");
  const session = (await response.json()) as AuthSession;
  await persist(session);
  return session;
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthSession | null> {
  const response = await request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      display_name: displayName.trim(),
    }),
  });
  if (!response.ok) return parseError(response, "/api/auth/signup");
  const result = (await response.json()) as AuthSession;
  if (result.access_token) await persist(result);
  return result.access_token ? result : null;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await request("/api/auth/recover", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  if (!response.ok) return parseError(response, "/api/auth/recover");
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const response = await request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!response.ok) return parseError(response, "/api/auth/reset-password");
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
  if (!response.ok) return parseError(response, "/api/auth/change-password");
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
  if (!response.ok) return parseError(response, "/api/auth/avatar");
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
  if (!response.ok) return parseError(response, "/api/auth/user");
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

export async function restoreSession(): Promise<AuthSession | null> {
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
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return session;

  // Token approaching expiry — attempt refresh
  try {
    const response = await request("/api/auth/refresh", {
      method: "POST",
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

/** All non-sensitive AsyncStorage keys owned by this app — cleared on sign-out or account deletion. */
export const ALL_STORAGE_KEYS = [
  "@verified_tcg/auth_session",
  "@verified_tcg/watchlist",
  "@verified_tcg/prices_v2",
  // Legacy price keys (written by older app versions)
  "@verified_tcg/collection_prices",
  "@verified_tcg/watchlist_prices",
  "@verified_tcg/prices_last_updated",
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
  if (!response.ok) return parseError(response, "/api/auth/account");

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
    if (!response.ok) return null;
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
  if (!response.ok) return parseError(response, "/api/subscription/upgrade");

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
  if (!response.ok) return parseError(response, "/api/subscription/restore");

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
