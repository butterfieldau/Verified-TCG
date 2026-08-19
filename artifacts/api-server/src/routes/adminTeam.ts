import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { Router, type Response } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { adminAccountsTable, adminSessionsTable, db } from "@workspace/db";
import {
  type AdminRequest,
  requireAdminCsrf,
  requireAdminPermission,
  requireAdminSession,
  requireOwner,
  requireRecentAdminAuth,
  revokeAdminSessionById,
} from "../lib/adminSession";
import {
  isAdminPermission,
  isAdminRole,
  permissionsForRole,
  resolvePermissions,
} from "../lib/adminPermissions";
import {
  isAdminInvitationDeliveryConfigured,
  issueAdminInvitation,
} from "../lib/adminInvitation";

const router = Router();
router.use("/admin", requireAdminSession, requireAdminCsrf);

function safeAccount(account: typeof adminAccountsTable.$inferSelect) {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    permissions: resolvePermissions(account.role, account.permissions),
    status: account.status,
    lastLoginAt: account.lastLoginAt,
    lockedUntil: account.lockedUntil,
    invitationExpiresAt: account.invitationExpiresAt,
    invitationDeliveryStatus: account.invitationDeliveryStatus,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

router.get(
  "/admin/team",
  requireOwner,
  requireAdminPermission("team:read"),
  async (_req: AdminRequest, res: Response): Promise<void> => {
    const accounts = await db
      .select()
      .from(adminAccountsTable)
      .orderBy(desc(adminAccountsTable.createdAt));
    res.json({
      administrators: accounts.map(safeAccount),
      invitationDelivery: {
        configured: isAdminInvitationDeliveryConfigured(),
        message: isAdminInvitationDeliveryConfigured()
          ? "Invitation email delivery is configured."
          : "Invitation delivery is unavailable. Configure RESEND_API_KEY, ADMIN_INVITE_FROM_EMAIL, and ADMIN_APP_URL to send invitations.",
      },
    });
  },
);

router.post(
  "/admin/team/invitations",
  requireOwner,
  requireAdminPermission("team:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { email, displayName, role, permissions } = req.body as {
      email?: string;
      displayName?: string;
      role?: unknown;
      permissions?: unknown;
    };
    const normalizedEmail = email?.trim().toLowerCase() ?? "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      !displayName?.trim() ||
      !isAdminRole(role) ||
      role === "owner"
    ) {
      res.status(400).json({ message: "Provide a valid email, name, and non-owner role." });
      return;
    }

    const baseline = permissionsForRole(role);
    const requested = Array.isArray(permissions)
      ? permissions.filter(isAdminPermission)
      : baseline;
    if (requested.some((permission) => !baseline.includes(permission))) {
      res.status(400).json({ message: "A permission cannot exceed the selected role." });
      return;
    }

    const placeholderHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    let account: typeof adminAccountsTable.$inferSelect | undefined;
    try {
      [account] = await db
        .insert(adminAccountsTable)
        .values({
          email: normalizedEmail,
          displayName: displayName.trim(),
          passwordHash: placeholderHash,
          role,
          permissions: requested,
          status: "invited",
          createdByAdminId: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        res.status(409).json({ message: "An administrator with this email already exists." });
        return;
      }
      throw error;
    }

    const delivery = await issueAdminInvitation(account!.id, account!.email);
    const [updated] = await db
      .select()
      .from(adminAccountsTable)
      .where(eq(adminAccountsTable.id, account!.id))
      .limit(1);
    res.status(201).json({
      message:
        delivery === "sent"
          ? "Invitation sent."
          : delivery === "unavailable"
            ? "Administrator added, but invitation delivery is not configured."
            : "Administrator added, but invitation delivery failed.",
      delivery,
      administrator: safeAccount(updated!),
    });
  },
);

router.patch(
  "/admin/team/:adminId",
  requireOwner,
  requireAdminPermission("team:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const adminId = String(req.params["adminId"]);
    if (adminId === req.admin!.id) {
      res.status(400).json({ message: "Use another Owner to change your own access." });
      return;
    }
    const [target] = await db
      .select()
      .from(adminAccountsTable)
      .where(eq(adminAccountsTable.id, adminId))
      .limit(1);
    if (!target) {
      res.status(404).json({ message: "Administrator not found." });
      return;
    }
    if (target.role === "owner") {
      res.status(403).json({ message: "Owner authority cannot be delegated or changed here." });
      return;
    }

    const { role, status, permissions, displayName } = req.body as {
      role?: unknown;
      status?: unknown;
      permissions?: unknown;
      displayName?: unknown;
    };
    const nextRole = role === undefined ? target.role : role;
    if (!isAdminRole(nextRole) || nextRole === "owner") {
      res.status(400).json({ message: "Select a valid non-owner role." });
      return;
    }
    if (status !== undefined && status !== "active" && status !== "inactive") {
      res.status(400).json({ message: "Status must be active or inactive." });
      return;
    }
    const baseline = permissionsForRole(nextRole);
    const requested = Array.isArray(permissions)
      ? permissions.filter(isAdminPermission)
      : resolvePermissions(nextRole, target.permissions);
    if (requested.some((permission) => !baseline.includes(permission))) {
      res.status(400).json({ message: "A permission cannot exceed the selected role." });
      return;
    }

    const [updated] = await db
      .update(adminAccountsTable)
      .set({
        role: nextRole,
        status: typeof status === "string" ? status : target.status,
        displayName:
          typeof displayName === "string" && displayName.trim()
            ? displayName.trim()
            : target.displayName,
        permissions: requested,
        failedLoginCount: status === "active" ? 0 : target.failedLoginCount,
        lockedUntil: status === "active" ? null : target.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(adminAccountsTable.id, adminId))
      .returning();

    if (status === "inactive") {
      await db
        .update(adminSessionsTable)
        .set({ revokedAt: new Date() })
        .where(and(eq(adminSessionsTable.adminId, adminId), isNull(adminSessionsTable.revokedAt)));
    }
    res.json({ message: "Administrator access updated.", administrator: safeAccount(updated!) });
  },
);

router.post(
  "/admin/team/:adminId/reset-access",
  requireOwner,
  requireAdminPermission("team:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const adminId = String(req.params["adminId"]);
    if (adminId === req.admin!.id) {
      res.status(400).json({ message: "You cannot reset your own access from this screen." });
      return;
    }
    const [target] = await db
      .select()
      .from(adminAccountsTable)
      .where(eq(adminAccountsTable.id, adminId))
      .limit(1);
    if (!target || target.role === "owner") {
      res.status(404).json({ message: "Administrator not found." });
      return;
    }
    await db
      .update(adminSessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessionsTable.adminId, adminId), isNull(adminSessionsTable.revokedAt)));
    await db
      .update(adminAccountsTable)
      .set({
        status: "invited",
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(adminAccountsTable.id, adminId));
    const delivery = await issueAdminInvitation(adminId, target.email);
    res.json({
      message:
        delivery === "sent"
          ? "Access reset and a new invitation was sent."
          : delivery === "unavailable"
            ? "Access reset, but invitation delivery is not configured."
            : "Access reset, but invitation delivery failed.",
      delivery,
    });
  },
);

router.get(
  "/admin/sessions",
  requireOwner,
  requireAdminPermission("sessions:read"),
  async (req: AdminRequest, res: Response): Promise<void> => {
    const rows = await db
      .select({
        session: adminSessionsTable,
        account: {
          id: adminAccountsTable.id,
          email: adminAccountsTable.email,
          displayName: adminAccountsTable.displayName,
          role: adminAccountsTable.role,
        },
      })
      .from(adminSessionsTable)
      .innerJoin(adminAccountsTable, eq(adminSessionsTable.adminId, adminAccountsTable.id))
      .where(
        and(
          isNull(adminSessionsTable.revokedAt),
          eq(adminAccountsTable.status, "active"),
          gt(adminSessionsTable.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(adminSessionsTable.lastActivityAt));
    res.json({
      sessions: rows.map(({ session, account }) => ({
        id: session.id,
        administrator: account,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        expiresAt: session.expiresAt,
        deviceFingerprint: session.userAgentHash.slice(0, 10),
        networkFingerprint: session.ipHash.slice(0, 10),
        current: session.id === req.adminSession!.id,
      })),
    });
  },
);

router.delete(
  "/admin/sessions/:sessionId",
  requireOwner,
  requireAdminPermission("sessions:revoke"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const sessionId = String(req.params["sessionId"]);
    if (sessionId === req.adminSession!.id) {
      res.status(400).json({ message: "Sign out to end your current session." });
      return;
    }
    await revokeAdminSessionById(sessionId);
    res.json({ message: "Session revoked." });
  },
);

export default router;