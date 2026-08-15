/**
 * Export Account Data screen — lets a signed-in collector download all their
 * data (profile + collection + wishlist) as a JSON file via the share sheet / Files app.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import colors from '@/constants/colors';
import { getAccessToken } from '@/services/auth';

const C = colors.dark;
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

export default function ExportAccountScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_BASE}/api/me/export/account.json`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const json = await res.json();
      const text = JSON.stringify(json, null, 2);

      if (Platform.OS === 'web') {
        // Web: trigger a browser download
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'account-data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // Native: write to a temp file then open the system share sheet
        const file = new File(Paths.cache, 'account-data.json');
        file.write(text);

        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'application/json',
            dialogTitle: 'Export Account Data',
            UTI: 'public.json',
          });
        } else {
          Alert.alert(
            'Sharing Unavailable',
            'Sharing is not available on this device. The file has been saved to app cache.',
          );
        }
      }
    } catch (err: any) {
      Alert.alert(
        'Export Failed',
        err?.message ?? 'Could not export your account data. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Export Account Data</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info card */}
      <View style={[styles.infoCard, { backgroundColor: C.card }]}>
        <View style={[styles.iconWrap, { backgroundColor: `${C.primary}22` }]}>
          <Feather name="download" size={28} color={C.primary} />
        </View>
        <Text style={styles.infoTitle}>Full Account Export</Text>
        <Text style={styles.infoBody}>
          Export a complete copy of all data associated with your Verified TCG account as a
          JSON file, including your profile, full collection, and wishlist.
        </Text>

        <View style={[styles.featureList, { borderColor: C.border }]}>
          {[
            'Profile information (name, bio, location)',
            'Full collection with card details',
            'Wishlist with grades and target prices',
            'Timestamps and metadata',
          ].map(f => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check" size={14} color={C.primary} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Privacy notice */}
      <View style={[styles.privacyNote, { backgroundColor: `${C.warning}11`, borderColor: `${C.warning}33` }]}>
        <Feather name="shield" size={16} color={C.warning} />
        <Text style={styles.privacyText}>
          This file contains your personal data. Keep it safe and only share it with trusted apps or services.
        </Text>
      </View>

      <Pressable
        onPress={handleExport}
        disabled={loading}
        style={({ pressed }) => [
          styles.exportBtn,
          { backgroundColor: pressed ? `${C.primary}cc` : C.primary },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Feather name="download" size={18} color="#FFF" />
            <Text style={styles.exportBtnText}>Export Account Data</Text>
          </>
        )}
      </Pressable>

      <Text style={styles.hint}>
        Your data export is generated in real-time and includes your most up-to-date
        information. On iOS it will open in Files; on Android it will be shared via your
        device's share sheet.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  infoCard: {
    borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center', gap: 12,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  infoTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  infoBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, lineHeight: 21, textAlign: 'center',
  },
  featureList: {
    alignSelf: 'stretch', borderTopWidth: 1, paddingTop: 14, marginTop: 4, gap: 10,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.foreground },
  privacyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 20,
  },
  privacyText: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular',
    color: C.foreground, lineHeight: 18,
  },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, height: 54, borderRadius: 16, marginBottom: 14,
  },
  exportBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFF' },
  hint: {
    fontSize: 12, fontFamily: 'Inter_400Regular',
    color: C.mutedForeground, textAlign: 'center', lineHeight: 18,
  },
});
