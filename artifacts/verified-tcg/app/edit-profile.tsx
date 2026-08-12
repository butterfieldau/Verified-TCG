import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';

const C = colors.dark;

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, updateProfile } = useApp();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [location, setLocation] = useState(user?.location ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  if (!isAuthenticated) {
    return (
      <View style={[styles.screen, { paddingTop: topPad }]}> 
        <Header />
        <View style={styles.guestState}>
          <View style={styles.iconCircle}>
            <Feather name="user" size={28} color={C.primary} />
          </View>
          <Text style={styles.heading}>Create your collector profile</Text>
          <Text style={styles.body}>
            You can explore as a guest. Create a free account when you are ready to save your identity, edit your profile, and use account features.
          </Text>
          <Button fullWidth size="lg" onPress={() => router.push('/create-account')}>
            Create an Account
          </Button>
          <Pressable onPress={() => router.push('/sign-in')} style={styles.secondaryAction}>
            <Text style={styles.secondaryText}>Already have an account? Sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const handleSave = async () => {
    if (!displayName.trim() || !username.trim()) {
      setError('Display name and username are required.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await updateProfile({ displayName, username, bio, location });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}> 
      <Header />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Edit Profile</Text>
        <Text style={styles.body}>This information appears on your collector profile.</Text>
        <View style={styles.form}>
          <Input label="Display Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" leftIcon="user" />
          <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" leftIcon="at-sign" />
          <Input label="Bio" value={bio} onChangeText={setBio} leftIcon="edit-3" />
          <Input label="Location" value={location} onChangeText={setLocation} leftIcon="map-pin" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button fullWidth size="lg" onPress={handleSave} loading={saving}>Save Changes</Button>
        </View>
      </ScrollView>
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={20} color={C.foreground} />
      </Pressable>
      <Text style={styles.headerTitle}>Profile</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  content: { padding: 28, paddingBottom: 48 },
  guestState: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  iconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: `${C.primary}22`, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  heading: { fontSize: 34, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 23, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 26 },
  form: { gap: 16 },
  error: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.destructive },
  secondaryAction: { alignItems: 'center', paddingVertical: 18 },
  secondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },
});
