/**
 * Settings Context
 *
 * Provides app-wide access to user preferences (appearance, currency,
 * notification toggles, privacy toggles) backed by AsyncStorage.
 *
 * Wrap the app in <SettingsProvider> (inside AppProvider in _layout.tsx).
 * Consume with useSettings() in any screen.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  type AppSettings,
  type AppearanceMode,
  type CurrencyCode,
  type NotificationPrefs,
  type PrivacyPrefs,
} from '@/services/settingsStore';
import { recordStartupPhase } from '@/services/startupDiagnostics';

interface SettingsContextType extends AppSettings {
  settingsLoaded: boolean;
  updateAppearance: (mode: AppearanceMode) => void;
  updateCurrency: (code: CurrencyCode) => void;
  /**
   * Set the master push-enabled flag locally (the caller is responsible for
   * also calling setPushPreference() on the server and showing any error).
   */
  setMasterPushEnabled: (enabled: boolean) => void;
  updateNotificationPref: (key: keyof NotificationPrefs, value: boolean) => void;
  updatePrivacyPref: (key: keyof PrivacyPrefs, value: boolean) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load from AsyncStorage on mount
  useEffect(() => {
    recordStartupPhase('settings-provider', 'started');
    loadSettings().then(loaded => {
      setSettings(loaded);
      setSettingsLoaded(true);
      recordStartupPhase('settings-provider', 'success');
    }).catch(error => {
      setSettingsLoaded(true);
      recordStartupPhase('settings-provider', 'failure', error, false);
    });
  }, []);

  // Persist whenever settings change (after initial load)
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings(settings).catch(() => {});
  }, [settings, settingsLoaded]);

  const updateAppearance = useCallback((mode: AppearanceMode) => {
    setSettings(prev => ({ ...prev, appearance: mode }));
  }, []);

  const updateCurrency = useCallback((code: CurrencyCode) => {
    setSettings(prev => ({ ...prev, currency: code }));
  }, []);

  const setMasterPushEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, masterPushEnabled: enabled }));
  }, []);

  const updateNotificationPref = useCallback((key: keyof NotificationPrefs, value: boolean) => {
    setSettings(prev => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value },
    }));
  }, []);

  const updatePrivacyPref = useCallback((key: keyof PrivacyPrefs, value: boolean) => {
    setSettings(prev => ({
      ...prev,
      privacy: { ...prev.privacy, [key]: value },
    }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        settingsLoaded,
        updateAppearance,
        updateCurrency,
        setMasterPushEnabled,
        updateNotificationPref,
        updatePrivacyPref,
        resetSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
