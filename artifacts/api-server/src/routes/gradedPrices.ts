import { Router } from "express";
import { requireProUser, type AuthRequest } from "../lib/authMiddleware.js";

const router = Router();

// ── Constants ────────────────────────────────────────────────────────────────
const GRADED_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FOREX_CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_SIZE      = 1_000;                // max cached card entries
const RATE_LIMIT_WINDOW   = 60_000;              // 1 minute
const RATE_LIMIT_MAX      = 20;                   // requests per IP per window

// Input constraints
const MAX_FIELD_LEN = 120;
const ALLOWED_GAMES = new Set([
  "pokemon", "onepiece", "yugioh", "lorcana", "dragonball", "magic",
]);

// ── Forex cache ───────────────────────────────────────────────────────────────
let forexRate   = 1.55;
let forexExpiry = 0;

async function getUsdToAud(): Promise<number> {
  if (Date.now() < forexExpiry) return forexRate;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=AUD", {
      signal: AbortSignal.timeout(5_000),
    });
    const json = (await res.json()) as { rates?: { AUD?: number } };
    if (json.rates?.AUD && json.rates.AUD > 0) {
      forexRate  = json.rates.AUD;
      forexExpiry = Date.now() + FOREX_CACHE_TTL_MS;
    }
  } catch {
    // keep previous fallback rate
  }
  return forexRate;
}

// ── Bounded graded-price cache ────────────────────────────────────────────────
type CacheEntry = { expiresAt: number; prices: Record<string, number> };
const gradedCache = new Map<string, CacheEntry>();

function getCached(key: string): Record<string, number> | undefined {
  const entry = gradedCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) { gradedCache.delete(key); return undefined; }
  return entry.prices;
}

function setCached(key: string, prices: Record<string, number>): void {
  // Evict the oldest entry when the cache is full
  if (gradedCache.size >= CACHE_MAX_SIZE) {
    const oldest = gradedCache.keys().next().value;
    if (oldest) gradedCache.delete(oldest);
  }
  gradedCache.set(key, { expiresAt: Date.now() + GRADED_CACHE_TTL_MS, prices });
}

// ── In-flight request deduplication ──────────────────────────────────────────
// Prevents multiple concurrent requests for the same card from each fanning out
// to six eBay calls. The second (and later) concurrent request awaits the first.
const inFlight = new Map<string, Promise<Record<string, number>>>();

// ── Per-IP rate limiting ──────────────────────────────────────────────────────
type RateBucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return true;
  bucket.count++;
  return false;
}

// Periodic cleanup so the rate-bucket map doesn't grow indefinitely
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [ip, b] of rateBuckets) {
    if (b.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW);

// ── eBay helpers ──────────────────────────────────────────────────────────────

/** Returns true for sandbox App IDs (contain -SBX- or SANDBOX). */
function isSandboxId(appId: string): boolean {
  const u = appId.toUpperCase();
  return u.includes("-SBX-") || u.includes("SANDBOX");
}

function ebayFindingUrl(appId: string): string {
  return isSandboxId(appId)
    ? "https://svcs.sandbox.ebay.com/services/search/FindingService/v1"
    : "https://svcs.ebay.com/services/search/FindingService/v1";
}

const GAME_KEYWORDS: Record<string, string> = {
  pokemon:    "pokemon",
  onepiece:   "One Piece",
  yugioh:     "Yu-Gi-Oh",
  lorcana:    "Lorcana",
  dragonball: "Dragon Ball",
  magic:      "MTG",
};

function buildQuery(name: string, setName: string, game: string, grade: string): string {
  // Quote the card name for exact match; leave set as plain keywords so minor
  // title variations (e.g. omitted "Pokémon") still return results.
  const gkw = GAME_KEYWORDS[game] ?? "";
  return `"${name}" ${setName} ${grade}${gkw ? ` ${gkw}` : ""}`;
}

interface GradeSpec { key: string; ebayTerms: string }
const GRADES: GradeSpec[] = [
  { key: "psa10", ebayTerms: "PSA 10"  },
  { key: "psa9",  ebayTerms: "PSA 9"   },
  { key: "psa8",  ebayTerms: "PSA 8"   },
  { key: "cgc10", ebayTerms: "CGC 10"  },
  { key: "bgs95", ebayTerms: "BGS 9.5" },
  { key: "bgs10", ebayTerms: "BGS 10"  },
];

/**
 * Hit the eBay Finding API for recently sold items matching a query.
 * Returns the median sold price in USD, or null when there are no results.
 */
async function fetchEbayMedianUsd(
  appId: string,
  query: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const params = new URLSearchParams({
    "OPERATION-NAME":                 "findCompletedItems",
    "SERVICE-NAME":                   "FindingService",
    "SERVICE-VERSION":                "1.0.0",
    "SECURITY-APPNAME":               appId,
    "RESPONSE-DATA-FORMAT":           "JSON",
    "keywords":                       query,
    "itemFilter(0).name":             "SoldItemsOnly",
    "itemFilter(0).value":            "true",
    "sortOrder":                      "EndTimeSoonest",
    "paginationInput.entriesPerPage": "10",
  });

  const res = await fetch(`${ebayFindingUrl(appId)}?${params.toString()}`, { signal });
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json()) as any;
  const response = json?.findCompletedItemsResponse?.[0];
  if (response?.ack?.[0] !== "Success") return null;

  const items: unknown[] = response?.searchResult?.[0]?.item ?? [];
  if (!items.length) return null;

  const prices: number[] = [];
  for (const item of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (item as any)?.sellingStatus?.[0]?.currentPrice?.[0];
    if (!raw) continue;
    const val      = Number(raw["__value__"]);
    const currency = String(raw["@currencyId"] ?? "USD");
    if (!Number.isFinite(val) || val <= 0) continue;
    prices.push(currency === "AUD" ? val / forexRate : val);
  }
  if (!prices.length) return null;

  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0
    ? (prices[mid - 1]! + prices[mid]!) / 2
    : prices[mid]!;
}

/**
 * Fetch all grade prices for a card from eBay and convert to AUD.
 * Intended to run once per cache miss; concurrent calls with the same key
 * are coalesced by the in-flight deduplication map above.
 */
async function fetchAllGrades(
  appId: string,
  name: string,
  setName: string,
  game: string,
): Promise<Record<string, number>> {
  const usdToAud = await getUsdToAud();
  const results = await Promise.allSettled(
    GRADES.map(async (g) => {
      const query = buildQuery(name, setName, game, g.ebayTerms);
      const median = await fetchEbayMedianUsd(appId, query, AbortSignal.timeout(8_000));
      return { key: g.key, median };
    }),
  );
  const prices: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.median !== null) {
      prices[r.value.key] = Math.round(r.value.median * usdToAud);
    }
  }
  return prices;
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/graded-prices?name=Umbreon+ex&set=Prismatic+Evolutions&game=pokemon
 *
 * Returns a map of grade keys → AUD prices derived from recent eBay sold listings.
 *
 * - Returns { prices: {}, configured: false } (200) when EBAY_APP_ID is absent or a
 *   sandbox key, so the client can hide the section rather than show an error.
 * - Results are cached 12 hours server-side per (name, set, game) triple.
 * - Concurrent requests for the same card share a single in-flight fetch.
 * - Rate-limited to 20 requests per IP per minute.
 */
router.get("/graded-prices", requireProUser, async (req: AuthRequest, res) => {
  // ── Rate limiting ──
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  }

  // ── App ID check ──
  const appId = process.env.EBAY_APP_ID;
  if (!appId) {
    return res.status(200).json({ prices: {}, cached: false, configured: false });
  }
  if (isSandboxId(appId)) {
    return res.status(200).json({
      prices: {},
      cached: false,
      configured: false,
      warning: "EBAY_APP_ID is a sandbox key. Set a Production App ID from developer.ebay.com to enable real prices.",
    });
  }

  // ── Input validation ──
  const name    = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const setName = typeof req.query.set  === "string" ? req.query.set.trim()  : "";
  const game    = typeof req.query.game === "string" ? req.query.game.trim().toLowerCase() : "pokemon";

  if (!name || name.length > MAX_FIELD_LEN) {
    return res.status(400).json({ error: "name is required and must be ≤ 120 characters" });
  }
  if (!setName || setName.length > MAX_FIELD_LEN) {
    return res.status(400).json({ error: "set is required and must be ≤ 120 characters" });
  }
  if (!ALLOWED_GAMES.has(game)) {
    return res.status(400).json({
      error: `game must be one of: ${[...ALLOWED_GAMES].join(", ")}`,
    });
  }

  // ── Cache lookup (game included in key) ──
  const cacheKey = `${game}:${name.toLowerCase()}:${setName.toLowerCase()}`;
  const hit = getCached(cacheKey);
  if (hit) return res.json({ prices: hit, cached: true, configured: true });

  // ── Request deduplication ──
  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = fetchAllGrades(appId, name, setName, game)
      .then((prices) => { setCached(cacheKey, prices); return prices; })
      .finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }

  try {
    const prices = await pending;
    return res.json({ prices, cached: false, configured: true });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : "eBay unavailable",
    });
  }
});

export default router;
