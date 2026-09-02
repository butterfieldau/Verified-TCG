/**
 * Import Collection screen — lets a signed-in collector import their
 * collection from a CSV file.
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
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import {
  previewImport,
  commitImport,
  ImportPreviewResponse,
  ImportCommitResponse,
} from '@/services/collectionImport';

const C = colors.dark;
const CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD'];
const MAX_IMPORT_BYTES = 1024 * 1024;

type ScreenState = 'select' | 'preview' | 'success';

async function readPickedCsv(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === 'web' && asset.file) {
    return asset.file.text();
  }

  // expo-file-system v19 removed the legacy readAsStringAsync export from
  // the default module. File.text() works with the copied file URI on iOS
  // and Android, and also gives us one reader for future native builds.
  return new File(asset.uri).text();
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export default function ImportCollectionScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { refreshCollection, refreshWishlist, refreshCollectionOrganization } = useApp();

  const [screenState, setScreenState] = useState<ScreenState>('select');
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewRes, setPreviewRes] = useState<ImportPreviewResponse | null>(null);
  const [commitRes, setCommitRes] = useState<ImportCommitResponse | null>(null);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      const content = await readPickedCsv(asset);

      if (!content.trim()) {
        throw new Error('The selected CSV is empty.');
      }
      if (utf8ByteLength(content) > MAX_IMPORT_BYTES) {
        throw new Error('This CSV is larger than the 1 MB import limit.');
      }

      setSelectedFile({ name: asset.name, content });
      setScreenState('select');
      setPreviewRes(null);
      setError(null);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : '';
      setError(message || 'Could not read the selected file. Please choose a CSV file from Files and try again.');
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError(null);
    try {
      const res = await previewImport({
        content: selectedFile.content,
        filename: selectedFile.name,
        sourceCurrency: currency,
      });
      setPreviewRes(res);
      setScreenState('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to preview the import. Please check your network connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!previewRes) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commitImport(previewRes.jobId, {
        contentSha256: previewRes.contentSha256,
        sourceCurrency: currency,
      });
      setCommitRes(res);
      setScreenState('success');
      await Promise.all([
        refreshCollection(),
        refreshWishlist(),
        refreshCollectionOrganization(),
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to commit the import.');
    } finally {
      setLoading(false);
    }
  };

  const downloadSkipped = async () => {
    if (!commitRes) return;
    
    // Build CSV of skipped rows
    const skipped = commitRes.rows.filter(r =>
      ['skipped', 'duplicate', 'wishlist_existing'].includes(r.status)
    );
    
    if (skipped.length === 0) return;

    const csvLines = ['Row,Status,Reason'];
    skipped.forEach(r => {
      const reason = (r.reason || '').replace(/"/g, '""');
      csvLines.push(`${r.rowNumber},${r.status},"${reason}"`);
    });
    const csv = csvLines.join('\n');

    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'skipped-rows.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, 'skipped-rows.csv');
        file.write(csv);
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            dialogTitle: 'Skipped Rows CSV',
            UTI: 'public.comma-separated-values-text',
          });
        } else {
          Alert.alert('Sharing Unavailable', 'Sharing is not available on this device.');
        }
      }
    } catch (err) {
      Alert.alert('Export Failed', 'Could not save the skipped rows report.');
    }
  };

  const renderError = () => {
    if (!error) return null;
    return (
      <View style={styles.errorBox}>
        <Feather name="alert-triangle" size={16} color={C.negative} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  };

  const renderSelectState = () => (
    <View style={styles.stateContainer}>
      <View style={[styles.infoCard, { backgroundColor: C.card }]}>
        <View style={[styles.iconWrap, { backgroundColor: `${C.primary}22` }]}>
          <Feather name="upload-cloud" size={28} color={C.primary} />
        </View>
        <Text style={styles.infoTitle}>Import Collection (CSV)</Text>
        <Text style={styles.infoBody}>
          Upload a CSV file containing your collection data. The system will match your cards and prepare a preview before saving.
        </Text>
      </View>

      <Pressable
        onPress={pickFile}
        style={({ pressed }) => [
          styles.pickBtn,
          { backgroundColor: pressed ? `${C.card}cc` : C.card }
        ]}
      >
        <Feather name="file-text" size={20} color={C.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.pickBtnTitle}>
            {selectedFile ? selectedFile.name : 'Select CSV File'}
          </Text>
          <Text style={styles.pickBtnSubtitle}>
            {selectedFile ? 'Tap to change file' : 'Tap to browse your device'}
          </Text>
        </View>
      </Pressable>

      {selectedFile && (
        <View style={styles.currencySection}>
          <Text style={styles.sectionTitle}>Source Currency</Text>
          <Text style={styles.sectionSubtitle}>
            Select the currency used for the purchase prices in your CSV.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
            {CURRENCIES.map(curr => (
              <Pressable
                key={curr}
                onPress={() => setCurrency(curr)}
                style={[
                  styles.currencyChip,
                  currency === curr && { backgroundColor: C.primary, borderColor: C.primary }
                ]}
              >
                <Text style={[styles.currencyText, currency === curr && { color: '#FFF' }]}>{curr}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {renderError()}

      <Pressable
        onPress={handlePreview}
        disabled={!selectedFile || loading}
        style={({ pressed }) => [
          styles.actionBtn,
          { backgroundColor: !selectedFile ? C.muted : pressed ? `${C.primary}cc` : C.primary }
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.actionBtnText}>Preview Import</Text>
        )}
      </Pressable>
    </View>
  );

  const renderPreviewState = () => {
    if (!previewRes) return null;
    const { summary } = previewRes;

    return (
      <View style={styles.stateContainer}>
        <View style={[styles.infoCard, { backgroundColor: C.card }]}>
          <Text style={styles.infoTitle}>Import Preview</Text>
          <Text style={styles.infoBody}>
            Please review the matching results before confirming. Ambiguous, invalid, and unmatched rows will be skipped.
          </Text>
        </View>

        <View style={styles.statsContainer}>
          <Text style={styles.statsTitle}>Ready to Add</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Collection Holdings</Text>
            <Text style={[styles.statValue, { color: C.positive }]}>{summary.matched}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Wishlist Only</Text>
            <Text style={[styles.statValue, { color: C.positive }]}>{summary.watchlistOnly}</Text>
          </View>
          {previewRes.schemaVersion >= 2 && (
            <>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>List Memberships</Text>
                <Text style={[styles.statValue, { color: C.positive }]}>
                  {summary.membershipCount ?? 0}
                </Text>
              </View>
              <Text style={[styles.statsTitle, { marginTop: 16 }]}>Custom Lists</Text>
              {(summary.listsToCreate ?? []).map(name => (
                <View key={`create-${name}`} style={styles.statRow}>
                  <Text style={styles.statLabel}>{name}</Text>
                  <Text style={[styles.listAction, { color: C.positive }]}>CREATE</Text>
                </View>
              ))}
              {(summary.listsToMerge ?? []).map(name => (
                <View key={`merge-${name}`} style={styles.statRow}>
                  <Text style={styles.statLabel}>{name}</Text>
                  <Text style={[styles.listAction, { color: C.warning }]}>MERGE</Text>
                </View>
              ))}
              {(summary.listCount ?? 0) === 0 && (
                <Text style={styles.emptyListText}>No custom lists are included in this file.</Text>
              )}
            </>
          )}

          <Text style={[styles.statsTitle, { marginTop: 16 }]}>To Be Skipped</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Unmatched</Text>
            <Text style={styles.statValue}>{summary.unmatched}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Ambiguous</Text>
            <Text style={styles.statValue}>{summary.ambiguous}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Invalid Data</Text>
            <Text style={styles.statValue}>{summary.invalid}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Duplicates</Text>
            <Text style={styles.statValue}>{summary.duplicate}</Text>
          </View>
        </View>

        <Text style={styles.reviewHeading}>Row review</Text>
        {previewRes.rows.filter(row => row.recordType !== 'list' || row.status !== 'valid').map((row) => (
          <View key={row.rowNumber} style={styles.reviewRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>
                Row {row.rowNumber}:{' '}
                {row.recordType === 'list'
                  ? String(row.name || 'Invalid list')
                  : String(row.card?.name || 'No canonical match')}
              </Text>
              <Text style={styles.reviewDetail}>
                {row.recordType === 'list'
                  ? row.error || 'Custom list definition'
                  : row.status === 'matched'
                  ? 'Collection holding'
                  : row.status === 'watchlist_only'
                    ? 'Wishlist addition'
                    : row.error || row.status}
              </Text>
              {row.supportedGrade === false && (
                <Text style={[styles.reviewDetail, { color: C.warning }]}>
                  Grade will be saved, but current pricing is unavailable.
                </Text>
              )}
            </View>
            <Text style={[
              styles.reviewStatus,
              { color: ['matched', 'watchlist_only'].includes(row.status) ? C.positive : C.mutedForeground },
            ]}>
              {row.status.replace(/_/g, ' ')}
            </Text>
          </View>
        ))}

        {renderError()}

        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => setScreenState('select')}
            disabled={loading}
            style={[styles.actionBtn, styles.secondaryBtn, { flex: 1 }]}
          >
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleCommit}
            disabled={loading}
            style={[styles.actionBtn, { flex: 1, backgroundColor: C.primary }]}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.actionBtnText}>Confirm Import</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  const renderSuccessState = () => {
    if (!commitRes) return null;
    const { summary } = commitRes;
    const hasSkipped = summary.skipped > 0 || summary.duplicates > 0;
    const totalChanges =
      summary.holdingsAdded +
      summary.wishlistAdded +
      (summary.listsCreated ?? 0) +
      (summary.membershipsAdded ?? 0);

    return (
      <View style={styles.stateContainer}>
        <View style={[styles.infoCard, { backgroundColor: C.card, alignItems: 'center' }]}>
          <View style={[styles.iconWrap, { backgroundColor: `${C.positive}22`, marginBottom: 12 }]}>
            <Feather name="check-circle" size={32} color={C.positive} />
          </View>
          <Text style={styles.infoTitle}>
            {totalChanges > 0
              ? 'Import Complete'
              : 'No New Items Added'}
          </Text>
          <Text style={styles.infoBody}>
            {totalChanges > 0
              ? `${summary.holdingsAdded} holding${summary.holdingsAdded === 1 ? '' : 's'}, ${summary.wishlistAdded} wishlist item${summary.wishlistAdded === 1 ? '' : 's'}, and ${summary.listsCreated ?? 0} custom list${summary.listsCreated === 1 ? '' : 's'} were added.`
              : 'Every row was skipped or already existed. Your collection, wishlist, and custom lists were not changed.'}
          </Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Holdings Added</Text>
            <Text style={[styles.statValue, { color: C.positive }]}>{summary.holdingsAdded}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Wishlist Added</Text>
            <Text style={[styles.statValue, { color: C.positive }]}>{summary.wishlistAdded}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Duplicates Skipped</Text>
            <Text style={styles.statValue}>{summary.duplicates}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Other Skipped</Text>
            <Text style={styles.statValue}>{summary.skipped}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Unsupported Grades</Text>
            <Text style={styles.statValue}>{summary.unsupportedGrades}</Text>
          </View>
          {(summary.listsCreated !== undefined || summary.listsMerged !== undefined) && (
            <>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Lists Created</Text>
                <Text style={[styles.statValue, { color: C.positive }]}>{summary.listsCreated ?? 0}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Lists Merged</Text>
                <Text style={styles.statValue}>{summary.listsMerged ?? 0}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Memberships Added</Text>
                <Text style={[styles.statValue, { color: C.positive }]}>{summary.membershipsAdded ?? 0}</Text>
              </View>
            </>
          )}
        </View>

        {hasSkipped && (
          <Pressable
            onPress={downloadSkipped}
            style={({ pressed }) => [
              styles.secondaryBtn,
              styles.downloadBtn,
              pressed && { backgroundColor: `${C.muted}cc` }
            ]}
          >
            <Feather name="download" size={16} color={C.foreground} />
            <Text style={styles.secondaryBtnText}>Download Skipped Rows Report</Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => router.back()}
          style={[styles.actionBtn, { backgroundColor: C.primary, marginTop: 'auto' }]}
        >
          <Text style={styles.actionBtnText}>Done</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: C.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Import Collection</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {screenState === 'select' && renderSelectState()}
        {screenState === 'preview' && renderPreviewState()}
        {screenState === 'success' && renderSuccessState()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  stateContainer: { flex: 1 },
  
  infoCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  infoTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground, textAlign: 'center' },
  infoBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 21,
    textAlign: 'center',
  },

  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
    gap: 16,
  },
  pickBtnTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    marginBottom: 4,
  },
  pickBtnSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },

  currencySection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginBottom: 8,
  },
  currencyChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  currencyText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${C.negative}22`,
    padding: 14,
    borderRadius: 12,
    marginBottom: 20,
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.negative,
  },

  actionBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  actionBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#FFF',
  },
  secondaryBtn: {
    backgroundColor: C.muted,
  },
  secondaryBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },

  statsContainer: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  reviewHeading: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    marginTop: 4,
    marginBottom: 8,
  },
  reviewRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    marginBottom: 8,
  },
  reviewTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  reviewDetail: {
    marginTop: 3,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  reviewStatus: {
    maxWidth: 90,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  statsTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  statLabel: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: C.foreground,
  },
  statValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  listAction: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  emptyListText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },

  downloadBtn: {
    flexDirection: 'row',
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
});
