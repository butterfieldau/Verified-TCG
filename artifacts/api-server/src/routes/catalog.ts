import { Router } from "express";

const router = Router();
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

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
function pokemonImageUrl(set: string | undefined, number: string | undefined): string | undefined {
  if (!set || !number) return undefined;
  // Normalise: lower-case, strip whitespace
  const setId = set.trim().toLowerCase();
  // JustTCG returns numbers like "125/197" — the CDN only needs the card number ("125")
  const num = number.trim().split('/')[0].trim();
  if (!setId || !num) return undefined;
  return `https://images.pokemontcg.io/${setId}/${num}.png`;
}

function isPokemonGame(game: string): boolean {
  return game.toLowerCase().includes("pokemon") || game.toLowerCase().includes("pokémon");
}

/** Apply image enrichment to a single card record (same priority as list endpoint). */
function enrichCard(card: Record<string, unknown>): Record<string, unknown> {
  if (card.image_url) return card;
  if (card.tcgplayerId) {
    return { ...card, image_url: `https://product-images.tcgplayer.com/fit-in/1000x1000/${String(card.tcgplayerId)}.jpg` };
  }
  if (isPokemonGame(String(card.game ?? ""))) {
    const derived = pokemonImageUrl(card.set as string | undefined, card.number as string | undefined);
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

type CacheEntry = { expiresAt: number; body: unknown };
const cache = new Map<string, CacheEntry>();

function requiredKey(): string {
  const key = process.env.JUSTTCG_API_KEY;
  if (!key) throw new Error("JUSTTCG_API_KEY is not configured");
  return key;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function justTcg(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const key = requiredKey();
  const response = await fetch(`${JUSTTCG_BASE_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": key,
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({ error: "Invalid provider response" }));
  return { status: response.status, body };
}

function cached(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.body;
}

function saveCache(key: string, body: unknown): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, body });
}

router.get("/catalog/games", async (_req, res) => {
  try {
    const cacheKey = "games";
    const hit = cached(cacheKey);
    if (hit) return res.json({ ...((hit as object) ?? {}), source: "JustTCG", cached: true });
    const result = await justTcg("/games");
    if (result.status >= 400) return res.status(result.status).json(result.body);
    saveCache(cacheKey, result.body);
    return res.json({ ...((result.body as object) ?? {}), source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
  }
});

router.get("/catalog/cards", async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const game = typeof req.query.game === "string" ? req.query.game.trim() : "";
    const limit = positiveInt(req.query.limit, 20, 100);
    const offset = positiveInt(req.query.offset, 0, 1000000);
    if (!query && !game) return res.status(400).json({ error: "Provide q or game" });

    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (query) params.set("q", query);
    if (game) params.set("game", game);
    params.set("include_price_history", "false");
    const cacheKey = `cards:${params.toString()}`;
    const hit = cached(cacheKey);
    if (hit) return res.json({ ...((hit as object) ?? {}), source: "JustTCG", cached: true });

    const result = await justTcg(`/cards?${params.toString()}`);
    if (result.status >= 400) return res.status(result.status).json(result.body);

    // Enrich cards that are missing an image_url.
    // Priority:
    //  1. image_url already provided by JustTCG — keep as-is.
    //  2. TCGPlayer CDN via tcgplayerId — stable numeric product ID, always
    //     resolves to the correct card image regardless of set-code mapping.
    //  3. pokemontcg.io CDN derived from set + number — last resort only, since
    //     JustTCG set codes (e.g. "me-ascended-heroes-pokemon") do NOT match
    //     the pokemontcg.io set-code scheme and these URLs frequently 404.
    const body = result.body as { data?: Array<Record<string, unknown>> } | null;
    if (body && Array.isArray(body.data)) {
      body.data = body.data.map((card) => {
        if (card.image_url) return card; // JustTCG already provided an image
        if (card.tcgplayerId) {
          return { ...card, image_url: `https://product-images.tcgplayer.com/fit-in/1000x1000/${String(card.tcgplayerId)}.jpg` };
        }
        if (isPokemonGame(String(card.game ?? ""))) {
          const derived = pokemonImageUrl(
            card.set as string | undefined,
            card.number as string | undefined,
          );
          if (derived) return { ...card, image_url: derived };
        }
        return card;
      });
    }

    saveCache(cacheKey, body);
    return res.json({ ...((body as object) ?? {}), source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
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
  return ((result.body as { data?: Array<Record<string, unknown>> })?.data) ?? [];
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

/**
 * GET /catalog/market-movers
 * Returns up to 8 cards with the highest absolute 7-day price change across
 * all six supported TCGs (Pokémon, One Piece, MTG, Yu-Gi-Oh!, Disney Lorcana,
 * Dragon Ball Super). Runs parallel JustTCG queries constrained by explicit
 * game= filters, merges into one deduplicated pool, sorts globally by
 * |priceChange7d|, then applies a per-game cap (max 3) to ensure variety.
 * Global ranking is fully preserved — the highest-change card always wins its
 * slot regardless of game.
 * Each result includes top-level market_price, price_change_7d, and trend
 * fields so the client doesn't need to dig into variants.
 */
router.get("/catalog/market-movers", async (_req, res) => {
  try {
    const cacheKey = "market-movers";
    const hit = cached(cacheKey);
    if (hit) return res.json({ data: hit, source: "JustTCG", cached: true });

    // Parallel queries across all six supported TCGs with explicit game= filters
    const [rPoke1, rPoke2, rOp, rMtg, rYgo, rLor, rDbs] = await Promise.all([
      justTcg("/cards?q=Charizard&game=Pokemon&limit=20&include_price_history=false"),
      justTcg("/cards?q=Umbreon&game=Pokemon&limit=20&include_price_history=false"),
      justTcg("/cards?q=Luffy&game=One+Piece&limit=20&include_price_history=false"),
      justTcg("/cards?q=Black+Lotus&game=Magic%3A+The+Gathering&limit=20&include_price_history=false"),
      justTcg("/cards?q=Blue-Eyes&game=Yu-Gi-Oh%21&limit=20&include_price_history=false"),
      justTcg("/cards?q=Elsa&game=Disney+Lorcana&limit=20&include_price_history=false"),
      justTcg("/cards?q=Goku&game=Dragon+Ball+Super&limit=20&include_price_history=false"),
    ]);

    // Track whether at least one query succeeded so we can 503 if all fail
    const anyOk = { value: false };
    const pool = mergePool(
      extractData(rPoke1, anyOk),
      extractData(rPoke2, anyOk),
      extractData(rOp,    anyOk),
      extractData(rMtg,   anyOk),
      extractData(rYgo,   anyOk),
      extractData(rLor,   anyOk),
      extractData(rDbs,   anyOk),
    );

    if (!anyOk.value) {
      return res.status(503).json({ error: "All catalog providers unavailable" });
    }

    // Score and sort globally by |priceChange7d|
    const scored = pool
      .map(enrichCard)
      .flatMap((card) => {
        const nm = getNmVariant(card.variants);
        if (!nm) return [];
        const price = Number(nm.price ?? 0);
        if (price < 5) return [];
        const priceChange7d = Number(nm.priceChange7d ?? 0);
        return [{
          game: String(card.game ?? ""),
          card: { ...card, market_price: price, price_change_7d: priceChange7d,
            trend: priceChange7d >= 0.5 ? "up" : priceChange7d <= -0.5 ? "down" : "neutral" },
          score: Math.abs(priceChange7d),
        }];
      })
      .sort((a, b) => b.score - a.score);

    // Apply per-game cap (max 3 of 6 games × 3 = 18 candidates → top 8)
    // while preserving global ranking order
    const enriched = capByGameFromSorted(scored, 3, 8).map((s) => s.card);

    saveCache(cacheKey, enriched);
    return res.json({ data: enriched, source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
  }
});

/**
 * GET /catalog/trending
 * Returns up to 8 actively-traded cards across all six supported TCGs, measured
 * by priceChangesCount7d (number of price updates in the past 7 days). Runs
 * parallel queries with explicit game= filters for every supported TCG, merges
 * into one deduplicated pool, sorts globally by priceChangesCount7d, then
 * applies a per-game cap (max 3) to ensure variety. Global ranking is preserved.
 */
router.get("/catalog/trending", async (_req, res) => {
  try {
    const cacheKey = "trending";
    const hit = cached(cacheKey);
    if (hit) return res.json({ data: hit, source: "JustTCG", cached: true });

    // Parallel queries across all six supported TCGs with explicit game= filters
    const [rPoke, rOp, rMtg, rYgo, rLor, rDbs] = await Promise.all([
      justTcg("/cards?q=ex&game=Pokemon&limit=20&include_price_history=false"),
      justTcg("/cards?q=Luffy&game=One+Piece&limit=20&include_price_history=false"),
      justTcg("/cards?q=Lightning+Bolt&game=Magic%3A+The+Gathering&limit=20&include_price_history=false"),
      justTcg("/cards?q=Blue-Eyes&game=Yu-Gi-Oh%21&limit=20&include_price_history=false"),
      justTcg("/cards?q=Elsa&game=Disney+Lorcana&limit=20&include_price_history=false"),
      justTcg("/cards?q=Goku&game=Dragon+Ball+Super&limit=20&include_price_history=false"),
    ]);

    // Track whether at least one query succeeded so we can 503 if all fail
    const anyOk = { value: false };
    const pool = mergePool(
      extractData(rPoke, anyOk),
      extractData(rOp,   anyOk),
      extractData(rMtg,  anyOk),
      extractData(rYgo,  anyOk),
      extractData(rLor,  anyOk),
      extractData(rDbs,  anyOk),
    );

    if (!anyOk.value) {
      return res.status(503).json({ error: "All catalog providers unavailable" });
    }

    // Score and sort globally by priceChangesCount7d (high update frequency = trending)
    const scored = pool
      .map(enrichCard)
      .flatMap((card) => {
        const nm = getNmVariant(card.variants);
        if (!nm) return [];
        const price = Number(nm.price ?? 0);
        if (price <= 0) return [];
        const changes7d = Number(nm.priceChangesCount7d ?? 0);
        return [{ game: String(card.game ?? ""), card, score: changes7d }];
      })
      .sort((a, b) => b.score - a.score);

    // Apply per-game cap (max 3 of 6 games × 3 = 18 candidates → top 8)
    // while preserving global ranking order
    const enriched = capByGameFromSorted(scored, 3, 8).map((s) => s.card);

    saveCache(cacheKey, enriched);
    return res.json({ data: enriched, source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
  }
});

/**
 * GET /catalog/recently-added
 * Returns up to 8 cards representing new catalog additions.
 * Queries Pikachu (broad set coverage across all Pokémon eras) sorted by
 * price descending — surfaces high-value, collector-relevant releases.
 * A separate query for non-Pokémon TCGs is merged in for variety.
 */
router.get("/catalog/recently-added", async (_req, res) => {
  try {
    const cacheKey = "recently-added";
    const hit = cached(cacheKey);
    if (hit) return res.json({ data: hit, source: "JustTCG", cached: true });

    const [r1, r2] = await Promise.all([
      justTcg("/cards?q=Pikachu&game=Pokemon&limit=20&include_price_history=false"),
      justTcg("/cards?q=Luffy&limit=10&include_price_history=false"),
    ]);

    const cards1 = ((r1.body as { data?: Array<Record<string, unknown>> })?.data) ?? [];
    const cards2 = ((r2.body as { data?: Array<Record<string, unknown>> })?.data) ?? [];

    const seen = new Set<string>();
    const merged = [...cards1, ...cards2].filter((c) => {
      const id = String(c.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const enriched = merged
      .map(enrichCard)
      .flatMap((card) => {
        const nm = getNmVariant(card.variants);
        if (!nm) return [];
        const price = Number(nm.price ?? 0);
        if (price <= 0) return [];
        return [{ card, price }];
      })
      .sort((a, b) => b.price - a.price)
      .slice(0, 8)
      .map(({ card }) => card);

    saveCache(cacheKey, enriched);
    return res.json({ data: enriched, source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
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
 * Results are cached for CACHE_TTL_MS like any other catalog response.
 */
router.get("/catalog/cards/:id", async (req, res) => {
  try {
    const cardId = String(req.params.id);
    const cacheKey = `card:${cardId}`;
    const hit = cached(cacheKey);
    if (hit) return res.json({ data: hit, source: "JustTCG", cached: true });

    // --- Parse the ID to build a targeted search ----------------------------
    // ID format: "{game}-{set}-{card-name-parts}-{rarity-parts}"
    // e.g. "pokemon-arceus-charizard-holo-rare"
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

    // Build a clean search query by stripping trailing rarity/modifier words.
    // We intentionally keep set-code segments (e.g. "sv3pt5") because removing
    // them reliably would require knowing all set codes; JustTCG search ignores
    // unknown terms so they don't hurt results, while card-name terms help.
    const RARITY_TAIL = new Set([
      "common", "uncommon", "rare", "holo", "ultra", "secret", "special",
      "illustration", "hyper", "rainbow", "full", "art",
    ]);
    const nameParts = [...parts.slice(1)]; // remove game prefix
    while (nameParts.length > 0 && RARITY_TAIL.has(nameParts[nameParts.length - 1]!)) {
      nameParts.pop();
    }
    const searchQuery = nameParts.join(" ").trim();
    if (!searchQuery) return res.status(404).json({ error: "Card not found" });

    const params = new URLSearchParams({
      q: searchQuery,
      limit: "20",
      include_price_history: "false",
    });
    if (game) params.set("game", game);

    const result = await justTcg(`/cards?${params.toString()}`);
    if (result.status >= 400) return res.status(result.status).json(result.body);

    const body = result.body as { data?: Array<Record<string, unknown>> } | null;
    const match = body?.data?.find((c) => c.id === cardId) ?? null;
    if (!match) return res.status(404).json({ error: "Card not found" });

    // Enrich with image URL using the same priority as the list endpoint:
    // TCGPlayer CDN (tcgplayerId) first, pokemontcg.io CDN as a last resort.
    let card = match;
    if (!card.image_url) {
      if (card.tcgplayerId) {
        card = { ...card, image_url: `https://product-images.tcgplayer.com/fit-in/1000x1000/${String(card.tcgplayerId)}.jpg` };
      } else if (isPokemonGame(String(card.game ?? ""))) {
        const derived = pokemonImageUrl(
          card.set as string | undefined,
          card.number as string | undefined,
        );
        if (derived) card = { ...card, image_url: derived };
      }
    }

    saveCache(cacheKey, card);
    return res.json({ data: card, source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
  }
});

export default router;
