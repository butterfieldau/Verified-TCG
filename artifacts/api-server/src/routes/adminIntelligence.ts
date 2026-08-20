/**
 * Admin Intelligence routes — operational insights for the platform.
 *
 * GET  /api/admin/intelligence/analytics   — acquisition, active users, retention, onboarding,
 *                                            adoption, performance — ALL from retained telemetry
 * GET  /api/admin/intelligence/health       — truthful system health (DB, API, jobs, queue)
 * GET  /api/admin/intelligence/integrations — configured/missing provider status
 * GET  /api/admin/intelligence/jobs         — paginated/filterable refresh job list
 * POST /api/admin/intelligence/jobs/:id/retry  — retry failed/cancelled job (validated UUID)
 * POST /api/admin/intelligence/jobs/:id/cancel — cancel queued job (validated UUID)
 * GET  /api/admin/intelligence/audit        — immutable merged audit/security investigation
 */

import { Router, type Response } from "express";
import {
  adminAccountsTable,
  adminAuditEventsTable,
  adminAuditLogsTable,
  db,
  pricingRefreshJobsTable,
  telemetryEventsTable,
  usersTable,
} from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm";
import {
  type AdminRequest,
  requireAdminCsrf,
  requireAdminPermission,
  requireAdminSession,
  requireRecentAdminAuth,
} from "../lib/adminSession";
import { recordAdminAudit } from "../lib/adminAudit";
import { runRefreshJob } from "./adminOperations";
import { isPCConfigured } from "../pricing/pricecharting";

const router = Router();
router.use("/admin", requireAdminSession, requireAdminCsrf);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function pageValue(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

function requiredReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 10 && reason.length <= 500 ? reason : null;
}

function confirmedAction(body: Record<string, unknown>, phrase: string): boolean {
  return body["confirmed"] === true && body["confirmation"] === phrase;
}

/**
 * Resolves a date range for analytics queries.
 * Supports preset=7d|30d|90d or custom with start/end ISO strings.
 */
interface ResolvedRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
  preset: string;
  error?: string;
}

function resolveAnalyticsRange(query: Record<string, string | undefined>): ResolvedRange {
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
    if (parsedEnd && rawEnd && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd)) {
      parsedEnd.setUTCHours(23, 59, 59, 999);
    }
    if (!parsedStart || Number.isNaN(parsedStart.getTime())) {
      return {
        start: now, end: now, prevStart: now, prevEnd: now, days: 0, preset,
        error: "Custom range requires a valid `start` ISO date.",
      };
    }
    if (Number.isNaN(parsedEnd.getTime())) {
      return {
        start: now, end: now, prevStart: now, prevEnd: now, days: 0, preset,
        error: "Custom range `end` date is invalid.",
      };
    }
    if (parsedEnd <= parsedStart) {
      return {
        start: now, end: now, prevStart: now, prevEnd: now, days: 0, preset,
        error: "Custom range `end` must be after `start`.",
      };
    }
    start = parsedStart;
    end = parsedEnd;
    const spanDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
    if (spanDays > 366) {
      return {
        start: now, end: now, prevStart: now, prevEnd: now, days: 0, preset,
        error: "Custom range must not span more than 366 days.",
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

// ── GET /api/admin/intelligence/analytics ─────────────────────────────────────
// ALL date-ranged metrics from retained telemetry only.
// totalUsers is a clearly-labelled current DB snapshot.
// tracking.startedAt = MIN recorded analytics/api event in telemetry.
// historyLimited = true when no telemetry history or range begins before tracking.

router.get(
  "/admin/intelligence/analytics",
  requireAdminPermission("analytics:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const range = resolveAnalyticsRange(req.query as Record<string, string | undefined>);
    if (range.error) {
      res.status(400).json({ message: range.error });
      return;
    }

    try {
      // ── Tracking start: oldest retained analytics/api event ──────────────────
      const [trackingRow] = await db
        .select({ minAt: min(telemetryEventsTable.recordedAt) })
        .from(telemetryEventsTable)
        .where(
          inArray(telemetryEventsTable.category, ["analytics", "api_error"]),
        );
      const trackingStartedAt = trackingRow?.minAt ?? null;
      const historyLimited =
        !trackingStartedAt ||
        range.start.getTime() < (trackingStartedAt?.getTime() ?? 0);
      const comparisonAvailable =
        Boolean(trackingStartedAt) &&
        range.prevStart.getTime() >= (trackingStartedAt?.getTime() ?? Number.POSITIVE_INFINITY);

      // ── Acquisition: signups from telemetry account_created events ───────────
      // count distinct userId for account_created in range
      const [signupsCurrentRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            eq(telemetryEventsTable.action, "account_created"),
            gte(telemetryEventsTable.recordedAt, range.start),
            lte(telemetryEventsTable.recordedAt, range.end),
          ),
        );
      const signups = Number(signupsCurrentRow?.cnt ?? 0);

      const [signupsPrevRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            eq(telemetryEventsTable.action, "account_created"),
            gte(telemetryEventsTable.recordedAt, range.prevStart),
            lte(telemetryEventsTable.recordedAt, range.prevEnd),
          ),
        );
      const priorPeriodSignups = comparisonAvailable ? Number(signupsPrevRow?.cnt ?? 0) : null;

      // Daily signup trend from telemetry
      const dailySignupRows = await db
        .select({
          date: sql<string>`TO_CHAR(DATE(recorded_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
          cnt: sql<string>`COUNT(DISTINCT user_id)`,
        })
        .from(telemetryEventsTable)
        .where(
          and(
            eq(telemetryEventsTable.action, "account_created"),
            gte(telemetryEventsTable.recordedAt, range.start),
            lte(telemetryEventsTable.recordedAt, range.end),
          ),
        )
        .groupBy(sql`DATE(recorded_at AT TIME ZONE 'UTC')`)
        .orderBy(sql`DATE(recorded_at AT TIME ZONE 'UTC')`);

      // Current total users — DB snapshot, labelled as such
      const [totalUsersRow] = await db.select({ cnt: count() }).from(usersTable);
      const totalUsers = Number(totalUsersRow?.cnt ?? 0);

      // ── Active users: distinct user IDs from account/session/profile events ──
      // Excludes api.request to focus on user intent events
      const ACTIVE_EVENTS = ["account_created", "session_started", "profile_updated", "profile_completed"];

      const [auDailyRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            inArray(telemetryEventsTable.action, ACTIVE_EVENTS),
            gte(telemetryEventsTable.recordedAt, new Date(range.end.getTime() - 86_400_000)),
            lte(telemetryEventsTable.recordedAt, range.end),
          ),
        );
      const [auWeeklyRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            inArray(telemetryEventsTable.action, ACTIVE_EVENTS),
            gte(telemetryEventsTable.recordedAt, new Date(range.end.getTime() - 7 * 86_400_000)),
            lte(telemetryEventsTable.recordedAt, range.end),
          ),
        );
      const [auMonthlyRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            inArray(telemetryEventsTable.action, ACTIVE_EVENTS),
            gte(telemetryEventsTable.recordedAt, new Date(range.end.getTime() - 30 * 86_400_000)),
            lte(telemetryEventsTable.recordedAt, range.end),
          ),
        );
      const [auInRangeRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            inArray(telemetryEventsTable.action, ACTIVE_EVENTS),
            gte(telemetryEventsTable.recordedAt, range.start),
            lte(telemetryEventsTable.recordedAt, range.end),
          ),
        );
      const [auPrevRow] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT user_id)` })
        .from(telemetryEventsTable)
        .where(
          and(
            inArray(telemetryEventsTable.action, ACTIVE_EVENTS),
            gte(telemetryEventsTable.recordedAt, range.prevStart),
            lte(telemetryEventsTable.recordedAt, range.prevEnd),
          ),
        );

      const activeInRange = Number(auInRangeRow?.cnt ?? 0);
      const priorActiveInRange = comparisonAvailable ? Number(auPrevRow?.cnt ?? 0) : null;

      // ── Retention: weekly cohorts from account_created + session_started ─────
      // Cohorts are weekly buckets; must be at least 14d old to measure week1 return
      const RETENTION_WEEKS = 8;
      const cohortRows = await db.execute<{
        cohort_week: string;
        signups: number;
        eligible_signups: number;
        returned_week1: number;
      }>(sql`
        WITH signups AS (
          SELECT
            user_id,
            MIN(recorded_at) AS first_seen
          FROM telemetry_events
          WHERE action = 'account_created'
            AND user_id IS NOT NULL
            AND recorded_at >= ${range.start}
            AND recorded_at <= ${range.end}
          GROUP BY user_id
        ),
        cohorts AS (
          SELECT
            user_id,
            first_seen,
            DATE_TRUNC('week', first_seen AT TIME ZONE 'UTC') AS cohort_week
          FROM signups
        ),
        returns AS (
          SELECT DISTINCT
            c.cohort_week,
            s.user_id
          FROM cohorts c
          JOIN telemetry_events s ON s.user_id = c.user_id
          WHERE s.action = 'session_started'
            AND s.recorded_at >= c.first_seen + INTERVAL '7 days'
            AND s.recorded_at < c.first_seen + INTERVAL '14 days'
        )
        SELECT
          TO_CHAR(c.cohort_week, 'YYYY-MM-DD') AS cohort_week,
          COUNT(DISTINCT c.user_id)::int AS signups,
          COUNT(DISTINCT c.user_id) FILTER (
            WHERE c.first_seen <= ${new Date(range.end.getTime() - 14 * 86_400_000)}
          )::int AS eligible_signups,
          COUNT(DISTINCT r.user_id)::int AS returned_week1
        FROM cohorts c
        LEFT JOIN returns r ON r.cohort_week = c.cohort_week
        GROUP BY c.cohort_week
        ORDER BY c.cohort_week DESC
        LIMIT ${RETENTION_WEEKS}
      `);

      const retentionCohorts = cohortRows.rows.map((row) => {
        const signupsCt = Number(row.signups);
        const eligibleSignups = Number(row.eligible_signups);
        const returnedWeek1 = Number(row.returned_week1);
        return {
          cohortWeek: row.cohort_week,
          signups: signupsCt,
          eligibleSignups,
          eligible: eligibleSignups > 0,
          returnedWeek1: eligibleSignups > 0 ? returnedWeek1 : null,
          retainedWeek1Rate:
            eligibleSignups > 0 ? +(returnedWeek1 / eligibleSignups).toFixed(4) : null,
        };
      }).reverse();

      const retentionAvailable = !historyLimited && retentionCohorts.some((c) => c.eligible);

      // ── Onboarding funnel ────────────────────────────────────────────────────
      const ONBOARDING_STEPS = [
        { key: "account_created", label: "Account created" },
        { key: "session_started", label: "First session" },
        { key: "profile_updated", label: "Profile updated" },
        { key: "profile_completed", label: "Profile completed" },
      ];

      const onboardingResult = await db.execute<{
        account_created: number;
        session_started: number;
        profile_updated: number;
        profile_completed: number;
      }>(sql`
        WITH cohort AS (
          SELECT user_id, MIN(recorded_at) AS created_at
          FROM telemetry_events
          WHERE action = 'account_created'
            AND user_id IS NOT NULL
            AND recorded_at >= ${range.start}
            AND recorded_at <= ${range.end}
          GROUP BY user_id
        )
        SELECT
          COUNT(*)::int AS account_created,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM telemetry_events e
            WHERE e.user_id = cohort.user_id
              AND e.action = 'session_started'
              AND e.recorded_at >= cohort.created_at
              AND e.recorded_at <= ${range.end}
          ))::int AS session_started,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM telemetry_events e
            WHERE e.user_id = cohort.user_id
              AND e.action = 'profile_updated'
              AND e.recorded_at >= cohort.created_at
              AND e.recorded_at <= ${range.end}
          ))::int AS profile_updated,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM telemetry_events e
            WHERE e.user_id = cohort.user_id
              AND e.action = 'profile_completed'
              AND e.recorded_at >= cohort.created_at
              AND e.recorded_at <= ${range.end}
          ))::int AS profile_completed
        FROM cohort
      `);
      const onboardingRow = onboardingResult.rows[0];
      const onboardingCounts: Record<string, number> = {
        account_created: Number(onboardingRow?.account_created ?? 0),
        session_started: Number(onboardingRow?.session_started ?? 0),
        profile_updated: Number(onboardingRow?.profile_updated ?? 0),
        profile_completed: Number(onboardingRow?.profile_completed ?? 0),
      };

      const topCount = onboardingCounts["account_created"] ?? 0;
      const onboardingSteps = ONBOARDING_STEPS.map((step) => ({
        key: step.key,
        label: step.label,
        count: onboardingCounts[step.key] ?? 0,
        conversionRate: topCount > 0
          ? +((onboardingCounts[step.key] ?? 0) / topCount).toFixed(4)
          : 0,
      }));

      // ── Feature adoption ─────────────────────────────────────────────────────
      // Excludes api.request/api.error (infrastructure noise), uses analytics events only
      const adoptionRows = await db
        .select({
          action: telemetryEventsTable.action,
          users: sql<string>`COUNT(DISTINCT user_id)`,
          events: sql<string>`COUNT(*)`,
        })
        .from(telemetryEventsTable)
        .where(
          and(
            eq(telemetryEventsTable.category, "analytics"),
            gte(telemetryEventsTable.recordedAt, range.start),
            lte(telemetryEventsTable.recordedAt, range.end),
            sql`action NOT IN ('api.request', 'api.error')`,
          ),
        )
        .groupBy(telemetryEventsTable.action)
        .orderBy(desc(sql`COUNT(DISTINCT user_id)`))
        .limit(20);

      const FEATURE_LABELS: Record<string, string> = {
        account_created: "Account created",
        session_started: "Session started",
        profile_updated: "Profile updated",
        profile_completed: "Profile completed",
      };

      const adoptionFeatures = adoptionRows.map((row) => ({
        key: row.action,
        label: FEATURE_LABELS[row.action] ?? row.action,
        users: Number(row.users),
        events: Number(row.events),
      }));

      // ── API performance from retained api.request/api.error events ───────────
      const perfRow = await db.execute<{
        requests: string;
        errors: string;
        p50_ms: string | null;
        p95_ms: string | null;
      }>(sql`
        SELECT
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (
            WHERE action = 'api.error' AND status_code >= 500
          )::int AS errors,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
        FROM telemetry_events
        WHERE action IN ('api.request', 'api.error')
          AND recorded_at >= ${range.start}
          AND recorded_at <= ${range.end}
      `);
      const perf = perfRow.rows[0];
      const perfRequests = Number(perf?.requests ?? 0);
      const perfErrors = Number(perf?.errors ?? 0);

      // Daily performance series
      const seriesRows = await db.execute<{
        date: string;
        requests: string;
        errors: string;
        p95_ms: string | null;
      }>(sql`
        SELECT
          TO_CHAR(DATE(recorded_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (
            WHERE action = 'api.error' AND status_code >= 500
          )::int AS errors,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
        FROM telemetry_events
        WHERE action IN ('api.request', 'api.error')
          AND recorded_at >= ${range.start}
          AND recorded_at <= ${range.end}
        GROUP BY DATE(recorded_at AT TIME ZONE 'UTC')
        ORDER BY DATE(recorded_at AT TIME ZONE 'UTC')
      `);

      // ── Prior period comparisons ──────────────────────────────────────────────
      const perfPrevResult = await db.execute<{
        requests: string;
        errors: string;
      }>(sql`
        SELECT
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (
            WHERE action = 'api.error' AND status_code >= 500
          )::int AS errors
        FROM telemetry_events
        WHERE action IN ('api.request', 'api.error')
          AND recorded_at >= ${range.prevStart}
          AND recorded_at <= ${range.prevEnd}
      `);
      const perfPrevRow = perfPrevResult.rows[0];
      const prevPerfRequests = comparisonAvailable ? Number(perfPrevRow?.requests ?? 0) : null;
      const prevPerfErrors = comparisonAvailable ? Number(perfPrevRow?.errors ?? 0) : null;
      const currentErrorRate = perfRequests > 0 ? +(perfErrors / perfRequests).toFixed(4) : 0;
      const prevErrorRate = prevPerfRequests && prevPerfRequests > 0
        ? +((prevPerfErrors ?? 0) / prevPerfRequests).toFixed(4)
        : null;

      res.json({
        range: {
          preset: range.preset,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          previousStart: range.prevStart.toISOString(),
          previousEnd: range.prevEnd.toISOString(),
        },
        tracking: {
          startedAt: trackingStartedAt?.toISOString() ?? null,
          historyLimited,
          reason: historyLimited
            ? trackingStartedAt
              ? "Selected range extends before retained telemetry history."
              : "No telemetry history has been recorded yet."
            : null,
          retainedEvents: true,
        },
        acquisition: {
          signups,
          totalUsers,
          daily: dailySignupRows.map((r) => ({ date: r.date, count: Number(r.cnt) })),
          priorPeriodSignups,
        },
        activeUsers: {
          daily: Number(auDailyRow?.cnt ?? 0),
          weekly: Number(auWeeklyRow?.cnt ?? 0),
          monthly: Number(auMonthlyRow?.cnt ?? 0),
          inRange: activeInRange,
          definition: "Distinct user IDs with account_created, session_started, or profile events in the period.",
        },
        retention: {
          available: retentionAvailable,
          reason: retentionAvailable ? null : historyLimited
            ? "Insufficient telemetry history for retention analysis."
            : "No eligible cohorts (all cohorts are too recent to measure week-1 return).",
          cohorts: retentionCohorts,
        },
        onboarding: {
          available: !historyLimited,
          reason: historyLimited ? "Insufficient telemetry history." : null,
          steps: onboardingSteps,
        },
        adoption: {
          features: adoptionFeatures,
        },
        performance: {
          requests: perfRequests,
          errors: perfErrors,
          errorRate: currentErrorRate,
          p50Ms: perf?.p50_ms != null ? Math.round(Number(perf.p50_ms)) : null,
          p95Ms: perf?.p95_ms != null ? Math.round(Number(perf.p95_ms)) : null,
          series: seriesRows.rows.map((row) => ({
            date: row.date,
            requests: Number(row.requests),
            errors: Number(row.errors),
            p95Ms: row.p95_ms != null ? Math.round(Number(row.p95_ms)) : null,
          })),
        },
        comparisons: {
          available: comparisonAvailable,
          reason: comparisonAvailable
            ? null
            : "The prior period extends before retained telemetry history.",
          signups: comparisonAvailable ? { current: signups, prior: Number(signupsPrevRow?.cnt ?? 0) } : null,
          activeUsers: comparisonAvailable ? { current: activeInRange, prior: priorActiveInRange } : null,
          errorRate: comparisonAvailable ? { current: currentErrorRate, prior: prevErrorRate } : null,
        },
        dataAvailability: {
          revenue: {
            available: false,
            reason: "Revenue data is not collected in this system.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err }, "Intelligence analytics query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /api/admin/intelligence/health ────────────────────────────────────────
// Actual observed signals only — no fabrication. API status from retained telemetry.
// overall: unavailable when DB fails.

router.get(
  "/admin/intelligence/health",
  requireAdminPermission("system:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const checkedAt = new Date().toISOString();
    const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

    // ── DB probe ──────────────────────────────────────────────────────────────
    const dbProbeStart = Date.now();
    let dbStatus: "healthy" | "unavailable" = "healthy";
    let dbLatencyMs = 0;
    try {
      await db.execute(sql`SELECT 1`);
      dbLatencyMs = Date.now() - dbProbeStart;
    } catch {
      dbLatencyMs = Date.now() - dbProbeStart;
      dbStatus = "unavailable";
    }

    // ── API status from retained telemetry (last 24h) ─────────────────────────
    const oneDayAgo = new Date(Date.now() - 86_400_000);
    let requests24h = 0;
    let errors24h = 0;
    let recentErrorPaths: Array<{ path: string; statusCode: number | null; recordedAt: string }> = [];
    let apiStatus: "healthy" | "degraded" | "unobserved" = "unobserved";

    try {
      const apiStatsRow = await db.execute<{ requests: string; errors: string }>(sql`
        SELECT
          COUNT(*)::int AS requests,
          COUNT(*) FILTER (WHERE action = 'api.error')::int AS errors
        FROM telemetry_events
        WHERE action IN ('api.request', 'api.error')
          AND recorded_at >= ${oneDayAgo}
      `);
      requests24h = Number(apiStatsRow.rows[0]?.requests ?? 0);
      errors24h = Number(apiStatsRow.rows[0]?.errors ?? 0);

      if (requests24h > 0) {
        const errorRate = errors24h / requests24h;
        apiStatus = errorRate >= 0.05 ? "degraded" : "healthy";
      }

      const errorRows = await db
        .select({
          statusCode: telemetryEventsTable.statusCode,
          metadata: telemetryEventsTable.metadata,
          recordedAt: telemetryEventsTable.recordedAt,
        })
        .from(telemetryEventsTable)
        .where(
          and(
            eq(telemetryEventsTable.action, "api.error"),
            gte(telemetryEventsTable.statusCode, 500),
            gte(telemetryEventsTable.recordedAt, oneDayAgo),
          ),
        )
        .orderBy(desc(telemetryEventsTable.recordedAt))
        .limit(10);

      recentErrorPaths = errorRows.map((e) => {
        const meta = e.metadata as Record<string, unknown> | null;
        return {
          path: typeof meta?.path === "string" ? meta.path : "unknown",
          statusCode: e.statusCode,
          recordedAt: e.recordedAt.toISOString(),
        };
      });
    } catch {
      // DB already failed — apiStatus stays unobserved
    }

    // ── Job queue health ──────────────────────────────────────────────────────
    let queued = 0, running = 0, failed = 0, cancelled = 0;
    let queueStatus: "healthy" | "degraded" = "healthy";
    let recoveryActions: Array<{ label: string }> = [];

    try {
      const jobStats = await db.execute<{
        queued: number; running: number; failed: number; cancelled: number;
        stale_running: number; oldest_queued_at: Date | null;
      }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
          COUNT(*) FILTER (WHERE status = 'running')::int AS running,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          COUNT(*) FILTER (
            WHERE status = 'running' AND updated_at < NOW() - INTERVAL '30 minutes'
          )::int AS stale_running,
          MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
        FROM pricing_refresh_jobs
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      const jr = jobStats.rows[0];
      queued = Number(jr?.queued ?? 0);
      running = Number(jr?.running ?? 0);
      failed = Number(jr?.failed ?? 0);
      cancelled = Number(jr?.cancelled ?? 0);
      const staleRunning = Number(jr?.stale_running ?? 0);
      const oldestQueuedAt = jr?.oldest_queued_at ? new Date(jr.oldest_queued_at) : null;
      const queueStale =
        Boolean(oldestQueuedAt) &&
        Date.now() - (oldestQueuedAt?.getTime() ?? Date.now()) > 30 * 60_000;
      if (failed > 0 || staleRunning > 0 || queueStale) {
        queueStatus = "degraded";
        if (failed > 0) {
          recoveryActions.push({ label: "Review failed pricing refresh jobs and retry them when safe." });
        }
        if (staleRunning > 0) {
          recoveryActions.push({ label: "Review pricing jobs that have been running for more than 30 minutes." });
        }
        if (queueStale) {
          recoveryActions.push({ label: "Review queued pricing jobs waiting longer than 30 minutes." });
        }
      }
    } catch {
      queueStatus = "degraded";
      recoveryActions = [{ label: "Could not read job queue — check database connection." }];
    }

    const overallStatus =
      dbStatus === "unavailable" ? "unavailable" :
      apiStatus !== "healthy" || queueStatus === "degraded" ? "degraded" : "healthy";

    res.json({
      status: overallStatus,
      checkedAt,
      process: {
        startedAt: processStartedAt,
        uptimeSeconds: Math.floor(process.uptime()),
        label: "current process only",
      },
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
      },
      api: {
        status: apiStatus,
        requests24h,
        errors24h,
        errorRate: requests24h > 0 ? +(errors24h / requests24h).toFixed(4) : 0,
        recentErrors: recentErrorPaths,
      },
      providers: [],
      jobs: {
        queued,
        running,
        failed,
        cancelled,
        recovery: recoveryActions,
      },
      queue: {
        status: queueStatus,
        depth: queued,
      },
      recoveryActions,
    });
  },
);

// ── GET /api/admin/intelligence/integrations ──────────────────────────────────
// Integration status using env-var presence only. No inconsistent double checks.
// Shape: {key,label,purpose,configured,status,lastSuccessAt,lastFailureAt,recentErrors,usage,observabilityNote}

router.get(
  "/admin/intelligence/integrations",
  requireAdminPermission("system:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const INTEGRATIONS: Array<{
      key: string;
      label: string;
      purpose: string;
      configured: boolean;
    }> = [
      {
        key: "pricecharting",
        label: "PriceCharting",
        purpose: "Verified market price quotes",
        configured: isPCConfigured(),
      },
      {
        key: "justtcg",
        label: "JustTCG",
        purpose: "Card catalogue",
        configured: Boolean(process.env.JUSTTCG_API_KEY),
      },
      {
        key: "ebay",
        label: "eBay",
        purpose: "Sold listing price snapshots",
        configured: Boolean(process.env.EBAY_APP_ID),
      },
      {
        key: "psa",
        label: "PSA",
        purpose: "Certification lookup",
        configured: Boolean(process.env.PSA_API_TOKEN),
      },
      {
        key: "resend",
        label: "Resend",
        purpose: "Transactional email delivery",
        configured: Boolean(process.env.RESEND_API_KEY),
      },
    ];

    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

    type IntegrationState = {
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      recentErrors: string[];
      events7d: number;
    };
    const byKey: Record<string, IntegrationState> = {};

    const [aggregateResult, recentFailures] = await Promise.all([
      db.execute<{
        integration_key: string;
        last_success_at: Date | null;
        last_failure_at: Date | null;
        events_7d: number;
      }>(sql`
        SELECT
          SPLIT_PART(action, '.', 2) AS integration_key,
          MAX(recorded_at) FILTER (WHERE status = 'ok') AS last_success_at,
          MAX(recorded_at) FILTER (WHERE status = 'failed') AS last_failure_at,
          COUNT(*) FILTER (WHERE recorded_at >= ${sevenDaysAgo})::int AS events_7d
        FROM telemetry_events
        WHERE category = 'integration'
          AND action LIKE 'integration.%.%'
        GROUP BY SPLIT_PART(action, '.', 2)
      `),
      db
        .select({
          action: telemetryEventsTable.action,
          statusCode: telemetryEventsTable.statusCode,
        })
        .from(telemetryEventsTable)
        .where(
          and(
            eq(telemetryEventsTable.category, "integration"),
            eq(telemetryEventsTable.status, "failed"),
            gte(telemetryEventsTable.recordedAt, sevenDaysAgo),
          ),
        )
        .orderBy(desc(telemetryEventsTable.recordedAt))
        .limit(100),
    ]);

    for (const row of aggregateResult.rows) {
      if (!row.integration_key) continue;
      byKey[row.integration_key] = {
        lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
        lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at).toISOString() : null,
        recentErrors: [],
        events7d: Number(row.events_7d),
      };
    }

    for (const failure of recentFailures) {
      const key = /^integration\.([^.]+)\./.exec(failure.action)?.[1];
      const entry = key ? byKey[key] : null;
      if (!entry || entry.recentErrors.length >= 5) continue;
      entry.recentErrors.push(
        failure.statusCode ? `Provider returned HTTP ${failure.statusCode}` : "Provider request failed",
      );
    }

    res.json({
      integrations: INTEGRATIONS.map((i) => {
        const observed = byKey[i.key];
        const status: "missing" | "unobserved" | "healthy" | "degraded" = !i.configured
          ? "missing"
          : !observed
          ? "unobserved"
          : observed.lastFailureAt && !observed.lastSuccessAt
          ? "degraded"
          : observed.lastFailureAt &&
            observed.lastSuccessAt &&
            new Date(observed.lastFailureAt) > new Date(observed.lastSuccessAt)
          ? "degraded"
          : "healthy";

        return {
          key: i.key,
          label: i.label,
          purpose: i.purpose,
          configured: i.configured,
          status,
          lastSuccessAt: observed?.lastSuccessAt ?? null,
          lastFailureAt: observed?.lastFailureAt ?? null,
          recentErrors: observed?.recentErrors ?? [],
          usage: observed ? { events7d: observed.events7d } : null,
          observabilityNote: !i.configured
            ? "Not configured: required environment variable is absent."
            : !observed
            ? "Configured but unobserved: no telemetry events recorded in the last 7 days."
            : "Usage data from retained integration telemetry.",
        };
      }),
    });
  },
);

// ── GET /api/admin/intelligence/jobs ─────────────────────────────────────────

router.get(
  "/admin/intelligence/jobs",
  requireAdminPermission("pricing:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const page = pageValue(req.query["page"], 1, 1_000_000);
    const limit = pageValue(req.query["limit"], 25, 100);
    const offset = (page - 1) * limit;

    const statusFilter =
      typeof req.query["status"] === "string" ? req.query["status"].trim() : "";
    const cardIdFilter =
      typeof req.query["cardId"] === "string" ? req.query["cardId"].trim() : "";

    const conditions = [];
    if (["queued", "running", "succeeded", "failed", "cancelled"].includes(statusFilter)) {
      conditions.push(eq(pricingRefreshJobsTable.status, statusFilter));
    }
    if (cardIdFilter) {
      conditions.push(ilike(pricingRefreshJobsTable.cardId, `%${cardIdFilter}%`));
    }
    const jobIdFilter =
      typeof req.query["jobId"] === "string" ? req.query["jobId"].trim() : "";
    if (jobIdFilter) {
      if (!isValidUuid(jobIdFilter)) {
        res.status(400).json({ message: "jobId must be a valid UUID." });
        return;
      }
      conditions.push(eq(pricingRefreshJobsTable.id, jobIdFilter));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [[totalRow], rows] = await Promise.all([
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(pricingRefreshJobsTable)
        .where(where),
      db
        .select()
        .from(pricingRefreshJobsTable)
        .where(where)
        .orderBy(desc(pricingRefreshJobsTable.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    res.json({
      jobs: rows,
      total: Number(totalRow?.total ?? 0),
      page,
      limit,
    });
  },
);

// ── POST /api/admin/intelligence/jobs/:id/retry ───────────────────────────────
// Validates UUID param. WHERE includes status for atomic state check.

router.post(
  "/admin/intelligence/jobs/:id/retry",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const jobId = String(req.params["id"] ?? "");
    if (!isValidUuid(jobId)) {
      res.status(400).json({ message: "Job ID must be a valid UUID." });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    if (!reason) {
      res.status(400).json({ message: "A reason of 10–500 characters is required." });
      return;
    }
    if (!confirmedAction(body, "RETRY JOB")) {
      res.status(400).json({ message: 'Confirm this action with confirmed:true and confirmation:"RETRY JOB".' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(pricingRefreshJobsTable)
        .where(eq(pricingRefreshJobsTable.id, jobId))
        .for("update")
        .limit(1);

      if (!existing) return { status: 404 as const, message: "Job not found." };
      if (!["failed", "cancelled"].includes(existing.status)) {
        return {
          status: 409 as const,
          message: `Only failed or cancelled jobs can be retried. Current status: ${existing.status}.`,
        };
      }

      // WHERE includes status for atomic safety
      const [updated] = await tx
        .update(pricingRefreshJobsTable)
        .set({
          status: "queued",
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          attemptCount: 0,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pricingRefreshJobsTable.id, jobId),
            inArray(pricingRefreshJobsTable.status, ["failed", "cancelled"]),
          ),
        )
        .returning();

      if (!updated) return { status: 409 as const, message: "Concurrent modification detected — job state changed. Please reload." };

      await recordAdminAudit(
        req,
        {
          action: "intelligence.job.retry",
          resourceType: "pricing_refresh_job",
          resourceId: jobId,
          reason,
          beforeState: { status: existing.status },
          afterState: { status: "queued" },
        },
        tx,
      );

      return { status: 200 as const, job: updated };
    });

    if (result.status !== 200) {
      res.status(result.status).json({ message: result.message });
      return;
    }

    void runRefreshJob(result.job.id);
    res.json({ job: result.job, message: "Job has been re-queued and will run shortly." });
  },
);

// ── POST /api/admin/intelligence/jobs/:id/cancel ──────────────────────────────
// Validates UUID param. WHERE includes status='queued' for atomic safety.

router.post(
  "/admin/intelligence/jobs/:id/cancel",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const jobId = String(req.params["id"] ?? "");
    if (!isValidUuid(jobId)) {
      res.status(400).json({ message: "Job ID must be a valid UUID." });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    if (!reason) {
      res.status(400).json({ message: "A reason of 10–500 characters is required." });
      return;
    }
    if (!confirmedAction(body, "CANCEL JOB")) {
      res.status(400).json({ message: 'Confirm this action with confirmed:true and confirmation:"CANCEL JOB".' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(pricingRefreshJobsTable)
        .where(eq(pricingRefreshJobsTable.id, jobId))
        .for("update")
        .limit(1);

      if (!existing) return { status: 404 as const, message: "Job not found." };
      if (existing.status !== "queued") {
        return {
          status: 409 as const,
          message: `Only queued jobs can be cancelled. Current status: ${existing.status}.`,
        };
      }

      // WHERE includes status='queued' for atomic safety
      const [updated] = await tx
        .update(pricingRefreshJobsTable)
        .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pricingRefreshJobsTable.id, jobId),
            eq(pricingRefreshJobsTable.status, "queued"),
          ),
        )
        .returning();

      if (!updated) return { status: 409 as const, message: "Concurrent modification detected — job state changed. Please reload." };

      await recordAdminAudit(
        req,
        {
          action: "intelligence.job.cancel",
          resourceType: "pricing_refresh_job",
          resourceId: jobId,
          reason,
          beforeState: { status: "queued" },
          afterState: { status: "cancelled" },
        },
        tx,
      );

      return { status: 200 as const, job: updated };
    });

    if (result.status !== 200) {
      res.status(result.status).json({ message: result.message });
      return;
    }

    res.json({ job: result.job, message: "Job has been cancelled." });
  },
);

// ── GET /api/admin/intelligence/audit ────────────────────────────────────────
// Database-enforced append-only merged view: operational logs, trust/governance
// audit events, and telemetry category=security.
// Supports: q, source, category, action, actor, targetType, start, end, page, limit.
// Deep links: admin UI paths for known resource types only; unknown → null.
// Security rows show actor admin ID/system only — never failed-login email/IP.

function buildDeepLink(resourceType: string | null | undefined, resourceId: string | null | undefined): string | null {
  if (!resourceType || !resourceId) return null;
  if (resourceType === "platform_config") {
    return `/settings?key=${encodeURIComponent(resourceId)}`;
  }
  if (resourceType === "pricing_refresh_job") {
    return `/system?job=${encodeURIComponent(resourceId)}`;
  }
  if (resourceType === "admin_account") return "/team";
  if (resourceType === "user") {
    return `/users?id=${encodeURIComponent(resourceId)}`;
  }
  return null;
}

router.get(
  "/admin/intelligence/audit",
  requireAdminPermission("audit:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const page = pageValue(req.query["page"], 1, 1_000_000);
    const limit = pageValue(req.query["limit"], 25, 100);
    const offset = (page - 1) * limit;

    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const sourceFilter = typeof req.query["source"] === "string" ? req.query["source"].trim() : "";
    const categoryFilter = typeof req.query["category"] === "string" ? req.query["category"].trim() : "";
    const actionFilter = typeof req.query["action"] === "string" ? req.query["action"].trim() : "";
    const actorFilter = typeof req.query["actor"] === "string" ? req.query["actor"].trim() : "";
    const targetTypeFilter = typeof req.query["targetType"] === "string" ? req.query["targetType"].trim() : "";
    const startFilter = typeof req.query["start"] === "string" ? new Date(req.query["start"]) : null;
    const endFilter = typeof req.query["end"] === "string" ? new Date(req.query["end"]) : null;
    if (
      endFilter &&
      typeof req.query["end"] === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query["end"])
    ) {
      endFilter.setUTCHours(23, 59, 59, 999);
    }

    const validStart = startFilter && !Number.isNaN(startFilter.getTime()) ? startFilter : null;
    const validEnd = endFilter && !Number.isNaN(endFilter.getTime()) ? endFilter : null;

    const includeAdmin = !sourceFilter || sourceFilter === "admin_audit_logs";
    const includeTrustAudit = !sourceFilter || sourceFilter === "admin_audit_events";
    const includeSecurity =
      (!sourceFilter || sourceFilter === "security") &&
      (!categoryFilter || categoryFilter === "security") &&
      (!targetTypeFilter || targetTypeFilter === "admin_account");
    const fetchLimit = offset + limit;
    let adminTotal = 0;
    let trustAuditTotal = 0;
    let securityTotal = 0;

    type AuditEvent = {
      id: string;
      source: "admin_audit_logs" | "admin_audit_events" | "security";
      category: string;
      severity: "info" | "warning" | "critical";
      actorLabel: string;
      action: string;
      targetType: string | null;
      targetId: string | null;
      reason: string | null;
      requestId: string | null;
      createdAt: Date;
      deepLink: string | null;
      immutable: true;
    };

    const events: AuditEvent[] = [];

    // ── admin_audit_logs ──────────────────────────────────────────────────────
    if (includeAdmin) {
      const conditions = [];
      if (actionFilter) conditions.push(ilike(adminAuditLogsTable.action, `%${actionFilter}%`));
      if (actorFilter) conditions.push(ilike(adminAuditLogsTable.actorEmail, `%${actorFilter}%`));
      if (targetTypeFilter) conditions.push(ilike(adminAuditLogsTable.resourceType, `%${targetTypeFilter}%`));
      if (validStart) conditions.push(gte(adminAuditLogsTable.createdAt, validStart));
      if (validEnd) conditions.push(lte(adminAuditLogsTable.createdAt, validEnd));
      if (q) {
        conditions.push(
          or(
            ilike(adminAuditLogsTable.action, `%${q}%`),
            ilike(adminAuditLogsTable.actorEmail, `%${q}%`),
            ilike(adminAuditLogsTable.resourceType, `%${q}%`),
          )!,
        );
      }
      // category filter maps to action prefix for audit logs
      if (categoryFilter) conditions.push(ilike(adminAuditLogsTable.action, `${categoryFilter}.%`));

      const adminWhere = conditions.length > 0 ? and(...conditions) : undefined;
      const [[adminCountRow], auditRows] = await Promise.all([
        db
          .select({ total: sql<number>`COUNT(*)::int` })
          .from(adminAuditLogsTable)
          .where(adminWhere),
        db
          .select({
            id: adminAuditLogsTable.id,
            adminId: adminAuditLogsTable.adminId,
            actorEmail: adminAuditLogsTable.actorEmail,
            action: adminAuditLogsTable.action,
            resourceType: adminAuditLogsTable.resourceType,
            resourceId: adminAuditLogsTable.resourceId,
            reason: adminAuditLogsTable.reason,
            createdAt: adminAuditLogsTable.createdAt,
          })
          .from(adminAuditLogsTable)
          .where(adminWhere)
          .orderBy(desc(adminAuditLogsTable.createdAt))
          .limit(fetchLimit),
      ]);
      adminTotal = Number(adminCountRow?.total ?? 0);

      for (const r of auditRows) {
        const actionPrefix = r.action.split(".")[0] ?? "unknown";
        events.push({
          id: r.id,
          source: "admin_audit_logs",
          category: actionPrefix,
          severity: r.action.includes("delete") || r.action.includes("suspend") ? "critical" : "info",
          actorLabel: r.actorEmail ?? r.adminId ?? "unknown",
          action: r.action,
          targetType: r.resourceType ?? null,
          targetId: r.resourceId ?? null,
          reason: r.reason ?? null,
          requestId: null,
          createdAt: r.createdAt,
          deepLink: buildDeepLink(r.resourceType, r.resourceId),
          immutable: true,
        });
      }
    }

    // ── comprehensive trust/governance audit events ───────────────────────────
    if (includeTrustAudit) {
      const conditions = [];
      if (actionFilter) conditions.push(ilike(adminAuditEventsTable.action, `%${actionFilter}%`));
      if (categoryFilter) conditions.push(eq(adminAuditEventsTable.category, categoryFilter));
      if (targetTypeFilter) conditions.push(ilike(adminAuditEventsTable.targetType, `%${targetTypeFilter}%`));
      if (actorFilter) {
        conditions.push(
          or(
            ilike(adminAccountsTable.email, `%${actorFilter}%`),
            ilike(adminAccountsTable.displayName, `%${actorFilter}%`),
            ...(isValidUuid(actorFilter) ? [eq(adminAuditEventsTable.adminId, actorFilter)] : []),
          )!,
        );
      }
      if (validStart) conditions.push(gte(adminAuditEventsTable.createdAt, validStart));
      if (validEnd) conditions.push(lte(adminAuditEventsTable.createdAt, validEnd));
      if (q) {
        conditions.push(
          or(
            ilike(adminAuditEventsTable.action, `%${q}%`),
            ilike(adminAuditEventsTable.category, `%${q}%`),
            ilike(adminAuditEventsTable.targetType, `%${q}%`),
            ilike(adminAuditEventsTable.targetId, `%${q}%`),
            ilike(adminAuditEventsTable.reason, `%${q}%`),
            ilike(adminAuditEventsTable.requestId, `%${q}%`),
            ilike(adminAccountsTable.email, `%${q}%`),
            ilike(adminAccountsTable.displayName, `%${q}%`),
          )!,
        );
      }

      const trustWhere = conditions.length > 0 ? and(...conditions) : undefined;
      const [[trustCountRow], trustRows] = await Promise.all([
        db
          .select({ total: sql<number>`COUNT(*)::int` })
          .from(adminAuditEventsTable)
          .leftJoin(adminAccountsTable, eq(adminAccountsTable.id, adminAuditEventsTable.adminId))
          .where(trustWhere),
        db
          .select({
            id: adminAuditEventsTable.id,
            adminId: adminAuditEventsTable.adminId,
            actorEmail: adminAccountsTable.email,
            actorName: adminAccountsTable.displayName,
            action: adminAuditEventsTable.action,
            category: adminAuditEventsTable.category,
            severity: adminAuditEventsTable.severity,
            targetType: adminAuditEventsTable.targetType,
            targetId: adminAuditEventsTable.targetId,
            reason: adminAuditEventsTable.reason,
            requestId: adminAuditEventsTable.requestId,
            createdAt: adminAuditEventsTable.createdAt,
          })
          .from(adminAuditEventsTable)
          .leftJoin(adminAccountsTable, eq(adminAccountsTable.id, adminAuditEventsTable.adminId))
          .where(trustWhere)
          .orderBy(desc(adminAuditEventsTable.createdAt))
          .limit(fetchLimit),
      ]);
      trustAuditTotal = Number(trustCountRow?.total ?? 0);

      for (const r of trustRows) {
        events.push({
          id: r.id,
          source: "admin_audit_events",
          category: r.category,
          severity:
            r.severity === "critical" || r.severity === "high"
              ? "critical"
              : r.severity === "warning" || r.severity === "medium"
                ? "warning"
                : "info",
          actorLabel: r.actorName || r.actorEmail || r.adminId,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          requestId: r.requestId,
          createdAt: r.createdAt,
          deepLink: buildDeepLink(r.targetType, r.targetId),
          immutable: true,
        });
      }
    }

    // ── security telemetry events ─────────────────────────────────────────────
    // Show actor as admin ID or "system" — never failed-login email/IP
    if (includeSecurity) {
      const secConditions = [eq(telemetryEventsTable.category, "security")];
      if (actionFilter) secConditions.push(ilike(telemetryEventsTable.action, `%${actionFilter}%`));
      if (actorFilter) {
        if (actorFilter.toLowerCase() === "system") {
          secConditions.push(sql`${telemetryEventsTable.adminId} IS NULL`);
        } else if (isValidUuid(actorFilter)) {
          secConditions.push(eq(telemetryEventsTable.adminId, actorFilter));
        } else {
          secConditions.push(sql`FALSE`);
        }
      }
      if (validStart) secConditions.push(gte(telemetryEventsTable.recordedAt, validStart));
      if (validEnd) secConditions.push(lte(telemetryEventsTable.recordedAt, validEnd));
      if (q) {
        secConditions.push(
          or(
            ilike(telemetryEventsTable.action, `%${q}%`),
            ilike(telemetryEventsTable.correlationId, `%${q}%`),
          )!,
        );
      }

      const securityWhere = and(...secConditions);
      const [[securityCountRow], secRows] = await Promise.all([
        db
          .select({ total: sql<number>`COUNT(*)::int` })
          .from(telemetryEventsTable)
          .where(securityWhere),
        db
          .select({
            id: telemetryEventsTable.id,
            adminId: telemetryEventsTable.adminId,
            action: telemetryEventsTable.action,
            status: telemetryEventsTable.status,
            correlationId: telemetryEventsTable.correlationId,
            metadata: telemetryEventsTable.metadata,
            recordedAt: telemetryEventsTable.recordedAt,
          })
          .from(telemetryEventsTable)
          .where(securityWhere)
          .orderBy(desc(telemetryEventsTable.recordedAt))
          .limit(fetchLimit),
      ]);
      securityTotal = Number(securityCountRow?.total ?? 0);

      for (const r of secRows) {
        events.push({
          id: r.id,
          source: "security",
          category: "security",
          severity:
            r.action.includes("lockout") ||
            r.action.includes("locked") ||
            r.action.includes("failure")
              ? "warning"
              : "info",
          // Actor is admin ID or "system" — never email/IP
          actorLabel: r.adminId ?? "system",
          action: r.action,
          targetType: r.adminId ? "admin_account" : null,
          targetId: r.adminId ?? null,
          reason: null,
          requestId: r.correlationId ?? null,
          createdAt: r.recordedAt,
          deepLink: buildDeepLink("admin_account", r.adminId),
          immutable: true,
        });
      }
    }

    // Sort merged events descending by createdAt, paginate
    events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = adminTotal + trustAuditTotal + securityTotal;
    const page_events = events.slice(offset, offset + limit);

    const availableSources = ["admin_audit_events", "admin_audit_logs", "security"];
    const availableCategories = ["config", "intelligence", "security", "governance", "trust"];

    res.json({
      events: page_events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      filters: {
        sources: availableSources,
        categories: availableCategories,
      },
    });
  },
);

export default router;
