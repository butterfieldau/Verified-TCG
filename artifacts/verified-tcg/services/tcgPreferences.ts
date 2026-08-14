/**
 * TCG preference persistence helpers.
 *
 * Syncs the collector's preferred TCG selections between AsyncStorage
 * and the server. The key is scoped to sign-out: `ALL_STORAGE_KEYS` in
 * auth.ts includes this key, so it is wiped on sign-out / account deletion —
 * preventing one account's choices from being pushed to a different account
 * that later signs in on the same device.
 *
 * Conflict rule: local value wins on sign-in (push local → server).
 * When no local value exists (fresh install / new device), the server value
 * is written to AsyncStorage so subsequent sign-outs clear it correctly.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PREFERRED_TCGS_KEY = '@verified_tcg/preferred_tcgs';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * Save selected TCGs locally and sync to the API when a token is available.
 * Called from the onboarding screen after the user selects games.
 */
export async function savePreferredTcgs(
  games: string[],
  accessToken?: string,
): Promise<void> {
  const joined = games.join(',');
  await AsyncStorage.setItem(PREFERRED_TCGS_KEY, joined);

  const token = accessToken ?? (await getStoredAccessToken());
  if (token) {
    syncToApi(joined, token).catch(() => {});
  }
}

/**
 * Bidirectional sync called after every sign-in or session restore.
 *
 * - If a local preference exists → push it to the server (local wins,
 *   so onboarding choices made before sign-in are never lost).
 * - If no local preference → write the server's stored value locally,
 *   so cross-device and reinstall restoration works.
 *
 * Fire-and-forget safe — all errors are swallowed.
 */
export function syncPreferredTcgsAfterSignIn(
  accessToken: string,
  /** preferred_tcgs value from the server's sign-in response (user_metadata). */
  serverValue?: string | null,
): void {
  AsyncStorage.getItem(PREFERRED_TCGS_KEY)
    .then(async (local) => {
      if (local) {
        // Local value exists — push it to the server (onboarding-before-signup path)
        await syncToApi(local, accessToken);
      } else if (serverValue) {
        // No local value but server has one — hydrate locally (reinstall / new device)
        await AsyncStorage.setItem(PREFERRED_TCGS_KEY, serverValue);
      }
      // If neither exists, nothing to do
    })
    .catch(() => {/* swallow */});
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getStoredAccessToken(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem('@verified_tcg/auth_session');
    if (!raw) return null;
    const session = JSON.parse(raw) as { access_token?: string };
    return session.access_token ?? null;
  } catch {
    return null;
  }
}

async function syncToApi(joined: string, accessToken: string): Promise<void> {
  await fetch(`${API_BASE}/api/auth/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ data: { preferred_tcgs: joined } }),
  });
}
