/**
 * Pricing+ mock data for card detail screen.
 * All values are illustrative — replace with real API calls in task #20.
 */

export type TimeRange = '30D' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'ALL';

export const TIME_RANGES: TimeRange[] = ['30D', '1M', '3M', '6M', '1Y', '3Y', '5Y', 'ALL'];

/**
 * All time ranges require advancedPricing (Pro).
 * Free users see the existing 30-day sparkline in the Market Value card only.
 */

/** Graders shown in the GRADED section (configurable array — not a switch) */
export const GRADERS = [
  { key: 'psa8',  label: 'PSA 8' },
  { key: 'psa9',  label: 'PSA 9' },
  { key: 'psa10', label: 'PSA 10' },
  { key: 'tag10', label: 'TAG 10' },
  { key: 'cgc10', label: 'CGC 10' },
  { key: 'bgs95', label: 'BGS 9.5' },
  { key: 'bgs10', label: 'BGS 10' },
] as const;

export type GraderKey = (typeof GRADERS)[number]['key'];

/** Raw pricing stats for the RAW card */
export interface RawStats {
  marketEstimate: number;
  avg7d: number;
  avg30d: number;
  avg90d: number;
  high52w: number;
  low52w: number;
  salesVolume: number; // units sold last 30 days
}

/** A single recent-sale row */
export interface RecentSale {
  id: string;
  gradeLabel: string;
  soldPrice: number;
  marketplace: string;
  daysAgo: number;
}

/** Price history point */
export interface PricePoint {
  label: string;
  value: number;
}

/** The full Pricing+ data shape keyed by card id */
export interface PricingPlusData {
  rawStats: RawStats;
  gradedPrices: Record<GraderKey, number>;
  priceHistory: Record<TimeRange, PricePoint[]>;
  recentSales: RecentSale[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trendUp(base: number, points: number, volatility = 0.04): PricePoint[] {
  return Array.from({ length: points }, (_, i) => ({
    label: `P${i + 1}`,
    value: Math.round(base * (1 + (i / points) * 0.35 + (Math.sin(i * 1.1) * volatility))),
  }));
}

function trendVolatile(base: number, points: number): PricePoint[] {
  return Array.from({ length: points }, (_, i) => ({
    label: `P${i + 1}`,
    value: Math.round(base * (1 + Math.sin(i * 0.9) * 0.18 + Math.cos(i * 0.5) * 0.1)),
  }));
}

function trendFlat(base: number, points: number): PricePoint[] {
  return Array.from({ length: points }, (_, i) => ({
    label: `P${i + 1}`,
    value: Math.round(base * (1 + Math.sin(i * 0.3) * 0.04)),
  }));
}

function trendRecovery(base: number, points: number): PricePoint[] {
  const low = base * 0.65;
  return Array.from({ length: points }, (_, i) => {
    const t = i / points;
    // Dip to low then recover
    const dip = t < 0.4 ? low + (base - low) * (t / 0.4) * 0.3 : low + (base - low) * ((t - 0.4) / 0.6);
    return { label: `P${i + 1}`, value: Math.round(dip + Math.sin(i * 0.7) * base * 0.02) };
  });
}

// ─── Mock data per well-known card ────────────────────────────────────────────

const CHARIZARD_BASE = 580;
const UMBREON_BASE = 1450;
const LUFFY_BASE = 320;
const PIKACHU_BASE = 340;

/**
 * Returns Pricing+ data for a card. In production this would be an API call.
 * The `basePrice` is the card's current raw market price used to scale figures.
 */
export function getMockPricingPlus(cardId: string, basePrice: number): PricingPlusData {
  const b = basePrice;

  // Choose history shape based on card
  const isCharizard = cardId.includes('charizard');
  const isUmbreon = cardId.includes('umbreon');
  const isLuffy = cardId.includes('luffy');

  const historyShape = isCharizard
    ? 'recovery'
    : isUmbreon
    ? 'up'
    : isLuffy
    ? 'volatile'
    : 'flat';

  function makeHistory(pts: number): PricePoint[] {
    switch (historyShape) {
      case 'up':       return trendUp(b * 0.65, pts);
      case 'volatile': return trendVolatile(b, pts);
      case 'recovery': return trendRecovery(b * 0.8, pts);
      default:         return trendFlat(b, pts);
    }
  }

  return {
    rawStats: {
      marketEstimate: b,
      avg7d:          Math.round(b * 0.97),
      avg30d:         Math.round(b * 0.92),
      avg90d:         Math.round(b * 0.85),
      high52w:        Math.round(b * 1.28),
      low52w:         Math.round(b * 0.61),
      salesVolume:    isUmbreon ? 127 : isCharizard ? 245 : isLuffy ? 89 : 56,
    },
    gradedPrices: {
      psa8:  Math.round(b * 1.4),
      psa9:  Math.round(b * 2.1),
      psa10: Math.round(b * 3.6),
      tag10: Math.round(b * 3.9),
      cgc10: Math.round(b * 3.4),
      bgs95: Math.round(b * 3.0),
      bgs10: Math.round(b * 4.2),
    },
    priceHistory: {
      '30D':  makeHistory(30),
      '1M':   makeHistory(30),
      '3M':   makeHistory(12),
      '6M':   makeHistory(24),
      '1Y':   makeHistory(52),
      '3Y':   makeHistory(36),
      '5Y':   makeHistory(60),
      'ALL':  makeHistory(80),
    },
    recentSales: [
      { id: 'rs1', gradeLabel: 'PSA 10', soldPrice: Math.round(b * 3.55), marketplace: 'eBay',       daysAgo: 1 },
      { id: 'rs2', gradeLabel: 'PSA 9',  soldPrice: Math.round(b * 2.08), marketplace: 'TCGPlayer',  daysAgo: 2 },
      { id: 'rs3', gradeLabel: 'Raw',    soldPrice: Math.round(b * 0.95), marketplace: 'eBay',       daysAgo: 3 },
      { id: 'rs4', gradeLabel: 'CGC 10', soldPrice: Math.round(b * 3.38), marketplace: 'Whatnot',    daysAgo: 4 },
      { id: 'rs5', gradeLabel: 'BGS 9.5',soldPrice: Math.round(b * 2.95), marketplace: 'PWCC',       daysAgo: 6 },
      { id: 'rs6', gradeLabel: 'PSA 10', soldPrice: Math.round(b * 3.60), marketplace: 'eBay',       daysAgo: 7 },
    ],
  };
}
