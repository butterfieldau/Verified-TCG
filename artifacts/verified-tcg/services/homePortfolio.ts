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
  const drawablePoints = getRenderableHomeChartPoints(performance.points);
  const available = drawablePoints.filter(point => point.available !== false && point.value != null);
  if (!performance.historyAvailable || available.length === 0) {
    return {
      kind: 'unavailable',
      message: performance.historyUnavailableReason
        ?? `No retained market value is available for ${range}`,
    };
  }
  if (available.length === 1) return { kind: 'initial', point: available[0]! };
  if (drawablePoints.length >= 2) return { kind: 'chart', points: drawablePoints };
  return {
    kind: 'unavailable',
    message: performance.historyUnavailableReason
      ?? `No retained history is available for ${range}`,
  };
}

/**
 * Keep the first and last timeline observations on the chart edges. A single
 * retained observation is the latest known value, so it is right-anchored
 * rather than presented as a misleading centered trend.
 */
export function chartXForIndex(
  index: number,
  count: number,
  width: number,
  padLeft = 0,
  padRight = 0,
): number {
  if (count <= 1) return width - padRight;
  return padLeft + (index / (count - 1)) * Math.max(width - padLeft - padRight, 0);
}

/**
 * Do not let an account-creation zero or unavailable samples create an empty
 * leading span before the first real market observation. The baseline is an
 * ownership event, not a price, so including it would manufacture a portfolio
 * gain. Missing samples remain available to the caller for completeness copy.
 */
export function getRenderableHomeChartPoints(points: PerformancePoint[]): PerformancePoint[] {
  const firstMarketObservationIndex = points.findIndex(
    point =>
      point.baseline !== true &&
      point.available !== false &&
      point.value != null &&
      (point.pricedHoldings === undefined || point.pricedHoldings > 0),
  );
  return firstMarketObservationIndex > 0 ? points.slice(firstMarketObservationIndex) : points;
}

export type HomePortfolioGain = {
  amount: number;
  percent: number | null;
  partial: boolean;
  pricedHoldings: number;
  totalHoldings: number;
};

/**
 * A fully priced collection can show its complete unrealised gain. When a
 * holding has no exact quote, show only the gain for holdings with both a
 * verified value and a recorded cost basis, explicitly labelled as partial.
 */
export function getHomePortfolioGain(summary: CollectionSummary | null): HomePortfolioGain | null {
  if (!summary) return null;
  if (summary.unrealizedGain !== null && summary.unrealizedGain !== undefined) {
    return {
      amount: summary.unrealizedGain,
      percent: summary.unrealizedGainPercent ?? null,
      partial: false,
      pricedHoldings: summary.coverage.pricedHoldings,
      totalHoldings: summary.coverage.totalHoldings,
    };
  }
  if (summary.partialUnrealizedGain === null || summary.partialUnrealizedGain === undefined) {
    return null;
  }
  return {
    amount: summary.partialUnrealizedGain,
    percent: summary.partialUnrealizedGainPercent ?? null,
    partial: true,
    pricedHoldings: summary.gainCoverage?.pricedHoldings ?? summary.coverage.pricedHoldings,
    totalHoldings: summary.gainCoverage?.totalHoldings ?? summary.coverage.totalHoldings,
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
