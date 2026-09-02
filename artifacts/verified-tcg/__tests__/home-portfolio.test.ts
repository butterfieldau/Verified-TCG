import type { CollectionItem } from '../types';
import type { CollectionPerformance, CollectionSummary } from '../services/collectionPerformance';
import {
  getHomeCollectionCards,
  hasHomeCollectionHoldings,
  getHomePerformanceView,
  getHomePortfolioValueState,
} from '../services/homePortfolio';
import {
  TRADING_CARD_ASPECT_RATIO,
  tradingCardHeight,
  tradingCardRadius,
} from '../services/collectionLayout';

const summary = (overrides: Partial<CollectionSummary> = {}): CollectionSummary => ({
  totalValue: 100,
  totalCost: 80,
  unrealizedGain: 20,
  unrealizedGainPercent: 25,
  realisedGain: null,
  cardCount: 1,
  uniqueCardCount: 1,
  currency: 'AUD',
  coverage: { pricedHoldings: 1, totalHoldings: 1, ratio: 1, freshHoldings: 1, staleHoldings: 0 },
  todayMovement: null,
  movement30d: null,
  completeness: 'Complete',
  ...overrides,
});

const item = (id: string, valuation: number | null, acquiredPrice = 100): CollectionItem => ({
  id,
  cardId: id,
  quantity: 1,
  condition: 'near_mint',
  acquiredAt: '2025-01-01',
  acquiredPrice,
  currency: 'AUD',
  valuation: valuation == null ? null : {
    priceCents: valuation * 100,
    price: valuation,
    currency: 'AUD',
    gradeKey: 'raw',
    updatedAt: '2025-01-01',
    costBasis: acquiredPrice > 0 ? acquiredPrice : null,
    gain: acquiredPrice > 0 ? valuation - acquiredPrice : null,
    gainPercent: acquiredPrice > 0 ? ((valuation - acquiredPrice) / acquiredPrice) * 100 : null,
  },
  card: {
    id, name: id, setId: 'set', setName: 'Set', tcg: 'pokemon', number: '1',
    rarity: 'rare', year: 2025, gradientStart: '#000', gradientEnd: '#111',
    price: { raw: valuation ?? 0, currency: 'AUD', updatedAt: '2025-01-01' },
  },
});

const performance = (points: CollectionPerformance['points']): CollectionPerformance => ({
  points, realisedGain: null, unrealisedGain: null, costBasis: null, currency: 'AUD',
  allocations: [], topPerformers: [], worstPerformers: [], historyAvailable: points.length > 0, completeness: '',
});

describe('home portfolio view models', () => {
  it('uses zero only for an authoritative empty collection', () => {
    expect(getHomePortfolioValueState(summary({ cardCount: 0, totalValue: 0 }), false, false, 'AUD'))
      .toEqual({ kind: 'empty', value: 0, currency: 'AUD' });
    expect(getHomePortfolioValueState(null, false, true, 'AUD')).toEqual({ kind: 'unavailable' });
  });

  it('shows a populated full or partial canonical total', () => {
    expect(getHomePortfolioValueState(summary(), false, false, 'AUD')).toMatchObject({ kind: 'priced', value: 100, unpricedHoldings: 0 });
    expect(getHomePortfolioValueState(summary({
      totalValue: 75,
      coverage: { pricedHoldings: 3, totalHoldings: 5, ratio: .6, freshHoldings: 3, staleHoldings: 0 },
    }), false, false, 'AUD')).toMatchObject({ kind: 'priced', value: 75, unpricedHoldings: 2 });
  });

  it('sorts collection previews by canonical gain and puts unknowns last', () => {
    const cards = getHomeCollectionCards([
      item('loss', 50),
      item('unknown-value', null),
      item('gain', 150),
      item('unknown-cost', 90, 0),
    ]);
    expect(cards.map(card => card.item.id)).toEqual(['gain', 'loss', 'unknown-value', 'unknown-cost']);
  });

  it('keeps a persisted but unpriced holding out of the collection empty state', () => {
    expect(hasHomeCollectionHoldings([item('unpriced', null)])).toBe(true);
    expect(hasHomeCollectionHoldings([])).toBe(false);
  });

  it('distinguishes one real snapshot from a real multi-point chart', () => {
    expect(getHomePerformanceView(performance([{ date: '2025-01-01', value: 100, currency: 'AUD' }]), '1D').kind).toBe('initial');
    expect(getHomePerformanceView(performance([
      { date: '2025-01-01', value: 100, currency: 'AUD' },
      { date: '2025-01-02', value: 110, currency: 'AUD' },
    ]), '7D')).toMatchObject({ kind: 'chart' });
  });
});

describe('collection card framing', () => {
  it('uses physical trading-card proportions without an oversized corner radius', () => {
    expect(TRADING_CARD_ASPECT_RATIO).toBeCloseTo(1.4);
    expect(tradingCardHeight(150)).toBe(210);
    expect(tradingCardRadius(150)).toBeCloseTo(6.75);
  });
});
