import { createHash, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { adminAccountsTable, adminSessionsTable, db } from "@workspace/db";
import {
  type AdminRequest,
  clearAdminSessionCookies,
  COOKIE_NAME,
  createAdminSession,
  hashAdminToken,
  markRecentAdminAuth,
  requireAdminCsrf,
  requireAdminSession,
  revokeAdminSession,
  setAdminSessionCookies,
} from "../lib/adminSession";
import { permissionsForRole, resolvePermissions } from "../lib/adminPermissions";
import { recordTelemetry } from "../lib/telemetry";

const router = Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const LOCK_AFTER_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH =
  "$2b$12$2v1rWg7S4C3ePOkD22SG7uvgKE4bwoV5UAEF53BkTMz7b3Bu7hcKq";

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  message: { message: "Too many sign-in attempts. Try again later." },
});

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeSecretMatches(supplied: string): boolean {
  if (!ADMIN_SECRET) return false;
  const actual = createHash("sha256").update(supplied).digest();
  const expected = createHash("sha256").update(ADMIN_SECRET).digest();
  return timingSafeEqual(actual, expected);
}

function setAuthenticatedResponse(
  res: Response,
  session: { token: string; csrfToken: string },
): void {
  setAdminSessionCookies(res, session);
  res.json({ message: "Authenticated successfully." });
}

router.get("/admin/auth/bootstrap-status", async (_req: Request, res: Response): Promise<void> => {
  const [row] = await db.select({ count: count() }).from(adminAccountsTable);
  res.json({ bootstrapRequired: Number(row?.count ?? 0) === 0 });
});

/**
 * One-time migration path for the current owner. ADMIN_SECRET is accepted only
 * while no durable administrator exists, and is never stored by the browser.
 */
router.post(
  "/admin/auth/bootstrap",
  adminLoginLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { secret, email, password, displayName } = req.body as {
      secret?: string;
      email?: string;
      password?: string;
      displayName?: string;
    };
    const normalizedEmail = normalizeEmail(email ?? "");
    if (
      !secret ||
      !isEmail(normalizedEmail) ||
      typeof password !== "string" ||
      password.length < 12 ||
      typeof displayName !== "string" ||
      displayName.trim().length < 2
    ) {
      res.status(400).json({
        message: "Provide the current owner secret, a valid email, a display name, and a password of at least 12 characters.",
      });
      return;
    }
    if (!safeSecretMatches(secret)) {
      res.status(403).json({ message: "Owner setup could not be completed." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let ownerId: string | null = null;
    try {
      await db.transaction(async (tx) => {
        await tx.execute("SELECT pg_advisory_xact_lock(86197284)");
        const [existing] = await tx.select({ count: count() }).from(adminAccountsTable);
        if (Number(existing?.count ?? 0) > 0) {
          throw new Error("BOOTSTRAP_COMPLETE");
        }
        const [owner] = await tx
          .insert(adminAccountsTable)
          .values({
            email: normalizedEmail,
            displayName: displayName.trim(),
            passwordHash,
            role: "owner",
            permissions: permissionsForRole("owner"),
            status: "active",
            invitationDeliveryStatus: "not_requested",
          })
          .returning({ id: adminAccountsTable.id });
        ownerId = owner?.id ?? null;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "BOOTSTRAP_COMPLETE") {
        res.status(409).json({ message: "Owner setup has already been completed." });
        return;
      }
      throw error;
    }

    if (!ownerId) {
      res.status(500).json({ message: "Owner setup could not be completed." });
      return;
    }
    const session = await createAdminSession(ownerId, req);
    setAuthenticatedResponse(res, session);
  },
);

router.post(
  "/admin/auth/login",
  adminLoginLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body as { email?: string; password?: string };
    const normalizedEmail = normalizeEmail(email ?? "");
    const [account] = normalizedEmail
      ? await db
          .select()
          .from(adminAccountsTable)
          .where(eq(adminAccountsTable.email, normalizedEmail))
          .limit(1)
      : [];

    const now = new Date();
    const locked = Boolean(account?.lockedUntil && account.lockedUntil > now);
    const validPassword = await bcrypt.compare(
      password ?? "",
      account?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!account || !validPassword || account.status !== "active" || locked) {
      if (account && !locked) {
        const willBeLocked = (account.failedLoginCount + 1) >= LOCK_AFTER_FAILURES;
        const lockUntil = new Date(now.getTime() + LOCK_DURATION_MS);
        await db.execute(sql`
          UPDATE admin_accounts
          SET
            failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= ${LOCK_AFTER_FAILURES}
                THEN ${lockUntil}
              ELSE locked_until
            END,
            updated_at = ${now}
          WHERE id = ${account.id}
            AND (locked_until IS NULL OR locked_until <= ${now})
        `);
        // Record security event for failure/lockout (no password/email/IP stored)
        void recordTelemetry({
          category: "security",
          action: willBeLocked ? "admin.login.lockout" : "admin.login.failure",
          adminId: account.id,
          status: "failed",
          metadata: { role: account.role },
        });
      } else if (locked) {
        void recordTelemetry({
          category: "security",
          action: "admin.login.locked_attempt",
          adminId: account?.id,
          status: "failed",
        });
      }
      res.status(401).json({ message: "Email or password is incorrect." });
      return;
    }

    await db
      .update(adminAccountsTable)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(adminAccountsTable.id, account.id));
    const session = await createAdminSession(account.id, req);

    // Record successful login security event
    void recordTelemetry({
      category: "security",
      action: "admin.login.success",
      adminId: account.id,
      status: "ok",
      metadata: { role: account.role },
    });

    setAuthenticatedResponse(res, session);
  },
);

router.post(
  "/admin/auth/activate",
  adminLoginLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { token, password, displayName } = req.body as {
      token?: string;
      password?: string;
      displayName?: string;
    };
    if (!token || typeof password !== "string" || password.length < 12) {
      res.status(400).json({ message: "A valid invitation and a password of at least 12 characters are required." });
      return;
    }
    const [account] = await db
      .select()
      .from(adminAccountsTable)
      .where(
        and(
          eq(adminAccountsTable.invitationTokenHash, hashAdminToken(token)),
          eq(adminAccountsTable.status, "invited"),
          gt(adminAccountsTable.invitationExpiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!account) {
      res.status(400).json({ message: "This invitation is invalid or has expired." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [activated] = await db
      .update(adminAccountsTable)
      .set({
        passwordHash,
        displayName:
          typeof displayName === "string" && displayName.trim().length >= 2
            ? displayName.trim()
            : account.displayName,
        status: "active",
        invitationTokenHash: null,
        invitationExpiresAt: null,
        invitationDeliveryStatus: "accepted",
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adminAccountsTable.id, account.id),
          eq(adminAccountsTable.invitationTokenHash, hashAdminToken(token)),
          eq(adminAccountsTable.status, "invited"),
          gt(adminAccountsTable.invitationExpiresAt, new Date()),
        ),
      )
      .returning({ id: adminAccountsTable.id });
    if (!activated) {
      res.status(400).json({ message: "This invitation is invalid or has expired." });
      return;
    }
    const session = await createAdminSession(activated.id, req);
    setAuthenticatedResponse(res, session);
  },
);

router.post(
  "/admin/auth/logout",
  requireAdminSession,
  requireAdminCsrf,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const token: string | undefined = req.cookies?.[COOKIE_NAME];
    if (token) await revokeAdminSession(token);
    clearAdminSessionCookies(res);
    res.json({ message: "Signed out." });
  },
);

router.post(
  "/admin/auth/reauth",
  requireAdminSession,
  requireAdminCsrf,
  async (req: AdminRequest, res: Response): Promise<void> => {
    const { password } = req.body as { password?: string };
    const [account] = await db
      .select({ passwordHash: adminAccountsTable.passwordHash })
      .from(adminAccountsTable)
      .where(eq(adminAccountsTable.id, req.admin!.id))
      .limit(1);
    const valid = account ? await bcrypt.compare(password ?? "", account.passwordHash) : false;
    if (!valid) {
      void recordTelemetry({
        category: "security",
        action: "admin.reauth.failure",
        adminId: req.admin!.id,
        status: "failed",
      });
      res.status(403).json({ message: "Password is incorrect.", code: "REAUTH_FAILED" });
      return;
    }
    await markRecentAdminAuth(req.adminSession!.id);
    void recordTelemetry({
      category: "security",
      action: "admin.reauth.success",
      adminId: req.admin!.id,
      status: "ok",
    });
    res.json({ message: "Sensitive access confirmed for 10 minutes." });
  },
);

router.get(
  "/admin/auth/me",
  requireAdminSession,
  (req: AdminRequest, res: Response): void => {
    res.json({
      authenticated: true,
      admin: req.admin,
      permissions: resolvePermissions(req.admin!.role, req.admin!.permissions),
    });
  },
);

export default router;