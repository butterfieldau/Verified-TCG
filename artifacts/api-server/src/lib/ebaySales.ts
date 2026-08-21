import { recordTelemetry } from "./telemetry.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;
const FOREX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_COMPLETED_SALES = 200;
const EBAY_OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

export type EbaySalesAvailability =
  | "available"
  | "no_results"
  | "configuration_error"
  | "authorization_error"
  | "permission_error"
  | "conversion_error"
  | "upstream_error";

export interface EbayGradeSpec {
  key: "raw" | "psa8" | "psa9" | "psa10" | "cgc10" | "bgs95" | "bgs10";
  searchTerms: string;
}

export const EBAY_GRADE_SPECS: EbayGradeSpec[] = [
  { key: "raw", searchTerms: "" },
  { key: "psa8", searchTerms: "PSA 8" },
  { key: "psa9", searchTerms: "PSA 9" },
  { key: "psa10", searchTerms: "PSA 10" },
  { key: "cgc10", searchTerms: "CGC 10" },
  { key: "bgs95", searchTerms: "BGS 9.5" },
  { key: "bgs10", searchTerms: "BGS 10" },
];

export type EbayGradeKey = EbayGradeSpec["key"];

export interface EbayCompletedSale {
  title: string;
  endedAt: string;
  condition: string | null;
  /** The completed price returned by eBay before display-currency conversion. */
  sourcePrice: number;
  sourceCurrency: string;
  priceCents: number;
  price: number;
  currency: string;
  url: string;
}

export interface CompletedSalesRequest {
  name: string;
  setName: string;
  game: string;
  number: string;
  gradeKey: EbayGradeKey;
  since: Date;
  displayCurrency: string;
  limit?: number;
}

export interface CompletedSalesResult {
  availability: EbaySalesAvailability;
  message: string | null;
  sales: EbayCompletedSale[];
  coverage: "returned_results" | "provider_limited";
}

interface EbaySalesConfig {
  clientId: string;
  clientSecret: string;
  environment: "production" | "sandbox";
  marketplaceId: string;
}

interface CachedToken {
  clientId: string;
  value: string;
  expiresAt: number;
}

interface CachedForexRate {
  value: number;
  expiresAt: number;
}

interface ProviderSale {
  title: string;
  endedAt: Date;
  condition: string | null;
  sourcePrice: number;
  sourceCurrency: string;
  url: string;
}

class EbayOauthError extends Error {
  constructor(readonly availability: Extract<EbaySalesAvailability, "authorization_error" | "permission_error" | "upstream_error">) {
    super("eBay OAuth token request failed");
  }
}

const tokenCache = new Map<string, CachedToken>();
const tokenInFlight = new Map<string, Promise<string>>();
const forexCache = new Map<string, CachedForexRate>();

const GAME_KEYWORDS: Record<string, string> = {
  pokemon: "Pokemon",
  onepiece: "One Piece",
  yugioh: "Yu-Gi-Oh",
  lorcana: "Lorcana",
  dragonball: "Dragon Ball",
  magic: "Magic",
};

const GRADED_LISTING_PATTERN = /\b(?:psa|bgs|cgc|sgc|hga|ace|graded|gem\s*mint)\b/i;
const GRADE_TITLE_PATTERNS: Record<Exclude<EbayGradeKey, "raw">, RegExp> = {
  psa8: /\bpsa\s*8\b/i,
  psa9: /\bpsa\s*9\b/i,
  psa10: /\bpsa\s*10\b/i,
  cgc10: /\bcgc\s*10\b/i,
  bgs95: /\bbgs\s*(?:9[.,]?5|95)\b/i,
  bgs10: /\bbgs\s*10\b/i,
};

function configFromEnv(): { config?: EbaySalesConfig; missing: string[] } {
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const environment = (process.env.EBAY_ENVIRONMENT ?? "production").trim().toLowerCase();
  const missing: string[] = [];

  if (!clientId) missing.push("EBAY_CLIENT_ID");
  if (!clientSecret) missing.push("EBAY_CLIENT_SECRET");
  if (environment !== "production" && environment !== "sandbox") missing.push("EBAY_ENVIRONMENT");

  if (
    missing.length > 0 ||
    !clientId ||
    !clientSecret ||
    (environment !== "production" && environment !== "sandbox")
  ) {
    return { missing };
  }

  return {
    config: {
      clientId,
      clientSecret,
      environment,
      marketplaceId: (process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US").trim() || "EBAY_US",
    },
    missing: [],
  };
}

function apiBase(environment: EbaySalesConfig["environment"]): string {
  return environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function safeString(value: unknown, maxLength = 240): string | null {
  return typeof value === "string" && value.trim() && value.length <= maxLength
    ? value.trim()
    : null;
}

function safeEbayListingUrl(value: unknown): string | null {
  const candidate = safeString(value, 2_000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)ebay\.[a-z.]+$/i.test(url.hostname) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeForMatch(value: string): string[] {
  return value
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

function normalizedCardNumber(value: string): string | null {
  const normalized = value
    .toLocaleUpperCase("en-US")
    .normalize("NFKD")
    .replace(/\s+/g, "")
    .replace(/^#/, "");
  return /^[A-Z0-9]+(?:\/[A-Z0-9]+)?$/.test(normalized) ? normalized : null;
}

function titleContainsExactCardNumber(title: string, cardNumber: string): boolean {
  const expected = normalizedCardNumber(cardNumber);
  if (!expected) return false;
  const normalizedTitle = title
    .toLocaleUpperCase("en-US")
    .normalize("NFKD")
    .replace(/\s+/g, " ");
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(normalizedTitle);
}

function titleMatchesCard(title: string, name: string, setName: string, number: string): boolean {
  const titleWords = new Set(normalizeForMatch(title));
  const nameWords = normalizeForMatch(name);
  const setWords = normalizeForMatch(setName);
  return (
    nameWords.length > 0 &&
    setWords.length > 0 &&
    nameWords.every((word) => titleWords.has(word)) &&
    setWords.every((word) => titleWords.has(word)) &&
    titleContainsExactCardNumber(title, number)
  );
}

function titleMatchesGrade(title: string, gradeKey: EbayGradeKey): boolean {
  if (gradeKey === "raw") return !GRADED_LISTING_PATTERN.test(title);
  return GRADE_TITLE_PATTERNS[gradeKey].test(title);
}

function buildSearchQuery(request: CompletedSalesRequest): string {
  const grade = EBAY_GRADE_SPECS.find((entry) => entry.key === request.gradeKey);
  const game = GAME_KEYWORDS[request.game] ?? "";
  return [request.name, request.setName, request.number, game, grade?.searchTerms ?? ""]
    .filter(Boolean)
    .join(" ");
}

function providerFailure(status: number): Pick<CompletedSalesResult, "availability" | "message"> {
  if (status === 401) {
    return {
      availability: "authorization_error",
      message: "eBay could not authorize completed-sales access.",
    };
  }
  if (status === 403) {
    return {
      availability: "permission_error",
      message: "eBay access does not have permission to read completed sales.",
    };
  }
  return {
    availability: "upstream_error",
    message: "eBay completed sales are temporarily unavailable. Please try again.",
  };
}

function telemetry(operation: string, status: "ok" | "failed", startedAt: number, statusCode?: number): void {
  void recordTelemetry({
    category: "integration",
    action: "integration.ebay.completed_sales",
    status,
    ...(statusCode == null ? {} : { statusCode }),
    durationMs: Date.now() - startedAt,
    metadata: { operation },
  });
}

async function applicationAccessToken(config: EbaySalesConfig): Promise<string> {
  const cacheKey = `${config.environment}:${config.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) return cached.value;

  const pending = tokenInFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${apiBase(config.environment)}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPE)}`,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      telemetry("oauth_client_credentials", "failed", startedAt);
      throw new EbayOauthError("upstream_error");
    }

    telemetry("oauth_client_credentials", response.ok ? "ok" : "failed", startedAt, response.status);
    if (!response.ok) {
      throw new EbayOauthError(
        response.status === 401 || response.status === 400
          ? "authorization_error"
          : response.status === 403
            ? "permission_error"
            : "upstream_error",
      );
    }

    const payload = (await response.json()) as unknown;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).access_token !== "string"
    ) {
      throw new EbayOauthError("upstream_error");
    }
    const expiresIn = (payload as Record<string, unknown>).expires_in;
    const ttlSeconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 300;
    const value = (payload as Record<string, unknown>).access_token as string;
    tokenCache.set(cacheKey, {
      clientId: config.clientId,
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
    return value;
  })().finally(() => tokenInFlight.delete(cacheKey));

  tokenInFlight.set(cacheKey, request);
  return request;
}

async function exchangeRate(fromCurrency: string, toCurrency: string): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1;
  const cacheKey = `${fromCurrency}:${toCurrency}`;
  const cached = forexCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCurrency)}&to=${encodeURIComponent(toCurrency)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { rates?: Record<string, number> };
    const value = payload.rates?.[toCurrency];
    if (!value || !Number.isFinite(value) || value <= 0) return null;
    forexCache.set(cacheKey, { value, expiresAt: Date.now() + FOREX_CACHE_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

function readProviderSales(payload: unknown, request: CompletedSalesRequest): ProviderSale[] | null {
  if (!payload || typeof payload !== "object") return null;
  const itemSales = (payload as Record<string, unknown>).itemSales;
  if (!Array.isArray(itemSales)) return null;

  const minimumDate = request.since.getTime();
  return itemSales.flatMap((item): ProviderSale[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = safeString(record.title);
    const url = safeEbayListingUrl(record.itemWebUrl);
    const endedAtValue = safeString(record.lastSoldDate, 100);
    const endedAt = endedAtValue ? new Date(endedAtValue) : null;
    const price = record.price && typeof record.price === "object"
      ? record.price as Record<string, unknown>
      : undefined;
    const sourcePrice = Number(price?.value);
    const sourceCurrency = safeString(price?.currency, 3)?.toUpperCase();
    const condition = safeString(record.condition, 80);

    if (
      !title ||
      !url ||
      !endedAt ||
      Number.isNaN(endedAt.getTime()) ||
      endedAt.getTime() < minimumDate ||
      !titleMatchesCard(title, request.name, request.setName, request.number) ||
      !titleMatchesGrade(title, request.gradeKey) ||
      !Number.isFinite(sourcePrice) ||
      sourcePrice <= 0 ||
      !sourceCurrency ||
      !/^[A-Z]{3}$/.test(sourceCurrency)
    ) {
      return [];
    }

    return [{
      title: title.slice(0, 240),
      endedAt,
      condition: condition?.slice(0, 80) ?? null,
      sourcePrice,
      sourceCurrency,
      url,
    }];
  });
}

function providerCoverage(payload: unknown, returnedCount: number, limit: number): "returned_results" | "provider_limited" {
  if (!payload || typeof payload !== "object") return "returned_results";
  const total = Number((payload as Record<string, unknown>).total);
  return Number.isFinite(total) && total > Math.max(returnedCount, limit)
    ? "provider_limited"
    : "returned_results";
}

/**
 * Fetches supported eBay Marketplace Insights completed sales. This is the
 * only completed-sales integration boundary; callers receive normalized,
 * title-matched evidence and never see provider payloads or search terms.
 */
export async function getEbayCompletedSales(request: CompletedSalesRequest): Promise<CompletedSalesResult> {
  const configured = configFromEnv();
  if (!configured.config) {
    return {
      availability: "configuration_error",
      message: "eBay completed-sales credentials are not configured for this app.",
      sales: [],
      coverage: "returned_results",
    };
  }

  let token: string;
  try {
    token = await applicationAccessToken(configured.config);
  } catch (error) {
    return {
      availability: error instanceof EbayOauthError ? error.availability : "upstream_error",
      message: error instanceof EbayOauthError && error.availability === "authorization_error"
        ? "eBay could not authorize completed-sales access."
        : error instanceof EbayOauthError && error.availability === "permission_error"
          ? "eBay access does not have permission to read completed sales."
          : "eBay completed sales are temporarily unavailable. Please try again.",
      sales: [],
      coverage: "returned_results",
    };
  }

  const limit = Math.max(1, Math.min(request.limit ?? MAX_COMPLETED_SALES, MAX_COMPLETED_SALES));
  const params = new URLSearchParams({
    q: buildSearchQuery(request),
    limit: String(limit),
    sort: "-lastSoldDate",
  });
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      `${apiBase(configured.config.environment)}/buy/marketplace_insights/v1_beta/item_sales?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": configured.config.marketplaceId,
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
  } catch {
    telemetry("marketplace_insights_item_sales", "failed", startedAt);
    return {
      availability: "upstream_error",
      message: "eBay completed sales are temporarily unavailable. Please try again.",
      sales: [],
      coverage: "returned_results",
    };
  }

  telemetry("marketplace_insights_item_sales", response.ok ? "ok" : "failed", startedAt, response.status);
  if (!response.ok) {
    const failure = providerFailure(response.status);
    return { ...failure, sales: [], coverage: "returned_results" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      availability: "upstream_error",
      message: "eBay returned an unreadable completed-sales response.",
      sales: [],
      coverage: "returned_results",
    };
  }

  const providerSales = readProviderSales(payload, request);
  const coverage = providerCoverage(payload, Array.isArray((payload as Record<string, unknown>)?.itemSales)
    ? ((payload as Record<string, unknown>).itemSales as unknown[]).length
    : 0, limit);
  if (providerSales === null) {
    return {
      availability: "upstream_error",
      message: "eBay returned an unreadable completed-sales response.",
      sales: [],
      coverage,
    };
  }
  if (providerSales.length === 0) {
    return {
      availability: "no_results",
      message: coverage === "provider_limited"
        ? "eBay returned a limited set of completed sales, so no-results for this range is not definitive."
        : "No matching completed eBay sales were found for this grade and period.",
      sales: [],
      coverage,
    };
  }

  const rates = await Promise.all(
    [...new Set(providerSales.map((sale) => sale.sourceCurrency))].map(async (currency) => [
      currency,
      await exchangeRate(currency, request.displayCurrency),
    ] as const),
  );
  const rateByCurrency = new Map(rates);
  const sales = providerSales.flatMap((sale): EbayCompletedSale[] => {
    const rate = rateByCurrency.get(sale.sourceCurrency);
    if (rate == null) return [];
    const price = Math.round(sale.sourcePrice * rate * 100) / 100;
    return [{
      title: sale.title,
      endedAt: sale.endedAt.toISOString(),
      condition: sale.condition,
      sourcePrice: sale.sourcePrice,
      sourceCurrency: sale.sourceCurrency,
      priceCents: Math.round(price * 100),
      price,
      currency: request.displayCurrency,
      url: sale.url,
    }];
  }).sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());

  if (sales.length === 0) {
    return {
      availability: "conversion_error",
      message: `Completed sales were found, but they could not be converted to ${request.displayCurrency}. Please try again.`,
      sales: [],
      coverage,
    };
  }

  return {
    availability: "available",
    message: coverage === "provider_limited"
      ? "eBay returned a limited set of matching completed sales, so this range may not be complete."
      : null,
    sales,
    coverage,
  };
}

export function medianCompletedSalePrice(sales: EbayCompletedSale[]): number | null {
  if (sales.length === 0) return null;
  const values = sales.map((sale) => sale.price).sort((a, b) => a - b);
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? Math.round(((values[midpoint - 1]! + values[midpoint]!) / 2) * 100) / 100
    : values[midpoint]!;
}

export function isEbayGradeKey(value: string): value is EbayGradeKey {
  return EBAY_GRADE_SPECS.some((grade) => grade.key === value);
}

/** Test-only reset keeps token/cache behavior deterministic without exporting secrets. */
export function resetEbaySalesCachesForTests(): void {
  tokenCache.clear();
  tokenInFlight.clear();
  forexCache.clear();
}