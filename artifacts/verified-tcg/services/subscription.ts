/**
 * Verified TCG — Subscription Entitlement Service
 *
 * Single source of truth for all Pro subscription constants, feature flags,
 * and entitlement helpers. Screens import named helpers instead of writing
 * inline `if (tier === 'pro')` comparisons.
 *
 * Out of scope: real payment processing, App Store / Play Billing, or any
 * server-side enforcement. This module operates entirely on the in-memory tier
 * value provided by AppContext.
 */

// ─── Tier ────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro';

// ─── Pricing constants ────────────────────────────────────────────────────────

export const MONTHLY_PRICE_AUD = 7.99;
export const ANNUAL_PRICE_AUD = 59.99;
export const ANNUAL_SAVING_PERCENT = Math.round(
  (1 - ANNUAL_PRICE_AUD / (MONTHLY_PRICE_AUD * 12)) * 100,
);

// ─── Scan limit constants ─────────────────────────────────────────────────────

/** Monthly scan quota for Free tier. */
export const FREE_SCAN_LIMIT = 30;
/** Fraction of quota consumed at which the scan limit banner appears. */
export const SCAN_LIMIT_BANNER_THRESHOLD = 0.8;

// ─── Config ───────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_CONFIG = {
  monthlyPriceAUD: MONTHLY_PRICE_AUD,
  annualPriceAUD: ANNUAL_PRICE_AUD,
  annualSavingPercent: ANNUAL_SAVING_PERCENT,
  freeScanLimit: FREE_SCAN_LIMIT,
  scanLimitBannerThreshold: SCAN_LIMIT_BANNER_THRESHOLD,
  freeAlertLimit: 5,
} as const;

// ─── Entitlements ─────────────────────────────────────────────────────────────

export interface SubscriptionEntitlements {
  /** Scanner: unlimited scans (Free has a 30/month quota). */
  unlimitedScanner: boolean;
  /** Card detail: advanced price history charts (7-day, 30-day, 90-day). */
  advancedPricing: boolean;
  /** Event Mode+: full event analytics and grading queue. */
  eventModePlus: boolean;
  /** Trade Match+: full match details, contact info, and trade history. */
  tradeMatchPlus: boolean;
  /** Alerts: unlimited price alerts (Free capped at 5). */
  unlimitedAlerts: boolean;
  /** Collection: CSV/JSON export. */
  exportCollection: boolean;
  /** Profile: custom card icons and profile themes. */
  customIcons: boolean;
  /** Collection: Pro analytics (grade distribution, ROI breakdown). */
  collectionInsights: boolean;
  /** Verified Drops and Partner Perks access. */
  proDrops: boolean;
}

/**
 * Returns the full entitlement set for a given subscription tier.
 * Pure function — safe to call anywhere without side effects.
 */
export function getEntitlements(tier: SubscriptionTier): SubscriptionEntitlements {
  const isPro = tier === 'pro';
  return {
    unlimitedScanner: isPro,
    advancedPricing: isPro,
    eventModePlus: isPro,
    tradeMatchPlus: isPro,
    unlimitedAlerts: isPro,
    exportCollection: isPro,
    customIcons: isPro,
    collectionInsights: isPro,
    proDrops: isPro,
  };
}

// ─── Named feature-flag helpers ───────────────────────────────────────────────
// Import these in screens instead of writing raw tier comparisons.

export const canUseUnlimitedScanner = (tier: SubscriptionTier) =>
  getEntitlements(tier).unlimitedScanner;

export const canViewAdvancedPricing = (tier: SubscriptionTier) =>
  getEntitlements(tier).advancedPricing;

export const canUseEventModePlus = (tier: SubscriptionTier) =>
  getEntitlements(tier).eventModePlus;

export const canUseTradeMatchPlus = (tier: SubscriptionTier) =>
  getEntitlements(tier).tradeMatchPlus;

export const canUseUnlimitedAlerts = (tier: SubscriptionTier) =>
  getEntitlements(tier).unlimitedAlerts;

export const canExportCollection = (tier: SubscriptionTier) =>
  getEntitlements(tier).exportCollection;

export const canUseCustomIcons = (tier: SubscriptionTier) =>
  getEntitlements(tier).customIcons;

export const canViewCollectionInsights = (tier: SubscriptionTier) =>
  getEntitlements(tier).collectionInsights;

export const canAccessProDrops = (tier: SubscriptionTier) =>
  getEntitlements(tier).proDrops;
