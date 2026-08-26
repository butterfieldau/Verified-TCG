import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
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
      if (canonical.length) {
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
          return res.json({
            data: canonical,
            source: "VerifiedTCG",
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
          return res.json({
            data: canonical,
            source: "VerifiedTCG",
            canonical: true,
            cached: fallbackResult.cached ?? false,
          });
        }
        const data = deduplicatePublicCards(canonical, fallbackCards).slice(0, limit);
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
          source:
            delivery === "canonical"
              ? "VerifiedTCG"
              : delivery === "mixed"
                ? "VerifiedTCG+JustTCG"
                : "JustTCG",
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
          body.data = body.data.map(enrichCard);
        return res.json({
          ...body,
          source: "JustTCG",
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
      body.data = body.data.map((card) => {
        const enriched = enrichCard(card);
        return enriched;
      });
    }

    return res.json({ ...body, source: "JustTCG", ...cacheMetadata(result) });
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
  return {
    absoluteCents,
    percent: Number(((absoluteCents / previousCents) * 100).toFixed(2)),
    trend: absoluteCents > 0 ? "up" : absoluteCents < 0 ? "down" : "neutral",
  };
}

/**
 * Market reads are based exclusively on persisted PriceCharting snapshots.
 * A row is eligible only when it has two non-zero raw observations from the
 * same provider/currency and the current observation is still fresh. This
 * intentionally returns no data during a new deployment rather than making
 * provider search results look like a genuine market movement feed.
 */
async function persistedMarketCards(limit = 8) {
  const result = await db.execute<PersistedMarketRow>(sql`
    WITH ranked AS (
      SELECT card_id, price_cents, currency, captured_at,
        row_number() OVER (
          PARTITION BY card_id, provider_key, grade_key
          ORDER BY captured_at DESC
        ) AS position
      FROM card_price_snapshots
      WHERE provider_key = 'pricecharting'
        AND grade_key = 'raw'
        AND capture_status = 'success'
        AND price_cents IS NOT NULL
        AND price_cents > 0
        AND captured_at >= NOW() - INTERVAL '14 days'
    )
    SELECT current_snapshot.card_id,
      current_snapshot.price_cents AS current_cents,
      previous_snapshot.price_cents AS previous_cents,
      current_snapshot.currency,
      current_snapshot.captured_at AS current_at,
      previous_snapshot.captured_at AS previous_at
    FROM ranked current_snapshot
    JOIN ranked previous_snapshot
      ON previous_snapshot.card_id = current_snapshot.card_id
      AND previous_snapshot.position = 2
      AND previous_snapshot.currency = current_snapshot.currency
    WHERE current_snapshot.position = 1
      AND current_snapshot.captured_at >= NOW() - INTERVAL '36 hours'
    ORDER BY ABS(
      (current_snapshot.price_cents - previous_snapshot.price_cents)::numeric
      / previous_snapshot.price_cents
    ) DESC
    LIMIT ${limit}
  `);

  const shaped = await Promise.all(
    result.rows.map(async (row) => {
      const canonical = await readCanonicalPublicCard(row.card_id);
      if (!canonical.value) return null;
      const movement = calculateSnapshotMovement(
        row.previous_cents,
        row.current_cents,
      );
      if (!movement) return null;
      return {
        ...canonical.value,
        variants: [{
          condition: "Near Mint",
          price: row.current_cents / 100,
          priceChange7d: movement.percent,
          lastUpdated: Math.floor(row.current_at.getTime() / 1000),
          markets: [{ region: "source", currency: row.currency, price: row.current_cents / 100 }],
        }],
        market_price: row.current_cents / 100,
        previous_price: row.previous_cents / 100,
        price_change_7d: movement.percent,
        trend: movement.trend,
        currency: row.currency,
        updated_at: row.current_at.toISOString(),
        previous_observed_at: row.previous_at.toISOString(),
      };
    }),
  );
  return shaped.filter((card): card is NonNullable<typeof card> => card !== null);
}

async function persistedRecentlyAddedCards(limit = 8) {
  const result = await db.execute<{
    card_id: string;
    price_cents: number;
    currency: string;
    fetched_at: Date;
  }>(sql`
    SELECT e.external_id AS card_id, q.price_cents, q.currency, q.fetched_at
    FROM catalogue_external_ids e
    JOIN current_quotes q
      ON q.card_id = e.external_id
      AND q.provider_key = 'pricecharting'
      AND q.grade_key = 'raw'
    WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
    ORDER BY e.created_at DESC
    LIMIT ${limit}
  `);
  const shaped = await Promise.all(result.rows.map(async (row) => {
    const canonical = await readCanonicalPublicCard(row.card_id);
    if (!canonical.value) return null;
    return {
      ...canonical.value,
      variants: [{
        condition: "Near Mint",
        price: row.price_cents / 100,
        lastUpdated: Math.floor(row.fetched_at.getTime() / 1000),
        markets: [{ region: "source", currency: row.currency, price: row.price_cents / 100 }],
      }],
      currency: row.currency,
      updated_at: row.fetched_at.toISOString(),
    };
  }));
  return shaped.filter((card): card is NonNullable<typeof card> => card !== null);
}

/**
 * GET /catalog/market-movers
 * Returns cards ranked by the absolute movement between the two most recent
 * comparable persisted PriceCharting raw snapshots. Observations must share
 * a card, currency, provider, and grade, be positive, and be fresh enough to
 * avoid presenting stale data as a current market signal.
 */
router.get("/catalog/market-movers", async (_req, res) => {
  try {
    return res.json({
      data: await persistedMarketCards(),
      source: "VerifiedTCG snapshots",
    });
  } catch {
    return res.status(503).json({ error: "Market data is temporarily unavailable" });
  }
});

/**
 * GET /catalog/trending
 * Returns the same deterministic, persisted-snapshot market ranking as movers.
 * Verified TCG does not yet retain an independent popularity signal, so this
 * endpoint deliberately does not claim synthetic views, searches, or sales.
 */
router.get("/catalog/trending", async (_req, res) => {
  try {
    const cards = await persistedMarketCards();
    return res.json({
      // Trend is a deterministic ranking of fresh, comparable snapshot
      // movements; the same records power movers rather than simulated views.
      data: cards,
      source: "VerifiedTCG snapshots",
    });
  } catch {
    return res.status(503).json({ error: "Market data is temporarily unavailable" });
  }
});

/**
 * GET /catalog/recently-added
 * Returns canonical cards ordered by their recorded Verified TCG external
 * identity creation time, with a real current raw quote where available.
 * This is catalogue provenance, not a fabricated release-date or price sort.
 */
router.get("/catalog/recently-added", async (_req, res) => {
  try {
    return res.json({
      data: await persistedRecentlyAddedCards(),
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
  // ID format: "{game}-{set}-{card-name-parts}-{rarity-parts}".
  const parts = cardId.split("-");
  const gameWord = (parts[0] ?? "").toLowerCase();
  const GAME_MAP: Record<string, string> = {
    pokemon: "Pokemon",
    magic: "Magic: The Gathering",
    yugioh: "Yu-Gi-Oh!",
    lorcana: "Disney Lorcana",
    onepiece: "One Piece",
    dragonball: "Dragon Ball Super",
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
    include_price_history: "false",
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
    const resolved = await resolveCatalogCardById(String(req.params.id));
    if (!resolved) return res.status(404).json({ error: "Card not found" });
    if (resolved.status === 429) {
      return res.status(429).json({
        error: "The daily JustTCG catalogue allowance is exhausted",
        code: "CATALOGUE_DAILY_BUDGET_EXHAUSTED",
      });
    }
    return res.json({
      data: resolved.card,
      source: resolved.source,
      cached: resolved.cached,
      ...(resolved.source === "VerifiedTCG" ? { canonical: true } : {}),
    });
  } catch {
    return res.status(503).json({ error: "Catalog provider unavailable" });
  }
});

export default router;
