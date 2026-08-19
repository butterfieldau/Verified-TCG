/**
 * Push notification registration — scaffolded MVP.
 *
 * Exports two functions with different permission-request behaviours:
 *
 * `registerPushTokenIfPermitted()` — silent, no OS prompt.
 *   Use after sign-in / session restore.  Registers the token only when the
 *   user has already granted permission; never prompts for it.
 *
 * `requestAndRegisterPushToken()` — contextual, may show OS prompt.
 *   Use only at a moment the user understands why notifications are needed
 *   (e.g. the onboarding "Price Alerts" card or the first price-alert toggle).
 *   On iOS, `requestPermissionsAsync` is idempotent — it returns the existing
 *   state without prompting if the user has already decided.
 *
 * Out of scope: actual locked-screen push delivery (deferred).
 * In scope: token acquisition, server registration, graceful no-ops on simulators.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerPushToken, fetchNotificationPreferences } from './notifications';

/**
 * Configure how notifications are presented while the app is in the foreground.
 * Call once at app startup (before any permission request).
 */
export function configureForegroundNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

/** Shared helper that acquires and registers the push token when permission is granted.
 *  Before registering, checks the server-side collector preference: if the collector
 *  has explicitly opted out (source=collector_preference, pushEnabled=false), the token
 *  registration is skipped so the opt-out is never silently re-enabled on token refresh.
 */
async function registerTokenIfGranted(granted: boolean): Promise<void> {
  if (!granted) return;

  // Guard against silent re-opt-in: check the server preference first.
  // If the server has an explicit collector opt-out, do not register the token.
  try {
    const pref = await fetchNotificationPreferences();
    if (pref && pref.source === 'collector_preference' && pref.pushEnabled === false) {
      // Collector has explicitly opted out — respect that decision.
      return;
    }
  } catch {
    // If we can't reach the server, fall through and register normally.
    // The server-side register-push-token handler also guards opt-outs.
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const easConfigId = (Constants.easConfig as Record<string, string> | undefined)?.['projectId'];
  const extra = Constants.expoConfig?.extra as Record<string, Record<string, string>> | undefined;
  const appJsonId = extra?.['eas']?.['projectId'];
  const projectId: string | undefined = easConfigId ?? appJsonId;
  if (!projectId || !uuidPattern.test(projectId)) return;

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;
  if (token) {
    await registerPushToken(token);
  }
}

/** Shared Android channel setup. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Verified TCG',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/**
 * Silent registration — no OS permission prompt.
 *
 * Reads the current permission state with `getPermissionsAsync()` and registers
 * the push token only if the user has already granted notification permission.
 *
 * Safe to call after every sign-in; will not prompt the user.
 */
export async function registerPushTokenIfPermitted(): Promise<void> {
  if (!Device.isDevice) return;
  try {
    await ensureAndroidChannel();
    const { granted } = await Notifications.getPermissionsAsync();
    await registerTokenIfGranted(granted);
  } catch {
    // Non-critical — push delivery is deferred; silently swallow all errors
  }
}

/**
 * Contextual registration — may show the OS permission prompt.
 *
 * Call only when the user has been shown an explanation of why notifications
 * are needed (e.g. the onboarding "Price Alerts" opt-in card, or when the
 * user first enables a price alert).
 *
 * On iOS, `requestPermissionsAsync` is idempotent: if the user has already
 * decided (granted or denied), the OS returns the current state without
 * showing the prompt again.
 *
 * Returns true if permission was granted, false otherwise.
 */
export async function requestAndRegisterPushToken(): Promise<boolean> {
  if (!Device.isDevice) return false;
  try {
    await ensureAndroidChannel();
    const result = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: false,
      },
    });
    const granted = (result as unknown as { granted?: boolean }).granted ?? false;
    await registerTokenIfGranted(granted);
    return granted;
  } catch {
    // Non-critical — push delivery is deferred; silently swallow all errors
    return false;
  }
}
