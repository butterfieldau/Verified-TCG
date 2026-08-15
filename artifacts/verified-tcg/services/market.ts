import type { Card, MarketMover, PriceRecord, PortfolioDataPoint, PortfolioRange } from '@/types';
import { catalogCardToAppCard } from './catalogApi';
import type { CatalogCard } from './catalogApi';

// Resolve the API base URL the same way catalogApi.ts does.
const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
const API_BASE = `${explicitBase || domainBase}/api`;

// ── Server response shapes ────────────────────────────────────────────────────

interface MarketMoverServerCard extends CatalogCard {
  market_price: number;
  price_change_7d: number;
  trend: 'up' | 'down' | 'neutral';
}

// ── Live API functions ────────────────────────────────────────────────────────

/**
 * Fetches the top market movers from the API server.
 * Cards are sorted server-side by absolute 7-day price change.
 * Returns an empty array on error so callers can show a graceful fallback.
 */
export async function getMarketMovers(): Promise<MarketMover[]> {
  if (!API_BASE || API_BASE === '/api') return [];
  try {
    const res = await fetch(`${API_BASE}/catalog/market-movers`);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.data as MarketMoverServerCard[]).map((card) => ({
      card: catalogCardToAppCard(card),
      currentPrice: card.market_price,
      priceChange: (card.market_price * card.price_change_7d) / 100,
      priceChangePercent: card.price_change_7d,
      trend: card.trend,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetches trending cards — sorted by trading activity (price update frequency).
 * Returns an empty array on error.
 */
export async function getTrendingCards(): Promise<Card[]> {
  if (!API_BASE || API_BASE === '/api') return [];
  try {
    const res = await fetch(`${API_BASE}/catalog/trending`);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.data as CatalogCard[]).map(catalogCardToAppCard);
  } catch {
    return [];
  }
}

/**
 * Fetches recently-added catalog cards — high-value cards from current sets.
 * Returns an empty array on error.
 */
export async function getRecentlyAddedCards(): Promise<Card[]> {
  if (!API_BASE || API_BASE === '/api') return [];
  try {
    const res = await fetch(`${API_BASE}/catalog/recently-added`);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.data as CatalogCard[]).map(catalogCardToAppCard);
  } catch {
    return [];
  }
}

// ── Portfolio chart data (still generated locally — collection-owned) ─────────

function generateChartData(
  baseValue: number,
  days: number,
  volatility: number,
): PortfolioDataPoint[] {
  const data: PortfolioDataPoint[] = [];
  let value = baseValue;
  const now = Date.now();
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

// ── Price refresh (still simulated — real price refresh is task #20 scope) ────

export function simulateRefreshedPrice(cardId: string, current: PriceRecord): PriceRecord {
  const timeBucket = Math.floor(Date.now() / 60000);
  const cardSeed = cardId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const raw01 = ((timeBucket * 9301 + cardSeed * 49297) % 233280) / 233280;
  const variation = 1 + (raw01 - 0.5) * 0.06;

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

export async function fetchRefreshedPrices(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1200));
}

