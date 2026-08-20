/**
 * Price history routes.
 *
 * GET  /catalog/cards/:id/ebay-sold-history — returns individual completed eBay sales
 * GET  /catalog/cards/:id/price-history   — returns time-series price data from price_snapshots
 * POST /catalog/cards/:id/snapshot-prices  — records current eBay prices as a new snapshot
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { priceSnapshotsTable, wishlistItemsTable } from "@workspace/db";
import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { recordTelemetry } from "../lib/telemetry.js";
import { createNotification } from "./notifications.js";
import { notificationsTable } from "@workspace/db";
import { requireProUser, type AuthRequest } from "../lib/authMiddleware.js";

const router = Router();

// ── Shared eBay helpers (mirrored from gradedPrices.ts) ──────────────────────
// Keeping these local avoids coupling the two route files; values are identical.

const FOREX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
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
      forexRate   = json.rates.AUD;
      forexExpiry = Date.now() + FOREX_CACHE_TTL_MS;
    }
  } catch { /* keep fallback */ }
  return forexRate;
}

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

interface GradeSpec { key: string; ebayTerms: string }
const GRADES: GradeSpec[] = [
  { key: "raw",   ebayTerms: ""        }, // raw: no grade term
  { key: "psa10", ebayTerms: "PSA 10"  },
  { key: "psa9",  ebayTerms: "PSA 9"   },
  { key: "psa8",  ebayTerms: "PSA 8"   },
  { key: "cgc10", ebayTerms: "CGC 10"  },
  { key: "bgs95", ebayTerms: "BGS 9.5" },
  { key: "bgs10", ebayTerms: "BGS 10"  },
];

function buildQuery(name: string, setName: string, game: string, gradeTerms: string): string {
  const gkw = GAME_KEYWORDS[game] ?? "";
  const parts = [`"${name}"`, setName];
  if (gradeTerms) parts.push(gradeTerms);
  if (gkw)        parts.push(gkw);
  return parts.join(" ");
}

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
  // Sanitized integration observability: record only ok/failed, duration,
  // numeric HTTP status, and a fixed operation enum. Never the query or body.
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${ebayFindingUrl(appId)}?${params.toString()}`, { signal });
  } catch (err) {
    void recordTelemetry({
      category: "integration",
      action: "integration.ebay.request",
      status: "failed",
      durationMs: Date.now() - startedAt,
      metadata: { operation: "find_completed_items" },
    });
    throw err;
  }
  void recordTelemetry({
    category: "integration",
    action: "integration.ebay.request",
    status: res.ok ? "ok" : "failed",
    statusCode: res.status,
    durationMs: Date.now() - startedAt,
    metadata: { operation: "find_completed_items" },
  });
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

// ── Snapshot input constraints (mirrors graded-prices route) ─────────────────
const MAX_FIELD_LEN = 120;
const ALLOWED_GAMES = new Set([
  "pokemon", "onepiece", "yugioh", "lorcana", "dragonball", "magic",
]);

// ── Per-IP rate limiting for snapshot endpoint ────────────────────────────────
const SNAPSHOT_RATE_WINDOW = 60_000;   // 1 minute
const SNAPSHOT_RATE_MAX    = 10;        // max snapshot requests per IP per minute

type RateBucket = { count: number; windowStart: number };
const snapshotRateBuckets = new Map<string, RateBucket>();

function isSnapshotRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = snapshotRateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > SNAPSHOT_RATE_WINDOW) {
    snapshotRateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= SNAPSHOT_RATE_MAX) return true;
  bucket.count++;
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - SNAPSHOT_RATE_WINDOW;
  for (const [ip, b] of snapshotRateBuckets) {
    if (b.windowStart < cutoff) snapshotRateBuckets.delete(ip);
  }
}, SNAPSHOT_RATE_WINDOW);

// ── In-flight deduplication for snapshot jobs ─────────────────────────────────
const snapshotInFlight = new Map<string, Promise<void>>();

// How recently a snapshot must have been taken to skip re-recording (24h)
const SNAPSHOT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

// ── Period → days mapping ─────────────────────────────────────────────────────
const PERIOD_DAYS: Record<string, number> = {
  "7d":   7,
  "30d":  30,
  "90d":  90,
  "1y":   365,
  "all":  36500,
};

const DISPLAY_CURRENCIES = new Set(["AUD", "USD", "GBP", "EUR", "CAD", "NZD"]);
const EBAY_HISTORY_RATE_WINDOW = 60_000;
const EBAY_HISTORY_RATE_MAX = 20;
const ebayHistoryRateBuckets = new Map<string, RateBucket>();

type EbayHistoryAvailability =
  | "available"
  | "no_results"
  | "configuration_error"
  | "authorization_error"
  | "permission_error"
  | "upstream_error";
type EbayHistoryCoverage = "returned_results" | "provider_limited";

interface EbaySale {
  title: string;
  endedAt: string;
  condition: string | null;
  priceCents: number;
  price: number;
  currency: string;
  url: string;
}

const GRADED_LISTING_PATTERN = /\b(?:psa|bgs|cgc|sgc|hga|ace|graded|gem\s*mint)\b/i;
const GRADE_TITLE_PATTERNS: Record<string, RegExp> = {
  psa8: /\bpsa\s*8\b/i,
  psa9: /\bpsa\s*9\b/i,
  psa10: /\bpsa\s*10\b/i,
  cgc10: /\bcgc\s*10\b/i,
  bgs95: /\bbgs\s*(?:9[.,]?5|95)\b/i,
  bgs10: /\bbgs\s*10\b/i,
};

function matchesRequestedGrade(title: string, gradeKey: string): boolean {
  if (gradeKey === "raw") return !GRADED_LISTING_PATTERN.test(title);
  return GRADE_TITLE_PATTERNS[gradeKey]?.test(title) ?? false;
}

interface EbayTrendPoint {
  date: string;
  priceCents: number;
  price: number;
  currency: string;
}

interface EbayMovement {
  absolute: number;
  percent: number;
  direction: "up" | "down" | "flat";
}

function isEbayHistoryRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = ebayHistoryRateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > EBAY_HISTORY_RATE_WINDOW) {
    ebayHistoryRateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= EBAY_HISTORY_RATE_MAX) return true;
  bucket.count++;
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - EBAY_HISTORY_RATE_WINDOW;
  for (const [ip, bucket] of ebayHistoryRateBuckets) {
    if (bucket.windowStart < cutoff) ebayHistoryRateBuckets.delete(ip);
  }
}, EBAY_HISTORY_RATE_WINDOW);

function safeEbayListingUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)ebay\.[a-z.]+$/i.test(url.hostname)) return null;
    if (url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function listingString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || null;
  return null;
}

function describeEbayFailure(response: unknown): EbayHistoryAvailability {
  const payload = JSON.stringify(response).toLowerCase();
  if (payload.includes("invalid application") || payload.includes("invalid appid") || payload.includes("authorization")) {
    return "authorization_error";
  }
  if (payload.includes("permission") || payload.includes("access denied")) return "permission_error";
  return "upstream_error";
}

const forexRates = new Map<string, { rate: number; expiresAt: number }>();

async function exchangeRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1;
  const key = `${fromCurrency}:${toCurrency}`;
  const cached = forexRates.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rate;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(toCurrency)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[toCurrency];
    if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
    forexRates.set(key, { rate, expiresAt: Date.now() + FOREX_CACHE_TTL_MS });
    return rate;
  } catch {
    return null;
  }
}

async function normalizeEbaySales(
  items: unknown[],
  displayCurrency: string,
  since: Date,
  gradeKey: string,
): Promise<EbaySale[]> {
  const sales = await Promise.all(items.map(async (item): Promise<EbaySale | null> => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const title = listingString(record.title);
    const url = safeEbayListingUrl(listingString(record.viewItemURL));
    const listingInfo = Array.isArray(record.listingInfo)
      ? record.listingInfo[0] as Record<string, unknown> | undefined
      : undefined;
    const endedAtRaw = listingString(listingInfo?.endTime);
    const endedAt = endedAtRaw ? new Date(endedAtRaw) : null;
    const currentPrice = Array.isArray(record.sellingStatus)
      ? (record.sellingStatus[0] as Record<string, unknown> | undefined)?.currentPrice
      : null;
    const priceRecord = Array.isArray(currentPrice)
      ? currentPrice[0] as Record<string, unknown> | undefined
      : undefined;
    const amount = Number(priceRecord?.["__value__"]);
    const sourceCurrency = typeof priceRecord?.["@currencyId"] === "string"
      ? priceRecord["@currencyId"].toUpperCase()
      : "USD";

    if (!title || !matchesRequestedGrade(title, gradeKey) || !url || !endedAt || Number.isNaN(endedAt.getTime()) || endedAt < since) return null;
    if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(sourceCurrency)) return null;

    const rate = await exchangeRate(sourceCurrency, displayCurrency);
    if (rate == null) return null;
    const price = Math.round(amount * rate * 100) / 100;
    const condition = listingString(record.conditionDisplayName);
    return {
      title: title.slice(0, 240),
      endedAt: endedAt.toISOString(),
      condition: condition?.slice(0, 80) ?? null,
      priceCents: Math.round(price * 100),
      price,
      currency: displayCurrency,
      url,
    };
  }));

  return sales
    .filter((sale): sale is EbaySale => sale !== null)
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
}

function trendFromSales(sales: EbaySale[], currency: string): { points: EbayTrendPoint[]; movement: EbayMovement | null } {
  const daily = new Map<string, number[]>();
  for (const sale of sales) {
    const date = sale.endedAt.slice(0, 10);
    const values = daily.get(date) ?? [];
    values.push(sale.price);
    daily.set(date, values);
  }
  const points = [...daily.entries()]
    .map(([date, prices]) => {
      const price = Math.round((prices.reduce((total, value) => total + value, 0) / prices.length) * 100) / 100;
      return { date, price, priceCents: Math.round(price * 100), currency };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 2) return { points, movement: null };
  const first = points[0]!.price;
  const last = points[points.length - 1]!.price;
  const absolute = Math.round((last - first) * 100) / 100;
  const percent = first === 0 ? 0 : Math.round((absolute / first) * 10_000) / 100;
  return {
    points,
    movement: {
      absolute,
      percent,
      direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat",
    },
  };
}

function ebayHistoryResponse(
  cardId: string,
  gradeKey: string,
  period: string,
  currency: string,
  availability: EbayHistoryAvailability,
  message: string | null,
  sales: EbaySale[] = [],
  coverage: EbayHistoryCoverage = "returned_results",
) {
  const trend = trendFromSales(sales, currency);
  return {
    cardId,
    gradeKey,
    period,
    currency,
    source: "ebay_completed_sales",
    configured: availability !== "configuration_error",
    availability,
    coverage,
    message,
    sales,
    points: trend.points,
    movement: trend.movement,
    returnedAt: new Date().toISOString(),
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /catalog/cards/:id/ebay-sold-history?name=...&set=...&game=pokemon&grade=raw&period=30d&displayCurrency=AUD
 *
 * Fetches recent completed eBay sales on demand. Only normalized listing fields
 * are returned; eBay credentials, raw search queries, seller data, and raw
 * response payloads never leave this service.
 */
router.get("/catalog/cards/:id/ebay-sold-history", requireProUser, async (req: AuthRequest, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (isEbayHistoryRateLimited(ip)) {
    return res.status(429).json({ error: "Too many eBay sold-history requests. Please try again shortly." });
  }

  const cardId = String(req.params.id ?? "").trim();
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const setName = typeof req.query.set === "string" ? req.query.set.trim() : "";
  const game = typeof req.query.game === "string" ? req.query.game.trim().toLowerCase() : "";
  const gradeKey = typeof req.query.grade === "string" ? req.query.grade.trim().toLowerCase() : "raw";
  const period = typeof req.query.period === "string" ? req.query.period.trim().toLowerCase() : "30d";
  const currency = typeof req.query.displayCurrency === "string"
    ? req.query.displayCurrency.trim().toUpperCase()
    : "AUD";

  if (!cardId || cardId.length > 200) return res.status(400).json({ error: "A valid card id is required." });
  if (!name || name.length > MAX_FIELD_LEN) return res.status(400).json({ error: "name is required and must be ≤ 120 characters" });
  if (!setName || setName.length > MAX_FIELD_LEN) return res.status(400).json({ error: "set is required and must be ≤ 120 characters" });
  if (!ALLOWED_GAMES.has(game)) return res.status(400).json({ error: "game must be a supported TCG identifier" });
  if (!GRADES.some((grade) => grade.key === gradeKey)) return res.status(400).json({ error: "grade must be a supported eBay history grade" });
  if (!(period in PERIOD_DAYS)) return res.status(400).json({ error: "period must be 7d, 30d, 90d, 1y, or all" });
  if (!DISPLAY_CURRENCIES.has(currency)) return res.status(400).json({ error: "displayCurrency is not supported" });

  const appId = process.env.EBAY_APP_ID;
  if (!appId || isSandboxId(appId)) {
    return res.json(ebayHistoryResponse(
      cardId, gradeKey, period, currency, "configuration_error",
      "eBay sold history is not configured for this app.",
    ));
  }

  const days = PERIOD_DAYS[period]!;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const grade = GRADES.find((value) => value.key === gradeKey)!;
  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-NAME": "FindingService",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "keywords": buildQuery(name, setName, game, grade.ebayTerms),
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
    "itemFilter(1).name": "EndTimeFrom",
    "itemFilter(1).value": since.toISOString(),
    "sortOrder": "EndTimeSoonest",
    "paginationInput.entriesPerPage": "100",
  });

  const startedAt = Date.now();
  let ebayResponse: Response;
  try {
    ebayResponse = await fetch(`${ebayFindingUrl(appId)}?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    void recordTelemetry({
      category: "integration",
      action: "integration.ebay.request",
      status: "failed",
      durationMs: Date.now() - startedAt,
      metadata: { operation: "find_completed_sales_history" },
    });
    return res.json(ebayHistoryResponse(
      cardId, gradeKey, period, currency, "upstream_error",
      "eBay sold history is temporarily unavailable. Check your connection and try again.",
    ));
  }

  void recordTelemetry({
    category: "integration",
    action: "integration.ebay.request",
    status: ebayResponse.ok ? "ok" : "failed",
    statusCode: ebayResponse.status,
    durationMs: Date.now() - startedAt,
    metadata: { operation: "find_completed_sales_history" },
  });

  if (ebayResponse.status === 401) {
    return res.json(ebayHistoryResponse(cardId, gradeKey, period, currency, "authorization_error", "eBay could not authorize sold-history access."));
  }
  if (ebayResponse.status === 403) {
    return res.json(ebayHistoryResponse(cardId, gradeKey, period, currency, "permission_error", "eBay access does not have permission to read completed sales."));
  }
  if (!ebayResponse.ok) {
    return res.json(ebayHistoryResponse(cardId, gradeKey, period, currency, "upstream_error", "eBay sold history is temporarily unavailable. Please try again."));
  }

  let payload: unknown;
  try {
    payload = await ebayResponse.json();
  } catch {
    return res.json(ebayHistoryResponse(cardId, gradeKey, period, currency, "upstream_error", "eBay returned an unreadable sold-history response."));
  }

  const response = payload && typeof payload === "object"
    ? (payload as { findCompletedItemsResponse?: Array<Record<string, unknown>> }).findCompletedItemsResponse?.[0]
    : undefined;
  if (!response) {
    return res.json(ebayHistoryResponse(
      cardId, gradeKey, period, currency, "upstream_error",
      "eBay sold history is temporarily unavailable. Please try again.",
    ));
  }
  if (listingString(response?.ack) !== "Success") {
    const availability = describeEbayFailure(response);
    return res.json(ebayHistoryResponse(
      cardId,
      gradeKey,
      period,
      currency,
      availability,
      availability === "authorization_error"
        ? "eBay could not authorize sold-history access."
        : availability === "permission_error"
          ? "eBay access does not have permission to read completed sales."
          : "eBay sold history is temporarily unavailable. Please try again.",
    ));
  }

  const searchResult = Array.isArray(response.searchResult)
    ? response.searchResult[0] as Record<string, unknown> | undefined
    : undefined;
  const items = Array.isArray(searchResult?.item) ? searchResult.item : [];
  const sales = await normalizeEbaySales(items, currency, since, gradeKey);
  const pagination = Array.isArray(response.paginationOutput)
    ? response.paginationOutput[0] as Record<string, unknown> | undefined
    : undefined;
  const totalEntries = Number(listingString(pagination?.totalEntries));
  const providerLimited = period === "all" || (Number.isFinite(totalEntries) && totalEntries > items.length);
  if (!sales.length) {
    return res.json(ebayHistoryResponse(
      cardId, gradeKey, period, currency, "no_results",
      providerLimited
        ? "eBay returned a limited set of matching completed sales, so no-results for this range is not definitive."
        : "No matching completed eBay sales were found for this grade and period.",
      [],
      providerLimited ? "provider_limited" : "returned_results",
    ));
  }
  return res.json(ebayHistoryResponse(
    cardId,
    gradeKey,
    period,
    currency,
    "available",
    providerLimited
      ? "eBay returned a limited set of matching completed sales, so this range may not be complete."
      : null,
    sales,
    providerLimited ? "provider_limited" : "returned_results",
  ));
});

/**
 * GET /catalog/cards/:id/price-history?grade=psa10&period=30d
 *
 * Returns aggregated daily price data from price_snapshots for the given card,
 * grade key, and look-back period.  Each data point is the average price on
 * that calendar day (multiple snapshots taken the same day are averaged).
 *
 * Returns { points: [{date, price}], updatedAt, source } with an empty points
 * array when no history exists yet.
 */
router.get("/catalog/cards/:id/price-history", requireProUser, async (req: AuthRequest, res) => {
  try {
    const cardId   = String(req.params.id);
    const gradeKey = typeof req.query.grade === "string" ? req.query.grade.toLowerCase().trim() : "raw";
    const periodRaw = typeof req.query.period === "string" ? req.query.period.toLowerCase().trim() : "30d";
    const days      = PERIOD_DAYS[periodRaw] ?? 30;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Aggregate: average price per calendar day, ordered ascending
    const rows = await db
      .select({
        date:  sql<string>`DATE(${priceSnapshotsTable.recordedAt})::text`,
        price: sql<number>`ROUND(AVG(${priceSnapshotsTable.priceCents}) / 100.0, 2)`,
      })
      .from(priceSnapshotsTable)
      .where(
        and(
          eq(priceSnapshotsTable.cardId, cardId),
          eq(priceSnapshotsTable.gradeKey, gradeKey),
          gte(priceSnapshotsTable.recordedAt, since),
        ),
      )
      .groupBy(sql`DATE(${priceSnapshotsTable.recordedAt})`)
      .orderBy(asc(sql`DATE(${priceSnapshotsTable.recordedAt})`));

    // Most recent snapshot timestamp (across all grades for this card)
    const latestRows = await db
      .select({ recordedAt: priceSnapshotsTable.recordedAt })
      .from(priceSnapshotsTable)
      .where(
        and(
          eq(priceSnapshotsTable.cardId, cardId),
          eq(priceSnapshotsTable.gradeKey, gradeKey),
        ),
      )
      .orderBy(sql`${priceSnapshotsTable.recordedAt} DESC`)
      .limit(1);

    const updatedAt = latestRows[0]?.recordedAt?.toISOString() ?? null;

    return res.json({
      points: rows.map(r => ({ date: r.date, price: Number(r.price) })),
      updatedAt,
       source: "snapshot_median",
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Database error" });
  }
});

/**
 * POST /catalog/cards/:id/snapshot-prices
 * Body: { name: string, set: string, game: string }
 *
 * Records current eBay sold-listing prices for all grades as a new snapshot.
 * Called on-demand when a card detail is first viewed (fire-and-forget from client).
 * Skips if a fresh snapshot was already recorded within the past 24 hours.
 *
 * Security controls:
 *   - Rate-limited to 10 requests per IP per minute
 *   - All string inputs are length-bounded (max 120 chars)
 *   - game must be one of the known allow-listed values
 *   - card_id length is bounded to 200 chars
 *
 * Returns 204 No Content on success, 400/429 on validation error.
 */
router.post("/catalog/cards/:id/snapshot-prices", async (req, res) => {
  // ── Rate limiting (keyed on the direct TCP connection address only;
  //    X-Forwarded-For is NOT used because it is client-controlled and
  //    can be forged to bypass per-IP limits) ──
  const ip = req.socket.remoteAddress ?? "unknown";
  if (isSnapshotRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  }

  const appId = process.env.EBAY_APP_ID;
  if (!appId || isSandboxId(appId)) {
    // eBay not configured — silently accept and discard
    return res.status(204).send();
  }

  // ── Input validation ──
  const cardId  = String(req.params.id).slice(0, 200);
  const name    = typeof req.body?.name === "string" ? req.body.name.trim()  : "";
  const setName = typeof req.body?.set  === "string" ? req.body.set.trim()   : "";
  const game    = typeof req.body?.game === "string" ? req.body.game.trim().toLowerCase() : "pokemon";

  if (!name || name.length > MAX_FIELD_LEN) {
    return res.status(400).json({ error: "name is required and must be ≤ 120 characters" });
  }
  if (!setName || setName.length > MAX_FIELD_LEN) {
    return res.status(400).json({ error: "set is required and must be ≤ 120 characters" });
  }
  if (!ALLOWED_GAMES.has(game)) {
    return res.status(400).json({ error: `game must be one of: ${[...ALLOWED_GAMES].join(", ")}` });
  }
  if (!cardId) {
    return res.status(400).json({ error: "card id is required" });
  }

  // Respond immediately — snapshot runs in background
  res.status(204).send();

  const jobKey = cardId;
  if (snapshotInFlight.has(jobKey)) return undefined;

  const job = (async () => {
    // Check if we already have a fresh snapshot for this card
    const freshCutoff = new Date(Date.now() - SNAPSHOT_FRESHNESS_MS);
    const existing = await db
      .select({ id: priceSnapshotsTable.id })
      .from(priceSnapshotsTable)
      .where(
        and(
          eq(priceSnapshotsTable.cardId, cardId),
          gte(priceSnapshotsTable.recordedAt, freshCutoff),
        ),
      )
      .limit(1);
    if (existing.length > 0) return; // fresh snapshot already exists

    const usdToAud = await getUsdToAud();

    // Fetch prices for all grades in parallel
    const results = await Promise.allSettled(
      GRADES.map(async (g) => {
        const query  = buildQuery(name, setName, game, g.ebayTerms);
        const median = await fetchEbayMedianUsd(appId, query, AbortSignal.timeout(10_000));
        return { key: g.key, median };
      }),
    );

    const inserts = results
      .filter((r): r is PromiseFulfilledResult<{ key: string; median: number | null }> =>
        r.status === "fulfilled" && r.value.median !== null,
      )
      .map((r) => ({
        cardId,
        gradeKey:   r.value.key,
        priceCents: Math.round(r.value.median! * usdToAud * 100),
        currency:   "AUD",
        source:     "ebay_sold",
      }));

    if (inserts.length > 0) {
      await db.insert(priceSnapshotsTable).values(inserts);

      // ── Price-alert trigger ────────────────────────────────────────────────
      // After recording fresh prices, check if any users have a price alert
      // for this card and create a durable notification row for them.
      // Only the "raw" (ungraded) price is used for alert matching, consistent
      // with how the client evaluates alert conditions.
      const rawInsert = inserts.find(i => i.gradeKey === "raw");
      if (rawInsert) {
        const newPriceCents = rawInsert.priceCents;

        // Find all active wishlist items for this card with price alerts enabled
        const alertItems = await db
          .select({
            userId: wishlistItemsTable.userId,
            itemId: wishlistItemsTable.itemId,
            cardData: wishlistItemsTable.cardData,
            targetPrice: wishlistItemsTable.targetPrice,
          })
          .from(wishlistItemsTable)
          .where(
            and(
              eq(wishlistItemsTable.cardId, cardId),
              eq(wishlistItemsTable.priceAlertEnabled, true),
              isNull(wishlistItemsTable.deletedAt),
            ),
          );

        // Deduplicate: suppress a new alert if one was already created within
        // the past 24 hours for the same (user, card) pair. This prevents
        // notification spam when the card stays at or below its target across
        // multiple consecutive snapshots (strict 24-hour throttle per user+card).
        const dedupWindowMs = 24 * 60 * 60 * 1000;
        const dedupCutoff = new Date(Date.now() - dedupWindowMs);

        for (const item of alertItems) {
          if (item.targetPrice == null) continue;

          // Price-drop alert: fire when current price ≤ target
          const conditionMet = newPriceCents <= item.targetPrice;
          if (!conditionMet) continue;

          // Check for a recent existing alert for this user+card to avoid spam
          const recentAlert = await db
            .select({ id: notificationsTable.id })
            .from(notificationsTable)
            .where(
              and(
                eq(notificationsTable.userId, item.userId),
                eq(notificationsTable.type, "price_alert"),
                // metadata->>'cardId' = :cardId
                sql`${notificationsTable.metadata}->>'cardId' = ${cardId}`,
                gt(notificationsTable.createdAt, dedupCutoff),
              ),
            )
            .limit(1);

          if (recentAlert.length > 0) continue; // already notified recently

          const card = item.cardData as { name?: string; setName?: string };
          const cardName = card?.name ?? cardId;
          const setName = card?.setName ?? "";
          const priceAud = (newPriceCents / 100).toLocaleString("en-AU", {
            style: "currency",
            currency: "AUD",
          });
          const targetAud = (item.targetPrice / 100).toLocaleString("en-AU", {
            style: "currency",
            currency: "AUD",
          });

          await createNotification({
            userId: item.userId,
            type: "price_alert",
            title: `Price Alert — ${cardName}`,
            body: `${cardName}${setName ? ` (${setName})` : ""} has dropped to ${priceAud} — at or below your target of ${targetAud}.`,
            metadata: {
              cardId,
              cardName,
              currentPriceCents: newPriceCents,
              targetPriceCents: item.targetPrice,
            },
          }).catch((err: unknown) => {
            logger.error({ err, cardId, userId: item.userId }, "Failed to create price-alert notification");
          });
        }
      }
    }
  })()
    .catch((err: unknown) => {
      logger.error({ err, cardId }, "snapshot-prices background job failed");
    })
    .finally(() => snapshotInFlight.delete(jobKey));

  snapshotInFlight.set(jobKey, job);
  return undefined;
});

export default router;
