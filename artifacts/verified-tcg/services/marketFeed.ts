import type { Card, MarketMover, TCGId } from '@/types';

export type MarketTab = 'trending' | 'gainers' | 'losers' | 'new';

export interface MarketFeedCard {
  card: Card;
  price: number | null;
  currency: string;
  change?: number;
}

export function filterByTcg<T extends { card: Card }>(
  entries: T[],
  tcg: TCGId | 'all',
): T[] {
  return tcg === 'all' ? entries : entries.filter(entry => entry.card.tcg === tcg);
}

export function prioritizeTcgs<T extends { card: Card }>(entries: T[], preferred: TCGId[]): T[] {
  if (preferred.length === 0) return entries;
  const priority = new Map(preferred.map((tcg, index) => [tcg, index]));
  return [...entries].sort((a, b) =>
    (priority.get(a.card.tcg) ?? preferred.length) - (priority.get(b.card.tcg) ?? preferred.length));
}

export function getMarketFeed(
  tab: MarketTab,
  movers: MarketMover[],
  trending: Card[],
  recentlyAdded: Card[],
  preferredTcgs: TCGId[] = [],
): MarketFeedCard[] {
  let entries: MarketFeedCard[];
  if (tab === 'gainers') {
    entries = movers.filter(m => m.trend === 'up')
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .map(m => ({ card: m.card, price: m.currentPrice, currency: m.currency, change: m.priceChangePercent }));
  } else if (tab === 'losers') {
    entries = movers.filter(m => m.trend === 'down')
      .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
      .map(m => ({ card: m.card, price: m.currentPrice, currency: m.currency, change: m.priceChangePercent }));
  } else {
    const cards = tab === 'new' ? recentlyAdded : trending;
    entries = cards.map(card => ({
      card,
      price: card.price.raw > 0 ? card.price.raw : null,
      currency: card.price.currency,
      change: card.price.change7d,
    }));
  }
  return prioritizeTcgs(entries, preferredTcgs);
}