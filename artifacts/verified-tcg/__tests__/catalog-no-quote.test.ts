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
    expect(card.price.updatedAt).toBeNull();
    expect(card.year).toBe(0);
  });
});