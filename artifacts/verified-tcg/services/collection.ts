import type { CollectionItem, PortfolioSummary } from '@/types';
import { MOCK_CARDS } from './cards';
import { PORTFOLIO_CHART_DATA } from './market';

/**
 * Returns the current market value for a single CollectionItem, using the
 * grading-specific price where available (e.g. PSA 10 → price.psa10) and
 * falling back to price.raw. Multiply by item.quantity for total value.
 */
export function getItemCurrentValue(item: CollectionItem): number {
  const p = item.card.price;
  const g = item.grading;
  if (!g) return p.raw;
  const company = g.company;
  const grade = Number(g.grade);
  if (company === 'PSA') {
    if (grade === 10) return p.psa10 ?? p.raw;
    if (grade === 9)  return p.psa9  ?? p.raw;
  }
  if (company === 'BGS' || company === 'Beckett') {
    if (grade === 9.5) return p.bgs95 ?? p.raw;
    if (grade === 9)   return (p as any).bgs9  ?? p.raw;
  }
  if (company === 'CGC') {
    if (grade === 10) return p.cgc10 ?? p.raw;
    if (grade === 9)  return p.cgc9  ?? p.raw;
  }
  return p.raw;
}

export const MOCK_COLLECTION: CollectionItem[] = [
  {
    id: 'col-001', cardId: 'umbreon-ex-pe', card: MOCK_CARDS[1],
    quantity: 1, condition: 'mint',
    grading: { company: 'PSA', grade: 10, certNumber: '88245612', gradedAt: '2025-04-15', population: 847 },
    acquiredAt: '2025-02-18', acquiredPrice: 680, currency: 'AUD',
    notes: 'Alt art — pristine centering', isForSale: false, isForTrade: false,
  },
  {
    id: 'col-002', cardId: 'charizard-ex-ob', card: MOCK_CARDS[0],
    quantity: 1, condition: 'near_mint',
    grading: { company: 'PSA', grade: 10, certNumber: '75839201', gradedAt: '2024-11-03', population: 2341 },
    acquiredAt: '2024-09-12', acquiredPrice: 420, currency: 'AUD',
    isForSale: true,
  },
  {
    id: 'col-003', cardId: 'rayquaza-vmax-es', card: MOCK_CARDS[3],
    quantity: 1, condition: 'mint',
    grading: { company: 'BGS', grade: 9.5, certNumber: '0012984715', gradedAt: '2023-06-28' },
    acquiredAt: '2023-04-10', acquiredPrice: 340, currency: 'AUD',
  },
  {
    id: 'col-004', cardId: 'luffy-op01', card: MOCK_CARDS[8],
    quantity: 1, condition: 'near_mint',
    grading: { company: 'CGC', grade: 10, certNumber: 'CGC-2024-88841', gradedAt: '2024-08-14' },
    acquiredAt: '2024-05-20', acquiredPrice: 180, currency: 'AUD',
    isForTrade: true,
  },
  {
    id: 'col-005', cardId: 'lugia-v-st', card: MOCK_CARDS[4],
    quantity: 1, condition: 'mint',
    acquiredAt: '2023-12-25', acquiredPrice: 78, currency: 'AUD',
  },
  {
    id: 'col-006', cardId: 'pikachu-ex-151', card: MOCK_CARDS[2],
    quantity: 3, condition: 'near_mint',
    acquiredAt: '2024-01-15', acquiredPrice: 35, currency: 'AUD',
  },
];

export const MOCK_PORTFOLIO: PortfolioSummary = {
  totalValue: 24850.40,
  totalCost: 17200.00,
  totalGain: 7650.40,
  totalGainPercent: 44.48,
  currency: 'AUD',
  cardCount: 10,
  uniqueCardCount: 6,
  chartData: PORTFOLIO_CHART_DATA,
};

export function getCollection(): CollectionItem[] {
  return MOCK_COLLECTION;
}

export function getPortfolioSummary(): PortfolioSummary {
  return MOCK_PORTFOLIO;
}

export function getForSaleItems(): CollectionItem[] {
  return MOCK_COLLECTION.filter(i => i.isForSale);
}

export function getForTradeItems(): CollectionItem[] {
  return MOCK_COLLECTION.filter(i => i.isForTrade);
}

// ── Sealed products ───────────────────────────────────────────────────────────

export interface SealedProduct {
  id: string;
  name: string;
  tcg: string;
  value: number;
  qty: number;
}

const MOCK_SEALED_PRODUCTS: SealedProduct[] = [
  { id: 'sealed-001', name: 'Prismatic Evolutions ETB', tcg: 'Pokémon', value: 420, qty: 2 },
  { id: 'sealed-002', name: 'Obsidian Flames Booster Box', tcg: 'Pokémon', value: 380, qty: 1 },
];

export function getSealedProducts(): SealedProduct[] {
  return MOCK_SEALED_PRODUCTS;
}

// ── Set progress ──────────────────────────────────────────────────────────────

export interface SetProgress {
  id: string;
  name: string;
  total: number;
  owned: number;
  tcg: string;
}

const MOCK_SET_PROGRESS: SetProgress[] = [
  { id: 'sv-pe', name: 'Prismatic Evolutions', total: 170, owned: 42, tcg: 'Pokémon' },
  { id: 'sv-ob', name: 'Obsidian Flames', total: 197, owned: 28, tcg: 'Pokémon' },
  { id: 'op-01', name: 'Romance Dawn', total: 121, owned: 15, tcg: 'One Piece' },
];

export function getSetProgress(): SetProgress[] {
  return MOCK_SET_PROGRESS;
}

// ── Collection Insights (Pro analytics) ───────────────────────────────────────

export interface InsightsChartPoint {
  date: string;   // ISO date label e.g. '2025-01'
  value: number;  // portfolio value in AUD at that point
}

export interface InsightsHighlight {
  label: string;
  cardName: string;
  set: string;
  valueDelta: number;   // absolute AUD change
  deltaPercent: number; // percent change
}

export interface InsightsBreakdown {
  label: string;
  percent: number;  // 0–100
  color: string;
}

export interface CollectionInsights {
  portfolioValue: number;
  totalInvested: number;
  estimatedGain: number;
  estimatedGainPercent: number;
  cardCount: number;
  currency: string;
  chartData: Record<string, InsightsChartPoint[]>;
  highlights: {
    bestPerformer: InsightsHighlight;
    biggestDecline: InsightsHighlight;
    mostValuable: InsightsHighlight;
    fastestGrowing: InsightsHighlight;
  };
  breakdown: {
    rawVsGraded: InsightsBreakdown[];
    tcgAllocation: InsightsBreakdown[];
    setAllocation: InsightsBreakdown[];
    gradingCompany: InsightsBreakdown[];
  };
  gains: {
    realisedGains: number;
    unrealisedGains: number;
    avgPurchasePrice: number;
  };
}

/** Weekly data points — suitable for 1M (4 pts) and 3M (13 pts) ranges. */
function makeWeeklyPoints(base: number, weeks: number, trend: number, noise: number): InsightsChartPoint[] {
  // Reference: 12 Aug 2026
  const nowMs = new Date(2026, 7, 12).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const points: InsightsChartPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * msPerWeek);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = (weeks - 1 - i) / Math.max(weeks - 1, 1);
    const v = base + trend * t + noise * Math.sin(i * 1.7 + 0.4) + noise * 0.4 * Math.sin(i * 3.1);
    points.push({ date: label, value: Math.round(v) });
  }
  return points;
}

/** Monthly data points — suitable for 6M (6 pts), 1Y (12 pts), and ALL (30 pts) ranges. */
function makeMonthlyPoints(base: number, months: number, trend: number, noise: number): InsightsChartPoint[] {
  const now = new Date(2026, 7, 1); // Aug 2026
  const points: InsightsChartPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const t = (months - 1 - i) / Math.max(months - 1, 1);
    const v = base + trend * t + noise * Math.sin(i * 1.7 + 0.4) + noise * 0.4 * Math.sin(i * 3.1);
    points.push({ date: label, value: Math.round(v) });
  }
  return points;
}

export const MOCK_COLLECTION_INSIGHTS: CollectionInsights = {
  portfolioValue: 24850,
  totalInvested: 18420,
  estimatedGain: 6430,
  estimatedGainPercent: 34.9,
  cardCount: 10,
  currency: 'AUD',
  chartData: {
    '1M':  makeWeeklyPoints(23200,  4,  1650,  120),  //  4 weekly pts  → spans ~1 month
    '3M':  makeWeeklyPoints(21800, 13,  3050,  280),  // 13 weekly pts  → spans ~3 months
    '6M':  makeMonthlyPoints(20400,  6, 4450,  520),  //  6 monthly pts → spans 6 months
    '1Y':  makeMonthlyPoints(16200, 12, 8650,  800),  // 12 monthly pts → spans 1 year
    'ALL': makeMonthlyPoints(9800,  30, 15050, 1200), // 30 monthly pts → spans ~2.5 years
  },
  highlights: {
    bestPerformer: {
      label: 'Best Performer',
      cardName: 'Umbreon EX (Alt Art)',
      set: 'Paldean Fates',
      valueDelta: 1820,
      deltaPercent: 267,
    },
    biggestDecline: {
      label: 'Biggest Decline',
      cardName: 'Lugia V (Alt Art)',
      set: 'Silver Tempest',
      valueDelta: -420,
      deltaPercent: -18,
    },
    mostValuable: {
      label: 'Most Valuable',
      cardName: 'Charizard EX (SAR)',
      set: 'Obsidian Flames',
      valueDelta: 980,
      deltaPercent: 41,
    },
    fastestGrowing: {
      label: 'Fastest Growing',
      cardName: 'Rayquaza VMAX (Alt Art)',
      set: 'Evolving Skies',
      valueDelta: 640,
      deltaPercent: 88,
    },
  },
  breakdown: {
    rawVsGraded: [
      { label: 'Graded', percent: 78, color: '#6366F1' },
      { label: 'Raw',    percent: 22, color: '#8B5CF6' },
    ],
    tcgAllocation: [
      { label: 'Pokémon',   percent: 72, color: '#FACC15' },
      { label: 'MTG',       percent: 14, color: '#F97316' },
      { label: 'One Piece', percent: 14, color: '#22C55E' },
    ],
    setAllocation: [
      { label: 'Paldean Fates',   percent: 38, color: '#6366F1' },
      { label: 'Obsidian Flames', percent: 28, color: '#F97316' },
      { label: 'Evolving Skies',  percent: 20, color: '#22C55E' },
      { label: 'Other',           percent: 14, color: '#888888' },
    ],
    gradingCompany: [
      { label: 'PSA', percent: 55, color: '#EF4444' },
      { label: 'BGS', percent: 28, color: '#FACC15' },
      { label: 'CGC', percent: 17, color: '#3B82F6' },
    ],
  },
  gains: {
    realisedGains: 1240,
    unrealisedGains: 5190,
    avgPurchasePrice: 1842,
  },
};

export function getCollectionInsights(): CollectionInsights {
  return MOCK_COLLECTION_INSIGHTS;
}
