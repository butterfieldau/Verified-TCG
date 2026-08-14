/**
 * Push notification registration — scaffolded MVP.
 *
 * Requests notification permission (contextually, not on first launch),
 * obtains the Expo push token, and registers it with the server so future
 * server-side notification delivery can reach this device.
 *
 * Out of scope: actual locked-screen push delivery (deferred).
 * In scope: token acquisition, server registration, graceful no-ops on simulators.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { registerPushToken } from './notifications';

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

/**
 * Request notification permissions and register the Expo push token with the server.
 *
 * Safe to call multiple times — the server upserts on conflict.
 * No-ops silently when:
 *   - Running on a simulator (physical device required for push tokens)
 *   - Permission is denied
 *   - Token acquisition fails
 *
 * Call this AFTER the user is authenticated and has had a chance to understand
 * why permissions are needed (contextual request, not on cold-launch).
 */
export async function requestAndRegisterPushToken(): Promise<void> {
  // Push tokens only work on physical devices
  if (!Device.isDevice) return;

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Verified TCG',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  try {
    // requestPermissionsAsync() is idempotent — it returns current permission
    // if already granted rather than prompting again on iOS.
    const result = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: false,
      },
    });
    // expo-notifications PermissionResponse: granted is a bool on the response
    const granted = (result as unknown as { granted?: boolean }).granted ?? false;
    if (!granted) return; // user declined — respect their choice

    // Resolve the EAS project UUID from two sources:
    //   1. Constants.easConfig.projectId  — populated only during EAS builds
    //   2. Constants.expoConfig.extra.eas.projectId — from app.json (dev/preview builds)
    // Validate it is a proper UUID before calling getExpoPushTokenAsync to avoid
    // hard-to-diagnose errors from passing a slug or placeholder value.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const easConfigId = (Constants.easConfig as Record<string, string> | undefined)?.['projectId'];
    const extra = Constants.expoConfig?.extra as Record<string, Record<string, string>> | undefined;
    const appJsonId = extra?.['eas']?.['projectId'];
    const projectId: string | undefined = easConfigId ?? appJsonId;
    if (!projectId || !uuidPattern.test(projectId)) return; // no valid UUID — skip token acquisition

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    if (token) {
      await registerPushToken(token);
    }
  } catch {
    // Non-critical — push delivery is deferred; silently swallow all errors
  }
}
