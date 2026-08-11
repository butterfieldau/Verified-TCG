/**
 * Verified TCG — Design System Tokens
 * Dark-first premium aesthetic: Apple × StockX × modern fintech
 *
 * #FF1E2D red used sparingly: CTAs, verification, selected states, highlights.
 * Do NOT use red for large background areas.
 */

const darkPalette = {
  // Core semantics
  text: '#FFFFFF',
  tint: '#FF1E2D',
  background: '#0A0A0A',
  foreground: '#FFFFFF',

  // Cards / elevated surfaces
  card: '#1A1A1A',
  cardForeground: '#FFFFFF',

  // Primary CTA (red — use sparingly)
  primary: '#FF1E2D',
  primaryForeground: '#FFFFFF',

  // Secondary surfaces
  secondary: '#1A1A1A',
  secondaryForeground: '#FFFFFF',

  // Muted / subdued
  muted: '#2A2A2A',
  mutedForeground: '#888888',

  // Accent
  accent: '#FF1E2D',
  accentForeground: '#FFFFFF',

  // Destructive
  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',

  // Borders and inputs
  border: '#2A2A2A',
  input: '#1A1A1A',

  // Extended surface tokens
  surface: '#141414',
  surfaceRaised: '#1A1A1A',

  // Market indicators
  positive: '#22C55E',
  negative: '#FF1E2D',
  warning: '#F59E0B',

  // Grade badge accent colors
  psaBadge: '#FF1E2D',
  bgsBadge: '#D4AF37',
  cgcBadge: '#4A90D9',
  beckettBadge: '#8B5CF6',

  // Verification badge colors
  verifiedBadge: '#22C55E',
  suspiciousBadge: '#F59E0B',
  counterfeitBadge: '#EF4444',
  unverifiedBadge: '#888888',
};

// Dark-first: both schemes use the same dark palette
const colors = {
  light: darkPalette,
  dark: darkPalette,
  radius: 12,
} as const;

export type ColorTokens = typeof darkPalette;

export default colors;
