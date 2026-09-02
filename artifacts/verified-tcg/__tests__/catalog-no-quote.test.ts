import { catalogCardToAppCard } from '@/services/catalogApi';

describe('catalog cards without a quote', () => {
  it('preserves a null quote timestamp instead of fabricating mapping time', () => {
    const card = catalogCardToAppCard({
      id: 'unquoted',
      name: 'Unquoted card',
      game: 'Pokemon',
      variants: [{ condition: 'Near Mint', price: null }],
    });

    expect(card.price.raw).toBe(0);
    expect(card.price.available).toBe(false);
    expect(card.price.updatedAt).toBeNull();
    expect(card.year).toBe(0);
  });

  it('does not treat a JustTCG catalogue price as verified market pricing', () => {
    const card = catalogCardToAppCard({
      id: 'justtcg-only',
      name: 'Monkey.D.Luffy',
      game: 'One Piece',
      variants: [{ condition: 'Near Mint', price: 999 }],
    });

    expect(card.price.raw).toBe(0);
    expect(card.price.available).toBe(false);
  });

  it('accepts an explicitly server-backed JustTCG raw quote for search display', () => {
    const card = catalogCardToAppCard({
      id: 'justtcg-priced',
      name: 'Monkey.D.Luffy',
      game: 'One Piece',
      pricing_source: 'JustTCG',
      currency: 'USD',
      variants: [{ condition: 'Near Mint', price: 18.5, lastUpdated: 1_788_220_800 }],
    });

    expect(card.price.raw).toBe(18.5);
    expect(card.price.available).toBe(true);
    expect(card.price.currency).toBe('USD');
  });

  it('accepts an exact persisted PriceCharting quote for search display', () => {
    const card = catalogCardToAppCard({
      id: 'priced',
      name: 'Pikachu',
      game: 'Pokemon',
      pricing_source: 'PriceCharting',
      currency: 'AUD',
      variants: [{ condition: 'Near Mint', price: 42.5, lastUpdated: 1_788_220_800 }],
    });

    expect(card.price.raw).toBe(42.5);
    expect(card.price.available).toBe(true);
    expect(card.price.currency).toBe('AUD');
  });

  it('accepts the persisted PriceCharting market price when a feed omits variant pricing', () => {
    const card = catalogCardToAppCard({
      id: 'feed-priced',
      name: 'Umbreon',
      game: 'Pokemon',
      pricing_source: 'pricecharting',
      market_price: 1312.4,
      currency: 'USD',
      variants: [],
    });

    expect(card.price.raw).toBe(1312.4);
    expect(card.price.available).toBe(true);
    expect(card.price.currency).toBe('USD');
  });
});
