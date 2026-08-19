/**
 * Admin routes — internal operator panel only.
 *
 * All endpoints require a valid admin session cookie (set by POST /api/admin/auth/login).
 *
 * GET   /api/admin/stats                  — overview statistics
 * GET   /api/admin/overview               — date-aware dashboard stats + comparisons
 * GET   /api/admin/activity               — aggregate live activity feed
 * GET   /api/admin/attention              — prioritized items needing action
 * GET   /api/admin/search                 — permission-scoped global search
 * GET   /api/admin/users                  — paginated user list + search
 * GET   /api/admin/users/:id/detail       — full privacy-respecting user detail
 * POST  /api/admin/users/:id/subscription — set subscription_tier / is_founding_member
 * GET   /api/admin/subscriptions          — plan-state subscription view
 * GET   /api/admin/scan-usage             — scan analytics + top scanners
 * GET   /api/admin/reports                — reports queue (rich, filterable)
 * PATCH /api/admin/reports/:id            — report workflow patch
 * GET   /api/admin/contact                — support queue (rich, filterable)
 * PATCH /api/admin/contact/:id            — support workflow patch
 */

import { Router, type Response } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  userSessionsTable,
  scanUsageTable,
  userReportsTable,
  contactSubmissionsTable,
  collectionItemsTable,
  wishlistItemsTable,
  notificationsTable,
  activityLogTable,
  adminAccountsTable,
  adminOperationalNotesTable,
} from "@workspace/db";
import {
  eq,
  ilike,
  or,
  and,
  desc,
  asc,
  gte,
  lt,
  lte,
  count,
  sum,
  sql,
  inArray,
} from "drizzle-orm";
import {
  type AdminRequest,
  requireAdminCsrf,
  requireAdminPermission,
  requireAdminSession,
  requireRecentAdminAuth,
} from "../lib/adminSession";
import type { AdminPermission } from "../lib/adminPermissions";

const router = Router();

// Apply admin session guard to all admin data routes
router.use("/admin", requireAdminSession, requireAdminCsrf);

/** Returns the first day of the current UTC calendar month — matches the scan service. */
function utcPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const FREE_SCAN_LIMIT = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Workflow statuses valid for both the reports and support queues. */
const QUEUE_STATUSES = [
  "open",
  "in_review",
  "resolved",
  "dismissed",
  "escalated",
] as const;
type QueueStatus = (typeof QUEUE_STATUSES)[number];

const MAX_NOTE_LEN = 4000;
const MAX_RESOLUTION_LEN = 4000;
const MAX_REASON_LEN = 500;

function hasPermission(req: AdminRequest, permission: AdminPermission): boolean {
  return Boolean(req.admin?.permissions.includes(permission));
}

function parsePagination(
  query: Record<string, string | undefined>,
  defaultLimit = 20,
  maxLimit = 100,
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(query["page"] ?? "1") || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(query["limit"] ?? String(defaultLimit)) || defaultLimit),
  );
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Resolves a date range from query params.
 * Supports preset=7d|30d|90d, or custom start/end (bounded 1–366 days).
 * Returns the current window plus the immediately-preceding window of equal
 * length so comparisons are apples-to-apples.
 */
function resolveDateRange(query: Record<string, string | undefined>): {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
  preset: string;
  error?: string;
} {
  const now = new Date();
  const preset = (query["preset"] ?? "30d").trim();
  const PRESETS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

  let start: Date;
  let end = now;

  if (preset === "custom") {
    const rawStart = query["start"];
    const rawEnd = query["end"];
    const parsedStart = rawStart ? new Date(rawStart) : null;
    const parsedEnd = rawEnd ? new Date(rawEnd) : now;
    if (!parsedStart || Number.isNaN(parsedStart.getTime())) {
      return {
        start: now,
        end: now,
        prevStart: now,
        prevEnd: now,
        days: 0,
        preset,
        error: "Custom range requires a valid `start` date.",
      };
    }
    if (Number.isNaN(parsedEnd.getTime())) {
      return {
        start: now,
        end: now,
        prevStart: now,
        prevEnd: now,
        days: 0,
        preset,
        error: "Custom range `end` date is invalid.",
      };
    }
    start = parsedStart;
    end = parsedEnd;
    const spanDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
    if (spanDays < 1 || spanDays > 366) {
      return {
        start: now,
        end: now,
        prevStart: now,
        prevEnd: now,
        days: 0,
        preset,
        error: "Custom range must span between 1 and 366 days.",
      };
    }
  } else {
    const days = PRESETS[preset] ?? 30;
    start = new Date(now.getTime() - days * 86_400_000);
  }

  const rangeMs = end.getTime() - start.getTime();
  const days = Math.max(1, Math.round(rangeMs / 86_400_000));
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - rangeMs);
  return { start, end, prevStart, prevEnd, days, preset };
}

/** Builds a comparison object, only when both current and previous data exist. */
function comparison(current: number, previous: number) {
  const delta = current - previous;
  const percentChange =
    previous > 0 ? Math.round((delta / previous) * 1000) / 10 : null;
  return { current, previous, delta, percentChange };
}

function firstUtcMonthInRange(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

type OperationalNoteView = {
  id: string;
  authorAdminId: string;
  authorDisplayName: string | null;
  body: string;
  createdAt: Date;
};

async function loadOperationalNotes(
  kind: "report" | "support",
  ids: string[],
): Promise<Map<string, OperationalNoteView[]>> {
  const grouped = new Map<string, OperationalNoteView[]>();
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
    .leftJoin(
      adminAccountsTable,
      eq(adminOperationalNotesTable.authorAdminId, adminAccountsTable.id),
    )
    .where(
      and(
        eq(adminOperationalNotesTable.subjectType, kind),
        inArray(adminOperationalNotesTable.subjectId, ids),
      ),
    )
    .orderBy(desc(adminOperationalNotesTable.createdAt));
  for (const row of rows) {
    const current = grouped.get(row.subjectId) ?? [];
    current.push({
      id: row.id,
      authorAdminId: row.authorAdminId,
      authorDisplayName: row.authorDisplayName,
      body: row.body,
      createdAt: row.createdAt,
    });
    grouped.set(row.subjectId, current);
  }
  return grouped;
}

// ── GET /api/admin/stats ──────────────────────────────────────────────────────

router.get("/admin/stats", requireAdminPermission("dashboard:read"), async (req: AdminRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
    const startOfMonth = utcPeriodStart();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // User counts grouped by tier + founding status
    const tierRows = await db
      .select({
        tier: usersTable.subscriptionTier,
        founding: usersTable.isFoundingMember,
        cnt: count(),
      })
      .from(usersTable)
      .groupBy(usersTable.subscriptionTier, usersTable.isFoundingMember);

    let totalUsers = 0;
    let proUsers = 0;
    let freeUsers = 0;
    let foundingMembers = 0;
    for (const row of tierRows) {
      const n = Number(row.cnt);
      totalUsers += n;
      if (row.tier === "pro") {
        proUsers += n;
        if (row.founding) foundingMembers += n;
      } else {
        freeUsers += n;
      }
    }

    // Signup counts
    const [[todayRow], [weekRow], [monthRow]] = await Promise.all([
      db.select({ cnt: count() }).from(usersTable).where(gte(usersTable.createdAt, startOfToday)),
      db.select({ cnt: count() }).from(usersTable).where(gte(usersTable.createdAt, startOfWeek)),
      db.select({ cnt: count() }).from(usersTable).where(gte(usersTable.createdAt, startOfMonth)),
    ]);

    // Daily signups for last 30 days
    const dailySignups = await db
      .select({
        date: sql<string>`TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        cnt: count(),
      })
      .from(usersTable)
      .where(gte(usersTable.createdAt, thirtyDaysAgo))
      .groupBy(sql`DATE(created_at AT TIME ZONE 'UTC')`)
      .orderBy(sql`DATE(created_at AT TIME ZONE 'UTC')`);

    // Scan totals
    const [[scanTotalRow], [scanMonthRow]] = await Promise.all([
      db.select({ total: sum(scanUsageTable.scanCount) }).from(scanUsageTable),
      db
        .select({ total: sum(scanUsageTable.scanCount) })
        .from(scanUsageTable)
        .where(gte(scanUsageTable.periodStart, startOfMonth)),
    ]);

    return res.json({
      totalUsers,
      proUsers,
      freeUsers,
      foundingMembers,
      signupsToday: Number(todayRow?.cnt ?? 0),
      signupsThisWeek: Number(weekRow?.cnt ?? 0),
      signupsThisMonth: Number(monthRow?.cnt ?? 0),
      totalScans: Number(scanTotalRow?.total ?? 0),
      scansThisMonth: Number(scanMonthRow?.total ?? 0),
      proConversionRate:
        totalUsers > 0 ? Math.round((proUsers / totalUsers) * 1000) / 10 : 0,
      dailySignups: dailySignups.map((r) => ({
        date: r.date,
        count: Number(r.cnt),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin statistics query failed");
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────

router.get("/admin/users", requireAdminPermission("users:read"), async (req: AdminRequest, res: Response) => {
  const {
    q,
    email,
    page = "1",
    limit = "20",
    tier,
    status,
    sort = "date",
  } = req.query as Record<string, string | undefined>;

  const searchTerm = (q ?? email)?.trim();
  const pageNum = Math.max(1, parseInt(page ?? "1") || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "20") || 20));
  const offset = (pageNum - 1) * limitNum;
  const currentPeriod = utcPeriodStart();

  try {
    const conditions = [];

    if (searchTerm) {
      conditions.push(
        or(
          ilike(usersTable.email, `%${searchTerm}%`),
          ilike(usersTable.displayName, `%${searchTerm}%`),
          ilike(usersTable.username, `%${searchTerm}%`),
        )!,
      );
    }

    if (tier && tier !== "all") {
      if (tier === "founding_pro") {
        conditions.push(
          and(
            eq(usersTable.subscriptionTier, "pro"),
            eq(usersTable.isFoundingMember, true),
          )!,
        );
      } else {
        conditions.push(eq(usersTable.subscriptionTier, tier));
      }
    }

    if (status === "suspended") {
      conditions.push(sql`${usersTable.suspendedAt} IS NOT NULL`);
    } else if (status === "active") {
      conditions.push(sql`${usersTable.suspendedAt} IS NULL`);
    }

    const whereClause =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const [totalRow] = await db
      .select({ cnt: count() })
      .from(usersTable)
      .where(whereClause);

    const sortOrder =
      sort === "name" ? asc(usersTable.displayName) : desc(usersTable.createdAt);

    // Correlated subquery uses exact UTC period-start timestamp equality —
    // consistent with how the scan service records rows.
    const scansSubquery = sql<number>`COALESCE((
      SELECT scan_count FROM scan_usage
      WHERE user_id = ${usersTable.id}
        AND period_start = ${currentPeriod.toISOString()}::timestamp
      LIMIT 1
    ), 0)`;

    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
        username: usersTable.username,
        subscriptionTier: usersTable.subscriptionTier,
        isFoundingMember: usersTable.isFoundingMember,
        createdAt: usersTable.createdAt,
        avatarUrl: usersTable.avatarUrl,
        location: usersTable.location,
        suspendedAt: usersTable.suspendedAt,
        scansThisMonth: scansSubquery,
      })
      .from(usersTable)
      .where(whereClause)
      .orderBy(sortOrder)
      .limit(limitNum)
      .offset(offset);

    return res.json({
      users,
      total: Number(totalRow?.cnt ?? 0),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    req.log.error({ err }, "Admin users query failed");
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── POST /api/admin/users/:id/subscription ────────────────────────────────────

router.post(
  "/admin/users/:userId/subscription",
  requireAdminPermission("users:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
  const userId = String(req.params["userId"]);
  const { subscription_tier, is_founding_member, reason } = req.body as {
    subscription_tier?: string;
    is_founding_member?: boolean;
    reason?: string;
  };
  const auditReason =
    typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined;
  if (!auditReason) {
    return res.status(400).json({ message: "A reason is required to change plan state." });
  }

  if (subscription_tier === undefined && is_founding_member === undefined) {
    return res.status(400).json({
      message: "Provide at least one of `subscription_tier` or `is_founding_member`.",
    });
  }

  const VALID_TIERS = ["free", "pro"];
  if (subscription_tier !== undefined && !VALID_TIERS.includes(subscription_tier)) {
    return res.status(400).json({
      message: `Invalid subscription_tier. Must be one of: ${VALID_TIERS.join(", ")}.`,
    });
  }

  if (is_founding_member !== undefined && typeof is_founding_member !== "boolean") {
    return res.status(400).json({ message: "`is_founding_member` must be a boolean." });
  }

  const patch: Partial<{
    subscriptionTier: string;
    isFoundingMember: boolean;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (subscription_tier !== undefined) patch.subscriptionTier = subscription_tier;
  if (is_founding_member !== undefined) patch.isFoundingMember = is_founding_member;

  try {
    const [updated] = await db
      .update(usersTable)
      .set(patch)
      .where(eq(usersTable.id, userId))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
        username: usersTable.username,
        subscriptionTier: usersTable.subscriptionTier,
        isFoundingMember: usersTable.isFoundingMember,
      });

    if (!updated) {
      return res.status(404).json({ message: "User not found." });
    }

    req.log.info(
      { userId: updated.id, hasReason: Boolean(auditReason) },
      "Admin updated collector subscription",
    );

    return res.json({ message: "User subscription updated successfully.", user: updated });
  } catch (err) {
    req.log.error({ err, userId }, "Admin subscription update failed");
    return res.status(500).json({ message: "Database error. Please try again." });
  }
  },
);

// ── POST /api/admin/users/:id/suspend ────────────────────────────────────────

router.post(
  "/admin/users/:userId/suspend",
  requireAdminPermission("users:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
  const userId = String(req.params["userId"]);
  const { suspend, reason } = req.body as { suspend?: boolean; reason?: string };
  const auditReason =
    typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined;
  if (!auditReason) {
    return res.status(400).json({ message: "A reason is required to change suspension state." });
  }

  if (typeof suspend !== "boolean") {
    return res.status(400).json({ message: "`suspend` must be a boolean." });
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(usersTable)
        .set({ suspendedAt: suspend ? new Date() : null, updatedAt: new Date() })
        .where(eq(usersTable.id, userId))
        .returning({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
          suspendedAt: usersTable.suspendedAt,
        });

      if (!row) return null;

      // When suspending, revoke active sessions in the same transaction so the
      // account state and refresh-token state cannot diverge.
      if (suspend) {
        await tx.delete(userSessionsTable).where(eq(userSessionsTable.userId, userId));
      }
      return row;
    });

    if (!updated) {
      return res.status(404).json({ message: "User not found." });
    }

    const action = suspend ? "suspended" : "unsuspended";
    req.log.info(
      { userId: updated.id, action, hasReason: Boolean(auditReason) },
      "Admin changed collector suspension",
    );

    return res.json({
      message: `User ${action} successfully.`,
      user: { ...updated, suspendedAt: updated.suspendedAt?.toISOString() ?? null },
    });
  } catch (err) {
    req.log.error({ err, userId }, "Admin suspension update failed");
    return res.status(500).json({ message: "Database error. Please try again." });
  }
  },
);

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────

router.delete(
  "/admin/users/:userId",
  requireAdminPermission("users:delete"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
  const userId = String(req.params["userId"]);
  const bodyReason = (req.body as { reason?: string } | undefined)?.reason;
  const queryReason = (req.query as Record<string, string | undefined>)["reason"];
  const reason = bodyReason ?? queryReason;
  const auditReason =
    typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined;
  if (!auditReason) {
    return res.status(400).json({ message: "A reason is required to permanently delete a user." });
  }

  try {
    const [deleted] = await db
      .delete(usersTable)
      .where(eq(usersTable.id, userId))
      .returning({ id: usersTable.id, email: usersTable.email });

    if (!deleted) {
      return res.status(404).json({ message: "User not found." });
    }

    req.log.info(
      { userId: deleted.id, hasReason: Boolean(auditReason) },
      "Admin permanently deleted collector",
    );

    return res.json({ message: "User permanently deleted." });
  } catch (err) {
    req.log.error({ err, userId }, "Admin collector deletion failed");
    return res.status(500).json({ message: "Database error. Please try again." });
  }
  },
);

// ── DELETE /api/admin/users/:id/sessions ─────────────────────────────────────

router.delete(
  "/admin/users/:userId/sessions",
  requireAdminPermission("users:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const userId = String(req.params["userId"]);
    const reason =
      typeof (req.body as { reason?: string } | undefined)?.reason === "string"
        ? (req.body as { reason: string }).reason.trim()
        : "";
    if (!reason) {
      res.status(400).json({ message: "A reason is required to revoke collector sessions." });
      return;
    }
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ message: "User not found." });
      return;
    }
    const revoked = await db
      .delete(userSessionsTable)
      .where(eq(userSessionsTable.userId, userId))
      .returning({ id: userSessionsTable.id });
    req.log.info(
      { userId, revokedSessions: revoked.length, hasReason: true },
      "Admin revoked collector sessions",
    );
    res.json({
      message:
        revoked.length === 1
          ? "1 collector session revoked."
          : `${revoked.length} collector sessions revoked.`,
      revoked: revoked.length,
    });
  },
);

// ── GET /api/admin/scan-usage ─────────────────────────────────────────────────

router.get("/admin/scan-usage", requireAdminPermission("analytics:read"), async (req: AdminRequest, res: Response) => {
  try {
    const currentPeriod = utcPeriodStart();
    const sixMonthsAgo = new Date(
      Date.UTC(
        currentPeriod.getUTCFullYear(),
        currentPeriod.getUTCMonth() - 5,
        1,
      ),
    );

    const monthlyData = await db
      .select({
        period: scanUsageTable.periodStart,
        total: sum(scanUsageTable.scanCount),
      })
      .from(scanUsageTable)
      .where(gte(scanUsageTable.periodStart, sixMonthsAgo))
      .groupBy(scanUsageTable.periodStart)
      .orderBy(asc(scanUsageTable.periodStart));

    const topScanners = await db
      .select({
        userId: scanUsageTable.userId,
        displayName: usersTable.displayName,
        username: usersTable.username,
        subscriptionTier: usersTable.subscriptionTier,
        totalScans: sql<number>`COALESCE(SUM(${scanUsageTable.scanCount}), 0)`,
      })
      .from(scanUsageTable)
      .innerJoin(usersTable, eq(scanUsageTable.userId, usersTable.id))
      .groupBy(
        scanUsageTable.userId,
        usersTable.displayName,
        usersTable.username,
        usersTable.subscriptionTier,
      )
      .orderBy(sql`SUM(${scanUsageTable.scanCount}) DESC`)
      .limit(20);

    const [quotaRow] = await db
      .select({ cnt: count() })
      .from(scanUsageTable)
      .innerJoin(usersTable, eq(scanUsageTable.userId, usersTable.id))
      .where(
        and(
          eq(usersTable.subscriptionTier, "free"),
          sql`${scanUsageTable.scanCount} >= ${FREE_SCAN_LIMIT}`,
          gte(scanUsageTable.periodStart, currentPeriod),
        ),
      );

    const [[totalRow], [monthRow]] = await Promise.all([
      db.select({ total: sum(scanUsageTable.scanCount) }).from(scanUsageTable),
      db
        .select({ total: sum(scanUsageTable.scanCount) })
        .from(scanUsageTable)
        .where(gte(scanUsageTable.periodStart, currentPeriod)),
    ]);

    return res.json({
      totalScans: Number(totalRow?.total ?? 0),
      scansThisMonth: Number(monthRow?.total ?? 0),
      usersAtQuota: Number(quotaRow?.cnt ?? 0),
      freeScanLimit: FREE_SCAN_LIMIT,
      monthlyData: monthlyData.map((r) => {
        const p = r.period instanceof Date ? r.period : new Date(r.period as string);
        return {
          period: `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}`,
          label: p.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          }),
          total: Number(r.total ?? 0),
        };
      }),
      topScanners: topScanners.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        username: r.username,
        subscriptionTier: r.subscriptionTier,
        totalScans: Number(r.totalScans),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin scan usage query failed");
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── GET /api/admin/overview ────────────────────────────────────────────────────
// Date-aware dashboard with explicit data-availability metadata and
// previous-period comparisons where real records exist.

router.get(
  "/admin/overview",
  requireAdminPermission("dashboard:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const range = resolveDateRange(req.query as Record<string, string | undefined>);
    if (range.error) {
      res.status(400).json({ message: range.error });
      return;
    }

    try {
      const canReadUsers = hasPermission(req, "users:read");
      const canReadReports = hasPermission(req, "reports:read");
      const canReadContact = hasPermission(req, "contact:read");
      const canReadAnalytics = hasPermission(req, "analytics:read");

      let signupsInRange: number | null = null;
      let signupsPrevious: number | null = null;
      let totalUsers: number | null = null;
      let proUsers: number | null = null;
      let freeUsers: number | null = null;
      let foundingMembers: number | null = null;
      let dailySignups: Array<{ date: string; cnt: number }> = [];

      if (canReadUsers) {
        const [
          [currentRow],
          [previousRow],
          [totalRow],
          tierRows,
          signupRows,
        ] = await Promise.all([
          db
            .select({ cnt: count() })
            .from(usersTable)
            .where(
              and(
                gte(usersTable.createdAt, range.start),
                lte(usersTable.createdAt, range.end),
              ),
            ),
          db
            .select({ cnt: count() })
            .from(usersTable)
            .where(
              and(
                gte(usersTable.createdAt, range.prevStart),
                lt(usersTable.createdAt, range.prevEnd),
              ),
            ),
          db.select({ cnt: count() }).from(usersTable),
          db
            .select({
              tier: usersTable.subscriptionTier,
              founding: usersTable.isFoundingMember,
              cnt: count(),
            })
            .from(usersTable)
            .groupBy(usersTable.subscriptionTier, usersTable.isFoundingMember),
          db
            .select({
              date: sql<string>`TO_CHAR(DATE(${usersTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
              cnt: count(),
            })
            .from(usersTable)
            .where(
              and(
                gte(usersTable.createdAt, range.start),
                lte(usersTable.createdAt, range.end),
              ),
            )
            .groupBy(sql`DATE(${usersTable.createdAt} AT TIME ZONE 'UTC')`)
            .orderBy(sql`DATE(${usersTable.createdAt} AT TIME ZONE 'UTC')`),
        ]);
        signupsInRange = Number(currentRow?.cnt ?? 0);
        signupsPrevious = Number(previousRow?.cnt ?? 0);
        totalUsers = Number(totalRow?.cnt ?? 0);
        proUsers = 0;
        freeUsers = 0;
        foundingMembers = 0;
        dailySignups = signupRows.map((row) => ({
          date: row.date,
          cnt: Number(row.cnt),
        }));
        for (const row of tierRows) {
          const value = Number(row.cnt);
          if (row.tier === "pro") {
            proUsers += value;
            if (row.founding) foundingMembers += value;
          } else {
            freeUsers += value;
          }
        }
      }

      const availability: Record<string, { available: boolean; reason?: string }> =
        {
          users: canReadUsers
            ? { available: true }
            : { available: false, reason: "Requires users:read." },
          scans: canReadAnalytics
            ? {
                available: true,
                reason:
                  "Scan usage is stored as monthly cumulative buckets; exact day-level history and prior-period comparisons are unavailable.",
              }
            : { available: false, reason: "Requires analytics:read." },
          reports: canReadReports
            ? { available: true }
            : { available: false, reason: "Requires reports:read." },
          support: canReadContact
            ? { available: true }
            : { available: false, reason: "Requires contact:read." },
        };

      const comparisons: Record<string, ReturnType<typeof comparison>> = {};
      if (signupsInRange !== null && signupsPrevious !== null) {
        comparisons["users"] = comparison(signupsInRange, signupsPrevious);
      }

      let scansInCoveredMonths: number | null = null;
      if (canReadAnalytics) {
        const [scansCurrent] = await db
          .select({ total: sum(scanUsageTable.scanCount) })
          .from(scanUsageTable)
          .where(
            and(
              gte(scanUsageTable.periodStart, firstUtcMonthInRange(range.start)),
              lte(scanUsageTable.periodStart, firstUtcMonthInRange(range.end)),
            ),
          );
        scansInCoveredMonths = Number(scansCurrent?.total ?? 0);
      }

      if (canReadReports) {
        const [[reportsCurrent], [reportsPrevious]] = await Promise.all([
          db
            .select({ cnt: count() })
            .from(userReportsTable)
            .where(
              and(
                gte(userReportsTable.createdAt, range.start),
                lte(userReportsTable.createdAt, range.end),
              ),
            ),
          db
            .select({ cnt: count() })
            .from(userReportsTable)
            .where(
              and(
                gte(userReportsTable.createdAt, range.prevStart),
                lt(userReportsTable.createdAt, range.prevEnd),
              ),
            ),
        ]);
        comparisons["reports"] = comparison(
          Number(reportsCurrent?.cnt ?? 0),
          Number(reportsPrevious?.cnt ?? 0),
        );
      }

      if (canReadContact) {
        const [[supportCurrent], [supportPrevious]] = await Promise.all([
          db
            .select({ cnt: count() })
            .from(contactSubmissionsTable)
            .where(
              and(
                gte(contactSubmissionsTable.submittedAt, range.start),
                lte(contactSubmissionsTable.submittedAt, range.end),
              ),
            ),
          db
            .select({ cnt: count() })
            .from(contactSubmissionsTable)
            .where(
              and(
                gte(contactSubmissionsTable.submittedAt, range.prevStart),
                lt(contactSubmissionsTable.submittedAt, range.prevEnd),
              ),
            ),
        ]);
        comparisons["support"] = comparison(
          Number(supportCurrent?.cnt ?? 0),
          Number(supportPrevious?.cnt ?? 0),
        );
      }

      let unresolvedReports: number | null = null;
      if (canReadReports) {
        const [row] = await db
          .select({ cnt: count() })
          .from(userReportsTable)
          // Include legacy "new"/"under_review" from older trust-route submissions
          .where(inArray(userReportsTable.status, ["open", "in_review", "escalated", "new", "under_review"]));
        unresolvedReports = Number(row?.cnt ?? 0);
      }

      let unresolvedSupport: number | null = null;
      if (canReadContact) {
        const [row] = await db
          .select({ cnt: count() })
          .from(contactSubmissionsTable)
          .where(
            inArray(contactSubmissionsTable.status, ["open", "in_review", "escalated"]),
          );
        unresolvedSupport = Number(row?.cnt ?? 0);
      }

      res.json({
        range: {
          preset: range.preset,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          days: range.days,
          previousStart: range.prevStart.toISOString(),
          previousEnd: range.prevEnd.toISOString(),
        },
        totals: {
          totalUsers,
          proUsers,
          freeUsers,
          foundingMembers,
          signupsInRange,
          scansInCoveredMonths,
          unresolvedReports,
          unresolvedSupport,
        },
        comparisons,
        trends: {
          dailySignups: dailySignups.map((row) => ({
            date: row.date,
            count: row.cnt,
          })),
        },
        dataAvailability: availability,
      });
    } catch (err) {
      req.log.error({ err }, "Admin overview query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /api/admin/activity ──────────────────────────────────────────────────
// Aggregate live activity only. dashboard:read is sufficient because we never
// expose raw private contents — only event types, timestamps and safe labels.

router.get(
  "/admin/activity",
  requireAdminPermission("dashboard:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const range = resolveDateRange(req.query as Record<string, string | undefined>);
    if (range.error) {
      res.status(400).json({ message: range.error });
      return;
    }
    const { limit } = parsePagination(
      req.query as Record<string, string | undefined>,
      30,
      100,
    );
    try {
      const canReadUsers = hasPermission(req, "users:read");
      const canReadReports = hasPermission(req, "reports:read");
      const canReadContact = hasPermission(req, "contact:read");

      // Durable activity log — safe denormalized labels only.
      const activityRows = canReadUsers
        ? await db
            .select({
              kind: sql<string>`'activity'`,
              eventType: activityLogTable.eventType,
              label: activityLogTable.entityName,
              createdAt: activityLogTable.createdAt,
            })
            .from(activityLogTable)
            .where(
              and(
                gte(activityLogTable.createdAt, range.start),
                lte(activityLogTable.createdAt, range.end),
              ),
            )
            .orderBy(desc(activityLogTable.createdAt))
            .limit(limit)
        : [];

      const signupRows = canReadUsers
        ? await db
            .select({
              createdAt: usersTable.createdAt,
              username: usersTable.username,
            })
            .from(usersTable)
            .where(
              and(
                gte(usersTable.createdAt, range.start),
                lte(usersTable.createdAt, range.end),
              ),
            )
            .orderBy(desc(usersTable.createdAt))
            .limit(limit)
        : [];

      const events: Array<{
        kind: string;
        eventType: string;
        label: string | null;
        createdAt: string;
      }> = [];

      for (const row of activityRows) {
        events.push({
          kind: "activity",
          eventType: String(row.eventType),
          label: row.label ?? null,
          createdAt: row.createdAt.toISOString(),
        });
      }
      for (const row of signupRows) {
        events.push({
          kind: "signup",
          eventType: "user_signup",
          label: row.username,
          createdAt: row.createdAt.toISOString(),
        });
      }

      if (canReadReports) {
        const reportRows = await db
          .select({ createdAt: userReportsTable.createdAt })
          .from(userReportsTable)
          .where(
            and(
              gte(userReportsTable.createdAt, range.start),
              lte(userReportsTable.createdAt, range.end),
            ),
          )
          .orderBy(desc(userReportsTable.createdAt))
          .limit(limit);
        for (const row of reportRows) {
          events.push({
            kind: "report",
            eventType: "report_submitted",
            label: null,
            createdAt: row.createdAt.toISOString(),
          });
        }
      }

      if (canReadContact) {
        const contactRows = await db
          .select({
            submittedAt: contactSubmissionsTable.submittedAt,
            category: contactSubmissionsTable.category,
          })
          .from(contactSubmissionsTable)
          .where(
            and(
              gte(contactSubmissionsTable.submittedAt, range.start),
              lte(contactSubmissionsTable.submittedAt, range.end),
            ),
          )
          .orderBy(desc(contactSubmissionsTable.submittedAt))
          .limit(limit);
        for (const row of contactRows) {
          events.push({
            kind: "support",
            eventType: "contact_submitted",
            label: row.category,
            createdAt: row.submittedAt.toISOString(),
          });
        }
      }

      events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      res.json({
        range: {
          preset: range.preset,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        events: events.slice(0, limit),
        dataAvailability: {
          activityLog: canReadUsers
            ? { available: true }
            : { available: false, reason: "Requires users:read." },
          signups: canReadUsers
            ? { available: true }
            : { available: false, reason: "Requires users:read." },
          reports: canReadReports
            ? { available: true }
            : { available: false, reason: "Requires reports:read." },
          support: canReadContact
            ? { available: true }
            : { available: false, reason: "Requires contact:read." },
        },
      });
    } catch (err) {
      req.log.error({ err }, "Admin activity query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /api/admin/attention ──────────────────────────────────────────────────
// Prioritized items needing operator action. Deep-link values route to the
// existing panel query paths (/reports, /contact, /users).

router.get(
  "/admin/attention",
  requireAdminPermission("dashboard:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const range = resolveDateRange(req.query as Record<string, string | undefined>);
    if (range.error) {
      res.status(400).json({ message: range.error });
      return;
    }
    try {
      const canReadReports = hasPermission(req, "reports:read");
      const canReadContact = hasPermission(req, "contact:read");
      const canReadAnalytics = hasPermission(req, "analytics:read");
      const canReadUsers = hasPermission(req, "users:read");
      const currentPeriod = utcPeriodStart();
      const rangeIncludesCurrentScanPeriod =
        range.start <= currentPeriod && range.end >= currentPeriod;

      const items: Array<{
        type: string;
        priority: number;
        count: number;
        label: string;
        deepLink: string;
      }> = [];

      if (canReadReports) {
        const [row] = await db
          .select({ cnt: count() })
          .from(userReportsTable)
          .where(
            and(
              // Include legacy "new"/"under_review" from older trust-route submissions
              inArray(userReportsTable.status, ["open", "in_review", "escalated", "new", "under_review"]),
              gte(userReportsTable.createdAt, range.start),
              lte(userReportsTable.createdAt, range.end),
            ),
          );
        const cnt = Number(row?.cnt ?? 0);
        if (cnt > 0) {
          items.push({
            type: "unresolved_reports",
            priority: 1,
            count: cnt,
            label: "Unresolved user reports",
            deepLink: "/reports?status=unresolved",
          });
        }
      }

      if (canReadContact) {
        const [row] = await db
          .select({ cnt: count() })
          .from(contactSubmissionsTable)
          .where(
            and(
              inArray(contactSubmissionsTable.status, ["open", "in_review", "escalated"]),
              gte(contactSubmissionsTable.submittedAt, range.start),
              lte(contactSubmissionsTable.submittedAt, range.end),
            ),
          );
        const cnt = Number(row?.cnt ?? 0);
        if (cnt > 0) {
          items.push({
            type: "unresolved_support",
            priority: 1,
            count: cnt,
            label: "Unresolved support submissions",
            deepLink: "/contact?status=unresolved",
          });
        }
      }

      if (canReadUsers) {
        const [suspendedRow] = await db
          .select({ cnt: count() })
          .from(usersTable)
          .where(
            and(
              sql`${usersTable.suspendedAt} IS NOT NULL`,
              gte(usersTable.suspendedAt, range.start),
              lte(usersTable.suspendedAt, range.end),
            ),
          );
        const suspendedCount = Number(suspendedRow?.cnt ?? 0);
        if (suspendedCount > 0) {
          items.push({
            type: "suspended_users",
            priority: 3,
            count: suspendedCount,
            label: "Suspended collector accounts",
            deepLink: "/users?status=suspended",
          });
        }
      }

      if (canReadAnalytics && rangeIncludesCurrentScanPeriod) {
        const [quotaRow] = await db
          .select({ cnt: count() })
          .from(scanUsageTable)
          .innerJoin(usersTable, eq(scanUsageTable.userId, usersTable.id))
          .where(
            and(
              eq(usersTable.subscriptionTier, "free"),
              sql`${scanUsageTable.scanCount} >= ${FREE_SCAN_LIMIT}`,
              gte(scanUsageTable.periodStart, currentPeriod),
            ),
          );
        const quotaCount = Number(quotaRow?.cnt ?? 0);
        if (quotaCount > 0) {
          items.push({
            type: "scan_quota_reached",
            priority: 2,
            count: quotaCount,
            label: "Free users at scan quota this month",
            deepLink: "/users?tier=free",
          });
        }
      }

      items.sort((a, b) => a.priority - b.priority || b.count - a.count);

      res.json({
        range: {
          preset: range.preset,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        items,
        dataAvailability: {
          reports: canReadReports
            ? { available: true }
            : { available: false, reason: "Requires reports:read." },
          support: canReadContact
            ? { available: true }
            : { available: false, reason: "Requires contact:read." },
          scanQuota:
            canReadAnalytics && rangeIncludesCurrentScanPeriod
              ? { available: true }
              : {
                  available: false,
                  reason: !canReadAnalytics
                    ? "Requires analytics:read."
                    : "Scan quota attention is a current-month signal and is outside this date range.",
                },
          suspendedUsers: canReadUsers
            ? { available: true }
            : { available: false, reason: "Requires users:read." },
          verifiedFailures: {
            available: false,
            reason:
              "No durable application-failure monitor is connected to the Command Centre.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err }, "Admin attention query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /api/admin/search ──────────────────────────────────────────────────────
// Permission-scoped global search across users, reports and support.
// Categories the caller cannot read are omitted; unsupported sources (cards,
// events — no durable generic search store) are surfaced via availability meta.

router.get(
  "/admin/search",
  requireAdminPermission("dashboard:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const q = String((req.query as Record<string, string | undefined>)["q"] ?? "").trim();
    if (q.length < 2) {
      res.status(400).json({ message: "Search query must be at least 2 characters." });
      return;
    }

    try {
      const canReadUsers = hasPermission(req, "users:read");
      const canReadReports = hasPermission(req, "reports:read");
      const canReadContact = hasPermission(req, "contact:read");
      const like = `%${q}%`;

      const results: Record<string, unknown[]> = {};

      if (canReadUsers) {
        results["users"] = await db
          .select({
            id: usersTable.id,
            email: usersTable.email,
            displayName: usersTable.displayName,
            username: usersTable.username,
            subscriptionTier: usersTable.subscriptionTier,
            suspendedAt: usersTable.suspendedAt,
          })
          .from(usersTable)
          .where(
            or(
              ilike(usersTable.email, like),
              ilike(usersTable.displayName, like),
              ilike(usersTable.username, like),
            ),
          )
          .limit(20);
      }

      if (canReadReports) {
        results["reports"] = await db
          .select({
            id: userReportsTable.id,
            reason: userReportsTable.reason,
            status: userReportsTable.status,
            createdAt: userReportsTable.createdAt,
          })
          .from(userReportsTable)
          .where(
            or(
              ilike(userReportsTable.reason, like),
              ilike(userReportsTable.note, like),
            ),
          )
          .orderBy(desc(userReportsTable.createdAt))
          .limit(20);
      }

      if (canReadContact) {
        results["support"] = await db
          .select({
            id: contactSubmissionsTable.id,
            name: contactSubmissionsTable.name,
            email: contactSubmissionsTable.email,
            category: contactSubmissionsTable.category,
            subject: contactSubmissionsTable.subject,
            status: contactSubmissionsTable.status,
            submittedAt: contactSubmissionsTable.submittedAt,
          })
          .from(contactSubmissionsTable)
          .where(
            or(
              ilike(contactSubmissionsTable.name, like),
              ilike(contactSubmissionsTable.email, like),
              ilike(contactSubmissionsTable.subject, like),
              ilike(contactSubmissionsTable.message, like),
            ),
          )
          .orderBy(desc(contactSubmissionsTable.submittedAt))
          .limit(20);
      }

      res.json({
        query: q,
        results,
        dataAvailability: {
          users: canReadUsers
            ? { available: true }
            : { available: false, reason: "Requires users:read." },
          reports: canReadReports
            ? { available: true }
            : { available: false, reason: "Requires reports:read." },
          support: canReadContact
            ? { available: true }
            : { available: false, reason: "Requires contact:read." },
          cards: {
            available: false,
            reason: "No durable generic search store for cards.",
          },
          events: {
            available: false,
            reason: "No durable generic search store for events.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err }, "Admin search query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /api/admin/users/:id/detail ────────────────────────────────────────────
// Privacy-respecting per-user detail for a permitted admin. Never returns
// tokens or payment-provider data (which is unavailable server-side).

router.get(
  "/admin/users/:userId/detail",
  requireAdminPermission("users:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const userId = String(req.params["userId"]);
    const { limit, offset, page } = parsePagination(
      req.query as Record<string, string | undefined>,
      10,
      50,
    );

    try {
      const [user] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
          username: usersTable.username,
          bio: usersTable.bio,
          location: usersTable.location,
          avatarUrl: usersTable.avatarUrl,
          subscriptionTier: usersTable.subscriptionTier,
          isFoundingMember: usersTable.isFoundingMember,
          favouriteTcg: usersTable.favouriteTcg,
          collectorSince: usersTable.collectorSince,
          profilePublic: usersTable.profilePublic,
          suspendedAt: usersTable.suspendedAt,
          createdAt: usersTable.createdAt,
          updatedAt: usersTable.updatedAt,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!user) {
        res.status(404).json({ message: "User not found." });
        return;
      }

      const currentPeriod = utcPeriodStart();
      const canReadReports = hasPermission(req, "reports:read");
      const canReadContact = hasPermission(req, "contact:read");
      const reportsAgainstQuery = canReadReports
        ? db
            .select({ cnt: count() })
            .from(userReportsTable)
            .where(eq(userReportsTable.reportedUserId, userId))
        : Promise.resolve([] as Array<{ cnt: number }>);
      const reportsByQuery = canReadReports
        ? db
            .select({ cnt: count() })
            .from(userReportsTable)
            .where(eq(userReportsTable.reporterUserId, userId))
        : Promise.resolve([] as Array<{ cnt: number }>);
      const supportCountQuery = canReadContact
        ? db
            .select({ cnt: count() })
            .from(contactSubmissionsTable)
            .where(eq(contactSubmissionsTable.email, user.email))
        : Promise.resolve([] as Array<{ cnt: number }>);
      const recentReportsAgainstQuery = canReadReports
        ? db
            .select({
              id: userReportsTable.id,
              reason: userReportsTable.reason,
              status: userReportsTable.status,
              createdAt: userReportsTable.createdAt,
            })
            .from(userReportsTable)
            .where(eq(userReportsTable.reportedUserId, userId))
            .orderBy(desc(userReportsTable.createdAt))
            .limit(5)
        : Promise.resolve(
            [] as Array<{ id: string; reason: string; status: string; createdAt: Date }>,
          );
      const recentReportsSubmittedQuery = canReadReports
        ? db
            .select({
              id: userReportsTable.id,
              reason: userReportsTable.reason,
              status: userReportsTable.status,
              createdAt: userReportsTable.createdAt,
            })
            .from(userReportsTable)
            .where(eq(userReportsTable.reporterUserId, userId))
            .orderBy(desc(userReportsTable.createdAt))
            .limit(5)
        : Promise.resolve(
            [] as Array<{ id: string; reason: string; status: string; createdAt: Date }>,
          );
      const recentSupportQuery = canReadContact
        ? db
            .select({
              id: contactSubmissionsTable.id,
              category: contactSubmissionsTable.category,
              subject: contactSubmissionsTable.subject,
              status: contactSubmissionsTable.status,
              submittedAt: contactSubmissionsTable.submittedAt,
            })
            .from(contactSubmissionsTable)
            .where(eq(contactSubmissionsTable.email, user.email))
            .orderBy(desc(contactSubmissionsTable.submittedAt))
            .limit(5)
        : Promise.resolve(
            [] as Array<{
              id: string;
              category: string;
              subject: string;
              status: string;
              submittedAt: Date;
            }>,
          );

      const [
        sessionRows,
        [sessionCountRow],
        [scanRow],
        [collectionAgg],
        [wishlistAgg],
        recentCollection,
        notificationAgg,
        [reportsAgainstRow],
        [reportsByRow],
        [supportRow],
        recentReportsAgainst,
        recentReportsSubmitted,
        recentSupport,
      ] = await Promise.all([
        // Session metadata only — never the refresh token hash.
        db
          .select({
            id: userSessionsTable.id,
            createdAt: userSessionsTable.createdAt,
            expiresAt: userSessionsTable.expiresAt,
          })
          .from(userSessionsTable)
          .where(
            and(
              eq(userSessionsTable.userId, userId),
              gte(userSessionsTable.expiresAt, new Date()),
            ),
          )
          .orderBy(desc(userSessionsTable.createdAt))
          .limit(10),
        db
          .select({ cnt: count() })
          .from(userSessionsTable)
          .where(
            and(
              eq(userSessionsTable.userId, userId),
              gte(userSessionsTable.expiresAt, new Date()),
            ),
          ),
        db
          .select({ scanCount: scanUsageTable.scanCount })
          .from(scanUsageTable)
          .where(
            and(
              eq(scanUsageTable.userId, userId),
              eq(scanUsageTable.periodStart, sql`${currentPeriod.toISOString()}::timestamp`),
            ),
          )
          .limit(1),
        db
          .select({
            items: count(),
            quantity: sql<number>`COALESCE(SUM(${collectionItemsTable.quantity}), 0)`,
          })
          .from(collectionItemsTable)
          .where(eq(collectionItemsTable.userId, userId)),
        db
          .select({ items: count() })
          .from(wishlistItemsTable)
          .where(
            and(
              eq(wishlistItemsTable.userId, userId),
              sql`${wishlistItemsTable.deletedAt} IS NULL`,
            ),
          ),
        // Small recent safe listing — card id + denormalized card name only.
        db
          .select({
            cardId: collectionItemsTable.cardId,
            name: sql<string | null>`${collectionItemsTable.cardData}->>'name'`,
            quantity: collectionItemsTable.quantity,
            createdAt: collectionItemsTable.createdAt,
          })
          .from(collectionItemsTable)
          .where(eq(collectionItemsTable.userId, userId))
          .orderBy(desc(collectionItemsTable.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({
            total: count(),
            unread: sql<number>`COALESCE(SUM(CASE WHEN ${notificationsTable.isRead} = false THEN 1 ELSE 0 END), 0)`,
          })
          .from(notificationsTable)
          .where(eq(notificationsTable.userId, userId)),
        reportsAgainstQuery,
        reportsByQuery,
        supportCountQuery,
        recentReportsAgainstQuery,
        recentReportsSubmittedQuery,
        recentSupportQuery,
      ]);

      const notif = notificationAgg[0];

      res.json({
        user,
        account: {
          subscriptionTier: user.subscriptionTier,
          isFoundingMember: user.isFoundingMember,
          suspended: user.suspendedAt !== null,
          suspendedAt: user.suspendedAt?.toISOString() ?? null,
        },
        sessions: {
          active: sessionRows.map((s) => ({
            id: s.id,
            createdAt: s.createdAt.toISOString(),
            expiresAt: s.expiresAt.toISOString(),
          })),
          count: Number(sessionCountRow?.cnt ?? 0),
          listLimit: 10,
        },
        scanUsage: {
          period: `${currentPeriod.getUTCFullYear()}-${String(currentPeriod.getUTCMonth() + 1).padStart(2, "0")}`,
          scansThisMonth: Number(scanRow?.scanCount ?? 0),
          freeScanLimit: FREE_SCAN_LIMIT,
        },
        collection: {
          items: Number(collectionAgg?.items ?? 0),
          totalQuantity: Number(collectionAgg?.quantity ?? 0),
          recent: recentCollection.map((r) => ({
            cardId: r.cardId,
            name: r.name,
            quantity: r.quantity,
            addedAt: r.createdAt.toISOString(),
          })),
          recentPage: page,
          recentLimit: limit,
        },
        wishlist: {
          items: Number(wishlistAgg?.items ?? 0),
        },
        notifications: {
          total: Number(notif?.total ?? 0),
          unread: Number(notif?.unread ?? 0),
        },
        relationships: {
          reportsAvailable: canReadReports,
          supportAvailable: canReadContact,
          reportsAgainst: canReadReports ? Number(reportsAgainstRow?.cnt ?? 0) : null,
          reportsSubmitted: canReadReports ? Number(reportsByRow?.cnt ?? 0) : null,
          supportSubmissions: canReadContact ? Number(supportRow?.cnt ?? 0) : null,
          recentReportsAgainst,
          recentReportsSubmitted,
          recentSupport,
        },
        dataAvailability: {
          payment: {
            available: false,
            reason:
              "Payment-provider data (billing, invoices, refunds) is not stored server-side.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err, userId }, "Admin user detail query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /api/admin/subscriptions ───────────────────────────────────────────────
// Plan-state only. No fabricated payment/revenue/churn/refund figures.

router.get(
  "/admin/subscriptions",
  requireAdminPermission("users:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const query = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = parsePagination(query, 20, 100);
    const tier = query["tier"];

    try {
      const conditions = [];
      if (tier && tier !== "all") {
        if (tier === "founding_pro") {
          conditions.push(
            and(
              eq(usersTable.subscriptionTier, "pro"),
              eq(usersTable.isFoundingMember, true),
            )!,
          );
        } else {
          conditions.push(eq(usersTable.subscriptionTier, tier));
        }
      }
      const whereClause =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);

      const [[totalRow], rows] = await Promise.all([
        db.select({ cnt: count() }).from(usersTable).where(whereClause),
        db
          .select({
            id: usersTable.id,
            email: usersTable.email,
            displayName: usersTable.displayName,
            username: usersTable.username,
            subscriptionTier: usersTable.subscriptionTier,
            isFoundingMember: usersTable.isFoundingMember,
            createdAt: usersTable.createdAt,
            updatedAt: usersTable.updatedAt,
          })
          .from(usersTable)
          .where(whereClause)
          .orderBy(desc(usersTable.updatedAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({
        subscriptions: rows,
        total: Number(totalRow?.cnt ?? 0),
        page,
        limit,
        dataAvailability: {
          planState: { available: true },
          revenue: {
            available: false,
            reason: "Revenue/churn/refund data is not stored server-side.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err }, "Admin subscriptions query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// NOTE: GET /admin/reports is handled by adminTrust/reports.ts (canonical
// reports-queue handler with full task-285 contract: id filter, status=unresolved,
// status validation, operational notes enrichment). adminTrustRouter is mounted
// before adminRouter so that handler wins. All other report mutation routes
// (POST /admin/reports/:id/assign, notes, outcome, suspend-user) also live there.

// ── PATCH /api/admin/reports/:id ───────────────────────────────────────────────

router.patch(
  "/admin/reports/:reportId",
  requireAdminPermission("reports:moderate"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    await patchQueueItem(req, res, "report");
  },
);

// ── GET /api/admin/contact ────────────────────────────────────────────────────
// Rich, paginated, filterable support queue. Backwards compatible: still
// returns a top-level `submissions` array with all original fields.

router.get(
  "/admin/contact",
  requireAdminPermission("contact:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const query = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = parsePagination(query, 20, 100);
    const statusFilter = query["status"];
    const categoryFilter = query["category"];
    const searchTerm = query["q"]?.trim();
    const contactId = query["id"];

    try {
      const conditions = [];
      if (contactId) {
        if (!UUID_RE.test(contactId)) {
          res.status(400).json({ message: "Invalid support case id." });
          return;
        }
        conditions.push(eq(contactSubmissionsTable.id, contactId));
      }
      if (statusFilter && statusFilter !== "all") {
        if (statusFilter === "unresolved") {
          conditions.push(
            inArray(contactSubmissionsTable.status, ["open", "in_review", "escalated"]),
          );
        } else if (!QUEUE_STATUSES.includes(statusFilter as QueueStatus)) {
          res.status(400).json({ message: "Invalid status filter." });
          return;
        } else {
          conditions.push(eq(contactSubmissionsTable.status, statusFilter));
        }
      }
      if (categoryFilter && categoryFilter !== "all") {
        conditions.push(eq(contactSubmissionsTable.category, categoryFilter));
      }
      if (searchTerm) {
        conditions.push(
          or(
            ilike(contactSubmissionsTable.name, `%${searchTerm}%`),
            ilike(contactSubmissionsTable.email, `%${searchTerm}%`),
            ilike(contactSubmissionsTable.subject, `%${searchTerm}%`),
          )!,
        );
      }
      const whereClause =
        conditions.length === 0
          ? undefined
          : conditions.length === 1
            ? conditions[0]
            : and(...conditions);

      const [[totalRow], submissions] = await Promise.all([
        db.select({ cnt: count() }).from(contactSubmissionsTable).where(whereClause),
        db
          .select({
            id: contactSubmissionsTable.id,
            name: contactSubmissionsTable.name,
            email: contactSubmissionsTable.email,
            category: contactSubmissionsTable.category,
            subject: contactSubmissionsTable.subject,
            message: contactSubmissionsTable.message,
            submittedAt: contactSubmissionsTable.submittedAt,
            status: contactSubmissionsTable.status,
            assignedAdminId: contactSubmissionsTable.assignedAdminId,
            resolution: contactSubmissionsTable.resolution,
            resolutionReason: contactSubmissionsTable.resolutionReason,
            escalatedAt: contactSubmissionsTable.escalatedAt,
            escalationReason: contactSubmissionsTable.escalationReason,
            firstResponseAt: contactSubmissionsTable.firstResponseAt,
            resolvedAt: contactSubmissionsTable.resolvedAt,
            updatedAt: contactSubmissionsTable.updatedAt,
            assignedAdminDisplayName: sql<string | null>`(
              SELECT display_name FROM admin_accounts
              WHERE id = ${contactSubmissionsTable.assignedAdminId} LIMIT 1
            )`,
          })
          .from(contactSubmissionsTable)
          .where(whereClause)
          .orderBy(desc(contactSubmissionsTable.submittedAt))
          .limit(limit)
          .offset(offset),
      ]);
      const notes = await loadOperationalNotes(
        "support",
        submissions.map((submission) => submission.id),
      );

      res.json({
        submissions: submissions.map((submission) => ({
          ...submission,
          notes: notes.get(submission.id) ?? [],
        })),
        total: Number(totalRow?.cnt ?? 0),
        page,
        limit,
        filter: { status: statusFilter ?? "all", category: categoryFilter ?? "all" },
      });
    } catch (err) {
      req.log.error({ err }, "Admin contact query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── PATCH /api/admin/contact/:id ───────────────────────────────────────────────

router.patch(
  "/admin/contact/:contactId",
  requireAdminPermission("contact:moderate"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    await patchQueueItem(req, res, "support");
  },
);

/**
 * Shared workflow patch for the reports and support queues. Updates stored
 * status/assignee/resolution/escalation/SLA columns and appends operational
 * history entries in the same transaction. This is case history, not the
 * platform-wide immutable audit mechanism owned by the separate audit task.
 */
async function patchQueueItem(
  req: AdminRequest,
  res: Response,
  kind: "report" | "support",
): Promise<void> {
  const table = kind === "report" ? userReportsTable : contactSubmissionsTable;
  const idParam = kind === "report" ? "reportId" : "contactId";
  const id = String(req.params[idParam]);

  const body = req.body as {
    status?: string;
    assignedAdminId?: string | null;
    note?: string;
    resolution?: string;
    resolutionReason?: string;
    escalationReason?: string;
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  if (body.status !== undefined && !QUEUE_STATUSES.includes(body.status as QueueStatus)) {
    res.status(400).json({
      message: `Invalid status. Must be one of: ${QUEUE_STATUSES.join(", ")}.`,
    });
    return;
  }
  for (const field of ["note", "resolution", "resolutionReason", "escalationReason"] as const) {
    const value = body[field];
    if (value !== undefined && typeof value !== "string") {
      res.status(400).json({ message: `${field} must be a string.` });
      return;
    }
  }
  if (body.note !== undefined && body.note.length > MAX_NOTE_LEN) {
    res.status(400).json({ message: `Note must be at most ${MAX_NOTE_LEN} characters.` });
    return;
  }
  if (body.resolution !== undefined && body.resolution.length > MAX_RESOLUTION_LEN) {
    res
      .status(400)
      .json({ message: `Resolution must be at most ${MAX_RESOLUTION_LEN} characters.` });
    return;
  }
  for (const field of ["resolutionReason", "escalationReason"] as const) {
    if (body[field] !== undefined && body[field].length > MAX_REASON_LEN) {
      res.status(400).json({ message: `${field} must be at most ${MAX_REASON_LEN} characters.` });
      return;
    }
  }
  if (
    body.assignedAdminId !== undefined &&
    body.assignedAdminId !== null &&
    (typeof body.assignedAdminId !== "string" || !UUID_RE.test(body.assignedAdminId))
  ) {
    res.status(400).json({ message: "Assignee must be a valid admin id or null." });
    return;
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  const resolution = typeof body.resolution === "string" ? body.resolution.trim() : undefined;
  const resolutionReason =
    typeof body.resolutionReason === "string" ? body.resolutionReason.trim() : undefined;
  const escalationReason =
    typeof body.escalationReason === "string" ? body.escalationReason.trim() : undefined;
  const hasWorkflowChange =
    body.status !== undefined ||
    body.assignedAdminId !== undefined ||
    body.resolution !== undefined ||
    body.resolutionReason !== undefined ||
    body.escalationReason !== undefined;
  if (!hasWorkflowChange && note.length === 0) {
    res.status(400).json({ message: "Provide a workflow change or an internal note." });
    return;
  }
  const actingAdminId = req.admin?.id;
  if (!actingAdminId) {
    res.status(401).json({ message: "Admin authentication required." });
    return;
  }

  try {
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      if (body.assignedAdminId) {
        const [assignee] = await tx
          .select({ id: adminAccountsTable.id })
          .from(adminAccountsTable)
          .where(
            and(
              eq(adminAccountsTable.id, body.assignedAdminId),
              eq(adminAccountsTable.status, "active"),
            ),
          )
          .limit(1);
        if (!assignee) {
          return { kind: "invalid" as const, message: "Assignee must be an active admin account." };
        }
      }

      const [existing] = await tx
        .select({
          firstResponseAt: table.firstResponseAt,
          status: table.status,
          assignedAdminId: table.assignedAdminId,
          resolution: table.resolution,
          resolutionReason: table.resolutionReason,
          escalationReason: table.escalationReason,
          escalatedAt: table.escalatedAt,
          resolvedAt: table.resolvedAt,
        })
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (!existing) return { kind: "missing" as const };

      const targetStatus = (body.status ?? existing.status) as QueueStatus;
      const targetResolution = resolution ?? existing.resolution;
      const targetResolutionReason = resolutionReason ?? existing.resolutionReason;
      const targetEscalationReason = escalationReason ?? existing.escalationReason;
      const terminal = targetStatus === "resolved" || targetStatus === "dismissed";

      if (terminal && (!targetResolution || !targetResolutionReason)) {
        return {
          kind: "invalid" as const,
          message: "Resolution details and a resolution reason are required to close a case.",
        };
      }
      if (!terminal && (body.resolution !== undefined || body.resolutionReason !== undefined)) {
        return {
          kind: "invalid" as const,
          message: "Resolution details can only be stored for resolved or dismissed cases.",
        };
      }
      if (targetStatus === "escalated" && !targetEscalationReason) {
        return { kind: "invalid" as const, message: "An escalation reason is required." };
      }
      if (targetStatus !== "escalated" && body.escalationReason !== undefined) {
        return {
          kind: "invalid" as const,
          message: "An escalation reason can only be stored for escalated cases.",
        };
      }

      const patch: Record<string, unknown> = { updatedAt: now };
      if (!existing.firstResponseAt) patch["firstResponseAt"] = now;
      if (body.status !== undefined) {
        patch["status"] = targetStatus;
        if (terminal) {
          patch["resolution"] = targetResolution;
          patch["resolutionReason"] = targetResolutionReason;
          patch["resolvedAt"] = existing.resolvedAt ?? now;
        } else {
          patch["resolution"] = null;
          patch["resolutionReason"] = null;
          patch["resolvedAt"] = null;
        }
        if (targetStatus === "escalated") {
          patch["escalationReason"] = targetEscalationReason;
          patch["escalatedAt"] = existing.escalatedAt ?? now;
        } else {
          patch["escalationReason"] = null;
          patch["escalatedAt"] = null;
        }
      } else {
        if (resolution !== undefined) patch["resolution"] = resolution;
        if (resolutionReason !== undefined) patch["resolutionReason"] = resolutionReason;
        if (escalationReason !== undefined) patch["escalationReason"] = escalationReason;
      }
      if (body.assignedAdminId !== undefined) {
        patch["assignedAdminId"] = body.assignedAdminId;
      }

      const [row] = await tx
        .update(table)
        .set(patch)
        .where(eq(table.id, id))
        .returning({ id: table.id, status: table.status });
      if (!row) return { kind: "missing" as const };

      const workflowChanges: string[] = [];
      if (body.status !== undefined && targetStatus !== existing.status) {
        workflowChanges.push(`status ${existing.status} → ${targetStatus}`);
      }
      if (
        body.assignedAdminId !== undefined &&
        body.assignedAdminId !== existing.assignedAdminId
      ) {
        workflowChanges.push(body.assignedAdminId ? "assignment updated" : "assignment removed");
      }
      if (body.resolution !== undefined || body.resolutionReason !== undefined) {
        workflowChanges.push("resolution details updated");
      }
      if (body.escalationReason !== undefined) {
        workflowChanges.push("escalation reason updated");
      }
      if (workflowChanges.length > 0) {
        await tx.insert(adminOperationalNotesTable).values({
          subjectType: kind,
          subjectId: id,
          authorAdminId: actingAdminId,
          body: `Workflow update: ${workflowChanges.join("; ")}.`,
        });
      }
      if (note.length > 0) {
        await tx.insert(adminOperationalNotesTable).values({
          subjectType: kind,
          subjectId: id,
          authorAdminId: actingAdminId,
          body: note,
        });
      }
      return { kind: "updated" as const, row };
    });

    if (result.kind === "invalid") {
      res.status(400).json({ message: result.message });
      return;
    }
    if (result.kind === "missing") {
      res.status(404).json({ message: `${kind === "report" ? "Report" : "Submission"} not found.` });
      return;
    }

    const notes = await db
      .select({
        id: adminOperationalNotesTable.id,
        authorAdminId: adminOperationalNotesTable.authorAdminId,
        body: adminOperationalNotesTable.body,
        createdAt: adminOperationalNotesTable.createdAt,
      })
      .from(adminOperationalNotesTable)
      .where(
        and(
          eq(adminOperationalNotesTable.subjectType, kind),
          eq(adminOperationalNotesTable.subjectId, id),
        ),
      )
      .orderBy(desc(adminOperationalNotesTable.createdAt));

    req.log.info({ kind, id, status: result.row.status }, "Admin updated queue item");
    res.json({ id: result.row.id, status: result.row.status, notes });
  } catch (err) {
    req.log.error({ err, kind, id }, "Admin queue patch failed");
    res.status(500).json({ message: "Database error. Please try again." });
  }
}

export default router;
