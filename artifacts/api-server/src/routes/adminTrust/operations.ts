/**
 * GET /admin/operations/summary  — attention counts + recent audit + capability declarations
 * GET /admin/operations/activity — paginated immutable audit log
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  userReportsTable,
  postsTable,
  eventsTable,
  vendorsTable,
  certificationReviewsTable,
  verifiedDropsTable,
  adminAuditEventsTable,
} from "@workspace/db";
import { eq, desc, and, inArray, count } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";
import { paginationParams } from "./helpers.js";

export const operationsRouter = Router();

// ── GET /admin/operations/summary ─────────────────────────────────────────────

operationsRouter.get(
  "/admin/operations/summary",
  requireAdminPermission("operations:read"),
  async (req: AdminRequest, res): Promise<void> => {
    try {
      const [
        unresolvedReports,
        hiddenPosts,
        removedPosts,
        liveEvents,
        pausedEvents,
        pendingVendors,
        pendingCerts,
        draftDrops,
        recentAudit,
      ] = await Promise.all([
        db
          .select({ cnt: count() })
          .from(userReportsTable)
          // Include legacy "new"/"under_review" values alongside canonical vocabulary
          .where(inArray(userReportsTable.status, ["open", "in_review", "escalated", "new", "under_review"])),
        db
          .select({ cnt: count() })
          .from(postsTable)
          .where(eq(postsTable.moderationStatus, "hidden")),
        db
          .select({ cnt: count() })
          .from(postsTable)
          .where(eq(postsTable.moderationStatus, "removed")),
        db.select({ cnt: count() }).from(eventsTable).where(eq(eventsTable.status, "live")),
        db.select({ cnt: count() }).from(eventsTable).where(eq(eventsTable.status, "paused")),
        db.select({ cnt: count() }).from(vendorsTable).where(eq(vendorsTable.status, "pending")),
        db
          .select({ cnt: count() })
          .from(certificationReviewsTable)
          .where(eq(certificationReviewsTable.status, "pending")),
        db
          .select({ cnt: count() })
          .from(verifiedDropsTable)
          .where(eq(verifiedDropsTable.status, "draft")),
        db
          .select({
            id: adminAuditEventsTable.id,
            action: adminAuditEventsTable.action,
            category: adminAuditEventsTable.category,
            severity: adminAuditEventsTable.severity,
            targetType: adminAuditEventsTable.targetType,
            targetId: adminAuditEventsTable.targetId,
            adminId: adminAuditEventsTable.adminId,
            createdAt: adminAuditEventsTable.createdAt,
          })
          .from(adminAuditEventsTable)
          .orderBy(desc(adminAuditEventsTable.createdAt))
          .limit(10),
      ]);

      res.json({
        counts: {
          unresolvedReports: Number(unresolvedReports[0]?.cnt ?? 0),
          hiddenPosts: Number(hiddenPosts[0]?.cnt ?? 0),
          removedPosts: Number(removedPosts[0]?.cnt ?? 0),
          liveEvents: Number(liveEvents[0]?.cnt ?? 0),
          pausedEvents: Number(pausedEvents[0]?.cnt ?? 0),
          pendingVendors: Number(pendingVendors[0]?.cnt ?? 0),
          pendingCertifications: Number(pendingCerts[0]?.cnt ?? 0),
          draftDrops: Number(draftDrops[0]?.cnt ?? 0),
        },
        recentActivity: recentAudit,
        capabilities: {
          tradeOffers: {
            available: false,
            reason:
              "Trade offers between collectors are not yet implemented. The system tracks for-trade items and wishlist matching but a dedicated offer/negotiation flow does not exist.",
          },
          attendanceVerification: {
            available: false,
            reason:
              "QR-based check-in and real-time attendance scanning are not yet built. Event participation is self-reported via the join/leave API.",
          },
          providerWriteBack: {
            available: false,
            reason:
              "External PSA/BGS certification write-back is not supported. Admin can internally review cards but cannot submit to or receive responses from third-party grading services.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err }, "admin operations summary failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/activity ───────────────────────────────────────────────────────

operationsRouter.get(
  "/admin/operations/activity",
  requireAdminPermission("operations:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const category = q.category?.trim();
    const targetType = q.targetType?.trim();

    try {
      const conditions = [];
      if (category) conditions.push(eq(adminAuditEventsTable.category, category));
      if (targetType) conditions.push(eq(adminAuditEventsTable.targetType, targetType));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow, activity] = await Promise.all([
        db.select({ cnt: count() }).from(adminAuditEventsTable).where(where),
        db
          .select()
          .from(adminAuditEventsTable)
          .where(where)
          .orderBy(desc(adminAuditEventsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({
        activity,
        total: Number(totalRow[0]?.cnt ?? 0),
        page,
        limit,
      });
    } catch (err) {
      req.log.error({ err }, "admin activity list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
