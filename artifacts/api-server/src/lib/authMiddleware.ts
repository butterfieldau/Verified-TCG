/**
 * Shared JWT + active-user middleware.
 *
 * Verifies the Bearer token AND confirms the user still exists in the database.
 * This means that when an account is deleted, any still-valid (up to 15-min)
 * access token is rejected immediately on the next request — the DB row is the
 * source of truth, not the token alone.
 *
 * Usage:
 *   router.get("/protected", requireActiveUser, async (req: AuthRequest, res) => {
 *     const userId = req.userId!;  // always present after this middleware
 *     ...
 *   });
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET must be set");

export interface AuthRequest extends Request {
  userId?: string;
  subscriptionTier?: string;
}

/**
 * Express middleware that:
 * 1. Extracts and verifies the Bearer JWT.
 * 2. Confirms the user (`sub` claim) still exists in the `users` table.
 * 3. Attaches `req.userId` for downstream handlers.
 *
 * Returns 401 if the token is missing/invalid, or if the user no longer exists.
 */
export async function requireActiveUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authorization header required" });
    return;
  }

  let sub: string;
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET as string) as { sub: string };
    sub = payload.sub;
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  // Confirm user still exists — rejects tokens for deleted accounts regardless
  // of the token's remaining TTL, and survives server restarts.
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, sub))
    .limit(1);

  if (!user) {
    res.status(401).json({ message: "Account not found or has been deleted" });
    return;
  }

  req.userId = sub;
  next();
}

/**
 * Express middleware that extends `requireActiveUser` by also verifying that
 * the authenticated user holds a Pro subscription tier.
 *
 * Performs a single DB query to confirm both that the account exists and that
 * `subscription_tier` is 'pro' — so routes only need this one middleware
 * instead of chaining `requireActiveUser` before it.
 *
 * Returns:
 *   401  — token missing / invalid / account deleted
 *   403  — account exists but subscription_tier is not 'pro'
 */
export async function requireProUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authorization header required" });
    return;
  }

  let sub: string;
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET as string) as { sub: string };
    sub = payload.sub;
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, subscriptionTier: usersTable.subscriptionTier })
    .from(usersTable)
    .where(eq(usersTable.id, sub))
    .limit(1);

  if (!user) {
    res.status(401).json({ message: "Account not found or has been deleted" });
    return;
  }

  if (user.subscriptionTier !== "pro") {
    res.status(403).json({ message: "Pro subscription required", code: "PRO_REQUIRED" });
    return;
  }

  req.userId = sub;
  req.subscriptionTier = user.subscriptionTier;
  next();
}
