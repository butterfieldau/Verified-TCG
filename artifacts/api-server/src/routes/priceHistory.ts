/**
 * eBay completed-sale history and snapshots.
 *
 * GET  /catalog/cards/:id/ebay-sold-history — normalized individual sales
 * GET  /catalog/cards/:id/price-history     — persisted completed-sale medians
 * POST /catalog/cards/:id/snapshot-prices   — records current successful medians
 */
import { Router } from "express";
import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { db, notificationsTable, priceSnapshotsTable, wishlistItemsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { createNotification } from "./notifications.js";
import { requireActiveUser, requireProUser, type AuthRequest } from "../lib/authMiddleware.js";
import {
  EBAY_GRADE_SPECS,
  getEbayCompletedSales,
  isEbayGradeKey,
  medianCompletedSalePrice,
  type EbayCompletedSale,
  type EbaySalesAvailability,
} from "../lib/ebaySales.js";
import { resolveCatalogCardById } from "./catalog.js";

const router = Router();

const MAX_FIELD_LEN = 120;
const ALLOWED_GAMES = new Set([
  "pokemon", "onepiece", "yugioh", "lorcana", "dragonball", "magic",
]);

function catalogGameToEbayGame(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("pokemon")) return "pokemon";
  if (normalized.includes("one piece")) return "onepiece";
  if (normalized.includes("yu-gi") || normalized.includes("yugioh")) return "yugioh";
  if (normalized.includes("lorcana")) return "lorcana";
  if (normalized.includes("dragon")) return "dragonball";
  if (normalized.includes("magic")) return "magic";
  return null;
}

function canonicalSnapshotIdentity(card: Record<string, unknown>): {
  name: string;
  setName: string;
  game: string;
  number: string;
} | null {
  const name = typeof card.name === "string" ? card.name.trim() : "";
  const setName = typeof card.set_name === "string"
    ? card.set_name.trim()
    : typeof card.set === "string"
      ? card.set.trim()
      : "";
  const number = typeof card.number === "string" ? card.number.trim() : "";
  const game = catalogGameToEbayGame(card.game);
  if (!name || !setName || !number || !game) return null;
  return { name, setName, game, number };
}
const DISPLAY_CURRENCIES = new Set(["AUD", "USD", "GBP", "EUR", "CAD", "NZD"]);
const PERIOD_DAYS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: 36_500,
};
const SNAPSHOT_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_RATE_WINDOW = 60_000;
const SNAPSHOT_RATE_MAX = 10;
const HISTORY_RATE_WINDOW = 60_000;
const HISTORY_RATE_MAX = 20;

type RateBucket = { count: number; windowStart: number };
type EbayHistoryCoverage = "returned_results" | "provider_limited";

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

const snapshotRateBuckets = new Map<string, RateBucket>();
const historyRateBuckets = new Map<string, RateBucket>();
const snapshotInFlight = new Map<string, Promise<void>>();

function rateLimited(buckets: Map<string, RateBucket>, ip: string, window: number, max: number): boolean {
  const now = Date.now();
  const existing = buckets.get(ip);
  if (!existing || now - existing.windowStart > window) {
    buckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (existing.count >= max) return true;
  existing.count += 1;
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of snapshotRateBuckets) {
    if (now - bucket.windowStart > SNAPSHOT_RATE_WINDOW) snapshotRateBuckets.delete(ip);
  }
  for (const [ip, bucket] of historyRateBuckets) {
    if (now - bucket.windowStart > HISTORY_RATE_WINDOW) historyRateBuckets.delete(ip);
  }
}, HISTORY_RATE_WINDOW);

function trendFromSales(
  sales: EbayCompletedSale[],
  currency: string,
): { points: EbayTrendPoint[]; movement: EbayMovement | null } {
  const daily = new Map<string, number[]>();
  for (const sale of sales) {
    const date = sale.endedAt.slice(0, 10);
    const values = daily.get(date) ?? [];
    values.push(sale.price);
    daily.set(date, values);
  }
  const points = [...daily.entries()]
    .map(([date, prices]) => {
      const price = Math.round((prices.reduce((sum, value) => sum + value, 0) / prices.length) * 100) / 100;
      return { date, price, priceCents: Math.round(price * 100), currency };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 2) return { points, movement: null };
  const first = points[0]!.price;
  const last = points[points.length - 1]!.price;
  const absolute = Math.round((last - first) * 100) / 100;
  return {
    points,
    movement: {
      absolute,
      percent: first === 0 ? 0 : Math.round((absolute / first) * 10_000) / 100,
      direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "flat",
    },
  };
}

function ebayHistoryResponse(
  cardId: string,
  gradeKey: string,
  period: string,
  currency: string,
  availability: EbaySalesAvailability,
  message: string | null,
  sales: EbayCompletedSale[] = [],
  coverage: EbayHistoryCoverage = "returned_results",
) {
  const trend = trendFromSales(sales, currency);
  return {
    cardId,
    gradeKey,
    period,
    currency,
    source: "ebay_completed_sales" as const,
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

function historyUnavailable(
  cardId: string,
  gradeKey: string,
  period: string,
  currency: string,
  availability: EbaySalesAvailability,
  message: string | null,
  coverage: EbayHistoryCoverage,
) {
  return ebayHistoryResponse(cardId, gradeKey, period, currency, availability, message, [], coverage);
}

/**
 * Gets individually validated sales and an eBay-only trend calculated solely
 * from those returned sales. Query terms and provider payloads never leave the
 * server.
 */
router.get("/catalog/cards/:id/ebay-sold-history", requireProUser, async (req: AuthRequest, res): Promise<void> => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (rateLimited(historyRateBuckets, ip, HISTORY_RATE_WINDOW, HISTORY_RATE_MAX)) {
    res.status(429).json({ error: "Too many eBay sold-history requests. Please try again shortly." });
    return;
  }

  const rawCardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cardId = String(rawCardId ?? "").trim();
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const setName = typeof req.query.set === "string" ? req.query.set.trim() : "";
  const game = typeof req.query.game === "string" ? req.query.game.trim().toLowerCase() : "";
  const number = typeof req.query.number === "string" ? req.query.number.trim() : "";
  const gradeKey = typeof req.query.grade === "string" ? req.query.grade.trim().toLowerCase() : "raw";
  const period = typeof req.query.period === "string" ? req.query.period.trim().toLowerCase() : "30d";
  const currency = typeof req.query.displayCurrency === "string"
    ? req.query.displayCurrency.trim().toUpperCase()
    : "AUD";

  if (!cardId || cardId.length > 200) {
    res.status(400).json({ error: "A valid card id is required." });
    return;
  }
  if (!name || name.length > MAX_FIELD_LEN) {
    res.status(400).json({ error: "name is required and must be ≤ 120 characters" });
    return;
  }
  if (!setName || setName.length > MAX_FIELD_LEN) {
    res.status(400).json({ error: "set is required and must be ≤ 120 characters" });
    return;
  }
  if (!ALLOWED_GAMES.has(game)) {
    res.status(400).json({ error: "game must be a supported TCG identifier" });
    return;
  }
  if (!number || number.length > 60) {
    res.status(400).json({ error: "number is required and must be ≤ 60 characters" });
    return;
  }
  if (!isEbayGradeKey(gradeKey)) {
    res.status(400).json({ error: "grade must be a supported eBay history grade" });
    return;
  }
  if (!(period in PERIOD_DAYS)) {
    res.status(400).json({ error: "period must be 7d, 30d, 90d, 1y, or all" });
    return;
  }
  if (!DISPLAY_CURRENCIES.has(currency)) {
    res.status(400).json({ error: "displayCurrency is not supported" });
    return;
  }

  const completed = await getEbayCompletedSales({
    name,
    setName,
    game,
    number,
    gradeKey,
    since: new Date(Date.now() - PERIOD_DAYS[period]! * 24 * 60 * 60 * 1_000),
    displayCurrency: currency,
    limit: 200,
  });

  if (completed.availability !== "available") {
    res.json(historyUnavailable(
      cardId,
      gradeKey,
      period,
      currency,
      completed.availability,
      completed.message,
      completed.coverage,
    ));
    return;
  }

  res.json(ebayHistoryResponse(
    cardId,
    gradeKey,
    period,
    currency,
    "available",
    completed.message,
    completed.sales,
    completed.coverage,
  ));
});

/**
 * Returns daily price snapshot medians. Only snapshots sourced from successful
 * eBay completed-sale adapter responses are written.
 */
router.get("/catalog/cards/:id/price-history", requireProUser, async (req: AuthRequest, res): Promise<void> => {
  try {
    const rawCardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const cardId = String(rawCardId ?? "").trim();
    const gradeKey = typeof req.query.grade === "string" ? req.query.grade.toLowerCase().trim() : "raw";
    const period = typeof req.query.period === "string" ? req.query.period.toLowerCase().trim() : "30d";
    const days = PERIOD_DAYS[period] ?? 30;
    if (!cardId || cardId.length > 200 || !isEbayGradeKey(gradeKey)) {
      res.status(400).json({ error: "A valid card id and supported grade are required." });
      return;
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
    const rows = await db
      .select({
        date: sql<string>`DATE(${priceSnapshotsTable.recordedAt})::text`,
        price: sql<number>`ROUND(AVG(${priceSnapshotsTable.priceCents}) / 100.0, 2)`,
      })
      .from(priceSnapshotsTable)
      .where(and(
        eq(priceSnapshotsTable.cardId, cardId),
        eq(priceSnapshotsTable.gradeKey, gradeKey),
        eq(priceSnapshotsTable.source, "ebay_completed_sales"),
        gte(priceSnapshotsTable.recordedAt, since),
      ))
      .groupBy(sql`DATE(${priceSnapshotsTable.recordedAt})`)
      .orderBy(asc(sql`DATE(${priceSnapshotsTable.recordedAt})`));

    const latest = await db
      .select({ recordedAt: priceSnapshotsTable.recordedAt })
      .from(priceSnapshotsTable)
      .where(and(
        eq(priceSnapshotsTable.cardId, cardId),
        eq(priceSnapshotsTable.gradeKey, gradeKey),
        eq(priceSnapshotsTable.source, "ebay_completed_sales"),
      ))
      .orderBy(sql`${priceSnapshotsTable.recordedAt} DESC`)
      .limit(1);

    res.json({
      points: rows.map((row) => ({ date: row.date, price: Number(row.price) })),
      updatedAt: latest[0]?.recordedAt?.toISOString() ?? null,
      source: "ebay_completed_sales",
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Database error" });
  }
});

async function createPriceAlerts(cardId: string, inserts: {
  cardId: string;
  gradeKey: string;
  priceCents: number;
  currency: string;
  source: string;
}[]): Promise<void> {
  const rawInsert = inserts.find((insert) => insert.gradeKey === "raw");
  if (!rawInsert) return;

  const alertItems = await db
    .select({
      userId: wishlistItemsTable.userId,
      itemId: wishlistItemsTable.itemId,
      cardData: wishlistItemsTable.cardData,
      targetPrice: wishlistItemsTable.targetPrice,
    })
    .from(wishlistItemsTable)
    .where(and(
      eq(wishlistItemsTable.cardId, cardId),
      eq(wishlistItemsTable.priceAlertEnabled, true),
      isNull(wishlistItemsTable.deletedAt),
    ));
  const dedupCutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000);

  for (const item of alertItems) {
    if (item.targetPrice == null || rawInsert.priceCents > item.targetPrice) continue;
    const recent = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, item.userId),
        eq(notificationsTable.type, "price_alert"),
        sql`${notificationsTable.metadata}->>'cardId' = ${cardId}`,
        gt(notificationsTable.createdAt, dedupCutoff),
      ))
      .limit(1);
    if (recent.length > 0) continue;

    const card = item.cardData as { name?: string; setName?: string };
    const cardName = card.name ?? cardId;
    const setName = card.setName ?? "";
    const currentPrice = (rawInsert.priceCents / 100).toLocaleString("en-AU", {
      style: "currency",
      currency: "AUD",
    });
    const target = (item.targetPrice / 100).toLocaleString("en-AU", {
      style: "currency",
      currency: "AUD",
    });
    await createNotification({
      userId: item.userId,
      type: "price_alert",
      title: `Price Alert — ${cardName}`,
      body: `${cardName}${setName ? ` (${setName})` : ""} has dropped to ${currentPrice} — at or below your target of ${target}.`,
      metadata: {
        cardId,
        cardName,
        currentPriceCents: rawInsert.priceCents,
        targetPriceCents: item.targetPrice,
      },
    }).catch((error: unknown) => {
      logger.error({ error, cardId, userId: item.userId }, "Failed to create price-alert notification");
    });
  }
}

/**
 * Records raw and graded price medians only when the completed-sales adapter
 * has genuine, successfully converted evidence for that exact grade.
 */
router.post("/catalog/cards/:id/snapshot-prices", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(snapshotRateBuckets, ip, SNAPSHOT_RATE_WINDOW, SNAPSHOT_RATE_MAX)) {
    res.status(429).json({ error: "Too many requests. Please try again shortly." });
    return;
  }

  const rawCardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const cardId = String(rawCardId ?? "").trim();
  if (!cardId || cardId.length > 200) {
    res.status(400).json({ error: "card id is required and must be ≤ 200 characters" });
    return;
  }
  let identity: ReturnType<typeof canonicalSnapshotIdentity>;
  try {
    const resolved = await resolveCatalogCardById(cardId);
    identity = resolved ? canonicalSnapshotIdentity(resolved.card) : null;
  } catch {
    res.status(503).json({ error: "Catalog identity is temporarily unavailable; price snapshot was not recorded" });
    return;
  }
  if (!identity) {
    res.status(404).json({ error: "A canonical catalog card is required to record completed-sale history" });
    return;
  }

  res.status(204).send();
  if (snapshotInFlight.has(cardId)) return;

  const job = (async () => {
    const freshCutoff = new Date(Date.now() - SNAPSHOT_FRESHNESS_MS);
    const existing = await db
      .select({ id: priceSnapshotsTable.id })
      .from(priceSnapshotsTable)
      .where(and(
        eq(priceSnapshotsTable.cardId, cardId),
        eq(priceSnapshotsTable.source, "ebay_completed_sales"),
        gte(priceSnapshotsTable.recordedAt, freshCutoff),
      ))
      .limit(1);
    if (existing.length > 0) return;

    const results = await Promise.all(
      EBAY_GRADE_SPECS.map(async (grade) => ({
        gradeKey: grade.key,
        result: await getEbayCompletedSales({
          ...identity,
          gradeKey: grade.key,
          since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000),
          displayCurrency: "AUD",
          limit: 100,
        }),
      })),
    );
    const inserts = results.flatMap(({ gradeKey, result }) => {
      if (result.availability !== "available") return [];
      const median = medianCompletedSalePrice(result.sales);
      if (median == null) return [];
      return [{
        cardId,
        gradeKey,
        priceCents: Math.round(median * 100),
        currency: "AUD",
        source: "ebay_completed_sales",
      }];
    });
    if (inserts.length === 0) return;

    await db.insert(priceSnapshotsTable).values(inserts);
    await createPriceAlerts(cardId, inserts);
  })()
    .catch((error: unknown) => {
      logger.error({ error, cardId }, "Completed-sale snapshot job failed");
    })
    .finally(() => snapshotInFlight.delete(cardId));
  snapshotInFlight.set(cardId, job);
});

export default router;