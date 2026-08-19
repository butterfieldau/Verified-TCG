/**
 * Settings persistence layer.
 *
 * Persists user preferences for appearance, currency, notification toggles,
 * and privacy toggles to AsyncStorage under `@verified_tcg/settings`.
 *
 * Design: same atomic-write pattern as alertsStore — the in-memory object is
 * the single source of truth; this module just serialises/deserialises it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETTINGS_STORAGE_KEY = '@verified_tcg/settings';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type CurrencyCode = 'AUD' | 'USD' | 'GBP' | 'EUR' | 'CAD' | 'NZD';

export interface NotificationPrefs {
  priceAlerts: boolean;
  tradeMatches: boolean;
  events: boolean;
  community: boolean;
  giveaways: boolean;
  marketing: boolean;
}

export interface PrivacyPrefs {
  publicProfile: boolean;
  showCollection: boolean;
  showWishlist: boolean;
  showForTrade: boolean;
  showForSale: boolean;
}

export interface AppSettings {
  appearance: AppearanceMode;
  currency: CurrencyCode;
  /**
   * Master push-notification toggle — collector-controlled opt-in/opt-out.
   * When false, push token registrations do NOT re-enable push delivery.
   * Default is true (opt-in) for new installs; loaded from server on sign-in.
   * Stored locally so the UI reflects the last-known state without a round-trip.
   */
  masterPushEnabled: boolean;
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'dark',
  currency: 'AUD',
  masterPushEnabled: true,
  notifications: {
    priceAlerts: true,
    tradeMatches: true,
    events: true,
    community: false,
    giveaways: false,
    marketing: false,
  },
  privacy: {
    publicProfile: true,
    showCollection: true,
    showWishlist: true,
    showForTrade: true,
    showForSale: false,
  },
};

/**
 * Load persisted settings from AsyncStorage.
 * Returns DEFAULT_SETTINGS merged with any stored values so missing keys
 * (added in future versions) always have a sensible default.
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      appearance: parsed.appearance ?? DEFAULT_SETTINGS.appearance,
      currency: parsed.currency ?? DEFAULT_SETTINGS.currency,
      masterPushEnabled: parsed.masterPushEnabled ?? DEFAULT_SETTINGS.masterPushEnabled,
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...(parsed.privacy ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Atomically overwrite the settings store with the complete current settings.
 * Errors are silently swallowed — in-memory state is still correct.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage write failed; in-memory settings remain authoritative
  }
}
