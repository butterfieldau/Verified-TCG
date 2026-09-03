import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql, type SQL } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { isValidGradeKey, normalizeGradeKey } from "../pricing/grades.js";
import { convertCents } from "../pricing/fx.js";
import {
  JUSTTCG_PRICING_PROVIDER_KEY,
  JUSTTCG_PRICING_PROVIDER_LABEL,
  extractJustTcgRawQuote,
} from "../pricing/justtcg.js";
import {
  justTcg,
  type CatalogueRead,
} from "../lib/catalogueProvider.js";
import {
  canonicalCatalogueReadsEnabled,
  readCanonicalPublicCard,
  readCanonicalPublicCards,
  recordCatalogueReadMetric,
  deduplicatePublicCards,
} from "../catalogue/internal/catalogueReadService.js";
import {
  getTrendingLookups,
  recordCardLookup,
} from "../catalogue/internal/cardLookupAggregation.js";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const router = Router();

/**
 * For Pokémon cards that JustTCG doesn't supply an image URL for, we can
 * derive one from the pokemontcg.io CDN — the URL structure is predictable:
 *   https://images.pokemontcg.io/{setId}/{number}.png
 *
 * JustTCG set codes for Pokémon follow the official set-code convention that
 * pokemontcg.io also uses (e.g. "sv3", "swsh1", "base1"), so the mapping is
 * direct.  If the set/number combo doesn't exist on that CDN the image
 * request will simply 404 and the app's letter-initial fallback fires.
 */
function pokemonImageUrl(
  set: string | undefined,
  number: string | undefined,
): string | undefined {
  if (!set || !number) return undefined;
  // Normalise: lower-case, strip whitespace
  const setId = set.trim().toLowerCase();
  // JustTCG returns numbers like "125/197" — the CDN only needs the card number ("125")
  const num = number.trim().split("/")[0].trim();
  if (!setId || !num) return undefined;
  return `https://images.pokemontcg.io/${setId}/${num}.png`;
}

function isPokemonGame(game: string): boolean {
  return (
    game.toLowerCase().includes("pokemon") ||
    game.toLowerCase().includes("pokémon")
  );
}

/**
 * Build a TCGPlayer CDN image URL for a given product ID and pixel size.
 * The size parameter controls the fit-in bounding box (e.g. 437 for thumbnails,
 * 1000 for the detail view).  Callers pick the size appropriate for their
 * context so thumbnail lists don't wastefully fetch full-resolution images.
 */
function tcgPlayerUrl(tcgplayerId: string, size: number = 1000): string {
  return `https://product-images.tcgplayer.com/fit-in/${size}x${size}/${tcgplayerId}.jpg`;
}

/** Apply image enrichment to a single card record (same priority as list endpoint). */
function enrichCard(card: Record<string, unknown>): Record<string, unknown> {
  if (card.image_url) return card;
  if (card.tcgplayerId) {
    return { ...card, image_url: tcgPlayerUrl(String(card.tcgplayerId)) };
  }
  if (isPokemonGame(String(card.game ?? ""))) {
    const derived = pokemonImageUrl(
      card.set as string | undefined,
      card.number as string | undefined,
    );
    if (derived) return { ...card, image_url: derived };
  }
  return card;
}

/** Return the Near Mint variant, or the first variant as fallback. */
function getNmVariant(variants: unknown): Record<string, unknown> | null {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const arr = variants as Array<Record<string, unknown>>;
  return arr.find((v) => v.condition === "Near Mint") ?? arr[0]!;
}

type QuoteEnrichableCard = Record<string, unknown> & { id?: unknown; variants?: unknown };

function requestedDisplayCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

type CurrencyConverter = (amountCents: number, from: string, to: string) => Promise<number | null>;

/**
 * Convert catalogue response values for display without changing their stored
 * provider values. List, search and detail screens use this same response
 * shape, so a selected display currency cannot disagree between surfaces.
 * When FX is unavailable the original provider currency/value is preserved.
 */
export async function convertCatalogueCardsForDisplay<T extends Record<string, unknown>>(
  cards: T[],
  displayCurrency: string | undefined,
  converter: CurrencyConverter = convertCents,
): Promise<T[]> {
  if (!displayCurrency) return cards;

  const convertAmount = async (value: unknown, from: string): Promise<number | null> => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const converted = await converter(Math.round(value * 100), from, displayCurrency);
    return converted == null ? null : converted / 100;
  };

  return Promise.all(cards.map(async card => {
    const rawQuote = card.raw_quote && typeof card.raw_quote === "object"
      ? card.raw_quote as Record<string, unknown>
      : null;
    const sourceCurrency = typeof rawQuote?.currency === "string"
      ? rawQuote.currency.toUpperCase()
      : typeof card.currency === "string"
        ? card.currency.toUpperCase()
        : null;
    if (!sourceCurrency) return card;

    const primaryValues = await Promise.all([
      convertAmount(card.market_price, sourceCurrency),
      convertAmount(card.previous_price, sourceCurrency),
      convertAmount(card.absolute_change, sourceCurrency),
      rawQuote ? convertAmount(rawQuote.price, sourceCurrency) : Promise.resolve(null),
    ]);
    const [marketPrice, previousPrice, absoluteChange, rawQuotePrice] = primaryValues;
    const didConvert = sourceCurrency === displayCurrency || primaryValues.some(value => value !== null);
    if (!didConvert) return card;

    const variants = Array.isArray(card.variants)
      ? await Promise.all(card.variants.map(async item => {
          if (!item || typeof item !== "object") return item;
          const variant = item as Record<string, unknown>;
          const markets = Array.isArray(variant.markets) ? variant.markets : [];
          const variantCurrency = typeof (markets[0] as Record<string, unknown> | undefined)?.currency === "string"
            ? String((markets[0] as Record<string, unknown>).currency).toUpperCase()
            : sourceCurrency;
          const price = await convertAmount(variant.price, variantCurrency);
          const convertedMarkets = await Promise.all(markets.map(async market => {
            if (!market || typeof market !== "object") return market;
            const record = market as Record<string, unknown>;
            const currency = typeof record.currency === "string" ? record.currency.toUpperCase() : variantCurrency;
            const convertedPrice = await convertAmount(record.price, currency);
            return convertedPrice === null && currency !== displayCurrency
              ? record
              : { ...record, ...(convertedPrice !== null ? { price: convertedPrice } : {}), currency: displayCurrency };
          }));
          return price === null && variantCurrency !== displayCurrency
            ? variant
            : { ...variant, ...(price !== null ? { price } : {}), markets: convertedMarkets };
        }))
      : card.variants;

    return {
      ...card,
      currency: displayCurrency,
      ...(marketPrice !== null ? { market_price: marketPrice } : {}),
      ...(previousPrice !== null ? { previous_price: previousPrice } : {}),
      ...(absoluteChange !== null ? { absolute_change: absoluteChange } : {}),
      ...(rawQuote ? {
        raw_quote: {
          ...rawQuote,
          ...(rawQuotePrice !== null ? {
            price: rawQuotePrice,
            priceCents: Math.round(rawQuotePrice * 100),
          } : {}),
          currency: displayCurrency,
        },
      } : {}),
      ...(variants !== undefined ? { variants } : {}),
    } as T;
  }));
}

/**
 * Attach only persisted, provider-backed raw quotes to catalogue cards.
 * Catalogue identity and pricing have separate provenance; a catalogue result
 * without a current quote remains explicitly unpriced.
 */
async function enrichCardsWithCurrentRawQuotes<T extends QuoteEnrichableCard>(
  cards: T[],
): Promise<T[]> {
  const cardIds = [...new Set(cards.map(card => typeof card.id === "string" ? card.id : "").filter(Boolean))];
  if (cardIds.length === 0) return cards;
  const quotes = await db.execute<{
    card_id: string;
    provider_key: string;
    price_cents: number;
    currency: string;
    fetched_at: Date;
    provider_product_id: string | null;
  }>(sql`
    SELECT card_id, price_cents, currency, fetched_at, provider_product_id
    FROM current_quotes
    WHERE provider_key IN ('justtcg', 'pricecharting')
      AND grade_key = 'raw'
      AND price_cents > 0
      AND card_id IN (${sql.join(cardIds.map(id => sql`${id}`), sql`, `)})
  `);
  return enrichCardsWithLiveRawQuotes(enrichCardsWithQuoteRows(cards, quotes.rows));
}

export function enrichCardsWithQuoteRows<T extends QuoteEnrichableCard>(
  cards: T[],
  rows: Array<{
    card_id: string;
    provider_key?: string;
    price_cents: number;
    currency: string;
    fetched_at: Date;
    provider_product_id?: string | null;
  }>,
): T[] {
  // JustTCG is the primary source for raw catalogue values. PriceCharting is
  // retained as a fallback only for legacy cached raw quotes. Do not let the
  // database's unspecified row order decide which source reaches the client.
  const byCardId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = byCardId.get(row.card_id);
    const priority = row.provider_key === JUSTTCG_PRICING_PROVIDER_KEY ? 2 : 1;
    const existingPriority = existing?.provider_key === JUSTTCG_PRICING_PROVIDER_KEY ? 2 : 1;
    if (!existing || priority > existingPriority || (
      priority === existingPriority
      && new Date(row.fetched_at).getTime() > new Date(existing.fetched_at).getTime()
    )) {
      byCardId.set(row.card_id, row);
    }
  }
  return cards.map(card => {
    const quote = typeof card.id === "string" ? byCardId.get(card.id) : undefined;
    if (!quote) return card;
    const existing = Array.isArray(card.variants)
      ? card.variants as Array<Record<string, unknown>>
      : [];
    const pricedVariant = {
      condition: "Near Mint",
      price: quote.price_cents / 100,
      lastUpdated: Math.floor(new Date(quote.fetched_at).getTime() / 1000),
      markets: [{ region: "source", currency: quote.currency, price: quote.price_cents / 100 }],
    };
    return {
      ...card,
      currency: quote.currency,
      market_price: quote.price_cents / 100,
      pricing_source: quote.provider_key === JUSTTCG_PRICING_PROVIDER_KEY
        ? JUSTTCG_PRICING_PROVIDER_LABEL
        : "PriceCharting",
      updated_at: new Date(quote.fetched_at).toISOString(),
      raw_quote: {
        provider: quote.provider_key === JUSTTCG_PRICING_PROVIDER_KEY
          ? JUSTTCG_PRICING_PROVIDER_KEY
          : "pricecharting",
        productId: quote.provider_product_id ?? null,
        priceCents: quote.price_cents,
        price: quote.price_cents / 100,
        currency: quote.currency,
        updatedAt: new Date(quote.fetched_at).toISOString(),
        isStale: Date.now() - new Date(quote.fetched_at).getTime() > 12 * 60 * 60 * 1000,
      },
      variants: [
        pricedVariant,
        ...existing.filter(variant => variant.condition !== "Near Mint"),
      ],
    } as T;
  });
}

/**
 * A JustTCG search result already contains a provider-observed Near Mint raw
 * quote. Surface it immediately instead of hiding it until a separate
 * PriceCharting mapping happens to be created. Persisted quotes above still
 * take priority, so this is only the live-provider fallback.
 */
export function enrichCardsWithLiveRawQuotes<T extends QuoteEnrichableCard>(cards: T[]): T[] {
  return cards.map(card => {
    if (card.raw_quote) return card;
    const quote = extractJustTcgRawQuote(card);
    if (!quote) return card;
    return {
      ...card,
      currency: quote.currency,
      market_price: quote.priceCents / 100,
      pricing_source: JUSTTCG_PRICING_PROVIDER_LABEL,
      updated_at: quote.fetchedAt.toISOString(),
      raw_quote: {
        provider: JUSTTCG_PRICING_PROVIDER_KEY,
        productId: quote.providerProductId,
        priceCents: quote.priceCents,
        price: quote.priceCents / 100,
        currency: quote.currency,
        updatedAt: quote.fetchedAt.toISOString(),
        isStale: false,
      },
    } as T;
  });
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function cacheMetadata(
  result: Pick<
    CatalogueRead,
    "cached" | "cacheStatus" | "outboundCall" | "revalidationScheduled"
  >,
) {
  return {
    cached: result.cached,
    cache_status: result.cacheStatus,
    outbound_call: result.outboundCall,
    ...(result.revalidationScheduled ? { revalidation_scheduled: true } : {}),
  };
}

type CataloguePagination = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export function normalizeCataloguePagination(
  body: unknown,
  limit: number,
  offset: number,
  delivered: number,
): CataloguePagination {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = record.meta && typeof record.meta === "object"
    ? record.meta as Record<string, unknown>
    : {};
  const numeric = (...values: unknown[]) => {
    const value = values.find(candidate => Number.isFinite(Number(candidate)));
    return value == null ? undefined : Math.max(0, Math.floor(Number(value)));
  };
  const total = numeric(nested.total, record.total, nested.count, record.count);
  const explicitHasMore = nested.hasMore ?? nested.has_more ?? record.hasMore ?? record.has_more;
  const hasMore = typeof explicitHasMore === "boolean"
    ? explicitHasMore
    : total != null
      ? offset + delivered < total
      : delivered === limit;
  return {
    total: total ?? offset + delivered + (hasMore ? 1 : 0),
    limit,
    offset,
    hasMore,
  };
}

function pricingSourceFor(cards: Array<Record<string, unknown>>): string | null {
  if (cards.some(card => card.pricing_source === JUSTTCG_PRICING_PROVIDER_LABEL)) {
    return JUSTTCG_PRICING_PROVIDER_LABEL;
  }
  return cards.some(card => card.pricing_source === "PriceCharting") ? "PriceCharting" : null;
}

router.get("/catalog/games", async (_req, res) => {
  try {
    const result = await justTcg("/games");
    if (result.status >= 400)
      return res.status(result.status).json(result.body);
    return res.json({
      ...((result.body as object) ?? {}),
      source: "JustTCG",
      ...cacheMetadata(result),
    });
  } catch {
    return res.status(503).json({ error: "Catalog provider unavailable" });
  }
});

router.get("/catalog/cards", async (req, res) => {
  try {
    const displayCurrency = requestedDisplayCurrency(req.query.displayCurrency);
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const game =
      typeof req.query.game === "string" ? req.query.game.trim() : "";
    const limit = positiveInt(req.query.limit, 20, 100);
    const offset = positiveInt(req.query.offset, 0, 1000000);
    if (!query && !game)
      return res.status(400).json({ error: "Provide q or game" });

    if (canonicalCatalogueReadsEnabled() && query) {
      const canonicalRead = await readCanonicalPublicCards({
        query,
        game: game || undefined,
        limit,
        offset,
      });
      const canonical = canonicalRead.value;
      if (
        canonicalRead.outcome === "canonical_hit"
        && (canonicalRead.pagination?.total ?? 0) > 0
      ) {
        recordCatalogueReadMetric(
          "search",
          canonicalRead.outcome,
          canonicalRead.durationMs,
          "canonical",
        );
        const data = await convertCatalogueCardsForDisplay(
          await enrichCardsWithCurrentRawQuotes(canonical), displayCurrency,
        );
        return res.json({
          data,
          meta: canonicalRead.pagination,
          source: "VerifiedTCG",
          catalogue_source: "VerifiedTCG",
          pricing_source: pricingSourceFor(data),
          canonical: true,
          cached: false,
        });
      }
      if (canonical.length && canonicalRead.outcome === "canonical_hit") {
        const fallbackResult = await justTcg(
          `/cards?${new URLSearchParams({
            ...(query ? { q: query } : {}),
            ...(game ? { game } : {}),
            limit: String(limit),
            offset: String(offset),
            include_price_history: "false",
          }).toString()}`,
        );
        const fallbackCards =
          fallbackResult.status < 400 &&
          fallbackResult.body &&
          typeof fallbackResult.body === "object" &&
          Array.isArray(
            (fallbackResult.body as { data?: unknown }).data,
          )
            ? (
                (fallbackResult.body as {
                  data: Array<Record<string, unknown>>;
                }).data
              ).map(enrichCard)
            : [];
        if (fallbackResult.status >= 400) {
          recordCatalogueReadMetric(
            "search",
            canonicalRead.outcome,
            canonicalRead.durationMs,
            "canonical",
          );
          const data = await convertCatalogueCardsForDisplay(
            await enrichCardsWithCurrentRawQuotes(canonical), displayCurrency,
          );
          return res.json({
            data,
            meta: canonicalRead.pagination,
            source: "VerifiedTCG",
            catalogue_source: "VerifiedTCG",
            pricing_source: pricingSourceFor(data),
            canonical: true,
            cached: fallbackResult.cached ?? false,
          });
        }
        if (!fallbackCards.length) {
          recordCatalogueReadMetric(
            "search",
            canonicalRead.outcome,
            canonicalRead.durationMs,
            "canonical",
          );
          const data = await convertCatalogueCardsForDisplay(
            await enrichCardsWithCurrentRawQuotes(canonical), displayCurrency,
          );
          return res.json({
            data,
            meta: canonicalRead.pagination,
            source: "VerifiedTCG",
            catalogue_source: "VerifiedTCG",
            pricing_source: pricingSourceFor(data),
            canonical: true,
            cached: fallbackResult.cached ?? false,
          });
        }
        const data = await convertCatalogueCardsForDisplay(
          await enrichCardsWithCurrentRawQuotes(
            deduplicatePublicCards(canonical, fallbackCards).slice(0, limit),
          ),
          displayCurrency,
        );
        const fallbackPagination = normalizeCataloguePagination(
          fallbackResult.body,
          limit,
          offset,
          fallbackCards.length,
        );
        const canonicalPagination = canonicalRead.pagination ?? {
          total: canonical.length,
          limit,
          offset,
          hasMore: canonical.length === limit,
        };
        const canonicalCardsDelivered = canonical.length;
        const delivery =
          canonicalCardsDelivered === 0
            ? "justtcg"
            : canonicalCardsDelivered === data.length
              ? "canonical"
              : "mixed";
        recordCatalogueReadMetric(
          "search",
          canonicalRead.outcome,
          canonicalRead.durationMs,
          delivery,
        );
        return res.json({
          data,
          meta: {
            total: Math.max(canonicalPagination.total, fallbackPagination.total),
            limit,
            offset,
            hasMore: canonicalPagination.hasMore || fallbackPagination.hasMore,
          },
          source:
            delivery === "canonical"
              ? "VerifiedTCG"
              : delivery === "mixed"
                ? "VerifiedTCG+JustTCG"
                : "JustTCG",
          catalogue_source:
            delivery === "canonical"
              ? "VerifiedTCG"
              : delivery === "mixed"
                ? "VerifiedTCG + JustTCG"
                : "JustTCG",
          pricing_source: pricingSourceFor(data),
          canonical: delivery !== "justtcg",
          cached: fallbackResult.cached ?? false,
        });
      }
      const fallbackResult = await justTcg(
        `/cards?${new URLSearchParams({
          ...(query ? { q: query } : {}),
          ...(game ? { game } : {}),
          limit: String(limit),
          offset: String(offset),
          include_price_history: "false",
        }).toString()}`,
      );
      if (fallbackResult.status < 400) {
        recordCatalogueReadMetric(
          "search",
          canonicalRead.outcome,
          canonicalRead.durationMs,
          "justtcg",
        );
        const body = {
          ...((fallbackResult.body as {
            data?: Array<Record<string, unknown>>;
          } | null) ?? {}),
        };
        if (Array.isArray(body.data))
          body.data = await convertCatalogueCardsForDisplay(
            await enrichCardsWithCurrentRawQuotes(body.data.map(enrichCard)), displayCurrency,
          );
        const data = Array.isArray(body.data) ? body.data : [];
        return res.json({
          ...body,
          meta: normalizeCataloguePagination(fallbackResult.body, limit, offset, data.length),
          source: "JustTCG",
          catalogue_source: "JustTCG",
          pricing_source: pricingSourceFor(data),
          ...cacheMetadata(fallbackResult),
        });
      }
      recordCatalogueReadMetric(
        "search",
        canonicalRead.outcome,
        canonicalRead.durationMs,
        "failed",
      );
      return res.status(fallbackResult.status).json(fallbackResult.body);
    }

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (query) params.set("q", query);
    if (game) params.set("game", game);
    params.set("include_price_history", "false");
    const result = await justTcg(`/cards?${params.toString()}`);
    if (result.status >= 400)
      return res.status(result.status).json(result.body);

    // Enrich cards that are missing an image_url.
    // Priority:
    //  1. image_url already provided by JustTCG — keep as-is.
    //  2. TCGPlayer CDN via tcgplayerId — stable numeric product ID, always
    //     resolves to the correct card image regardless of set-code mapping.
    //  3. pokemontcg.io CDN derived from set + number — last resort only, since
    //     JustTCG set codes (e.g. "me-ascended-heroes-pokemon") do NOT match
    //     the pokemontcg.io set-code scheme and these URLs frequently 404.
    const body = {
      ...((result.body as { data?: Array<Record<string, unknown>> } | null) ??
        {}),
    };
    if (body && Array.isArray(body.data)) {
      body.data = await convertCatalogueCardsForDisplay(
        await enrichCardsWithCurrentRawQuotes(body.data.map(enrichCard)), displayCurrency,
      );
    }
    const data = Array.isArray(body.data) ? body.data : [];

    return res.json({
      ...body,
      meta: normalizeCataloguePagination(result.body, limit, offset, data.length),
      source: "JustTCG",
      catalogue_source: "JustTCG",
      pricing_source: pricingSourceFor(data),
      ...cacheMetadata(result),
    });
  } catch {
    return res.status(503).json({ error: "Catalog provider unavailable" });
  }
});

/**
 * Walk a globally-sorted list of scored cards and select up to `totalLimit`
 * entries, capping any single game at `maxPerGame`.  The global sort order is
 * preserved: the highest-scored card always wins its slot, regardless of game.
 *
 * Exported for unit testing.
 */
export function capByGameFromSorted<T extends { game: string }>(
  sorted: T[],
  maxPerGame: number,
  totalLimit: number,
): T[] {
  const gameCount = new Map<string, number>();
  const result: T[] = [];
  for (const item of sorted) {
    if (result.length >= totalLimit) break;
    const game = item.game;
    const count = gameCount.get(game) ?? 0;
    if (count >= maxPerGame) continue;
    gameCount.set(game, count + 1);
    result.push(item);
  }
  return result;
}

/**
 * Extract the `data` array from a JustTCG response, returning an empty array
 * on non-2xx status so partial failures don't abort the whole request.
 * Tracks whether at least one query succeeded to allow 503 when all fail.
 *
 * Exported for unit testing.
 */
export function extractData(
  result: { status: number; body: unknown },
  anyOk: { value: boolean },
): Array<Record<string, unknown>> {
  if (result.status >= 400) return [];
  anyOk.value = true;
  return (result.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
}

/**
 * Merge multiple raw card arrays into one deduplicated pool (by card ID).
 * The first occurrence of each ID wins; subsequent duplicates are dropped.
 *
 * Exported for unit testing.
 */
export function mergePool(
  ...arrays: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const pool: Array<Record<string, unknown>> = [];
  for (const arr of arrays) {
    for (const card of arr) {
      const id = String(card.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      pool.push(card);
    }
  }
  return pool;
}

type PersistedMarketRow = {
  card_id: string;
  current_cents: number;
  previous_cents: number;
  currency: string;
  grade_key: string;
  provider_key: string;
  current_at: Date;
  previous_at: Date;
};

export function calculateSnapshotMovement(
  previousCents: number,
  currentCents: number,
): { absoluteCents: number; percent: number; trend: "up" | "down" | "neutral" } | null {
  if (
    !Number.isFinite(previousCents) ||
    !Number.isFinite(currentCents) ||
    previousCents <= 0 ||
    currentCents <= 0
  ) return null;
  const absoluteCents = currentCents - previousCents;
  // Reject implausible multi-fold changes from a pair of observations. This
  // protects the ranking from provider parsing/currency errors while allowing
  // a deliberately generous 500% genuine market correction.
  if (Math.abs(absoluteCents / previousCents) > 5) return null;
  return {
    absoluteCents,
    percent: Number(((absoluteCents / previousCents) * 100).toFixed(2)),
    trend: absoluteCents > 0 ? "up" : absoluteCents < 0 ? "down" : "neutral",
  };
}

type MarketMode = "movers" | "gainers" | "losers";

function marketMode(value: unknown): MarketMode {
  return value === "gainers" || value === "losers" ? value : "movers";
}

function preferredGames(value: string | null | undefined): Set<string> | null {
  const games = (value ?? "").split(",").map(normalizeTcgName).filter(Boolean);
  return games.length ? new Set(games) : null;
}

/** Normalizes persisted onboarding labels and canonical catalogue game names. */
export function normalizeTcgName(value: string): string {
  const normalized = value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "pokemon" || normalized === "pokemontcg") return "pokemon";
  if (normalized === "onepiece" || normalized === "onepiecetcg") return "onepiece";
  if (normalized === "magic" || normalized === "mtg" || normalized === "magicthegathering") return "magic";
  return normalized;
}

async function optionalPreferredGames(authorization: string | undefined): Promise<Set<string> | null> {
  if (!authorization?.startsWith("Bearer ") || !process.env.SESSION_SECRET) return null;
  try {
    const payload = jwt.verify(authorization.slice(7), process.env.SESSION_SECRET) as { sub?: string };
    if (!payload.sub) return null;
    const [user] = await db.select({ preferredTcgs: usersTable.preferredTcgs })
      .from(usersTable).where(eq(usersTable.id, payload.sub)).limit(1);
    return preferredGames(user?.preferredTcgs);
  } catch {
    // These feeds are public; an invalid optional credential is ignored.
    return null;
  }
}

function matchesPreferences(card: Record<string, unknown>, preferences: Set<string> | null): boolean {
  return !preferences || preferences.has(normalizeTcgName(String(card.game ?? "")));
}

/** SQL equivalent of game-name normalization, evaluated before candidate LIMIT. */
function preferenceCandidateFilter(cardId: SQL, preferences: Set<string> | null): SQL {
  if (!preferences?.size) return sql``;
  return sql`AND EXISTS (
    SELECT 1 FROM catalogue_external_ids preference_external
    JOIN catalogue_cards preference_card ON preference_card.id = preference_external.entity_id
    JOIN catalogue_sets preference_set ON preference_set.id = preference_card.set_id
    JOIN catalogue_games preference_game ON preference_game.id = preference_set.game_id
    WHERE preference_external.provider_key = 'justtcg'
      AND preference_external.entity_type = 'card'
      AND preference_external.external_id = ${cardId}
      AND CASE regexp_replace(translate(lower(preference_game.name), 'é', 'e'), '[^a-z0-9]', '', 'g')
        WHEN 'pokemontcg' THEN 'pokemon'
        WHEN 'onepiecetcg' THEN 'onepiece'
        WHEN 'mtg' THEN 'magic'
        WHEN 'magicthegathering' THEN 'magic'
        ELSE regexp_replace(translate(lower(preference_game.name), 'é', 'e'), '[^a-z0-9]', '', 'g')
      END IN (${sql.join([...preferences].map((value) => sql`${value}`), sql`, `)})
  )`;
}

/**
 * Market reads use the same provider priority as every other raw-value surface:
 * JustTCG first, with PriceCharting only when no comparable JustTCG movement
 * exists for that card. A row is eligible only when it has two non-zero raw
 * observations from the same provider/currency and the current observation is
 * still fresh.
 */
export async function persistedMarketCards(
  limit = 8,
  mode: MarketMode = "movers",
  grade = "raw",
  currency?: string,
  preferences: Set<string> | null = null,
) {
  const direction = mode === "gainers"
    ? sql`AND movement_percent > 0`
    : mode === "losers"
      ? sql`AND movement_percent < 0`
      : sql``;
  const currencyFilter = currency ? sql`AND currency = ${currency.toUpperCase()}` : sql``;
  const preferenceFilter = preferenceCandidateFilter(sql`current_snapshot.card_id`, preferences);
  const ordering = mode === "gainers" ? sql`movement_percent DESC`
    : mode === "losers" ? sql`movement_percent ASC` : sql`ABS(movement_percent) DESC`;
  const result = await db.execute<PersistedMarketRow>(sql`
    WITH ranked AS (
      SELECT card_id, provider_key, grade_key, price_cents, currency, captured_at,
        row_number() OVER (
          PARTITION BY card_id, provider_key, grade_key, currency
          ORDER BY captured_at DESC
        ) AS position
      FROM card_price_snapshots
      WHERE provider_key IN ('justtcg', 'pricecharting')
        AND grade_key = ${grade}
        AND capture_status = 'success'
        AND price_cents IS NOT NULL
        AND price_cents > 0
        AND captured_at >= NOW() - INTERVAL '14 days'
        ${currencyFilter}
    ), comparable AS (
      SELECT current_snapshot.card_id, current_snapshot.provider_key, current_snapshot.grade_key,
        current_snapshot.price_cents AS current_cents, previous_snapshot.price_cents AS previous_cents,
        current_snapshot.currency, current_snapshot.captured_at AS current_at,
        previous_snapshot.captured_at AS previous_at,
        ((current_snapshot.price_cents - previous_snapshot.price_cents)::numeric
          / previous_snapshot.price_cents) * 100 AS movement_percent
      FROM ranked current_snapshot
      JOIN ranked previous_snapshot ON previous_snapshot.card_id = current_snapshot.card_id
        AND previous_snapshot.provider_key = current_snapshot.provider_key
        AND previous_snapshot.grade_key = current_snapshot.grade_key
        AND previous_snapshot.currency = current_snapshot.currency
        AND previous_snapshot.position = 2
      WHERE current_snapshot.position = 1
        AND current_snapshot.captured_at >= NOW() - INTERVAL '36 hours'
    ), provider_ranked AS (
      SELECT comparable.*,
        row_number() OVER (
          PARTITION BY card_id
          ORDER BY CASE provider_key WHEN 'justtcg' THEN 2 ELSE 1 END DESC,
            current_at DESC
        ) AS provider_position
      FROM comparable
    )
    SELECT * FROM provider_ranked current_snapshot
    WHERE ABS(movement_percent) <= 500
      AND movement_percent <> 0
      AND provider_position = 1 ${direction} ${preferenceFilter}
    ORDER BY ${ordering}, card_id ASC
    LIMIT ${limit * 5}
  `);

  const shaped = await Promise.all(
    result.rows.map(async (row) => {
      const canonical = await readCanonicalPublicCard(row.card_id);
      if (!canonical.value) return null;
      if (!matchesPreferences(canonical.value, preferences)) return null;
      const movement = calculateSnapshotMovement(
        row.previous_cents,
        row.current_cents,
      );
      if (!movement) return null;
      const currentAt = new Date(row.current_at);
      const previousAt = new Date(row.previous_at);
      return {
        ...canonical.value,
        variants: [{
          condition: "Near Mint",
          price: row.current_cents / 100,
          priceChange7d: movement.percent,
          lastUpdated: Math.floor(currentAt.getTime() / 1000),
          markets: [{ region: "source", currency: row.currency, price: row.current_cents / 100 }],
        }],
        market_price: row.current_cents / 100,
        pricing_source: row.provider_key === JUSTTCG_PRICING_PROVIDER_KEY
          ? "JustTCG"
          : "PriceCharting",
        previous_price: row.previous_cents / 100,
        absolute_change: movement.absoluteCents / 100,
        price_change_7d: movement.percent,
        trend: movement.trend,
        currency: row.currency,
        grade: row.grade_key,
        provider: row.provider_key,
        updated_at: currentAt.toISOString(),
        observed_at: currentAt.toISOString(),
        previous_observed_at: previousAt.toISOString(),
      };
    }),
  );
  return shaped.filter((card): card is NonNullable<typeof card> => card !== null).slice(0, limit);
}

export async function persistedRecentlyAddedCards(limit = 8, preferences: Set<string> | null = null) {
  const result = await db.execute<{
    card_id: string;
    price_cents: number | null;
    currency: string | null;
    fetched_at: Date | null;
    provider_key: string | null;
    created_at: Date;
  }>(sql`
    SELECT e.external_id AS card_id, q.price_cents, q.currency, q.fetched_at,
      q.provider_key, e.created_at
    FROM catalogue_external_ids e
    LEFT JOIN LATERAL (
      SELECT current.price_cents, current.currency, current.fetched_at,
        current.provider_key
      FROM current_quotes current
      WHERE current.card_id = e.external_id
        AND current.provider_key IN ('justtcg', 'pricecharting')
        AND current.grade_key = 'raw'
        AND current.price_cents > 0
      ORDER BY CASE current.provider_key WHEN 'justtcg' THEN 2 ELSE 1 END DESC,
        current.fetched_at DESC
      LIMIT 1
    ) q ON true
    WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
      ${preferenceCandidateFilter(sql`e.external_id`, preferences)}
    -- Provenance timestamps can be equal during a sync batch; external ID
    -- makes both this feed and trending's provenance fallback repeatable.
    ORDER BY e.created_at DESC, e.external_id ASC
    LIMIT ${limit * 5}
  `);
  const shaped = await Promise.all(result.rows.map(async (row) => {
    const canonical = await readCanonicalPublicCard(row.card_id);
    if (!canonical.value) return null;
    if (!matchesPreferences(canonical.value, preferences)) return null;
    const addedAt = new Date(row.created_at);
    const fetchedAt = row.fetched_at ? new Date(row.fetched_at) : null;
    return {
      ...canonical.value,
      variants: [{
        condition: "Near Mint",
        ...(row.price_cents === null ? {} : {
          price: row.price_cents / 100,
          lastUpdated: Math.floor(fetchedAt!.getTime() / 1000),
          markets: [{ region: "source", currency: row.currency!, price: row.price_cents / 100 }],
        }),
      }],
      market_price: row.price_cents === null ? null : row.price_cents / 100,
      pricing_source: row.price_cents === null
        ? null
        : row.provider_key === JUSTTCG_PRICING_PROVIDER_KEY
          ? "JustTCG"
          : "PriceCharting",
      currency: row.currency,
      catalogue_added_at: addedAt.toISOString(),
      updated_at: fetchedAt?.toISOString() ?? null,
    };
  }));
  return shaped.filter((card): card is NonNullable<typeof card> => card !== null).slice(0, limit);
}

/**
 * GET /catalog/market-movers
 * Returns cards ranked by the absolute movement between the two most recent
 * comparable persisted raw snapshots from the preferred available provider.
 * Observations must share
 * a card, currency, provider, and grade, be positive, and be fresh enough to
 * avoid presenting stale data as a current market signal.
 */
router.get("/catalog/market-movers", async (req, res) => {
  try {
    const preferences = await optionalPreferredGames(req.headers.authorization);
    const requestedGrade = typeof req.query.grade === "string" && req.query.grade.trim()
      ? req.query.grade.trim() : "raw";
    const normalizedGrade = normalizeGradeKey(requestedGrade);
    const grade = normalizedGrade && isValidGradeKey(normalizedGrade) ? normalizedGrade : "raw";
    const currency = typeof req.query.currency === "string" ? req.query.currency.trim() : undefined;
    const displayCurrency = requestedDisplayCurrency(req.query.displayCurrency);
    return res.json({
      data: await convertCatalogueCardsForDisplay(
        await persistedMarketCards(8, marketMode(req.query.mode), grade, currency, preferences),
        displayCurrency,
      ),
      source: "VerifiedTCG snapshots",
    });
  } catch {
    return res.status(503).json({ error: "Market data is temporarily unavailable" });
  }
});

/**
 * GET /catalog/trending
 * Ranks real recent collection/wishlist activity. When that persisted signal
 * is too sparse, it deterministically fills from snapshot movement and then
 * catalogue provenance; it never invents views, searches, or sales.
 */
router.get("/catalog/trending", async (req, res) => {
  try {
    const displayCurrency = requestedDisplayCurrency(req.query.displayCurrency);
    const preferences = await optionalPreferredGames(req.headers.authorization);
    const activity = await db.execute<{ card_id: string }>(sql`
      SELECT recent_activity.entity_id AS card_id
      FROM activity_log recent_activity
      WHERE recent_activity.event_type IN ('card_added', 'wishlist_added')
        AND recent_activity.entity_id IS NOT NULL
        AND recent_activity.created_at >= NOW() - INTERVAL '7 days'
        ${preferenceCandidateFilter(sql`recent_activity.entity_id`, preferences)}
      GROUP BY recent_activity.entity_id
      ORDER BY COUNT(*) DESC, MAX(recent_activity.created_at) DESC, recent_activity.entity_id ASC
      LIMIT 40
    `);
    const activityCards = await enrichCardsWithCurrentRawQuotes((await Promise.all(activity.rows.map(async ({ card_id }) => {
      const canonical = await readCanonicalPublicCard(card_id);
      return canonical.value && matchesPreferences(canonical.value, preferences) ? canonical.value : null;
    }))).filter((card): card is NonNullable<typeof card> => card !== null));
    // Engagement is authoritative when sufficient. Otherwise the deterministic
    // fallback is persisted movement followed by catalogue provenance, never a
    // synthetic popularity score.
    const fallback = activityCards.length >= 8 ? [] : [
      ...await persistedMarketCards(8, "movers", "raw", undefined, preferences),
      ...await persistedRecentlyAddedCards(8, preferences),
    ];
    const cards = [...activityCards, ...fallback].filter((card, index, all) =>
      all.findIndex((other) => other.id === card.id) === index,
    ).slice(0, 8);
    return res.json({
      data: await convertCatalogueCardsForDisplay(cards, displayCurrency),
      source: activityCards.length >= 8 ? "VerifiedTCG activity" : "VerifiedTCG activity and catalogue",
    });
  } catch {
    return res.status(503).json({ error: "Market data is temporarily unavailable" });
  }
});

/**
 * GET /catalog/trending-lookups
 * Ranks cards by genuine card-detail lookups in the current 12-hour UTC bucket.
 * Search text and collector identities are never stored.
 */
router.get("/catalog/trending-lookups", async (req, res) => {
  try {
    const displayCurrency = requestedDisplayCurrency(req.query.displayCurrency);
    const preferences = await optionalPreferredGames(req.headers.authorization);
    const lookups = await getTrendingLookups(40);
    const ranked = await Promise.all(lookups.map(async lookup => {
      const canonical = await readCanonicalPublicCard(lookup.cardId);
      if (!canonical.value || !matchesPreferences(canonical.value, preferences)) return null;
      return { card: canonical.value, lookup };
    }));
    const cards = await enrichCardsWithCurrentRawQuotes(
      ranked.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .slice(0, 8)
        .map(entry => ({
          ...entry.card,
          trending_lookup_count: entry.lookup.lookupCount,
          trending_window_start: entry.lookup.bucketStart,
          trending_window_end: entry.lookup.bucketEnd,
        })),
    );
    return res.json({
      data: await convertCatalogueCardsForDisplay(cards, displayCurrency),
      source: "VerifiedTCG aggregate card lookups",
      window_start: lookups[0]?.bucketStart ?? null,
      window_end: lookups[0]?.bucketEnd ?? null,
      refresh_hours: 12,
    });
  } catch {
    return res.status(503).json({ error: "Trending data is temporarily unavailable" });
  }
});

/**
 * GET /catalog/recently-added
 * Returns canonical cards ordered by their recorded Verified TCG external
 * identity creation time, with a real current raw quote where available.
 * This is catalogue provenance, not a fabricated release-date or price sort.
 */
router.get("/catalog/recently-added", async (req, res) => {
  try {
    const displayCurrency = requestedDisplayCurrency(req.query.displayCurrency);
    return res.json({
      data: await convertCatalogueCardsForDisplay(
        await persistedRecentlyAddedCards(8, await optionalPreferredGames(req.headers.authorization)),
        displayCurrency,
      ),
      source: "VerifiedTCG catalogue",
    });
  } catch {
    return res.status(503).json({ error: "Catalogue data is temporarily unavailable" });
  }
});

/**
 * Single-card lookup by JustTCG ID (e.g. "pokemon-arceus-charizard-holo-rare").
 *
 * JustTCG has no dedicated "GET /cards/:id" endpoint — it requires at least one
 * filter (game or set).  We work around this by:
 *  1. Parsing the card ID to extract a game hint and a search query.
 *  2. Searching with those terms (up to 50 results).
 *  3. Filtering the response to the exact ID match.
 *
 * The lookup search is cached by the shared durable catalogue layer.
 */
export async function resolveCatalogCardById(
  cardId: string,
): Promise<{
  card: Record<string, unknown>;
  cached: boolean;
  status: number;
  source: "VerifiedTCG" | "JustTCG";
} | null> {
  if (canonicalCatalogueReadsEnabled()) {
    const canonicalRead = await readCanonicalPublicCard(cardId);
    const canonical = canonicalRead.value;
    if (canonical) {
        recordCatalogueReadMetric(
          "card_lookup",
          canonicalRead.outcome,
          canonicalRead.durationMs,
          "canonical",
        );
      return {
        card: canonical,
        cached: false,
        status: 200,
        source: "VerifiedTCG",
      };
    }
    const resolved = await resolveJustTcgCatalogCardById(cardId);
    recordCatalogueReadMetric(
      "card_lookup",
      canonicalRead.outcome,
      canonicalRead.durationMs,
      resolved?.status === 200 ? "justtcg" : "failed",
    );
    return resolved;
  }
  return resolveJustTcgCatalogCardById(cardId);
}

async function resolveJustTcgCatalogCardById(
  cardId: string,
): Promise<{
  card: Record<string, unknown>;
  cached: boolean;
  status: number;
  source: "JustTCG";
} | null> {
  // JustTCG supports direct slug lookup. This is both more accurate and less
  // expensive than attempting to reconstruct a search query from a slug.
  const directParams = new URLSearchParams({ cardId, priceHistoryDuration: "30d" });
  const direct = await justTcg(`/cards?${directParams.toString()}`);
  if (direct.status === 429) {
    return { card: {} as Record<string, unknown>, cached: false, status: 429, source: "JustTCG" };
  }
  if (direct.status >= 500) throw new Error("Catalog provider unavailable");
  if (direct.status < 400) {
    const directBody = direct.body as { data?: Array<Record<string, unknown>> } | null;
    const match = directBody?.data?.find(card => card.id === cardId) ?? null;
    if (match) return { card: enrichCard(match), cached: direct.cached, status: 200, source: "JustTCG" };
  }

  // ID format: "{game}-{set}-{card-name-parts}-{rarity-parts}".
  const parts = cardId.split("-");
  const gameWord = (parts[0] ?? "").toLowerCase();
  const GAME_MAP: Record<string, string> = {
    pokemon: "pokemon",
    magic: "magic-the-gathering",
    yugioh: "yugioh",
    lorcana: "disney-lorcana",
    onepiece: "one-piece-card-game",
    dragonball: "dragon-ball-super-masters",
  };
  const game = GAME_MAP[gameWord];
  const RARITY_TAIL = new Set([
    "common",
    "uncommon",
    "rare",
    "holo",
    "ultra",
    "secret",
    "special",
    "illustration",
    "hyper",
    "rainbow",
    "full",
    "art",
  ]);
  const nameParts = [...parts.slice(1)];
  while (
    nameParts.length > 0 &&
    RARITY_TAIL.has(nameParts[nameParts.length - 1]!)
  ) {
    nameParts.pop();
  }
  const searchQuery = nameParts.join(" ").trim();
  if (!searchQuery) return null;

  const params = new URLSearchParams({
    q: searchQuery,
    limit: "20",
  });
  if (game) params.set("game", game);

  const result = await justTcg(`/cards?${params.toString()}`);
  if (result.status === 429) {
    return {
      card: {} as Record<string, unknown>,
      cached: false,
      status: 429,
      source: "JustTCG",
    };
  }
  if (result.status >= 500) throw new Error("Catalog provider unavailable");
  if (result.status >= 400) return null;

  const body = result.body as { data?: Array<Record<string, unknown>> } | null;
  const match = body?.data?.find((card) => card.id === cardId) ?? null;
  if (!match) return null;

  const card = enrichCard(match);
  return { card, cached: result.cached, status: 200, source: "JustTCG" };
}

router.get("/catalog/cards/:id", async (req, res) => {
  try {
    const displayCurrency = requestedDisplayCurrency(req.query.displayCurrency);
    const resolved = await resolveCatalogCardById(String(req.params.id));
    if (!resolved) return res.status(404).json({ error: "Card not found" });
    if (resolved.status === 429) {
      return res.status(429).json({
        error: "The daily JustTCG catalogue allowance is exhausted",
        code: "CATALOGUE_DAILY_BUDGET_EXHAUSTED",
      });
    }
    const [pricedCard] = await convertCatalogueCardsForDisplay(
      await enrichCardsWithCurrentRawQuotes([resolved.card]), displayCurrency,
    );
    return res.json({
      data: pricedCard ?? resolved.card,
      source: resolved.source,
      cached: resolved.cached,
      ...(resolved.source === "VerifiedTCG" ? { canonical: true } : {}),
    });
  } catch {
    return res.status(503).json({ error: "Catalog provider unavailable" });
  }
});

router.post("/catalog/cards/:id/lookup", requireActiveUser, async (req: AuthRequest, res) => {
  try {
    const cardId = String(req.params.id ?? "").trim();
    const canonical = await readCanonicalPublicCard(cardId);
    if (!canonical.value) {
      return res.status(404).json({ error: "Card not found" });
    }
    await recordCardLookup(cardId, req.userId!);
    return res.status(204).send();
  } catch {
    return res.status(503).json({ error: "Lookup could not be recorded" });
  }
});

export default router;
