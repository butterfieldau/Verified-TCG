/**
 * Pricing API routes.
 *
 * GET  /pricing/cards/:id                   — get current pricing
 * POST /pricing/cards/:id/refresh           — force refresh pricing
 * GET  /pricing/cards/:id/history           — price history
 * POST /pricing/scheduler/run               — enqueue batch pricing (admin)
 */
import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { logger } from "../lib/logger.js";
import {
  getPricing,
  getPricingMappingState,
  refreshPricing,
  getPriceHistory,
  importPriceChartingBulkGuide,
} from "../pricing/service.js";
import { isValidGradeKey, normalizeGradeKey } from "../pricing/grades.js";
import { pricingReadLimiter, pricingRefreshLimiter } from "../lib/rateLimiters.js";
import {
  isPCConfigured,
  PROVIDER_KEY,
  PROVIDER_LABEL,
  PRICECHARTING_GUIDE_CATEGORIES,
  PriceChartingError,
} from "../pricing/pricecharting.js";
import { resolveCatalogCardById } from "./catalog.js";
import {
  runScheduledPricingBatch,
  selectCardsForScheduledRefresh,
} from "../pricing/scheduler.js";

export { selectCardsForScheduledRefresh } from "../pricing/scheduler.js";

const router = Router();

const PERIOD_DAYS: Record<string, number> = {
  "7d":  7,
  "30d": 30,
  "90d": 90,
  "3m":  90,
  "180d": 180,
  "6m":  180,
  "1y":  365,
  "all": 36500,
};

interface PricingIdentity {
  name: string;
  set?: string;
  number?: string;
  game?: string;
}

function identityFromCatalogCard(card: Record<string, unknown>): PricingIdentity | null {
  const name = typeof card["name"] === "string" ? card["name"].trim() : "";
  if (!name) return null;
  const setValue = card["setName"] ?? card["set"];
  const gameValue = card["tcg"] ?? card["game"];
  return {
    name,
    set: typeof setValue === "string" ? setValue.trim() : undefined,
    number: typeof card["number"] === "string" ? card["number"].trim() : undefined,
    game: typeof gameValue === "string" ? gameValue.trim().toLowerCase() : undefined,
  };
}

async function authoritativeIdentity(
  cardId: string,
  clientIdentity: PricingIdentity,
): Promise<PricingIdentity | null> {
  // When the live provider is disabled, getPricing cannot create a mapping, so
  // accepting display metadata is safe and preserves the honest unavailable
  // response. Once enabled, only server-resolved catalog identity may match.
  if (!isPCConfigured()) return clientIdentity;
  try {
    const resolved = await resolveCatalogCardById(cardId);
    return resolved ? identityFromCatalogCard(resolved.card) : null;
  } catch (err) {
    logger.warn({ err, cardId }, "Authoritative pricing identity unavailable");
    return null;
  }
}

function catalogIdentityUnavailable(cardId: string) {
  return {
    cardId,
    status: "unavailable",
    configured: isPCConfigured(),
    queued: false,
    quotes: [],
    verifiedMarket: [],
    source: {
      provider: PROVIDER_KEY,
      label: PROVIDER_LABEL,
      productId: null,
    },
    confidence: { level: null, score: null },
    providerMetadata: null,
    updatedAt: null,
    isStale: false,
    errorCode: "catalog_identity_unavailable",
    message: "Stored pricing is unavailable and card identity could not be resolved safely",
  };
}

// ── GET /pricing/cards/:id ────────────────────────────────────────────────────

router.get("/pricing/cards/:id", requireActiveUser, pricingReadLimiter, async (req: AuthRequest, res): Promise<void> => {
  const cardId = String(req.params["id"] ?? "").slice(0, 300);
  if (!cardId) {
    res.status(400).json({ message: "cardId is required" });
    return;
  }

  const name = typeof req.query["name"] === "string" ? req.query["name"].trim() : "";
  const set  = typeof req.query["set"]  === "string" ? req.query["set"].trim()  : undefined;
  const number = typeof req.query["number"] === "string" ? req.query["number"].trim() : undefined;
  const game = typeof req.query["game"] === "string" ? req.query["game"].trim().toLowerCase() : undefined;
  const displayCurrency = typeof req.query["displayCurrency"] === "string"
    ? req.query["displayCurrency"].trim().toUpperCase()
    : "AUD";

  try {
    const mapping = await getPricingMappingState(cardId);
    if (!mapping && !name) {
      res.status(400).json({ message: "name query param is required for first-time matching" });
      return;
    }
    const identity = mapping?.identity
      ?? await authoritativeIdentity(cardId, { name, set, number, game });
    if (!identity) {
      res.json(catalogIdentityUnavailable(cardId));
      return;
    }
    const result = await getPricing({ cardId, ...identity, displayCurrency });
    res.json(result);
  } catch (err) {
    logger.error({ err, cardId }, "GET /pricing/cards/:id error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /pricing/cards/:id/refresh ──────────────────────────────────────────

router.post("/pricing/cards/:id/refresh", requireActiveUser, pricingRefreshLimiter, async (req: AuthRequest, res): Promise<void> => {
  const cardId = String(req.params["id"] ?? "").slice(0, 300);
  if (!cardId) {
    res.status(400).json({ message: "cardId is required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof (body["name"] ?? req.query["name"]) === "string"
    ? String(body["name"] ?? req.query["name"]).trim()
    : "";
  const set = typeof (body["set"] ?? req.query["set"]) === "string"
    ? String(body["set"] ?? req.query["set"]).trim()
    : undefined;
  const number = typeof (body["number"] ?? req.query["number"]) === "string"
    ? String(body["number"] ?? req.query["number"]).trim()
    : undefined;
  const game = typeof (body["game"] ?? req.query["game"]) === "string"
    ? String(body["game"] ?? req.query["game"]).trim().toLowerCase()
    : undefined;
  const displayCurrency = typeof (body["displayCurrency"] ?? req.query["displayCurrency"]) === "string"
    ? String(body["displayCurrency"] ?? req.query["displayCurrency"]).trim().toUpperCase()
    : "AUD";

  try {
    const mapping = await getPricingMappingState(cardId);
    if (!mapping && !name) {
      res.status(400).json({ message: "name is required for first-time matching (body or query)" });
      return;
    }

    const canRefreshPersistedProduct =
      mapping?.status === "matched" && Boolean(mapping.providerProductId);
    const identity = canRefreshPersistedProduct
      ? mapping.identity
      : await authoritativeIdentity(cardId, { name, set, number, game });

    if (!identity) {
      if (mapping) {
        const stored = await getPricing({ cardId, ...mapping.identity, displayCurrency });
        res.json({
          ...stored,
          queued: false,
          message: stored.message
            ?? "Stored pricing retained; card identity could not be resolved for rematching",
        });
      } else {
        res.json(catalogIdentityUnavailable(cardId));
      }
      return;
    }
    const result = await refreshPricing({ cardId, ...identity, displayCurrency });
    res.json(result);
  } catch (err) {
    logger.error({ err, cardId }, "POST /pricing/cards/:id/refresh error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /pricing/cards/:id/history ────────────────────────────────────────────

router.get("/pricing/cards/:id/history", requireActiveUser, pricingReadLimiter, async (req: AuthRequest, res): Promise<void> => {
  const cardId = String(req.params["id"] ?? "").slice(0, 300);
  if (!cardId) {
    res.status(400).json({ message: "cardId is required" });
    return;
  }

  const gradeRaw = typeof req.query["grade"] === "string" ? req.query["grade"].trim() : "raw";
  const gradeKey = normalizeGradeKey(gradeRaw);
  if (!gradeKey || !isValidGradeKey(gradeKey)) {
    res.status(400).json({ message: "grade must be a supported Verified Market grade key" });
    return;
  }

  const periodRaw = typeof req.query["period"] === "string" ? req.query["period"].trim() : "30d";
  const periodDays = PERIOD_DAYS[periodRaw];
  if (periodDays == null) {
    res.status(400).json({ message: "period must be one of 7d, 30d, 90d, 3m, 180d, 6m, 1y, or all" });
    return;
  }
  const displayCurrency = typeof req.query["displayCurrency"] === "string"
    ? req.query["displayCurrency"].trim().toUpperCase()
    : "AUD";

  try {
    const result = await getPriceHistory({ cardId, gradeKey, periodDays, displayCurrency });
    res.json(result);
  } catch (err) {
    logger.error({ err, cardId }, "GET /pricing/cards/:id/history error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /pricing/scheduler/run ───────────────────────────────────────────────

router.post("/pricing/scheduler/run", async (req, res): Promise<void> => {
  const adminSecret = req.headers["x-admin-secret"];
  const expectedSecret = process.env.ADMIN_SECRET;

  if (!expectedSecret || adminSecret !== expectedSecret) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const maxCards = Math.min(
    Number.isInteger(body["maxCards"]) && (body["maxCards"] as number) > 0
      ? (body["maxCards"] as number)
      : 50,
    200,
  );

  if (!isPCConfigured()) {
    res.json({
      queued: 0,
      configured: false,
      message: "PriceCharting is not configured; no provider work was queued",
    });
    return;
  }

  try {
    const result = await runScheduledPricingBatch({
      maxCards,
      trigger: "admin",
      force: body["force"] === true,
    });
    res.json({
      queued: result.selectedCards,
      configured: result.configured,
      status: result.status,
      bucket: result.bucket,
      selectedEligibleCards: result.selectedCards,
      identityFailures: result.identityFailures,
      refreshSucceeded: result.refreshSucceeded,
      refreshFailed: result.refreshFailed,
      snapshotsCaptured: result.snapshotsCaptured,
      snapshotsSkipped: result.snapshotsSkipped,
    });
  } catch (err) {
    logger.error({ err }, "POST /pricing/scheduler/run error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /pricing/guides/import ───────────────────────────────────────────────
// One explicitly selected official category per protected invocation.
router.post("/pricing/guides/import", async (req, res): Promise<void> => {
  const expectedSecret = process.env.ADMIN_SECRET;
  if (!expectedSecret || req.headers["x-admin-secret"] !== expectedSecret) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  const category = (req.body as Record<string, unknown> | undefined)?.["category"];
  if (typeof category !== "string" || !(category in PRICECHARTING_GUIDE_CATEGORIES)) {
    res.status(400).json({ message: "category must be one of pokemon, magic, yugioh, or one_piece" });
    return;
  }
  try {
    const result = await importPriceChartingBulkGuide(category as keyof typeof PRICECHARTING_GUIDE_CATEGORIES);
    res.json(result);
  } catch (error) {
    if (error instanceof PriceChartingError) {
      const status = error.kind === "authentication" ? 502 : error.kind === "throttled" ? 429 : 503;
      res.status(status).json({
        errorCode: `pricecharting_${error.kind}`,
        message: error.message,
        ...(error.kind === "throttled" && error instanceof Error && "retryAfterMs" in error
          ? { retryAfterMs: (error as { retryAfterMs: number }).retryAfterMs }
          : {}),
      });
      return;
    }
    logger.error({ err: error }, "PriceCharting guide import failed");
    res.status(500).json({ message: "Guide import failed" });
  }
});

export default router;
