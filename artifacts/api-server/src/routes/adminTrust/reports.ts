/**
 * GET  /admin/reports               — paginated list with filters
 * GET  /admin/reports/:id           — detail with notes, previous count, block relationships
 * POST /admin/reports/:id/assign    — self-assign / unassign; reason required
 * POST /admin/reports/:id/notes     — append moderation note; {note, reason} required; audit written
 * POST /admin/reports/:id/outcome   — set status; reason required; writes history + audit
 * POST /admin/reports/:id/suspend-user — suspend reported user; requires reports:moderate +
 *                                        users:manage + recent auth + OWNER role + reason +
 *                                        confirmation=SUSPEND (owner-only, independent of perms)
 *
 * Every mutation requires a non-empty reason from the request body.
 * Every status change writes trust_status_history (domain: report) transactionally.
 * Note endpoints require {note, reason} and write an audit row in the same transaction.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  userReportsTable,
  userBlocksTable,
  usersTable,
  userSessionsTable,
  moderationNotesTable,
  trustStatusHistoryTable,
} from "@workspace/db";
import { eq, desc, asc, and, or, isNull, ne, count, sql } from "drizzle-orm";
import {
  requireAdminPermission,
  requireRecentAdminAuth,
  requireOwner,
  type AdminRequest,
} from "../../lib/adminSession.js";
import { paramStr, paginationParams, writeAudit, writeStatusHistory } from "./helpers.js";

export const reportsRouter = Router();

const VALID_OUTCOMES = ["new", "under_review", "actioned", "dismissed", "escalated"] as const;

// ── GET /admin/reports ────────────────────────────────────────────────────────

reportsRouter.get(
  "/admin/reports",
  requireAdminPermission("reports:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const status = q.status?.trim();
    const assignedTo = q.assignedTo?.trim();
    const search = q.search?.trim();

    try {
      const conditions = [];
      if (status) conditions.push(eq(userReportsTable.status, status));
      if (assignedTo === "me") {
        conditions.push(eq(userReportsTable.assignedAdminId, req.admin!.id));
      } else if (assignedTo === "unassigned") {
        conditions.push(isNull(userReportsTable.assignedAdminId));
      }
      if (search) {
        conditions.push(
          or(
            sql`(SELECT username FROM users WHERE id = ${userReportsTable.reporterUserId} LIMIT 1) ILIKE ${"%" + search + "%"}`,
            sql`(SELECT username FROM users WHERE id = ${userReportsTable.reportedUserId} LIMIT 1) ILIKE ${"%" + search + "%"}`,
          )!,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow, reports] = await Promise.all([
        db.select({ cnt: count() }).from(userReportsTable).where(where),
        db
          .select({
            id: userReportsTable.id,
            reason: userReportsTable.reason,
            note: userReportsTable.note,
            status: userReportsTable.status,
            priority: userReportsTable.priority,
            severity: userReportsTable.severity,
            assignedAdminId: userReportsTable.assignedAdminId,
            resolutionReason: userReportsTable.resolutionReason,
            escalatedAt: userReportsTable.escalatedAt,
            createdAt: userReportsTable.createdAt,
            updatedAt: userReportsTable.updatedAt,
            reporterUserId: userReportsTable.reporterUserId,
            reportedUserId: userReportsTable.reportedUserId,
            reporterUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${userReportsTable.reporterUserId} LIMIT 1)`,
            reporterDisplayName: sql<string | null>`(SELECT display_name FROM users WHERE id = ${userReportsTable.reporterUserId} LIMIT 1)`,
            reportedUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${userReportsTable.reportedUserId} LIMIT 1)`,
            reportedDisplayName: sql<string | null>`(SELECT display_name FROM users WHERE id = ${userReportsTable.reportedUserId} LIMIT 1)`,
          })
          .from(userReportsTable)
          .where(where)
          .orderBy(desc(userReportsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ reports, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin reports list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/reports/:id ────────────────────────────────────────────────────

reportsRouter.get(
  "/admin/reports/:id",
  requireAdminPermission("reports:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const reportId = paramStr(req, "id");
    if (!reportId) {
      res.status(400).json({ message: "Missing report id." });
      return;
    }

    try {
      const [report] = await db
        .select()
        .from(userReportsTable)
        .where(eq(userReportsTable.id, reportId))
        .limit(1);

      if (!report) {
        res.status(404).json({ message: "Report not found." });
        return;
      }

      const [notes, previousCount, blocks, statusHistory] = await Promise.all([
        db
          .select()
          .from(moderationNotesTable)
          .where(eq(moderationNotesTable.reportId, reportId))
          .orderBy(asc(moderationNotesTable.createdAt)),
        db
          .select({ cnt: count() })
          .from(userReportsTable)
          .where(
            and(
              eq(userReportsTable.reportedUserId, report.reportedUserId),
              ne(userReportsTable.id, reportId),
            ),
          ),
        db
          .select({
            blockerUserId: userBlocksTable.blockerUserId,
            blockedUserId: userBlocksTable.blockedUserId,
            createdAt: userBlocksTable.createdAt,
          })
          .from(userBlocksTable)
          .where(
            or(
              eq(userBlocksTable.blockerUserId, report.reportedUserId),
              eq(userBlocksTable.blockedUserId, report.reportedUserId),
            )!,
          ),
        db
          .select()
          .from(trustStatusHistoryTable)
          .where(
            and(
              eq(trustStatusHistoryTable.domain, "report"),
              eq(trustStatusHistoryTable.recordId, reportId),
            ),
          )
          .orderBy(asc(trustStatusHistoryTable.createdAt)),
      ]);

      res.json({
        report,
        notes,
        previousReportCount: Number(previousCount[0]?.cnt ?? 0),
        relatedBlocks: blocks,
        statusHistory,
      });
    } catch (err) {
      req.log.error({ err, reportId }, "admin report detail failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/reports/:id/assign ────────────────────────────────────────────

reportsRouter.post(
  "/admin/reports/:id/assign",
  requireAdminPermission("reports:moderate"),
  async (req: AdminRequest, res): Promise<void> => {
    const reportId = paramStr(req, "id");
    const { assignTo, reason } = req.body as {
      assignTo?: string | null;
      reason?: string;
    };

    if (!reportId) {
      res.status(400).json({ message: "Missing report id." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    const targetAdminId =
      assignTo === "me"
        ? req.admin!.id
        : assignTo === null || assignTo === undefined
          ? null
          : assignTo;

    try {
      const [existing] = await db
        .select({
          id: userReportsTable.id,
          status: userReportsTable.status,
          assignedAdminId: userReportsTable.assignedAdminId,
        })
        .from(userReportsTable)
        .where(eq(userReportsTable.id, reportId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Report not found." });
        return;
      }

      // Determine the new status: assigning → under_review, unassigning → keep existing
      const newStatus = targetAdminId ? "under_review" : existing.status;
      const statusChanged = newStatus !== existing.status;

      await db.transaction(async (tx) => {
        await tx
          .update(userReportsTable)
          .set({
            assignedAdminId: targetAdminId,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(userReportsTable.id, reportId));

        // Write status history if status auto-transitioned (new → under_review)
        if (statusChanged) {
          await writeStatusHistory(tx as unknown as typeof db, {
            domain: "report",
            recordId: reportId,
            fromStatus: existing.status,
            toStatus: newStatus,
            reason: reason!.trim(),
            adminId: req.admin!.id,
          });
        }

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: targetAdminId ? "report.assign" : "report.unassign",
          category: "reports",
          targetType: "report",
          targetId: reportId,
          reason: reason!.trim(),
          previousState: { assignedAdminId: existing.assignedAdminId, status: existing.status },
          newState: { assignedAdminId: targetAdminId, status: newStatus },
          requestId: req.id as string | undefined,
        });
      });

      req.log.info({ reportId, targetAdminId, adminId: req.admin!.id }, "Admin assigned report");
      res.json({ message: "Report assignment updated.", reportId, assignedAdminId: targetAdminId });
    } catch (err) {
      req.log.error({ err, reportId }, "admin report assign failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/reports/:id/notes ─────────────────────────────────────────────
// Accepts {note, reason}. Writes note + audit row in one transaction.

reportsRouter.post(
  "/admin/reports/:id/notes",
  requireAdminPermission("reports:moderate"),
  async (req: AdminRequest, res): Promise<void> => {
    const reportId = paramStr(req, "id");
    const { note, reason } = req.body as { note?: string; reason?: string };

    if (!reportId) {
      res.status(400).json({ message: "Missing report id." });
      return;
    }
    if (!note?.trim()) {
      res.status(400).json({ message: "A non-empty note is required." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const [existing] = await db
        .select({ id: userReportsTable.id })
        .from(userReportsTable)
        .where(eq(userReportsTable.id, reportId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Report not found." });
        return;
      }

      let inserted: typeof moderationNotesTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(moderationNotesTable)
          .values({ reportId, adminId: req.admin!.id, note: note!.trim() })
          .returning();
        inserted = row;

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "report.note.add",
          category: "reports",
          targetType: "report",
          targetId: reportId,
          reason: reason!.trim(),
          newState: { noteId: row?.id, note: note!.trim() },
          requestId: req.id as string | undefined,
        });
      });

      req.log.info({ reportId, noteId: inserted?.id }, "Admin added moderation note");
      res.status(201).json({ message: "Note added.", note: inserted });
    } catch (err) {
      req.log.error({ err, reportId }, "admin report note failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/reports/:id/outcome ──────────────────────────────────────────

reportsRouter.post(
  "/admin/reports/:id/outcome",
  requireAdminPermission("reports:moderate"),
  async (req: AdminRequest, res): Promise<void> => {
    const reportId = paramStr(req, "id");
    const { status, reason } = req.body as { status?: string; reason?: string };

    if (!reportId) {
      res.status(400).json({ message: "Missing report id." });
      return;
    }
    if (!VALID_OUTCOMES.includes(status as (typeof VALID_OUTCOMES)[number])) {
      res.status(400).json({
        message: `status must be one of: ${VALID_OUTCOMES.join(", ")}.`,
      });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const isResolved = ["actioned", "dismissed"].includes(status!);
      const isEscalated = status === "escalated";

      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: userReportsTable.id, status: userReportsTable.status })
          .from(userReportsTable)
          .where(eq(userReportsTable.id, reportId))
          .for("update")
          .limit(1);

        if (!existing) return { kind: "not_found" as const };

        const now = new Date();
        await tx
          .update(userReportsTable)
          .set({
            status: status!,
            resolutionReason: reason!.trim(),
            resolvedAt: isResolved ? now : null,
            resolvedByAdminId: isResolved ? req.admin!.id : null,
            escalatedAt: isEscalated ? now : undefined,
            updatedAt: now,
          })
          .where(eq(userReportsTable.id, reportId));

        // Every outcome is a status change — write history
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "report",
          recordId: reportId,
          fromStatus: existing.status,
          toStatus: status!,
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: `report.outcome.${status}`,
          category: "reports",
          targetType: "report",
          targetId: reportId,
          reason: reason!.trim(),
          previousState: { status: existing.status },
          newState: { status },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Report not found." });
        return;
      }

      req.log.info({ reportId, status, adminId: req.admin!.id }, "Admin set report outcome");
      res.json({ message: "Report outcome updated.", reportId, status });
    } catch (err) {
      req.log.error({ err, reportId }, "admin report outcome failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/reports/:id/suspend-user ──────────────────────────────────────

reportsRouter.post(
  "/admin/reports/:id/suspend-user",
  requireAdminPermission("reports:moderate"),
  requireAdminPermission("users:manage"),
  requireRecentAdminAuth,
  // Owner-only regardless of permission arrays: even an admin holding both
  // reports:moderate and users:manage (and with recent auth) is forbidden.
  requireOwner,
  async (req: AdminRequest, res): Promise<void> => {
    const reportId = paramStr(req, "id");
    const { reason, confirmation } = req.body as {
      reason?: string;
      confirmation?: string;
    };

    if (!reportId) {
      res.status(400).json({ message: "Missing report id." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }
    if (confirmation !== "SUSPEND") {
      res.status(400).json({
        message: "Confirm suspension by setting confirmation to SUSPEND.",
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [report] = await tx
          .select()
          .from(userReportsTable)
          .where(eq(userReportsTable.id, reportId))
          .for("update")
          .limit(1);

        if (!report) return { kind: "report_not_found" as const };

        const targetUserId = report.reportedUserId;
        const [targetUser] = await tx
          .select({ id: usersTable.id, suspendedAt: usersTable.suspendedAt })
          .from(usersTable)
          .where(eq(usersTable.id, targetUserId))
          .for("update")
          .limit(1);

        if (!targetUser) return { kind: "user_not_found" as const };
        if (targetUser.suspendedAt) return { kind: "already_suspended" as const };

        const now = new Date();
        await tx
          .update(usersTable)
          .set({ suspendedAt: now, updatedAt: now })
          .where(eq(usersTable.id, targetUserId));

        await tx.delete(userSessionsTable).where(eq(userSessionsTable.userId, targetUserId));

        await tx
          .update(userReportsTable)
          .set({
            status: "actioned",
            resolutionReason: reason!.trim(),
            resolvedAt: now,
            resolvedByAdminId: req.admin!.id,
            updatedAt: now,
          })
          .where(eq(userReportsTable.id, reportId));

        // Write report status history for the actioned transition
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "report",
          recordId: reportId,
          fromStatus: report.status,
          toStatus: "actioned",
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "user.suspend_via_report",
          category: "users",
          severity: "high",
          targetType: "user",
          targetId: targetUserId,
          reason: reason!.trim(),
          previousState: { suspendedAt: null, reportStatus: report.status },
          newState: { suspendedAt: now.toISOString(), reportStatus: "actioned" },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const, targetUserId };
      });

      if (result.kind === "report_not_found") {
        res.status(404).json({ message: "Report not found." });
        return;
      }
      if (result.kind === "user_not_found") {
        res.status(404).json({ message: "Reported user not found." });
        return;
      }
      if (result.kind === "already_suspended") {
        res.status(409).json({ message: "User is already suspended." });
        return;
      }

      req.log.info(
        { reportId, targetUserId: result.targetUserId, adminId: req.admin!.id },
        "Admin suspended user via report",
      );
      res.json({
        message: "User suspended and report actioned.",
        targetUserId: result.targetUserId,
        reportId,
      });
    } catch (err) {
      req.log.error({ err, reportId }, "admin report suspend-user failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
