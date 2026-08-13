import type { Card, CardRarity } from '@/types';

// Use an explicit override first, then fall back to the dev-domain that the
// Expo start script already injects as EXPO_PUBLIC_DOMAIN.
const explicitBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const domainBase = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
const API_BASE = `${explicitBase || domainBase}/api`;

export interface CatalogVariant {
  id: string;
  uuid?: string;
  condition?: string;
  printing?: string;
  language?: string;
  price?: number | null;
  priceChange24hr?: number | null;
  priceChange7d?: number | null;
  priceChange30d?: number | null;
  lastUpdated?: number;
  markets?: Array<{ region: string; currency: string; price?: number | null; updated_at?: number }>;
}

export interface CatalogCard {
  id: string;
  uuid?: string;
  name: string;
  game: string;
  set?: string;
  set_name?: string;
  number?: string;
  rarity?: string;
  image_url?: string;
  /** TCGPlayer product ID — used to construct a card image URL when image_url is absent */
  tcgplayerId?: string | null;
  variants: CatalogVariant[];
}

interface CatalogResponse {
  data: CatalogCard[];
  meta?: { total?: number; limit?: number; offset?: number; hasMore?: boolean };
  source?: string;
  cached?: boolean;
}

/** Map a JustTCG rarity string to the app's CardRarity union. */
function mapRarity(rarity: string | undefined): CardRarity {
  if (!rarity) return 'rare';
  const r = rarity.toLowerCase();
  if (r.includes('hyper')) return 'hyper_rare';
  if (r.includes('special illustration') || r === 'sir') return 'special_illustration';
  if (r.includes('secret')) return 'secret_rare';
  if (r.includes('ultra') || r.includes('vstar') || r.includes('v star')) return 'ultra_rare';
  if (r.includes('holo')) return 'holo_rare';
  if (r.includes('uncommon')) return 'uncommon';
  if (r.includes('common')) return 'common';
  return 'rare';
}

export async function searchCatalog(query: string, signal?: AbortSignal): Promise<CatalogResponse> {
  if (!API_BASE || API_BASE === '/api') throw new Error('The catalog API is not configured for this build.');
  const params = new URLSearchParams({ q: query, limit: '20' });
  const response = await fetch(`${API_BASE}/catalog/cards?${params.toString()}`, { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Catalog request failed (${response.status})`);
  return body as CatalogResponse;
}

export function catalogCardToAppCard(card: CatalogCard): Card {
  // Prefer Near Mint, fall back to first variant
  const variant = card.variants.find(item => item.condition === 'Near Mint') ?? card.variants[0];
  const price = variant?.price ?? 0;
  const updatedAt = variant?.lastUpdated ? new Date(variant.lastUpdated * 1000).toISOString() : new Date().toISOString();
  const game = card.game.toLowerCase();
  const tcg = game.includes('magic') ? 'magic'
    : game.includes('one piece') ? 'onepiece'
    : game.includes('yugioh') || game.includes('yu-gi') ? 'yugioh'
    : game.includes('lorcana') ? 'lorcana'
    : game.includes('dragon') ? 'dragonball'
    : 'pokemon';

  // Image URL resolution priority:
  //  1. image_url returned by the API (may already be pokemontcg.io CDN for
  //     Pokémon cards enriched server-side)
  //  2. TCGPlayer CDN via the product ID
  //  3. pokemontcg.io CDN derived from set + number (Pokémon only) — catches
  //     cases where the server enrichment was skipped (e.g. cache hit from
  //     before the enrichment was added) or where tcgplayerId is absent
  const pokemonCdnFallback = tcg === 'pokemon' && card.set && card.number
    ? `https://images.pokemontcg.io/${card.set.trim().toLowerCase()}/${card.number.trim()}.png`
    : undefined;
  const imageUrl = card.image_url
    ?? (card.tcgplayerId ? `https://product-images.tcgplayer.com/fit-in/437x437/${card.tcgplayerId}.jpg` : undefined)
    ?? pokemonCdnFallback;

  return {
    id: card.id,
    name: card.name,
    setId: card.set ?? card.set_name ?? 'unknown',
    setName: card.set_name ?? card.set ?? 'Unknown set',
    tcg,
    number: card.number ?? '',
    rarity: mapRarity(card.rarity),
    year: new Date(updatedAt).getFullYear(),
    imageUrl,
    gradientStart: '#202020',
    gradientEnd: '#090909',
    price: {
      raw: price,
      currency: 'AUD',
      updatedAt,
      change24h: variant?.priceChange24hr ?? undefined,
      change7d: variant?.priceChange7d ?? undefined,
      change30d: variant?.priceChange30d ?? undefined,
    },
  };
}
