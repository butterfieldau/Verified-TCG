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
  currentQuotesTable,
  pricingOverridesTable,
  pricingProvidersTable,
  providerPriceHistoryTable,
} from "@workspace/db";
import { and, eq, desc, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  priceChartingProvider,
  PROVIDER_KEY,
  PROVIDER_LABEL,
  PC_CURRENCY,
} from "./pricecharting.js";
import type { PCProductDetail } from "./pricecharting.js";
import {
  GRADE_DEFINITIONS,
  GRADE_BY_KEY,
  isValidGradeKey,
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
type PCOperation = "product_refresh" | "search" | "explicit_refresh";

// Quote staleness threshold (12 hours)
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

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
      isActive: priceChartingProvider.isConfigured(),
      baseUrl: "https://www.pricecharting.com/api",
      ...(healthy
        ? { lastHealthyAt: now, lastErrorMessage: null }
        : { lastErrorAt: now, lastErrorMessage: message ?? "Provider request failed" }),
    })
    .onConflictDoUpdate({
      target: pricingProvidersTable.providerKey,
      set: {
        isActive: priceChartingProvider.isConfigured(),
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
  return db
    .select()
    .from(currentQuotesTable)
    .where(
      and(
        eq(currentQuotesTable.cardId, cardId),
        eq(currentQuotesTable.providerKey, PROVIDER_KEY),
      ),
    );
}

/**
 * Persist current quotes to DB (upsert).
 */
async function persistQuotes(
  cardId: string,
  providerProductId: string,
  prices: Map<GradeKey, number>,
): Promise<void> {
  const now = new Date();
  const todayDate = now.toISOString().slice(0, 10);

  await db.transaction(async tx => {
    // A provider field disappearing means that grade is no longer available.
    // Replace the card's current quote set atomically instead of serving old
    // grades that were absent from the latest valid provider response.
    await tx
      .delete(currentQuotesTable)
      .where(
        and(
          eq(currentQuotesTable.cardId, cardId),
          eq(currentQuotesTable.providerKey, PROVIDER_KEY),
        ),
      );

    for (const [gradeKey, priceCents] of prices) {
      await tx.insert(currentQuotesTable).values({
        cardId,
        providerKey: PROVIDER_KEY,
        gradeKey,
        priceCents,
        currency: PC_CURRENCY,
        fetchedAt: now,
        providerProductId,
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
    }
  });
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
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cardProviderMappingsTable.cardId, cardId),
        eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
      ),
    );
}

function runMappedRefresh(cardId: string, providerProductId: string): Promise<void> {
  const key = `${cardId}:${PROVIDER_KEY}`;
  const existing = matchInFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    // A refresh must reach the provider. Reusing the four-hour response cache
    // here would incorrectly stamp an old quote and history point as fresh.
    const detail = await priceChartingProvider.getProductDetail(providerProductId, { bypassCache: true });
    if (!detail) {
      await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh");
      return;
    }
    await persistProviderMetadata(cardId, detail);
    const prices = priceChartingProvider.normalizeQuotes(detail);
    await persistQuotes(cardId, providerProductId, prices);
    await recordProviderHealth(true, undefined, "product_refresh");
  })()
    .catch(async (err: unknown) => {
      logger.error({ err, cardId }, "Pricing refresh failed");
      await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh").catch(() => {});
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
        const prices = priceChartingProvider.normalizeQuotes(detail);
        await persistQuotes(cardId, result.candidate.id, prices);
        await recordProviderHealth(true, undefined, "product_refresh");
      } else {
        await recordProviderHealth(false, "PriceCharting product refresh failed", "product_refresh");
      }
    }
  })()
    .catch((err: unknown) => {
      logger.error({ err, cardId }, "Background pricing match failed");
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
    await runMappedRefresh(opts.cardId, mapping.providerProductId);
    return;
  }

  await runBackgroundMatch(opts.cardId, {
    name: opts.name,
    set: opts.set,
    number: opts.number,
    game: opts.game,
  });
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
  const { cardId, gradeKey = "raw", periodDays = 30, displayCurrency = "AUD" } = opts;

  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(providerPriceHistoryTable)
    .where(
      and(
        eq(providerPriceHistoryTable.cardId, cardId),
        eq(providerPriceHistoryTable.gradeKey, gradeKey),
      ),
    )
    .orderBy(providerPriceHistoryTable.snapshotDate);

  const filtered = rows.filter(r => new Date(r.snapshotDate) >= since);

  // FX conversion
  let fxRate: number | null = null;
  if (displayCurrency !== "USD") {
    fxRate = await convertCents(100, "USD", displayCurrency).then(v => v != null ? v / 100 : null);
  }

  const points: HistoryPoint[] = filtered.map(r => {
    const displayCents = fxRate != null
      ? Math.round(r.priceCents * fxRate)
      : r.priceCents;
    const displayCurr = fxRate != null ? displayCurrency : r.currency;
    return {
      date: r.snapshotDate,
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

  const latestRow = rows[rows.length - 1] ?? null;

  return {
    cardId,
    gradeKey,
    points,
    source: PROVIDER_KEY,
    historyAvailable: points.length >= 2,
    movement,
    updatedAt: latestRow?.recordedAt?.toISOString() ?? null,
  };
}

/** Check if a background match is in flight for a card. */
export function isMatchInFlight(cardId: string): boolean {
  return matchInFlight.has(`${cardId}:${PROVIDER_KEY}`);
}
