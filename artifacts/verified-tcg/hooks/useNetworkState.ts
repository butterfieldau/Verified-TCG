import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';

export interface NetworkState {
  isConnected: boolean;
  /** ISO string of the last time we confirmed online status, or null if never. */
  lastOnlineAt: string | null;
  /** Re-run the connectivity check manually. */
  recheckConnectivity: () => void;
}

export function useNetworkState(): NetworkState {
  const [isConnected, setIsConnected] = useState(true);
  const [lastOnlineAt, setLastOnlineAt] = useState<string | null>(null);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkConnectivity = useCallback(async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      const connected = !!(state.isConnected && state.isInternetReachable !== false);
      setIsConnected(connected);
      if (connected) {
        setLastOnlineAt(new Date().toISOString());
      }
    } catch {
      // If the check itself fails, assume we are offline
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    // Check on mount
    checkConnectivity();

    // Poll every 5 s while app is foregrounded
    pollInterval.current = setInterval(checkConnectivity, 5000);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') checkConnectivity();
      if (state === 'background' && pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
      if (state === 'active' && !pollInterval.current) {
        pollInterval.current = setInterval(checkConnectivity, 5000);
      }
    });

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
      sub.remove();
    };
  }, [checkConnectivity]);

  return { isConnected, lastOnlineAt, recheckConnectivity: checkConnectivity };
}
