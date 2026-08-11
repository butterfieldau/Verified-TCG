import type { MarketMover, PortfolioDataPoint, PortfolioRange } from '@/types';
import { MOCK_CARDS } from './cards';

export const MARKET_MOVERS: MarketMover[] = [
  {
    card: MOCK_CARDS[1], // Umbreon ex
    currentPrice: 1450, priceChange: 112.8, priceChangePercent: 8.4,
    trend: 'up', volume: 127,
  },
  {
    card: MOCK_CARDS[0], // Charizard ex
    currentPrice: 580, priceChange: 13.6, priceChangePercent: 2.4,
    trend: 'up', volume: 245,
  },
  {
    card: MOCK_CARDS[8], // Luffy
    currentPrice: 320, priceChange: 15.9, priceChangePercent: 5.2,
    trend: 'up', volume: 89,
  },
  {
    card: MOCK_CARDS[3], // Rayquaza VMAX
    currentPrice: 890, priceChange: -38.8, priceChangePercent: -4.3,
    trend: 'down', volume: 56,
  },
  {
    card: MOCK_CARDS[4], // Lugia V
    currentPrice: 680, priceChange: 21.4, priceChangePercent: 3.2,
    trend: 'up', volume: 94,
  },
  {
    card: MOCK_CARDS[2], // Pikachu ex
    currentPrice: 340, priceChange: -4.1, priceChangePercent: -1.2,
    trend: 'down', volume: 312,
  },
];

// Generate realistic chart data for portfolio
function generateChartData(
  baseValue: number,
  days: number,
  volatility: number,
): PortfolioDataPoint[] {
  const data: PortfolioDataPoint[] = [];
  let value = baseValue;
  const now = Date.now();
  // Deterministic-ish using index-based pseudo-randomness
  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const seed = (days - i + 17) * 9301 + 49297;
    const rand = ((seed % 233280) / 233280 - 0.45) * volatility;
    value = Math.max(value * (1 + rand), 100);
    data.push({ date: date.toISOString().split('T')[0], value: Math.round(value * 100) / 100 });
  }
  return data;
}

export const PORTFOLIO_CHART_DATA: Record<PortfolioRange, PortfolioDataPoint[]> = {
  '1D':  generateChartData(24500, 1,   0.008),
  '7D':  generateChartData(23800, 7,   0.015),
  '1M':  generateChartData(22400, 30,  0.020),
  '3M':  generateChartData(20100, 90,  0.025),
  '1Y':  generateChartData(16200, 365, 0.030),
  'ALL': generateChartData(8500,  730, 0.040),
};

export function getMarketMovers(): MarketMover[] {
  return MARKET_MOVERS;
}

export function getTrendingCards() {
  return MOCK_CARDS.slice(0, 5);
}

// ── Most watched ──────────────────────────────────────────────────────────────

export interface WatchedEntry {
  card: typeof MOCK_CARDS[number];
  watchers: number;
  price: number;
}

const MOCK_MOST_WATCHED: WatchedEntry[] = [
  { card: MOCK_CARDS[1], watchers: 1247, price: 1450 },
  { card: MOCK_CARDS[0], watchers: 892,  price: 580  },
  { card: MOCK_CARDS[4], watchers: 634,  price: 680  },
];

export function getMostWatched(): WatchedEntry[] {
  return MOCK_MOST_WATCHED;
}

// ── Recent sales ──────────────────────────────────────────────────────────────

export interface RecentSale {
  card: typeof MOCK_CARDS[number];
  soldPrice: number;
  soldAt: string;
  grade: string | null;
}

const MOCK_RECENT_SALES: RecentSale[] = [
  { card: MOCK_CARDS[1], soldPrice: 1420, soldAt: '2h ago', grade: 'PSA 10'  },
  { card: MOCK_CARDS[0], soldPrice: 565,  soldAt: '4h ago', grade: 'PSA 10'  },
  { card: MOCK_CARDS[3], soldPrice: 870,  soldAt: '6h ago', grade: 'BGS 9.5' },
  { card: MOCK_CARDS[8], soldPrice: 48,   soldAt: '8h ago', grade: null       },
];

export function getRecentSales(): RecentSale[] {
  return MOCK_RECENT_SALES;
}

// ── New releases ──────────────────────────────────────────────────────────────

export interface SetRelease {
  id: string;
  name: string;
  tcg: string;
  releaseDate: string;
  cards: number;
  highlight: string;
}

const MOCK_NEW_RELEASES: SetRelease[] = [
  { id: 'sv-pe',  name: 'Prismatic Evolutions', tcg: 'Pokémon',  releaseDate: 'Jan 2025', cards: 170, highlight: 'Umbreon ex Alt Art'  },
  { id: 'op-09',  name: 'The Four Emperors',     tcg: 'One Piece', releaseDate: 'Dec 2024', cards: 121, highlight: 'Luffy SEC'            },
  { id: 'sv-mh3', name: 'Modern Horizons 3',      tcg: 'MTG',       releaseDate: 'Jun 2024', cards: 303, highlight: 'Nadu, Winged Wisdom'  },
];

export function getNewReleases(): SetRelease[] {
  return MOCK_NEW_RELEASES;
}

// ── Price refresh simulation ──────────────────────────────────────────────────

import type { PriceRecord } from '@/types';

/**
 * Simulates a market price refresh for a single card by applying a small
 * realistic variation (±3%) seeded on the current minute so repeated calls
 * within the same minute are stable, but a new pull-to-refresh a minute later
 * yields a visibly different result.
 */
export function simulateRefreshedPrice(cardId: string, current: PriceRecord): PriceRecord {
  const timeBucket = Math.floor(Date.now() / 60000); // changes every minute
  const cardSeed = cardId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const raw01 = ((timeBucket * 9301 + cardSeed * 49297) % 233280) / 233280; // 0..1
  const variation = 1 + (raw01 - 0.5) * 0.06; // ±3%

  function vary(v: number | undefined): number | undefined {
    return v !== undefined ? Math.round(v * variation * 100) / 100 : undefined;
  }

  return {
    ...current,
    raw:   Math.round(current.raw * variation * 100) / 100,
    psa9:  vary(current.psa9),
    psa10: vary(current.psa10),
    bgs9:  vary(current.bgs9),
    bgs95: vary(current.bgs95),
    cgc9:  vary(current.cgc9),
    cgc10: vary(current.cgc10),
    updatedAt: new Date().toISOString().split('T')[0],
  };
}

/** Simulates a short async delay for the refresh network call. */
export async function fetchRefreshedPrices(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1200));
}
