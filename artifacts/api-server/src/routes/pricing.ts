/**
 * Pricing API routes.
 *
 * GET  /pricing/cards/:id                   — get current pricing
 * POST /pricing/cards/:id/refresh           — force refresh pricing
 * GET  /pricing/cards/:id/history           — price history
 * POST /pricing/scheduler/run               — enqueue batch pricing (admin)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { logger } from "../lib/logger.js";
import {
  getPricing,
  getPricingMappingState,
  refreshPricing,
  refreshPricingForScheduler,
  recordSchedulerIdentityFailure,
  getPriceHistory,
} from "../pricing/service.js";
import { isValidGradeKey } from "../pricing/grades.js";
import { captureAllPortfolioSnapshots } from "../pricing/portfolio.js";
import { pricingReadLimiter, pricingRefreshLimiter } from "../lib/rateLimiters.js";
import {
  isPCConfigured,
  PROVIDER_KEY,
  PROVIDER_LABEL,
} from "../pricing/pricecharting.js";
import { resolveCatalogCardById } from "./catalog.js";

const router = Router();

const PERIOD_DAYS: Record<string, number> = {
  "7d":  7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
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

interface ScheduledCardRow extends Record<string, unknown> {
  card_id: string;
  card_data: Record<string, unknown>;
}

/**
 * Fair bounded scheduler selection. Never-attempted cards come first, then
 * cards whose mapping/quote was refreshed least recently. The query spans the
 * complete eligible set rather than repeatedly reading a fixed first page.
 */
export async function selectCardsForScheduledRefresh(
  maxCards: number,
  options: { cardIdPrefix?: string } = {},
): Promise<Array<{ cardId: string; cardData: Record<string, unknown> }>> {
  const result = await db.execute<ScheduledCardRow>(sql`
    WITH eligible AS (
      SELECT card_id, card_data, created_at, 1 AS source_priority
      FROM collection_items
      UNION ALL
      SELECT card_id, card_data, created_at, 2 AS source_priority
      FROM wishlist_items
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT card_id, card_data, created_at, 3 AS source_priority
      FROM sold_archive_items
    ),
    deduped AS (
      SELECT DISTINCT ON (card_id)
        card_id, card_data, created_at
      FROM eligible
      ORDER BY card_id, source_priority, created_at
    ),
    attempts AS (
      SELECT card_id, MAX(updated_at) AS last_attempt
      FROM card_provider_mappings
      WHERE provider_key = 'pricecharting'
      GROUP BY card_id
    ),
    quote_refreshes AS (
      SELECT card_id, MAX(fetched_at) AS last_quote
      FROM current_quotes
      WHERE provider_key = 'pricecharting'
      GROUP BY card_id
    )
    SELECT d.card_id, d.card_data
    FROM deduped d
    LEFT JOIN attempts a ON a.card_id = d.card_id
    LEFT JOIN quote_refreshes q ON q.card_id = d.card_id
    WHERE (${options.cardIdPrefix ?? null}::text IS NULL OR d.card_id LIKE ${`${options.cardIdPrefix ?? ""}%`})
    ORDER BY
      GREATEST(
        COALESCE(a.last_attempt, '-infinity'::timestamptz),
        COALESCE(q.last_quote, '-infinity'::timestamptz)
      ) ASC,
      d.created_at ASC,
      d.card_id ASC
    LIMIT ${maxCards}
  `);
  return result.rows.map(row => ({ cardId: row.card_id, cardData: row.card_data }));
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
  const gradeKey = gradeRaw;
  if (!isValidGradeKey(gradeKey)) {
    res.status(400).json({ message: "grade must be a supported Verified Market grade key" });
    return;
  }

  const periodRaw = typeof req.query["period"] === "string" ? req.query["period"].trim() : "30d";
  const periodDays = PERIOD_DAYS[periodRaw];
  if (periodDays == null) {
    res.status(400).json({ message: "period must be one of 7d, 30d, 90d, 180d, 1y, or all" });
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
    const eligibleRows = await selectCardsForScheduledRefresh(maxCards);

    const cards = eligibleRows.map(row => ({ cardId: row.cardId }));

    // Background work remains bounded by maxCards and every provider attempt
    // passes through the shared one-request-per-second queue.
    void (async () => {
      const verifiedCards: Array<{
        cardId: string;
        name: string;
        set?: string;
        number?: string;
        game?: string;
      }> = [];
      for (let index = 0; index < cards.length; index += 10) {
        const batch = cards.slice(index, index + 10);
        const resolved = await Promise.all(
          batch.map(async card => {
            const catalogCard = await resolveCatalogCardById(card.cardId).catch(() => null);
            const identity = catalogCard ? identityFromCatalogCard(catalogCard.card) : null;
            if (!identity) {
              await recordSchedulerIdentityFailure(card.cardId);
              return null;
            }
            return { cardId: card.cardId, ...identity };
          }),
        );
        verifiedCards.push(...resolved.filter((card): card is NonNullable<typeof card> => card !== null));
      }
      await Promise.allSettled(verifiedCards.map(card => refreshPricingForScheduler(card)));
      await captureAllPortfolioSnapshots();
    })().catch((err: unknown) => {
      logger.error({ err }, "Scheduled pricing/snapshot batch failed");
    });

    res.json({
      queued: cards.length,
      configured: true,
      selectedEligibleCards: eligibleRows.length,
    });
  } catch (err) {
    logger.error({ err }, "POST /pricing/scheduler/run error");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
