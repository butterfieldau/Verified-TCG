import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Resend } from "resend";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import { clearUserWishlists } from "./wishlist.js";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { authSignLimiter, authRecoverLimiter } from "../lib/rateLimiters.js";
import { recordTelemetry } from "../lib/telemetry.js";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET must be set");

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

// ── Avatar upload directory ───────────────────────────────────────────────────

const AVATAR_DIR = path.join(process.cwd(), "uploads", "avatars");
try { fs.mkdirSync(AVATAR_DIR, { recursive: true }); } catch { /* already exists */ }

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAccessToken(userId: string, email: string, displayName: string): string {
  return jwt.sign(
    { sub: userId, email, display_name: displayName },
    JWT_SECRET as string,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
}

function makeRefreshToken(): string {
  return crypto.randomBytes(64).toString("hex");
}

function refreshTokenExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return d;
}

type UserRow = typeof usersTable.$inferSelect;

function userToMetadata(user: UserRow) {
  return {
    display_name: user.displayName,
    username: user.username,
    bio: user.bio,
    location: user.location,
    subscription_tier: user.subscriptionTier,
    is_founding_member: user.isFoundingMember,
    avatar_url: user.avatarUrl ?? null,
    favourite_tcg: user.favouriteTcg ?? null,
    collector_since: user.collectorSince ?? null,
    profile_public: user.profilePublic,
    show_collection: user.showCollection,
    show_wishlist: user.showWishlist,
    show_for_trade: user.showForTrade,
    show_for_sale: user.showForSale,
    preferred_tcgs: user.preferredTcgs ?? null,
  };
}

function sessionResponse(
  user: UserRow,
  accessToken: string,
  refreshToken: string,
) {
  const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    expires_at: expiresAt,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: userToMetadata(user),
    },
  };
}

async function createSession(userId: string, plainRefreshToken: string): Promise<void> {
  const hash = crypto.createHash("sha256").update(plainRefreshToken).digest("hex");
  await db.insert(userSessionsTable).values({
    userId,
    refreshTokenHash: hash,
    expiresAt: refreshTokenExpiry(),
  });
}

// ── POST /api/auth/signup ────────────────────────────────────────────────────

router.post("/auth/signup", authSignLimiter, async (req, res) => {
  const { email, password, display_name: displayName } = req.body as {
    email?: string;
    password?: string;
    display_name?: string;
  };

  if (!email || !password || !displayName) {
    return res.status(400).json({ message: "email, password, and display_name are required" });
  }

  const normEmail = email.trim().toLowerCase();
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  // Check duplicate
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normEmail))
    .limit(1);

  if (existing.length > 0) {
    return res.status(422).json({ message: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const username = normEmail.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "");

  const [user] = await db
    .insert(usersTable)
    .values({ email: normEmail, passwordHash, displayName: displayName.trim(), username })
    .returning();

  const refreshToken = makeRefreshToken();
  const accessToken = makeAccessToken(user.id, user.email, user.displayName);
  await createSession(user.id, refreshToken);

  // Record account_created telemetry event (no PII in metadata)
  void recordTelemetry({
    category: "analytics",
    action: "account_created",
    userId: user.id,
    status: "ok",
    metadata: { subscriptionTier: user.subscriptionTier },
  });

  return res.status(201).json(sessionResponse(user, accessToken, refreshToken));
});

// ── POST /api/auth/signin ────────────────────────────────────────────────────

router.post("/auth/signin", authSignLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const normEmail = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normEmail))
    .limit(1);

  if (!user) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  if (user.suspendedAt) {
    return res.status(403).json({ message: "Account suspended — contact support" });
  }

  const refreshToken = makeRefreshToken();
  const accessToken = makeAccessToken(user.id, user.email, user.displayName);
  await createSession(user.id, refreshToken);

  // Record session_started telemetry event
  void recordTelemetry({
    category: "analytics",
    action: "session_started",
    userId: user.id,
    status: "ok",
    metadata: { subscriptionTier: user.subscriptionTier },
  });

  return res.json(sessionResponse(user, accessToken, refreshToken));
});

// ── POST /api/auth/refresh ───────────────────────────────────────────────────

router.post("/auth/refresh", async (req, res) => {
  const { refresh_token: plainRefreshToken } = req.body as { refresh_token?: string };
  if (!plainRefreshToken) {
    return res.status(400).json({ message: "refresh_token is required" });
  }

  const hash = crypto.createHash("sha256").update(plainRefreshToken).digest("hex");

  const [session] = await db
    .select()
    .from(userSessionsTable)
    .where(eq(userSessionsTable.refreshTokenHash, hash))
    .limit(1);

  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ message: "Session expired, please sign in again" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  if (!user) {
    return res.status(401).json({ message: "User not found" });
  }

  if (user.suspendedAt) {
    return res.status(403).json({ message: "Account suspended — contact support" });
  }

  // Rotate refresh token
  await db.delete(userSessionsTable).where(eq(userSessionsTable.id, session.id));
  const newRefreshToken = makeRefreshToken();
  const newAccessToken = makeAccessToken(user.id, user.email, user.displayName);
  await createSession(user.id, newRefreshToken);

  return res.json(sessionResponse(user, newAccessToken, newRefreshToken));
});

// ── POST /api/auth/signout ───────────────────────────────────────────────────

router.post("/auth/signout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET as string) as { sub: string };
      // Delete all sessions for this user on sign-out
      await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, payload.sub));
    } catch {
      // Expired or invalid token — still a successful sign-out from the client's perspective
    }
  }
  return res.json({ message: "Signed out" });
});

// ── GET /api/auth/user ───────────────────────────────────────────────────────

router.get("/auth/user", async (req, res) => {
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

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.sub))
    .limit(1);

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (user.suspendedAt) {
    return res.status(403).json({ message: "Account suspended — contact support" });
  }

  return res.json({
    id: user.id,
    email: user.email,
    user_metadata: userToMetadata(user),
  });
});

// ── PUT /api/auth/user ───────────────────────────────────────────────────────

router.put("/auth/user", async (req, res) => {
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

  const { data } = req.body as {
    data?: {
      display_name?: string;
      username?: string;
      bio?: string;
      location?: string;
      favourite_tcg?: string | null;
      collector_since?: string | null;
      profile_public?: boolean;
      show_collection?: boolean;
      show_wishlist?: boolean;
      show_for_trade?: boolean;
      show_for_sale?: boolean;
      preferred_tcgs?: string | null;
    };
  };

  if (!data) {
    return res.status(400).json({ message: "data object is required" });
  }

  const patch: Partial<typeof usersTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.display_name !== undefined) patch.displayName = data.display_name.trim();
  if (data.username !== undefined) patch.username = data.username.trim().replace(/^@+/, "").toLowerCase();
  if (data.bio !== undefined) patch.bio = data.bio.trim();
  if (data.location !== undefined) patch.location = data.location.trim();
  // Use explicit null to write SQL NULL — undefined is skipped by Drizzle
  if ("favourite_tcg" in data) patch.favouriteTcg = data.favourite_tcg ?? null;
  if ("collector_since" in data) patch.collectorSince = data.collector_since ?? null;
  if (data.profile_public !== undefined) patch.profilePublic = data.profile_public;
  if (data.show_collection !== undefined) patch.showCollection = data.show_collection;
  if (data.show_wishlist !== undefined) patch.showWishlist = data.show_wishlist;
  if (data.show_for_trade !== undefined) patch.showForTrade = data.show_for_trade;
  if (data.show_for_sale !== undefined) patch.showForSale = data.show_for_sale;
  if ("preferred_tcgs" in data) patch.preferredTcgs = data.preferred_tcgs ?? null;

  // Check suspension before applying update
  const [existing] = await db
    .select({ id: usersTable.id, suspendedAt: usersTable.suspendedAt })
    .from(usersTable)
    .where(eq(usersTable.id, payload.sub))
    .limit(1);

  if (!existing) {
    return res.status(404).json({ message: "User not found" });
  }

  if (existing.suspendedAt) {
    return res.status(403).json({ message: "Account suspended — contact support" });
  }

  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, payload.sub))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "User not found" });
  }

  // Record profile_updated telemetry event
  void recordTelemetry({
    category: "analytics",
    action: "profile_updated",
    userId: updated.id,
    status: "ok",
  });
  if (
    Boolean(updated.favouriteTcg) ||
    Boolean(updated.collectorSince) ||
    Boolean(updated.preferredTcgs)
  ) {
    void recordTelemetry({
      category: "analytics",
      action: "profile_completed",
      userId: updated.id,
      status: "ok",
    });
  }

  return res.json({
    id: updated.id,
    email: updated.email,
    user_metadata: userToMetadata(updated),
  });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────

router.post("/auth/change-password", requireActiveUser, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "currentPassword and newPassword are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ message: "Current password is incorrect" });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ message: "New password must be different from your current password" });
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  await db
    .update(usersTable)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(usersTable.id, req.userId!));

  // Invalidate all sessions so all other devices are signed out
  await db
    .delete(userSessionsTable)
    .where(eq(userSessionsTable.userId, req.userId!));

  return res.json({ message: "Password updated successfully" });
});

// ── POST /api/auth/avatar ────────────────────────────────────────────────────
// Accepts a base64-encoded image in the JSON body (up to 5 MB after encoding).
// Returns the full URL to the stored avatar.

router.post("/auth/avatar", requireActiveUser, async (req: AuthRequest, res) => {
  const { base64, mimeType } = req.body as {
    base64?: string;
    mimeType?: string;
  };

  if (!base64) {
    return res.status(400).json({ message: "base64 image data is required" });
  }

  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const mime = mimeType ?? "image/jpeg";
  if (!allowedTypes.includes(mime)) {
    return res.status(400).json({ message: "Only JPEG, PNG, and WebP images are supported" });
  }

  // Validate approximate size (base64 is ~4/3 of binary size)
  const approxBytes = (base64.length * 3) / 4;
  if (approxBytes > 5 * 1024 * 1024) {
    return res.status(400).json({ message: "Image must be under 5 MB" });
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(base64, "base64");
  } catch {
    return res.status(400).json({ message: "Invalid base64 data" });
  }

  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const filename = `${req.userId!}-${Date.now()}.${ext}`;
  const filePath = path.join(AVATAR_DIR, filename);

  try {
    fs.writeFileSync(filePath, imageBuffer);
  } catch (err) {
    console.error("[avatar] Failed to write file:", err);
    return res.status(500).json({ message: "Failed to save avatar" });
  }

  // Construct the URL using the request's host so it works across environments
  const protocol = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.get("host") ?? "";
  const avatarUrl = `${protocol}://${host}/api/auth/avatar/${filename}`;

  // Save URL to the user record (also delete old avatar file if it was ours)
  const [oldUser] = await db
    .select({ avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (oldUser?.avatarUrl) {
    try {
      const oldFilename = oldUser.avatarUrl.split("/").pop();
      if (oldFilename) {
        const oldPath = path.join(AVATAR_DIR, oldFilename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    } catch { /* ignore cleanup errors */ }
  }

  await db
    .update(usersTable)
    .set({ avatarUrl, updatedAt: new Date() })
    .where(eq(usersTable.id, req.userId!));

  return res.json({ avatar_url: avatarUrl });
});

// ── GET /api/auth/avatar/:filename ───────────────────────────────────────────
// Serve uploaded avatar images.

router.get("/auth/avatar/:filename", (req, res) => {
  const filename = path.basename(req.params["filename"] ?? "");
  if (!filename) return res.status(400).json({ message: "Invalid filename" });

  const filePath = path.join(AVATAR_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Avatar not found" });
  }

  // Determine content type from extension
  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === ".png" ? "image/png" :
    ext === ".webp" ? "image/webp" :
    "image/jpeg";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(filePath);
});

// ── Recovery rate limiting ────────────────────────────────────────────────────

const RECOVER_RATE_WINDOW_MS = 15 * 60 * 1000;
const RECOVER_MAX_PER_IP = 5;
const RECOVER_MAX_PER_EMAIL = 3;

type RateBucket = { count: number; windowStart: number };
const recoverIpBuckets = new Map<string, RateBucket>();
const recoverEmailBuckets = new Map<string, RateBucket>();

function checkRecoverRateLimit(key: string, store: Map<string, RateBucket>, max: number): boolean {
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || now - bucket.windowStart > RECOVER_RATE_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= max) return true;
  bucket.count++;
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - RECOVER_RATE_WINDOW_MS;
  for (const [k, b] of recoverIpBuckets) if (b.windowStart < cutoff) recoverIpBuckets.delete(k);
  for (const [k, b] of recoverEmailBuckets) if (b.windowStart < cutoff) recoverEmailBuckets.delete(k);
}, RECOVER_RATE_WINDOW_MS);

// ── Email helper ──────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESET_FROM_EMAIL ?? "noreply@verifiedtcg.co";
const APP_SCHEME = "verified-tcg";
const RESET_TOKEN_TTL_MINUTES = 60;

function getResendClient(): Resend | null {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
}

async function sendPasswordResetEmail(toEmail: string, plainToken: string): Promise<void> {
  const resend = getResendClient();
  const deepLink = `${APP_SCHEME}://reset-password?token=${plainToken}`;

  if (!resend) {
    console.warn("[password-reset] RESEND_API_KEY not set; reset email not delivered.");
    return;
  }

  // Sanitized integration observability for the actual outbound Resend call.
  // Records only ok/failed, duration, and a fixed operation enum — never the
  // recipient, subject/body, credentials, headers, or provider error text.
  const startedAt = Date.now();
  let deliveryFailed = false;
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Reset your Verified TCG password",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Reset your password</h2>
          <p>We received a request to reset the password for your Verified TCG account.</p>
          <p>Tap the button below to choose a new password. This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>
          <a href="${deepLink}"
             style="display:inline-block;padding:14px 28px;background:#6c63ff;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
            Reset Password
          </a>
          <p style="color:#888;font-size:13px;">
            If the button doesn't work, open your Verified TCG app and use this link:<br>
            <code>${deepLink}</code>
          </p>
          <p style="color:#888;font-size:13px;">
            If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
      `,
    });
    deliveryFailed = Boolean(error);
  } catch {
    deliveryFailed = true;
  }

  void recordTelemetry({
    category: "integration",
    action: "integration.resend.request",
    status: deliveryFailed ? "failed" : "ok",
    durationMs: Date.now() - startedAt,
    metadata: { operation: "password_reset" },
  });

  if (deliveryFailed) {
    throw new Error("Failed to send reset email.");
  }
}

// ── POST /api/auth/recover ───────────────────────────────────────────────────

router.post("/auth/recover", authRecoverLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    return res.status(400).json({ message: "email is required" });
  }

  const normEmail = email.trim().toLowerCase();

  const genericOk = () =>
    res.json({ message: "If an account with that email exists, a reset link will be sent shortly." });

  const clientIp = (req.ip ?? req.socket.remoteAddress ?? "unknown");
  if (
    checkRecoverRateLimit(clientIp, recoverIpBuckets, RECOVER_MAX_PER_IP) ||
    checkRecoverRateLimit(normEmail, recoverEmailBuckets, RECOVER_MAX_PER_EMAIL)
  ) {
    return genericOk();
  }

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, normEmail))
    .limit(1);

  if (!user) return genericOk();

  await db
    .delete(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.userId, user.id));

  const plainToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  try {
    await sendPasswordResetEmail(user.email, plainToken);
  } catch (err) {
    console.error("[password-reset] email delivery failed:", (err as Error).message);
  }

  return genericOk();
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────

router.post("/auth/reset-password", authRecoverLimiter, async (req, res) => {
  const { token, new_password: newPassword } = req.body as {
    token?: string;
    new_password?: string;
  };

  if (!token || !newPassword) {
    return res.status(400).json({ message: "token and new_password are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const consumed = await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      UPDATE password_reset_tokens
      SET used = true
      WHERE token_hash = ${tokenHash}
        AND used = false
        AND expires_at > NOW()
      RETURNING user_id
    `);

    if (result.rowCount === 0) return null;

    const userId = (result.rows[0] as { user_id: string }).user_id;

    await tx
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    await tx
      .delete(userSessionsTable)
      .where(eq(userSessionsTable.userId, userId));

    return userId;
  });

  if (!consumed) {
    return res.status(400).json({ message: "This reset link is invalid or has expired. Please request a new one." });
  }

  return res.json({ message: "Password updated successfully." });
});

// ── DELETE /api/auth/account ─────────────────────────────────────────────────

router.delete("/auth/account", requireActiveUser, async (req: AuthRequest, res) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    return res.status(400).json({ message: "password is required" });
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) return res.status(404).json({ message: "User not found" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ message: "Incorrect password" });

  // Clear wishlist data before deleting user
  await clearUserWishlists(req.userId!);

  await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, req.userId!));
  await db.delete(usersTable).where(eq(usersTable.id, req.userId!));

  return res.json({ message: "Account deleted" });
});

export default router;
