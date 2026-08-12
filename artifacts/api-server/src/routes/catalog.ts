import { Router } from "express";

const router = Router();
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

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
    saveCache(cacheKey, result.body);
    return res.json({ ...((result.body as object) ?? {}), source: "JustTCG", cached: false });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : "Catalog provider unavailable" });
  }
});

export default router;
