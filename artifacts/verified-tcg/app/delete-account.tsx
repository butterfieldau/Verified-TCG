import React, { useState } from 'react';
import {
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
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';

const C = colors.dark;

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, deleteAccount } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  if (!isAuthenticated) {
    router.replace('/welcome' as any);
    return null;
  }

  const handleDelete = () => {
    if (!password.trim()) {
      setError('Please enter your password to confirm deletion.');
      return;
    }

    Alert.alert(
      'Delete Account',
      'This is permanent and cannot be undone. Your profile, collection, and all associated data will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setError('');
            setDeleting(true);
            try {
              await deleteAccount(password);
              router.replace('/welcome' as any);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Unable to delete your account. Please try again.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Delete Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Warning icon */}
        <View style={styles.iconWrap}>
          <Feather name="alert-triangle" size={32} color={C.destructive} />
        </View>

        <Text style={styles.heading}>Delete your account?</Text>
        <Text style={styles.body}>
          This action is permanent and cannot be undone. The following will be removed:
        </Text>

        <View style={styles.list}>
          {[
            'Your profile and display name',
            'Your collection history',
            'All wishlist cards',
            'Your account credentials and sessions',
          ].map(item => (
            <View key={item} style={styles.listRow}>
              <Feather name="x-circle" size={14} color={C.destructive} style={{ marginTop: 1 }} />
              <Text style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.form}>
          <Text style={styles.confirmLabel}>Enter your password to confirm</Text>
          <Input
            label="Password"
            value={password}
            onChangeText={text => { setPassword(text); setError(''); }}
            secureTextEntry
            leftIcon="lock"
            autoCapitalize="none"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            fullWidth
            size="lg"
            onPress={handleDelete}
            loading={deleting}
            style={styles.deleteBtn}
          >
            Delete My Account
          </Button>

          <Pressable onPress={() => router.back()} style={styles.cancelLink}>
            <Text style={styles.cancelText}>Cancel — keep my account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  content: { padding: 28, paddingBottom: 48 },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${C.destructive}22`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heading: {
    fontSize: 28,
    fontFamily: 'Rajdhani_700Bold',
    color: C.foreground,
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    marginBottom: 18,
  },
  list: { gap: 10, marginBottom: 28 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  listText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.foreground,
    flex: 1,
    lineHeight: 20,
  },
  form: { gap: 14 },
  confirmLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    marginBottom: 4,
  },
  error: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.destructive,
  },
  deleteBtn: {
    backgroundColor: C.destructive,
    marginTop: 4,
  },
  cancelLink: { alignItems: 'center', paddingVertical: 14 },
  cancelText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
  },
});
