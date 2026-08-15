/**
 * Activity routes — per-user, JWT-authenticated.
 *
 * GET /api/me/activity?limit=10
 *   Returns the most recent activity_log rows for the signed-in user,
 *   formatted for the Home screen Recent Activity section.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const router = Router();

/** Maximum items the client may request in one call. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function eventDescription(
  eventType: string,
  entityName: string | null,
): string {
  const name = entityName ?? "a card";
  switch (eventType) {
    case "card_added": return `Added ${name} to collection`;
    case "card_removed": return `Removed ${name} from collection`;
    case "wishlist_added": return `Added ${name} to wishlist`;
    case "wishlist_removed": return `Removed ${name} from wishlist`;
    case "price_alert_fired": return `Price alert triggered for ${name}`;
    case "collection_updated": return `Updated ${name} in collection`;
    default: return `Activity for ${name}`;
  }
}

// ── GET /api/me/activity ─────────────────────────────────────────────────────

router.get("/me/activity", requireActiveUser, async (req: AuthRequest, res) => {
  const limitParam = parseInt(String(req.query["limit"] ?? DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const rows = await db
    .select()
    .from(activityLogTable)
    .where(eq(activityLogTable.userId, req.userId!))
    .orderBy(desc(activityLogTable.createdAt))
    .limit(limit);

  const items = rows.map((row) => {
    const meta = row.metadata as Record<string, unknown> | null;
    return {
      id: row.id,
      type: row.eventType,
      description: eventDescription(row.eventType, row.entityName),
      entityId: row.entityId ?? null,
      entityName: row.entityName ?? null,
      cardImageUrl: (meta?.cardImageUrl as string | undefined) ?? null,
      timeAgo: timeAgo(row.createdAt),
      createdAt: row.createdAt.toISOString(),
    };
  });

  return res.json({ items });
});

// ── Helper exported for use in mutation routes ────────────────────────────────

export type ActivityEventType =
  | "card_added"
  | "card_removed"
  | "wishlist_added"
  | "wishlist_removed"
  | "price_alert_fired"
  | "collection_updated";

/**
 * Fire-and-forget activity log insert.
 * Errors are swallowed so a logging failure never fails the main operation.
 */
export function logActivity(
  userId: string,
  eventType: ActivityEventType,
  entityId: string | null,
  entityName: string | null,
  metadata?: Record<string, unknown>,
): void {
  db.insert(activityLogTable)
    .values({
      userId,
      eventType,
      entityId,
      entityName,
      metadata: metadata ?? null,
    })
    .catch(() => {/* swallow logging errors */});
}

export default router;
