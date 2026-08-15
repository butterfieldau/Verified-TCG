/**
 * Subscription routes
 *
 * POST /api/subscription/upgrade  — set the authenticated user's tier to 'pro' (dev only).
 * POST /api/subscription/restore  — re-fetch the user's stored tier from the DB and return it.
 *
 * The restore endpoint satisfies Apple / Google's "Restore Purchases" requirement.
 * It re-checks the database so whatever tier was last set (by a future IAP webhook)
 * is returned without the client having to re-authenticate.
 *
 * Note: real Apple IAP receipt validation / Google Play purchase verification
 * is out of scope for the MVP.  The restore endpoint is the required UI affordance.
 */

import { Router } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET must be set");

// ── POST /api/subscription/upgrade ───────────────────────────────────────────

router.post("/subscription/upgrade", async (req, res) => {
  // Double guard: reject in production unconditionally, and also reject unless
  // ENABLE_DEV_UPGRADE=true is explicitly set in the local environment.
  // This prevents self-escalation in any shared, staging, or production deployment
  // even if the env template is copied without clearing the flag.
  const isProduction = process.env.NODE_ENV === "production";
  const devUpgradeEnabled = process.env.ENABLE_DEV_UPGRADE === "true";
  if (isProduction || !devUpgradeEnabled) {
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

// ── POST /api/subscription/restore ───────────────────────────────────────────
// Re-reads the authenticated user's current subscription_tier from the DB
// and returns it.  This is the server-side half of the "Restore Purchases"
// button required by Apple App Store Review Guidelines §3.1.1.
//
// When real IAP receipt validation is added, the receipt should be validated
// here before the tier is returned.

router.post("/subscription/restore", requireActiveUser, async (req: AuthRequest, res) => {
  try {
    const [user] = await db
      .select({
        subscriptionTier: usersTable.subscriptionTier,
        isFoundingMember: usersTable.isFoundingMember,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasPro = user.subscriptionTier === "pro";

    return res.json({
      subscription_tier: user.subscriptionTier,
      is_founding_member: user.isFoundingMember,
      restored: hasPro,
      message: hasPro
        ? "Your Pro subscription has been restored."
        : "No active Pro subscription found on this account.",
    });
  } catch {
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
