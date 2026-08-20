/**
 * GET  /admin/drops        — paginated list
 * POST /admin/drops        — create draft (reason required)
 * PATCH /admin/drops/:id   — edit fields (reason required)
 * POST /admin/drops/:id/status — status transition (reason required)
 *
 * Lifecycle: draft→published→live→expired; cancel path from draft/published/live.
 * "published" and "live" transitions require:
 *   - role === "owner"
 *   - recent auth (within 10 minutes)
 *   - confirmation === "CONFIRM"
 *
 * Drops are never seeded or fabricated — only real data is returned.
 * Status transitions write both statusHistory and auditEvent in a transaction.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { verifiedDropsTable, trustStatusHistoryTable } from "@workspace/db";
import { eq, desc, asc, and, count } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";
import { paramStr, paginationParams, checkRecentAuth, writeAudit, writeStatusHistory } from "./helpers.js";

export const dropsRouter = Router();

const VALID_DROP_STATUSES = ["draft", "published", "live", "expired", "cancelled"] as const;
const DROP_TRANSITIONS: Record<string, string[]> = {
  draft: ["published", "cancelled"],
  published: ["live", "cancelled"],
  live: ["expired", "cancelled"],
  expired: [],
  cancelled: [],
};

// ── GET /admin/drops ──────────────────────────────────────────────────────────

dropsRouter.get(
  "/admin/drops",
  requireAdminPermission("drops:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const status = q.status?.trim();

    try {
      const where = status ? eq(verifiedDropsTable.status, status) : undefined;
      const [totalRow, drops] = await Promise.all([
        db.select({ cnt: count() }).from(verifiedDropsTable).where(where),
        db
          .select()
          .from(verifiedDropsTable)
          .where(where)
          .orderBy(desc(verifiedDropsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ drops, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin drops list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/drops/:id ──────────────────────────────────────────────────────
//
// Read-only detail: drop row plus its trust status history ordered
// chronologically. No records are created or fabricated here.

dropsRouter.get(
  "/admin/drops/:id",
  requireAdminPermission("drops:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const dropId = paramStr(req, "id");
    if (!dropId) {
      res.status(400).json({ message: "Missing drop id." });
      return;
    }

    try {
      const [drop] = await db
        .select()
        .from(verifiedDropsTable)
        .where(eq(verifiedDropsTable.id, dropId))
        .limit(1);

      if (!drop) {
        res.status(404).json({ message: "Drop not found." });
        return;
      }

      const statusHistory = await db
        .select()
        .from(trustStatusHistoryTable)
        .where(
          and(
            eq(trustStatusHistoryTable.domain, "drop"),
            eq(trustStatusHistoryTable.recordId, dropId),
          ),
        )
        .orderBy(asc(trustStatusHistoryTable.createdAt));

      res.json({ drop, statusHistory });
    } catch (err) {
      req.log.error({ err, dropId }, "admin drop detail failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/drops ─────────────────────────────────────────────────────────

dropsRouter.post(
  "/admin/drops",
  requireAdminPermission("drops:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const { title, description, imageUrl, deepLink, eligibility, startsAt, endsAt, proOnly, featured, reason } =
      body;

    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ message: "title is required." });
      return;
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      res.status(400).json({ message: "description is required." });
      return;
    }
    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      let drop: typeof verifiedDropsTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(verifiedDropsTable)
          .values({
            title: String(title).trim(),
            description: String(description).trim(),
            imageUrl: imageUrl ? String(imageUrl) : null,
            deepLink: deepLink ? String(deepLink) : null,
            eligibility: eligibility ? String(eligibility) : null,
            startsAt: startsAt ? new Date(String(startsAt)) : null,
            endsAt: endsAt ? new Date(String(endsAt)) : null,
            proOnly: proOnly === true,
            featured: featured === true,
            status: "draft",
            createdByAdminId: req.admin!.id,
          })
          .returning();
        drop = inserted;

        // Initial status history for newly created drop
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "drop",
          recordId: inserted!.id,
          fromStatus: null,
          toStatus: "draft",
          reason: String(reason).trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "drop.create",
          category: "drops",
          targetType: "drop",
          targetId: inserted!.id,
          reason: String(reason).trim(),
          newState: { title: inserted!.title, status: inserted!.status },
          requestId: req.id as string | undefined,
        });
      });

      req.log.info({ dropId: drop!.id, adminId: req.admin!.id }, "Admin created verified drop");
      res.status(201).json({ message: "Drop created.", drop });
    } catch (err) {
      req.log.error({ err }, "admin drop create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── PATCH /admin/drops/:id ────────────────────────────────────────────────────

type DropPatch = {
  updatedAt: Date;
  title?: string;
  description?: string;
  imageUrl?: string | null;
  deepLink?: string | null;
  eligibility?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  proOnly?: boolean;
  featured?: boolean;
};

dropsRouter.patch(
  "/admin/drops/:id",
  requireAdminPermission("drops:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const dropId = paramStr(req, "id");
    if (!dropId) {
      res.status(400).json({ message: "Missing drop id." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const { reason } = body;

    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    const allowed = [
      "title", "description", "imageUrl", "deepLink", "eligibility",
      "startsAt", "endsAt", "proOnly", "featured",
    ] as const;

    const patch: DropPatch = { updatedAt: new Date() };
    let hasChanges = false;
    for (const key of allowed) {
      if (key in body) {
        if ((key === "startsAt" || key === "endsAt") && body[key]) {
          (patch as Record<string, unknown>)[key] = new Date(String(body[key]));
        } else {
          (patch as Record<string, unknown>)[key] = body[key];
        }
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      res.status(400).json({ message: "No updatable fields provided." });
      return;
    }

    try {
      const [existing] = await db
        .select({ id: verifiedDropsTable.id, status: verifiedDropsTable.status })
        .from(verifiedDropsTable)
        .where(eq(verifiedDropsTable.id, dropId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Drop not found." });
        return;
      }

      await db.transaction(async (tx) => {
        await tx.update(verifiedDropsTable).set(patch).where(eq(verifiedDropsTable.id, dropId));

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "drop.edit",
          category: "drops",
          targetType: "drop",
          targetId: dropId,
          reason: String(reason).trim(),
          previousState: { status: existing.status },
          newState: Object.fromEntries(
            Object.entries(patch).filter(([k]) => k !== "updatedAt"),
          ),
          requestId: req.id as string | undefined,
        });
      });

      const [updated] = await db
        .select()
        .from(verifiedDropsTable)
        .where(eq(verifiedDropsTable.id, dropId))
        .limit(1);

      res.json({ message: "Drop updated.", drop: updated });
    } catch (err) {
      req.log.error({ err, dropId }, "admin drop patch failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/drops/:id/status ──────────────────────────────────────────────

dropsRouter.post(
  "/admin/drops/:id/status",
  requireAdminPermission("drops:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const dropId = paramStr(req, "id");
    const { status, reason, confirmation } = req.body as {
      status?: string;
      reason?: string;
      confirmation?: string;
    };

    if (!dropId) {
      res.status(400).json({ message: "Missing drop id." });
      return;
    }
    if (!VALID_DROP_STATUSES.includes(status as (typeof VALID_DROP_STATUSES)[number])) {
      res.status(400).json({
        message: `status must be one of: ${VALID_DROP_STATUSES.join(", ")}.`,
      });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }
    if (["published", "live"].includes(status!) && confirmation !== "CONFIRM") {
      res.status(400).json({
        message: `Confirm transition to ${status} by setting confirmation to CONFIRM.`,
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }

    try {
      // publish/live require owner + recent auth
      if (["published", "live"].includes(status!)) {
        if (req.admin!.role !== "owner") {
          res.status(403).json({
            message: "Owner access is required to publish or go live with a drop.",
            code: "OWNER_REQUIRED",
          });
          return;
        }
        if (!checkRecentAuth(req)) {
          res.status(403).json({
            message: "Confirm your password before publishing a drop.",
            code: "RECENT_AUTH_REQUIRED",
          });
          return;
        }
      }

      const result = await db.transaction(async (tx) => {
        const [drop] = await tx
          .select()
          .from(verifiedDropsTable)
          .where(eq(verifiedDropsTable.id, dropId))
          .for("update")
          .limit(1);

        if (!drop) return { kind: "not_found" as const };

        const allowed = DROP_TRANSITIONS[drop.status] ?? [];
        if (!allowed.includes(status!)) {
          return {
            kind: "invalid_transition" as const,
            fromStatus: drop.status,
            allowed,
          };
        }

        const now = new Date();
        const isPublish = status === "published";

        await tx
          .update(verifiedDropsTable)
          .set({
            status: status!,
            publishedByAdminId: isPublish ? req.admin!.id : drop.publishedByAdminId,
            publishedAt: isPublish && !drop.publishedAt ? now : drop.publishedAt,
            updatedAt: now,
          })
          .where(eq(verifiedDropsTable.id, dropId));

        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "drop",
          recordId: dropId,
          fromStatus: drop.status,
          toStatus: status!,
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: `drop.status.${status}`,
          category: "drops",
          severity: ["published", "live"].includes(status!) ? "high" : "info",
          targetType: "drop",
          targetId: dropId,
          reason: reason!.trim(),
          previousState: { status: drop.status },
          newState: { status },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const, fromStatus: drop.status };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Drop not found." });
        return;
      }
      if (result.kind === "invalid_transition") {
        res.status(400).json({
          message: `Cannot transition drop from ${result.fromStatus} to ${status}. Allowed: ${result.allowed.join(", ") || "none"}.`,
          code: "INVALID_TRANSITION",
        });
        return;
      }

      req.log.info({ dropId, status, adminId: req.admin!.id }, "Admin changed drop status");
      res.json({ message: "Drop status updated.", dropId, status });
    } catch (err) {
      req.log.error({ err, dropId }, "admin drop status failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
