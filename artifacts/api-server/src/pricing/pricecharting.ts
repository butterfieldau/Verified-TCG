/**
 * PriceCharting API adapter.
 *
 * Official documented endpoints:
 *   Search: GET https://www.pricecharting.com/api/products?t=TOKEN&q=QUERY
 *   Product: GET https://www.pricecharting.com/api/product?t=TOKEN&id=PRODUCT_ID
 *
 * Official rate limit: 1 request per second.
 * Provider currency: USD.
 *
 * IMPORTANT: The PRICECHARTING_TOKEN is NEVER logged, persisted in price data,
 * or returned to clients. It is used only as a header/param for outgoing calls.
 */
import { logger } from "../lib/logger.js";
import { GRADE_BY_PC_FIELD, pcPriceToCents } from "./grades.js";
import type { GradeKey } from "./grades.js";
import { extractCardNumber, stripCardNumber, type MatchCandidate } from "./matcher.js";
import type { PricingProviderAdapter } from "./engine.js";

const PC_BASE_URL = "https://www.pricecharting.com/api";
const PC_CURRENCY = "USD";

// ── Rate-limiting queue (1 req/sec) ──────────────────────────────────────────

const RATE_INTERVAL_MS = 1_100; // slightly over 1 second to be safe
const MAX_QUEUED_REQUESTS = 500;
let lastCallAt = 0;
let rateChain: Promise<void> = Promise.resolve();
let queuedRequests = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Enqueue a call to respect the 1 req/sec limit. */
function enqueueRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  if (queuedRequests >= MAX_QUEUED_REQUESTS) {
    return Promise.reject(new Error("PriceCharting request queue is full"));
  }
  queuedRequests += 1;

  const run = async (): Promise<T> => {
    const elapsed = Date.now() - lastCallAt;
    const delay = Math.max(0, RATE_INTERVAL_MS - elapsed);
    if (delay > 0) await sleep(delay);
    lastCallAt = Date.now();
    return fn();
  };

  const result = rateChain.then(run, run);
  rateChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result.finally(() => {
    queuedRequests = Math.max(0, queuedRequests - 1);
  });
}

// ── In-flight deduplication ──────────────────────────────────────────────────

const inFlight = new Map<string, Promise<unknown>>();

function deduped<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ── Bounded response cache ───────────────────────────────────────────────────

const CACHE_TTL_MS  = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_MAX     = 2_000;

interface CacheEntry<T> { value: T; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const e = cache.get(key) as CacheEntry<T> | undefined;
  if (!e) return undefined;
  if (e.expiresAt <= Date.now()) { cache.delete(key); return undefined; }
  return e.value;
}

function cacheSet<T>(key: string, value: T): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── API types ────────────────────────────────────────────────────────────────

export interface PCProduct {
  id: string | number;
  "product-name": string;
  "console-name": string;
  /** May be present for card products */
  "genre"?: string;
}

export interface PCProductDetail extends PCProduct {
  "sales-volume"?: number | string;
  "release-date"?: string;
  "upc"?: string;
  "loose-price"?:       number | string;
  "cib-price"?:         number | string;
  "new-price"?:         number | string;
  "graded-price"?:      number | string;
  "box-only-price"?:    number | string;
  "manual-only-price"?: number | string;
  "bgs-10-price"?:      number | string;
  "condition-17-price"?: number | string;
  "condition-18-price"?: number | string;
}

export interface PCSearchResult {
  products?: PCProduct[];
  status?: string;
}

// ── Timeout + retry helpers ──────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

async function fetchWithRetry(
  url: string,
  attempt = 0,
): Promise<Response> {
  let res: Response;
  try {
    res = await enqueueRateLimited(() => {
      // Start the timeout only when this request reaches the front of the
      // provider queue. Time spent waiting behind other calls must not consume
      // the network timeout budget.
      const signal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      return fetch(url, { signal });
    });
  } catch (err) {
    // Transient: network error, timeout
    if (attempt < MAX_RETRIES) {
      const delay = Math.max(RATE_INTERVAL_MS, RETRY_BASE_MS * (attempt + 1));
      logger.warn({ url: url.replace(/t=[^&]+/, "t=REDACTED"), attempt, delay }, "PC fetch transient error, retrying");
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, attempt + 1);
    }
    throw err;
  }
  // 5xx = server error → retry
  if (res.status >= 500 && attempt < MAX_RETRIES) {
    const retryAfterMs = Number(res.headers.get("retry-after") ?? "0") * 1_000;
    const delay = Math.max(RATE_INTERVAL_MS, retryAfterMs, RETRY_BASE_MS * (attempt + 1));
    logger.warn({ status: res.status, attempt, delay }, "PC fetch server error, retrying");
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, attempt + 1);
  }
  // 4xx = client error → do not retry
  return res;
}

// ── Public API ───────────────────────────────────────────────────────────────

function getToken(): string | null {
  return process.env.PRICECHARTING_TOKEN ?? null;
}

/** Check if PriceCharting is configured. */
export function isPCConfigured(): boolean {
  return !!getToken();
}

/**
 * Search PriceCharting for products matching a query.
 * Returns null if unconfigured or on error.
 */
export async function searchProducts(query: string): Promise<PCProduct[] | null> {
  const token = getToken();
  if (!token) return null;

  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = cacheGet<PCProduct[]>(cacheKey);
  if (cached) return cached;

  return deduped(cacheKey, async () => {
      const url = `${PC_BASE_URL}/products?t=${token}&q=${encodeURIComponent(query)}`;
      // Never log the URL with token
      logger.debug({ q: query }, "PC search request");
      let res: Response;
      try {
        res = await fetchWithRetry(url);
      } catch (err) {
        logger.error({ err }, "PC search network error");
        return null;
      }
      if (!res.ok) {
        logger.warn({ status: res.status }, "PC search non-200 response");
        return null;
      }
      const json = (await res.json()) as PCSearchResult;
      if (json.status && json.status.toLowerCase() !== "success") {
        logger.warn({ status: json.status }, "PC search returned provider error status");
        return null;
      }
      const products = json.products ?? [];
      cacheSet(cacheKey, products);
      return products;
  }) as Promise<PCProduct[] | null>;
}

/**
 * Fetch a single product detail by PriceCharting product ID.
 * Returns null if unconfigured or on error.
 */
export async function getProductDetail(
  productId: string,
  options: { bypassCache?: boolean } = {},
): Promise<PCProductDetail | null> {
  const token = getToken();
  if (!token) return null;

  const cacheKey = `product:${productId}`;
  if (!options.bypassCache) {
    const cached = cacheGet<PCProductDetail>(cacheKey);
    if (cached) return cached;
  }

  return deduped(cacheKey, async () => {
      const url = `${PC_BASE_URL}/product?t=${token}&id=${encodeURIComponent(productId)}`;
      logger.debug({ productId }, "PC product detail request");
      let res: Response;
      try {
        res = await fetchWithRetry(url);
      } catch (err) {
        logger.error({ err, productId }, "PC product detail network error");
        return null;
      }
      if (!res.ok) {
        logger.warn({ status: res.status, productId }, "PC product detail non-200 response");
        return null;
      }
      const json = (await res.json()) as PCProductDetail;
      const providerStatus = (json as unknown as { status?: string }).status;
      if (providerStatus && providerStatus.toLowerCase() !== "success") {
        logger.warn({ status: providerStatus, productId }, "PC product returned provider error status");
        return null;
      }
      cacheSet(cacheKey, json);
      return json;
  }) as Promise<PCProductDetail | null>;
}

/**
 * Extract all grade prices from a PCProductDetail into a map.
 * Values are in USD cents (integer).
 */
export function extractPrices(detail: PCProductDetail): Map<GradeKey, number> {
  const result = new Map<GradeKey, number>();
  const detailAsRecord = detail as unknown as Record<string, unknown>;
  for (const [field, def] of GRADE_BY_PC_FIELD) {
    const raw = detailAsRecord[field];
    const cents = pcPriceToCents(raw);
    if (cents != null) {
      result.set(def.key, cents);
    }
  }
  return result;
}

/** The provider key used in the database. */
export const PROVIDER_KEY = "pricecharting";
export const PROVIDER_LABEL = "PriceCharting";
export { PC_CURRENCY };

/** Convert a PCProduct to a MatchCandidate. */
export function toMatchCandidate(p: PCProduct): MatchCandidate {
  const productName = p["product-name"];
  return {
    id: String(p.id),
    name: stripCardNumber(productName),
    consoleName: p["console-name"],
    cardNumber: extractCardNumber(productName),
    genre: p["genre"],
  };
}

/** Provider-neutral adapter consumed by the pricing orchestration layer. */
export const priceChartingProvider: PricingProviderAdapter<PCProduct, PCProductDetail> = {
  key: PROVIDER_KEY,
  label: PROVIDER_LABEL,
  currency: PC_CURRENCY,
  isConfigured: isPCConfigured,
  searchProducts,
  getProductDetail,
  normalizeQuotes: extractPrices,
  toMatchCandidate,
};

/** Clear the in-memory cache (for testing). */
export function clearPCCache(): void {
  cache.clear();
}

/** Drain any pending rate-limit queue items immediately (for testing). */
export function resetRateLimiter(): void {
  lastCallAt = 0;
  rateChain = Promise.resolve();
  queuedRequests = 0;
}
