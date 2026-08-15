/**
 * In-memory admin session store.
 *
 * Sessions are keyed by a crypto-random UUID token that is stored in an
 * HttpOnly cookie.  No credentials are ever sent to the browser beyond the
 * opaque session ID.
 *
 * Tokens expire after SESSION_TTL_MS (default 8 h).  A background sweep runs
 * every 30 minutes to evict expired entries so the map cannot grow unbounded.
 *
 * Note: this is per-process storage.  A server restart invalidates all
 * sessions — operators must log in again.  This is acceptable for a single-
 * instance admin tool; a persistent DB table can be added later (see task #264).
 */

import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const COOKIE_NAME = "vtcg_admin_session";

interface Session {
  createdAt: Date;
  expiresAt: Date;
  ip: string;
}

const sessions = new Map<string, Session>();

// ── Sweep expired sessions every 30 minutes ───────────────────────────────────
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt.getTime() < now) sessions.delete(token);
  }
}, 30 * 60 * 1000);
sweep.unref(); // don't block process exit

// ── Session lifecycle ─────────────────────────────────────────────────────────

/** Create a new session and return the opaque token. */
export function createSession(ip: string): string {
  const token = randomUUID();
  const now = new Date();
  sessions.set(token, {
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    ip,
  });
  return token;
}

/** Validate a token; returns the session or null if expired/unknown. */
export function validateSession(token: string): Session | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

/** Revoke a session immediately (logout). */
export function revokeSession(token: string): void {
  sessions.delete(token);
}

// ── Cookie options ────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === "production";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "strict" as const,
  maxAge: SESSION_TTL_MS,
  path: "/",
};

export { COOKIE_NAME };

// ── Express middleware ────────────────────────────────────────────────────────

/** Require a valid admin session cookie.  Returns 401 if missing or expired. */
export function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token: string | undefined = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ message: "Not authenticated. Please log in." });
    return;
  }
  const session = validateSession(token);
  if (!session) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.status(401).json({ message: "Session expired. Please log in again." });
    return;
  }
  next();
}
