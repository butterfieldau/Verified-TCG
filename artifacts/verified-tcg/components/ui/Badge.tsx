import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { GradingCompany, VerificationStatus } from '@/types';

// ── Grade Badge ────────────────────────────────────────────────────────────────
// Mimics the physical appearance of PSA/BGS/CGC slabs.

interface GradeBadgeProps {
  grade: number | string;
  company: GradingCompany;
  size?: 'sm' | 'md';
}

export function GradeBadge({ grade, company, size = 'md' }: GradeBadgeProps) {
  const colors = useColors();

  const companyColors: Record<string, string> = {
    PSA: colors.psaBadge,
    BGS: colors.bgsBadge,
    CGC: colors.cgcBadge,
    Beckett: colors.beckettBadge,
    Raw: colors.mutedForeground,
  };

  const accent = companyColors[company] ?? colors.mutedForeground;
  const sm = size === 'sm';

  return (
    <View style={[styles.grade, { borderColor: accent, width: sm ? 36 : 44 }]}>
      <Text style={[styles.gradeCompany, { color: accent, fontSize: sm ? 7 : 8 }]}>
        {company}
      </Text>
      <Text style={[styles.gradeValue, { fontSize: sm ? 11 : 14 }]}>
        {String(grade)}
      </Text>
    </View>
  );
}

// ── Verification Badge ─────────────────────────────────────────────────────────

interface VerificationBadgeProps {
  status: VerificationStatus;
  showLabel?: boolean;
}

export function VerificationBadge({ status, showLabel = true }: VerificationBadgeProps) {
  const colors = useColors();

  const map: Record<VerificationStatus, { color: string; symbol: string; label: string }> = {
    verified:    { color: colors.verifiedBadge,    symbol: '✓', label: 'Verified' },
    suspicious:  { color: colors.suspiciousBadge,  symbol: '!', label: 'Suspicious' },
    counterfeit: { color: colors.counterfeitBadge, symbol: '✗', label: 'Counterfeit' },
    unverified:  { color: colors.unverifiedBadge,  symbol: '?', label: 'Unverified' },
  };

  const { color, symbol, label } = map[status];

  return (
    <View
      style={[
        styles.verification,
        { backgroundColor: `${color}22`, borderColor: `${color}55` },
      ]}
    >
      <Text style={[styles.verSymbol, { color }]}>{symbol}</Text>
      {showLabel && (
        <Text style={[styles.verLabel, { color }]}>{label}</Text>
      )}
    </View>
  );
}

// ── Status Badge (generic) ─────────────────────────────────────────────────────

interface StatusBadgeProps {
  label: string;
  color?: string;
  variant?: 'solid' | 'outline' | 'subtle';
}

export function StatusBadge({ label, color, variant = 'subtle' }: StatusBadgeProps) {
  const colors = useColors();
  const c = color ?? colors.primary;

  return (
    <View
      style={[
        styles.status,
        {
          backgroundColor: variant === 'solid' ? c : `${c}22`,
          borderColor: variant === 'outline' ? c : `${c}44`,
        },
      ]}
    >
      <Text style={[styles.statusLabel, { color: variant === 'solid' ? '#FFFFFF' : c }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // GradeBadge
  grade: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  gradeCompany: {
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
    lineHeight: 10,
  },
  gradeValue: {
    fontFamily: 'Inter_700Bold',
    color: '#111111',
    lineHeight: 16,
  },
  // VerificationBadge
  verification: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  verSymbol: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  verLabel:  { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  // StatusBadge
  status: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
});
