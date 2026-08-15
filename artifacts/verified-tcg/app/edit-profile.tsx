import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useApp } from '@/context/AppContext';
import colors from '@/constants/colors';
import { uploadAvatar } from '@/services/auth';

const C = colors.dark;

// ── TCG options ───────────────────────────────────────────────────────────────

const TCG_OPTIONS = [
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'One Piece', value: 'onepiece' },
  { label: 'Magic: The Gathering', value: 'magic' },
  { label: 'Yu-Gi-Oh!', value: 'yugioh' },
  { label: 'Disney Lorcana', value: 'lorcana' },
  { label: 'Dragon Ball Super', value: 'dragonball' },
  { label: 'Sports', value: 'sports' },
  { label: 'Other', value: 'other' },
];

// ── Month/year picker data ────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1989 }, (_, i) => String(currentYear - i));

function parseCollectorSince(value: string | null | undefined): { year: string; month: string } {
  if (!value) return { year: '', month: '' };
  const [y, m] = value.split('-');
  const monthIdx = parseInt(m ?? '1', 10) - 1;
  return { year: y ?? '', month: MONTHS[monthIdx] ?? '' };
}

function formatCollectorSince(year: string, month: string): string | null {
  if (!year || !month) return null;
  const monthIdx = MONTHS.indexOf(month) + 1;
  return `${year}-${String(monthIdx).padStart(2, '0')}`;
}

function formatCollectorSinceDisplay(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const { year, month } = parseCollectorSince(value);
  return month && year ? `${month} ${year}` : 'Not set';
}

// ── Toggle row ────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={toggleStyles.row}>
      <View style={{ flex: 1 }}>
        <Text style={toggleStyles.label}>{label}</Text>
        {description ? <Text style={toggleStyles.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.border, true: `${C.primary}88` }}
        thumbColor={value ? C.primary : C.mutedForeground}
        ios_backgroundColor={C.border}
        accessibilityLabel={label}
        accessibilityHint={description}
        accessibilityRole="switch"
      />
    </View>
  );
}

const toggleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  label: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground, marginBottom: 2 },
  description: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 16 },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, updateProfile } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // Basic profile fields
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [location, setLocation] = useState(user?.location ?? '');

  // Extended profile fields
  const [favouriteTcg, setFavouriteTcg] = useState<string>(user?.favouriteTcg ?? '');
  const [collectorSince, setCollectorSince] = useState<string | null>(user?.collectorSince ?? null);

  // Visibility toggles
  const [profilePublic, setProfilePublic] = useState(user?.profilePublic ?? true);
  const [showCollection, setShowCollection] = useState(user?.showCollection ?? true);
  const [showWishlist, setShowWishlist] = useState(user?.showWishlist ?? true);
  const [showForTrade, setShowForTrade] = useState(user?.showForTrade ?? true);
  const [showForSale, setShowForSale] = useState(user?.showForSale ?? true);

  // Avatar
  const [avatarUri, setAvatarUri] = useState<string | null>(user?.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // UI state
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // TCG picker modal
  const [tcgModalVisible, setTcgModalVisible] = useState(false);

  // Date picker modal
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const { year: initYear, month: initMonth } = parseCollectorSince(collectorSince);
  const [pickerYear, setPickerYear] = useState(initYear || String(currentYear - 3));
  const [pickerMonth, setPickerMonth] = useState(initMonth || 'January');

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
          <Pressable
            onPress={() => router.push('/sign-in')}
            style={styles.secondaryAction}
            accessibilityRole="button"
            accessibilityLabel="Already have an account? Sign in"
          >
            <Text style={styles.secondaryText}>Already have an account? Sign in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Avatar picker ─────────────────────────────────────────────────────────

  const handlePickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library access is required to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      setError('Could not read the selected photo.');
      return;
    }

    setAvatarUploading(true);
    setError('');
    try {
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const newUrl = await uploadAvatar(asset.base64, mimeType);
      setAvatarUri(newUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setAvatarUploading(false);
    }
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!displayName.trim() || !username.trim()) {
      setError('Display name and username are required.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await updateProfile({
        displayName,
        username,
        bio,
        location,
        favouriteTcg: favouriteTcg || null,
        collectorSince,
        profilePublic,
        showCollection,
        showWishlist,
        showForTrade,
        showForSale,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  // ── Date picker confirm ───────────────────────────────────────────────────

  const confirmDate = () => {
    setCollectorSince(formatCollectorSince(pickerYear, pickerMonth));
    setDateModalVisible(false);
  };

  const clearDate = () => {
    setCollectorSince(null);
    setDateModalVisible(false);
  };

  // ── Avatar display ────────────────────────────────────────────────────────

  const initials = user?.displayName?.[0]?.toUpperCase() ?? 'U';

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      <Header />
      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Edit Profile</Text>
        <Text style={styles.body}>This information appears on your collector profile.</Text>

        {/* ── Avatar ─────────────────────────────────────────────────────── */}
        <View style={styles.avatarSection}>
          <Pressable
          onPress={handlePickAvatar}
          style={styles.avatarWrapper}
          disabled={avatarUploading}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          accessibilityHint="Opens your photo library to choose a profile picture"
        >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              {avatarUploading
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Feather name="camera" size={14} color="#FFF" />
              }
            </View>
          </Pressable>
          <View>
            <Text style={styles.avatarLabel}>Profile Photo</Text>
            <Text style={styles.avatarHint}>Tap to choose from your photo library</Text>
          </View>
        </View>

        {/* ── Basic info ────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BASIC INFO</Text>
          <View style={[styles.card, { backgroundColor: C.card }]}>
            <View style={styles.form}>
              <Input label="Display Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" leftIcon="user" />
              <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" leftIcon="at-sign" />
              <Input label="Bio" value={bio} onChangeText={setBio} leftIcon="edit-3" />
              <Input label="Location" value={location} onChangeText={setLocation} leftIcon="map-pin" />
            </View>
          </View>
        </View>

        {/* ── Collector details ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>COLLECTOR DETAILS</Text>
          <View style={[styles.card, { backgroundColor: C.card }]}>
            {/* Favourite TCG */}
            <Pressable
              onPress={() => setTcgModalVisible(true)}
              style={({ pressed }) => [styles.pickerRow, pressed && { backgroundColor: C.muted }]}
              accessibilityRole="button"
              accessibilityLabel="Favourite TCG"
              accessibilityHint="Opens a picker to choose your favourite trading card game"
            >
              <View style={styles.pickerIcon}>
                <Feather name="star" size={16} color={C.foreground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerLabel}>Favourite TCG</Text>
                <Text style={styles.pickerValue}>
                  {TCG_OPTIONS.find(t => t.value === favouriteTcg)?.label ?? 'Not set'}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.mutedForeground} />
            </Pressable>

            <View style={styles.rowDivider} />

            {/* Collector since */}
            <Pressable
              onPress={() => setDateModalVisible(true)}
              style={({ pressed }) => [styles.pickerRow, pressed && { backgroundColor: C.muted }]}
              accessibilityRole="button"
              accessibilityLabel="Collecting Since"
              accessibilityHint="Opens a picker to set when you started collecting"
            >
              <View style={styles.pickerIcon}>
                <Feather name="calendar" size={16} color={C.foreground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerLabel}>Collecting Since</Text>
                <Text style={styles.pickerValue}>{formatCollectorSinceDisplay(collectorSince)}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {/* ── Privacy & visibility ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PRIVACY & VISIBILITY</Text>
          <View style={[styles.card, { backgroundColor: C.card, padding: 16, gap: 4 }]}>
            <ToggleRow
              label="Public Profile"
              description="Allow other collectors to view your profile"
              value={profilePublic}
              onChange={setProfilePublic}
            />
            <View style={styles.rowDivider} />
            <ToggleRow
              label="Show My Collection"
              description="Visitors can browse your card collection"
              value={showCollection}
              onChange={setShowCollection}
            />
            <View style={styles.rowDivider} />
            <ToggleRow
              label="Show My Wishlist"
              description="Visitors can see which cards you're looking for"
              value={showWishlist}
              onChange={setShowWishlist}
            />
            <View style={styles.rowDivider} />
            <ToggleRow
              label="Show For-Trade Cards"
              description="Visitors can see which cards you want to trade"
              value={showForTrade}
              onChange={setShowForTrade}
            />
            <View style={styles.rowDivider} />
            <ToggleRow
              label="Show For-Sale Cards"
              description="Visitors can see which cards you have listed for sale"
              value={showForSale}
              onChange={setShowForSale}
            />
          </View>
        </View>

        {/* ── Preview & Save ────────────────────────────────────────────── */}
        <View style={styles.section}>
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color={C.destructive} />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}
          <Button fullWidth size="lg" onPress={handleSave} loading={saving}>Save Changes</Button>
          <Pressable
            style={styles.previewBtn}
            onPress={() => {
              if (user?.username) {
                router.push(`/collector/${user.username}` as any);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Preview my public profile"
          >
            <Feather name="eye" size={15} color={C.primary} />
            <Text style={styles.previewBtnText}>Preview my public profile</Text>
          </Pressable>
        </View>
      </KeyboardAwareScrollViewCompat>

      {/* ── TCG picker modal ─────────────────────────────────────────────── */}
      <Modal
        visible={tcgModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTcgModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTcgModalVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Favourite TCG</Text>
          <ScrollView>
            <Pressable
              style={[styles.tcgOption, !favouriteTcg && { backgroundColor: `${C.primary}22` }]}
              onPress={() => { setFavouriteTcg(''); setTcgModalVisible(false); }}
              accessibilityRole="radio"
              accessibilityLabel="Not set"
              accessibilityState={{ selected: !favouriteTcg }}
            >
              <Text style={[styles.tcgOptionText, !favouriteTcg && { color: C.primary }]}>Not set</Text>
              {!favouriteTcg && <Feather name="check" size={16} color={C.primary} />}
            </Pressable>
            {TCG_OPTIONS.map(opt => (
              <Pressable
                key={opt.value}
                style={[styles.tcgOption, favouriteTcg === opt.value && { backgroundColor: `${C.primary}22` }]}
                onPress={() => { setFavouriteTcg(opt.value); setTcgModalVisible(false); }}
                accessibilityRole="radio"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected: favouriteTcg === opt.value }}
              >
                <Text style={[styles.tcgOptionText, favouriteTcg === opt.value && { color: C.primary }]}>
                  {opt.label}
                </Text>
                {favouriteTcg === opt.value && <Feather name="check" size={16} color={C.primary} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Date picker modal ─────────────────────────────────────────────── */}
      <Modal
        visible={dateModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDateModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setDateModalVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Collecting Since</Text>
          <View style={styles.datePickerRow}>
            {/* Month column */}
            <View style={{ flex: 1 }}>
              <Text style={styles.dateColumnLabel}>Month</Text>
              <ScrollView style={styles.dateColumn} showsVerticalScrollIndicator={false}>
                {MONTHS.map(m => (
                  <Pressable
                    key={m}
                    style={[styles.dateOption, pickerMonth === m && { backgroundColor: `${C.primary}22` }, { minHeight: 44, justifyContent: 'center' }]}
                    onPress={() => setPickerMonth(m)}
                    accessibilityRole="radio"
                    accessibilityLabel={m}
                    accessibilityState={{ selected: pickerMonth === m }}
                  >
                    <Text style={[styles.dateOptionText, pickerMonth === m && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>
                      {m}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={{ width: 1, backgroundColor: C.border, marginVertical: 8 }} />
            {/* Year column */}
            <View style={{ flex: 1 }}>
              <Text style={styles.dateColumnLabel}>Year</Text>
              <ScrollView style={styles.dateColumn} showsVerticalScrollIndicator={false}>
                {YEARS.map(y => (
                  <Pressable
                    key={y}
                    style={[styles.dateOption, pickerYear === y && { backgroundColor: `${C.primary}22` }, { minHeight: 44, justifyContent: 'center' }]}
                    onPress={() => setPickerYear(y)}
                    accessibilityRole="radio"
                    accessibilityLabel={String(y)}
                    accessibilityState={{ selected: pickerYear === y }}
                  >
                    <Text style={[styles.dateOptionText, pickerYear === y && { color: C.primary, fontFamily: 'Inter_600SemiBold' }]}>
                      {y}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
          <View style={styles.dateActions}>
            <Pressable
              style={styles.dateClearBtn}
              onPress={clearDate}
              accessibilityRole="button"
              accessibilityLabel="Clear date"
              hitSlop={{ top: 4, bottom: 4 }}
            >
              <Text style={styles.dateClearText}>Clear</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button size="sm" onPress={confirmDate}>Confirm</Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={2}
      >
        <Feather name="arrow-left" size={20} color={C.foreground} />
      </Pressable>
      <Text style={styles.headerTitle}>Profile</Text>
      <View style={{ width: 40 }} />
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
    marginBottom: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  content: { padding: 20, paddingBottom: 48 },
  guestState: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  iconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: `${C.primary}22`, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  heading: { fontSize: 34, fontFamily: 'Rajdhani_700Bold', color: C.foreground, marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 23, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 20 },
  secondaryAction: { alignItems: 'center', paddingVertical: 18 },
  secondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.foreground },

  // Avatar section
  avatarSection: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28, marginTop: 4 },
  avatarWrapper: { position: 'relative' },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.background,
  },
  avatarLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  avatarHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3 },

  // Sections
  section: { marginBottom: 24 },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  card: { borderRadius: 16, overflow: 'hidden' },
  form: { padding: 16, gap: 16 },
  rowDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 0 },

  // Picker rows
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  pickerIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 2 },
  pickerValue: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground },

  // Error
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  error: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.destructive, flex: 1 },

  // Preview button
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  previewBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 16 },
  tcgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  tcgOptionText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: C.foreground },

  // Date picker
  datePickerRow: { flexDirection: 'row', height: 200 },
  dateColumn: { flex: 1 },
  dateColumnLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  dateOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 2,
  },
  dateOptionText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground },
  dateActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  dateClearBtn: { paddingVertical: 10, paddingHorizontal: 18 },
  dateClearText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
});
