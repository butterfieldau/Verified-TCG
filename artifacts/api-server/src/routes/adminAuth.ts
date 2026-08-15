/**
 * Admin authentication routes.
 *
 * POST /api/admin/auth/login  — verify ADMIN_SECRET, issue HttpOnly session cookie
 * POST /api/admin/auth/logout — revoke session, clear cookie
 * GET  /api/admin/auth/me     — return 200 if session valid, 401 otherwise
 */

import { Router, type Request, type Response } from "express";
import {
  createSession,
  revokeSession,
  requireAdminSession,
  sessionCookieOptions,
  COOKIE_NAME,
} from "../lib/adminSession";

const router = Router();
const ADMIN_SECRET = process.env.ADMIN_SECRET;

// ── POST /api/admin/auth/login ────────────────────────────────────────────────

router.post("/admin/auth/login", (req: Request, res: Response) => {
  if (!ADMIN_SECRET) {
    res
      .status(503)
      .json({ message: "Admin access is not configured on this server." });
    return;
  }

  const { secret } = req.body as { secret?: string };

  if (!secret || secret !== ADMIN_SECRET) {
    res.status(403).json({ message: "Invalid admin secret." });
    return;
  }

  const ip = (req.ip ?? req.socket?.remoteAddress ?? "unknown").replace(
    /^::ffff:/,
    "",
  );
  const token = createSession(ip);

  res.cookie(COOKIE_NAME, token, sessionCookieOptions);
  res.json({ message: "Authenticated successfully." });
});

// ── POST /api/admin/auth/logout ───────────────────────────────────────────────

router.post("/admin/auth/logout", requireAdminSession, (req: Request, res: Response) => {
  const token: string | undefined = req.cookies?.[COOKIE_NAME];
  if (token) revokeSession(token);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ message: "Logged out." });
});

// ── GET /api/admin/auth/me ────────────────────────────────────────────────────

router.get("/admin/auth/me", requireAdminSession, (_req: Request, res: Response) => {
  res.json({ authenticated: true, role: "owner" });
});

export default router;
