/**
 * Subscription routes
 *
 * POST /api/subscription/upgrade — set the authenticated user's tier to 'pro'.
 *
 * Development / staging only.  In production, this route returns 501 so
 * that no client can self-escalate to Pro without going through a real
 * payment flow.  When real billing is integrated (Apple IAP, Google Play
 * Billing, Stripe webhook) that handler should call the same DB update and
 * be reachable in production.
 *
 * To enable in development, NODE_ENV must be 'development' (the default
 * when running `pnpm dev`).
 */

import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET must be set");

// ── POST /api/subscription/upgrade ───────────────────────────────────────────

router.post("/subscription/upgrade", async (req, res) => {
  // Guard: refuse in production — real billing integration required.
  if (process.env.NODE_ENV === "production") {
    return res.status(501).json({
      message:
        "Payment processing is not yet configured. " +
        "Please connect a billing provider to enable Pro upgrades.",
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization header required" });
  }

  let payload: { sub: string };
  try {
    payload = jwt.verify(authHeader.slice(7), JWT_SECRET as string) as { sub: string };
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  const [updated] = await db
    .update(usersTable)
    .set({ subscriptionTier: "pro", updatedAt: new Date() })
    .where(eq(usersTable.id, payload.sub))
    .returning({
      subscriptionTier: usersTable.subscriptionTier,
      isFoundingMember: usersTable.isFoundingMember,
    });

  if (!updated) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({
    subscription_tier: updated.subscriptionTier,
    is_founding_member: updated.isFoundingMember,
  });
});

export default router;
