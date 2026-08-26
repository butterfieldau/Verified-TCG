/**
 * Export Collection screen — lets a signed-in collector download their
 * collection as a CSV file via the native share sheet / Files app.
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
import { apiRequest } from '@/services/apiClient';
import { useApp } from '@/context/AppContext';

const C = colors.dark;

export default function ExportCollectionScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { collection } = useApp();
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await apiRequest('/api/me/export/collection.csv', { accessToken: token });

      const csv = await res.text();

      if (Platform.OS === 'web') {
        // Web: trigger a browser download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'collection.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // Native: write to a temp file then open the system share sheet
        const file = new File(Paths.cache, 'collection.csv');
        file.write(csv);

        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            dialogTitle: 'Export Collection CSV',
            UTI: 'public.comma-separated-values-text',
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
        err?.message ?? 'Could not export your collection. Please try again.',
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
        <Text style={styles.title}>Export Collection</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info card */}
      <View style={[styles.infoCard, { backgroundColor: C.card }]}>
        <View style={[styles.iconWrap, { backgroundColor: `${C.primary}22` }]}>
          <Feather name="list" size={28} color={C.primary} />
        </View>
        <Text style={styles.infoTitle}>Collection CSV Export</Text>
        <Text style={styles.infoBody}>
          Export your entire collection as a CSV file. The file includes card name, set,
          condition, grade, purchase price, and current market value for all{' '}
          <Text style={{ color: C.primary, fontFamily: 'Inter_600SemiBold' }}>
            {collection.length}
          </Text>{' '}
          {collection.length === 1 ? 'card' : 'cards'} in your collection.
        </Text>

        <View style={[styles.featureList, { borderColor: C.border }]}>
          {[
            'Card name, set, and number',
            'Condition and grade information',
            'Purchase price and current value',
            'For-sale and for-trade flags',
            'Acquisition date and notes',
          ].map(f => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check" size={14} color={C.primary} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      <Pressable
        onPress={handleExport}
        disabled={loading || collection.length === 0}
        style={({ pressed }) => [
          styles.exportBtn,
          {
            backgroundColor:
              collection.length === 0 ? C.muted : pressed ? `${C.primary}cc` : C.primary,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Feather name="download" size={18} color="#FFF" />
            <Text style={styles.exportBtnText}>
              {collection.length === 0 ? 'No cards to export' : 'Export as CSV'}
            </Text>
          </>
        )}
      </Pressable>

      <Text style={styles.hint}>
        The CSV file can be opened in Microsoft Excel, Google Sheets, or any spreadsheet app.
        On iOS it will open in Files; on Android it will be shared via your device's share sheet.
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
    borderRadius: 16, padding: 20, marginBottom: 20, alignItems: 'center', gap: 12,
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
