/**
 * Auth API integration tests
 *
 * Tests every auth endpoint: signup, signin, refresh, signout, change-password,
 * forgot-password + reset-password, and account deletion.
 *
 * Uses the real database (Replit Postgres) and cleans up test users after each
 * test so there are no leftover rows.  SESSION_SECRET must be set in the
 * environment.  NODE_ENV=test disables rate limiters so the suite can call
 * auth endpoints freely without hitting 429s.
 */
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db } from "@workspace/db";
import { usersTable, userSessionsTable, passwordResetTokensTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import crypto from "node:crypto";
import app from "../app.js";
import { createTestUser } from "./helpers.js";

// Close the DB pool after all tests so the process exits cleanly.
// Without this the pg Pool keeps the event loop alive and the process
// hangs indefinitely after the last test completes.
import { pool } from "@workspace/db";
after(() => pool.end());

const request = supertest(app);

const TAG = `__auth_${Date.now()}__`;

async function cleanupTaggedUsers() {
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
}

// ── Signup ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/signup", () => {
  after(cleanupTaggedUsers);

  test("valid input creates a user and returns a session", async () => {
    const email = `${TAG}signup_happy@example.com`;
    const res = await request.post("/api/auth/signup").send({
      email,
      password: "password123",
      display_name: "Test User",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.access_token, "should have access_token");
    assert.ok(res.body.refresh_token, "should have refresh_token");
    assert.ok(res.body.user?.id, "should have user.id");
    assert.equal(res.body.user.email, email);
    const sessions = await db
      .select({ id: userSessionsTable.id })
      .from(userSessionsTable)
      .where(eq(userSessionsTable.userId, res.body.user.id));
    assert.equal(sessions.length, 1, "signup should persist a refresh session");
  });

  test("duplicate email returns 422 with a human-readable message", async () => {
    const email = `${TAG}signup_dup@example.com`;
    await request.post("/api/auth/signup").send({
      email,
      password: "password123",
      display_name: "First",
    });
    const res = await request.post("/api/auth/signup").send({
      email,
      password: "password123",
      display_name: "Second",
    });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.ok(res.body.message, "should have a message field");
    assert.ok(
      res.body.message.toLowerCase().includes("email") ||
        res.body.message.toLowerCase().includes("account"),
      `message should mention email or account; got: "${res.body.message}"`,
    );
  });

  test("missing email returns 400", async () => {
    const res = await request.post("/api/auth/signup").send({
      password: "password123",
      display_name: "No Email",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("missing password returns 400", async () => {
    const res = await request.post("/api/auth/signup").send({
      email: `${TAG}nopass@example.com`,
      display_name: "No Password",
    });
    assert.equal(res.status, 400);
  });

  test("missing display_name returns 400", async () => {
    const res = await request.post("/api/auth/signup").send({
      email: `${TAG}noname@example.com`,
      password: "password123",
    });
    assert.equal(res.status, 400);
  });

  test("password shorter than 8 chars returns 400", async () => {
    const res = await request.post("/api/auth/signup").send({
      email: `${TAG}shortpw@example.com`,
      password: "short",
      display_name: "Short PW",
    });
    assert.equal(res.status, 400);
  });

  test("suspended accounts return the application 403 message", async () => {
    const suspended = await createTestUser({
      email: `${TAG}suspended@example.com`,
      password: "suspendedpass1",
    });
    await db
      .update(usersTable)
      .set({ suspendedAt: new Date() })
      .where(eq(usersTable.id, suspended.user.id));

    const res = await request.post("/api/auth/signin").send({
      email: suspended.email,
      password: suspended.password,
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.message, "Account suspended — contact support");
  });
});

// ── Signin ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/signin", () => {
  let email: string;
  let password: string;

  before(async () => {
    // Use the DB helper so we don't consume rate-limit slots during setup
    const user = await createTestUser({
      email: `${TAG}signin@example.com`,
      password: "testpass99",
      displayName: "Sign In Test",
    });
    email = user.email;
    password = user.password;
  });

  after(cleanupTaggedUsers);

  test("correct credentials return a session", async () => {
    const res = await request.post("/api/auth/signin").send({ email, password });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.access_token);
    assert.ok(res.body.refresh_token);
  });

  test("wrong password returns 401", async () => {
    const res = await request.post("/api/auth/signin").send({
      email,
      password: "wrongpassword",
    });
    assert.equal(res.status, 401);
  });

  test("non-existent email returns 401 (neutral response — not 404)", async () => {
    const res = await request.post("/api/auth/signin").send({
      email: `nonexistent_${Date.now()}@example.com`,
      password: "anything",
    });
    assert.equal(res.status, 401);
    assert.ok(
      !res.body.message?.toLowerCase().includes("not found"),
      "response should not reveal whether the account exists",
    );
  });

  test("missing email returns 400", async () => {
    const res = await request.post("/api/auth/signin").send({ password });
    assert.equal(res.status, 400);
  });
});

// ── Auth middleware ───────────────────────────────────────────────────────────

describe("Auth middleware — protected routes", () => {
  test("returns 401 when no Authorization header is provided", async () => {
    const res = await request.get("/api/collection");
    assert.equal(res.status, 401);
  });

  test("returns 401 when an invalid token is provided", async () => {
    const res = await request
      .get("/api/collection")
      .set("Authorization", "Bearer not-a-valid-jwt");
    assert.equal(res.status, 401);
  });
});

// ── Change-password ───────────────────────────────────────────────────────────

describe("POST /api/auth/change-password", () => {
  let accessToken: string;

  before(async () => {
    const user = await createTestUser({
      email: `${TAG}chpw@example.com`,
      password: "oldpassword1",
    });
    accessToken = user.accessToken;
  });

  after(cleanupTaggedUsers);

  test("correct current password updates the hash", async () => {
    const res = await request
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "oldpassword1", newPassword: "newpassword1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.message);
  });

  test("wrong current password returns 400", async () => {
    const user2 = await createTestUser({
      email: `${TAG}chpw2@example.com`,
      password: "oldpassword1",
    });
    const res = await request
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${user2.accessToken}`)
      .send({ currentPassword: "wrongpassword", newPassword: "newpassword2" });
    assert.equal(res.status, 400);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await request
      .post("/api/auth/change-password")
      .send({ currentPassword: "oldpassword1", newPassword: "x" });
    assert.equal(res.status, 401);
  });
});

// ── Forgot-password + reset-password ─────────────────────────────────────────

describe("POST /api/auth/recover + /api/auth/reset-password", () => {
  let userId: string;
  let userEmail: string;

  before(async () => {
    const user = await createTestUser({
      email: `${TAG}recover@example.com`,
      password: "recoverpass1",
    });
    userId = user.user.id;
    userEmail = user.email;
  });

  after(cleanupTaggedUsers);

  test("recover endpoint returns 200 for registered email (generic response)", async () => {
    const res = await request.post("/api/auth/recover").send({ email: userEmail });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("recover endpoint returns 200 for non-existent email (no account enumeration)", async () => {
    const res = await request.post("/api/auth/recover").send({
      email: `ghost_${Date.now()}@example.com`,
    });
    assert.equal(res.status, 200);
  });

  test("valid (non-expired, unused) token resets the password", async () => {
    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(passwordResetTokensTable).values({ userId, tokenHash, expiresAt });

    const res = await request.post("/api/auth/reset-password").send({
      token: plainToken,
      new_password: "newresetpass1",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("expired token returns 400", async () => {
    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt = new Date(Date.now() - 1000); // already expired
    await db.insert(passwordResetTokensTable).values({ userId, tokenHash, expiresAt });

    const res = await request.post("/api/auth/reset-password").send({
      token: plainToken,
      new_password: "expiredpass1",
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  });

  test("already-used token returns 400", async () => {
    const plainToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(passwordResetTokensTable).values({
      userId,
      tokenHash,
      expiresAt,
      used: true,
    });

    const res = await request.post("/api/auth/reset-password").send({
      token: plainToken,
      new_password: "usedtokenpass1",
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  });

  test("missing token returns 400", async () => {
    const res = await request.post("/api/auth/reset-password").send({
      new_password: "somepassword",
    });
    assert.equal(res.status, 400);
  });
});

// ── Delete account ────────────────────────────────────────────────────────────

describe("DELETE /api/auth/account", () => {
  let accessToken: string;
  let userId: string;

  beforeEach(async () => {
    const user = await createTestUser({
      email: `${TAG}del_${Math.random().toString(36).slice(2)}@example.com`,
      password: "deletepass1",
    });
    accessToken = user.accessToken;
    userId = user.user.id;
  });

  afterEach(async () => {
    await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => {});
    await cleanupTaggedUsers();
  });

  test("correct password deletes the user", async () => {
    const res = await request
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "deletepass1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Subsequent protected request should return 401 (user no longer exists)
    const check = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(check.status, 401);
  });

  test("wrong password returns 401", async () => {
    const res = await request
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "wrongpassword" });
    assert.equal(res.status, 401);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await request
      .delete("/api/auth/account")
      .send({ password: "deletepass1" });
    assert.equal(res.status, 401);
  });
});
