/**
 * POST /scan/recognize
 *
 * Accepts a base64-encoded card image, calls GPT vision to extract card
 * name / set / number, searches the JustTCG catalog for matches, tracks
 * per-user monthly scan usage, and returns the top matches with confidence.
 *
 * Free users are limited to 30 scans per calendar month (FREE_SCAN_LIMIT).
 * Pro users are unlimited.
 *
 * Quota enforcement is fully atomic: a single conditional INSERT … ON CONFLICT
 * DO UPDATE statement reserves the scan slot before any expensive API call is
 * made.  No separate read-then-write path exists, so concurrent requests
 * cannot both pass the limit check.
 *
 * Body size: the /api/scan path is configured with a 12 MB JSON limit in
 * app.ts; this handler additionally validates the base64 payload directly.
 */
import { Router } from "express";
import express from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

const FREE_SCAN_LIMIT = 30;
const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";

/**
 * Maximum base64 image payload: 8 MB encoded ≈ ~6 MB JPEG.
 * Even at expo-camera's quality=0.5 this comfortably covers a full-resolution
 * mobile photo while bounding cost and request time.
 */
const MAX_IMAGE_B64_BYTES = 8 * 1024 * 1024; // 8 MB

// ── OpenAI client ──────────────────────────────────────────────────────────

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "placeholder",
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the first day of the current UTC calendar month as a Date. */
function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Atomically reserve a scan slot for a free-tier user.
 *
 * Uses a single INSERT … ON CONFLICT DO UPDATE … WHERE statement so the
 * check and increment happen inside one database round-trip.  The conditional
 * WHERE on the conflict branch means the row is only updated when the current
 * count is strictly below the limit — PostgreSQL's UPDATE … WHERE guarantee
 * makes this race-free even under high concurrency.
 *
 * Returns the new scan_count after increment, or null when the limit was
 * already reached (row was not updated).
 */
async function atomicReserveScan(
  userId: string,
  periodStart: Date,
  limit: number,
): Promise<number | null> {
  const result = await db.execute<{ scan_count: number }>(sql`
    INSERT INTO scan_usage (user_id, period_start, scan_count, updated_at)
    VALUES (${userId}, ${periodStart}, 1, NOW())
    ON CONFLICT ON CONSTRAINT scan_usage_user_period_uniq DO UPDATE
      SET scan_count = scan_usage.scan_count + 1,
          updated_at = NOW()
      WHERE scan_usage.scan_count < ${limit}
    RETURNING scan_count
  `);

  // RETURNING returns 0 rows when the WHERE condition was false (limit hit)
  if (!result.rows.length) return null;
  return result.rows[0]!.scan_count;
}

/**
 * Atomically record a scan for a Pro user (no limit enforced).
 * Returns the new scan_count (informational only).
 */
async function atomicRecordProScan(
  userId: string,
  periodStart: Date,
): Promise<number> {
  const result = await db.execute<{ scan_count: number }>(sql`
    INSERT INTO scan_usage (user_id, period_start, scan_count, updated_at)
    VALUES (${userId}, ${periodStart}, 1, NOW())
    ON CONFLICT ON CONSTRAINT scan_usage_user_period_uniq DO UPDATE
      SET scan_count = scan_usage.scan_count + 1,
          updated_at = NOW()
    RETURNING scan_count
  `);
  return result.rows[0]?.scan_count ?? 1;
}

/** Read the current scan count for informational purposes (no side effects). */
async function readScanCount(userId: string, periodStart: Date): Promise<number> {
  const rows = await db.execute<{ scan_count: number }>(sql`
    SELECT scan_count FROM scan_usage
    WHERE user_id = ${userId} AND period_start = ${periodStart}
    LIMIT 1
  `);
  return rows.rows[0]?.scan_count ?? 0;
}

/** Look up the subscription tier for a user. */
async function getUserTier(userId: string): Promise<string> {
  const [user] = await db
    .select({ subscriptionTier: usersTable.subscriptionTier })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.subscriptionTier ?? "free";
}

/** Call GPT vision to extract card name/number/set from the image. */
async function extractCardInfo(base64Image: string, mimeType: string): Promise<{
  name: string;
  setName: string;
  number: string;
  rawText: string;
}> {
  const response = await openai.chat.completions.create({
    model: "gpt-5-nano",
    max_completion_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: "low",
            },
          },
          {
            type: "text",
            text: `You are a trading card identifier. Look at this card image and extract:
1. Card name (the main character/entity name)
2. Set name (the expansion/set it belongs to)
3. Card number (e.g. "025/197" or "SV3 065")

Respond in this exact JSON format:
{"name":"<card name>","setName":"<set name>","number":"<card number>","rawText":"<all visible text on card>"}

If you cannot identify the card clearly, still return valid JSON with empty strings for fields you cannot read.`,
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as {
        name?: string;
        setName?: string;
        number?: string;
        rawText?: string;
      };
      return {
        name: parsed.name ?? "",
        setName: parsed.setName ?? "",
        number: parsed.number ?? "",
        rawText: parsed.rawText ?? content,
      };
    }
  } catch {
    // JSON parse failed — fall through
  }

  return { name: "", setName: "", number: "", rawText: content };
}

/** Search JustTCG catalog for cards matching extracted card text. */
async function searchCatalog(
  name: string,
  setName: string,
): Promise<Array<Record<string, unknown>>> {
  const key = process.env.JUSTTCG_API_KEY;
  if (!key) return [];

  const query = [name, setName].filter(Boolean).join(" ").trim();
  if (!query) return [];

  const params = new URLSearchParams({ q: query, limit: "5" });
  const resp = await fetch(`${JUSTTCG_BASE_URL}/cards?${params.toString()}`, {
    headers: { "x-api-key": key, accept: "application/json" },
  });

  if (!resp.ok) return [];

  const body = (await resp.json()) as { data?: unknown[] };
  return (body.data ?? []) as Array<Record<string, unknown>>;
}

/** Heuristic confidence score (0–99) for a catalog match vs. extracted text. */
function scoreMatch(
  card: Record<string, unknown>,
  extracted: { name: string; setName: string; number: string },
): number {
  const cardName = String(card.name ?? "").toLowerCase();
  const extractedName = extracted.name.toLowerCase();
  let score = 0;

  if (extractedName && cardName.includes(extractedName)) score += 55;
  else if (extractedName && extractedName.split(" ").some((w) => w.length > 3 && cardName.includes(w))) score += 30;

  const cardSet = String(card.set_name ?? card.set ?? "").toLowerCase();
  const exSet = extracted.setName.toLowerCase();
  if (exSet && cardSet.includes(exSet)) score += 30;
  else if (exSet && exSet.split(" ").some((w) => w.length > 3 && cardSet.includes(w))) score += 15;

  const cardNum = String(card.number ?? "").toLowerCase();
  const exNum = extracted.number.toLowerCase().replace(/\//g, "").trim();
  if (exNum && (cardNum.includes(exNum) || exNum.includes(cardNum))) score += 15;

  return Math.min(score, 99);
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /scan/recognize
 *
 * Body: { image: string (base64), mimeType?: string }
 * Auth: Bearer JWT required
 */
router.post("/scan/recognize", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;

  // These are hoisted so the outer catch can include quota context in 500 errors
  // that occur after the scan slot has been reserved.
  let isFreeTier = false;
  let periodStart = currentPeriodStart();
  let reservedScanCount: number | undefined;

  try {
    // 1. Parse and validate request body
    const { image, mimeType = "image/jpeg" } = req.body as {
      image?: string;
      mimeType?: string;
    };

    if (!image || typeof image !== "string") {
      res.status(400).json({ message: "image (base64 string) is required" });
      return;
    }

    // Validate image size to prevent cost exhaustion on the vision API
    const byteLen = Buffer.byteLength(image, "utf8");
    if (byteLen > MAX_IMAGE_B64_BYTES) {
      res.status(413).json({
        message: `Image too large (${Math.round(byteLen / 1024)} KB). Maximum is ${Math.round(MAX_IMAGE_B64_BYTES / 1024)} KB of base64 data.`,
      });
      return;
    }

    // Validate mime type is an image
    if (!mimeType.startsWith("image/")) {
      res.status(400).json({ message: "mimeType must be an image/* type" });
      return;
    }

    // 2. Get subscription tier
    const tier = await getUserTier(userId);
    isFreeTier = tier === "free";
    periodStart = currentPeriodStart();

    // 3. Atomically reserve a scan slot BEFORE calling the vision API.
    //    This prevents the vision API from being called when the user is over
    //    limit, and prevents race conditions where two concurrent requests both
    //    pass the same check.
    let newScanCount: number;

    if (isFreeTier) {
      // Pre-check: read current count so we can return a useful 403 before
      // attempting the atomic increment (avoids the useless INSERT path when
      // we already know the user is over limit).
      const currentCount = await readScanCount(userId, periodStart);
      if (currentCount >= FREE_SCAN_LIMIT) {
        res.status(403).json({
          message: "Monthly scan limit reached. Upgrade to Pro for unlimited scans.",
          scansUsed: currentCount,
          scanLimit: FREE_SCAN_LIMIT,
          scansRemaining: 0,
          periodStart: periodStart.toISOString(),
        });
        return;
      }

      // Atomically claim the slot (enforces the limit even under concurrency)
      const reserved = await atomicReserveScan(userId, periodStart, FREE_SCAN_LIMIT);
      if (reserved === null) {
        // Another concurrent request filled the last slot between our read and write
        res.status(403).json({
          message: "Monthly scan limit reached. Upgrade to Pro for unlimited scans.",
          scansUsed: FREE_SCAN_LIMIT,
          scanLimit: FREE_SCAN_LIMIT,
          scansRemaining: 0,
          periodStart: periodStart.toISOString(),
        });
        return;
      }

      newScanCount = reserved;
    } else {
      // Pro users — record the scan but don't enforce any limit
      newScanCount = await atomicRecordProScan(userId, periodStart);
    }

    // Expose to outer catch so it can include quota data on unexpected errors
    reservedScanCount = newScanCount;

    // 4. Call vision API (scan slot is already reserved; if this fails the
    //    count is still incremented — recognition attempts count regardless
    //    of API errors, matching the product spec intent for quota usage)
    let extracted: { name: string; setName: string; number: string; rawText: string };
    try {
      extracted = await extractCardInfo(image, mimeType);
    } catch (err) {
      // Log the full error server-side; only return a sanitized message to the client.
      console.error("[scan] Vision API error:", err instanceof Error ? err.message : String(err));
      res.status(503).json({
        message: "Card recognition service is temporarily unavailable. Please try searching manually.",
        // Return updated scan count so the client stays in sync even on failure
        scansUsed: newScanCount,
        scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
        scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - newScanCount) : null,
        periodStart: periodStart.toISOString(),
      });
      return;
    }

    // 5. Detect whether GPT could read any text at all.
    //    Both name and setName being empty is a strong signal the image was
    //    blurry, too dark, or the card was out of frame — not just a catalog miss.
    const imageUnreadable = extracted.name.trim() === "" && extracted.setName.trim() === "";

    // 6. Search catalog for matches (skip the catalog call when GPT read nothing)
    const catalogResults = imageUnreadable
      ? []
      : await searchCatalog(extracted.name, extracted.setName);

    // 7. Score and rank matches
    const matches = catalogResults
      .map((card) => ({ card, confidence: scoreMatch(card, extracted) }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    const topMatch = matches[0];
    const hasMatch = topMatch !== undefined && topMatch.confidence >= 20;
    const scansRemaining = isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - newScanCount) : null;

    // 8. Return results
    res.json({
      extracted: {
        name: extracted.name,
        setName: extracted.setName,
        number: extracted.number,
      },
      matches: hasMatch ? matches.map(({ card, confidence }) => ({ card, confidence })) : [],
      topMatch: hasMatch ? { card: topMatch.card, confidence: topMatch.confidence } : null,
      lowConfidence: hasMatch && topMatch.confidence < 50,
      // imageUnreadable = true means GPT returned no text at all — the image
      // was likely blurry, too dark, or the card was partially out of frame.
      // Clients should show a more specific message than "no match found".
      imageUnreadable,
      scansUsed: newScanCount,
      scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
      scansRemaining,
      periodStart: periodStart.toISOString(),
    });
  } catch (err) {
    // Include quota data if a scan slot was already reserved before the error.
    // This ensures the client can sync the accurate count even for unexpected
    // server errors that occur after reservation (e.g. DB failures mid-handler).
    const quotaPayload = reservedScanCount !== undefined
      ? {
          scansUsed: reservedScanCount,
          scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
          scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - reservedScanCount) : null,
          periodStart: periodStart.toISOString(),
        }
      : {};

    // Log full error server-side; return only a sanitized message to the client.
    console.error("[scan] Unexpected error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({
      message: "Something went wrong during card recognition. Please try again.",
      ...quotaPayload,
    });
  }
});

/**
 * GET /scan/usage
 * Returns current-period scan count for the authenticated user.
 */
router.get("/scan/usage", requireActiveUser, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const tier = await getUserTier(userId);
    const isFreeTier = tier === "free";
    const periodStart = currentPeriodStart();
    const scansUsed = await readScanCount(userId, periodStart);

    res.json({
      scansUsed,
      scanLimit: isFreeTier ? FREE_SCAN_LIMIT : null,
      scansRemaining: isFreeTier ? Math.max(0, FREE_SCAN_LIMIT - scansUsed) : null,
      periodStart: periodStart.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch scan usage" });
  }
});

export default router;
