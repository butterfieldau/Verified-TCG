import type { Card } from '@/types';

const API_BASE = `${(process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')}/api`;

export interface CatalogVariant {
  id: string;
  uuid?: string;
  condition?: string;
  printing?: string;
  language?: string;
  price?: number | null;
  priceChange24hr?: number | null;
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
  variants: CatalogVariant[];
}

interface CatalogResponse {
  data: CatalogCard[];
  meta?: { total?: number; limit?: number; offset?: number; hasMore?: boolean };
  source?: string;
  cached?: boolean;
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
  const variant = card.variants.find(item => item.condition === 'Near Mint') ?? card.variants[0];
  const price = variant?.price ?? 0;
  const updatedAt = variant?.lastUpdated ? new Date(variant.lastUpdated * 1000).toISOString() : new Date().toISOString();
  const game = card.game.toLowerCase();
  const tcg = game.includes('magic') ? 'magic' : game.includes('one piece') ? 'onepiece' : game.includes('yugioh') || game.includes('yu-gi') ? 'yugioh' : game.includes('lorcana') ? 'lorcana' : game.includes('dragon') ? 'dragonball' : 'pokemon';
  return {
    id: card.id,
    name: card.name,
    setId: card.set ?? card.set_name ?? 'unknown',
    setName: card.set_name ?? card.set ?? 'Unknown set',
    tcg,
    number: card.number ?? '',
    rarity: 'rare',
    year: new Date(updatedAt).getFullYear(),
    imageUrl: card.image_url,
    gradientStart: '#202020',
    gradientEnd: '#090909',
    price: { raw: price, currency: 'AUD', updatedAt, change24h: variant?.priceChange24hr ?? undefined },
  };
}
