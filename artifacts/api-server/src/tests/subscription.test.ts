/**
 * Pro tier persistence integration tests
 *
 * Confirms that subscription_tier = 'pro' survives across the three real-world
 * scenarios where a silent revert could occur:
 *
 *   1. Upgrade → GET /api/auth/user immediately returns 'pro'
 *   2. Token refresh (simulating reinstall / token expiry) still returns 'pro'
 *   3. Fresh sign-in on a new device still returns 'pro' without re-upgrading
 *
 * When ENABLE_DEV_UPGRADE=true the test also exercises the real upgrade
 * endpoint (POST /api/subscription/upgrade) end-to-end.  Otherwise it seeds
 * the 'pro' tier directly in the DB so the persistence assertions still run.
 *
 * Uses the real Replit Postgres database and cleans up test rows after each
 * suite.  NODE_ENV=test disables rate limiters.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import crypto from "node:crypto";
import { db, pool } from "@workspace/db";
import { usersTable, userSessionsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { createTestUser } from "./helpers.js";
import app from "../app.js";

after(() => pool.end());

const request = supertest(app);

const TAG = `__sub_${Date.now()}__`;

async function cleanupTaggedUsers() {
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
}

// ── Helper: insert a DB session and return the plain refresh token ─────────────

async function createDbSession(userId: string): Promise<string> {
  const plainToken = crypto.randomBytes(64).toString("hex");
  const hash = crypto.createHash("sha256").update(plainToken).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await db.insert(userSessionsTable).values({ userId, refreshTokenHash: hash, expiresAt });
  return plainToken;
}

// ── 1. GET /api/auth/user returns 'pro' immediately after upgrade ─────────────

describe("Pro tier: GET /api/auth/user reflects subscription_tier", () => {
  let accessToken: string;
  let userId: string;
  let userEmail: string;
  let userPassword: string;

  before(async () => {
    const u = await createTestUser({
      email: `${TAG}user_get@example.com`,
      password: "testpass123",
      displayName: "Get User Test",
      subscriptionTier: "free",
    });
    userId = u.user.id;
    userEmail = u.email;
    userPassword = u.password;
    accessToken = u.accessToken;
  });

  after(cleanupTaggedUsers);

  test("fresh free user: GET /api/auth/user returns subscription_tier 'free'", async () => {
    const res = await request
      .get("/api/auth/user")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.user_metadata?.subscription_tier,
      "free",
      "should start as free",
    );
  });

  test("after DB upgrade to 'pro': GET /api/auth/user returns subscription_tier 'pro'", async () => {
    // Simulate what the upgrade endpoint does in the DB
    await db
      .update(usersTable)
      .set({ subscriptionTier: "pro", updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    const res = await request
      .get("/api/auth/user")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.user_metadata?.subscription_tier,
      "pro",
      "GET /api/auth/user must return 'pro' after upgrade",
    );
  });

  // When ENABLE_DEV_UPGRADE=true is set, also exercise the real endpoint
  if (process.env.ENABLE_DEV_UPGRADE === "true") {
    test("POST /api/subscription/upgrade sets tier to 'pro' and GET /api/auth/user confirms it", async () => {
      // Create a fresh free user for this sub-test
      const u2 = await createTestUser({
        email: `${TAG}upgrade_e2e@example.com`,
        password: "testpass123",
        displayName: "E2E Upgrade Test",
        subscriptionTier: "free",
      });

      const upgradeRes = await request
        .post("/api/subscription/upgrade")
        .set("Authorization", `Bearer ${u2.accessToken}`);
      assert.equal(upgradeRes.status, 200, JSON.stringify(upgradeRes.body));
      assert.equal(upgradeRes.body.subscription_tier, "pro");

      const getRes = await request
        .get("/api/auth/user")
        .set("Authorization", `Bearer ${u2.accessToken}`);
      assert.equal(getRes.status, 200, JSON.stringify(getRes.body));
      assert.equal(
        getRes.body.user_metadata?.subscription_tier,
        "pro",
        "GET /api/auth/user must reflect 'pro' after upgrade endpoint call",
      );
    });
  }
});

// ── 2. POST /api/auth/refresh still returns 'pro' (simulates reinstall / token expiry) ──

describe("Pro tier: POST /api/auth/refresh preserves subscription_tier", () => {
  let refreshToken: string;
  let userId: string;

  before(async () => {
    const u = await createTestUser({
      email: `${TAG}refresh@example.com`,
      password: "testpass123",
      displayName: "Refresh Test",
      subscriptionTier: "pro", // start as pro
    });
    userId = u.user.id;
    refreshToken = await createDbSession(userId);
  });

  after(cleanupTaggedUsers);

  test("refresh with a valid token for a pro user returns subscription_tier 'pro'", async () => {
    const res = await request
      .post("/api/auth/refresh")
      .send({ refresh_token: refreshToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.user?.user_metadata?.subscription_tier,
      "pro",
      "refreshed session must carry subscription_tier 'pro'",
    );
    // Ensure a new access and refresh token were issued
    assert.ok(res.body.access_token, "must return a new access_token");
    assert.ok(res.body.refresh_token, "must return a new refresh_token");
  });

  test("second refresh with the rotated token still returns subscription_tier 'pro'", async () => {
    // Sign out all sessions and create a fresh one to keep tests independent
    const u2 = await createTestUser({
      email: `${TAG}refresh2@example.com`,
      password: "testpass123",
      displayName: "Refresh Test 2",
      subscriptionTier: "pro",
    });
    const rt2 = await createDbSession(u2.user.id);

    const first = await request
      .post("/api/auth/refresh")
      .send({ refresh_token: rt2 });
    assert.equal(first.status, 200, JSON.stringify(first.body));

    // Use the rotated refresh token from the first response
    const rotatedToken = first.body.refresh_token as string;
    const second = await request
      .post("/api/auth/refresh")
      .send({ refresh_token: rotatedToken });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(
      second.body.user?.user_metadata?.subscription_tier,
      "pro",
      "subscription_tier must survive token rotation",
    );
  });

  test("refresh with an invalid token returns 401", async () => {
    const res = await request
      .post("/api/auth/refresh")
      .send({ refresh_token: "not-a-real-token" });
    assert.equal(res.status, 401);
  });
});

// ── 3. Sign-out then fresh sign-in still returns 'pro' ───────────────────────

describe("Pro tier: subscription_tier survives sign-out + fresh sign-in", () => {
  let userEmail: string;
  let userPassword: string;

  before(async () => {
    const u = await createTestUser({
      email: `${TAG}signin_pro@example.com`,
      password: "securepass99",
      displayName: "Sign In Pro Test",
      subscriptionTier: "pro",
    });
    userEmail = u.email;
    userPassword = u.password;
  });

  after(cleanupTaggedUsers);

  test("sign-in for a Pro account returns subscription_tier 'pro' in the session", async () => {
    const res = await request
      .post("/api/auth/signin")
      .send({ email: userEmail, password: userPassword });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.user?.user_metadata?.subscription_tier,
      "pro",
      "sign-in must return 'pro' without requiring an upgrade call",
    );
    assert.ok(res.body.access_token, "must return access_token");
    assert.ok(res.body.refresh_token, "must return refresh_token");
  });

  test("after sign-out, fresh sign-in still returns subscription_tier 'pro'", async () => {
    // Sign in to get a valid access token
    const signinRes = await request
      .post("/api/auth/signin")
      .send({ email: userEmail, password: userPassword });
    assert.equal(signinRes.status, 200, JSON.stringify(signinRes.body));
    const accessToken = signinRes.body.access_token as string;

    // Explicitly sign out (simulates the user tapping "Sign Out" on device 1)
    const signoutRes = await request
      .post("/api/auth/signout")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(signoutRes.status, 200, JSON.stringify(signoutRes.body));

    // Fresh sign-in (simulates the user signing back in or opening on a new device)
    const reSigninRes = await request
      .post("/api/auth/signin")
      .send({ email: userEmail, password: userPassword });
    assert.equal(reSigninRes.status, 200, JSON.stringify(reSigninRes.body));
    assert.equal(
      reSigninRes.body.user?.user_metadata?.subscription_tier,
      "pro",
      "subscription_tier must still be 'pro' after sign-out + fresh sign-in",
    );
    assert.ok(reSigninRes.body.access_token, "must issue a new access_token");
    assert.ok(reSigninRes.body.refresh_token, "must issue a new refresh_token");
  });

  test("sign-in on a second device (without sign-out) still returns subscription_tier 'pro'", async () => {
    // First device sign-in
    await request
      .post("/api/auth/signin")
      .send({ email: userEmail, password: userPassword });

    // Second device sign-in — same credentials, no sign-out in between
    const res = await request
      .post("/api/auth/signin")
      .send({ email: userEmail, password: userPassword });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      res.body.user?.user_metadata?.subscription_tier,
      "pro",
      "second device sign-in must return 'pro'",
    );
  });
});

// ── 4. POST /api/subscription/restore re-fetches 'pro' from DB ───────────────

describe("Pro tier: POST /api/subscription/restore confirms server-side tier", () => {
  let accessToken: string;
  let userId: string;

  before(async () => {
    const u = await createTestUser({
      email: `${TAG}restore@example.com`,
      password: "restorepass1",
      displayName: "Restore Test",
      subscriptionTier: "pro",
    });
    userId = u.user.id;
    accessToken = u.accessToken;
  });

  after(cleanupTaggedUsers);

  test("restore for a pro user returns subscription_tier 'pro' and restored: true", async () => {
    const res = await request
      .post("/api/subscription/restore")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.subscription_tier, "pro");
    assert.equal(res.body.restored, true, "'restored' must be true for a Pro user");
  });

  test("restore for a free user returns restored: false", async () => {
    const freeUser = await createTestUser({
      email: `${TAG}restore_free@example.com`,
      password: "freepass1",
      displayName: "Free Restore Test",
      subscriptionTier: "free",
    });
    const res = await request
      .post("/api/subscription/restore")
      .set("Authorization", `Bearer ${freeUser.accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.subscription_tier, "free");
    assert.equal(res.body.restored, false, "'restored' must be false for a Free user");
  });

  test("restore without auth returns 401", async () => {
    const res = await request.post("/api/subscription/restore");
    assert.equal(res.status, 401);
  });

  test("after tier downgrade in DB, restore reflects the updated tier", async () => {
    // Simulate a tier being corrected server-side (e.g. chargeback)
    await db
      .update(usersTable)
      .set({ subscriptionTier: "free", updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    const res = await request
      .post("/api/subscription/restore")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.subscription_tier, "free");
    assert.equal(res.body.restored, false);
  });
});
