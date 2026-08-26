/**
 * Tests for TCGPlayer CDN URL helpers in services/catalogApi.ts
 *
 * Covers:
 *   - buildTcgPlayerUrl: constructs the correct fit-in URL for a given size
 *   - resizeTcgPlayerUrl: rewrites the size segment of an existing TCGPlayer URL
 *   - resizeTcgPlayerUrl: leaves non-TCGPlayer URLs (pokemontcg.io, etc.) unchanged
 *   - Thumbnail vs. detail size split: list views use 437, detail keeps 1000
 */

import { buildTcgPlayerUrl, catalogCardToAppCard, resizeTcgPlayerUrl } from '../services/catalogApi';

// ── buildTcgPlayerUrl ─────────────────────────────────────────────────────────

test('buildTcgPlayerUrl: default size is 1000x1000', () => {
  expect(buildTcgPlayerUrl('12345')).toBe(
    'https://product-images.tcgplayer.com/fit-in/1000x1000/12345.jpg',
  );
});

test('buildTcgPlayerUrl: thumbnail size 437x437', () => {
  expect(buildTcgPlayerUrl('12345', 437)).toBe(
    'https://product-images.tcgplayer.com/fit-in/437x437/12345.jpg',
  );
});

test('buildTcgPlayerUrl: arbitrary size', () => {
  expect(buildTcgPlayerUrl('99999', 600)).toBe(
    'https://product-images.tcgplayer.com/fit-in/600x600/99999.jpg',
  );
});

// ── resizeTcgPlayerUrl ────────────────────────────────────────────────────────

test('resizeTcgPlayerUrl: rewrites 1000x1000 to 437x437', () => {
  const full = 'https://product-images.tcgplayer.com/fit-in/1000x1000/12345.jpg';
  expect(resizeTcgPlayerUrl(full, 437)).toBe(
    'https://product-images.tcgplayer.com/fit-in/437x437/12345.jpg',
  );
});

test('resizeTcgPlayerUrl: rewrites 437x437 back to 1000x1000', () => {
  const thumb = 'https://product-images.tcgplayer.com/fit-in/437x437/12345.jpg';
  expect(resizeTcgPlayerUrl(thumb, 1000)).toBe(
    'https://product-images.tcgplayer.com/fit-in/1000x1000/12345.jpg',
  );
});

test('resizeTcgPlayerUrl: leaves pokemontcg.io URLs unchanged', () => {
  const pokeUrl = 'https://images.pokemontcg.io/sv3/125.png';
  expect(resizeTcgPlayerUrl(pokeUrl, 437)).toBe(pokeUrl);
});

test('resizeTcgPlayerUrl: leaves arbitrary non-TCGPlayer URLs unchanged', () => {
  const other = 'https://example.com/card.jpg';
  expect(resizeTcgPlayerUrl(other, 437)).toBe(other);
});

test('resizeTcgPlayerUrl: returns undefined when given undefined', () => {
  expect(resizeTcgPlayerUrl(undefined, 437)).toBeUndefined();
});

// ── Thumbnail vs. detail split ────────────────────────────────────────────────

test('list views get 437x437, detail view keeps 1000x1000', () => {
  const tcgplayerId = '555999';
  const detailUrl = buildTcgPlayerUrl(tcgplayerId, 1000);
  const thumbUrl  = resizeTcgPlayerUrl(detailUrl, 437);

  // Detail: full resolution
  expect(detailUrl).toContain('fit-in/1000x1000');

  // Thumbnail: smaller resolution, same product ID
  expect(thumbUrl).toContain('fit-in/437x437');
  expect(thumbUrl).toContain(`/${tcgplayerId}.jpg`);
});

test('catalogCardToAppCard preserves the API snapshot currency', () => {
  const card = catalogCardToAppCard({
    id: 'real-card-id',
    name: 'Real Card',
    game: 'Pokemon',
    set_name: 'Real Set',
    variants: [{
      id: 'raw',
      condition: 'Near Mint',
      price: 120,
      markets: [{ region: 'source', currency: 'USD', price: 120 }],
    }],
  });
  expect(card.price.currency).toBe('USD');
  expect(card.price.raw).toBe(120);
});
