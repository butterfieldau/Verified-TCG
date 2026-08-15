/**
 * Scan rate-limit integration tests
 *
 * Verifies quota enforcement via the real POST /api/scan/recognize endpoint.
 * OpenAI and JustTCG calls are expected to fail in test (no real keys), so
 * we only assert on the HTTP status code that relates to quota enforcement,
 * not on the recognition result.
 *
 * Key behaviours:
 *   - Free user's 30th scan is allowed (NOT 403).
 *   - Free user's 31st scan is blocked with 403.
 *   - Pro user with 30+ scans is never blocked (NOT 403).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app.js";
import { createTestUser, setScanCount } from "./helpers.js";

const request = supertest(app);

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-secret-placeholder-at-least-32-characters";
}

const TAG = `__scan_${Date.now()}__`;

async function cleanupTaggedUsers() {
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
}

// Close the DB pool after all tests so the process exits cleanly.
after(async () => {
  await cleanupTaggedUsers();
  await pool.end();
});

// Minimal body that passes body-level validation (real image not required for
// quota enforcement — the 403 is returned before OpenAI is ever called).
const MINIMAL_SCAN_BODY = {
  image: Buffer.from("fake-jpeg-data").toString("base64"),
  mimeType: "image/jpeg",
};

// ── GET /api/scan/usage ───────────────────────────────────────────────────────

describe("GET /api/scan/usage", () => {
  let freeToken: string;
  let freeUserId: string;

  before(async () => {
    const user = await createTestUser({
      email: `${TAG}usage@example.com`,
      subscriptionTier: "free",
    });
    freeToken = user.accessToken;
    freeUserId = user.user.id;
  });

  test("returns scansUsed = 0 for a new free user", async () => {
    const res = await request
      .get("/api/scan/usage")
      .set("Authorization", `Bearer ${freeToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.scansUsed, 0);
    assert.equal(res.body.scanLimit, 30);
  });

  test("reflects a pre-seeded scan count", async () => {
    await setScanCount(freeUserId, 15);
    const res = await request
      .get("/api/scan/usage")
      .set("Authorization", `Bearer ${freeToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.scansUsed, 15);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await request.get("/api/scan/usage");
    assert.equal(res.status, 401);
  });
});

// ── Quota enforcement via POST /api/scan/recognize ───────────────────────────

describe("POST /api/scan/recognize — free user quota", () => {
  let freeToken: string;
  let freeUserId: string;

  before(async () => {
    const user = await createTestUser({
      email: `${TAG}quota_free@example.com`,
      subscriptionTier: "free",
    });
    freeToken = user.accessToken;
    freeUserId = user.user.id;
  });

  test("free user's 30th scan is allowed (returns non-403)", async () => {
    // Pre-seed 29 scans so this request is the 30th
    await setScanCount(freeUserId, 29);

    const res = await request
      .post("/api/scan/recognize")
      .set("Authorization", `Bearer ${freeToken}`)
      .send(MINIMAL_SCAN_BODY);

    // 403 means quota blocked — must NOT happen for the 30th scan
    assert.notEqual(res.status, 403, `Expected the 30th scan to be allowed but got 403: ${JSON.stringify(res.body)}`);
    // The OpenAI call will fail in test (no real key), so 503 or 500 is expected.
    // We only care that quota was not the reason for failure.
  });

  test("free user's 31st scan is blocked with 403", async () => {
    // Pre-seed 30 scans so this request is the 31st
    await setScanCount(freeUserId, 30);

    const res = await request
      .post("/api/scan/recognize")
      .set("Authorization", `Bearer ${freeToken}`)
      .send(MINIMAL_SCAN_BODY);

    assert.equal(res.status, 403, `Expected 403 quota block but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.message?.toLowerCase().includes("limit") || res.body.message?.toLowerCase().includes("scan"),
      `403 body should explain scan limit; got: "${res.body.message}"`);
    assert.equal(res.body.scansRemaining, 0);
  });

  test("unauthenticated scan returns 401", async () => {
    const res = await request
      .post("/api/scan/recognize")
      .send(MINIMAL_SCAN_BODY);
    assert.equal(res.status, 401);
  });
});

describe("POST /api/scan/recognize — Pro user is not blocked", () => {
  let proToken: string;
  let proUserId: string;

  before(async () => {
    const user = await createTestUser({
      email: `${TAG}quota_pro@example.com`,
      subscriptionTier: "pro",
    });
    proToken = user.accessToken;
    proUserId = user.user.id;
  });

  test("Pro user with 30 scans is not blocked (returns non-403)", async () => {
    // Seed 30 scans — a free user here would get 403
    await setScanCount(proUserId, 30);

    const res = await request
      .post("/api/scan/recognize")
      .set("Authorization", `Bearer ${proToken}`)
      .send(MINIMAL_SCAN_BODY);

    assert.notEqual(res.status, 403, `Pro user should not be quota-blocked but got 403: ${JSON.stringify(res.body)}`);
    // scanLimit should be null for Pro (no cap)
    if ("scanLimit" in res.body) {
      assert.equal(res.body.scanLimit, null, "Pro user scanLimit should be null");
    }
  });

  test("Pro user scan usage response has null scanLimit", async () => {
    const res = await request
      .get("/api/scan/usage")
      .set("Authorization", `Bearer ${proToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.scanLimit, null, "Pro users have no scan cap");
    assert.equal(res.body.scansRemaining, null);
  });
});
