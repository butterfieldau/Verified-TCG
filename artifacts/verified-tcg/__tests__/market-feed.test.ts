import { filterByTcg, getMarketFeed, prioritizeTcgs } from '@/services/marketFeed';
import type { Card, MarketMover } from '@/types';

const card = (id: string, tcg: Card['tcg'], raw = 10): Card => ({
  id, tcg, name: id, setId: 'set', setName: 'Set', number: '1', rarity: 'rare',
  year: 2024, gradientStart: '#000', gradientEnd: '#111',
  price: { raw, currency: 'AUD', updatedAt: '2024-01-01', change7d: 2 },
});
const mover = (id: string, trend: MarketMover['trend'], change: number): MarketMover => ({
  card: card(id, id === 'magic' ? 'magic' : 'pokemon'), currentPrice: 10,
  priceChange: change, priceChangePercent: change, trend, currency: 'AUD', updatedAt: '2024-01-01',
});

describe('market feed derivations', () => {
  it('uses the corresponding genuine dataset and mover derivatives', () => {
    const movers = [mover('up', 'up', 8), mover('down', 'down', -3)];
    expect(getMarketFeed('gainers', movers, [], []).map(entry => entry.card.id)).toEqual(['up']);
    expect(getMarketFeed('losers', movers, [], []).map(entry => entry.card.id)).toEqual(['down']);
    expect(getMarketFeed('trending', movers, [card('trend', 'pokemon')], []).map(entry => entry.card.id)).toEqual(['trend']);
    const recent = getMarketFeed('new', movers, [], [card('unpriced', 'pokemon', 0)]);
    expect(recent[0].price).toBeNull();
  });

  it('filters selected games and puts saved preferences first', () => {
    const entries = [{ card: card('pokemon', 'pokemon') }, { card: card('magic', 'magic') }];
    expect(filterByTcg(entries, 'magic').map(entry => entry.card.id)).toEqual(['magic']);
    expect(prioritizeTcgs(entries, ['magic']).map(entry => entry.card.id)).toEqual(['magic', 'pokemon']);
  });
});