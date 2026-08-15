/**
 * Admin routes — internal operator panel only.
 *
 * All endpoints require the `x-admin-secret` header matching the
 * `ADMIN_SECRET` environment variable.  Never expose these routes to
 * end-users or include the secret in client code.
 *
 * GET  /api/admin/users?email=...        — look up a user by email
 * POST /api/admin/users/:id/subscription — set subscription_tier / is_founding_member
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";

const router = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// ── Admin-secret middleware ───────────────────────────────────────────────────

function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_SECRET) {
    res.status(503).json({
      message: "Admin access is not configured on this server (ADMIN_SECRET not set).",
    });
    return;
  }

  const provided = req.headers["x-admin-secret"];
  if (!provided || provided !== ADMIN_SECRET) {
    res.status(403).json({ message: "Forbidden: invalid or missing admin secret." });
    return;
  }

  next();
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// Query param: ?email=user@example.com  (exact or partial match, case-insensitive)
// Returns a list of matching users (id, email, displayName, subscriptionTier, isFoundingMember).

router.get("/admin/users", requireAdminSecret, async (req: Request, res: Response) => {
  const { email } = req.query;

  if (!email || typeof email !== "string" || email.trim().length === 0) {
    return res.status(400).json({ message: "Query param `email` is required." });
  }

  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
        username: usersTable.username,
        subscriptionTier: usersTable.subscriptionTier,
        isFoundingMember: usersTable.isFoundingMember,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(ilike(usersTable.email, `%${email.trim()}%`))
      .limit(20);

    return res.json({ users });
  } catch (err) {
    console.error("[admin] GET /admin/users error:", err);
    return res.status(500).json({ message: "Database error. Please try again." });
  }
});

// ── POST /api/admin/users/:id/subscription ────────────────────────────────────
// Body: { subscription_tier?: "free" | "pro", is_founding_member?: boolean }
// Updates the user's subscription tier and/or founding member status.

router.post(
  "/admin/users/:id/subscription",
  requireAdminSecret,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { subscription_tier, is_founding_member } = req.body as {
      subscription_tier?: string;
      is_founding_member?: boolean;
    };

    // Validate at least one field is being changed
    if (subscription_tier === undefined && is_founding_member === undefined) {
      return res
        .status(400)
        .json({ message: "Provide at least one of `subscription_tier` or `is_founding_member`." });
    }

    // Validate subscription_tier value
    const VALID_TIERS = ["free", "pro"];
    if (subscription_tier !== undefined && !VALID_TIERS.includes(subscription_tier)) {
      return res.status(400).json({
        message: `Invalid subscription_tier. Must be one of: ${VALID_TIERS.join(", ")}.`,
      });
    }

    // Validate is_founding_member type
    if (is_founding_member !== undefined && typeof is_founding_member !== "boolean") {
      return res
        .status(400)
        .json({ message: "`is_founding_member` must be a boolean." });
    }

    // Build update patch (only the fields provided)
    const patch: Partial<{
      subscriptionTier: string;
      isFoundingMember: boolean;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (subscription_tier !== undefined) patch.subscriptionTier = subscription_tier;
    if (is_founding_member !== undefined) patch.isFoundingMember = is_founding_member;

    try {
      const [updated] = await db
        .update(usersTable)
        .set(patch)
        .where(eq(usersTable.id, id))
        .returning({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
          subscriptionTier: usersTable.subscriptionTier,
          isFoundingMember: usersTable.isFoundingMember,
        });

      if (!updated) {
        return res.status(404).json({ message: "User not found." });
      }

      console.log(
        `[admin] Subscription updated for user ${updated.id} (${updated.email}):`,
        patch,
      );

      return res.json({
        message: "User subscription updated successfully.",
        user: updated,
      });
    } catch (err) {
      console.error("[admin] POST /admin/users/:id/subscription error:", err);
      return res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

export default router;
