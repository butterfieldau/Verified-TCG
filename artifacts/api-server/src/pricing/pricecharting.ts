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
 * IMPORTANT: The PRICECHARTING_API_TOKEN is NEVER logged, persisted in price data,
 * or returned to clients. It is used only as a header/param for outgoing calls.
 */
import { logger } from "../lib/logger.js";
import { GRADE_BY_PC_FIELD, pcPriceToCents } from "./grades.js";
import type { GradeKey } from "./grades.js";
import { extractCardNumber, stripCardNumber, type MatchCandidate } from "./matcher.js";
import type { PricingProviderAdapter } from "./engine.js";

const PC_BASE_URL = "https://www.pricecharting.com/api";
const PC_GUIDE_URL = "https://www.pricecharting.com/price-guide/download-custom";
const PC_CURRENCY = "USD";

/** A provider failure which callers may safely classify without inspecting text. */
export class PriceChartingError extends Error {
  constructor(
    message: string,
    public readonly kind: "authentication" | "throttled" | "transient",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PriceChartingError";
  }
}
export class PriceChartingAuthenticationError extends PriceChartingError {
  constructor(status?: number) { super("PriceCharting authentication failed", "authentication", status); }
}
export class PriceChartingThrottleError extends PriceChartingError {
  constructor(public readonly retryAfterMs = 0, status?: number) { super("PriceCharting request was throttled", "throttled", status); }
}
export class PriceChartingTransientError extends PriceChartingError {
  constructor(status?: number) { super("PriceCharting is temporarily unavailable", "transient", status); }
}

// ── Rate-limiting queue (1 req/sec) ──────────────────────────────────────────

const RATE_INTERVAL_MS = 1_100; // slightly over 1 second to be safe
const MAX_QUEUED_REQUESTS = 500;
let lastCallAt = 0;
let rateChain: Promise<void> = Promise.resolve();
let queuedRequests = 0;
let deprecatedTokenWarningLogged = false;

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
  "condition-19-price"?: number | string;
  "condition-20-price"?: number | string;
  "condition-17-price"?: number | string;
  "condition-18-price"?: number | string;
  "condition-21-price"?: number | string;
  "condition-22-price"?: number | string;
  "epid"?: string;
}

export interface PCSearchResult {
  products?: PCProduct[];
  status?: string;
}

export interface PCProductLookup {
  id?: string;
  upc?: string;
  q?: string;
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
    throw new PriceChartingTransientError();
  }
  // 5xx = server error → retry
  if (res.status >= 500 && attempt < MAX_RETRIES) {
    const retryAfterMs = Number(res.headers.get("retry-after") ?? "0") * 1_000;
    const delay = Math.max(RATE_INTERVAL_MS, retryAfterMs, RETRY_BASE_MS * (attempt + 1));
    logger.warn({ status: res.status, attempt, delay }, "PC fetch server error, retrying");
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) throw new PriceChartingAuthenticationError(res.status);
  if (res.status === 429) throw new PriceChartingThrottleError(Number(res.headers.get("retry-after") ?? "0") * 1_000, res.status);
  if (res.status >= 400) {
    const body = await res.clone().text().catch(() => "");
    if (/unknown\s+access\s+token|invalid\s+(?:api\s+)?token/i.test(body)) {
      throw new PriceChartingAuthenticationError(res.status);
    }
  }
  // Other 4xx responses are a non-retriable provider failure.
  if (res.status >= 400) throw new PriceChartingTransientError(res.status);
  return res;
}

// ── Public API ───────────────────────────────────────────────────────────────

function getToken(): string | null {
  const canonical = process.env.PRICECHARTING_API_TOKEN?.trim();
  if (canonical) return canonical;
  // Keep the original name as a backwards-compatible deployment fallback,
  // but never require it for new deployments.
  const deprecated = process.env.PRICECHARTING_TOKEN?.trim();
  if (deprecated) {
    if (!deprecatedTokenWarningLogged) {
      deprecatedTokenWarningLogged = true;
      logger.warn("PRICECHARTING_TOKEN is deprecated; configure PRICECHARTING_API_TOKEN");
    }
    return deprecated;
  }
  return null;
}

/** Check if PriceCharting is configured. */
export function isPCConfigured(): boolean {
  return !!getToken();
}

/**
 * Search PriceCharting for products matching a query.
 * Returns null when unconfigured. Provider failures are typed
 * PriceChartingError instances so orchestration can distinguish auth,
 * throttling, and transient outages.
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
      const res = await fetchWithRetry(url);
      let json: PCSearchResult;
      try { json = (await res.json()) as PCSearchResult; }
      catch { throw new PriceChartingTransientError(res.status); }
      if (!json || typeof json !== "object" || (json.products != null && !Array.isArray(json.products))) {
        throw new PriceChartingTransientError(res.status);
      }
      if (json.status && json.status.toLowerCase() !== "success") throw new PriceChartingTransientError();
      const products = json.products ?? [];
      cacheSet(cacheKey, products);
      return products;
  }) as Promise<PCProduct[] | null>;
}

/**
 * Fetch a single product detail by PriceCharting product ID.
 * Returns null when unconfigured; provider failures are typed.
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
      const res = await fetchWithRetry(url);
      let json: PCProductDetail;
      try { json = (await res.json()) as PCProductDetail; }
      catch { throw new PriceChartingTransientError(res.status); }
      if (!json || typeof json !== "object" || json.id == null
        || typeof json["product-name"] !== "string" || typeof json["console-name"] !== "string") {
        throw new PriceChartingTransientError(res.status);
      }
      const providerStatus = (json as unknown as { status?: string }).status;
      if (providerStatus && providerStatus.toLowerCase() !== "success") throw new PriceChartingTransientError();
      cacheSet(cacheKey, json);
      return json;
  }) as Promise<PCProductDetail | null>;
}

/**
 * Resolve one product through the documented /api/product lookup modes.
 * Search workflows must use searchProducts() so they can evaluate candidates;
 * this helper is for an already-selected id, UPC lookup, or explicit admin
 * query only.
 */
export async function getProductByLookup(
  lookup: PCProductLookup,
  options: { bypassCache?: boolean } = {},
): Promise<PCProductDetail | null> {
  const key = lookup.id ?? lookup.upc ?? lookup.q;
  if (!key || (lookup.id ? 1 : 0) + (lookup.upc ? 1 : 0) + (lookup.q ? 1 : 0) !== 1) return null;
  if (lookup.id) return getProductDetail(lookup.id, options);

  const token = getToken();
  if (!token) return null;
  const lookupType = lookup.upc ? "upc" : "q";
  const cacheKey = `product:${lookupType}:${key.toLowerCase()}`;
  if (!options.bypassCache) {
    const cached = cacheGet<PCProductDetail>(cacheKey);
    if (cached) return cached;
  }

  return deduped(cacheKey, async () => {
    const value = lookup.upc ?? lookup.q!;
    const url = `${PC_BASE_URL}/product?t=${token}&${lookupType}=${encodeURIComponent(value)}`;
    logger.debug({ lookupType }, "PC product lookup request");
    const res = await fetchWithRetry(url);
    let json: PCProductDetail;
    try { json = (await res.json()) as PCProductDetail; }
    catch { throw new PriceChartingTransientError(res.status); }
    if (!json || typeof json !== "object" || json.id == null
      || typeof json["product-name"] !== "string" || typeof json["console-name"] !== "string") {
      throw new PriceChartingTransientError(res.status);
    }
    const providerStatus = (json as unknown as { status?: string }).status;
    if (providerStatus && providerStatus.toLowerCase() !== "success") throw new PriceChartingTransientError();
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

/** Parse a decimal USD value without a floating-point conversion. */
export function usdDecimalToCents(value: unknown): number | null {
  const source = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(source);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const result = dollars * 100 + cents;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export const PRICECHARTING_GUIDE_CATEGORIES = {
  pokemon: "pokemon-cards",
  magic: "magic-cards",
  yugioh: "yugioh-cards",
  one_piece: "one-piece-cards",
} as const;
export type PriceChartingGuideCategory = keyof typeof PRICECHARTING_GUIDE_CATEGORIES;
export interface PCGuideRow extends PCProductDetail {}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted && c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ",") { rows[rows.length - 1]!.push(field); field = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      rows[rows.length - 1]!.push(field); field = ""; rows.push([]);
    } else field += c;
  }
  if (field || rows[rows.length - 1]!.length) rows[rows.length - 1]!.push(field);
  return rows.filter(row => row.some(value => value.trim()));
}

/** Decode the documented bulk guide CSV into the same provider detail shape as API data. */
export function parsePriceChartingGuideCsv(csv: string): PCGuideRow[] {
  const [header, ...records] = parseCsv(csv);
  if (!header) return [];
  const headers = header.map(value => value.trim().toLowerCase());
  return records.flatMap(record => {
    const row = Object.fromEntries(headers.map((key, index) => [key, record[index]?.trim() ?? ""]));
    const id = row["id"] ?? row["product-id"];
    const productName = row["product-name"] ?? row["product_name"];
    const consoleName = row["console-name"] ?? row["console_name"];
    if (!id || !productName || !consoleName) return [];
    const detail: PCGuideRow = { id, "product-name": productName, "console-name": consoleName };
    for (const [field] of GRADE_BY_PC_FIELD) {
      const cents = usdDecimalToCents(row[field] ?? row[field.replaceAll("-", "_")]);
      if (cents != null) (detail as unknown as Record<string, unknown>)[field] = cents;
    }
    return [detail];
  });
}

/** Performs exactly one CSV request; durable callers must acquire an import lease first. */
export async function downloadBulkGuide(category: PriceChartingGuideCategory): Promise<PCGuideRow[]> {
  const token = getToken();
  if (!token) throw new PriceChartingAuthenticationError();
  const providerCategory = PRICECHARTING_GUIDE_CATEGORIES[category];
  let response: Response;
  try {
    response = await fetch(`${PC_GUIDE_URL}?t=${encodeURIComponent(token)}&category=${encodeURIComponent(providerCategory)}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  } catch { throw new PriceChartingTransientError(); }
  if (response.status === 401 || response.status === 403) throw new PriceChartingAuthenticationError(response.status);
  if (response.status === 429) throw new PriceChartingThrottleError(Number(response.headers.get("retry-after") ?? "0") * 1_000, response.status);
  const body = await response.text().catch(() => { throw new PriceChartingTransientError(); });
  if (/unknown\s+access\s+token|invalid\s+(?:api\s+)?token/i.test(body)) throw new PriceChartingAuthenticationError(response.status);
  if (!response.ok) throw new PriceChartingTransientError(response.status);
  try {
    const rows = parsePriceChartingGuideCsv(body);
    if (rows.length === 0) throw new Error("empty");
    return rows;
  } catch { throw new PriceChartingTransientError(response.status); }
}
export const getBulkGuide = downloadBulkGuide;

export interface NormalizedPriceChartingProduct {
  provider: "pricecharting";
  providerProductId: string;
  currency: typeof PC_CURRENCY;
  prices: Map<GradeKey, number>;
  metadata: {
    productName: string;
    consoleName: string;
    genre: string | null;
    releaseDate: string | null;
    upc: string | null;
    epid: string | null;
    salesVolume: number | string | null;
  };
  fetchedAt: Date;
}

/** Provider-specific field names stop here. */
export function normalizeProduct(detail: PCProductDetail, fetchedAt = new Date()): NormalizedPriceChartingProduct {
  return {
    provider: "pricecharting",
    providerProductId: String(detail.id),
    currency: PC_CURRENCY,
    prices: extractPrices(detail),
    metadata: {
      productName: detail["product-name"],
      consoleName: detail["console-name"],
      genre: detail.genre == null ? null : String(detail.genre),
      releaseDate: detail["release-date"] == null ? null : String(detail["release-date"]),
      upc: detail.upc == null ? null : String(detail.upc),
      epid: detail.epid == null ? null : String(detail.epid),
      salesVolume: detail["sales-volume"] == null ? null : detail["sales-volume"],
    },
    fetchedAt,
  };
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
