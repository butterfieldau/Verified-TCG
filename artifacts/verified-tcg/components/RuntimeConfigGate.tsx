import React, { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import {
  APP_VERSION,
  fetchRuntimeConfig,
  onUpdateRequired,
  type RuntimeConfig,
  type UpdateRequirement,
  updateRequirementFromConfig,
} from '@/services/platformRuntime';

const C = colors.dark;

function BlockingState({
  icon,
  title,
  message,
  detail,
  onRetry,
}: {
  icon: 'refresh-cw' | 'tool';
  title: string;
  message: string;
  detail?: string;
  onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 67 : insets.top;
  return (
    <View style={[styles.blocking, { paddingTop: top, paddingBottom: insets.bottom }]}>
      <View style={styles.iconBox}>
        <Feather name={icon} size={28} color={C.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
      >
        <Text style={styles.retryText}>Check again</Text>
      </Pressable>
    </View>
  );
}

export function RuntimeConfigGate({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [updateRequired, setUpdateRequired] = useState<UpdateRequirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchRuntimeConfig();
      setConfig(next);
      setUpdateRequired(updateRequirementFromConfig(next));
    } catch {
      // Preserve offline-capable app behavior. Protected API requests still
      // enforce policy server-side and a 426 response activates this gate.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribeUpdate = onUpdateRequired(setUpdateRequired);
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      unsubscribeUpdate();
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [refresh]);

  if (loading && !config && !updateRequired) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.primary} />
        <Text style={styles.loadingText}>Checking service status…</Text>
      </View>
    );
  }

  if (updateRequired) {
    return (
      <BlockingState
        icon="refresh-cw"
        title="Update required"
        message={updateRequired.message}
        detail={`Installed ${updateRequired.currentVersion ?? APP_VERSION} · Required ${updateRequired.minimumVersion}`}
        onRetry={() => void refresh()}
      />
    );
  }

  if (config?.maintenanceMode) {
    return (
      <BlockingState
        icon="tool"
        title="Scheduled maintenance"
        message={
          config.maintenanceMessage ??
          'Verified TCG is temporarily unavailable while maintenance is completed.'
        }
        onRetry={() => void refresh()}
      />
    );
  }

  const announcement =
    config?.remoteAnnouncement &&
    config.remoteAnnouncement !== dismissedAnnouncement
      ? config.remoteAnnouncement
      : null;

  return (
    <View style={styles.app}>
      {children}
      {announcement ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.announcement,
            { top: Platform.OS === 'web' ? 67 : insets.top },
          ]}
        >
          <Feather name="info" size={16} color={C.primaryForeground} />
          <Text style={styles.announcementText}>{announcement}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss announcement"
            hitSlop={12}
            onPress={() => setDismissedAnnouncement(announcement)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Feather name="x" size={17} color={C.primaryForeground} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: C.background,
  },
  loadingText: {
    color: C.mutedForeground,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  blocking: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: C.background,
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    marginBottom: 24,
  },
  title: {
    color: C.foreground,
    fontFamily: 'Rajdhani_700Bold',
    fontSize: 28,
    textAlign: 'center',
  },
  message: {
    color: C.mutedForeground,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 420,
  },
  detail: {
    color: C.foreground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginTop: 14,
  },
  retryButton: {
    minHeight: 46,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: colors.radius,
    backgroundColor: C.primary,
    marginTop: 28,
    paddingHorizontal: 24,
  },
  retryText: {
    color: C.primaryForeground,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  pressed: { opacity: 0.72 },
  announcement: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: colors.radius,
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  announcementText: {
    flex: 1,
    color: C.primaryForeground,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
});