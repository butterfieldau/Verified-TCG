/**
 * Sell / Archive Modal
 *
 * Validates sale price, date, currency, and optional fields (notes, venue, buyer).
 * On confirm calls sellCollectionItem() and notifies the parent via onSold().
 * Distinct from destructive delete — this records the sale for P/L tracking.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { sellCollectionItem, type SellRequest } from '@/services/collectionPerformance';
import type { CollectionItem } from '@/types';

const C = colors.dark;

interface SellModalProps {
  item: CollectionItem;
  displayCurrency: string;
  onClose: () => void;
  onSold: (itemId: string) => void;
}

export default function SellModal({ item, displayCurrency, onClose, onSold }: SellModalProps) {
  const [salePrice, setSalePrice] = useState('');
  const [currency, setCurrency] = useState(displayCurrency ?? 'AUD');
  const [soldAt, setSoldAt] = useState(() => new Date().toISOString().split('T')[0]!);
  const [notes, setNotes] = useState('');
  const [venue, setVenue] = useState('');
  const [buyer, setBuyer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const CURRENCY_OPTIONS = ['AUD', 'USD', 'GBP', 'EUR', 'CAD', 'NZD'];
  const VENUE_OPTIONS = ['eBay', 'TCGPlayer', 'Whatnot', 'Local', 'PWCC', 'Other'];

  async function validateAndSubmit() {
    const price = parseFloat(salePrice);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid sale price greater than zero.');
      return;
    }
    // Basic date validation YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(soldAt)) {
      Alert.alert('Invalid Date', 'Please enter a date in YYYY-MM-DD format.');
      return;
    }
    const saleDate = new Date(soldAt);
    if (isNaN(saleDate.getTime())) {
      Alert.alert('Invalid Date', 'The date you entered is not valid.');
      return;
    }

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setSubmitting(true);
    try {
      const req: SellRequest = {
        salePrice: price,
        currency,
        soldAt,
        notes: notes.trim() || undefined,
        venue: venue.trim() || undefined,
        buyer: buyer.trim() || undefined,
      };
      await sellCollectionItem(item.id, req);
      onSold(item.id);
      onClose();
    } catch (e: unknown) {
      Alert.alert('Sale Failed', (e as Error).message ?? 'Unable to record sale. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.overlay}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.panel, { backgroundColor: C.card }]}>
        <View style={styles.handle} />
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.panelTitle}>Record Sale</Text>
            <Text style={styles.panelSub}>{item.card.name}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={20} color={C.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          {/* Sale Price */}
          <Text style={styles.fieldLabel}>Sale Price <Text style={styles.required}>*</Text></Text>
          <View style={[styles.inputRow, { backgroundColor: C.muted }]}>
            <Text style={styles.inputPrefix}>{currency}</Text>
            <TextInput
              style={styles.input}
              value={salePrice}
              onChangeText={(value) => {
                setSalePrice(value);
                setConfirming(false);
              }}
              placeholder="0.00"
              placeholderTextColor={C.mutedForeground}
              keyboardType="decimal-pad"
              returnKeyType="done"
              accessibilityLabel="Sale price"
            />
          </View>

          {/* Currency */}
          <Text style={styles.fieldLabel}>Currency</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {CURRENCY_OPTIONS.map(c => (
              <Pressable
                key={c}
                onPress={() => setCurrency(c)}
                style={[styles.chip, currency === c && styles.chipActive]}
                accessibilityRole="button"
                accessibilityLabel={`Currency ${c}`}
                accessibilityState={{ selected: currency === c }}
                hitSlop={4}
              >
                <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Date */}
          <Text style={styles.fieldLabel}>Sale Date <Text style={styles.required}>*</Text></Text>
          <View style={[styles.inputRow, { backgroundColor: C.muted }]}>
            <TextInput
              style={[styles.input, { paddingLeft: 14 }]}
              value={soldAt}
              onChangeText={setSoldAt}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={C.mutedForeground}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              accessibilityLabel="Sale date"
            />
          </View>

          {/* Venue */}
          <Text style={styles.fieldLabel}>Venue <Text style={styles.optional}>(optional)</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {VENUE_OPTIONS.map(v => (
              <Pressable
                key={v}
                onPress={() => setVenue(prev => prev === v ? '' : v)}
                style={[styles.chip, venue === v && styles.chipActive]}
                accessibilityRole="button"
                accessibilityLabel={`Venue ${v}`}
                accessibilityState={{ selected: venue === v }}
                hitSlop={4}
              >
                <Text style={[styles.chipText, venue === v && styles.chipTextActive]}>{v}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Buyer (optional) */}
          <Text style={styles.fieldLabel}>Buyer <Text style={styles.optional}>(optional)</Text></Text>
          <View style={[styles.inputRow, { backgroundColor: C.muted }]}>
            <TextInput
              style={[styles.input, { paddingLeft: 14 }]}
              value={buyer}
              onChangeText={setBuyer}
              placeholder="Username or name"
              placeholderTextColor={C.mutedForeground}
              returnKeyType="done"
              accessibilityLabel="Buyer"
            />
          </View>

          {/* Notes (optional) */}
          <Text style={styles.fieldLabel}>Notes <Text style={styles.optional}>(optional)</Text></Text>
          <View style={[styles.inputRow, { backgroundColor: C.muted, height: 72, alignItems: 'flex-start', paddingVertical: 10 }]}>
            <TextInput
              style={[styles.input, { paddingLeft: 14, height: 52, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes…"
              placeholderTextColor={C.mutedForeground}
              multiline
              accessibilityLabel="Notes"
            />
          </View>

          <View style={{ height: 16 }} />
        </ScrollView>

        {/* Actions */}
        {confirming ? (
          <Text style={styles.confirmationText}>
            Confirm {currency} {parseFloat(salePrice).toLocaleString('en-AU', { minimumFractionDigits: 2 })} total proceeds and move this holding to Archive.
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            onPress={onClose}
            style={[styles.cancelBtn, { backgroundColor: C.muted }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.cancelBtnText, { color: C.foreground }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={validateAndSubmit}
            disabled={submitting}
            style={[styles.confirmBtn, { backgroundColor: '#CC1826', opacity: submitting ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Record sale"
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Feather name="dollar-sign" size={15} color="#FFF" />
                <Text style={styles.confirmBtnText}>{confirming ? 'Confirm Sale' : 'Record Sale'}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '92%',
    zIndex: 1,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  panelHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 20,
  },
  panelTitle: { fontSize: 20, fontFamily: 'Rajdhani_700Bold', color: C.foreground },
  panelSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  fieldLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground, textTransform: 'uppercase',
    letterSpacing: 0.7, marginBottom: 8, marginTop: 14,
  },
  required: { color: C.negative },
  optional: { textTransform: 'none', color: C.mutedForeground, fontFamily: 'Inter_400Regular' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 12, height: 48, overflow: 'hidden',
  },
  inputPrefix: {
    paddingHorizontal: 14, fontSize: 14, fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
  },
  input: {
    flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular',
    color: C.foreground, height: '100%',
  },
  chips: { marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, marginRight: 8, marginBottom: 4,
  },
  chipActive: { backgroundColor: '#CC1826' },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  chipTextActive: { color: '#FFF' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  confirmationText: {
    color: C.mutedForeground,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'Inter_400Regular',
    marginTop: 12,
  },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  confirmBtn: {
    flex: 2, height: 50, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  confirmBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFF' },
});
