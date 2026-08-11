import type { Card, CardSet, TCGId } from '@/types';
import { proxyImageUrl } from './imageProxy';

export const CARD_SETS: CardSet[] = [
  { id: 'sv-ob',  name: 'Obsidian Flames',        tcg: 'pokemon',  releaseDate: '2023-08-11', totalCards: 230, series: 'Scarlet & Violet' },
  { id: 'sv-pe',  name: 'Prismatic Evolutions',   tcg: 'pokemon',  releaseDate: '2025-01-17', totalCards: 170, series: 'Scarlet & Violet' },
  { id: 'sv-151', name: 'SV: 151',                tcg: 'pokemon',  releaseDate: '2023-09-22', totalCards: 207, series: 'Scarlet & Violet' },
  { id: 'sv-es',  name: 'Evolving Skies',         tcg: 'pokemon',  releaseDate: '2021-08-27', totalCards: 237, series: 'Sword & Shield' },
  { id: 'sv-st',  name: 'Silver Tempest',         tcg: 'pokemon',  releaseDate: '2022-11-11', totalCards: 245, series: 'Sword & Shield' },
  { id: 'sv-mh3', name: 'Modern Horizons 3',      tcg: 'magic',    releaseDate: '2024-06-14', totalCards: 303, series: 'Modern Horizons' },
  { id: 'mtg-mh', name: 'Innistrad: Midnight Hunt', tcg: 'magic',  releaseDate: '2021-09-24', totalCards: 380 },
  { id: 'op-01',  name: 'Romance Dawn',           tcg: 'onepiece', releaseDate: '2022-12-02', totalCards: 121 },
  { id: 'op-04',  name: 'Kingdoms of Intrigue',   tcg: 'onepiece', releaseDate: '2023-07-28', totalCards: 114 },
  { id: 'op-09',  name: 'The Four Emperors',      tcg: 'onepiece', releaseDate: '2024-12-06', totalCards: 121 },
];

export const MOCK_CARDS: Card[] = [
  {
    id: 'charizard-ex-ob',
    name: 'Charizard ex',
    setId: 'sv-ob', setName: 'Obsidian Flames',
    tcg: 'pokemon', number: '125/197', rarity: 'ultra_rare', year: 2023,
    gradientStart: '#E0540F', gradientEnd: '#7B2D0A', isHolo: true,
    imageUrl: 'https://images.pokemontcg.io/sv3/125_hires.png',
    price: { raw: 38, psa9: 95, psa10: 580, bgs9: 85, bgs95: 320, cgc10: 440, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 2.4, change7d: 8.1, change30d: -3.2 },
    verificationStatus: 'verified',
  },
  {
    id: 'umbreon-ex-pe',
    name: 'Umbreon ex',
    setId: 'sv-pe', setName: 'Prismatic Evolutions',
    tcg: 'pokemon', number: '161/131', rarity: 'special_illustration', year: 2025,
    gradientStart: '#1A1B4B', gradientEnd: '#F5C518', isHolo: true,
    imageUrl: 'https://images.pokemontcg.io/sv8pt5/161_hires.png',
    price: { raw: 220, psa9: 580, psa10: 1450, bgs9: 980, bgs95: 1200, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 8.4, change7d: 15.2, change30d: 42.1 },
    verificationStatus: 'verified',
  },
  {
    id: 'pikachu-ex-151',
    name: 'Pikachu ex',
    setId: 'sv-151', setName: 'SV: 151',
    tcg: 'pokemon', number: '025/165', rarity: 'ultra_rare', year: 2023,
    gradientStart: '#FFD700', gradientEnd: '#FF8C00', isHolo: true,
    imageUrl: 'https://images.pokemontcg.io/sv3pt5/25_hires.png',
    price: { raw: 45, psa9: 120, psa10: 340, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: -1.2, change7d: 3.4 },
    verificationStatus: 'verified',
  },
  {
    id: 'rayquaza-vmax-es',
    name: 'Rayquaza VMAX',
    setId: 'sv-es', setName: 'Evolving Skies',
    tcg: 'pokemon', number: '218/203', rarity: 'secret_rare', year: 2021,
    gradientStart: '#3AE374', gradientEnd: '#1A7A3C', isHolo: true,
    imageUrl: 'https://images.pokemontcg.io/swsh7/218_hires.png',
    price: { raw: 280, psa9: 480, psa10: 890, bgs9: 620, bgs95: 750, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 1.8, change7d: -4.3 },
    verificationStatus: 'verified',
  },
  {
    id: 'lugia-v-st',
    name: 'Lugia V',
    setId: 'sv-st', setName: 'Silver Tempest',
    tcg: 'pokemon', number: '186/195', rarity: 'special_illustration', year: 2022,
    gradientStart: '#B0C4DE', gradientEnd: '#4169E1', isHolo: true,
    imageUrl: 'https://images.pokemontcg.io/swsh12/186_hires.png',
    price: { raw: 95, psa9: 220, psa10: 680, cgc10: 590, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 3.2, change7d: 9.8 },
    verificationStatus: 'verified',
  },
  {
    id: 'mewtwo-ex-sv',
    name: 'Mewtwo ex',
    setId: 'sv-ob', setName: 'Scarlet & Violet Base',
    tcg: 'pokemon', number: '232/198', rarity: 'hyper_rare', year: 2023,
    gradientStart: '#9B59B6', gradientEnd: '#4A0080', isHolo: true,
    // sv3pt5 = SV: 151 set; Mewtwo is Pokédex #150, confirmed 200
    imageUrl: 'https://images.pokemontcg.io/sv3pt5/150_hires.png',
    price: { raw: 38, psa10: 175, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: -0.5 },
    verificationStatus: 'unverified',
  },
  {
    id: 'liliana-veil',
    name: 'Liliana of the Veil',
    setId: 'mtg-mh', setName: 'Innistrad: Midnight Hunt',
    tcg: 'magic', number: '113/277', rarity: 'rare', year: 2021,
    gradientStart: '#2C1654', gradientEnd: '#5C2D8A',
    // Scryfall CDN — Liliana of the Veil, Innistrad (isd) original printing, verified 200
    imageUrl: 'https://cards.scryfall.io/large/front/a/c/ac506c17-adc8-49c6-9d8d-43db7cb1ec9d.jpg',
    price: { raw: 62, bgs95: 185, psa10: 220, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 0.8, change7d: 2.1 },
    verificationStatus: 'verified',
  },
  {
    id: 'jace-mind-sculptor',
    name: 'Jace, the Mind Sculptor',
    setId: 'sv-mh3', setName: 'Modern Horizons 3',
    tcg: 'magic', number: '064/287', rarity: 'rare', year: 2024,
    gradientStart: '#1E40AF', gradientEnd: '#0D2463',
    // Scryfall CDN — Jace, the Mind Sculptor (verified 200)
    imageUrl: 'https://cards.scryfall.io/large/front/c/8/c8817585-0d32-4d56-9142-0d29512e86a9.jpg',
    price: { raw: 85, psa10: 280, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 1.5 },
    verificationStatus: 'verified',
  },
  {
    id: 'luffy-op01',
    name: 'Monkey D. Luffy',
    setId: 'op-01', setName: 'Romance Dawn',
    tcg: 'onepiece', number: 'OP01-060', rarity: 'secret_rare', year: 2022,
    gradientStart: '#E63946', gradientEnd: '#8B0000', isFoil: true,
    // One Piece Card Game official CDN — OP01-001 is the Monkey D. Luffy leader card
    imageUrl: 'https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png',
    price: { raw: 55, psa9: 140, psa10: 320, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 5.2, change7d: 12.4 },
    verificationStatus: 'verified',
  },
  {
    id: 'boa-hancock-op04',
    name: 'Boa Hancock',
    setId: 'op-04', setName: 'Kingdoms of Intrigue',
    tcg: 'onepiece', number: 'OP04-085', rarity: 'rare', year: 2023,
    gradientStart: '#FF8FAB', gradientEnd: '#C0487A',
    // One Piece Card Game official CDN
    imageUrl: 'https://en.onepiece-cardgame.com/images/cardlist/card/OP04-085.png',
    price: { raw: 28, psa10: 95, currency: 'AUD', updatedAt: '2026-08-11T00:00:00Z', change24h: 1.4 },
    verificationStatus: 'unverified',
  },
];

// Apply CORS proxy to all image URLs so the browser can load card artwork.
// This is done once at module load so every consumer gets proxied URLs automatically.
MOCK_CARDS.forEach(card => {
  if (card.imageUrl) {
    card.imageUrl = proxyImageUrl(card.imageUrl);
  }
});

export function getCardById(id: string): Card | undefined {
  return MOCK_CARDS.find(c => c.id === id);
}

export function getCardsByTCG(tcg: TCGId): Card[] {
  return MOCK_CARDS.filter(c => c.tcg === tcg);
}

export function searchCards(query: string): Card[] {
  const q = query.toLowerCase().trim();
  if (!q) return MOCK_CARDS;
  return MOCK_CARDS.filter(
    c =>
      c.name.toLowerCase().includes(q) ||
      c.setName.toLowerCase().includes(q) ||
      c.number.toLowerCase().includes(q),
  );
}

export function getSetById(id: string): CardSet | undefined {
  return CARD_SETS.find(s => s.id === id);
}

export function getSetsByTCG(tcg: TCGId): CardSet[] {
  return CARD_SETS.filter(s => s.tcg === tcg);
}
