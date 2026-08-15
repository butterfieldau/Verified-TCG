/**
 * Admin routes — internal operator panel only.
 *
 * All endpoints require a valid admin session cookie (set by POST /api/admin/auth/login).
 *
 * GET  /api/admin/stats                  — overview statistics
 * GET  /api/admin/users                  — paginated user list + search
 * POST /api/admin/users/:id/subscription — set subscription_tier / is_founding_member
 * GET  /api/admin/scan-usage             — scan analytics + top scanners
 * GET  /api/admin/reports                — all user reports
 * GET  /api/admin/contact                — all contact submissions
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  scanUsageTable,
  userReportsTable,
  contactSubmissionsTable,
} from "@workspace/db";
import {
  eq,
  ilike,
  or,
  and,
  desc,
  asc,
  gte,
  count,
  sum,
  sql,
} from "drizzle-orm";
import { requireAdminSession } from "../lib/adminSession";

const router = Router();

// Apply admin session guard to all admin data routes
router.use("/admin", requireAdminSession);

/** Returns the first day of the current UTC calendar month — matches the scan service. */
function utcPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const FREE_SCAN_LIMIT = 30;

// ── GET /api/admin/stats ──────────────────────────────────────────────────────

router.get("/admin/stats", async (_req: Request, res: Response) => {
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
    console.error("[admin] GET /admin/stats error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────

router.get("/admin/users", async (req: Request, res: Response) => {
  const {
    q,
    email,
    page = "1",
    limit = "20",
    tier,
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
    console.error("[admin] GET /admin/users error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── POST /api/admin/users/:id/subscription ────────────────────────────────────

router.post("/admin/users/:userId/subscription", async (req: Request, res: Response) => {
  const userId = String(req.params["userId"]);
  const { subscription_tier, is_founding_member } = req.body as {
    subscription_tier?: string;
    is_founding_member?: boolean;
  };

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

    console.log(`[admin] Subscription updated for user ${updated.id} (${updated.email}):`, patch);

    return res.json({ message: "User subscription updated successfully.", user: updated });
  } catch (err) {
    console.error("[admin] POST /admin/users/:userId/subscription error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── GET /api/admin/scan-usage ─────────────────────────────────────────────────

router.get("/admin/scan-usage", async (_req: Request, res: Response) => {
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
    console.error("[admin] GET /admin/scan-usage error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── GET /api/admin/reports ────────────────────────────────────────────────────
// Uses raw SQL correlated subqueries to avoid the drizzle alias() helper.

router.get("/admin/reports", async (_req: Request, res: Response) => {
  try {
    const reports = await db
      .select({
        id: userReportsTable.id,
        reason: userReportsTable.reason,
        note: userReportsTable.note,
        createdAt: userReportsTable.createdAt,
        reporterUserId: userReportsTable.reporterUserId,
        reportedUserId: userReportsTable.reportedUserId,
        reporterUsername: sql<string | null>`(
          SELECT username FROM users WHERE id = ${userReportsTable.reporterUserId} LIMIT 1
        )`,
        reporterDisplayName: sql<string | null>`(
          SELECT display_name FROM users WHERE id = ${userReportsTable.reporterUserId} LIMIT 1
        )`,
        reportedUsername: sql<string | null>`(
          SELECT username FROM users WHERE id = ${userReportsTable.reportedUserId} LIMIT 1
        )`,
        reportedDisplayName: sql<string | null>`(
          SELECT display_name FROM users WHERE id = ${userReportsTable.reportedUserId} LIMIT 1
        )`,
      })
      .from(userReportsTable)
      .orderBy(desc(userReportsTable.createdAt));

    return res.json({ reports });
  } catch (err) {
    console.error("[admin] GET /admin/reports error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── GET /api/admin/contact ────────────────────────────────────────────────────

router.get("/admin/contact", async (_req: Request, res: Response) => {
  try {
    const submissions = await db
      .select()
      .from(contactSubmissionsTable)
      .orderBy(desc(contactSubmissionsTable.submittedAt));

    return res.json({ submissions });
  } catch (err) {
    console.error("[admin] GET /admin/contact error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

export default router;
