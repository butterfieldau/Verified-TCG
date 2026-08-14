/**
 * Block and report routes — all require JWT auth.
 *
 *   POST   /api/collectors/:username/block   — block a collector
 *   DELETE /api/collectors/:username/block   — unblock a collector
 *   GET    /api/me/blocked-users             — list blocks
 *   POST   /api/collectors/:username/report  — report a collector
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, userBlocksTable, userReportsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const blockReportRouter = Router();

// ── POST /api/collectors/:username/block ──────────────────────────────────────

blockReportRouter.post(
  "/collectors/:username/block",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const blockerId = req.userId!;
    const username = String(req.params["username"] ?? "");

    try {
      const [target] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!target) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      if (target.id === blockerId) {
        res.status(400).json({ message: "Cannot block yourself" });
        return;
      }

      await db
        .insert(userBlocksTable)
        .values({ blockerUserId: blockerId, blockedUserId: target.id })
        .onConflictDoNothing();

      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("[block-report] POST /collectors/:username/block:", err);
      res.status(500).json({ message: "Failed to block collector" });
    }
  },
);

// ── DELETE /api/collectors/:username/block ────────────────────────────────────

blockReportRouter.delete(
  "/collectors/:username/block",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const blockerId = req.userId!;
    const username = String(req.params["username"] ?? "");

    try {
      const [target] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!target) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      await db
        .delete(userBlocksTable)
        .where(
          and(
            eq(userBlocksTable.blockerUserId, blockerId),
            eq(userBlocksTable.blockedUserId, target.id),
          ),
        );

      res.json({ ok: true });
    } catch (err) {
      console.error("[block-report] DELETE /collectors/:username/block:", err);
      res.status(500).json({ message: "Failed to unblock collector" });
    }
  },
);

// ── GET /api/me/blocked-users ─────────────────────────────────────────────────

blockReportRouter.get(
  "/me/blocked-users",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const blockerId = req.userId!;

    try {
      const rows = await db
        .select({
          blockedUserId: userBlocksTable.blockedUserId,
          username: usersTable.username,
          displayName: usersTable.displayName,
          avatarUrl: usersTable.avatarUrl,
          blockedAt: userBlocksTable.createdAt,
        })
        .from(userBlocksTable)
        .innerJoin(usersTable, eq(userBlocksTable.blockedUserId, usersTable.id))
        .where(eq(userBlocksTable.blockerUserId, blockerId))
        .orderBy(desc(userBlocksTable.createdAt));

      res.json({
        blocked: rows.map((r) => ({
          userId: r.blockedUserId,
          username: r.username,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl ?? null,
          blockedAt: r.blockedAt.toISOString(),
        })),
      });
    } catch (err) {
      console.error("[block-report] GET /me/blocked-users:", err);
      res.status(500).json({ message: "Failed to load blocked users" });
    }
  },
);

// ── POST /api/collectors/:username/report ─────────────────────────────────────

const VALID_REASONS = new Set([
  "spam",
  "harassment",
  "fraud",
  "inappropriate",
  "other",
]);

blockReportRouter.post(
  "/collectors/:username/report",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const reporterId = req.userId!;
    const username = String(req.params["username"] ?? "");
    const body = req.body as Record<string, unknown>;

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const note =
      typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;

    if (!reason || !VALID_REASONS.has(reason)) {
      res.status(400).json({
        message: `reason must be one of: ${[...VALID_REASONS].join(", ")}`,
      });
      return;
    }

    try {
      const [target] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!target) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      if (target.id === reporterId) {
        res.status(400).json({ message: "Cannot report yourself" });
        return;
      }

      await db.insert(userReportsTable).values({
        reporterUserId: reporterId,
        reportedUserId: target.id,
        reason,
        note: note || null,
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("[block-report] POST /collectors/:username/report:", err);
      res.status(500).json({ message: "Failed to submit report" });
    }
  },
);

export default blockReportRouter;
