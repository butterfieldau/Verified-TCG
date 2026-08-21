import { Router } from "express";
import { requireProUser, type AuthRequest } from "../lib/authMiddleware.js";
import {
  EBAY_GRADE_SPECS,
  getEbayCompletedSales,
  medianCompletedSalePrice,
  type EbaySalesAvailability,
} from "../lib/ebaySales.js";

const router = Router();

const GRADED_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX_SIZE = 1_000;
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 20;
const MAX_FIELD_LEN = 120;
const ALLOWED_GAMES = new Set([
  "pokemon", "onepiece", "yugioh", "lorcana", "dragonball", "magic",
]);

interface GradedPriceResponse {
  prices: Record<string, number>;
  configured: boolean;
  availability: EbaySalesAvailability;
  message: string | null;
  source: "ebay_completed_sales";
}

type CacheEntry = { expiresAt: number; response: GradedPriceResponse };
type RateBucket = { count: number; windowStart: number };

const gradedCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GradedPriceResponse>>();
const rateBuckets = new Map<string, RateBucket>();

function cachedResponse(key: string): GradedPriceResponse | undefined {
  const entry = gradedCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    gradedCache.delete(key);
    return undefined;
  }
  return entry.response;
}

function cacheResponse(key: string, response: GradedPriceResponse): void {
  if (gradedCache.size >= CACHE_MAX_SIZE) {
    const oldest = gradedCache.keys().next().value;
    if (oldest) gradedCache.delete(oldest);
  }
  gradedCache.set(key, { expiresAt: Date.now() + GRADED_CACHE_TTL_MS, response });
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(ip);
  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (existing.count >= RATE_LIMIT_MAX) return true;
  existing.count += 1;
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW);

function unavailableResponse(
  availability: Exclude<EbaySalesAvailability, "available">,
  message: string | null,
): GradedPriceResponse {
  return {
    prices: {},
    configured: availability !== "configuration_error",
    availability,
    message,
    source: "ebay_completed_sales",
  };
}

function firstFailure(
  values: { availability: EbaySalesAvailability; message: string | null }[],
): GradedPriceResponse {
  const priority: Exclude<EbaySalesAvailability, "available">[] = [
    "configuration_error",
    "authorization_error",
    "permission_error",
    "conversion_error",
    "upstream_error",
    "no_results",
  ];
  for (const status of priority) {
    const found = values.find((value) => value.availability === status);
    if (found) return unavailableResponse(status, found.message);
  }
  return unavailableResponse("upstream_error", "eBay completed sales are temporarily unavailable. Please try again.");
}

async function fetchGradePrices(
  name: string,
  setName: string,
  game: string,
  number: string,
): Promise<GradedPriceResponse> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
  const results = await Promise.all(
    EBAY_GRADE_SPECS.map(async (grade) => ({
      grade,
      result: await getEbayCompletedSales({
        name,
        setName,
        game,
        number,
        gradeKey: grade.key,
        since,
        displayCurrency: "AUD",
        limit: 100,
      }),
    })),
  );

  const prices: Record<string, number> = {};
  for (const { grade, result } of results) {
    if (result.availability !== "available") continue;
    const median = medianCompletedSalePrice(result.sales);
    if (median != null) prices[grade.key] = median;
  }

  if (Object.keys(prices).length > 0) {
    return {
      prices,
      configured: true,
      availability: "available",
      message: null,
      source: "ebay_completed_sales",
    };
  }

  return firstFailure(results.map(({ result }) => result));
}

/**
 * GET /graded-prices?name=Umbreon+ex&set=Prismatic+Evolutions&game=pokemon
 *
 * Returns only median values derived from matching eBay Marketplace Insights
 * completed sales. Raw and graded rows use the same evidence policy; grades
 * without genuine matches are omitted.
 */
router.get("/graded-prices", requireProUser, async (req: AuthRequest, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests. Please try again shortly." });
    return;
  }

  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const setName = typeof req.query.set === "string" ? req.query.set.trim() : "";
  const game = typeof req.query.game === "string" ? req.query.game.trim().toLowerCase() : "";
  const number = typeof req.query.number === "string" ? req.query.number.trim() : "";
  const refresh = req.query.refresh === "1";

  if (!name || name.length > MAX_FIELD_LEN) {
    res.status(400).json({ error: "name is required and must be ≤ 120 characters" });
    return;
  }
  if (!setName || setName.length > MAX_FIELD_LEN) {
    res.status(400).json({ error: "set is required and must be ≤ 120 characters" });
    return;
  }
  if (!ALLOWED_GAMES.has(game)) {
    res.status(400).json({ error: `game must be one of: ${[...ALLOWED_GAMES].join(", ")}` });
    return;
  }
  if (!number || number.length > 60) {
    res.status(400).json({ error: "number is required and must be ≤ 60 characters" });
    return;
  }

  const cacheKey = `${game}:${name.toLocaleLowerCase()}:${setName.toLocaleLowerCase()}:${number.toLocaleLowerCase()}`;
  if (!refresh) {
    const hit = cachedResponse(cacheKey);
    if (hit) {
      res.json({ ...hit, cached: true });
      return;
    }
  } else {
    gradedCache.delete(cacheKey);
  }

  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = fetchGradePrices(name, setName, game, number)
      .then((response) => {
        if (response.availability === "available") cacheResponse(cacheKey, response);
        return response;
      })
      .finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, pending);
  }

  const response = await pending;
  res.json({ ...response, cached: false });
});

export default router;