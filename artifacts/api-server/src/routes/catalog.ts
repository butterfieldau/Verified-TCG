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

    // Enrich cards that are missing an image_url with a pokemontcg.io CDN URL
    // (for Pokémon cards) or leave them for the client's TCGPlayer fallback.
    const body = result.body as { data?: Array<Record<string, unknown>> } | null;
    if (body && Array.isArray(body.data)) {
      body.data = body.data.map((card) => {
        if (card.image_url) return card; // already has an image — nothing to do
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
    // Use all segments after the game word as the search query
    const searchQuery = parts.slice(1).join(" ").trim();
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

    // Enrich with image URL when missing
    let card = match;
    if (!card.image_url && isPokemonGame(String(card.game ?? ""))) {
      const derived = pokemonImageUrl(
        card.set as string | undefined,
        card.number as string | undefined,
      );
      if (derived) card = { ...card, image_url: derived };
    }

    saveCache(cacheKey, card);
    return res.json({ data: card, source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
  }
});

export default router;
