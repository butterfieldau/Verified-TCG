/**
 * Price history routes.
 *
 * GET  /catalog/cards/:id/price-history   — returns time-series price data from price_snapshots
 * POST /catalog/cards/:id/snapshot-prices  — records current eBay prices as a new snapshot
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { priceSnapshotsTable, wishlistItemsTable } from "@workspace/db";
import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createNotification } from "./notifications.js";
import { notificationsTable } from "@workspace/db";

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
  const res = await fetch(`${ebayFindingUrl(appId)}?${params.toString()}`, { signal });
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

// ── Routes ────────────────────────────────────────────────────────────────────

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
router.get("/catalog/cards/:id/price-history", async (req, res) => {
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
      source: "ebay_sold",
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
