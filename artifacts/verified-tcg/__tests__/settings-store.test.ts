/**
 * Settings store tests
 *
 * Verifies that loadSettings and saveSettings work correctly, including
 * default values and AsyncStorage round-trips.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type AppSettings,
} from '../services/settingsStore';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('loadSettings', () => {
  it('returns DEFAULT_SETTINGS when nothing is stored', async () => {
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the stored settings after saving', async () => {
    const custom: AppSettings = {
      ...DEFAULT_SETTINGS,
      appearance: 'light',
      currency: 'USD',
    };
    await saveSettings(custom);
    const loaded = await loadSettings();
    expect(loaded.appearance).toBe('light');
    expect(loaded.currency).toBe('USD');
  });

  it('merges stored settings with defaults so new keys have fallback values', async () => {
    // Simulate an old stored blob missing the notifications.giveaways field
    const partial = {
      appearance: 'dark',
      currency: 'GBP',
      notifications: { priceAlerts: false },
    };
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(partial));
    const loaded = await loadSettings();
    expect(loaded.currency).toBe('GBP');
    // Missing keys come from DEFAULT_SETTINGS
    expect(loaded.notifications.tradeMatches).toBe(DEFAULT_SETTINGS.notifications.tradeMatches);
    expect(loaded.privacy).toEqual(DEFAULT_SETTINGS.privacy);
  });

  it('returns DEFAULT_SETTINGS when stored JSON is corrupted', async () => {
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, 'not-valid-json{{{');
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('persists a complete settings object', async () => {
    const custom: AppSettings = {
      ...DEFAULT_SETTINGS,
      appearance: 'light',
      notifications: { ...DEFAULT_SETTINGS.notifications, marketing: true },
    };
    await saveSettings(custom);
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.appearance).toBe('light');
    expect(parsed.notifications.marketing).toBe(true);
  });

  it('round-trips correctly for all default values', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const loaded = await loadSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });
});
