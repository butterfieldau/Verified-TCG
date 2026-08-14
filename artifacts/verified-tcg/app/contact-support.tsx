import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
// Follows the same resolved-base strategy as wishlistApi.ts:
// EXPO_PUBLIC_API_BASE_URL may already include the /api prefix (Replit dev
// proxy path), or be empty (web preview, same origin).  Appending '/api'
// makes the URL correct in both cases since the proxy strips the /api prefix
// before forwarding to the API server.
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

const C = colors.dark;

const CATEGORIES = [
  'General Question',
  'Bug Report',
  'Collection / Scanner',
  'Pricing & Market',
  'Grading & Verification',
  'Account & Billing',
  'Trade & Wishlist',
  'Verified Pro',
  'Privacy & Data',
  'Other',
];

export default function ContactSupportScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { user } = useApp();

  const [name, setName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const isValid = name.trim() && email.trim() && category && subject.trim() && message.trim();

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/support/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          category,
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) throw new Error('Server error');
      setSubmitted(true);
    } catch {
      setError('Failed to send your message. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <View style={[styles.successContainer, { backgroundColor: C.background, paddingTop: topPad }]}>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { alignSelf: 'flex-start', marginLeft: 20 }]}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Feather name="check-circle" size={48} color={C.positive} />
          </View>
          <Text style={styles.successTitle}>Message Sent!</Text>
          <Text style={styles.successBody}>
            We've received your message and will get back to you within 24 hours at {email}.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.doneBtn, { backgroundColor: C.primary }]}
          >
            <Text style={[styles.doneBtnText, { color: '#FFFFFF' }]}>Back to Help</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.title}>Contact Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.description}>
        Fill out the form below and we'll get back to you within 24 hours.
      </Text>

      {/* Form */}
      <View style={styles.form}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Your Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: C.card, color: C.foreground, borderColor: C.border }]}
            value={name}
            onChangeText={setName}
            placeholder="Display name"
            placeholderTextColor={C.mutedForeground}
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={[styles.input, { backgroundColor: C.card, color: C.foreground, borderColor: C.border }]}
            value={email}
            onChangeText={setEmail}
            placeholder="your@email.com"
            placeholderTextColor={C.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Category</Text>
          <Pressable
            onPress={() => setCategoryOpen(!categoryOpen)}
            style={[styles.input, styles.selectRow, { backgroundColor: C.card, borderColor: C.border }]}
          >
            <Text style={[styles.selectText, { color: category ? C.foreground : C.mutedForeground }]}>
              {category || 'Select a category'}
            </Text>
            <Feather name={categoryOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.mutedForeground} />
          </Pressable>
          {categoryOpen && (
            <View style={[styles.dropdown, { backgroundColor: C.card, borderColor: C.border }]}>
              {CATEGORIES.map(cat => (
                <Pressable
                  key={cat}
                  onPress={() => { setCategory(cat); setCategoryOpen(false); }}
                  style={({ pressed }) => [
                    styles.dropdownItem,
                    { backgroundColor: pressed ? C.muted : 'transparent' },
                    category === cat && { backgroundColor: `${C.primary}15` },
                  ]}
                >
                  <Text style={[styles.dropdownText, { color: category === cat ? C.primary : C.foreground }]}>
                    {cat}
                  </Text>
                  {category === cat && <Feather name="check" size={14} color={C.primary} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Subject</Text>
          <TextInput
            style={[styles.input, { backgroundColor: C.card, color: C.foreground, borderColor: C.border }]}
            value={subject}
            onChangeText={setSubject}
            placeholder="Brief description of your issue"
            placeholderTextColor={C.mutedForeground}
            returnKeyType="next"
            maxLength={120}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.textarea, { backgroundColor: C.card, color: C.foreground, borderColor: C.border }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your issue in detail…"
            placeholderTextColor={C.mutedForeground}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            maxLength={2000}
          />
          <Text style={styles.charCount}>{message.length}/2000</Text>
        </View>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: `${C.destructive}15`, borderColor: `${C.destructive}44` }]}>
            <Feather name="alert-circle" size={14} color={C.destructive} />
            <Text style={[styles.errorText, { color: C.destructive }]}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleSubmit}
          disabled={!isValid || submitting}
          style={({ pressed }) => [
            styles.submitBtn,
            {
              backgroundColor: isValid ? C.primary : C.muted,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Feather name="send" size={16} color={isValid ? '#FFFFFF' : C.mutedForeground} />
              <Text style={[styles.submitText, { color: isValid ? '#FFFFFF' : C.mutedForeground }]}>
                Send Message
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  successContainer: { flex: 1, paddingTop: 20 },
  successContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 16 },
  successIcon: { marginBottom: 8 },
  successTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#FFFFFF', textAlign: 'center' },
  successBody: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#888888', textAlign: 'center', lineHeight: 22 },
  doneBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, marginTop: 8 },
  doneBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  description: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    lineHeight: 21,
    marginBottom: 24,
  },
  form: { gap: 16 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  textarea: { minHeight: 120, paddingTop: 12 },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  dropdown: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  dropdownText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  charCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textAlign: 'right' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 4,
  },
  submitText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
});
