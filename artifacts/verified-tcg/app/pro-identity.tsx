import React, { useState } from 'react';
import {
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
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '@/context/AppContext';
import { canUseCustomIcons } from '@/services/subscription';
import colors from '@/constants/colors';

const C = colors.dark;

// ── Data definitions ──────────────────────────────────────────────────────────

type IconBadge = 'PRO' | 'LIMITED' | null;

interface IconOption {
  id: string;
  label: string;
  badge: IconBadge;
  /** Two representative colours for the icon swatch preview. */
  swatchColors: [string, string];
}

const ICON_OPTIONS: IconOption[] = [
  { id: 'original',       label: 'Verified Red',      badge: null,      swatchColors: ['#FF1E2D', '#8B0000'] },
  { id: 'black',          label: 'Verified Black',     badge: 'PRO',     swatchColors: ['#1A1A1A', '#0A0A0A'] },
  { id: 'white',          label: 'Verified White',     badge: 'PRO',     swatchColors: ['#F5F5F5', '#CCCCCC'] },
  { id: 'gold',           label: 'Verified Gold',      badge: 'PRO',     swatchColors: ['#D4AF37', '#8B7000'] },
  { id: 'stealth',        label: 'Stealth',            badge: 'PRO',     swatchColors: ['#2A2A2A', '#111111'] },
  { id: 'event',          label: 'Event Edition',      badge: 'LIMITED', swatchColors: ['#8B5CF6', '#4C1D95'] },
  { id: 'founding',       label: 'Founding Member',    badge: 'LIMITED', swatchColors: ['#D4AF37', '#FF1E2D'] },
];

type ProfileThemeId = 'default' | 'carbon' | 'deep_red' | 'collector_black' | 'chrome';

interface ProfileTheme {
  id: ProfileThemeId;
  label: string;
  previewColors: [string, string];
  proRequired: boolean;
}

const PROFILE_THEMES: ProfileTheme[] = [
  { id: 'default',         label: 'Dark Default',       previewColors: ['#0A0A0A', '#1A1A1A'], proRequired: false },
  { id: 'carbon',          label: 'Carbon',             previewColors: ['#1C1C1E', '#2C2C2E'], proRequired: true },
  { id: 'deep_red',        label: 'Deep Red',           previewColors: ['#1A0000', '#3D0000'], proRequired: true },
  { id: 'collector_black', label: 'Collector Black',    previewColors: ['#000000', '#111111'], proRequired: true },
  { id: 'chrome',          label: 'Verified Chrome',    previewColors: ['#2A2A2A', '#4A4A4A'], proRequired: true },
];

const FOUNDING_MEMBER_NUMBER = '#00381';
const FOUNDING_MEMBER_LIMIT = 5000;

const FOUNDING_MEMBER_PERKS = [
  { icon: 'award' as const,     label: 'Founding Member badge — permanent' },
  { icon: 'image' as const,     label: 'Exclusive Founding Member app icon' },
  { icon: 'hash' as const,      label: 'Unique member number on your profile' },
  { icon: 'star' as const,      label: 'Launch recognition in-app' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={sectionStyles.header}>
      <Text style={sectionStyles.title}>{title}</Text>
      {subtitle && <Text style={sectionStyles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: { marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 3, lineHeight: 18 },
});

function BadgePill({ label, limited }: { label: 'PRO' | 'LIMITED'; limited?: boolean }) {
  const bg = limited ? '#8B5CF622' : `${C.primary}22`;
  const color = limited ? '#8B5CF6' : C.primary;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: bg, borderColor: color }]}>
      <Text style={[badgeStyles.text, { color }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 8, fontFamily: 'Inter_700Bold', letterSpacing: 0.6 },
});

// ── App Icons Section ─────────────────────────────────────────────────────────

function IconGrid({
  selectedIcon,
  onSelect,
  isPro,
}: {
  selectedIcon: string;
  onSelect: (id: string) => void;
  isPro: boolean;
}) {
  return (
    <View style={iconStyles.grid}>
      {ICON_OPTIONS.map((opt) => {
        // Both PRO and LIMITED icons require an active Pro subscription.
        // LIMITED items have additional rarity framing but are still Pro-gated.
        const locked = opt.badge !== null && !isPro;
        const isSelected = selectedIcon === opt.id;

        return (
          <Pressable
            key={opt.id}
            onPress={() => {
              if (locked) {
                router.push('/pro-subscription' as any);
              } else {
                onSelect(opt.id);
              }
            }}
            style={[
              iconStyles.card,
              { backgroundColor: C.card },
              isSelected && iconStyles.cardSelected,
            ]}
          >
            {/* Swatch */}
            <LinearGradient
              colors={opt.swatchColors}
              style={iconStyles.swatch}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {/* Stylised "V" mark inside the swatch */}
              <Text style={iconStyles.swatchLetter}>V</Text>
              {locked && (
                <View style={iconStyles.lockOverlay}>
                  <Feather name="lock" size={14} color="#FFFFFF" />
                </View>
              )}
            </LinearGradient>

            {/* Label + badge */}
            <Text style={iconStyles.label} numberOfLines={1}>{opt.label}</Text>
            {opt.badge && (
              <BadgePill label={opt.badge} limited={opt.badge === 'LIMITED'} />
            )}

            {/* Selected checkmark */}
            {isSelected && (
              <View style={iconStyles.checkmark}>
                <Feather name="check" size={10} color="#FFFFFF" />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const iconStyles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '30.5%',
    borderRadius: 12,
    padding: 10,
    gap: 7,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  cardSelected: {
    borderColor: C.primary,
  },
  swatch: {
    height: 72,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  swatchLetter: {
    fontSize: 28,
    fontFamily: 'Rajdhani_700Bold',
    color: 'rgba(255,255,255,0.6)',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
  checkmark: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ── Profile Style Section ─────────────────────────────────────────────────────

function ProfileThemeRow({
  selectedTheme,
  onSelect,
  isPro,
}: {
  selectedTheme: string;
  onSelect: (id: ProfileThemeId) => void;
  isPro: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={themeStyles.row}
    >
      {PROFILE_THEMES.map((theme) => {
        const locked = theme.proRequired && !isPro;
        const isSelected = selectedTheme === theme.id;

        return (
          <Pressable
            key={theme.id}
            onPress={() => {
              if (locked) {
                router.push('/pro-subscription' as any);
              } else {
                onSelect(theme.id as ProfileThemeId);
              }
            }}
            style={[
              themeStyles.card,
              { backgroundColor: C.card },
              isSelected && themeStyles.cardSelected,
            ]}
          >
            <LinearGradient
              colors={theme.previewColors}
              style={themeStyles.preview}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {locked && (
                <View style={themeStyles.lockOverlay}>
                  <Feather name="lock" size={12} color="#FFFFFF" />
                </View>
              )}
            </LinearGradient>
            <Text style={themeStyles.label} numberOfLines={1}>{theme.label}</Text>
            {theme.proRequired && (
              <BadgePill label="PRO" />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const themeStyles = StyleSheet.create({
  row: { gap: 10, paddingRight: 4 },
  card: {
    width: 110,
    borderRadius: 12,
    padding: 10,
    gap: 7,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: C.primary,
  },
  preview: {
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
  },
});

// ── Founding Member Section ───────────────────────────────────────────────────

function FoundingMemberCard({
  isPro,
  claimed,
  onClaim,
}: {
  isPro: boolean;
  claimed: boolean;
  onClaim: () => void;
}) {

  return (
    <View style={foundingStyles.wrapper}>
      {/* Gradient border effect via outer + inner views */}
      <LinearGradient
        colors={['#D4AF37', '#FF1E2D', '#8B5CF6']}
        style={foundingStyles.gradientBorder}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={[foundingStyles.inner, { backgroundColor: C.card }]}>
          {/* Header */}
          <View style={foundingStyles.headerRow}>
            <View style={foundingStyles.crownBadge}>
              <Feather name="award" size={16} color="#D4AF37" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={foundingStyles.title}>Founding Member</Text>
              <Text style={foundingStyles.subtitle}>
                First {FOUNDING_MEMBER_LIMIT.toLocaleString()} Pro members receive a permanent badge
              </Text>
            </View>
          </View>

          {/* Divider */}
          <View style={[foundingStyles.divider, { backgroundColor: C.border }]} />

          {isPro ? (
            // ── Pro: pre-claim or post-claim state ──────────────────────────
            <>
              <View style={foundingStyles.memberNumRow}>
                <Text style={foundingStyles.memberNumLabel}>Your Member Number</Text>
                <View style={foundingStyles.memberNumPill}>
                  <Text style={foundingStyles.memberNum}>{FOUNDING_MEMBER_NUMBER}</Text>
                </View>
              </View>

              {claimed ? (
                // Post-claim: badge is active
                <View style={foundingStyles.claimedState}>
                  <View style={foundingStyles.claimedBadge}>
                    <Feather name="award" size={15} color="#D4AF37" />
                    <Text style={foundingStyles.claimedBadgeText}>Founding Member Badge Active</Text>
                  </View>
                  <Text style={foundingStyles.claimedSubtext}>
                    Your badge appears on your public profile. Member {FOUNDING_MEMBER_NUMBER}.
                  </Text>
                </View>
              ) : (
                // Pre-claim: prompt to activate
                <>
                  <Text style={foundingStyles.claimText}>
                    You are Founding Member {FOUNDING_MEMBER_NUMBER}
                  </Text>
                  <Pressable
                    style={foundingStyles.claimBtn}
                    onPress={onClaim}
                  >
                    <Feather name="award" size={14} color="#D4AF37" />
                    <Text style={foundingStyles.claimBtnText}>Claim your Founding Member badge</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            // ── Free: teaser ─────────────────────────────────────────────────
            <View style={foundingStyles.teaserRow}>
              <Feather name="users" size={14} color={C.mutedForeground} />
              <Text style={foundingStyles.teaserText}>
                Upgrade to Pro to lock in your Founding Member status before spots fill up.
              </Text>
            </View>
          )}

          {/* Divider */}
          <View style={[foundingStyles.divider, { backgroundColor: C.border }]} />

          {/* Perks list */}
          <Text style={foundingStyles.perksTitle}>Founding Member Perks</Text>
          {FOUNDING_MEMBER_PERKS.map((perk) => (
            <View key={perk.label} style={foundingStyles.perkRow}>
              <View style={foundingStyles.perkIcon}>
                <Feather name={perk.icon} size={13} color="#D4AF37" />
              </View>
              <Text style={foundingStyles.perkText}>{perk.label}</Text>
            </View>
          ))}

          {!isPro && (
            <Pressable
              style={foundingStyles.upgradeBtn}
              onPress={() => router.push('/pro-subscription' as any)}
            >
              <Text style={foundingStyles.upgradeBtnText}>Upgrade to Pro — Claim your spot</Text>
            </Pressable>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

const foundingStyles = StyleSheet.create({
  wrapper: { borderRadius: 16 },
  gradientBorder: { borderRadius: 16, padding: 2 },
  inner: { borderRadius: 14, padding: 18, gap: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  crownBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#D4AF3722',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2, lineHeight: 17 },
  divider: { height: 1, marginVertical: 14 },
  memberNumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  memberNumLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  memberNumPill: {
    backgroundColor: '#D4AF3722',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#D4AF3766',
  },
  memberNum: { fontSize: 16, fontFamily: 'Rajdhani_700Bold', color: '#D4AF37', letterSpacing: 1 },
  claimText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    marginBottom: 12,
  },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#D4AF3722',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D4AF3744',
    justifyContent: 'center',
  },
  claimBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#D4AF37' },
  claimedState: { gap: 8, marginBottom: 4 },
  claimedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#D4AF3715',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D4AF3733',
  },
  claimedBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#D4AF37', flex: 1 },
  claimedSubtext: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },
  teaserRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  teaserText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, flex: 1, lineHeight: 19 },
  perksTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  perkIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#D4AF3715',
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.foreground, flex: 1 },
  upgradeBtn: {
    marginTop: 6,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  upgradeBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ProIdentityScreen() {
  const insets = useSafeAreaInsets();
  const {
    subscriptionTier,
    selectedIcon, setSelectedIcon,
    profileTheme, setProfileTheme,
    foundingMemberClaimed, claimFoundingMember,
  } = useApp();

  const isPro = subscriptionTier === 'pro';
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: C.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={C.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Pro Identity</Text>
          <Text style={styles.headerSub}>Make your profile uniquely yours</Text>
        </View>
      </View>

      {!isPro && (
        <Pressable
          style={styles.upgradeBanner}
          onPress={() => router.push('/pro-subscription' as any)}
        >
          <Feather name="zap" size={14} color={C.primary} />
          <Text style={styles.upgradeBannerText}>
            Upgrade to Pro to unlock all customisation options
          </Text>
          <Feather name="chevron-right" size={14} color={C.primary} />
        </Pressable>
      )}

      {/* ── App Icons ── */}
      <View style={styles.section}>
        <SectionHeader
          title="App Icons"
          subtitle="Choose your in-app icon identity. Home-screen icon switching requires a future app update from the App Store / Play Store."
        />
        <IconGrid
          selectedIcon={selectedIcon}
          onSelect={setSelectedIcon}
          isPro={canUseCustomIcons(subscriptionTier)}
        />
      </View>

      {/* ── Profile Style ── */}
      <View style={styles.section}>
        <SectionHeader
          title="Profile Style"
          subtitle="Set the background theme other collectors see on your profile."
        />
        <ProfileThemeRow
          selectedTheme={profileTheme}
          onSelect={setProfileTheme}
          isPro={isPro}
        />
      </View>

      {/* ── Pro Badge info ── */}
      <View style={styles.section}>
        <SectionHeader
          title="Pro Badge"
          subtitle="Your PRO badge displays automatically next to your username on your profile and on public collector pages."
        />
        <View style={[styles.badgePreviewCard, { backgroundColor: C.card }]}>
          <View style={styles.badgePreviewRow}>
            <View style={[styles.badgePreviewAvatar, { backgroundColor: isPro ? C.primary : C.muted }]}>
              <Text style={styles.badgePreviewAvatarText}>
                {isPro ? 'P' : 'U'}
              </Text>
            </View>
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.badgePreviewName}>
                  {isPro ? 'Pro Collector' : 'Your Name'}
                </Text>
                {isPro && (
                  <View style={styles.badgePill}>
                    <Text style={styles.badgePillText}>PRO</Text>
                  </View>
                )}
              </View>
              <Text style={styles.badgePreviewUsername}>@username</Text>
            </View>
          </View>
          {!isPro && (
            <Text style={styles.badgeLockedNote}>
              PRO badge appears when you upgrade
            </Text>
          )}
        </View>
      </View>

      {/* ── Founding Member ── */}
      <View style={styles.section}>
        <SectionHeader
          title="Founding Member"
        />
        <FoundingMemberCard isPro={isPro} claimed={foundingMemberClaimed} onClaim={claimFoundingMember} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  title: { fontSize: 24, fontFamily: 'Rajdhani_700Bold', color: C.foreground, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 1 },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: `${C.primary}15`,
    borderWidth: 1,
    borderColor: `${C.primary}33`,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 24,
  },
  upgradeBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.primary,
  },
  section: { marginBottom: 32 },
  badgePreviewCard: {
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  badgePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badgePreviewAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePreviewAvatarText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  badgePreviewName: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
  },
  badgePill: {
    borderWidth: 1,
    borderColor: C.primary,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgePillText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 0.8,
  },
  badgePreviewUsername: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
  },
  badgeLockedNote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.mutedForeground,
    fontStyle: 'italic',
  },
});
