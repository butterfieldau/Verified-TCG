import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppProvider } from '@/context/AppContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { NetworkProvider } from '@/context/NetworkContext';
import { OfflineBanner } from '@/components/OfflineBanner';
import { RuntimeConfigGate } from '@/components/RuntimeConfigGate';
import { installVersionedApiFetch } from '@/services/platformRuntime';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  Rajdhani_600SemiBold,
  Rajdhani_700Bold,
} from '@expo-google-fonts/rajdhani';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { recordStartupPhase } from '@/services/startupDiagnostics';

recordStartupPhase('api-fetch-install', 'started');
try {
  installVersionedApiFetch();
  recordStartupPhase('api-fetch-install', 'success');
} catch (error) {
  recordStartupPhase('api-fetch-install', 'failure', error, true);
  throw error;
}

// Prevent the native splash screen from auto-hiding before assets are loaded.
recordStartupPhase('splash-setup', 'started');
void SplashScreen.preventAutoHideAsync()
  .then(() => recordStartupPhase('splash-setup', 'success'))
  .catch((error) => recordStartupPhase('splash-setup', 'failure', error, false));

recordStartupPhase('font-load', 'started');

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="splash" />
      <Stack.Screen name="welcome" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="sign-in" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="create-account" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="forgot-password" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="reset-password" options={{ animation: 'slide_from_right' }} />
      {/* The tab shell is the authenticated root. It must never expose a
          previous tab route through iOS's interactive back gesture. */}
      <Stack.Screen
        name="(tabs)"
        options={{
          gestureEnabled: false,
          animation: 'none',
        }}
      />
      <Stack.Screen
        name="scan"
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="card/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
      <Stack.Screen
        name="add-card"
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="edit-profile" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="portfolio" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="import-collection" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="collection-insights" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="collection-archive" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="verification-info" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="sell" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="trade" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="watchlist" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="wishlist" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="collector/[username]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="pro-identity" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen
        name="pro-subscription"
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />
      <Stack.Screen name="verified-drops" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="pro-perks" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="appearance" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="currency-select" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="help-support" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="contact-support" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="terms" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="privacy-policy" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="about" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
  });

  useEffect(() => {
    if (fontError) recordStartupPhase('font-load', 'failure', fontError, false);
    if (fontsLoaded) recordStartupPhase('font-load', 'success');
    if (!fontsLoaded && !fontError) return;

    if (typeof document !== 'undefined') {
      document.getElementById('startup-splash')?.remove();
      document.getElementById('startup-splash-styles')?.remove();
    }

    void SplashScreen.hideAsync().catch((error) => {
      recordStartupPhase('splash-setup', 'failure', error, false);
    });
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <NetworkProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <SettingsProvider>
                  <RuntimeConfigGate>
                    <AppProvider>
                      <OfflineBanner />
                      <RootLayoutNav />
                    </AppProvider>
                  </RuntimeConfigGate>
                </SettingsProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </NetworkProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
