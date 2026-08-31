/**
 * Pricing orchestration service.
 *
 * Coordinates:
 *  - PriceCharting API calls (rate-limited, deduplicated)
 *  - DB persistence of mappings and quotes
 *  - Stale quote fallback
 *  - FX conversion for display
 */
import { db } from "@workspace/db";
import {
  cardProviderMappingsTable,
  cardPriceSnapshotsTable,
  currentQuotesTable,
  pricingOverridesTable,
  pricingProvidersTable,
  providerPriceHistoryTable,
  priceChartingGuideImportsTable,
  priceChartingGuideRowsTable,
  priceChartingGuideDownloadLeaseTable,
} from "@workspace/db";
import { and, eq, desc, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  priceChartingProvider,
  PROVIDER_KEY,
  PROVIDER_LABEL,
  PC_CURRENCY,
  normalizeProduct,
  downloadBulkGuide,
  extractPrices,
  PriceChartingError,
  PriceChartingThrottleError,
  type PriceChartingGuideCategory,
} from "./pricecharting.js";
import type { PCProductDetail } from "./pricecharting.js";
import {
  GRADE_DEFINITIONS,
  GRADE_BY_KEY,
  isValidGradeKey,
  normalizeGradeKey,
} from "./grades.js";
import type { GradeKey } from "./grades.js";
import { pickBestMatch } from "./matcher.js";
import { convertCents, buildConversionProvenance } from "./fx.js";
import {
  aggregateVerifiedMarketValue,
  type VerifiedMarketValue,
} from "./engine.js";
import { recordTelemetry } from "../lib/telemetry.js";

/**
 * Fixed operation enum for PriceCharting integration telemetry. Never
 * includes URLs, query strings, card identifiers, or provider payloads.
 */
type PCOperation = "product_refresh" | "search" | "explicit_refresh" | "bulk_import";

// Quote staleness threshold (12 hours)
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/** Stable UTC bucket used to deduplicate one AM and one PM capture per day. */
export function snapshotBucketFor(date: Date): string {
  const day = date.toISOString().slice(0, 10);
  return `${day}:${date.getUTCHours() < 12 ? "AM" : "PM"}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuoteItem {
  gradeKey: GradeKey;
  label: string;
  priceCents: number;
  price: number;      // dollars (display)
  currency: string;   // display currency
  originalPriceCents: number;
  originalCurrency: string;
}

export type PricingStatus =
  | "available"
  | "stale"
  | "pending_match"
  | "review_required"
  | "unmatched"
  | "unavailable"
  | "error";

export interface PricingResponse {
  cardId: string;
  status: PricingStatus;
  configured: boolean;
  queued: boolean;
  quotes: QuoteItem[];
  /** Provider-neutral, explainable values for every available grade. */
  verifiedMarket: VerifiedMarketValue[];
  source: {
    provider: string;
    label: string;
    productId: string | null;
  };
  confidence: {
    level: string | null;
    score: number | null;
    providerCount?: number;
    reasons?: string[];
  };
  matchingConfidence?: {
    level: string | null;
    score: number | null;
  };
  providerMetadata: {
    salesVolume: number | null;
    releaseDate: string | null;
    genre: string | null;
    upc: string | null;
    epid: string | null;
  } | null;
  updatedAt: string | null;
  isStale: boolean;
  errorCode?: string;
  message?: string;
  conversion?: ReturnType<typeof buildConversionProvenance>;
  manualOverrides?: Array<{
    id: string;
    gradeKey: string;
    priceCents: number;
    currency: string;
    reason: string;
    expiresAt: string | null;
  }>;
}

// ── In-flight background match jobs ──────────────────────────────────────────

const matchInFlight = new Map<string, Promise<void>>();

async function recordProviderHealth(
  healthy: boolean,
  message?: string,
  operation?: PCOperation,
): Promise<void> {
  // Sanitized integration observability. Every external PriceCharting call
  // outcome flows through this centralized path. We record only the fixed
  // operation enum and the ok/failed status — never URLs, card inputs,
  // provider payloads, credentials, or error text.
  if (operation) {
    void recordTelemetry({
      category: "integration",
      action: "integration.pricecharting.request",
      status: healthy ? "ok" : "failed",
      metadata: { operation },
    });
  }
  const now = new Date();
  await db
    .insert(pricingProvidersTable)
    .values({
      providerKey: PROVIDER_KEY,
      label: PROVIDER_LABEL,
      isActive: healthy,
      baseUrl: "https://www.pricecharting.com/api",
      ...(healthy
        ? { lastHealthyAt: now, lastErrorMessage: null }
        : { lastErrorAt: now, lastErrorMessage: message ?? "Provider request failed" }),
    })
    .onConflictDoUpdate({
      target: pricingProvidersTable.providerKey,
      set: {
        isActive: healthy,
        updatedAt: now,
        ...(healthy
          ? { lastHealthyAt: now, lastErrorMessage: null }
          : { lastErrorAt: now, lastErrorMessage: message ?? "Provider request failed" }),
      },
    });
}

// ── Core: get or match a card ─────────────────────────────────────────────────

/**
 * Look up an existing DB mapping for a card + provider.
 */
async function getExistingMapping(cardId: string) {
  const [row] = await db
    .select()
    .from(cardProviderMappingsTable)
    .where(
      and(
        eq(cardProviderMappingsTable.cardId, cardId),
        eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface PricingMappingState {
  status: string;
  providerProductId: string | null;
  identity: {
    name: string;
    set?: string;
    number?: string;
    game?: string;
  };
}

/**
 * Return persisted provider identity without contacting any external catalog.
 * Routes use this before resolving first-time card identity so cached quotes
 * remain available during unrelated catalog outages.
 */
export async function getPricingMappingState(cardId: string): Promise<PricingMappingState | null> {
  const mapping = await getExistingMapping(cardId);
  if (!mapping) return null;
  return {
    status: mapping.status ?? "unmatched",
    providerProductId: mapping.providerProductId ?? null,
    identity: {
      name: mapping.matchedName?.trim() ?? "",
      ...(mapping.matchedSet ? { set: mapping.matchedSet } : {}),
      ...(mapping.matchedNumber ? { number: mapping.matchedNumber } : {}),
      ...(mapping.matchedGame ? { game: mapping.matchedGame } : {}),
    },
  };
}

/**
 * Get all current quotes for a card from DB.
 */
async function getStoredQuotes(cardId: string) {
  const rows = await db
    .select()
    .from(currentQuotesTable)
    .where(
      and(
        eq(currentQuotesTable.cardId, cardId),
        eq(currentQuotesTable.providerKey, PROVIDER_KEY),
      ),
    );
  return rows.map((row) => ({
    ...row,
    gradeKey: normalizeGradeKey(row.gradeKey) ?? row.gradeKey,
  }));
}

/**
 * Persist current quotes to DB (upsert).
 */
export async function persistQuotes(
  cardId: string,
  providerProductId: string,
  prices: Map<GradeKey, number>,
): Promise<void> {
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);
  const snapshotBucket = snapshotBucketFor(now);

  // A valid provider response with no usable prices must not erase a last
  // known quote. Missing fields remain missing; they are never converted to 0.
  if (prices.size === 0) return;

  await db.transaction(async tx => {
    for (const [gradeKey, priceCents] of prices) {
      await tx
        .insert(currentQuotesTable)
        .values({ cardId, providerKey: PROVIDER_KEY, gradeKey, priceCents, currency: PC_CURRENCY, fetchedAt: now, providerProductId })
        .onConflictDoUpdate({
          target: [currentQuotesTable.cardId, currentQuotesTable.providerKey, currentQuotesTable.gradeKey],
          set: { priceCents, currency: PC_CURRENCY, fetchedAt: now, providerProductId, updatedAt: now },
        });

      await tx
        .insert(providerPriceHistoryTable)
        .values({
          cardId,
          providerKey: PROVIDER_KEY,
          gradeKey,
          priceCents,
          currency: PC_CURRENCY,
          snapshotDate: todayDate,
          recordedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            providerPriceHistoryTable.cardId,
            providerPriceHistoryTable.providerKey,
            providerPriceHistoryTable.gradeKey,
            providerPriceHistoryTable.snapshotDate,
          ],
          set: { priceCents, currency: PC_CURRENCY, recordedAt: now },
        });

      await tx
        .insert(cardPriceSnapshotsTable)
        .values({
          cardId,
          providerKey: PROVIDER_KEY,
          providerProductId,
          gradeKey,
          priceCents,
          currency: PC_CURRENCY,
          capturedAt: now,
          snapshotBucket,
          captureStatus: "success",
        })
        .onConflictDoUpdate({
          target: [
            cardPriceSnapshotsTable.cardId,
            cardPriceSnapshotsTable.providerKey,
            cardPriceSnapshotsTable.gradeKey,
            cardPriceSnapshotsTable.snapshotBucket,
          ],
          set: { priceCents, currency: PC_CURRENCY, providerProductId, capturedAt: now, captureStatus: "success", failureCode: null },
        });
    }
  });
}

/** Bound bulk insert batches to avoid PostgreSQL's 65,535 parameter limit. */
export function chunkGuideRows<T>(rows: readonly T[], size = 1_000): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) chunks.push(rows.slice(offset, offset + size));
  return chunks;
}

/**
 * Apply a PriceCharting bulk guide only to already strong, canonical mappings.
 * CSV rows never create mappings or promote review_required records: the
 * provider product id was established by the normal exact-identity workflow.
 */
export async function importPriceChartingBulkGuide(category: PriceChartingGuideCategory): Promise<{
  category: PriceChartingGuideCategory;
  rowsRead: number;
  quotesPersisted: number;
  reused: boolean;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const [existing] = await db.select().from(priceChartingGuideImportsTable)
    .where(eq(priceChartingGuideImportsTable.category, category)).limit(1);
  const reusable = existing?.status === "ready"
    && existing.fetchedAt.toISOString().slice(0, 10) === today;
  let rowsRead: number;
  let reused = reusable;
  let pricesByProduct: Map<string, Map<GradeKey, number>>;
  if (reusable) {
    const persisted = await db.select().from(priceChartingGuideRowsTable)
      .where(eq(priceChartingGuideRowsTable.category, category));
    rowsRead = persisted.length;
    pricesByProduct = new Map(persisted.map(row => [
      row.providerProductId,
      new Map(Object.entries(row.prices as Record<string, number>)
        .filter(([grade, cents]) => isValidGradeKey(grade) && Number.isSafeInteger(cents) && cents > 0)
        .map(([grade, cents]) => [grade as GradeKey, cents])),
    ]));
  } else {
    // PriceCharting applies this limit to all CSV categories, not each
    // category independently. This singleton row serializes every process.
    const globalClaim = await db.execute(sql`
      INSERT INTO pricecharting_guide_download_lease
        (lease_key, last_attempt_at, lease_until, updated_at)
      VALUES ('pricecharting-csv', NOW(), NOW() + INTERVAL '10 minutes', NOW())
      ON CONFLICT (lease_key) DO UPDATE SET
        last_attempt_at = NOW(), lease_until = NOW() + INTERVAL '10 minutes', updated_at = NOW()
      WHERE pricecharting_guide_download_lease.last_attempt_at < NOW() - INTERVAL '10 minutes'
      RETURNING last_attempt_at
    `);
    if (!globalClaim.rows[0]) {
      const [globalLease] = await db.select().from(priceChartingGuideDownloadLeaseTable)
        .where(eq(priceChartingGuideDownloadLeaseTable.leaseKey, "pricecharting-csv")).limit(1);
      throw new PriceChartingThrottleError(globalLease
        ? Math.max(0, globalLease.leaseUntil.getTime() - Date.now())
        : 600_000, 429);
    }
    const claim = await db.execute<{ last_attempt_at: Date }>(sql`
      INSERT INTO pricecharting_guide_imports
        (category, status, fetched_at, row_count, last_attempt_at, lease_until, updated_at)
      VALUES (${category}, 'downloading', NOW(), 0, NOW(), NOW() + INTERVAL '10 minutes', NOW())
      ON CONFLICT (category) DO UPDATE SET
        status = 'downloading', last_attempt_at = NOW(),
        lease_until = NOW() + INTERVAL '10 minutes', updated_at = NOW()
      WHERE pricecharting_guide_imports.last_attempt_at IS NULL
        OR pricecharting_guide_imports.last_attempt_at < NOW() - INTERVAL '10 minutes'
      RETURNING last_attempt_at
    `);
    if (!claim.rows[0]) {
      const retryAfterMs = existing?.lastAttemptAt
        ? Math.max(0, 600_000 - (Date.now() - existing.lastAttemptAt.getTime()))
        : 600_000;
      throw new PriceChartingThrottleError(retryAfterMs, 429);
    }
    let downloaded;
    try {
      downloaded = await downloadBulkGuide(category);
    } catch (error) {
      const message = error instanceof PriceChartingError
        ? `PriceCharting bulk import ${error.kind}`
        : "PriceCharting bulk import failed";
      await recordProviderHealth(false, message, "bulk_import").catch(() => {});
      await db.update(priceChartingGuideImportsTable).set({
        status: "failed",
        lastErrorKind: error instanceof PriceChartingError ? error.kind : "transient",
        updatedAt: new Date(),
      }).where(eq(priceChartingGuideImportsTable.category, category));
      throw error;
    }
    rowsRead = downloaded.length;
    const fetchedAt = new Date();
    pricesByProduct = new Map(downloaded.map(row => [String(row.id), extractPrices(row)]));
    await db.transaction(async tx => {
      await tx.delete(priceChartingGuideRowsTable)
        .where(eq(priceChartingGuideRowsTable.category, category));
      for (const batch of chunkGuideRows(downloaded)) {
        await tx.insert(priceChartingGuideRowsTable).values(batch.map(row => ({
          category,
          providerProductId: String(row.id),
          productName: row["product-name"],
          consoleName: row["console-name"],
          prices: Object.fromEntries(extractPrices(row)),
          fetchedAt,
        })));
      }
      await tx.insert(priceChartingGuideImportsTable).values({
        category, status: "ready", fetchedAt, rowCount: downloaded.length, lastErrorKind: null, updatedAt: fetchedAt,
      }).onConflictDoUpdate({ target: priceChartingGuideImportsTable.category, set: {
        status: "ready", fetchedAt, rowCount: downloaded.length, lastErrorKind: null, updatedAt: fetchedAt,
      } });
    });
    await recordProviderHealth(true, undefined, "bulk_import");
  }
  if (pricesByProduct.size === 0) return { category, rowsRead, quotesPersisted: 0, reused };
  const mappings = await db
    .select({
      cardId: cardProviderMappingsTable.cardId,
      providerProductId: cardProviderMappingsTable.providerProductId,
    })
    .from(cardProviderMappingsTable)
    .where(and(
      eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      eq(cardProviderMappingsTable.status, "matched"),
    ));
  let quotesPersisted = 0;
  for (const mapping of mappings) {
    if (!mapping.providerProductId) continue;
    const prices = pricesByProduct.get(mapping.providerProductId);
    if (!prices || prices.size === 0) continue;
    await persistQuotes(mapping.cardId, mapping.providerProductId, prices);
    quotesPersisted += prices.size;
  }
  return { category, rowsRead, quotesPersisted, reused };
}

function cleanProviderText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 300) : null;
}

function cleanSalesVolume(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const normalized = String(value).trim().replaceAll(",", "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function persistProviderMetadata(cardId: string, detail: PCProductDetail): Promise<void> {
  await db
    .update(cardProviderMappingsTable)
    .set({
      providerProductName: cleanProviderText(detail["product-name"]),
      providerSalesVolume: cleanSalesVolume(detail["sales-volume"]),
      providerReleaseDate: cleanProviderText(detail["release-date"]),
      providerGenre: cleanProviderText(detail["genre"]),
      providerUpc: cleanProviderText(detail["upc"]),
      providerEpid: cleanProviderText(detail["epid"]),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cardProviderMappingsTable.cardId, cardId),
        eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      ),
    );
}

function runMappedRefresh(
  cardId: string,
  providerProductId: string,
  propagateFailures = false,
): Promise<void> {
  const key = `${cardId}:${PROVIDER_KEY}`;
  const existing = matchInFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    // A refresh must reach the provider. Reusing the four-hour response cache
    // here would incorrectly stamp an old quote and history point as fresh.
    const detail = await priceChartingProvider.getProductDetail(providerProductId, { bypassCache: true });
    if (!detail) {
      await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh");
      if (propagateFailures) throw new Error("PriceCharting product refresh returned no data");
      return;
    }
    await persistProviderMetadata(cardId, detail);
    const prices = normalizeProduct(detail).prices;
    await persistQuotes(cardId, providerProductId, prices);
    await recordProviderHealth(true, undefined, "product_refresh");
  })()
    .catch(async (err: unknown) => {
      logger.error({ err, cardId }, "Pricing refresh failed");
      await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh").catch(() => {});
      if (propagateFailures) throw err;
    })
    .finally(() => matchInFlight.delete(key));

  matchInFlight.set(key, job);
  return job;
}

/**
 * Run background match + fetch for a card. Idempotent via in-flight map.
 */
async function runBackgroundMatch(
  cardId: string,
  input: { name: string; set?: string; number?: string; game?: string },
  propagateFailures = false,
): Promise<void> {
  const key = `${cardId}:${PROVIDER_KEY}`;
  const existing = matchInFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    if (!priceChartingProvider.isConfigured()) return;

    // Search PC for candidates
    const query = [input.name, input.set, input.game].filter(Boolean).join(" ");
    const products = await priceChartingProvider.searchProducts(query);
    if (!products) {
      await recordProviderHealth(false, "PriceCharting search failed", "search");
      if (propagateFailures) throw new Error("PriceCharting search returned no data");
      return;
    }
    await recordProviderHealth(true, undefined, "search");

    if (products.length === 0) {
      // Save unmatched result
      await db
        .insert(cardProviderMappingsTable)
        .values({
          cardId,
          providerKey: PROVIDER_KEY,
          status: "unmatched",
          confidenceScore: 0,
          confidenceLevel: "none",
          matchedName: input.name,
          matchedSet: input.set ?? null,
          matchedNumber: input.number ?? null,
          matchedGame: input.game ?? null,
        })
        .onConflictDoUpdate({
          target: [cardProviderMappingsTable.cardId, cardProviderMappingsTable.providerKey],
          set: {
            status: "unmatched",
            confidenceScore: 0,
            confidenceLevel: "none",
            updatedAt: new Date(),
          },
        });
      return;
    }

    const candidates = products.map(product => priceChartingProvider.toMatchCandidate(product));
    const result = pickBestMatch(input, candidates);

    // Persist the mapping
    await db
      .insert(cardProviderMappingsTable)
      .values({
        cardId,
        providerKey: PROVIDER_KEY,
        status: result.status,
        providerProductId: result.candidate?.id ?? null,
        providerProductName: result.candidate?.name ?? null,
        confidenceScore: result.score.total,
        confidenceLevel: result.level,
        matchMetadata: result.score as unknown as Record<string, unknown>,
        matchedName: input.name,
        matchedSet: input.set ?? null,
        matchedNumber: input.number ?? null,
        matchedGame: input.game ?? null,
      })
      .onConflictDoUpdate({
        target: [cardProviderMappingsTable.cardId, cardProviderMappingsTable.providerKey],
        set: {
          status: result.status,
          providerProductId: result.candidate?.id ?? null,
          providerProductName: result.candidate?.name ?? null,
          confidenceScore: result.score.total,
          confidenceLevel: result.level,
          matchMetadata: result.score as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        },
      });

    // If matched, fetch and store prices
    if (result.status === "matched" && result.candidate) {
      const detail = await priceChartingProvider.getProductDetail(result.candidate.id);
      if (detail) {
        await persistProviderMetadata(cardId, detail);
        const prices = normalizeProduct(detail).prices;
        await persistQuotes(cardId, result.candidate.id, prices);
        await recordProviderHealth(true, undefined, "product_refresh");
      } else {
        await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh");
        if (propagateFailures) throw new Error("PriceCharting product refresh returned no data");
      }
    }
  })()
    .catch(async (err: unknown) => {
      logger.error({ err, cardId }, "Background pricing match failed");
      await recordProviderHealth(false, "PriceCharting matching request failed", "search").catch(() => {});
      if (propagateFailures) throw err;
    })
    .finally(() => {
      matchInFlight.delete(key);
    });

  matchInFlight.set(key, job);
  return job;
}

// ── Public service functions ──────────────────────────────────────────────────

export interface GetPricingOptions {
  cardId: string;
  name: string;
  set?: string;
  number?: string;
  game?: string;
  displayCurrency?: string;
}

/**
 * Get pricing for a card. Returns immediately with stored data or queues
 * a background match/refresh.
 */
export async function getPricing(opts: GetPricingOptions): Promise<PricingResponse> {
  const { cardId, name, set, number, game, displayCurrency = "AUD" } = opts;
  const configured = priceChartingProvider.isConfigured();
  const emptyMarket = {
    verifiedMarket: [] as VerifiedMarketValue[],
    providerMetadata: null,
  };

  const baseSource = {
    provider: PROVIDER_KEY,
    label: PROVIDER_LABEL,
    productId: null as string | null,
  };

  // Check existing mapping
  const mapping = await getExistingMapping(cardId);

  // If no mapping, queue background match and return pending
  if (!mapping) {
    if (!configured) {
      return {
        cardId,
        status: "unavailable",
        configured: false,
        queued: false,
        quotes: [],
        ...emptyMarket,
        source: baseSource,
        confidence: { level: null, score: null },
        updatedAt: null,
        isStale: false,
        errorCode: "missing_secret",
        message: "PriceCharting is not configured on the server",
      };
    }
    runBackgroundMatch(cardId, { name, set, number, game });
    return {
      cardId,
      status: "pending_match",
      configured,
      queued: true,
      quotes: [],
      ...emptyMarket,
      source: baseSource,
      confidence: { level: null, score: null },
      updatedAt: null,
      isStale: false,
      message: "Matching in progress, check back shortly",
    };
  }

  // Mapping exists but is review_required or unmatched
  if (mapping.status === "review_required") {
    return {
      cardId,
      status: "review_required",
      configured,
      queued: false,
      quotes: [],
      ...emptyMarket,
      source: { ...baseSource, productId: mapping.providerProductId ?? null },
      confidence: {
        level: mapping.confidenceLevel ?? null,
        score: mapping.confidenceScore ?? null,
      },
      updatedAt: mapping.updatedAt.toISOString(),
      isStale: false,
      message: "Match requires review — prices unavailable until resolved",
    };
  }

  if (mapping.status === "unmatched") {
    return {
      cardId,
      status: "unmatched",
      configured,
      queued: false,
      quotes: [],
      ...emptyMarket,
      source: baseSource,
      confidence: {
        level: mapping.confidenceLevel ?? null,
        score: mapping.confidenceScore ?? null,
      },
      updatedAt: mapping.updatedAt.toISOString(),
      isStale: false,
      message: "No matching product found in provider catalog",
    };
  }

  // Matched — get quotes
  const storedQuotes = await getStoredQuotes(cardId);
  const productId = mapping.providerProductId ?? null;

  if (storedQuotes.length === 0) {
    if (!configured) {
      return {
        cardId,
        status: "unavailable",
        configured: false,
        queued: false,
        quotes: [],
        ...emptyMarket,
        source: { ...baseSource, productId },
        confidence: {
          level: mapping.confidenceLevel ?? null,
          score: mapping.confidenceScore ?? null,
        },
        updatedAt: null,
        isStale: false,
        errorCode: "missing_secret",
        message: "Stored mapping exists, but PriceCharting is not configured for a quote refresh",
      };
    }
    // No quotes yet — queue refresh
    if (productId) void runMappedRefresh(cardId, productId);
    else void runBackgroundMatch(cardId, { name, set, number, game });
    return {
      cardId,
      status: "pending_match",
      configured: true,
      queued: true,
      quotes: [],
      ...emptyMarket,
      source: { ...baseSource, productId },
      confidence: {
        level: mapping.confidenceLevel ?? null,
        score: mapping.confidenceScore ?? null,
      },
      updatedAt: null,
      isStale: false,
      message: "Fetching prices, check back shortly",
    };
  }

  // Build quote items with FX conversion
  const latestFetch = storedQuotes.reduce<Date | null>((best, q) => {
    return best == null || q.fetchedAt > best ? q.fetchedAt : best;
  }, null);

  const isStale = latestFetch
    ? Date.now() - latestFetch.getTime() > STALE_THRESHOLD_MS
    : true;
  const refreshQueued = Boolean(isStale && configured && productId);
  if (refreshQueued && productId) void runMappedRefresh(cardId, productId);

  // Determine FX rate once for all quotes
  let fxRate: number | null = null;
  let conversionProvenance: ReturnType<typeof buildConversionProvenance> | undefined;
  if (displayCurrency !== PC_CURRENCY) {
    fxRate = await convertCents(100, PC_CURRENCY, displayCurrency).then(v =>
      v != null ? v / 100 : null,
    );
    conversionProvenance = buildConversionProvenance(PC_CURRENCY, displayCurrency, fxRate);
  }

  const quoteMap = new Map(storedQuotes.map(q => [q.gradeKey, q]));
  const quotes: QuoteItem[] = [];
  const verifiedMarket: VerifiedMarketValue[] = [];
  const retainedHistory = await db
    .select()
    .from(providerPriceHistoryTable)
    .where(
      and(
        eq(providerPriceHistoryTable.cardId, cardId),
        eq(providerPriceHistoryTable.providerKey, PROVIDER_KEY),
        gte(providerPriceHistoryTable.recordedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      ),
    );
  const now = new Date();
  const activeOverrideRows = await db
    .select()
    .from(pricingOverridesTable)
    .where(
      and(
        eq(pricingOverridesTable.cardId, cardId),
        isNull(pricingOverridesTable.revokedAt),
        lte(pricingOverridesTable.startsAt, now),
        or(
          isNull(pricingOverridesTable.expiresAt),
          gt(pricingOverridesTable.expiresAt, now),
        ),
      ),
    )
    .orderBy(desc(pricingOverridesTable.createdAt));
  const overrideByGrade = new Map(
    activeOverrideRows.map((override) => [override.gradeKey, override]),
  );
  const appliedOverrides: NonNullable<PricingResponse["manualOverrides"]> = [];

  for (const gradeDef of GRADE_DEFINITIONS) {
    const q = quoteMap.get(gradeDef.key);
    if (!q) continue;

    let displayCents: number;
    let displayCurrencyFinal: string;

    if (fxRate != null) {
      displayCents = Math.round(q.priceCents * fxRate);
      displayCurrencyFinal = displayCurrency;
    } else {
      displayCents = q.priceCents;
      displayCurrencyFinal = q.currency;
    }

    quotes.push({
      gradeKey: gradeDef.key,
      label: gradeDef.label,
      priceCents: displayCents,
      price: displayCents / 100,
      currency: displayCurrencyFinal,
      originalPriceCents: q.priceCents,
      originalCurrency: q.currency,
    });

    const retainedSnapshotCents = retainedHistory
      .filter(row => row.gradeKey === gradeDef.key)
      .map(row => fxRate != null ? Math.round(row.priceCents * fxRate) : row.priceCents);
    const market = aggregateVerifiedMarketValue({
      gradeKey: gradeDef.key,
      quotes: [{
        providerKey: q.providerKey,
        providerLabel: PROVIDER_LABEL,
        providerProductId: q.providerProductId ?? productId,
        gradeKey: gradeDef.key,
        priceCents: displayCents,
        currency: displayCurrencyFinal,
        originalPriceCents: q.priceCents,
        originalCurrency: q.currency,
        fetchedAt: q.fetchedAt,
      }],
      matchingConfidence: mapping.confidenceScore ?? null,
      isStale,
      retainedSnapshotCents,
    });
    if (market) {
      const override = overrideByGrade.get(gradeDef.key);
      if (override) {
        const overrideDisplayCents =
          override.currency === displayCurrencyFinal
            ? override.priceCents
            : await convertCents(
                override.priceCents,
                override.currency,
                displayCurrencyFinal,
              );
        if (overrideDisplayCents != null) {
          market.verifiedMarketValueCents = overrideDisplayCents;
          market.verifiedMarketValue = overrideDisplayCents / 100;
          market.currency = displayCurrencyFinal;
          market.confidence = {
            ...market.confidence,
            score: Math.min(market.confidence.score, 50),
            level: "low",
            reasons: [
              "A reviewed manual override is currently active",
              ...market.confidence.reasons,
            ],
          };
          market.insights = [
            "Verified Market value is temporarily overridden; provider quotes remain visible",
            ...market.insights,
          ];
          appliedOverrides.push({
            id: override.id,
            gradeKey: override.gradeKey,
            priceCents: override.priceCents,
            currency: override.currency,
            reason: override.reason,
            expiresAt: override.expiresAt?.toISOString() ?? null,
          });
        }
      }
      verifiedMarket.push(market);
    }
  }

  const primaryMarket = verifiedMarket.find(value => value.gradeKey === "raw") ?? verifiedMarket[0];

  return {
    cardId,
    status: isStale ? "stale" : "available",
    configured,
    queued: refreshQueued,
    quotes,
    verifiedMarket,
    source: {
      provider: PROVIDER_KEY,
      label: PROVIDER_LABEL,
      productId,
    },
    confidence: {
      level: primaryMarket?.confidence.level ?? null,
      score: primaryMarket?.confidence.score ?? null,
      providerCount: primaryMarket?.confidence.providerCount,
      reasons: primaryMarket?.confidence.reasons,
    },
    matchingConfidence: {
      level: mapping.confidenceLevel ?? null,
      score: mapping.confidenceScore ?? null,
    },
    providerMetadata: {
      salesVolume: mapping.providerSalesVolume ?? null,
      releaseDate: mapping.providerReleaseDate ?? null,
      genre: mapping.providerGenre ?? null,
      upc: mapping.providerUpc ?? null,
      epid: mapping.providerEpid ?? null,
    },
    updatedAt: latestFetch?.toISOString() ?? null,
    isStale,
    ...(appliedOverrides.length > 0 ? { manualOverrides: appliedOverrides } : {}),
    ...(!configured
      ? { message: "Stored PriceCharting value shown; automatic refresh is not configured" }
      : {}),
    ...(conversionProvenance ? { conversion: conversionProvenance } : {}),
  };
}

/**
 * Force-refresh pricing for a card. Waits for the refresh to complete
 * (bounded by timeout) then returns updated pricing.
 */
export async function refreshPricing(opts: GetPricingOptions): Promise<PricingResponse> {
  const { cardId, name, set, number, game } = opts;

  if (!priceChartingProvider.isConfigured()) {
    return getPricing(opts);
  }

  // Get existing mapping to know the product ID
  const mapping = await getExistingMapping(cardId);
  const productId = mapping?.providerProductId ?? null;

  const REFRESH_TIMEOUT_MS = 15_000;

  if (productId && mapping?.status === "matched") {
    // Re-fetch via product ID
    const key = `${cardId}:${PROVIDER_KEY}`;
    if (!matchInFlight.has(key)) {
      void runMappedRefresh(cardId, productId);
    }
    // Wait for completion or timeout
    await Promise.race([
      matchInFlight.get(key) ?? Promise.resolve(),
      new Promise<void>(r => setTimeout(r, REFRESH_TIMEOUT_MS)),
    ]);
  } else {
    // Re-run full match
    void runBackgroundMatch(cardId, { name, set, number, game });
    await Promise.race([
      matchInFlight.get(`${cardId}:${PROVIDER_KEY}`) ?? Promise.resolve(),
      new Promise<void>(r => setTimeout(r, REFRESH_TIMEOUT_MS)),
    ]);
  }

  return getPricing(opts);
}

/**
 * Scheduler refresh variant. Unlike the interactive endpoint, this waits for
 * the real provider job (including queue time) before resolving so dependent
 * portfolio snapshots cannot run against pre-refresh data.
 */
export async function refreshPricingForScheduler(
  opts: Pick<GetPricingOptions, "cardId" | "name" | "set" | "number" | "game">,
): Promise<void> {
  if (!priceChartingProvider.isConfigured()) return;

  const mapping = await getExistingMapping(opts.cardId);
  if (mapping?.status === "matched" && mapping.providerProductId) {
    await runMappedRefresh(opts.cardId, mapping.providerProductId, true);
    return;
  }

  await runBackgroundMatch(opts.cardId, {
    name: opts.name,
    set: opts.set,
    number: opts.number,
    game: opts.game,
  }, true);
}

/**
 * Explicitly refresh quotes for a card using the persisted provider product ID.
 * Unlike `runMappedRefresh`, this function:
 *   - Bypasses every cache layer and contacts the provider unconditionally
 *   - Awaits quote AND history persistence before resolving
 *   - Propagates failure as a returned status rather than silently catching it
 *
 * Intended for admin-initiated refresh jobs where the operator expects the DB
 * to reflect fresh provider data once the job is marked `succeeded`.
 */
export async function refreshPricingExplicit(
  cardId: string,
  providerProductId: string,
): Promise<{ status: "succeeded" } | { status: "failed"; error: string }> {
  if (!priceChartingProvider.isConfigured()) {
    return { status: "failed", error: "PriceCharting provider is not configured" };
  }
  try {
    const detail = await priceChartingProvider.getProductDetail(providerProductId, {
      bypassCache: true,
    });
    if (!detail) {
      await recordProviderHealth(false, "PriceCharting product refresh returned no data", "explicit_refresh");
      return { status: "failed", error: "Provider returned no data for this product" };
    }
    await persistProviderMetadata(cardId, detail);
    const prices = priceChartingProvider.normalizeQuotes(detail);
    await persistQuotes(cardId, providerProductId, prices);
    await recordProviderHealth(true, undefined, "explicit_refresh");
    return { status: "succeeded" };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error during refresh";
    logger.error({ err, cardId, providerProductId }, "Explicit pricing refresh failed");
    await recordProviderHealth(false, "PriceCharting explicit refresh failed", "explicit_refresh").catch(() => {});
    return { status: "failed", error: message };
  }
}

/**
 * Advance fair scheduling when authoritative catalog identity cannot be
 * resolved. Existing strong mappings are never overwritten.
 */
export async function recordSchedulerIdentityFailure(cardId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO card_provider_mappings (
      card_id,
      provider_key,
      status,
      confidence_level,
      match_metadata,
      updated_at
    )
    VALUES (
      ${cardId},
      ${PROVIDER_KEY},
      'unmatched',
      'none',
      '{"reason":"catalog_identity_unavailable"}'::jsonb,
      NOW()
    )
    ON CONFLICT (card_id, provider_key) DO UPDATE
      SET updated_at = NOW(),
          match_metadata = EXCLUDED.match_metadata
      WHERE card_provider_mappings.status <> 'matched'
  `);
}

/**
 * Get price history for a card from providerPriceHistory + legacy price_snapshots.
 */
export interface HistoryPoint {
  date: string;
  priceCents: number;
  price: number;
  currency: string;
}

export interface PriceHistoryResult {
  cardId: string;
  gradeKey: string;
  points: HistoryPoint[];
  source: string;
  historyAvailable: boolean;
  movement: {
    absolute: number;
    percent: number;
    direction: "up" | "down" | "flat";
  } | null;
  updatedAt: string | null;
}

export async function getPriceHistory(opts: {
  cardId: string;
  gradeKey?: string;
  periodDays?: number;
  displayCurrency?: string;
}): Promise<PriceHistoryResult> {
  const { cardId, periodDays = 30, displayCurrency = "AUD" } = opts;
  const canonicalGradeKey = normalizeGradeKey(opts.gradeKey ?? "raw") ?? "raw";

  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const snapshotRows = await db
    .select()
    .from(cardPriceSnapshotsTable)
    .where(
      and(
        eq(cardPriceSnapshotsTable.cardId, cardId),
        eq(cardPriceSnapshotsTable.providerKey, PROVIDER_KEY),
        eq(cardPriceSnapshotsTable.gradeKey, canonicalGradeKey),
        gte(cardPriceSnapshotsTable.capturedAt, since),
        eq(cardPriceSnapshotsTable.captureStatus, "success"),
      ),
    )
    .orderBy(cardPriceSnapshotsTable.capturedAt);

  // Preserve access to pre-Stage-2A provider history without pretending it has
  // timestamp precision. New captures always use card_price_snapshots.
  const legacyRows = snapshotRows.length === 0
    ? await db
      .select()
      .from(providerPriceHistoryTable)
      .where(and(
        eq(providerPriceHistoryTable.cardId, cardId),
        eq(providerPriceHistoryTable.providerKey, PROVIDER_KEY),
        eq(providerPriceHistoryTable.gradeKey, canonicalGradeKey),
      ))
      .orderBy(providerPriceHistoryTable.snapshotDate)
    : [];

  const pointsSource = snapshotRows.length > 0
    ? snapshotRows.filter((row) => row.priceCents != null).map((row) => ({
        date: row.capturedAt.toISOString(),
        priceCents: row.priceCents!,
        currency: row.currency,
        recordedAt: row.capturedAt,
      }))
    : legacyRows
      .filter((row) => new Date(row.snapshotDate) >= since)
      .filter((row) => row.priceCents > 0)
      .map((row) => ({
        date: row.snapshotDate,
        priceCents: row.priceCents,
        currency: row.currency,
        recordedAt: row.recordedAt,
      }));

  // FX conversion
  let fxRate: number | null = null;
  if (displayCurrency !== "USD") {
    fxRate = await convertCents(100, "USD", displayCurrency).then(v => v != null ? v / 100 : null);
  }

  const points: HistoryPoint[] = pointsSource.map(r => {
    const displayCents = fxRate != null
      ? Math.round(r.priceCents * fxRate)
      : r.priceCents;
    const displayCurr = fxRate != null ? displayCurrency : r.currency;
    return {
      date: r.date,
      priceCents: displayCents,
      price: displayCents / 100,
      currency: displayCurr,
    };
  });

  // Calculate movement if we have at least 2 points
  let movement: PriceHistoryResult["movement"] = null;
  if (points.length >= 2) {
    const from = points[0]!.priceCents;
    const to   = points[points.length - 1]!.priceCents;
    const changeCents = to - from;
    const percent = from > 0 ? (changeCents / from) * 100 : 0;
    movement = {
      absolute: changeCents / 100,
      percent,
      direction: changeCents > 0 ? "up" : changeCents < 0 ? "down" : "flat",
    };
  }

  const latestRow = pointsSource[pointsSource.length - 1] ?? null;

  return {
    cardId,
    gradeKey: canonicalGradeKey,
    points,
    source: snapshotRows.length > 0 ? "pricecharting_snapshots" : PROVIDER_KEY,
    historyAvailable: points.length >= 2,
    movement,
    updatedAt: latestRow?.recordedAt?.toISOString() ?? null,
  };
}

/** Check if a background match is in flight for a card. */
export function isMatchInFlight(cardId: string): boolean {
  return matchInFlight.has(`${cardId}:${PROVIDER_KEY}`);
}
