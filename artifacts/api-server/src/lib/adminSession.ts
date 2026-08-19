import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { adminAccountsTable, adminSessionsTable, db } from "@workspace/db";
import {
  type AdminPermission,
  type AdminRole,
  resolvePermissions,
} from "./adminPermissions";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IDLE_TTL_MS = 30 * 60 * 1000;
const RECENT_AUTH_TTL_MS = 10 * 60 * 1000;
export const COOKIE_NAME = "vtcg_admin_session";
export const CSRF_COOKIE_NAME = "vtcg_admin_csrf";

const isProd = process.env.NODE_ENV === "production";
export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "strict" as const,
  maxAge: SESSION_TTL_MS,
  path: "/",
};
export const csrfCookieOptions = {
  httpOnly: false,
  secure: isProd,
  sameSite: "strict" as const,
  maxAge: SESSION_TTL_MS,
  path: "/",
};

export interface AdminRequest extends Request {
  admin?: {
    id: string;
    email: string;
    displayName: string;
    role: AdminRole;
    permissions: AdminPermission[];
  };
  adminSession?: {
    id: string;
    csrfTokenHash: string;
    recentAuthAt: Date;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function metadata(req: Request): { ipHash: string; userAgentHash: string } {
  const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  const metadataKey = process.env.SESSION_SECRET ?? "development-metadata-key";
  const fingerprint = (value: string) =>
    createHmac("sha256", metadataKey).update(value).digest("hex");
  return {
    ipHash: fingerprint(`ip:${ip}`),
    userAgentHash: fingerprint(`ua:${req.get("user-agent") ?? "unknown"}`),
  };
}

function matchesHash(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createAdminSession(
  adminId: string,
  req: Request,
): Promise<{ token: string; csrfToken: string }> {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const { ipHash, userAgentHash } = metadata(req);
  await db.insert(adminSessionsTable).values({
    adminId,
    tokenHash: sha256(token),
    csrfTokenHash: sha256(csrfToken),
    ipHash,
    userAgentHash,
    createdAt: now,
    lastActivityAt: now,
    recentAuthAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  });
  return { token, csrfToken };
}

export function setAdminSessionCookies(
  res: Response,
  session: { token: string; csrfToken: string },
): void {
  res.cookie(COOKIE_NAME, session.token, sessionCookieOptions);
  res.cookie(CSRF_COOKIE_NAME, session.csrfToken, csrfCookieOptions);
}

export function clearAdminSessionCookies(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
}

export async function revokeAdminSession(token: string): Promise<void> {
  await db
    .update(adminSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(adminSessionsTable.tokenHash, sha256(token)));
}

export async function revokeAdminSessionById(sessionId: string): Promise<void> {
  await db
    .update(adminSessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(adminSessionsTable.id, sessionId));
}

export function requireAdminSession(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
    const token: string | undefined = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ message: "Not authenticated. Please sign in." });
      return;
    }

    const now = new Date();
    const [row] = await db
      .select({
        session: adminSessionsTable,
        account: adminAccountsTable,
      })
      .from(adminSessionsTable)
      .innerJoin(adminAccountsTable, eq(adminSessionsTable.adminId, adminAccountsTable.id))
      .where(
        and(
          eq(adminSessionsTable.tokenHash, sha256(token)),
          isNull(adminSessionsTable.revokedAt),
          gt(adminSessionsTable.expiresAt, now),
        ),
      )
      .limit(1);

    const idleExpired =
      !row || now.getTime() - row.session.lastActivityAt.getTime() > IDLE_TTL_MS;
    if (!row || idleExpired || row.account.status !== "active") {
      if (row && idleExpired) {
        await db
          .update(adminSessionsTable)
          .set({ revokedAt: now })
          .where(eq(adminSessionsTable.id, row.session.id));
      }
      clearAdminSessionCookies(res);
      res.status(401).json({ message: "Session expired. Please sign in again." });
      return;
    }

    const role = row.account.role as AdminRole;
    req.admin = {
      id: row.account.id,
      email: row.account.email,
      displayName: row.account.displayName,
      role,
      permissions: resolvePermissions(role, row.account.permissions),
    };
    req.adminSession = {
      id: row.session.id,
      csrfTokenHash: row.session.csrfTokenHash,
      recentAuthAt: row.session.recentAuthAt,
    };
    await db
      .update(adminSessionsTable)
      .set({ lastActivityAt: now })
      .where(eq(adminSessionsTable.id, row.session.id));
    next();
  })().catch(next);
}

/** Checks the double-submit CSRF token for every state-changing admin request. */
export function requireAdminCsrf(req: AdminRequest, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const supplied = req.get("x-csrf-token");
  if (!supplied || !req.adminSession || !matchesHash(supplied, req.adminSession.csrfTokenHash)) {
    res.status(403).json({ message: "Invalid security token. Refresh and try again.", code: "CSRF_INVALID" });
    return;
  }
  next();
}

export function requireAdminPermission(permission: AdminPermission) {
  return (req: AdminRequest, res: Response, next: NextFunction): void => {
    if (!req.admin?.permissions.includes(permission)) {
      res.status(403).json({ message: "You do not have permission for this action.", code: "PERMISSION_DENIED" });
      return;
    }
    next();
  };
}

export function requireOwner(req: AdminRequest, res: Response, next: NextFunction): void {
  if (req.admin?.role !== "owner") {
    res.status(403).json({ message: "Owner access is required.", code: "OWNER_REQUIRED" });
    return;
  }
  next();
}

export function requireRecentAdminAuth(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
): void {
  const recentAuthAt = req.adminSession?.recentAuthAt;
  if (!recentAuthAt || Date.now() - recentAuthAt.getTime() > RECENT_AUTH_TTL_MS) {
    res.status(403).json({
      message: "Confirm your password before this sensitive action.",
      code: "RECENT_AUTH_REQUIRED",
    });
    return;
  }
  next();
}

export async function markRecentAdminAuth(sessionId: string): Promise<void> {
  await db
    .update(adminSessionsTable)
    .set({ recentAuthAt: new Date(), lastActivityAt: new Date() })
    .where(eq(adminSessionsTable.id, sessionId));
}

export function hashAdminToken(value: string): string {
  return sha256(value);
}

export function createInvitationToken(): string {
  return randomToken();
}