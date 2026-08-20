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
  adminOperationalNotesTable,
  adminAccountsTable,
} from "@workspace/db";
import { eq, desc, asc, and, or, isNull, ne, count, sql, ilike, inArray } from "drizzle-orm";
import {
  requireAdminPermission,
  requireRecentAdminAuth,
  requireOwner,
  type AdminRequest,
} from "../../lib/adminSession.js";
import { paramStr, paginationParams, writeAudit, writeStatusHistory } from "./helpers.js";

export const reportsRouter = Router();

// Canonical task-285 queue status vocabulary. Maps from the older trust-route
// vocabulary: "new" → "open", "under_review" → "in_review", "actioned" → "resolved".
const VALID_OUTCOMES = ["open", "in_review", "resolved", "dismissed", "escalated"] as const;

// Legacy status values that may exist in older rows. Treated as "open" by all
// unresolved filters and attention queries; the UI should never write them.
const LEGACY_UNRESOLVED = ["new", "under_review"] as const;

const QUEUE_STATUSES = ["open", "in_review", "resolved", "dismissed", "escalated"] as const;
type QueueStatus = (typeof QUEUE_STATUSES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadReportNotes(
  ids: string[],
): Promise<Map<string, Array<{ id: string; authorAdminId: string; authorDisplayName: string | null; body: string; createdAt: Date }>>> {
  const grouped = new Map<string, Array<{ id: string; authorAdminId: string; authorDisplayName: string | null; body: string; createdAt: Date }>>();
  if (ids.length === 0) return grouped;
  const rows = await db
    .select({
      id: adminOperationalNotesTable.id,
      subjectId: adminOperationalNotesTable.subjectId,
      authorAdminId: adminOperationalNotesTable.authorAdminId,
      authorDisplayName: adminAccountsTable.displayName,
      body: adminOperationalNotesTable.body,
      createdAt: adminOperationalNotesTable.createdAt,
    })
    .from(adminOperationalNotesTable)
    .leftJoin(adminAccountsTable, eq(adminOperationalNotesTable.authorAdminId, adminAccountsTable.id))
    .where(
      and(
        eq(adminOperationalNotesTable.subjectType, "report"),
        inArray(adminOperationalNotesTable.subjectId, ids),
      ),
    )
    .orderBy(desc(adminOperationalNotesTable.createdAt));
  for (const row of rows) {
    const current = grouped.get(row.subjectId) ?? [];
    current.push({ id: row.id, authorAdminId: row.authorAdminId, authorDisplayName: row.authorDisplayName ?? null, body: row.body, createdAt: row.createdAt });
    grouped.set(row.subjectId, current);
  }
  return grouped;
}

// ── GET /admin/reports ────────────────────────────────────────────────────────
// Full task-285 contract: id filter, status=unresolved, status validation,
// operational notes enrichment. This handler is canonical for the reports queue.

reportsRouter.get(
  "/admin/reports",
  requireAdminPermission("reports:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(q["page"] ?? "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q["limit"] ?? "20") || 20));
    const offset = (page - 1) * limit;
    const statusFilter = q["status"]?.trim();
    const searchTerm = q["q"]?.trim() ?? q["search"]?.trim();
    const reportId = q["id"]?.trim();
    const assignedTo = q["assignedTo"]?.trim();

    try {
      const conditions = [];

      // id lookup — return exactly that report (used after PATCH to refresh)
      if (reportId) {
        if (!UUID_RE.test(reportId)) {
          res.status(400).json({ message: "Invalid report id." });
          return;
        }
        conditions.push(eq(userReportsTable.id, reportId));
      }

      // status filter — supports "unresolved" as a compound alias
      if (statusFilter && statusFilter !== "all") {
        if (statusFilter === "unresolved") {
          // Include legacy "new"/"under_review" from older trust-route submissions
          conditions.push(inArray(userReportsTable.status, ["open", "in_review", "escalated", "new", "under_review"]));
        } else if (!QUEUE_STATUSES.includes(statusFilter as QueueStatus)) {
          res.status(400).json({ message: "Invalid status filter." });
          return;
        } else {
          conditions.push(eq(userReportsTable.status, statusFilter));
        }
      }

      // assignment filter
      if (assignedTo === "me") {
        conditions.push(eq(userReportsTable.assignedAdminId, req.admin!.id));
      } else if (assignedTo === "unassigned") {
        conditions.push(isNull(userReportsTable.assignedAdminId));
      }

      // full-text search
      if (searchTerm) {
        conditions.push(
          or(
            ilike(userReportsTable.reason, `%${searchTerm}%`),
            ilike(userReportsTable.note, `%${searchTerm}%`),
          )!,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [[totalRow], reports] = await Promise.all([
        db.select({ cnt: count() }).from(userReportsTable).where(where),
        db
          .select({
            id: userReportsTable.id,
            reason: userReportsTable.reason,
            note: userReportsTable.note,
            createdAt: userReportsTable.createdAt,
            updatedAt: userReportsTable.updatedAt,
            reporterUserId: userReportsTable.reporterUserId,
            reportedUserId: userReportsTable.reportedUserId,
            status: userReportsTable.status,
            priority: userReportsTable.priority,
            severity: userReportsTable.severity,
            assignedAdminId: userReportsTable.assignedAdminId,
            resolution: userReportsTable.resolution,
            resolutionReason: userReportsTable.resolutionReason,
            escalatedAt: userReportsTable.escalatedAt,
            escalationReason: userReportsTable.escalationReason,
            firstResponseAt: userReportsTable.firstResponseAt,
            resolvedAt: userReportsTable.resolvedAt,
            assignedAdminDisplayName: sql<string | null>`(
              SELECT display_name FROM admin_accounts
              WHERE id = ${userReportsTable.assignedAdminId} LIMIT 1
            )`,
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

      const notes = await loadReportNotes(reports.map((r) => r.id));

      res.json({
        reports: reports.map((r) => ({ ...r, notes: notes.get(r.id) ?? [] })),
        total: Number(totalRow?.cnt ?? 0),
        page,
        limit,
        filter: { status: statusFilter ?? "all" },
      });
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

      // Determine the new status: assigning → in_review, unassigning → keep existing
      const newStatus = targetAdminId ? "in_review" : existing.status;
      const statusChanged = newStatus !== existing.status;

      await db.transaction(async (tx) => {
        await tx
          .update(userReportsTable)
          .set({
            assignedAdminId: targetAdminId,
            status: newStatus,
            firstResponseAt: targetAdminId && !existing.status.match(/^(in_review|resolved|dismissed|escalated)$/)
              ? new Date()
              : undefined,
            updatedAt: new Date(),
          })
          .where(eq(userReportsTable.id, reportId));

        // Write status history if status auto-transitioned (open → in_review)
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
      const isResolved = ["resolved", "dismissed"].includes(status!);
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
            status: "resolved",
            resolutionReason: reason!.trim(),
            resolution: "Reported collector suspended.",
            resolvedAt: now,
            resolvedByAdminId: req.admin!.id,
            updatedAt: now,
          })
          .where(eq(userReportsTable.id, reportId));

        // Write report status history for the resolved transition
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "report",
          recordId: reportId,
          fromStatus: report.status,
          toStatus: "resolved",
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
          newState: { suspendedAt: now.toISOString(), reportStatus: "resolved" },
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
        message: "User suspended and report resolved.",
        targetUserId: result.targetUserId,
        reportId,
      });
    } catch (err) {
      req.log.error({ err, reportId }, "admin report suspend-user failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
