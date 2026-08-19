/**
 * Collector Announcements route — JWT-authenticated, in-app feed only.
 *
 * GET /api/collector/announcements
 *
 * Returns announcements that are visible to the authenticated collector:
 *   - status = 'published'  (manually published), OR
 *   - status = 'scheduled' AND scheduledPublishAt <= now  (auto-due)
 *   - audience != 'internal'  (never expose internal records)
 *   - audience filtered by subscription tier:
 *       'all_collectors' → visible to all
 *       'pro_collectors' → visible to pro only
 *       'free_collectors' → visible to free only
 *
 * This endpoint is an in-app read feed only. It does NOT imply or trigger
 * any push or email delivery.
 */

import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { db } from "@workspace/db";
import { announcementsTable, usersTable } from "@workspace/db";
import { and, desc, eq, lte, ne, or } from "drizzle-orm";

const collectorAnnouncementsRouter = Router();

collectorAnnouncementsRouter.get(
  "/collector/announcements",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;

    try {
      // Resolve the collector's subscription tier from the database
      const [userRow] = await db
        .select({ subscriptionTier: usersTable.subscriptionTier })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      const tier = userRow?.subscriptionTier === "pro" ? "pro" : "free";

      const now = new Date();

      // Fetch announcements matching:
      //   (status = 'published') OR (status = 'scheduled' AND scheduledPublishAt <= now)
      //   audience != 'internal'
      //   audience in ('all_collectors') OR audience matching the collector's tier
      const rows = await db
        .select({
          id: announcementsTable.id,
          title: announcementsTable.title,
          content: announcementsTable.content,
          audience: announcementsTable.audience,
          status: announcementsTable.status,
          scheduledPublishAt: announcementsTable.scheduledPublishAt,
          publishedAt: announcementsTable.publishedAt,
          createdAt: announcementsTable.createdAt,
        })
        .from(announcementsTable)
        .where(
          and(
            // Must be published or scheduled-and-due
            or(
              eq(announcementsTable.status, "published"),
              and(
                eq(announcementsTable.status, "scheduled"),
                lte(announcementsTable.scheduledPublishAt, now),
              ),
            ),
            // Never expose internal records
            ne(announcementsTable.audience, "internal"),
            // Audience-tier filter
            or(
              eq(announcementsTable.audience, "all_collectors"),
              tier === "pro"
                ? eq(announcementsTable.audience, "pro_collectors")
                : eq(announcementsTable.audience, "free_collectors"),
            ),
          ),
        )
        .orderBy(desc(announcementsTable.publishedAt), desc(announcementsTable.createdAt))
        .limit(50);

      res.json({
        announcements: rows.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content,
          audience: r.audience,
          publishedAt: r.publishedAt ?? r.scheduledPublishAt ?? r.createdAt,
          createdAt: r.createdAt,
        })),
        tier,
      });
    } catch (err) {
      console.error("[collectorAnnouncements] GET /api/collector/announcements:", err);
      res.status(500).json({ message: "Failed to load announcements" });
    }
  },
);

export default collectorAnnouncementsRouter;
