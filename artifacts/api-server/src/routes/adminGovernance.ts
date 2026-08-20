/**
 * Admin Governance router — Task 288
 *
 * Mounted at /api (prefix added by main router).
 * All routes require requireAdminSession + requireAdminCsrf (applied in router.use below).
 *
 * API paths:
 *   GET  /admin/governance/overview
 *   GET/POST                        /admin/governance/templates
 *   GET/PATCH                       /admin/governance/templates/:id
 *   GET/POST                        /admin/governance/campaigns
 *   GET/PATCH                       /admin/governance/campaigns/:id
 *   POST                            /admin/governance/campaigns/:id/preview
 *   POST                            /admin/governance/campaigns/:id/test
 *   POST                            /admin/governance/campaigns/:id/confirm
 *   POST                            /admin/governance/campaigns/:id/schedule
 *   GET/PATCH                       /admin/governance/support
 *   GET                             /admin/governance/support/:id
 *   POST                            /admin/governance/support/:id/notes
 *   GET/POST                        /admin/governance/privacy
 *   GET/PATCH                       /admin/governance/privacy/:id
 *   POST                            /admin/governance/privacy/:id/export
 *   DELETE                          /admin/governance/privacy/:id/delete-account
 *   POST                            /admin/governance/privacy/:id/notes
 *   GET/POST                        /admin/governance/retention
 *   GET/PATCH                       /admin/governance/retention/:id
 *   POST                            /admin/governance/retention/:id/run
 *   GET/POST                        /admin/governance/notes
 *   GET/PATCH                       /admin/governance/notes/:id
 *   GET                             /admin/governance/notes/:id/history
 *   GET/POST                        /admin/governance/announcements
 *   GET/PATCH                       /admin/governance/announcements/:id
 *   GET                             /admin/governance/activity
 *   GET                             /admin/governance/attention
 */

import { Router, type Response } from "express";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  // governance tables
  adminAuditLogTable,
  notificationTemplatesTable,
  notificationCampaignsTable,
  notificationPreferencesTable,
  notificationDeliveryAttemptsTable,
  supportCasesTable,
  supportCaseNotesTable,
  privacyRequestsTable,
  privacyRequestNotesTable,
  retentionPoliciesTable,
  retentionRunsTable,
  internalNotesTable,
  internalNoteHistoryTable,
  announcementsTable,
  // existing tables
  contactSubmissionsTable,
  usersTable,
  pushTokensTable,
  collectionItemsTable,
  wishlistItemsTable,
  notificationsTable,
} from "@workspace/db";
import {
  type AdminRequest,
  requireAdminCsrf,
  requireAdminPermission,
  requireAdminSession,
  requireOwner,
  requireRecentAdminAuth,
} from "../lib/adminSession";

const router = Router();

// Apply session + CSRF guard to all governance routes
router.use("/admin/governance", requireAdminSession, requireAdminCsrf);

// ── Helpers ───────────────────────────────────────────────────────────────────

const SAFE_AUDIT_DETAIL_KEYS = new Set([
  "audience",
  "audienceCount",
  "deliveryBlocked",
  "identityVerified",
  "isDryRun",
  "noteType",
  "outcome",
  "providerStatus",
  "reason",
  "requestType",
  "retentionDays",
  "scheduledAt",
  "status",
  "visibility",
]);

/**
 * Keep audit context useful without persisting free-form content, collector
 * identifiers, email addresses, or raw request patches.
 */
function sanitizeAuditDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (key === "manifest" && value && typeof value === "object" && !Array.isArray(value)) {
      safe.manifest = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([, countValue]) => typeof countValue === "number" && Number.isFinite(countValue),
        ),
      );
      continue;
    }
    if (!SAFE_AUDIT_DETAIL_KEYS.has(key)) continue;
    if (
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.length <= 160)
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

/** Write an audit log entry. Non-throwing — errors are logged but not surfaced. */
async function writeAudit(
  req: AdminRequest,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  details: unknown,
  outcome: "success" | "failure" = "success",
): Promise<void> {
  try {
    await db.insert(adminAuditLogTable).values({
      adminId: req.admin?.id ?? null,
      adminEmail: req.admin?.email ?? null,
      action,
      resourceType: resourceType ?? null,
      resourceId: resourceId ?? null,
      details: sanitizeAuditDetails(details),
      outcome,
    });
  } catch {
    req.log.warn({ action }, "Failed to write governance audit log entry");
  }
}

/**
 * Write an audit log entry within a transaction. Throws on error — use inside
 * a transaction so failures roll back the whole operation.
 */
async function writeAuditTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  adminId: string | null,
  adminEmail: string | null,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  details: Record<string, unknown>,
  outcome: "success" | "failure" = "success",
): Promise<void> {
  await tx.insert(adminAuditLogTable).values({
    adminId,
    adminEmail: adminEmail ?? null,
    action,
    resourceType: resourceType ?? null,
    resourceId: resourceId ?? null,
    details: sanitizeAuditDetails(details),
    outcome,
  });
}

function parseId(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Simple UUID format guard */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const CAMPAIGN_PROVIDER_STATUS = "not_connected" as const;
const STALE_SUPPORT_DAYS = 7;
const STALE_PRIVACY_DAYS = 14;

// ── In-memory per-admin rate limiting ─────────────────────────────────────────
// Truthful, process-local sliding-window limiters. These reset on restart and
// are per-instance only; they are a guardrail against rapid repeated actions,
// not a distributed quota. Test attempts: 5 per minute. Confirmations: 10/hour.

const CAMPAIGN_TEST_LIMIT = 5;
const CAMPAIGN_TEST_WINDOW_MS = 60 * 1000;
const CAMPAIGN_CONFIRM_LIMIT = 10;
const CAMPAIGN_CONFIRM_WINDOW_MS = 60 * 60 * 1000;
const CAMPAIGN_RATE_LIMITS = {
  test: {
    limit: CAMPAIGN_TEST_LIMIT,
    windowSeconds: CAMPAIGN_TEST_WINDOW_MS / 1000,
  },
  confirm: {
    limit: CAMPAIGN_CONFIRM_LIMIT,
    windowSeconds: CAMPAIGN_CONFIRM_WINDOW_MS / 1000,
  },
} as const;

const campaignTestHits = new Map<string, number[]>();
const campaignConfirmHits = new Map<string, number[]>();

/**
 * Sliding-window rate check. Records the attempt when allowed. Returns the
 * decision plus retryAfterSeconds when blocked so callers can send a truthful
 * 429 with a real Retry-After.
 */
function checkRateLimit(
  store: Map<string, number[]>,
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (store.get(key) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= limit) {
    const oldest = recent[0]!;
    const retryAfterMs = oldest + windowMs - now;
    store.set(key, recent);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      remaining: 0,
    };
  }
  recent.push(now);
  store.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - recent.length };
}

function validateAudienceFilter(
  value: unknown,
): { filter: Record<string, unknown> } | { error: string } {
  if (value == null) return { filter: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "audienceFilter must be an object." };
  }

  const filter = value as Record<string, unknown>;
  const unsupportedKeys = Object.keys(filter).filter((key) => key !== "tier");
  if (unsupportedKeys.length > 0) {
    return { error: `Unsupported audience filter: ${unsupportedKeys.join(", ")}.` };
  }
  if (filter.tier != null && filter.tier !== "free" && filter.tier !== "pro") {
    return { error: 'audienceFilter.tier must be "free" or "pro".' };
  }
  return {
    filter: filter.tier ? { tier: filter.tier } : {},
  };
}

async function deliveryMetrics(): Promise<{
  totalAttempts: number;
  delivered: number;
  blocked: number;
  failed: number;
}> {
  const rows = await db
    .select({
      status: notificationDeliveryAttemptsTable.status,
      cnt: count(),
    })
    .from(notificationDeliveryAttemptsTable)
    .groupBy(notificationDeliveryAttemptsTable.status);

  const summary = { totalAttempts: 0, delivered: 0, blocked: 0, failed: 0 };
  for (const row of rows) {
    const amount = Number(row.cnt ?? 0);
    summary.totalAttempts += amount;
    if (row.status === "delivered" || row.status === "sent") {
      summary.delivered += amount;
    } else if (row.status === "not_connected" || row.status === "blocked") {
      summary.blocked += amount;
    } else {
      summary.failed += amount;
    }
  }
  return summary;
}

// ── GET /admin/governance/overview ────────────────────────────────────────────

router.get(
  "/admin/governance/overview",
  requireAdminPermission("dashboard:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const [
        [openSupportCount],
        [pendingPrivacyCount],
        [activeCampaignCount],
        [activeTemplateCount],
        [activePolicyCount],
        [activeNoteCount],
        [publishedAnnouncementCount],
        [totalUsersWithTokens],
      ] = await Promise.all([
        db
          .select({ cnt: count() })
          .from(supportCasesTable)
          .where(ne(supportCasesTable.status, "closed")),
        db
          .select({ cnt: count() })
          .from(privacyRequestsTable)
          .where(
            or(
              eq(privacyRequestsTable.status, "pending"),
              eq(privacyRequestsTable.status, "under_review"),
              eq(privacyRequestsTable.status, "verified"),
            ),
          ),
        db
          .select({ cnt: count() })
          .from(notificationCampaignsTable)
          .where(ne(notificationCampaignsTable.status, "cancelled")),
        db
          .select({ cnt: count() })
          .from(notificationTemplatesTable)
          .where(eq(notificationTemplatesTable.status, "active")),
        db
          .select({ cnt: count() })
          .from(retentionPoliciesTable)
          .where(eq(retentionPoliciesTable.status, "active")),
        db
          .select({ cnt: count() })
          .from(internalNotesTable)
          .where(eq(internalNotesTable.status, "active")),
        db
          .select({ cnt: count() })
          .from(announcementsTable)
          .where(eq(announcementsTable.status, "published")),
        db
          .select({ cnt: count() })
          .from(pushTokensTable),
      ]);

      const [insights, metrics] = await Promise.all([
        audienceInsights(),
        deliveryMetrics(),
      ]);

      res.json({
        openSupportCases: Number(openSupportCount?.cnt ?? 0),
        pendingPrivacyRequests: Number(pendingPrivacyCount?.cnt ?? 0),
        activeCampaigns: Number(activeCampaignCount?.cnt ?? 0),
        activeTemplates: Number(activeTemplateCount?.cnt ?? 0),
        activeRetentionPolicies: Number(activePolicyCount?.cnt ?? 0),
        activeInternalNotes: Number(activeNoteCount?.cnt ?? 0),
        publishedAnnouncements: Number(publishedAnnouncementCount?.cnt ?? 0),
        registeredPushTokens: Number(totalUsersWithTokens?.cnt ?? 0),
        audience: insights.segments,
        pushTokenHealth: insights.pushTokenHealth,
        deliveryMetrics: metrics,
        rateLimits: CAMPAIGN_RATE_LIMITS,
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
      });
    } catch (err) {
      req.log.error({ err }, "Governance overview query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/governance/templates
router.get(
  "/admin/governance/templates",
  requireAdminPermission("notifications:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const templates = await db
        .select()
        .from(notificationTemplatesTable)
        .orderBy(desc(notificationTemplatesTable.createdAt));
      res.json({ templates });
    } catch (err) {
      req.log.error({ err }, "Templates list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/templates
router.post(
  "/admin/governance/templates",
  requireAdminPermission("notifications:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { name, description, titleTemplate, bodyTemplate, defaultVariables } = req.body as {
      name?: unknown;
      description?: unknown;
      titleTemplate?: unknown;
      bodyTemplate?: unknown;
      defaultVariables?: unknown;
    };
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required." });
      return;
    }
    if (!titleTemplate || typeof titleTemplate !== "string" || !titleTemplate.trim()) {
      res.status(400).json({ message: "titleTemplate is required." });
      return;
    }
    if (!bodyTemplate || typeof bodyTemplate !== "string" || !bodyTemplate.trim()) {
      res.status(400).json({ message: "bodyTemplate is required." });
      return;
    }
    try {
      const [template] = await db
        .insert(notificationTemplatesTable)
        .values({
          name: name.trim(),
          description: typeof description === "string" ? description.trim() : "",
          titleTemplate: titleTemplate.trim(),
          bodyTemplate: bodyTemplate.trim(),
          defaultVariables:
            defaultVariables != null && typeof defaultVariables === "object" &&
            !Array.isArray(defaultVariables)
              ? (defaultVariables as Record<string, unknown>)
              : {},
          createdByAdminId: req.admin!.id,
        })
        .returning();
      await writeAudit(req, "template:create", "notification_template", template!.id, { name });
      res.status(201).json({ template });
    } catch (err) {
      req.log.error({ err }, "Template create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// PATCH /admin/governance/templates/:id
router.patch(
  "/admin/governance/templates/:id",
  requireAdminPermission("notifications:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid template id." });
      return;
    }
    const { name, description, titleTemplate, bodyTemplate, defaultVariables, status } =
      req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof name === "string" && name.trim()) patch.name = name.trim();
    if (typeof description === "string") patch.description = description.trim();
    if (typeof titleTemplate === "string" && titleTemplate.trim())
      patch.titleTemplate = titleTemplate.trim();
    if (typeof bodyTemplate === "string" && bodyTemplate.trim())
      patch.bodyTemplate = bodyTemplate.trim();
    if (defaultVariables != null && typeof defaultVariables === "object" && !Array.isArray(defaultVariables))
      patch.defaultVariables = defaultVariables;
    if (status === "active" || status === "archived") patch.status = status;

    try {
      const [template] = await db
        .update(notificationTemplatesTable)
        .set(patch)
        .where(eq(notificationTemplatesTable.id, id))
        .returning();
      if (!template) {
        res.status(404).json({ message: "Template not found." });
        return;
      }
      await writeAudit(req, "template:update", "notification_template", id, patch);
      res.json({ template });
    } catch (err) {
      req.log.error({ err }, "Template update failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION CAMPAIGNS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Count of distinct eligible recipients for a campaign audience filter.
 *
 * Eligibility is intentionally strict and truthful:
 *   - the user is NOT suspended (suspendedAt IS NULL)
 *   - the user has an explicit notification_preferences row with pushEnabled = true
 *   - the user has at least one active push token
 * Users are counted at most once even with multiple devices (countDistinct).
 * A registered push token alone is not treated as consent — explicit
 * pushEnabled = true is required.
 */
async function audienceCount(filter: Record<string, unknown>): Promise<number> {
  const conditions = [
    isNull(usersTable.suspendedAt),
    eq(notificationPreferencesTable.pushEnabled, true),
    eq(pushTokensTable.status, "active"),
  ];

  if (filter.tier === "free" || filter.tier === "pro") {
    conditions.push(eq(usersTable.subscriptionTier, filter.tier as string));
  }

  const [row] = await db
    .select({ cnt: countDistinct(usersTable.id) })
    .from(usersTable)
    .innerJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .innerJoin(pushTokensTable, eq(pushTokensTable.userId, usersTable.id))
    .where(and(...conditions));

  return Number(row?.cnt ?? 0);
}

/**
 * Real audience segment counts, push-token health, and delivery metrics.
 * Everything is derived from live data; nothing here implies actual delivery.
 */
async function audienceInsights(): Promise<{
  segments: {
    total: number;
    free: number;
    pro: number;
  };
  pushTokenHealth: {
    active: number;
    stale: number;
    invalid: number;
    revoked: number;
    other: number;
    total: number;
    usersWithActiveToken: number;
    usersOptedIn: number;
  };
}> {
  const [
    total,
    free,
    pro,
    tokenStatusRows,
    [activeTokenUsers],
    [optedIn],
  ] = await Promise.all([
    audienceCount({}),
    audienceCount({ tier: "free" }),
    audienceCount({ tier: "pro" }),
    db
      .select({ status: pushTokensTable.status, cnt: count() })
      .from(pushTokensTable)
      .groupBy(pushTokensTable.status),
    db
      .select({ cnt: countDistinct(pushTokensTable.userId) })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.status, "active")),
    db
      .select({ cnt: count() })
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.pushEnabled, true)),
  ]);

  const health = { active: 0, stale: 0, invalid: 0, revoked: 0, other: 0, total: 0 };
  for (const r of tokenStatusRows) {
    const n = Number(r.cnt ?? 0);
    health.total += n;
    if (r.status === "active") health.active += n;
    else if (r.status === "stale") health.stale += n;
    else if (r.status === "invalid") health.invalid += n;
    else if (r.status === "revoked") health.revoked += n;
    else health.other += n;
  }

  return {
    segments: { total, free, pro },
    pushTokenHealth: {
      ...health,
      usersWithActiveToken: Number(activeTokenUsers?.cnt ?? 0),
      usersOptedIn: Number(optedIn?.cnt ?? 0),
    },
  };
}

/**
 * Record a durable, truthful delivery attempt row inside a transaction.
 * Throws on error — callers must use a transaction so failures roll back.
 */
async function recordDeliveryAttemptTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  adminId: string | null,
  campaignId: string,
  attemptType: "test" | "confirm" | "schedule",
  recipientCount: number,
): Promise<void> {
  await tx.insert(notificationDeliveryAttemptsTable).values({
    campaignId,
    attemptedByAdminId: adminId,
    attemptType,
    channel: "push",
    provider: "none",
    status: CAMPAIGN_PROVIDER_STATUS,
    recipientCount,
    errorCode: "provider_not_connected",
    errorMessage: "No outbound push provider is configured. Nothing was delivered.",
  });
}

// GET /admin/governance/campaigns
router.get(
  "/admin/governance/campaigns",
  requireAdminPermission("notifications:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const [campaigns, insights, metrics] = await Promise.all([
        db
          .select()
          .from(notificationCampaignsTable)
          .orderBy(desc(notificationCampaignsTable.createdAt)),
        audienceInsights(),
        deliveryMetrics(),
      ]);
      res.json({
        campaigns,
        audience: insights.segments,
        pushTokenHealth: insights.pushTokenHealth,
        deliveryMetrics: metrics,
        rateLimits: CAMPAIGN_RATE_LIMITS,
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
      });
    } catch (err) {
      req.log.error({ err }, "Campaigns list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// GET /admin/governance/campaigns/:id/delivery-attempts — real delivery history
router.get(
  "/admin/governance/campaigns/:id/delivery-attempts",
  requireAdminPermission("notifications:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid campaign id." });
      return;
    }
    try {
      const [campaign] = await db
        .select({ id: notificationCampaignsTable.id })
        .from(notificationCampaignsTable)
        .where(eq(notificationCampaignsTable.id, id))
        .limit(1);
      if (!campaign) {
        res.status(404).json({ message: "Campaign not found." });
        return;
      }
      const attempts = await db
        .select()
        .from(notificationDeliveryAttemptsTable)
        .where(eq(notificationDeliveryAttemptsTable.campaignId, id))
        .orderBy(desc(notificationDeliveryAttemptsTable.createdAt));
      res.json({
        attempts,
        total: attempts.length,
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
      });
    } catch (err) {
      req.log.error({ err }, "Delivery attempts list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/campaigns
router.post(
  "/admin/governance/campaigns",
  requireAdminPermission("notifications:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { name, templateId, titleOverride, bodyOverride, variables, audienceFilter } =
      req.body as Record<string, unknown>;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required." });
      return;
    }
    const hasTemplate = templateId != null && typeof templateId === "string" && isUuid(templateId);
    const hasOverride =
      titleOverride != null &&
      typeof titleOverride === "string" &&
      titleOverride.trim() &&
      bodyOverride != null &&
      typeof bodyOverride === "string" &&
      bodyOverride.trim();
    if (!hasTemplate && !hasOverride) {
      res.status(400).json({ message: "Provide either templateId or both titleOverride and bodyOverride." });
      return;
    }
    const audienceValidation = validateAudienceFilter(audienceFilter);
    if ("error" in audienceValidation) {
      res.status(400).json({ message: audienceValidation.error });
      return;
    }
    try {
      const filter = audienceValidation.filter;
      const [campaign] = await db
        .insert(notificationCampaignsTable)
        .values({
          name: name.trim(),
          templateId: hasTemplate ? (templateId as string) : null,
          titleOverride: typeof titleOverride === "string" ? titleOverride.trim() || null : null,
          bodyOverride: typeof bodyOverride === "string" ? bodyOverride.trim() || null : null,
          variables:
            variables != null && typeof variables === "object" && !Array.isArray(variables)
              ? (variables as Record<string, unknown>)
              : {},
          audienceFilter: filter,
          status: "draft",
          providerStatus: CAMPAIGN_PROVIDER_STATUS,
          deliveryOutcome: "not_connected",
          createdByAdminId: req.admin!.id,
        })
        .returning();
      await writeAudit(req, "campaign:create", "notification_campaign", campaign!.id, { name });
      res.status(201).json({ campaign, providerStatus: CAMPAIGN_PROVIDER_STATUS });
    } catch (err) {
      req.log.error({ err }, "Campaign create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// PATCH /admin/governance/campaigns/:id
router.patch(
  "/admin/governance/campaigns/:id",
  requireAdminPermission("notifications:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid campaign id." });
      return;
    }
    const { name, titleOverride, bodyOverride, variables, audienceFilter, status } =
      req.body as Record<string, unknown>;
    const EDITABLE_STATUSES = ["draft"];
    const [existing] = await db
      .select()
      .from(notificationCampaignsTable)
      .where(eq(notificationCampaignsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ message: "Campaign not found." });
      return;
    }
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      res.status(400).json({ message: "Only draft campaigns can be edited." });
      return;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof name === "string" && name.trim()) patch.name = name.trim();
    if (typeof titleOverride === "string") patch.titleOverride = titleOverride.trim() || null;
    if (typeof bodyOverride === "string") patch.bodyOverride = bodyOverride.trim() || null;
    if (variables != null && typeof variables === "object" && !Array.isArray(variables))
      patch.variables = variables;
    if (audienceFilter != null) {
      const audienceValidation = validateAudienceFilter(audienceFilter);
      if ("error" in audienceValidation) {
        res.status(400).json({ message: audienceValidation.error });
        return;
      }
      patch.audienceFilter = audienceValidation.filter;
    }
    if (status === "cancelled") patch.status = "cancelled";

    try {
      const [campaign] = await db
        .update(notificationCampaignsTable)
        .set(patch)
        .where(eq(notificationCampaignsTable.id, id))
        .returning();
      await writeAudit(req, "campaign:update", "notification_campaign", id, patch);
      res.json({ campaign, providerStatus: CAMPAIGN_PROVIDER_STATUS });
    } catch (err) {
      req.log.error({ err }, "Campaign update failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/campaigns/:id/preview
router.post(
  "/admin/governance/campaigns/:id/preview",
  requireAdminPermission("notifications:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid campaign id." });
      return;
    }
    try {
      const [campaign] = await db
        .select()
        .from(notificationCampaignsTable)
        .where(eq(notificationCampaignsTable.id, id))
        .limit(1);
      if (!campaign) {
        res.status(404).json({ message: "Campaign not found." });
        return;
      }
      let title = campaign.titleOverride ?? "";
      let body = campaign.bodyOverride ?? "";
      if (campaign.templateId) {
        const [tpl] = await db
          .select()
          .from(notificationTemplatesTable)
          .where(eq(notificationTemplatesTable.id, campaign.templateId))
          .limit(1);
        if (tpl) {
          title = title || tpl.titleTemplate;
          body = body || tpl.bodyTemplate;
        }
      }
      // Substitute variables
      const vars = {
        ...(campaign.variables as Record<string, string>),
        ...(req.body as Record<string, unknown>),
      };
      for (const [k, v] of Object.entries(vars)) {
        title = title.replaceAll(`{{${k}}}`, String(v));
        body = body.replaceAll(`{{${k}}}`, String(v));
      }
      const filter = campaign.audienceFilter as Record<string, unknown>;
      const estimatedAudience = await audienceCount(filter);

      res.json({
        preview: { title, body },
        estimatedAudience,
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
        reason: "No outbound push provider is configured.",
      });
    } catch (err) {
      req.log.error({ err }, "Campaign preview failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/campaigns/:id/test
router.post(
  "/admin/governance/campaigns/:id/test",
  requireAdminPermission("notifications:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid campaign id." });
      return;
    }

    // Per-admin sliding-window rate limit: 5 test attempts / minute.
    const rlKey = req.admin!.id;
    const rl = checkRateLimit(
      campaignTestHits,
      rlKey,
      CAMPAIGN_TEST_LIMIT,
      CAMPAIGN_TEST_WINDOW_MS,
    );
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSeconds));
      res.status(429).json({
        message: `Rate limit exceeded: max ${CAMPAIGN_TEST_LIMIT} campaign test attempts per minute. Try again in ${rl.retryAfterSeconds}s.`,
        retryAfterSeconds: rl.retryAfterSeconds,
      });
      return;
    }

    try {
      // Verify the campaign exists before recording a test attempt.
      const [campaign] = await db
        .select()
        .from(notificationCampaignsTable)
        .where(eq(notificationCampaignsTable.id, id))
        .limit(1);
      if (!campaign) {
        res.status(404).json({ message: "Campaign not found." });
        return;
      }

      // Test delivery attempt + audit must be one transaction — do not return
      // success if either write fails.
      await db.transaction(async (tx) => {
        await recordDeliveryAttemptTx(tx, req.admin?.id ?? null, id, "test", 0);
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "campaign:test_action",
          "notification_campaign",
          id,
          { providerStatus: CAMPAIGN_PROVIDER_STATUS },
        );
      });

      res.json({
        outcome: "not_connected",
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
        message: "No outbound push provider is configured. No notifications were sent.",
      });
    } catch (err) {
      req.log.error({ err }, "Campaign test action failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/campaigns/:id/confirm
router.post(
  "/admin/governance/campaigns/:id/confirm",
  requireAdminPermission("notifications:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid campaign id." });
      return;
    }

    // Per-admin sliding-window rate limit: 10 confirmations / hour.
    const rl = checkRateLimit(
      campaignConfirmHits,
      req.admin!.id,
      CAMPAIGN_CONFIRM_LIMIT,
      CAMPAIGN_CONFIRM_WINDOW_MS,
    );
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSeconds));
      res.status(429).json({
        message: `Rate limit exceeded: max ${CAMPAIGN_CONFIRM_LIMIT} campaign confirmations per hour. Try again in ${rl.retryAfterSeconds}s.`,
        retryAfterSeconds: rl.retryAfterSeconds,
      });
      return;
    }

    try {
      const [campaign] = await db
        .select()
        .from(notificationCampaignsTable)
        .where(eq(notificationCampaignsTable.id, id))
        .limit(1);
      if (!campaign) {
        res.status(404).json({ message: "Campaign not found." });
        return;
      }
      if (campaign.status !== "draft") {
        res.status(400).json({ message: "Only draft campaigns can be confirmed." });
        return;
      }
      const filter = campaign.audienceFilter as Record<string, unknown>;
      const estAudience = await audienceCount(filter);
      const now = new Date();

      // Campaign state update + delivery attempt + audit must be one transaction.
      // Do not return success if any write fails.
      const updated = await db.transaction(async (tx) => {
        const [updatedCampaign] = await tx
          .update(notificationCampaignsTable)
          .set({
            status: "confirmed",
            providerStatus: CAMPAIGN_PROVIDER_STATUS,
            deliveryOutcome: "not_connected",
            confirmedAt: now,
            confirmedByAdminId: req.admin!.id,
            audienceCount: estAudience,
            updatedAt: now,
          })
          .where(eq(notificationCampaignsTable.id, id))
          .returning();
        await recordDeliveryAttemptTx(tx, req.admin?.id ?? null, id, "confirm", estAudience);
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "campaign:confirm",
          "notification_campaign",
          id,
          { audienceCount: estAudience, providerStatus: CAMPAIGN_PROVIDER_STATUS },
        );
        return updatedCampaign;
      });

      res.json({
        campaign: updated,
        audienceCount: estAudience,
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
        message: "Campaign confirmed, but delivery is blocked: no push provider is connected.",
      });
    } catch (err) {
      req.log.error({ err }, "Campaign confirm failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/campaigns/:id/schedule
router.post(
  "/admin/governance/campaigns/:id/schedule",
  requireAdminPermission("notifications:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid campaign id." });
      return;
    }
    const { scheduledAt } = req.body as { scheduledAt?: unknown };
    if (!scheduledAt || typeof scheduledAt !== "string") {
      res.status(400).json({ message: "scheduledAt (ISO string) is required." });
      return;
    }
    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime()) || schedDate <= new Date()) {
      res.status(400).json({ message: "scheduledAt must be a valid future datetime." });
      return;
    }
    try {
      const [campaign] = await db
        .select()
        .from(notificationCampaignsTable)
        .where(eq(notificationCampaignsTable.id, id))
        .limit(1);
      if (!campaign) {
        res.status(404).json({ message: "Campaign not found." });
        return;
      }
      if (campaign.status !== "confirmed") {
        res.status(400).json({ message: "Campaign must be confirmed before scheduling." });
        return;
      }
      // Campaign state update + delivery attempt + audit must be one transaction.
      // Do not return success if any write fails.
      const updated = await db.transaction(async (tx) => {
        const [updatedCampaign] = await tx
          .update(notificationCampaignsTable)
          .set({
            status: "scheduled",
            scheduledAt: schedDate,
            providerStatus: CAMPAIGN_PROVIDER_STATUS,
            deliveryOutcome: "not_connected",
            updatedAt: new Date(),
          })
          .where(eq(notificationCampaignsTable.id, id))
          .returning();
        await recordDeliveryAttemptTx(
          tx,
          req.admin?.id ?? null,
          id,
          "schedule",
          campaign.audienceCount ?? 0,
        );
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "campaign:schedule",
          "notification_campaign",
          id,
          { scheduledAt: schedDate.toISOString(), providerStatus: CAMPAIGN_PROVIDER_STATUS },
        );
        return updatedCampaign;
      });

      res.json({
        campaign: updated,
        providerStatus: CAMPAIGN_PROVIDER_STATUS,
        deliveryBlocked: true,
        message:
          "Campaign scheduled, but delivery is blocked: no push provider is connected. The record is visible as delivery-blocked.",
      });
    } catch (err) {
      req.log.error({ err }, "Campaign schedule failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// SUPPORT CASES
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/governance/support
router.get(
  "/admin/governance/support",
  requireAdminPermission("support:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { status, priority } = req.query as Record<string, string | undefined>;
    try {
      const conditions = [];
      if (status) conditions.push(eq(supportCasesTable.status, status));
      if (priority) conditions.push(eq(supportCasesTable.priority, priority));
      let query = db
        .select({
          case: supportCasesTable,
          submission: contactSubmissionsTable,
        })
        .from(supportCasesTable)
        .innerJoin(
          contactSubmissionsTable,
          eq(supportCasesTable.submissionId, contactSubmissionsTable.id),
        )
        .$dynamic();
      if (conditions.length > 0) query = query.where(and(...conditions));
      const rows = await query.orderBy(desc(supportCasesTable.updatedAt));
      // Also list submissions without a case (open contact submissions)
      const [orphanRow] = await db
        .select({ cnt: count() })
        .from(contactSubmissionsTable)
        .leftJoin(
          supportCasesTable,
          eq(supportCasesTable.submissionId, contactSubmissionsTable.id),
        )
        .where(isNull(supportCasesTable.id));
      const orphanCount = Number(orphanRow?.cnt ?? 0);
      res.json({
        cases: rows.map((r) => ({ ...r.case, submission: r.submission })),
        submissionsWithoutCase: orphanCount,
      });
    } catch (err) {
      req.log.error({ err }, "Support list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// GET /admin/governance/support/:id
router.get(
  "/admin/governance/support/:id",
  requireAdminPermission("support:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid case id." });
      return;
    }
    try {
      const [row] = await db
        .select({
          case: supportCasesTable,
          submission: contactSubmissionsTable,
        })
        .from(supportCasesTable)
        .innerJoin(
          contactSubmissionsTable,
          eq(supportCasesTable.submissionId, contactSubmissionsTable.id),
        )
        .where(eq(supportCasesTable.id, id))
        .limit(1);
      if (!row) {
        res.status(404).json({ message: "Case not found." });
        return;
      }
      const notes = await db
        .select()
        .from(supportCaseNotesTable)
        .where(eq(supportCaseNotesTable.caseId, id))
        .orderBy(desc(supportCaseNotesTable.createdAt));
      res.json({ case: { ...row.case, submission: row.submission }, notes });
    } catch (err) {
      req.log.error({ err }, "Support detail failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// PATCH /admin/governance/support/:id
router.patch(
  "/admin/governance/support/:id",
  requireAdminPermission("support:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid case id." });
      return;
    }
    const { status, priority, assignedToAdminId, outcome } = req.body as Record<string, unknown>;
    const VALID_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"];
    const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof status === "string") {
      if (!VALID_STATUSES.includes(status)) {
        res.status(400).json({ message: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}.` });
        return;
      }
      patch.status = status;
      if (status === "resolved" || status === "closed") patch.resolvedAt = new Date();
    }
    if (typeof priority === "string") {
      if (!VALID_PRIORITIES.includes(priority)) {
        res.status(400).json({ message: `Invalid priority. Allowed: ${VALID_PRIORITIES.join(", ")}.` });
        return;
      }
      patch.priority = priority;
    }
    if (assignedToAdminId != null) {
      if (typeof assignedToAdminId !== "string" || !isUuid(assignedToAdminId)) {
        res.status(400).json({ message: "Invalid assignedToAdminId." });
        return;
      }
      patch.assignedToAdminId = assignedToAdminId;
    }
    if (typeof outcome === "string") patch.outcome = outcome;

    try {
      const [updated] = await db
        .update(supportCasesTable)
        .set(patch)
        .where(eq(supportCasesTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ message: "Case not found." });
        return;
      }
      await writeAudit(req, "support:update", "support_case", id, patch);
      res.json({ case: updated });
    } catch (err) {
      req.log.error({ err }, "Support update failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/support/:id/notes
router.post(
  "/admin/governance/support/:id/notes",
  requireAdminPermission("support:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid case id." });
      return;
    }
    const { content, noteType } = req.body as Record<string, unknown>;
    if (!content || typeof content !== "string" || !content.trim()) {
      res.status(400).json({ message: "content is required." });
      return;
    }
    const VALID_NOTE_TYPES = ["internal", "off_platform_reply"];
    const resolvedType =
      typeof noteType === "string" && VALID_NOTE_TYPES.includes(noteType) ? noteType : "internal";
    try {
      const [existing] = await db
        .select({ id: supportCasesTable.id })
        .from(supportCasesTable)
        .where(eq(supportCasesTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ message: "Case not found." });
        return;
      }
      const [note] = await db
        .insert(supportCaseNotesTable)
        .values({
          caseId: id,
          authorAdminId: req.admin!.id,
          content: content.trim(),
          noteType: resolvedType,
        })
        .returning();
      await writeAudit(req, "support:note_added", "support_case", id, {
        noteId: note!.id,
        noteType: resolvedType,
      });
      res.status(201).json({ note });
    } catch (err) {
      req.log.error({ err }, "Support note create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// PRIVACY / ACCOUNT REQUESTS
// ══════════════════════════════════════════════════════════════════════════════

const VALID_REQUEST_TYPES = [
  "export_data",
  "delete_account",
  "right_to_forget",
  "data_correction",
];

/**
 * Safe column projection for privacy requests. Deliberately EXCLUDES the raw
 * exportPayload column — raw personal export data is never returned from list
 * or detail endpoints. Only a safe manifest/count summary is exposed.
 */
const privacyRequestSafeColumns = {
  id: privacyRequestsTable.id,
  userId: privacyRequestsTable.userId,
  requesterEmail: privacyRequestsTable.requesterEmail,
  requestType: privacyRequestsTable.requestType,
  description: privacyRequestsTable.description,
  status: privacyRequestsTable.status,
  identityVerified: privacyRequestsTable.identityVerified,
  verifiedAt: privacyRequestsTable.verifiedAt,
  verifiedByAdminId: privacyRequestsTable.verifiedByAdminId,
  approvedAt: privacyRequestsTable.approvedAt,
  approvedByAdminId: privacyRequestsTable.approvedByAdminId,
  assignedToAdminId: privacyRequestsTable.assignedToAdminId,
  completedAt: privacyRequestsTable.completedAt,
  exportOutcome: privacyRequestsTable.exportOutcome,
  errorDetails: privacyRequestsTable.errorDetails,
  createdAt: privacyRequestsTable.createdAt,
  updatedAt: privacyRequestsTable.updatedAt,
} as const;
const VALID_PRIVACY_STATUSES = [
  "pending",
  "under_review",
  "verified",
  "approved",
  "rejected",
  "completed",
  "failed",
];

// GET /admin/governance/privacy
router.get(
  "/admin/governance/privacy",
  requireAdminPermission("privacy:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { status, requestType } = req.query as Record<string, string | undefined>;
    try {
      // Combine list filters with and(); never select the raw exportPayload.
      const conditions = [];
      if (status) conditions.push(eq(privacyRequestsTable.status, status));
      if (requestType) conditions.push(eq(privacyRequestsTable.requestType, requestType));
      let query = db.select(privacyRequestSafeColumns).from(privacyRequestsTable).$dynamic();
      if (conditions.length > 0) query = query.where(and(...conditions));
      const requests = await query.orderBy(desc(privacyRequestsTable.createdAt));
      res.json({ requests });
    } catch (err) {
      req.log.error({ err }, "Privacy list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/privacy
router.post(
  "/admin/governance/privacy",
  requireAdminPermission("privacy:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { userId, requesterEmail, requestType, description } = req.body as Record<string, unknown>;
    if (!requesterEmail || typeof requesterEmail !== "string" || !requesterEmail.trim()) {
      res.status(400).json({ message: "requesterEmail is required." });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail.trim())) {
      res.status(400).json({ message: "requesterEmail must be a valid email address." });
      return;
    }
    if (!requestType || typeof requestType !== "string" || !VALID_REQUEST_TYPES.includes(requestType)) {
      res.status(400).json({ message: `requestType must be one of: ${VALID_REQUEST_TYPES.join(", ")}.` });
      return;
    }

    const normalizedEmail = requesterEmail.trim().toLowerCase();
    const rawUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;

    try {
      let resolvedUserId: string | null = null;

      if (rawUserId != null) {
        // userId explicitly supplied — load the account and require case-insensitive email match.
        if (!isUuid(rawUserId)) {
          res.status(400).json({ message: "userId must be a valid UUID." });
          return;
        }
        const [linkedUser] = await db
          .select({ id: usersTable.id, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, rawUserId))
          .limit(1);
        if (!linkedUser) {
          res.status(422).json({ message: "No user account found for the supplied userId." });
          return;
        }
        if (linkedUser.email.toLowerCase() !== normalizedEmail) {
          res.status(422).json({
            message: "requesterEmail does not match the email address on the linked account.",
          });
          return;
        }
        resolvedUserId = linkedUser.id;
      } else {
        // No userId supplied — auto-link if an exact-match account email exists.
        const [matchedUser] = await db
          .select({ id: usersTable.id, email: usersTable.email })
          .from(usersTable)
          .where(eq(sql`lower(${usersTable.email})`, normalizedEmail))
          .limit(1);
        resolvedUserId = matchedUser?.id ?? null;
      }

      const [request] = await db
        .insert(privacyRequestsTable)
        .values({
          userId: resolvedUserId,
          requesterEmail: normalizedEmail,
          requestType,
          description: typeof description === "string" ? description.trim() : "",
          assignedToAdminId: req.admin!.id,
        })
        .returning();
      await writeAudit(req, "privacy:create", "privacy_request", request!.id, {
        requestType,
        linkedUserId: resolvedUserId,
      });
      res.status(201).json({ request });
    } catch (err) {
      req.log.error({ err }, "Privacy request create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// GET /admin/governance/privacy/:id
router.get(
  "/admin/governance/privacy/:id",
  requireAdminPermission("privacy:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid request id." });
      return;
    }
    try {
      // Safe explicit projection — raw exportPayload is never returned. This
      // also prevents legacy rows that may predate manifest-only persistence
      // from exposing personal data.
      const [request] = await db
        .select(privacyRequestSafeColumns)
        .from(privacyRequestsTable)
        .where(eq(privacyRequestsTable.id, id))
        .limit(1);
      if (!request) {
        res.status(404).json({ message: "Privacy request not found." });
        return;
      }
      // History: notes on this request via explicit safe selects.
      const history = await db
        .select({
          id: privacyRequestNotesTable.id,
          requestId: privacyRequestNotesTable.requestId,
          authorAdminId: privacyRequestNotesTable.authorAdminId,
          content: privacyRequestNotesTable.content,
          createdAt: privacyRequestNotesTable.createdAt,
        })
        .from(privacyRequestNotesTable)
        .where(eq(privacyRequestNotesTable.requestId, id))
        .orderBy(desc(privacyRequestNotesTable.createdAt));
      res.json({ request, notes: history, history });
    } catch (err) {
      req.log.error({ err }, "Privacy detail failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// PATCH /admin/governance/privacy/:id
// General update — status transitions to approved/completed are not allowed here.
// Use the dedicated approve endpoint for approval; completion happens automatically
// on export/delete actions. Verification records identityVerified and sets status=verified.
router.patch(
  "/admin/governance/privacy/:id",
  requireAdminPermission("privacy:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid request id." });
      return;
    }
    const { status, identityVerified, assignedToAdminId, description } = req.body as Record<string, unknown>;

    // Block direct approved/completed status changes — these have dedicated endpoints.
    if (status === "approved" || status === "completed") {
      res.status(400).json({
        message:
          status === "approved"
            ? "Use the dedicated approval endpoint (POST /privacy/:id/approve) to approve a request."
            : "completed status is set automatically when an action (export/delete) succeeds.",
      });
      return;
    }

    // Allowed general statuses via PATCH
    const PATCH_ALLOWED_STATUSES = ["pending", "under_review", "verified", "rejected", "failed"];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof status === "string") {
      if (!PATCH_ALLOWED_STATUSES.includes(status)) {
        res.status(400).json({ message: `Invalid status. Allowed via PATCH: ${PATCH_ALLOWED_STATUSES.join(", ")}.` });
        return;
      }
      patch.status = status;
      if (status === "failed") patch.completedAt = new Date();
    }
    if (typeof identityVerified === "boolean") {
      patch.identityVerified = identityVerified;
      if (identityVerified) {
        patch.verifiedAt = new Date();
        patch.verifiedByAdminId = req.admin!.id;
        // Verification advances the status to verified (if not already rejected/approved/etc.)
        if (!patch.status) {
          patch.status = "verified";
        }
      }
    }
    if (typeof assignedToAdminId === "string" && isUuid(assignedToAdminId))
      patch.assignedToAdminId = assignedToAdminId;
    if (typeof description === "string") patch.description = description.trim();

    try {
      const [updated] = await db
        .update(privacyRequestsTable)
        .set(patch)
        .where(eq(privacyRequestsTable.id, id))
        .returning(privacyRequestSafeColumns);
      if (!updated) {
        res.status(404).json({ message: "Privacy request not found." });
        return;
      }
      await writeAudit(req, "privacy:update", "privacy_request", id, {
        status: patch.status,
        identityVerified: patch.identityVerified,
        assignedToAdminId: patch.assignedToAdminId,
      });
      res.json({ request: updated });
    } catch (err) {
      req.log.error({ err }, "Privacy update failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/privacy/:id/approve
// Dedicated approval endpoint — requires privacy:approve + recent admin auth.
// The request must be verified (identityVerified = true) before approval.
router.post(
  "/admin/governance/privacy/:id/approve",
  requireAdminPermission("privacy:approve"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid request id." });
      return;
    }
    try {
      const [request] = await db
        .select(privacyRequestSafeColumns)
        .from(privacyRequestsTable)
        .where(eq(privacyRequestsTable.id, id))
        .limit(1);
      if (!request) {
        res.status(404).json({ message: "Privacy request not found." });
        return;
      }
      if (!request.identityVerified) {
        res.status(422).json({
          message: "Request must be identity-verified before it can be approved.",
        });
        return;
      }
      if (request.status === "approved" || request.status === "completed") {
        res.status(400).json({ message: `Request is already ${request.status}.` });
        return;
      }
      if (request.status === "rejected") {
        res.status(400).json({ message: "Rejected requests cannot be approved." });
        return;
      }
      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [approvedRequest] = await tx
          .update(privacyRequestsTable)
          .set({
            status: "approved",
            approvedAt: now,
            approvedByAdminId: req.admin!.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(privacyRequestsTable.id, id),
              eq(privacyRequestsTable.identityVerified, true),
              eq(privacyRequestsTable.status, request.status),
            ),
          )
          .returning(privacyRequestSafeColumns);
        if (!approvedRequest) {
          throw new Error("Privacy request changed while approval was in progress.");
        }
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "privacy:approve",
          "privacy_request",
          id,
          { status: "approved" },
        );
        return approvedRequest;
      });
      res.json({ request: updated, message: "Privacy request approved." });
    } catch (err) {
      req.log.error({ err }, "Privacy approve failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/privacy/:id/export
router.post(
  "/admin/governance/privacy/:id/export",
  requireAdminPermission("privacy:export"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid request id." });
      return;
    }
    try {
      const [request] = await db
        .select()
        .from(privacyRequestsTable)
        .where(eq(privacyRequestsTable.id, id))
        .limit(1);
      if (!request) {
        res.status(404).json({ message: "Privacy request not found." });
        return;
      }
      if (request.requestType !== "export_data") {
        res.status(400).json({ message: "This privacy request is not an export_data request." });
        return;
      }
      if (!request.identityVerified || request.status !== "approved") {
        res.status(403).json({ message: "Request must be identity-verified and approved before export." });
        return;
      }
      if (!request.userId) {
        await db
          .update(privacyRequestsTable)
          .set({
            status: "failed",
            exportOutcome: "failed",
            errorDetails: "No linked user account found for this request.",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(privacyRequestsTable.id, id));
        await writeAudit(req, "privacy:export_failed", "privacy_request", id, {
          reason: "no_user_id",
        }, "failure");
        res.status(422).json({ message: "No linked user account found for this export request." });
        return;
      }

      // Fetch real account data
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, request.userId))
        .limit(1);
      if (!user) {
        await db
          .update(privacyRequestsTable)
          .set({
            status: "failed",
            exportOutcome: "failed",
            errorDetails: "User account no longer exists.",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(privacyRequestsTable.id, id));
        await writeAudit(req, "privacy:export_failed", "privacy_request", id, {
          reason: "user_not_found",
        }, "failure");
        res.status(422).json({ message: "User account not found." });
        return;
      }

      const [collectionItems, wishlistItems, userNotifications] = await Promise.all([
        db
          .select()
          .from(collectionItemsTable)
          .where(eq(collectionItemsTable.userId, request.userId)),
        db
          .select()
          .from(wishlistItemsTable)
          .where(
            and(
              eq(wishlistItemsTable.userId, request.userId),
              isNull(wishlistItemsTable.deletedAt),
            ),
          ),
        db
          .select()
          .from(notificationsTable)
          .where(eq(notificationsTable.userId, request.userId))
          .orderBy(desc(notificationsTable.createdAt))
          .limit(500),
      ]);

      const exportedAt = new Date().toISOString();
      // Full downloadable export — returned to the authorized caller only.
      const exportPayload = {
        exportedAt,
        profile: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          username: user.username,
          bio: user.bio,
          location: user.location,
          avatarUrl: user.avatarUrl,
          favouriteTcg: user.favouriteTcg,
          collectorSince: user.collectorSince,
          subscriptionTier: user.subscriptionTier,
          isFoundingMember: user.isFoundingMember,
          preferredTcgs: user.preferredTcgs,
          createdAt: user.createdAt,
        },
        collection: collectionItems,
        wishlist: wishlistItems,
        notifications: userNotifications,
      };

      // Persist ONLY a safe manifest/count summary — never the raw personal
      // payload. The manifest records what was produced without retaining PII.
      const exportManifest = {
        exportedAt,
        counts: {
          profileFields: Object.keys(exportPayload.profile).length,
          collectionItems: collectionItems.length,
          wishlistItems: wishlistItems.length,
          notifications: userNotifications.length,
        },
        sections: ["profile", "collection", "wishlist", "notifications"],
      };

      await db.transaction(async (tx) => {
        await tx
          .update(privacyRequestsTable)
          .set({
            status: "completed",
            exportOutcome: "success",
            exportPayload: exportManifest,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(privacyRequestsTable.id, id));
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "privacy:export_success",
          "privacy_request",
          id,
          { manifest: exportManifest.counts },
        );
      });

      res.json({
        message: "Account data export completed successfully.",
        manifest: exportManifest,
        // Downloadable export data — only returned from this authorized action.
        export: exportPayload,
      });
    } catch (err) {
      req.log.error({ err }, "Privacy export failed");
      // Persist failure
      try {
        await db
          .update(privacyRequestsTable)
          .set({
            status: "failed",
            exportOutcome: "failed",
            errorDetails: "Export generation failed. Review restricted server logs for details.",
            updatedAt: new Date(),
          })
          .where(eq(privacyRequestsTable.id, id));
        await writeAudit(req, "privacy:export_failed", "privacy_request", id, {}, "failure");
      } catch {
        // best effort
      }
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// DELETE /admin/governance/privacy/:id/delete-account
router.delete(
  "/admin/governance/privacy/:id/delete-account",
  requireOwner,
  requireAdminPermission("privacy:delete"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid request id." });
      return;
    }
    const { confirmText } = req.body as { confirmText?: unknown };
    if (confirmText !== "DELETE") {
      res.status(400).json({
        message: 'Provide confirmText: "DELETE" to confirm permanent collector deletion.',
      });
      return;
    }
    try {
      const [request] = await db
        .select()
        .from(privacyRequestsTable)
        .where(eq(privacyRequestsTable.id, id))
        .limit(1);
      if (!request) {
        res.status(404).json({ message: "Privacy request not found." });
        return;
      }
      if (
        request.requestType !== "delete_account" &&
        request.requestType !== "right_to_forget"
      ) {
        res.status(400).json({
          message: "This request is not a delete_account or right_to_forget request.",
        });
        return;
      }
      if (!request.identityVerified || request.status !== "approved") {
        res.status(403).json({
          message: "Request must be identity-verified and approved before deletion.",
        });
        return;
      }
      if (!request.userId) {
        res.status(422).json({ message: "No linked user account found." });
        return;
      }

      // Perform the genuine deletion, completion update, and audit row atomically.
      // The audit row is written inside the transaction so that a partial outcome
      // (deletion without audit) is impossible.
      const deleted = await db.transaction(async (tx) => {
        const [deletedUser] = await tx
          .delete(usersTable)
          .where(eq(usersTable.id, request.userId!))
          .returning({ id: usersTable.id });
        if (!deletedUser) return null;

        await tx
          .update(privacyRequestsTable)
          .set({
            status: "completed",
            userId: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(privacyRequestsTable.id, id));

        // Sanitized audit row — no PII beyond the anonymised userId that was deleted.
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "privacy:delete_account",
          "privacy_request",
          id,
          { deletedUserId: deletedUser.id },
        );

        return deletedUser;
      });
      if (!deleted) {
        res.status(404).json({ message: "User account not found or already deleted." });
        return;
      }

      req.log.info(
        { privacyRequestId: id, deletedUserId: deleted.id },
        "Admin permanently deleted collector via privacy request",
      );

      res.json({ message: "Collector account permanently deleted.", deletedUserId: deleted.id });
    } catch (err) {
      req.log.error({ err }, "Privacy account deletion failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/privacy/:id/notes
router.post(
  "/admin/governance/privacy/:id/notes",
  requireAdminPermission("privacy:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid request id." });
      return;
    }
    const { content } = req.body as { content?: unknown };
    if (!content || typeof content !== "string" || !content.trim()) {
      res.status(400).json({ message: "content is required." });
      return;
    }
    try {
      const [existing] = await db
        .select({ id: privacyRequestsTable.id })
        .from(privacyRequestsTable)
        .where(eq(privacyRequestsTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ message: "Privacy request not found." });
        return;
      }
      const [note] = await db
        .insert(privacyRequestNotesTable)
        .values({ requestId: id, authorAdminId: req.admin!.id, content: content.trim() })
        .returning();
      await writeAudit(req, "privacy:note_added", "privacy_request", id, { noteId: note!.id });
      res.status(201).json({ note });
    } catch (err) {
      req.log.error({ err }, "Privacy note create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// RETENTION POLICIES
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/governance/retention
router.get(
  "/admin/governance/retention",
  requireAdminPermission("retention:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const policies = await db
        .select()
        .from(retentionPoliciesTable)
        .orderBy(desc(retentionPoliciesTable.createdAt));
      const runs = await db
        .select()
        .from(retentionRunsTable)
        .orderBy(desc(retentionRunsTable.createdAt));
      res.json({ policies, runs });
    } catch (err) {
      req.log.error({ err }, "Retention list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/retention (upsert by dataType)
router.post(
  "/admin/governance/retention",
  requireAdminPermission("retention:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { name, description, dataType, retentionDays, status } = req.body as Record<string, unknown>;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required." });
      return;
    }
    if (!dataType || typeof dataType !== "string" || !dataType.trim()) {
      res.status(400).json({ message: "dataType is required." });
      return;
    }
    if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 1) {
      res.status(400).json({ message: "retentionDays must be a positive integer." });
      return;
    }
    try {
      // Upsert by name
      const [existing] = await db
        .select()
        .from(retentionPoliciesTable)
        .where(eq(retentionPoliciesTable.name, name.trim()))
        .limit(1);

      let policy;
      if (existing) {
        [policy] = await db
          .update(retentionPoliciesTable)
          .set({
            description: typeof description === "string" ? description.trim() : existing.description,
            dataType: (dataType as string).trim(),
            retentionDays,
            status: status === "active" || status === "inactive" ? status : existing.status,
            updatedByAdminId: req.admin!.id,
            updatedAt: new Date(),
          })
          .where(eq(retentionPoliciesTable.id, existing.id))
          .returning();
        await writeAudit(req, "retention:upsert", "retention_policy", existing.id, { name, retentionDays });
      } else {
        [policy] = await db
          .insert(retentionPoliciesTable)
          .values({
            name: name.trim(),
            description: typeof description === "string" ? description.trim() : "",
            dataType: (dataType as string).trim(),
            retentionDays,
            status: status === "active" || status === "inactive" ? status : "active",
            createdByAdminId: req.admin!.id,
            updatedByAdminId: req.admin!.id,
          })
          .returning();
        await writeAudit(req, "retention:create", "retention_policy", policy!.id, { name, retentionDays });
      }
      res.json({ policy });
    } catch (err) {
      req.log.error({ err }, "Retention upsert failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/retention/:id/run
router.post(
  "/admin/governance/retention/:id/run",
  requireOwner,
  requireAdminPermission("retention:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid policy id." });
      return;
    }
    const { isDryRun, confirmText } = req.body as { isDryRun?: unknown; confirmText?: unknown };
    const dryRun = isDryRun !== false; // default to dry run
    if (!dryRun && confirmText !== "RUN") {
      res.status(400).json({
        message: 'For a real run, provide confirmText: "RUN".',
      });
      return;
    }
    try {
      const [policy] = await db
        .select()
        .from(retentionPoliciesTable)
        .where(eq(retentionPoliciesTable.id, id))
        .limit(1);
      if (!policy) {
        res.status(404).json({ message: "Retention policy not found." });
        return;
      }

      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      let affectedCount = 0;

      // Estimate-only — count rows that would be affected based on dataType
      // Real broad purges are not performed; automated execution is unavailable.
      if (policy.dataType === "audit_log") {
        const [row] = await db
          .select({ cnt: count() })
          .from(adminAuditLogTable)
          .where(lt(adminAuditLogTable.createdAt, cutoff));
        affectedCount = Number(row?.cnt ?? 0);
      } else if (policy.dataType === "activity_log") {
        // We can count but do not purge
        affectedCount = 0; // safe default — actual table requires import
      }

      const outcome = dryRun ? "dry_run_complete" : "blocked";
      const notes = dryRun
        ? `Dry run: ${affectedCount} rows would be affected.`
        : "Automated execution is unavailable. Run blocked — no data was deleted.";

      const [run] = await db
        .insert(retentionRunsTable)
        .values({
          policyId: id,
          isDryRun: dryRun,
          outcome,
          affectedCount,
          notes,
          triggeredByAdminId: req.admin!.id,
          completedAt: new Date(),
        })
        .returning();

      await writeAudit(req, "retention:run", "retention_policy", id, {
        isDryRun: dryRun,
        outcome,
        affectedCount,
      });

      res.json({
        run,
        message: notes,
        automatedExecutionAvailable: false,
      });
    } catch (err) {
      req.log.error({ err }, "Retention run failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL NOTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/governance/notes
router.get(
  "/admin/governance/notes",
  requireAdminPermission("notes:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const isOwner = req.admin!.role === "owner";
      // Combine all filters into a single and() — chained .where() calls would
      // otherwise overwrite each other and leak owner_only notes to staff.
      const conditions = [eq(internalNotesTable.status, "active")];
      if (!isOwner) {
        conditions.push(eq(internalNotesTable.visibility, "staff_only"));
      }
      const notes = await db
        .select()
        .from(internalNotesTable)
        .where(and(...conditions))
        .orderBy(desc(internalNotesTable.updatedAt));
      res.json({ notes });
    } catch (err) {
      req.log.error({ err }, "Notes list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/notes
router.post(
  "/admin/governance/notes",
  requireAdminPermission("notes:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { title, content, visibility } = req.body as Record<string, unknown>;
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ message: "title is required." });
      return;
    }
    if (content == null || typeof content !== "string") {
      res.status(400).json({ message: "content is required." });
      return;
    }
    const VALID_VISIBILITIES = ["staff_only", "owner_only"];
    const resolvedVisibility =
      typeof visibility === "string" && VALID_VISIBILITIES.includes(visibility)
        ? visibility
        : "staff_only";
    // Only owners can create owner_only notes
    if (resolvedVisibility === "owner_only" && req.admin!.role !== "owner") {
      res.status(403).json({ message: "Only owners can create owner_only notes." });
      return;
    }
    try {
      const [note] = await db
        .insert(internalNotesTable)
        .values({
          title: title.trim(),
          content,
          authorAdminId: req.admin!.id,
          visibility: resolvedVisibility,
        })
        .returning();
      await writeAudit(req, "notes:create", "internal_note", note!.id, { title: note!.title });
      res.status(201).json({ note });
    } catch (err) {
      req.log.error({ err }, "Note create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// GET /admin/governance/notes/:id/history
router.get(
  "/admin/governance/notes/:id/history",
  requireAdminPermission("notes:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid note id." });
      return;
    }
    try {
      const [note] = await db
        .select({
          id: internalNotesTable.id,
          title: internalNotesTable.title,
          visibility: internalNotesTable.visibility,
        })
        .from(internalNotesTable)
        .where(eq(internalNotesTable.id, id))
        .limit(1);
      if (!note) {
        res.status(404).json({ message: "Note not found." });
        return;
      }
      if (note.visibility === "owner_only" && req.admin!.role !== "owner") {
        res.status(403).json({ message: "This note history is restricted to owners." });
        return;
      }

      const history = await db
        .select({
          id: internalNoteHistoryTable.id,
          noteId: internalNoteHistoryTable.noteId,
          editedByAdminId: internalNoteHistoryTable.editedByAdminId,
          previousContent: internalNoteHistoryTable.previousContent,
          createdAt: internalNoteHistoryTable.createdAt,
        })
        .from(internalNoteHistoryTable)
        .where(eq(internalNoteHistoryTable.noteId, id))
        .orderBy(desc(internalNoteHistoryTable.createdAt));
      res.json({ note, history });
    } catch (err) {
      req.log.error({ err }, "Note history query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// PATCH /admin/governance/notes/:id
router.patch(
  "/admin/governance/notes/:id",
  requireAdminPermission("notes:manage"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid note id." });
      return;
    }
    const { title, content, visibility, status } = req.body as Record<string, unknown>;
    try {
      const [existing] = await db
        .select()
        .from(internalNotesTable)
        .where(eq(internalNotesTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ message: "Note not found." });
        return;
      }
      // Only the author or an owner can edit
      if (existing.authorAdminId !== req.admin!.id && req.admin!.role !== "owner") {
        res.status(403).json({ message: "Only the note author or an owner can edit this note." });
        return;
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof title === "string" && title.trim()) patch.title = title.trim();
      if (typeof content === "string") patch.content = content;
      if (visibility === "staff_only" || visibility === "owner_only") {
        if (visibility === "owner_only" && req.admin!.role !== "owner") {
          res.status(403).json({ message: "Only owners can set owner_only visibility." });
          return;
        }
        patch.visibility = visibility;
      }
      if (status === "active" || status === "archived") patch.status = status;

      const updated = await db.transaction(async (tx) => {
        if (typeof content === "string" && content !== existing.content) {
          await tx.insert(internalNoteHistoryTable).values({
            noteId: id,
            editedByAdminId: req.admin!.id,
            previousContent: existing.content,
          });
        }
        const [updatedNote] = await tx
          .update(internalNotesTable)
          .set(patch)
          .where(eq(internalNotesTable.id, id))
          .returning();
        await writeAuditTx(
          tx,
          req.admin?.id ?? null,
          req.admin?.email ?? null,
          "notes:update",
          "internal_note",
          id,
          patch,
        );
        return updatedNote;
      });
      res.json({ note: updated });
    } catch (err) {
      req.log.error({ err }, "Note update failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════════════════════

const VALID_ANNOUNCEMENT_STATUSES = ["draft", "scheduled", "published", "archived"];
const VALID_ANNOUNCEMENT_AUDIENCES = [
  "all_collectors",
  "pro_collectors",
  "free_collectors",
  "internal",
];

// GET /admin/governance/announcements
router.get(
  "/admin/governance/announcements",
  requireAdminPermission("announcements:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { status } = req.query as { status?: string };
    try {
      let query = db.select().from(announcementsTable).$dynamic();
      if (status && VALID_ANNOUNCEMENT_STATUSES.includes(status)) {
        query = query.where(eq(announcementsTable.status, status));
      }
      const announcements = await query.orderBy(desc(announcementsTable.createdAt));
      res.json({
        announcements,
        note: "Announcement status transitions do not imply any message was delivered to collectors.",
      });
    } catch (err) {
      req.log.error({ err }, "Announcements list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// POST /admin/governance/announcements
router.post(
  "/admin/governance/announcements",
  requireAdminPermission("announcements:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { title, content, audience, scheduledPublishAt } = req.body as Record<string, unknown>;
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ message: "title is required." });
      return;
    }
    if (content == null || typeof content !== "string") {
      res.status(400).json({ message: "content is required." });
      return;
    }
    let resolvedAudience = "all_collectors";
    if (audience != null) {
      if (typeof audience !== "string" || !VALID_ANNOUNCEMENT_AUDIENCES.includes(audience)) {
        res.status(400).json({
          message: `audience must be one of: ${VALID_ANNOUNCEMENT_AUDIENCES.join(", ")}.`,
        });
        return;
      }
      resolvedAudience = audience;
    }
    let schedDate: Date | null = null;
    if (scheduledPublishAt != null) {
      schedDate = new Date(scheduledPublishAt as string);
      if (isNaN(schedDate.getTime())) {
        res.status(400).json({ message: "scheduledPublishAt must be a valid ISO datetime." });
        return;
      }
      if (schedDate <= new Date()) {
        res.status(400).json({ message: "scheduledPublishAt must be a future datetime." });
        return;
      }
    }
    try {
      const [announcement] = await db
        .insert(announcementsTable)
        .values({
          title: title.trim(),
          content,
          audience: resolvedAudience,
          authorAdminId: req.admin!.id,
          status: schedDate ? "scheduled" : "draft",
          scheduledPublishAt: schedDate,
        })
        .returning();
      await writeAudit(req, "announcements:create", "announcement", announcement!.id, {
        title: announcement!.title,
        status: announcement!.status,
      });
      res.status(201).json({ announcement });
    } catch (err) {
      req.log.error({ err }, "Announcement create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// PATCH /admin/governance/announcements/:id
router.patch(
  "/admin/governance/announcements/:id",
  requireAdminPermission("announcements:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (!isUuid(id)) {
      res.status(400).json({ message: "Invalid announcement id." });
      return;
    }
    const { title, content, audience, status, scheduledPublishAt } =
      req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof title === "string" && title.trim()) patch.title = title.trim();
    if (typeof content === "string") patch.content = content;
    if (audience != null) {
      if (typeof audience !== "string" || !VALID_ANNOUNCEMENT_AUDIENCES.includes(audience)) {
        res.status(400).json({
          message: `audience must be one of: ${VALID_ANNOUNCEMENT_AUDIENCES.join(", ")}.`,
        });
        return;
      }
      patch.audience = audience;
    }
    if (typeof status === "string") {
      if (!VALID_ANNOUNCEMENT_STATUSES.includes(status)) {
        res.status(400).json({ message: `Invalid status.` });
        return;
      }
      patch.status = status;
      // Immediate publication is an explicit status transition on this PATCH and
      // does not require a future scheduledPublishAt.
      if (status === "published" && !patch.publishedAt) patch.publishedAt = new Date();
      if (status === "archived" && !patch.archivedAt) patch.archivedAt = new Date();
    }
    if (scheduledPublishAt != null) {
      const d = new Date(scheduledPublishAt as string);
      if (isNaN(d.getTime())) {
        res.status(400).json({ message: "scheduledPublishAt must be a valid ISO datetime." });
        return;
      }
      // A scheduled (not-yet-published) date must be in the future. When the
      // caller is publishing immediately, the future check does not apply.
      if (status !== "published" && d <= new Date()) {
        res.status(400).json({ message: "scheduledPublishAt must be a future datetime." });
        return;
      }
      patch.scheduledPublishAt = d;
    }

    try {
      const [updated] = await db
        .update(announcementsTable)
        .set(patch)
        .where(eq(announcementsTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ message: "Announcement not found." });
        return;
      }
      await writeAudit(req, "announcements:update", "announcement", id, patch);
      res.json({ announcement: updated });
    } catch (err) {
      req.log.error({ err }, "Announcement update failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVITY & ATTENTION
// ══════════════════════════════════════════════════════════════════════════════

// GET /admin/governance/activity — recent audit log entries
// Safe explicit projection — the raw details column is redacted globally to
// prevent legacy rows from exposing PII or sensitive operational context.
router.get(
  "/admin/governance/activity",
  requireAdminPermission("audit:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const limitStr = req.query["limit"];
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limitStr ?? "50")) || 50));
    try {
      const entries = await db
        .select({
          id: adminAuditLogTable.id,
          adminId: adminAuditLogTable.adminId,
          adminEmail: adminAuditLogTable.adminEmail,
          action: adminAuditLogTable.action,
          resourceType: adminAuditLogTable.resourceType,
          resourceId: adminAuditLogTable.resourceId,
          outcome: adminAuditLogTable.outcome,
          createdAt: adminAuditLogTable.createdAt,
          // details is intentionally omitted — redacted globally to prevent
          // legacy rows from exposing raw PII or sensitive operational context.
        })
        .from(adminAuditLogTable)
        .orderBy(desc(adminAuditLogTable.createdAt))
        .limit(limitNum);
      res.json({ activity: entries, total: entries.length });
    } catch (err) {
      req.log.error({ err }, "Activity log query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// GET /admin/governance/attention — genuine attention items
router.get(
  "/admin/governance/attention",
  requireAdminPermission("dashboard:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    try {
      const now = new Date();
      const staleSupportCutoff = new Date(now.getTime() - STALE_SUPPORT_DAYS * 24 * 60 * 60 * 1000);
      const stalePrivacyCutoff = new Date(now.getTime() - STALE_PRIVACY_DAYS * 24 * 60 * 60 * 1000);

      const [
        openSupportRows,
        staleSupportRows,
        stalePrivacyRows,
        failedExportRows,
        blockedCampaignRows,
      ] = await Promise.all([
        // Open/in-progress support cases
        db
          .select({ cnt: count() })
          .from(supportCasesTable)
          .where(
            or(
              eq(supportCasesTable.status, "open"),
              eq(supportCasesTable.status, "in_progress"),
            ),
          ),
        // Stale open support cases (not updated recently)
        db
          .select({ cnt: count() })
          .from(supportCasesTable)
          .where(
            and(
              ne(supportCasesTable.status, "closed"),
              ne(supportCasesTable.status, "resolved"),
              lt(supportCasesTable.updatedAt, staleSupportCutoff),
            ),
          ),
        // Stale privacy requests
        db
          .select({ cnt: count() })
          .from(privacyRequestsTable)
          .where(
            and(
              or(
                eq(privacyRequestsTable.status, "pending"),
                eq(privacyRequestsTable.status, "under_review"),
                eq(privacyRequestsTable.status, "verified"),
              ),
              lt(privacyRequestsTable.updatedAt, stalePrivacyCutoff),
            ),
          ),
        // Failed export requests
        db
          .select({ cnt: count() })
          .from(privacyRequestsTable)
          .where(
            and(
              eq(privacyRequestsTable.requestType, "export_data"),
              eq(privacyRequestsTable.exportOutcome, "failed"),
            ),
          ),
        // Campaigns that are confirmed/scheduled but delivery is blocked
        db
          .select({ cnt: count() })
          .from(notificationCampaignsTable)
          .where(
            and(
              or(
                eq(notificationCampaignsTable.status, "confirmed"),
                eq(notificationCampaignsTable.status, "scheduled"),
              ),
              eq(notificationCampaignsTable.providerStatus, "not_connected"),
            ),
          ),
      ]);

      const items = [];

      const openCount = Number(openSupportRows[0]?.cnt ?? 0);
      if (openCount > 0) {
        items.push({
          type: "open_support_cases",
          count: openCount,
          message: `${openCount} open or in-progress support case${openCount !== 1 ? "s" : ""}.`,
          severity: "info",
        });
      }

      const staleSupport = Number(staleSupportRows[0]?.cnt ?? 0);
      if (staleSupport > 0) {
        items.push({
          type: "stale_support_cases",
          count: staleSupport,
          message: `${staleSupport} support case${staleSupport !== 1 ? "s" : ""} not updated in ${STALE_SUPPORT_DAYS} days.`,
          severity: "warning",
        });
      }

      const stalePrivacy = Number(stalePrivacyRows[0]?.cnt ?? 0);
      if (stalePrivacy > 0) {
        items.push({
          type: "stale_privacy_requests",
          count: stalePrivacy,
          message: `${stalePrivacy} privacy request${stalePrivacy !== 1 ? "s" : ""} awaiting action for over ${STALE_PRIVACY_DAYS} days.`,
          severity: "warning",
        });
      }

      const failedExports = Number(failedExportRows[0]?.cnt ?? 0);
      if (failedExports > 0) {
        items.push({
          type: "failed_export_requests",
          count: failedExports,
          message: `${failedExports} failed data export request${failedExports !== 1 ? "s" : ""}.`,
          severity: "error",
        });
      }

      const blockedCampaigns = Number(blockedCampaignRows[0]?.cnt ?? 0);
      if (blockedCampaigns > 0) {
        items.push({
          type: "blocked_campaigns",
          count: blockedCampaigns,
          message: `${blockedCampaigns} campaign${blockedCampaigns !== 1 ? "s" : ""} blocked — no push provider connected.`,
          severity: "warning",
          providerStatus: CAMPAIGN_PROVIDER_STATUS,
        });
      }

      if (items.length === 0) {
        items.push({
          type: "all_clear",
          count: 0,
          message: "No governance items require immediate attention.",
          severity: "info",
        });
      }

      res.json({
        items,
        generatedAt: now.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "Attention query failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

export default router;
