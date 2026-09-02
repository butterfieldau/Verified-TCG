import type { CollectionItem, PortfolioRange } from '@/types';
import type { CollectionPerformance, CollectionSummary, PerformancePoint } from './collectionPerformance';

export type HomePortfolioValueState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'empty'; value: 0; currency: string }
  | { kind: 'priced'; value: number; currency: string; unpricedHoldings: number };

/**
 * Keeps the home total honest: only an authoritative summary can establish an
 * empty collection, and a partially-priced collection is shown as a subtotal.
 */
export function getHomePortfolioValueState(
  summary: CollectionSummary | null,
  isLoading: boolean,
  hasFailed: boolean,
  fallbackCurrency: string,
): HomePortfolioValueState {
  if (isLoading && !summary) return { kind: 'loading' };
  if (hasFailed || !summary) return { kind: 'unavailable' };
  if (summary.cardCount === 0) return { kind: 'empty', value: 0, currency: summary.currency };
  if (summary.totalValue === null) return { kind: 'unavailable' };
  return {
    kind: 'priced',
    value: summary.totalValue,
    currency: summary.currency || fallbackCurrency,
    unpricedHoldings: Math.max(0, summary.coverage.totalHoldings - summary.coverage.pricedHoldings),
  };
}

export type HomePerformanceView =
  | { kind: 'unavailable'; message: string }
  | { kind: 'initial'; point: PerformancePoint }
  | { kind: 'chart'; points: PerformancePoint[] };

export function getHomePerformanceView(
  performance: CollectionPerformance | null,
  range: PortfolioRange,
): HomePerformanceView {
  if (!performance) return { kind: 'unavailable', message: 'Price history is not available yet' };
  const available = performance.points.filter(point => point.available !== false && point.value != null);
  if (available.length === 0) {
    return {
      kind: 'unavailable',
      message: performance.historyUnavailableReason
        ?? `No complete retained history is available for ${range}`,
    };
  }
  if (performance.points.length === 1) return { kind: 'initial', point: performance.points[0]! };
  if (performance.points.length >= 2) return { kind: 'chart', points: performance.points };
  return {
    kind: 'unavailable',
    message: performance.historyUnavailableReason
      ?? `No retained history is available for ${range}`,
  };
}

export interface HomeCollectionCard {
  item: CollectionItem;
  currentValue: number | null;
  currency: string | null;
  gainPercent: number | null;
}

/**
 * A collection empty state is about persisted holdings, never about whether a
 * current market quote has arrived. This keeps an unpriced graded card visible
 * instead of suggesting the collector has no collection at all.
 */
export function hasHomeCollectionHoldings(items: CollectionItem[]): boolean {
  return items.length > 0;
}

/** Uses only the server's exact per-holding valuation; card-price fallbacks
 * would make an unavailable valuation appear real. */
export function getHomeCollectionCards(items: CollectionItem[]): HomeCollectionCard[] {
  return items
    .map(item => {
      const currentValue = item.valuation?.price;
      const hasValuation = typeof currentValue === 'number' && Number.isFinite(currentValue);
      const serverGainPercent = item.valuation?.gainPercent;
      return {
        item,
        currentValue: hasValuation ? currentValue : null,
        currency: hasValuation ? item.valuation!.currency : null,
        gainPercent:
          hasValuation &&
          typeof serverGainPercent === 'number' &&
          Number.isFinite(serverGainPercent)
            ? serverGainPercent
            : null,
      };
    })
    .sort((a, b) => {
      if (a.gainPercent === null && b.gainPercent === null) return 0;
      if (a.gainPercent === null) return 1;
      if (b.gainPercent === null) return -1;
      return b.gainPercent - a.gainPercent;
    });
}
