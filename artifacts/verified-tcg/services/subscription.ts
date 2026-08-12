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

export const MONTHLY_PRICE_AUD = 8.99;
export const ANNUAL_PRICE_AUD = 79.99;
/** Equivalent monthly cost when billed annually (rounded to 2 dp). */
export const ANNUAL_MONTHLY_EQUIV = parseFloat((ANNUAL_PRICE_AUD / 12).toFixed(2)); // 6.67
export const ANNUAL_SAVING_PERCENT = 25; // Marketing figure; actual math ≈ 26 %

// ─── Scan limit constants ─────────────────────────────────────────────────────

/** Monthly scan quota for Free tier. */
export const FREE_SCAN_LIMIT = 30;
/** Fraction of quota consumed at which the scan limit banner appears. */
export const SCAN_LIMIT_BANNER_THRESHOLD = 0.8;
/** Maximum number of active price alerts for Free tier. */
export const FREE_ALERT_LIMIT = 5;

// ─── Config ───────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_CONFIG = {
  monthlyPriceAUD: MONTHLY_PRICE_AUD,
  annualPriceAUD: ANNUAL_PRICE_AUD,
  annualMonthlyEquiv: ANNUAL_MONTHLY_EQUIV,
  annualSavingPercent: ANNUAL_SAVING_PERCENT,
  freeScanLimit: FREE_SCAN_LIMIT,
  scanLimitBannerThreshold: SCAN_LIMIT_BANNER_THRESHOLD,
  freeAlertLimit: 5,
  trialDays: 7,
  /** Ordered list of Pro benefit cards shown on the subscription screen. */
  benefits: [
    {
      key: 'unlimited-scanning',
      title: 'Unlimited Scanning',
      subtitle: 'Scan as many cards as you like — no monthly cap, ever.',
      icon: 'camera',
    },
    {
      key: 'pricing-plus',
      title: 'Pricing+',
      subtitle: 'Full 90-day price history, trend charts, and market signals for every card.',
      icon: 'trending-up',
    },
    {
      key: 'event-mode-plus',
      title: 'Event Mode+',
      subtitle: 'Advanced event analytics, grading queue, and wanted-board insights.',
      icon: 'zap',
    },
    {
      key: 'trade-match-plus',
      title: 'Trade Match+',
      subtitle: 'Full match profiles, contact details, and complete trade history.',
      icon: 'repeat',
    },
    {
      key: 'smart-alerts',
      title: 'Smart Alerts',
      subtitle: 'Unlimited price alerts on any card — never miss a dip or a spike.',
      icon: 'bell',
    },
    {
      key: 'pro-identity',
      title: 'Pro Identity',
      subtitle: 'Custom card icons, profile themes, Pro badge, and Founding Member status.',
      icon: 'award',
    },
  ] as const,
  /** Free vs Pro comparison rows, grouped by category. */
  comparison: [
    {
      category: 'Collection',
      rows: [
        { feature: 'Card scanning', free: '30 / month', pro: 'Unlimited' },
        { feature: 'Collection size', free: 'Unlimited', pro: 'Unlimited' },
        { feature: 'CSV / JSON export', free: false, pro: true },
        { feature: 'Collection insights & ROI', free: false, pro: true },
      ],
    },
    {
      category: 'Pricing',
      rows: [
        { feature: 'Current card value', free: true, pro: true },
        { feature: '7-day price history', free: false, pro: true },
        { feature: '30-day price history', free: false, pro: true },
        { feature: '90-day price history', free: false, pro: true },
        { feature: 'Market trend signals', free: false, pro: true },
      ],
    },
    {
      category: 'Trading',
      rows: [
        { feature: 'Trade Match discovery', free: true, pro: true },
        { feature: 'Match contact details', free: false, pro: true },
        { feature: 'Full trade history', free: false, pro: true },
        { feature: 'Event Mode analytics', free: false, pro: true },
        { feature: 'Wanted-board insights', free: false, pro: true },
      ],
    },
    {
      category: 'Alerts',
      rows: [
        { feature: 'Price alerts', free: '5 max', pro: 'Unlimited' },
        { feature: 'Trade-offer alerts', free: true, pro: true },
        { feature: 'Wishlist match alerts', free: true, pro: true },
      ],
    },
    {
      category: 'Identity',
      rows: [
        { feature: 'Collector profile', free: true, pro: true },
        { feature: 'Custom card icons', free: false, pro: true },
        { feature: 'Profile themes', free: false, pro: true },
        { feature: 'Pro badge', free: false, pro: true },
        { feature: 'Founding Member status', free: false, pro: true },
        { feature: 'Verified Drops early access', free: false, pro: true },
      ],
    },
  ] as const,
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
