/**
 * Platform configuration routes — operator-controlled runtime flags.
 *
 * GET   /api/admin/configuration          — list all controls with metadata, typed values, full history
 * PATCH /api/admin/configuration/:key     — OWNER only, recent auth, CSRF, confirmed:true, exact phrase
 * POST  /api/admin/configuration/:key/rollback — OWNER only, ROLL BACK CONFIG, confirmed:true
 * GET   /api/runtime-config              — public sanitized values only (no session required)
 */

import { Router, type Response } from "express";
import { db, platformConfigTable, adminAccountsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  type AdminRequest,
  requireAdminCsrf,
  requireAdminPermission,
  requireAdminSession,
  requireOwner,
  requireRecentAdminAuth,
} from "../lib/adminSession";
import { recordAdminAudit } from "../lib/adminAudit";
import {
  SUPPORTED_CONFIG_KEYS,
  CONFIG_KEY_TYPES,
  type ConfigKey,
  validateConfigValue,
  validatePlatformConfigValues,
  platformConfigFromRows,
  invalidateConfigCache,
  loadConfig,
} from "../lib/platformConfig";

const router = Router();

// Admin routes need session + CSRF
router.use("/admin/configuration", requireAdminSession, requireAdminCsrf);

// ── Control metadata (labels, descriptions, risk levels) ─────────────────────
const CONTROL_META: Record<ConfigKey, { label: string; description: string; risk: "low" | "medium" | "high" }> = {
  maintenance_mode: {
    label: "Maintenance Mode",
    description: "When enabled, all consumer API routes return 503. Exempt: admin panel, healthz, auth recovery.",
    risk: "high",
  },
  maintenance_message: {
    label: "Maintenance Message",
    description: "User-facing message shown during maintenance. Shown to clients receiving 503.",
    risk: "low",
  },
  scanner_enabled: {
    label: "Card Scanner",
    description: "When disabled, all /api/scan endpoints return 503.",
    risk: "medium",
  },
  pricing_enabled: {
    label: "Pricing Data",
    description: "When disabled, /api/pricing, /api/graded-prices, and price-related catalogue paths return 503.",
    risk: "medium",
  },
  community_enabled: {
    label: "Community Features",
    description: "When disabled, /api/community, /api/posts, /api/events, /api/collectors return 503.",
    risk: "medium",
  },
  minimum_app_version: {
    label: "Minimum App Version",
    description: "Clients below this semver receive 426 Upgrade Required. Set 0.0.0 to disable.",
    risk: "high",
  },
  latest_app_version: {
    label: "Latest App Version",
    description: "Used with force_update. Clients below this version must update when force_update is true.",
    risk: "medium",
  },
  force_update: {
    label: "Force Update",
    description: "When true, clients below latest_app_version receive 426. Enable only after confirming latest_app_version is set.",
    risk: "high",
  },
  remote_announcement: {
    label: "Remote Announcement",
    description: "Announcement text surfaced to all app clients via /api/runtime-config.",
    risk: "low",
  },
};

/** Cast a stored string value to its typed representation. */
function typedValue(key: ConfigKey, rawValue: string): boolean | string {
  const t = CONFIG_KEY_TYPES[key];
  if (t === "boolean") return rawValue === "true";
  return rawValue;
}

// ── GET /api/admin/configuration ──────────────────────────────────────────────

router.get(
  "/admin/configuration",
  requireAdminPermission("configuration:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const rows = await db.select().from(platformConfigTable).orderBy(platformConfigTable.key);

    // Collect unique changedByAdminId values to resolve display names
    const adminIds = [...new Set(rows.map((r) => r.changedByAdminId).filter(Boolean))] as string[];
    const adminNameMap: Record<string, string> = {};
    if (adminIds.length > 0) {
      const admins = await db
        .select({ id: adminAccountsTable.id, displayName: adminAccountsTable.displayName })
        .from(adminAccountsTable)
        .where(sql`${adminAccountsTable.id} = ANY(ARRAY[${sql.join(adminIds.map((id) => sql`${id}::uuid`), sql`, `)}])`);
      for (const a of admins) {
        adminNameMap[a.id] = a.displayName ?? a.id;
      }
    }

    res.json({
      controls: rows.map((r) => {
        const key = r.key as ConfigKey;
        const meta = CONTROL_META[key] ?? { label: key, description: "", risk: "low" };
        const revisions = Array.isArray(r.revisions)
          ? (r.revisions as Array<{
              version: number;
              value: string;
              changedByAdminId?: string;
              reason?: string;
              changedAt?: string;
            }>)
          : [];

        return {
          key,
          label: meta.label,
          description: meta.description,
          risk: meta.risk,
          value: typedValue(key, r.value),
          version: r.version,
          updatedAt: r.updatedAt.toISOString(),
          updatedBy: r.changedByAdminId ? (adminNameMap[r.changedByAdminId] ?? r.changedByAdminId) : null,
          history: revisions.map((rev) => ({
            version: rev.version,
            value: typedValue(key, rev.value),
            reason: rev.reason ?? null,
            createdAt: rev.changedAt ?? null,
            actorLabel: rev.changedByAdminId ? (adminNameMap[rev.changedByAdminId] ?? rev.changedByAdminId) : null,
          })),
        };
      }),
      serverEnforced: true,
    });
  },
);

// ── PATCH /api/admin/configuration/:key ──────────────────────────────────────
// Requires: confirmed:true, confirmation:"UPDATE <KEY>", reason 10-500 chars,
// expectedVersion integer, valid value per key type.
// Preserves blank string values — does not trim into absence.

router.patch(
  "/admin/configuration/:key",
  requireOwner,
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const key = String(req.params["key"] ?? "").trim() as ConfigKey;

    if (!(SUPPORTED_CONFIG_KEYS as readonly string[]).includes(key)) {
      res.status(400).json({
        message: `Unsupported configuration key. Valid keys: ${SUPPORTED_CONFIG_KEYS.join(", ")}.`,
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Accept the typed value exposed by GET. Values remain serialized in the
    // table, while blank strings stay valid for string controls.
    const valueType = CONFIG_KEY_TYPES[key];
    const suppliedValue = body["value"];
    const value =
      valueType === "boolean"
        ? typeof suppliedValue === "boolean"
          ? String(suppliedValue)
          : null
        : typeof suppliedValue === "string"
          ? suppliedValue
          : null;

    const reasonRaw = typeof body["reason"] === "string" ? body["reason"].trim() : "";
    const reason = reasonRaw.length >= 10 && reasonRaw.length <= 500 ? reasonRaw : null;

    // expectedVersion must be a non-negative integer
    const expectedVersionRaw = body["expectedVersion"];
    const expectedVersion =
      typeof expectedVersionRaw === "number" &&
      Number.isInteger(expectedVersionRaw) &&
      expectedVersionRaw >= 0
        ? expectedVersionRaw
        : null;

    const confirmed = body["confirmed"] === true;
    const confirmation = typeof body["confirmation"] === "string" ? body["confirmation"] : "";

    if (value === null) {
      res.status(400).json({
        message:
          valueType === "boolean"
            ? "value (boolean) is required."
            : "value (string) is required.",
      });
      return;
    }
    if (!reason) {
      res.status(400).json({ message: "reason must be 10–500 characters." });
      return;
    }
    if (expectedVersion === null) {
      res.status(400).json({ message: "expectedVersion (non-negative integer) is required for optimistic concurrency." });
      return;
    }
    if (!confirmed) {
      res.status(400).json({ message: "confirmed must be true." });
      return;
    }

    const expectedConfirmation = `UPDATE ${key.toUpperCase()}`;
    if (confirmation !== expectedConfirmation) {
      res.status(400).json({
        message: `confirmation must be exactly: ${expectedConfirmation}`,
      });
      return;
    }

    const validationError = validateConfigValue(key, value);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Serialize all platform configuration changes so cross-control
      // validation cannot race another owner update.
      const allControls = await tx
        .select()
        .from(platformConfigTable)
        .for("update")
        .orderBy(platformConfigTable.key);
      const existing = allControls.find((control) => control.key === key);

      if (!existing) return { status: 404 as const, message: "Configuration key not found." };

      if (existing.version !== expectedVersion) {
        return {
          status: 409 as const,
          message: `Version conflict: expected ${expectedVersion}, current is ${existing.version}. Reload and try again.`,
        };
      }

      const nextConfig = platformConfigFromRows(allControls);
      (nextConfig as unknown as Record<string, unknown>)[key] = typedValue(key, value);
      const crossControlError = validatePlatformConfigValues(nextConfig);
      if (crossControlError) {
        return { status: 400 as const, message: crossControlError };
      }

      const newRevision = {
        version: existing.version,
        value: existing.value,
        changedByAdminId: existing.changedByAdminId,
        reason: existing.reason,
        changedAt: existing.updatedAt.toISOString(),
      };
      const currentRevisions = Array.isArray(existing.revisions) ? (existing.revisions as unknown[]) : [];
      const revisions = [newRevision, ...currentRevisions];

      const [updated] = await tx
        .update(platformConfigTable)
        .set({
          value,
          version: existing.version + 1,
          revisions,
          changedByAdminId: req.admin!.id,
          reason,
          updatedAt: new Date(),
        })
        .where(
          sql`${platformConfigTable.key} = ${key} AND ${platformConfigTable.version} = ${expectedVersion}`,
        )
        .returning();

      if (!updated) {
        return { status: 409 as const, message: "Concurrent modification detected. Reload and try again." };
      }

      await recordAdminAudit(
        req,
        {
          action: `config.update.${key}`,
          resourceType: "platform_config",
          resourceId: key,
          reason,
          beforeState: { key, value: existing.value, version: existing.version },
          afterState: { key, value, version: updated.version },
        },
        tx,
      );

      return { status: 200 as const, config: updated };
    });

    if (result.status !== 200) {
      res.status(result.status).json({ message: result.message });
      return;
    }

    invalidateConfigCache();

    const cfg = result.config;
    const cfgKey = cfg.key as ConfigKey;
    res.json({
      key: cfg.key,
      value: typedValue(cfgKey, cfg.value),
      version: cfg.version,
      updatedAt: cfg.updatedAt.toISOString(),
    });
  },
);

// ── POST /api/admin/configuration/:key/rollback ───────────────────────────────
// Requires: confirmed:true, confirmation:"ROLL BACK CONFIG", targetVersion int, reason, expectedVersion int.

router.post(
  "/admin/configuration/:key/rollback",
  requireOwner,
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const key = String(req.params["key"] ?? "").trim() as ConfigKey;

    if (!(SUPPORTED_CONFIG_KEYS as readonly string[]).includes(key)) {
      res.status(400).json({ message: "Unsupported configuration key." });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    const targetVersionRaw = body["targetVersion"];
    const targetVersion =
      typeof targetVersionRaw === "number" && Number.isInteger(targetVersionRaw) && targetVersionRaw >= 0
        ? targetVersionRaw
        : null;

    const reasonRaw = typeof body["reason"] === "string" ? body["reason"].trim() : "";
    const reason = reasonRaw.length >= 10 && reasonRaw.length <= 500 ? reasonRaw : null;

    const expectedVersionRaw = body["expectedVersion"];
    const expectedVersion =
      typeof expectedVersionRaw === "number" && Number.isInteger(expectedVersionRaw) && expectedVersionRaw >= 0
        ? expectedVersionRaw
        : null;

    const confirmed = body["confirmed"] === true;
    const confirmation = typeof body["confirmation"] === "string" ? body["confirmation"] : "";

    if (targetVersion === null) {
      res.status(400).json({ message: "targetVersion (non-negative integer) is required." });
      return;
    }
    if (!reason) {
      res.status(400).json({ message: "reason must be 10–500 characters." });
      return;
    }
    if (expectedVersion === null) {
      res.status(400).json({ message: "expectedVersion (non-negative integer) is required for optimistic concurrency." });
      return;
    }
    if (!confirmed) {
      res.status(400).json({ message: "confirmed must be true." });
      return;
    }
    if (confirmation !== "ROLL BACK CONFIG") {
      res.status(400).json({ message: 'confirmation must be exactly: ROLL BACK CONFIG' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const allControls = await tx
        .select()
        .from(platformConfigTable)
        .for("update")
        .orderBy(platformConfigTable.key);
      const existing = allControls.find((control) => control.key === key);

      if (!existing) return { status: 404 as const, message: "Configuration key not found." };

      if (existing.version !== expectedVersion) {
        return {
          status: 409 as const,
          message: `Version conflict: expected ${expectedVersion}, current is ${existing.version}. Reload and try again.`,
        };
      }

      const currentRevisions = Array.isArray(existing.revisions)
        ? (existing.revisions as Array<{ version: number; value: string; changedByAdminId?: string; reason?: string; changedAt?: string }>)
        : [];

      const targetRevision = currentRevisions.find((r) => r.version === targetVersion);
      if (!targetRevision) {
        return { status: 400 as const, message: `No revision with version ${targetVersion} found in history.` };
      }

      const rollbackValue = targetRevision.value;
      const validationError = validateConfigValue(key, rollbackValue);
      if (validationError) {
        return { status: 400 as const, message: `Cannot rollback: ${validationError}` };
      }
      const nextConfig = platformConfigFromRows(allControls);
      (nextConfig as unknown as Record<string, unknown>)[key] = typedValue(key, rollbackValue);
      const crossControlError = validatePlatformConfigValues(nextConfig);
      if (crossControlError) {
        return { status: 400 as const, message: `Cannot rollback: ${crossControlError}` };
      }

      const rollbackRevision = {
        version: existing.version,
        value: existing.value,
        changedByAdminId: existing.changedByAdminId,
        reason: existing.reason,
        changedAt: existing.updatedAt.toISOString(),
      };
      const revisions = [rollbackRevision, ...currentRevisions];

      const [updated] = await tx
        .update(platformConfigTable)
        .set({
          value: rollbackValue,
          version: existing.version + 1,
          revisions,
          changedByAdminId: req.admin!.id,
          reason: `Rollback to v${targetVersion}: ${reason}`,
          updatedAt: new Date(),
        })
        .where(
          sql`${platformConfigTable.key} = ${key} AND ${platformConfigTable.version} = ${expectedVersion}`,
        )
        .returning();

      if (!updated) {
        return { status: 409 as const, message: "Concurrent modification detected. Reload and try again." };
      }

      await recordAdminAudit(
        req,
        {
          action: `config.rollback.${key}`,
          resourceType: "platform_config",
          resourceId: key,
          reason,
          beforeState: { key, value: existing.value, version: existing.version },
          afterState: { key, value: rollbackValue, version: updated.version, rolledBackToVersion: targetVersion },
        },
        tx,
      );

      return { status: 200 as const, config: updated };
    });

    if (result.status !== 200) {
      res.status(result.status).json({ message: result.message });
      return;
    }

    invalidateConfigCache();

    const cfg = result.config;
    const cfgKey = cfg.key as ConfigKey;
    res.json({
      key: cfg.key,
      value: typedValue(cfgKey, cfg.value),
      version: cfg.version,
      updatedAt: cfg.updatedAt.toISOString(),
      message: "Configuration rolled back to a prior revision.",
    });
  },
);

// ── GET /api/runtime-config — PUBLIC ─────────────────────────────────────────
// No admin session required. Returns sanitized runtime values only.
// No admin metadata, history, or secrets.

router.get("/runtime-config", async (_req, res: Response): Promise<void> => {
  const cfg = await loadConfig();
  res.json({
    maintenanceMode: cfg.maintenance_mode,
    maintenanceMessage: cfg.maintenance_message || null,
    scannerEnabled: cfg.scanner_enabled,
    pricingEnabled: cfg.pricing_enabled,
    communityEnabled: cfg.community_enabled,
    minimumAppVersion: cfg.minimum_app_version,
    latestAppVersion: cfg.latest_app_version,
    forceUpdate: cfg.force_update,
    remoteAnnouncement: cfg.remote_announcement || null,
  });
});

export default router;
