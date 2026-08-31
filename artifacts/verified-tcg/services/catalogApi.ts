import type { Card, CardRarity } from '@/types';
import { ApiClientError, apiJson, apiRequest } from './apiClient';
import { getAccessToken } from './auth';

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
  /** Present on market feeds when the server has a truthful source currency. */
  currency?: string;
  market_price?: number | null;
  pricing_source?: string | null;
  variants: CatalogVariant[];
}

export interface CatalogResponse {
  data: CatalogCard[];
  meta?: { total?: number; limit?: number; offset?: number; hasMore?: boolean };
  source?: string;
  catalogue_source?: string;
  pricing_source?: string;
  cached?: boolean;
}

export const MIN_CATALOG_SEARCH_LENGTH = 2;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 100;

interface CachedSearch {
  response: CatalogResponse;
  expiresAt: number;
}

const searchCache = new Map<string, CachedSearch>();
const searchFlights = new Map<string, Promise<CatalogResponse>>();

export function normalizeCatalogQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Tracks the latest view-owned search without cancelling shared network work. */
export class CatalogSearchRequestGate {
  private currentRequest = 0;

  start(): number {
    this.currentRequest += 1;
    return this.currentRequest;
  }

  isCurrent(request: number): boolean {
    return request === this.currentRequest;
  }
}

/**
 * Build a TCGPlayer CDN image URL for a given product ID and bounding-box size.
 * Use size=1000 for the detail/full-screen view and size=437 for thumbnails so
 * list screens don't fetch unnecessarily large images.
 */
export function buildTcgPlayerUrl(tcgplayerId: string, size: number = 1000): string {
  return `https://product-images.tcgplayer.com/fit-in/${size}x${size}/${tcgplayerId}.jpg`;
}

/**
 * Rewrite an existing TCGPlayer CDN URL to a different fit-in size.
 * Non-TCGPlayer URLs (pokemontcg.io, etc.) are returned unchanged — only the
 * TCGPlayer fit-in path segment is patched.
 * Returns undefined when the input is undefined.
 */
export function resizeTcgPlayerUrl(url: string | undefined, size: number): string | undefined {
  if (!url) return undefined;
  return url.replace(
    /product-images\.tcgplayer\.com\/fit-in\/\d+x\d+\//,
    `product-images.tcgplayer.com/fit-in/${size}x${size}/`,
  );
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

/**
 * Fetch a single card by its JustTCG ID (e.g. "pokemon-arceus-charizard-holo-rare").
 * Returns null only when the server confirms the card is not found. Transport,
 * authentication and provider failures remain errors so UI never presents them
 * as an honest missing card.
 */
export async function fetchCatalogCard(id: string, signal?: AbortSignal): Promise<CatalogCard | null> {
  try {
    const body = await apiJson<{ data?: CatalogCard | null }>(
      `/api/catalog/cards/${encodeURIComponent(id)}`,
      { signal },
    );
    return body.data ?? null;
  } catch (error) {
    if (error instanceof ApiClientError && error.kind === 'not_found') return null;
    throw error;
  }
}

/** Record one explicit card-detail view; failures never block the card screen. */
export async function recordCatalogCardLookup(id: string): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) return;
  await apiRequest(`/api/catalog/cards/${encodeURIComponent(id)}/lookup`, {
    method: 'POST',
    accessToken,
  });
}

export async function searchCatalog(query: string, signal?: AbortSignal, page: number = 1): Promise<CatalogResponse> {
  const normalizedQuery = normalizeCatalogQuery(query);
  if (normalizedQuery.length < MIN_CATALOG_SEARCH_LENGTH) {
    return { data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false }, cached: true };
  }
  if (signal?.aborted) throw new DOMException('Search was cancelled', 'AbortError');
  const limit = 20;
  const offset = (page - 1) * limit;
  const cacheKey = `${normalizedQuery}:${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const inFlight = searchFlights.get(cacheKey);
  if (inFlight) return inFlight;

  // The shared request deliberately does not receive a view-specific abort
  // signal. Cancelling one input change must not cancel a matching request
  // needed by another consumer; callers still ignore obsolete results.
  const flight = (async () => {
    const params = new URLSearchParams({ q: normalizedQuery, limit: String(limit), offset: String(offset) });
    const result = await apiJson<CatalogResponse>(`/api/catalog/cards?${params.toString()}`);
    searchCache.set(cacheKey, { response: result, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    if (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
      const oldest = searchCache.keys().next().value;
      if (oldest) searchCache.delete(oldest);
    }
    return result;
  })().finally(() => searchFlights.delete(cacheKey));
  searchFlights.set(cacheKey, flight);
  return flight;
}

export function catalogCardToAppCard(card: CatalogCard): Card {
  // Prefer Near Mint, fall back to first variant
  const variant = card.variants.find(item => item.condition === 'Near Mint') ?? card.variants[0];
  const sourceIsVerified = card.pricing_source?.trim().toLowerCase() === 'pricecharting';
  const variantPrice =
    typeof variant?.price === 'number' && Number.isFinite(variant.price) && variant.price > 0
      ? variant.price
      : null;
  const marketPrice =
    typeof card.market_price === 'number' && Number.isFinite(card.market_price) && card.market_price > 0
      ? card.market_price
      : null;
  const hasVerifiedRawPrice =
    sourceIsVerified && (variantPrice !== null || marketPrice !== null);
  // market_price is populated from the same persisted raw PriceCharting quote
  // as the enriched variant. Accept it when a feed omits the variant price.
  const price = hasVerifiedRawPrice ? (variantPrice ?? marketPrice)! : 0;
  // A missing source timestamp is meaningful: do not present the mapping time
  // as if it were a verified quote timestamp.
  const updatedAt = variant?.lastUpdated ? new Date(variant.lastUpdated * 1000).toISOString() : null;
  const currency = variant?.markets?.[0]?.currency ?? card.currency ?? 'AUD';
  const game = card.game.toLowerCase();
  const tcg = game.includes('magic') ? 'magic'
    : game.includes('one piece') ? 'onepiece'
    : game.includes('yugioh') || game.includes('yu-gi') ? 'yugioh'
    : game.includes('lorcana') ? 'lorcana'
    : game.includes('dragon') ? 'dragonball'
    : 'pokemon';

  // Image URL resolution priority:
  //  1. image_url returned by the API — server sets this to TCGPlayer CDN when
  //     tcgplayerId is present (reliable), or pokemontcg.io as a last resort.
  //  2. TCGPlayer CDN via tcgplayerId — catches cards that arrived via the
  //     catalogJson navigation param (bypassing server enrichment).
  //  3. pokemontcg.io CDN derived from set + number — last resort only; JustTCG
  //     set codes don't match pokemontcg.io's scheme so these often 404.
  // JustTCG returns numbers like "125/197" — CDN only needs the card number ("125")
  const cardNum = card.number ? card.number.trim().split('/')[0].trim() : '';
  const pokemonCdnFallback = tcg === 'pokemon' && card.set && cardNum
    ? `https://images.pokemontcg.io/${card.set.trim().toLowerCase()}/${cardNum}.png`
    : undefined;
  const imageUrl = card.image_url
    ?? (card.tcgplayerId ? buildTcgPlayerUrl(card.tcgplayerId) : undefined)
    ?? pokemonCdnFallback;

  return {
    id: card.id,
    name: card.name,
    setId: card.set ?? card.set_name ?? 'unknown',
    setName: card.set_name ?? card.set ?? 'Unknown set',
    tcg,
    number: card.number ?? '',
    rarity: mapRarity(card.rarity),
    year: updatedAt ? new Date(updatedAt).getFullYear() : 0,
    imageUrl,
    gradientStart: '#202020',
    gradientEnd: '#090909',
    price: {
      raw: price,
      available: hasVerifiedRawPrice,
      currency,
      updatedAt,
      change24h: variant?.priceChange24hr ?? undefined,
      change7d: variant?.priceChange7d ?? undefined,
      change30d: variant?.priceChange30d ?? undefined,
    },
  };
}
