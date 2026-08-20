/**
 * GET  /admin/community/posts         — paginated post list with search/filter
 * GET  /admin/community/blocks        — paginated block list with search
 * POST /admin/community/posts/:id/moderate — moderate a post (visible/hidden/removed)
 *
 * Every mutation requires a non-empty reason in the request body.
 * "removed" additionally requires confirmation=REMOVE and recent auth.
 * All status changes write trust_status_history (domain: community_post) + audit in one transaction.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { postsTable, userBlocksTable } from "@workspace/db";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";
import {
  paramStr,
  paginationParams,
  checkRecentAuth,
  writeAudit,
  writeStatusHistory,
} from "./helpers.js";

export const communityRouter = Router();

// ── GET /admin/community/posts ────────────────────────────────────────────────

communityRouter.get(
  "/admin/community/posts",
  requireAdminPermission("community:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const search = q.search?.trim();
    const moderationStatus = q.status?.trim();

    try {
      const conditions = [];
      if (search) conditions.push(ilike(postsTable.body, `%${search}%`));
      if (moderationStatus && ["visible", "hidden", "removed"].includes(moderationStatus)) {
        conditions.push(eq(postsTable.moderationStatus, moderationStatus));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow, posts] = await Promise.all([
        db.select({ cnt: count() }).from(postsTable).where(where),
        db
          .select({
            id: postsTable.id,
            userId: postsTable.userId,
            body: postsTable.body,
            cardId: postsTable.cardId,
            cardName: postsTable.cardName,
            moderationStatus: postsTable.moderationStatus,
            moderationReason: postsTable.moderationReason,
            moderatedAt: postsTable.moderatedAt,
            createdAt: postsTable.createdAt,
            updatedAt: postsTable.updatedAt,
            userDisplayName: sql<string | null>`(SELECT display_name FROM users WHERE id = ${postsTable.userId} LIMIT 1)`,
            userUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${postsTable.userId} LIMIT 1)`,
          })
          .from(postsTable)
          .where(where)
          .orderBy(desc(postsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ posts, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin community posts list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/community/blocks ───────────────────────────────────────────────

communityRouter.get(
  "/admin/community/blocks",
  requireAdminPermission("community:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const search = q.search?.trim();

    try {
      const where = search
        ? or(
            sql`(SELECT username FROM users WHERE id = ${userBlocksTable.blockerUserId} LIMIT 1) ILIKE ${"%" + search + "%"}`,
            sql`(SELECT username FROM users WHERE id = ${userBlocksTable.blockedUserId} LIMIT 1) ILIKE ${"%" + search + "%"}`,
          )
        : undefined;

      const [totalRow, blocks] = await Promise.all([
        db.select({ cnt: count() }).from(userBlocksTable).where(where),
        db
          .select({
            blockerUserId: userBlocksTable.blockerUserId,
            blockedUserId: userBlocksTable.blockedUserId,
            createdAt: userBlocksTable.createdAt,
            blockerUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${userBlocksTable.blockerUserId} LIMIT 1)`,
            blockedUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${userBlocksTable.blockedUserId} LIMIT 1)`,
          })
          .from(userBlocksTable)
          .where(where)
          .orderBy(desc(userBlocksTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ blocks, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin community blocks list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/community/posts/:id/moderate ──────────────────────────────────

communityRouter.post(
  "/admin/community/posts/:id/moderate",
  requireAdminPermission("community:moderate"),
  async (req: AdminRequest, res): Promise<void> => {
    const postId = paramStr(req, "id");
    const { status, reason, confirmation } = req.body as {
      status?: string;
      reason?: string;
      confirmation?: string;
    };

    if (!postId) {
      res.status(400).json({ message: "Missing post id." });
      return;
    }
    if (!["visible", "hidden", "removed"].includes(status ?? "")) {
      res.status(400).json({ message: "status must be visible, hidden, or removed." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }
    if (status === "removed" && confirmation !== "REMOVE") {
      res.status(400).json({
        message: "Confirm removal by setting confirmation to REMOVE.",
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }

    // "removed" requires recent auth
    if (status === "removed" && !checkRecentAuth(req)) {
      res.status(403).json({
        message: "Confirm your password before this sensitive action.",
        code: "RECENT_AUTH_REQUIRED",
      });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: postsTable.id, moderationStatus: postsTable.moderationStatus })
          .from(postsTable)
          .where(eq(postsTable.id, postId))
          .for("update")
          .limit(1);

        if (!existing) return null;

        await tx
          .update(postsTable)
          .set({
            moderationStatus: status!,
            moderationReason: reason!.trim(),
            moderatedByAdminId: req.admin!.id,
            moderatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(postsTable.id, postId));

        // Status-bearing mutation: write status history for community_post domain
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "community_post",
          recordId: postId,
          fromStatus: existing.moderationStatus ?? null,
          toStatus: status!,
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: `post.${status}`,
          category: "community",
          severity: status === "removed" ? "high" : "info",
          targetType: "post",
          targetId: postId,
          reason: reason!.trim(),
          previousState: { moderationStatus: existing.moderationStatus },
          newState: { moderationStatus: status },
          requestId: req.id as string | undefined,
        });

        return { previousStatus: existing.moderationStatus };
      });

      if (!result) {
        res.status(404).json({ message: "Post not found." });
        return;
      }

      req.log.info({ postId, status, adminId: req.admin!.id }, "Admin moderated community post");
      res.json({ message: "Post moderated.", postId, status });
    } catch (err) {
      req.log.error({ err, postId }, "admin post moderation failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
