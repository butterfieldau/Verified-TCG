import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) throw new Error("SESSION_SECRET must be set");

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

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

function sessionResponse(
  user: { id: string; email: string; displayName: string; username: string; bio: string; location: string },
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
      user_metadata: {
        display_name: user.displayName,
        username: user.username,
        bio: user.bio,
        location: user.location,
      },
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

router.post("/auth/signup", async (req, res) => {
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

  return res.status(201).json(sessionResponse(user, accessToken, refreshToken));
});

// ── POST /api/auth/signin ────────────────────────────────────────────────────

router.post("/auth/signin", async (req, res) => {
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

  const refreshToken = makeRefreshToken();
  const accessToken = makeAccessToken(user.id, user.email, user.displayName);
  await createSession(user.id, refreshToken);

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

  return res.json({
    id: user.id,
    email: user.email,
    user_metadata: {
      display_name: user.displayName,
      username: user.username,
      bio: user.bio,
      location: user.location,
    },
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

  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, payload.sub))
    .returning();

  if (!updated) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({
    id: updated.id,
    email: updated.email,
    user_metadata: {
      display_name: updated.displayName,
      username: updated.username,
      bio: updated.bio,
      location: updated.location,
    },
  });
});

// ── POST /api/auth/recover ───────────────────────────────────────────────────
// Password reset via email is not yet supported (no mail service configured).
// Returns 200 so the UI shows a friendly message rather than crashing.

router.post("/auth/recover", (_req, res) => {
  return res.json({
    message: "If an account with that email exists, a reset link will be sent shortly.",
  });
});

export default router;
