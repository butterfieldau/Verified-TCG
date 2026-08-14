import type { CollectionItem, PortfolioSummary } from '@/types';
import { PORTFOLIO_CHART_DATA } from './market';
import { getAccessToken } from './auth';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

// ── Value helper (kept for price-display callers) ─────────────────────────────

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

// ── Authenticated API helpers ─────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ── Collection API calls ──────────────────────────────────────────────────────

/** Fetch all collection items for the signed-in user from the server. */
export async function fetchCollection(): Promise<CollectionItem[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection`, { headers });
  if (!res.ok) throw new Error(`Failed to load collection (${res.status})`);
  return res.json() as Promise<CollectionItem[]>;
}

/** Add a card to the server collection. Returns the persisted item (server-assigned id). */
export async function addCollectionItem(
  item: CollectionItem,
): Promise<CollectionItem> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      cardId: item.cardId,
      card: item.card,
      quantity: item.quantity,
      condition: item.condition,
      grading: item.grading ?? null,
      acquiredAt: item.acquiredAt,
      acquiredPrice: item.acquiredPrice,
      notes: item.notes,
      isForSale: item.isForSale ?? false,
      isForTrade: item.isForTrade ?? false,
    }),
  });
  if (!res.ok) throw new Error(`Failed to add card (${res.status})`);
  return res.json() as Promise<CollectionItem>;
}

/** Update a collection item's mutable fields. Returns the updated item. */
export async function updateCollectionItem(
  id: string,
  patch: Partial<Pick<CollectionItem, 'quantity' | 'condition' | 'grading' | 'notes' | 'isForSale' | 'isForTrade' | 'acquiredPrice'>>,
): Promise<CollectionItem> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update card (${res.status})`);
  return res.json() as Promise<CollectionItem>;
}

/** Remove a card from the user's collection on the server. */
export async function removeCollectionItem(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/collection/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error(`Failed to remove card (${res.status})`);
}

// ── Sealed products (static, out of scope for this task) ─────────────────────

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

// ── Set progress (static, out of scope for this task) ────────────────────────

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

// ── Collection Insights (Pro analytics — static mock, separate task) ──────────

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
  const now = new Date(2026, 7, 1);
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
    '1M':  makeWeeklyPoints(23200,  4,  1650,  120),
    '3M':  makeWeeklyPoints(21800, 13,  3050,  280),
    '6M':  makeMonthlyPoints(20400,  6, 4450,  520),
    '1Y':  makeMonthlyPoints(16200, 12, 8650,  800),
    'ALL': makeMonthlyPoints(9800,  30, 15050, 1200),
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
