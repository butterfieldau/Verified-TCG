import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { recordTelemetry } from "./telemetry.js";

const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";
const JUSTTCG_V2_BASE_URL = "https://api.justtcg.com/v2";
const PROVIDER_TIMEOUT_MS = 8_000;
const DEFAULT_DAILY_BUDGET = 1_000;
const MAX_CACHE_ENTRIES = 5_000;
const COLD_MISS_LEASE_MS = PROVIDER_TIMEOUT_MS + 4_000;
const COLD_MISS_WAIT_MS = COLD_MISS_LEASE_MS + 1_000;
const CACHE_WAIT_POLL_MS = 50;

type CatalogueResource = "games" | "cards" | "market" | "other";
type CacheStatus = "fresh" | "stale" | "miss";

export interface CatalogueRead<T = unknown> {
  status: number;
  body: T;
  cached: boolean;
  cacheStatus: CacheStatus;
  outboundCall: boolean;
  revalidationScheduled?: boolean;
}

interface CacheWindow {
  freshMs: number;
  staleMs: number;
}

interface CacheEntry {
  body: unknown;
  fetchedAt: Date;
  freshUntil: Date;
  staleUntil: Date;
  lastAttemptAt: Date | null;
}

class CatalogueHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super("JustTCG catalogue request failed");
  }
}

class CatalogueBudgetError extends Error {
  constructor() {
    super("The daily JustTCG catalogue allowance is exhausted");
  }
}

const inFlight = new Map<string, Promise<unknown>>();

export class CatalogueReadFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super("Catalogue source read was unavailable");
  }
}

function positiveEnvInt(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

export function justTcgDailyBudget(): number {
  return positiveEnvInt("JUSTTCG_DAILY_CALL_BUDGET", DEFAULT_DAILY_BUDGET, 1_000_000);
}

function cacheWindow(resource: CatalogueResource): CacheWindow {
  switch (resource) {
    case "games":
      return { freshMs: 24 * 60 * 60 * 1000, staleMs: 7 * 24 * 60 * 60 * 1000 };
    case "market":
      return { freshMs: 30 * 60 * 1000, staleMs: 24 * 60 * 60 * 1000 };
    case "cards":
      return { freshMs: 30 * 60 * 1000, staleMs: 7 * 24 * 60 * 60 * 1000 };
    default:
      return { freshMs: 30 * 60 * 1000, staleMs: 24 * 60 * 60 * 1000 };
  }
}

function resourceForPath(path: string): CatalogueResource {
  if (path.startsWith("/games")) return "games";
  if (path.startsWith("/cards")) return "cards";
  return "other";
}

/**
 * Canonicalize provider reads before using them as cache keys. Query values
 * are normalized only for safe, human-entered filters; no raw query is
 * emitted to telemetry.
 */
export function canonicalizeJustTcgPath(path: string): string {
  const url = new URL(path, JUSTTCG_BASE_URL);
  const params = [...url.searchParams.entries()]
    .map(([key, value]) => {
      const normalized = ["q", "game"].includes(key)
        ? value.trim().replace(/\s+/g, " ")
        : value.trim();
      return [key, normalized] as const;
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params.map(([key, value]) => [key, value])).toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

function cacheKeyFor(path: string): string {
  return `justtcg:${canonicalizeJustTcgPath(path)}`;
}

async function readCache(cacheKey: string): Promise<CacheEntry | null> {
  const result = await db.execute<{
    body: unknown;
    fetched_at: Date;
    fresh_until: Date;
    stale_until: Date;
    last_attempt_at: Date | null;
  }>(sql`
    SELECT body, fetched_at, fresh_until, stale_until, last_attempt_at
    FROM catalogue_cache_entries
    WHERE cache_key = ${cacheKey}
  `);
  const row = result.rows[0];
  return row
    ? {
        body: row.body,
        fetchedAt: new Date(row.fetched_at),
        freshUntil: new Date(row.fresh_until),
        staleUntil: new Date(row.stale_until),
        lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
      }
    : null;
}

async function writeCache(cacheKey: string, resource: CatalogueResource, body: unknown): Promise<void> {
  const now = new Date();
  const window = cacheWindow(resource);
  await db.execute(sql`
    INSERT INTO catalogue_cache_entries
      (cache_key, resource, body, fetched_at, fresh_until, stale_until, last_attempt_at, updated_at)
    VALUES
      (${cacheKey}, ${resource}, ${JSON.stringify(body)}::jsonb, ${now},
       ${new Date(now.getTime() + window.freshMs)},
       ${new Date(now.getTime() + window.staleMs)}, ${now}, ${now})
    ON CONFLICT (cache_key) DO UPDATE SET
      resource = EXCLUDED.resource,
      body = EXCLUDED.body,
      fetched_at = EXCLUDED.fetched_at,
      fresh_until = EXCLUDED.fresh_until,
      stale_until = EXCLUDED.stale_until,
      last_attempt_at = EXCLUDED.last_attempt_at,
      updated_at = EXCLUDED.updated_at
  `);

  // Keep routine search traffic from growing the durable cache without bound.
  await db.execute(sql`
    DELETE FROM catalogue_cache_entries
    WHERE cache_key IN (
      SELECT cache_key
      FROM catalogue_cache_entries
      ORDER BY updated_at DESC
      OFFSET ${MAX_CACHE_ENTRIES}
    )
  `);
}

async function claimRevalidation(cacheKey: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const result = await db.execute<{ cache_key: string }>(sql`
    UPDATE catalogue_cache_entries
    SET last_attempt_at = NOW()
    WHERE cache_key = ${cacheKey}
      AND (last_attempt_at IS NULL OR last_attempt_at < ${cutoff})
    RETURNING cache_key
  `);
  return Boolean(result.rows[0]);
}

/**
 * Atomically elect one API process to resolve a cold miss. The lease outlives
 * the provider timeout slightly so another process cannot consume budget
 * while the owner is still awaiting its response.
 */
async function claimColdMiss(cacheKey: string): Promise<string | null> {
  const ownerToken = randomUUID();
  const result = await db.execute<{ owner_token: string }>(sql`
    INSERT INTO catalogue_cache_leases (cache_key, owner_token, lease_until, updated_at)
    VALUES (${cacheKey}, ${ownerToken}, NOW() + ${COLD_MISS_LEASE_MS} * INTERVAL '1 millisecond', NOW())
    ON CONFLICT (cache_key) DO UPDATE SET
      owner_token = EXCLUDED.owner_token,
      lease_until = EXCLUDED.lease_until,
      updated_at = NOW()
    WHERE catalogue_cache_leases.lease_until < NOW()
    RETURNING owner_token
  `);
  return result.rows[0]?.owner_token ?? null;
}

async function releaseColdMiss(cacheKey: string, ownerToken: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM catalogue_cache_leases
    WHERE cache_key = ${cacheKey} AND owner_token = ${ownerToken}
  `);
}

async function waitForFreshCache(cacheKey: string): Promise<CacheEntry | null> {
  const deadline = Date.now() + COLD_MISS_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CACHE_WAIT_POLL_MS));
    const cached = await readCache(cacheKey);
    if (cached && Date.now() < cached.freshUntil.getTime()) return cached;

    const lease = await db.execute<{ lease_until: Date }>(sql`
      SELECT lease_until FROM catalogue_cache_leases WHERE cache_key = ${cacheKey}
    `);
    if (!lease.rows[0] || new Date(lease.rows[0].lease_until).getTime() < Date.now()) return null;
  }
  return null;
}

async function writeCacheAsLeaseOwner(
  cacheKey: string,
  ownerToken: string,
  resource: CatalogueResource,
  body: unknown,
): Promise<boolean> {
  const now = new Date();
  const window = cacheWindow(resource);
  const result = await db.execute<{ cache_key: string }>(sql`
    WITH owned_lease AS (
      DELETE FROM catalogue_cache_leases
      WHERE cache_key = ${cacheKey} AND owner_token = ${ownerToken}
      RETURNING cache_key
    )
    INSERT INTO catalogue_cache_entries
      (cache_key, resource, body, fetched_at, fresh_until, stale_until, last_attempt_at, updated_at)
    SELECT
      ${cacheKey}, ${resource}, ${JSON.stringify(body)}::jsonb, ${now},
      ${new Date(now.getTime() + window.freshMs)},
      ${new Date(now.getTime() + window.staleMs)}, ${now}, ${now}
    FROM owned_lease
    ON CONFLICT (cache_key) DO UPDATE SET
      resource = EXCLUDED.resource,
      body = EXCLUDED.body,
      fetched_at = EXCLUDED.fetched_at,
      fresh_until = EXCLUDED.fresh_until,
      stale_until = EXCLUDED.stale_until,
      last_attempt_at = EXCLUDED.last_attempt_at,
      updated_at = EXCLUDED.updated_at
    RETURNING cache_key
  `);
  if (result.rows[0]) {
    await db.execute(sql`
      DELETE FROM catalogue_cache_entries
      WHERE cache_key IN (
        SELECT cache_key
        FROM catalogue_cache_entries
        ORDER BY updated_at DESC
        OFFSET ${MAX_CACHE_ENTRIES}
      )
    `);
  }
  return Boolean(result.rows[0]);
}

async function reserveDailyCall(): Promise<void> {
  const budget = justTcgDailyBudget();
  if (budget <= 0) throw new CatalogueBudgetError();
  const date = new Date().toISOString().slice(0, 10);
  const result = await db.execute<{ usage_date: string }>(sql`
    INSERT INTO catalogue_daily_usage (usage_date, outbound_calls, updated_at)
    VALUES (${date}, 1, NOW())
    ON CONFLICT (usage_date) DO UPDATE
      SET outbound_calls = catalogue_daily_usage.outbound_calls + 1,
          updated_at = NOW()
      WHERE catalogue_daily_usage.outbound_calls < ${budget}
    RETURNING usage_date
  `);
  if (!result.rows[0]) throw new CatalogueBudgetError();
}

function operationForResource(resource: CatalogueResource, apiVersion: "v1" | "v2" = "v1"): "games" | "cards" | "cards_v2" | "other" {
  if (apiVersion === "v2" && resource === "cards") return "cards_v2";
  return resource === "games" ? "games" : resource === "cards" ? "cards" : "other";
}

async function providerFetch(
  path: string,
  resource: CatalogueResource,
  options: { baseUrl?: string; apiVersion?: "v1" | "v2" } = {},
): Promise<unknown> {
  const key = process.env.JUSTTCG_API_KEY;
  if (!key) throw new Error("JUSTTCG_API_KEY is not configured");
  await reserveDailyCall();
  const startedAt = Date.now();
  const baseUrl = options.baseUrl ?? JUSTTCG_BASE_URL;
  const apiVersion = options.apiVersion ?? "v1";
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "x-api-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({ error: "Invalid provider response" }));
    void recordTelemetry({
      category: "integration",
      action: "integration.justtcg.request",
      status: response.ok ? "ok" : "failed",
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      metadata: { operation: operationForResource(resource, apiVersion), outboundCall: true },
    });
    if (!response.ok) throw new CatalogueHttpError(response.status, body);
    return body;
  } catch (error) {
    if (error instanceof CatalogueHttpError) throw error;
    void recordTelemetry({
      category: "integration",
      action: "integration.justtcg.request",
      status: "failed",
      durationMs: Date.now() - startedAt,
      metadata: { operation: operationForResource(resource, apiVersion), outboundCall: true },
    });
    throw error;
  }
}

async function cacheTelemetry(resource: CatalogueResource, status: CacheStatus, outboundCall: boolean): Promise<void> {
  void recordTelemetry({
    category: "integration",
    action: "integration.justtcg.cache",
    status: status === "fresh" ? "ok" : "degraded",
    metadata: { operation: operationForResource(resource), outboundCall },
  });
}

export interface CachedValue<T> {
  data: T;
  cacheStatus: Exclude<CacheStatus, "miss"> | "miss";
  revalidationScheduled: boolean;
  outboundCall: boolean;
}

/**
 * Composed market feeds must not be promoted to a fresh durable result when
 * one of their inputs is stale, unavailable, or quota-denied.
 */
export function requireFreshCatalogueReads(reads: readonly CatalogueRead[]): void {
  const budgetDenied = reads.find((result) => result.status === 429);
  if (budgetDenied) throw new CatalogueReadFailure(429, budgetDenied.body);
  const unavailable = reads.find((result) => result.status >= 400 || result.cacheStatus === "stale");
  if (unavailable) {
    throw new CatalogueReadFailure(503, {
      error: unavailable.cacheStatus === "stale"
        ? "Catalogue source data is stale and cannot be used to rebuild this market feed"
        : "Catalog provider unavailable",
    });
  }
}

/**
 * Shared durable cache primitive. A stale hit is returned immediately and
 * only one background refresh is allowed for a key. A cold miss is single
 * flighted so concurrent Home/Market/Search requests share one loader.
 */
export async function withCatalogueCache<T>(
  cacheKey: string,
  resource: CatalogueResource,
  loader: () => Promise<T>,
): Promise<CachedValue<T>> {
  return withCatalogueCacheAttempt(cacheKey, resource, loader, 0);
}

async function withCatalogueCacheAttempt<T>(
  cacheKey: string,
  resource: CatalogueResource,
  loader: () => Promise<T>,
  waitRetries: number,
): Promise<CachedValue<T>> {
  const existing = await readCache(cacheKey);
  const now = Date.now();
  if (existing && now < existing.freshUntil.getTime()) {
    await cacheTelemetry(resource, "fresh", false);
    return { data: existing.body as T, cacheStatus: "fresh", revalidationScheduled: false, outboundCall: false };
  }

  if (existing && now < existing.staleUntil.getTime()) {
    let revalidationScheduled = false;
    if (!inFlight.has(cacheKey) && await claimRevalidation(cacheKey)) {
      revalidationScheduled = true;
      const refresh = loader()
        .then((data) => writeCache(cacheKey, resource, data))
        .catch(() => {})
        .finally(() => {
          inFlight.delete(cacheKey);
        });
      inFlight.set(cacheKey, refresh);
    }
    await cacheTelemetry(resource, "stale", false);
    return { data: existing.body as T, cacheStatus: "stale", revalidationScheduled, outboundCall: false };
  }

  const running = inFlight.get(cacheKey);
  if (running) {
    const data = await (running as Promise<T>);
    await cacheTelemetry(resource, "miss", false);
    return { data, cacheStatus: "miss", revalidationScheduled: false, outboundCall: false };
  }

  // Process-local single flight handles same-instance callers. The persisted
  // lease extends that guarantee to independent API processes.
  const ownerToken = await claimColdMiss(cacheKey);
  if (!ownerToken) {
    const filled = await waitForFreshCache(cacheKey);
    if (filled) {
      await cacheTelemetry(resource, "fresh", false);
      return { data: filled.body as T, cacheStatus: "fresh", revalidationScheduled: false, outboundCall: false };
    }
    // The owner may have failed and released its lease before filling cache.
    // Retry election once; budget reservation still protects the provider.
    if (waitRetries < 1) return withCatalogueCacheAttempt(cacheKey, resource, loader, waitRetries + 1);
    throw new Error("Catalogue request is already being refreshed");
  }

  const promise = loader()
    .then(async (data) => {
      await writeCacheAsLeaseOwner(cacheKey, ownerToken, resource, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
      void releaseColdMiss(cacheKey, ownerToken);
    });
  inFlight.set(cacheKey, promise);
  const data = await promise;
  await cacheTelemetry(resource, "miss", true);
  return { data, cacheStatus: "miss", revalidationScheduled: false, outboundCall: true };
}

export async function justTcg(path: string): Promise<CatalogueRead> {
  const canonicalPath = canonicalizeJustTcgPath(path);
  const resource = resourceForPath(canonicalPath);
  try {
    const result = await withCatalogueCache(
      cacheKeyFor(canonicalPath),
      resource,
      () => providerFetch(canonicalPath, resource),
    );
    return {
      status: 200,
      body: result.data,
      cached: result.cacheStatus !== "miss",
      cacheStatus: result.cacheStatus,
      outboundCall: result.outboundCall,
      revalidationScheduled: result.revalidationScheduled,
    };
  } catch (error) {
    if (error instanceof CatalogueHttpError) {
      return { status: error.status, body: error.body, cached: false, cacheStatus: "miss", outboundCall: true };
    }
    if (error instanceof CatalogueBudgetError) {
      return {
        status: 429,
        body: { error: error.message, code: "CATALOGUE_DAILY_BUDGET_EXHAUSTED" },
        cached: false,
        cacheStatus: "miss",
        outboundCall: false,
      };
    }
    return {
      status: 503,
      body: { error: error instanceof Error ? error.message : "Catalog provider unavailable" },
      cached: false,
      cacheStatus: "miss",
      outboundCall: false,
    };
  }
}

/**
 * Server-only access to JustTCG v2 card variants. v2 is beta, so callers must
 * opt in deliberately and keep v1 catalogue reads unchanged. Its cache key is
 * versioned to prevent a v2 response from ever being mistaken for the v1 DTO.
 */
export async function justTcgV2(path: string): Promise<CatalogueRead> {
  const canonicalPath = canonicalizeJustTcgPath(path);
  const resource = resourceForPath(canonicalPath);
  try {
    const result = await withCatalogueCache(
      `justtcg:v2:${canonicalPath}`,
      resource,
      () => providerFetch(canonicalPath, resource, {
        baseUrl: JUSTTCG_V2_BASE_URL,
        apiVersion: "v2",
      }),
    );
    return {
      status: 200,
      body: result.data,
      cached: result.cacheStatus !== "miss",
      cacheStatus: result.cacheStatus,
      outboundCall: result.outboundCall,
      revalidationScheduled: result.revalidationScheduled,
    };
  } catch (error) {
    if (error instanceof CatalogueHttpError) {
      return { status: error.status, body: error.body, cached: false, cacheStatus: "miss", outboundCall: true };
    }
    if (error instanceof CatalogueBudgetError) {
      return {
        status: 429,
        body: { error: error.message, code: "CATALOGUE_DAILY_BUDGET_EXHAUSTED" },
        cached: false,
        cacheStatus: "miss",
        outboundCall: false,
      };
    }
    return {
      status: 503,
      body: { error: error instanceof Error ? error.message : "Catalog provider unavailable" },
      cached: false,
      cacheStatus: "miss",
      outboundCall: false,
    };
  }
}

export function catalogueCacheKey(key: string): string {
  return `composed:${key}`;
}

export function catalogueResourceWindow(resource: CatalogueResource): CacheWindow {
  return cacheWindow(resource);
}
