/**
 * Auth service unit tests
 *
 * Verifies that signOut removes every expected local key, and that
 * restorePurchases() correctly syncs the server-authoritative subscription_tier
 * into the cached secure session (covering the reinstall / device-switch
 * scenario where local storage is cleared but the server still knows the tier).
 *
 * Uses the AsyncStorage mock from setup.ts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  readPersistedSession,
  restoreSession,
  resolveAuthApiBase,
  signInWithPassword,
  signOut,
  signUp,
  ALL_STORAGE_KEYS,
  type AuthSession,
} from "../services/auth";

import { restorePurchases } from "../services/auth";

// Mock fetch so network calls are controlled per-test
global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response));

const ASYNC_SESSION_KEY = "@verified_tcg/auth_session";
const SECURE_SESSION_KEY = "verified_tcg_auth_session";

/** Build a minimal AuthSession stored in the session store. */
function makeSession(
  overrides: Partial<AuthSession["user"]["user_metadata"]> = {},
): AuthSession {
  return {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    user: {
      id: "user-123",
      email: "test@example.com",
      user_metadata: {
        subscription_tier: "free",
        is_founding_member: false,
        ...overrides,
      },
    },
  };
}

beforeEach(async () => {
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.verified.test";
  delete process.env.EXPO_PUBLIC_DOMAIN;
  await AsyncStorage.clear();
  await SecureStore.deleteItemAsync(SECURE_SESSION_KEY);
  jest.mocked(SecureStore.setItemAsync).mockClear();
  jest.mocked(SecureStore.getItemAsync).mockClear();
  jest.mocked(SecureStore.deleteItemAsync).mockClear();
  (fetch as jest.Mock).mockClear();
  // Seed every key so we can verify they are removed
  for (const key of ALL_STORAGE_KEYS) {
    if (key !== ASYNC_SESSION_KEY) await AsyncStorage.setItem(key, "some-value");
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  } as unknown as Response;
}

function textResponse(status: number): Response {
  return {
    ok: false,
    status,
    headers: { get: () => "text/html; charset=utf-8" },
    json: async () => { throw new Error("not JSON"); },
  } as unknown as Response;
}

describe("mobile authentication origin and errors", () => {
  it("uses the configured public API origin and sends the app version", async () => {
    const session = makeSession();
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, session));

    await expect(signInWithPassword("TEST@EXAMPLE.COM", "password123")).resolves.toEqual(session);
    const [url, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.verified.test/api/auth/signin");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-app-version")).toEqual(expect.any(String));
  });

  it("uses the versioned public API origin and normalizes an explicit /api suffix", () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    process.env.EXPO_PUBLIC_DOMAIN = "staging.verified.test";
    expect(resolveAuthApiBase()).toBe("https://app.verifiedtcg.co");

    process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.verified.test/api";
    expect(resolveAuthApiBase()).toBe("https://api.verified.test");
  });

  it("persists a successful signup session in SecureStore", async () => {
    const session = makeSession();
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(201, session));

    await expect(signUp("new@example.com", "password123", "New Collector")).resolves.toEqual(session);
    await expect(readPersistedSession()).resolves.toBe(JSON.stringify(session));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_SESSION_KEY,
      expect.any(String),
    );
  });

  it("keeps API validation and duplicate-account messages", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(400, { message: "Password must be at least 8 characters" }));
    await expect(signUp("new@example.com", "short", "New Collector")).rejects.toThrow("Password must be at least 8 characters");

    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(422, { message: "An account with that email already exists" }));
    await expect(signUp("new@example.com", "password123", "New Collector")).rejects.toThrow("An account with that email already exists");
  });

  it("uses a friendly message for bad credentials", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, { message: "Invalid email or password" }));
    await expect(signInWithPassword("test@example.com", "wrongpassword")).rejects.toThrow("Incorrect email or password.");
  });

  it("keeps a sanitized application 403 message", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(403, { message: "Account suspended — contact support" }));
    await expect(signInWithPassword("test@example.com", "password123")).rejects.toThrow("Account suspended — contact support");
  });

  it("does not expose upstream HTML for a non-JSON 403", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(textResponse(403));

    await expect(signInWithPassword("test@example.com", "password123")).rejects.toThrow("The authentication service could not be reached. Please try again.");
  });

  it("rotates an expired session with the server refresh response", async () => {
    const expired = makeSession();
    expired.expires_at = Math.floor(Date.now() / 1000) - 1;
    const refreshed = makeSession({ subscription_tier: "pro" });
    await setSession(expired);
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, refreshed));

    await expect(restoreSession()).resolves.toEqual(refreshed);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.verified.test/api/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("clears a session when refresh is rejected", async () => {
    const expired = makeSession();
    expired.expires_at = Math.floor(Date.now() / 1000) - 1;
    await setSession(expired);
    (fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, { message: "Session expired" }));

    await expect(restoreSession()).resolves.toBeNull();
    await expect(readPersistedSession()).resolves.toBeNull();
  });
});

async function setSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(SECURE_SESSION_KEY, JSON.stringify(session));
}

async function getSession(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SECURE_SESSION_KEY);
  return raw ? (JSON.parse(raw) as AuthSession) : null;
}

// ── restorePurchases ──────────────────────────────────────────────────────────

describe("restorePurchases", () => {
  it("returns the server tier and restored flag when server confirms Pro", async () => {
    // Seed a cached session (subscription_tier reflects stale local state)
    await setSession(makeSession({ subscription_tier: "free" }));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: "pro",
        is_founding_member: false,
        restored: true,
        message: "Your Pro subscription has been restored.",
      }),
    } as Response);

    const result = await restorePurchases();
    expect(result.subscription_tier).toBe("pro");
    expect(result.restored).toBe(true);
    expect(result.is_founding_member).toBe(false);
  });

  it("updates the cached session with the server-returned Pro tier", async () => {
    // Start with a free-tier session (simulates cleared-then-re-signed-in state)
    await setSession(makeSession({ subscription_tier: "free" }));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: "pro",
        is_founding_member: true,
        restored: true,
        message: "Your Pro subscription has been restored.",
      }),
    } as Response);

    await restorePurchases();

    const stored = await getSession();
    expect(stored).not.toBeNull();
    expect(stored!.user.user_metadata?.subscription_tier).toBe("pro");
    expect(stored!.user.user_metadata?.is_founding_member).toBe(true);
  });

  it("updates the cached session when the server returns free (e.g. chargeback)", async () => {
    // Start with a stale pro-tier session (server has since downgraded it)
    await setSession(makeSession({ subscription_tier: "pro" }));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: "free",
        is_founding_member: false,
        restored: false,
        message: "No active Pro subscription found on this account.",
      }),
    } as Response);

    const result = await restorePurchases();
    expect(result.subscription_tier).toBe("free");
    expect(result.restored).toBe(false);

    const stored = await getSession();
    expect(stored).not.toBeNull();
    expect(stored!.user.user_metadata?.subscription_tier).toBe("free");
  });

  it("preserves the access and refresh tokens when updating the session", async () => {
    const original = makeSession({ subscription_tier: "free" });
    await setSession(original);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscription_tier: "pro",
        is_founding_member: false,
        restored: true,
        message: "Your Pro subscription has been restored.",
      }),
    } as Response);

    await restorePurchases();

    const stored = await getSession();
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe(original.access_token);
    expect(stored!.refresh_token).toBe(original.refresh_token);
    expect(stored!.user.id).toBe(original.user.id);
  });

  it("throws when there is no session (simulates fresh reinstall before sign-in)", async () => {
    await AsyncStorage.clear();
    await expect(restorePurchases()).rejects.toThrow();
  });

  it("throws when the server returns a non-OK response", async () => {
    await setSession(makeSession());

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ message: "Invalid or expired token" }),
    } as Response);

    await expect(restorePurchases()).rejects.toThrow();
  });
});

describe("session migration", () => {
  it("moves a legacy AsyncStorage session into secure storage", async () => {
    const legacy = makeSession();
    await AsyncStorage.setItem(ASYNC_SESSION_KEY, JSON.stringify(legacy));

    await expect(readPersistedSession(true)).resolves.toBe(
      JSON.stringify(legacy),
    );
    await expect(SecureStore.getItemAsync(SECURE_SESSION_KEY)).resolves.toBe(
      JSON.stringify(legacy),
    );
    await expect(AsyncStorage.getItem(ASYNC_SESSION_KEY)).resolves.toBeNull();
  });
});

// ── signOut ───────────────────────────────────────────────────────────────────

describe("signOut", () => {
  it("clears all expected AsyncStorage keys", async () => {
    await signOut();

    for (const key of ALL_STORAGE_KEYS) {
      const value = await AsyncStorage.getItem(key);
      expect(value).toBeNull();
    }
  });

  it("succeeds even when AsyncStorage is already empty", async () => {
    await AsyncStorage.clear();
    await expect(signOut()).resolves.not.toThrow();
  });

  it("clears the auth session key in particular", async () => {
    await signOut();
    const session = await AsyncStorage.getItem(ASYNC_SESSION_KEY);
    expect(session).toBeNull();
  });

  it("clears the watchlist key", async () => {
    await signOut();
    const watchlist = await AsyncStorage.getItem("@verified_tcg/watchlist");
    expect(watchlist).toBeNull();
  });

  it("clears the scan state key", async () => {
    await signOut();
    const scanState = await AsyncStorage.getItem("@verified_tcg/scan_state");
    expect(scanState).toBeNull();
  });
});
