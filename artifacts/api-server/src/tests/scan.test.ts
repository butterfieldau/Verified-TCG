/**
 * Scan rate-limit integration tests
 *
 * Verifies quota enforcement via the real POST /api/scan/recognize endpoint.
 * Recognition dependencies are intentionally treated as fallible. The API
 * test image is a valid tiny JPEG so request validation and quota behavior do
 * not depend on malformed bytes or absent managed keys.
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
import {
  hasPersistedRecognitionEvidence,
  rankEvidenceMatches,
  recognitionEvidenceStatus,
  validateImagePayload,
} from "../routes/scan.js";

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

// Complete, decodable 2×2 JPEG (JFIF/SOF/SOS/EOI), rather than a magic-byte
// stub. It exercises the same container accepted from Expo camera.
const VALID_TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
const MINIMAL_SCAN_BODY = {
  image: VALID_TINY_JPEG_BASE64,
  mimeType: "image/jpeg",
};

describe("scan evidence guards", () => {
  const extracted = { game: "Pokemon", name: "Pikachu", setName: "Base Set", number: "25/102" };
  const exactCard = { id: "pika-25", game: "Pokemon", name: "Pikachu", set_name: "Base Set", number: "25/102" };

  test("validates MIME and matching image signature", () => {
    const jpeg = VALID_TINY_JPEG_BASE64;
    assert.equal(validateImagePayload(jpeg, "image/jpeg").mimeType, "image/jpeg");
    assert.throws(() => validateImagePayload(jpeg, "image/png"));
    assert.throws(() => validateImagePayload("not-base64!", "image/jpeg"));
    assert.throws(() => validateImagePayload(jpeg, "image/gif"));
    assert.throws(() => validateImagePayload(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"), "image/jpeg"));
    assert.throws(() => validateImagePayload(Buffer.from(jpeg, "base64").subarray(0, 80).toString("base64"), "image/jpeg"));
  });

  test("requires exact game, set, collector number, and a corroborated name", () => {
    assert.equal(rankEvidenceMatches([exactCard], extracted).candidates.length, 1);
    assert.equal(rankEvidenceMatches([{ ...exactCard, name: "Charizard" }], extracted).candidates.length, 0);
    assert.equal(rankEvidenceMatches([{ ...exactCard, set_name: "Jungle" }], extracted).candidates.length, 0);
    assert.equal(rankEvidenceMatches([{ ...exactCard, number: "26/102" }], extracted).candidates.length, 0);
    assert.equal(rankEvidenceMatches([{ ...exactCard, game: "Magic" }], extracted).candidates.length, 0);
    assert.equal(rankEvidenceMatches([{ ...exactCard, game: "Digimon" }], { ...extracted, game: "Digimon" }).candidates.length, 0);
  });

  test("permits a unique exact numerator when set OCR is absent, but never guesses variants", () => {
    const noSet = { ...extracted, setName: "", number: "25" };
    const unique = rankEvidenceMatches([exactCard], noSet);
    assert.equal(unique.candidates.length, 1);
    assert.equal(unique.ambiguous, true);
    const ambiguous = rankEvidenceMatches([exactCard, { ...exactCard, id: "variant" }], noSet);
    assert.equal(ambiguous.ambiguous, true);
    assert.equal(ambiguous.candidates.length, 2);
    assert.equal(rankEvidenceMatches([{ ...exactCard, number: "125/102" }], noSet).candidates.length, 0);
  });

  test("never auto-matches Pokemon Pikachu 58 without full number and set evidence", () => {
    const partial = { game: "Pokemon", name: "Pikachu", setName: "", number: "58" };
    const one = rankEvidenceMatches([
      { id: "base-58", game: "Pokemon", name: "Pikachu", set_name: "Base Set", number: "58/102" },
    ], partial);
    assert.equal(one.ambiguous, true);
    const acrossSets = rankEvidenceMatches([
      { id: "base-58", game: "Pokemon", name: "Pikachu", set_name: "Base Set", number: "58/102" },
      { id: "other-58", game: "Pokemon", name: "Pikachu", set_name: "Other Set", number: "58/100" },
    ], partial);
    assert.equal(acrossSets.ambiguous, true);
    assert.equal(acrossSets.candidates.length, 2);
  });

  test("distinguishes unsupported and insufficient extraction evidence", () => {
    assert.equal(recognitionEvidenceStatus({ game: "Digimon", name: "Agumon", setName: "BT1", number: "1/100" }), "unsupported");
    assert.equal(recognitionEvidenceStatus({ game: "Pokemon", name: "Pikachu", setName: "", number: "" }), "insufficient_evidence");
    assert.equal(recognitionEvidenceStatus({ game: "", name: "", setName: "", number: "" }), "unreadable");
  });

  test("marks multiple canonical variants as ambiguous", () => {
    const ranked = rankEvidenceMatches([
      exactCard,
      { ...exactCard, id: "pika-25-reverse" },
    ], extracted);
    assert.equal(ranked.ambiguous, true);
    assert.equal(ranked.candidates.length, 2);
  });

  test("uses persisted public-card evidence without requiring a provider result", () => {
    const persistedPublicCard = {
      ...exactCard,
      id: "persisted-justtcg-id",
      image_url: "https://images.example.test/pikachu.jpg",
      variants: [],
    };
    assert.equal(hasPersistedRecognitionEvidence([persistedPublicCard], extracted), true);
    assert.equal(hasPersistedRecognitionEvidence([], extracted), false);
  });
});

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

  test("rejects malformed payload before reserving quota", async () => {
    await setScanCount(freeUserId, 0);
    const res = await request
      .post("/api/scan/recognize")
      .set("Authorization", `Bearer ${freeToken}`)
      .send({ image: "not base64!", mimeType: "image/jpeg" });
    assert.equal(res.status, 400);

    const usage = await request
      .get("/api/scan/usage")
      .set("Authorization", `Bearer ${freeToken}`);
    assert.equal(usage.status, 200);
    assert.equal(usage.body.scansUsed, 0);
  });

  test("a completed unreadable recognition consumes its reserved quota", async () => {
    await setScanCount(freeUserId, 0);
    const res = await request
      .post("/api/scan/recognize")
      .set("Authorization", `Bearer ${freeToken}`)
      .send(MINIMAL_SCAN_BODY);
    assert.equal(res.status, 200);
    assert.equal(res.body.recognitionStatus, "unreadable");
    assert.equal(res.body.countsTowardLimit, true);
    assert.equal(res.body.scansUsed, 1);
    assert.equal(res.body.scanLimit, 30);
    const usage = await request
      .get("/api/scan/usage")
      .set("Authorization", `Bearer ${freeToken}`);
    assert.equal(usage.body.scansUsed, 1);
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
