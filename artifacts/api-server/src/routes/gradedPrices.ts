import { Router } from "express";

const router = Router();

const GRADED_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FOREX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours

type CacheEntry = { expiresAt: number; body: unknown };
const gradedCache = new Map<string, CacheEntry>();

// Forex rate cache — refreshed once per day, fallback ~AUD/USD mid rate
let forexRate = 1.55;
let forexExpiry = 0;

function getCached(key: string): unknown | undefined {
  const entry = gradedCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    gradedCache.delete(key);
    return undefined;
  }
  return entry.body;
}

function setCached(key: string, body: unknown, ttl = GRADED_CACHE_TTL_MS): void {
  gradedCache.set(key, { expiresAt: Date.now() + ttl, body });
}

async function getUsdToAud(): Promise<number> {
  if (Date.now() < forexExpiry) return forexRate;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=AUD", {
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { rates?: { AUD?: number } };
    if (json.rates?.AUD && json.rates.AUD > 0) {
      forexRate = json.rates.AUD;
      forexExpiry = Date.now() + FOREX_CACHE_TTL_MS;
    }
  } catch {
    // keep previous fallback rate
  }
  return forexRate;
}

interface GradeSpec {
  key: string;
  ebayTerms: string;
}

const GRADES: GradeSpec[] = [
  { key: "psa10", ebayTerms: "PSA 10" },
  { key: "psa9",  ebayTerms: "PSA 9"  },
  { key: "psa8",  ebayTerms: "PSA 8"  },
  { key: "cgc10", ebayTerms: "CGC 10" },
  { key: "bgs95", ebayTerms: "BGS 9.5" },
  { key: "bgs10", ebayTerms: "BGS 10"  },
];

/** Map our internal tcg key to a short eBay keyword that reduces noise. */
const GAME_KEYWORDS: Record<string, string> = {
  pokemon:     "pokemon",
  onepiece:    "One Piece",
  yugioh:      "Yu-Gi-Oh",
  lorcana:     "Lorcana",
  dragonball:  "Dragon Ball",
  magic:       "MTG",
};

/**
 * Build an eBay search query that is specific enough to avoid false matches.
 * Wrapping name and set in quotes requires both terms to appear in the title.
 */
function buildQuery(name: string, setName: string, game: string, grade: string): string {
  const gkw = GAME_KEYWORDS[game.toLowerCase()] ?? "";
  return `"${name}" "${setName}" ${grade}${gkw ? ` ${gkw}` : ""}`;
}

/**
 * Hit the eBay Finding API for completed (sold) items matching query.
 * Returns the median sold price in USD, or null when no results are found.
 *
 * Uses the Finding API (SECURITY-APPNAME only — no OAuth secret required).
 * Docs: https://developer.ebay.com/devzone/finding/callref/findCompletedItems.html
 */
async function fetchEbayAvgUsd(
  appId: string,
  query: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const params = new URLSearchParams({
    "OPERATION-NAME":              "findCompletedItems",
    "SERVICE-NAME":                "FindingService",
    "SERVICE-VERSION":             "1.0.0",
    "SECURITY-APPNAME":            appId,
    "RESPONSE-DATA-FORMAT":        "JSON",
    "keywords":                    query,
    "itemFilter(0).name":          "SoldItemsOnly",
    "itemFilter(0).value":         "true",
    "sortOrder":                   "EndTimeSoonest",
    "paginationInput.entriesPerPage": "10",
  });

  const res = await fetch(
    `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`,
    { signal },
  );
  if (!res.ok) return null;

  const json = (await res.json()) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: unknown[] = (json as any)
    ?.findCompletedItemsResponse?.[0]
    ?.searchResult?.[0]
    ?.item ?? [];

  if (!items.length) return null;

  const prices: number[] = [];
  for (const item of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (item as any)?.sellingStatus?.[0]?.currentPrice?.[0];
    if (!raw) continue;
    const val = Number(raw["__value__"]);
    const currency = String(raw["@currencyId"] ?? "USD");
    if (!Number.isFinite(val) || val <= 0) continue;
    // Normalise to USD; AUD listings are rare for graded TCG cards but handled
    prices.push(currency === "AUD" ? val / forexRate : val);
  }

  if (!prices.length) return null;

  // Median to reduce outlier impact (single high-grade auction can skew an average)
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0
    ? (prices[mid - 1]! + prices[mid]!) / 2
    : prices[mid]!;
}

/**
 * GET /api/graded-prices?name=Umbreon+ex&set=Prismatic+Evolutions&game=pokemon
 *
 * Returns a map of grade keys to AUD prices derived from recent eBay sold listings.
 * When EBAY_APP_ID is not configured, returns an empty prices object so the client
 * hides the section rather than showing stale/fake data.
 * Results are cached 12 hours per card to avoid hammering eBay on every page view.
 */
router.get("/graded-prices", async (req, res) => {
  const appId = process.env.EBAY_APP_ID;
  if (!appId) {
    // Credentials not yet configured — return empty so the UI hides graded rows
    return res.status(200).json({ prices: {}, cached: false, configured: false });
  }

  const name    = typeof req.query.name === "string" ? req.query.name.trim()    : "";
  const setName = typeof req.query.set  === "string" ? req.query.set.trim()     : "";
  const game    = typeof req.query.game === "string" ? req.query.game.trim()    : "pokemon";

  if (!name || !setName) {
    return res.status(400).json({ error: "name and set query params are required" });
  }

  const cacheKey = `graded:${name.toLowerCase()}:${setName.toLowerCase()}`;
  const hit = getCached(cacheKey);
  if (hit) return res.json({ prices: hit, cached: true, configured: true });

  try {
    const usdToAud = await getUsdToAud();

    // Fetch all grades in parallel; any individual failure returns null (grade omitted)
    const results = await Promise.allSettled(
      GRADES.map(async (g) => {
        const query = buildQuery(name, setName, game, g.ebayTerms);
        const avgUsd = await fetchEbayAvgUsd(appId, query, AbortSignal.timeout(8000));
        return { key: g.key, avgUsd };
      }),
    );

    const prices: Record<string, number> = {};
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.avgUsd !== null) {
        prices[r.value.key] = Math.round(r.value.avgUsd * usdToAud);
      }
    }

    setCached(cacheKey, prices);
    return res.json({ prices, cached: false, configured: true, rate: usdToAud });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : "eBay unavailable",
    });
  }
});

export default router;
