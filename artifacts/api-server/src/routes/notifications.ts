/**
 * Notifications routes — per-user, JWT-authenticated.
 *
 * Endpoints:
 *   GET  /api/notifications                   paginated list, newest first
 *   GET  /api/notifications/count             unread count
 *   PATCH /api/notifications/:id/read         mark one as read
 *   POST  /api/notifications/read-all         mark all as read
 *   POST  /api/notifications/register-push-token  register Expo push token
 */

import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { db } from "@workspace/db";
import { notificationsTable, pushTokensTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";

const notificationsRouter = Router();

// ── GET /api/notifications ────────────────────────────────────────────────────

notificationsRouter.get(
  "/api/notifications",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10)));
    const offset = (page - 1) * limit;

    try {
      const rows = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, userId))
        .orderBy(desc(notificationsTable.createdAt))
        .limit(limit)
        .offset(offset);

      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, userId));

      const total = Number(totalResult[0]?.count ?? 0);

      res.json({
        notifications: rows.map(rowToClient),
        page,
        limit,
        total,
        hasMore: offset + rows.length < total,
      });
    } catch (err) {
      console.error("[notifications] GET /api/notifications:", err);
      res.status(500).json({ message: "Failed to load notifications" });
    }
  },
);

// ── GET /api/notifications/count ──────────────────────────────────────────────

notificationsRouter.get(
  "/api/notifications/count",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    try {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.isRead, false),
          ),
        );

      res.json({ unreadCount: Number(result[0]?.count ?? 0) });
    } catch (err) {
      console.error("[notifications] GET /api/notifications/count:", err);
      res.status(500).json({ message: "Failed to count notifications" });
    }
  },
);

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────

notificationsRouter.patch(
  "/api/notifications/:id/read",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const id = String(req.params["id"]);

    try {
      const [updated] = await db
        .update(notificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(notificationsTable.id, id),
            eq(notificationsTable.userId, userId),
          ),
        )
        .returning({ id: notificationsTable.id });

      if (!updated) {
        res.status(404).json({ message: "Notification not found" });
        return;
      }

      res.json({ ok: true, id: updated.id });
    } catch (err) {
      console.error("[notifications] PATCH /api/notifications/:id/read:", err);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  },
);

// ── POST /api/notifications/read-all ─────────────────────────────────────────

notificationsRouter.post(
  "/api/notifications/read-all",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    try {
      await db
        .update(notificationsTable)
        .set({ isRead: true })
        .where(
          and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.isRead, false),
          ),
        );

      res.json({ ok: true });
    } catch (err) {
      console.error("[notifications] POST /api/notifications/read-all:", err);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  },
);

// ── POST /api/notifications/register-push-token ───────────────────────────────

notificationsRouter.post(
  "/api/notifications/register-push-token",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const { token } = req.body as { token?: string };

    if (!token || typeof token !== "string" || token.trim() === "") {
      res.status(400).json({ message: "token is required" });
      return;
    }

    try {
      await db
        .insert(pushTokensTable)
        .values({ userId, token: token.trim() })
        .onConflictDoUpdate({
          target: pushTokensTable.token,
          set: { userId, updatedAt: new Date() },
        });

      res.json({ ok: true });
    } catch (err) {
      console.error("[notifications] POST /api/notifications/register-push-token:", err);
      res.status(500).json({ message: "Failed to register push token" });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToClient(row: typeof notificationsTable.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: row.metadata ?? {},
    isRead: row.isRead,
    createdAt: row.createdAt,
  };
}

export default notificationsRouter;

// ── Internal helper — insert a notification for a user ────────────────────────
// Called from other routes (e.g. price-alert checker) to create notifications.

export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(notificationsTable).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    metadata: params.metadata ?? {},
  });
}
