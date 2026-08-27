/**
 * Collection API integration tests
 *
 * Tests CRUD for /api/collection including authentication, user isolation,
 * validation, and portfolio summary.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app.js";
import { createTestUser } from "./helpers.js";

// Close the DB pool after all tests so the process exits cleanly.
import { pool } from "@workspace/db";
after(() => pool.end());

const request = supertest(app);

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-secret-placeholder-at-least-32-characters";
}

const TAG = `__coll_${Date.now()}__`;

async function cleanupTaggedUsers() {
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
}

/** Minimal valid card payload for POST /api/collection */
function cardPayload(id = "card-001") {
  return {
    cardId: id,
    card: {
      id,
      name: "Charizard",
      setName: "Base Set",
      setId: "base",
      number: "4",
      rarity: "holo_rare",
      game: "Pokemon",
      image: "https://example.com/card.jpg",
      price: { raw: 100, currency: "AUD", updatedAt: new Date().toISOString() },
    },
    acquiredAt: "2025-01-15",
    quantity: 1,
    condition: "near_mint",
    acquiredPrice: 80,
  };
}

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("GET /api/collection — auth guard", () => {
  test("returns 401 without a token", async () => {
    const res = await request.get("/api/collection");
    assert.equal(res.status, 401);
  });

  test("returns 401 with a malformed token", async () => {
    const res = await request
      .get("/api/collection")
      .set("Authorization", "Bearer not-a-jwt");
    assert.equal(res.status, 401);
  });
});

// ── Add item ──────────────────────────────────────────────────────────────────

describe("POST /api/collection", () => {
  let token: string;

  before(async () => {
    const { accessToken } = await createTestUser({ email: `${TAG}add@example.com` });
    token = accessToken;
  });

  after(cleanupTaggedUsers);

  test("authenticated request creates and returns the item", async () => {
    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload());

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.id, "should return server-assigned id");
    assert.equal(res.body.cardId, "card-001");
    assert.equal(res.body.quantity, 1);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await request.post("/api/collection").send(cardPayload());
    assert.equal(res.status, 401);
  });

  test("missing cardId returns 400", async () => {
    const payload = { ...cardPayload() };
    delete (payload as Record<string, unknown>)["cardId"];
    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    assert.equal(res.status, 400);
  });

  test("missing card object returns 400", async () => {
    const payload = { ...cardPayload() };
    delete (payload as Record<string, unknown>)["card"];
    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    assert.equal(res.status, 400);
  });

  test("invalid condition returns 400", async () => {
    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...cardPayload(), condition: "perfect" }); // not a valid condition
    assert.equal(res.status, 400);
  });
});

// ── List items — user isolation ───────────────────────────────────────────────

describe("GET /api/collection — user isolation", () => {
  let tokenA: string;
  let tokenB: string;

  before(async () => {
    const userA = await createTestUser({ email: `${TAG}isola@example.com` });
    const userB = await createTestUser({ email: `${TAG}isolb@example.com` });
    tokenA = userA.accessToken;
    tokenB = userB.accessToken;

    // Add an item as user A
    await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(cardPayload("card-a"));
  });

  after(cleanupTaggedUsers);

  test("user A sees their own items", async () => {
    const res = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1, "user A should see at least 1 item");
  });

  test("user B sees an empty collection (not user A's items)", async () => {
    const res = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${tokenB}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 0, "user B should see 0 items");
  });
});

// ── Update item ───────────────────────────────────────────────────────────────

describe("PATCH /api/collection/:id", () => {
  let token: string;
  let itemId: string;

  before(async () => {
    const { accessToken } = await createTestUser({ email: `${TAG}patch@example.com` });
    token = accessToken;

    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-patch"));
    itemId = res.body.id;
  });

  after(cleanupTaggedUsers);

  test("updates quantity and returns the updated item", async () => {
    const res = await request
      .patch(`/api/collection/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 3 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.quantity, 3);
  });

  test("updates condition", async () => {
    const res = await request
      .patch(`/api/collection/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ condition: "good" });
    assert.equal(res.status, 200);
    assert.equal(res.body.condition, "good");
  });

  test("persists unit acquisition price, currency and acquisition date on edit", async () => {
    const res = await request
      .patch(`/api/collection/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ acquiredPrice: 100, currency: "USD", acquiredAt: "2025-02-03", quantity: 2 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.acquiredPrice, 100);
    assert.equal(res.body.currency, "USD");
    assert.equal(res.body.acquiredAt, "2025-02-03");
    assert.equal(res.body.quantity, 2);
  });

  test("rejects an invalid acquisition date", async () => {
    const res = await request
      .patch(`/api/collection/${itemId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ acquiredAt: "not-a-date" });
    assert.equal(res.status, 400);
  });

  test("returns 404 for unknown item id", async () => {
    const res = await request
      .patch("/api/collection/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 2 });
    assert.equal(res.status, 404);
  });

  test("unauthenticated returns 401", async () => {
    const res = await request
      .patch(`/api/collection/${itemId}`)
      .send({ quantity: 2 });
    assert.equal(res.status, 401);
  });
});

// ── Delete item ───────────────────────────────────────────────────────────────

describe("DELETE /api/collection/:id", () => {
  let token: string;
  let itemId: string;

  before(async () => {
    const { accessToken } = await createTestUser({ email: `${TAG}del@example.com` });
    token = accessToken;
    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-del"));
    itemId = res.body.id;
  });

  after(cleanupTaggedUsers);

  test("deletes the item and returns 200", async () => {
    const res = await request
      .delete(`/api/collection/${itemId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Verify it is gone
    const list = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(list.body.length, 0);
  });

  test("deleting an already-deleted item returns 404", async () => {
    const res = await request
      .delete(`/api/collection/${itemId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 404);
  });

  test("unauthenticated returns 401", async () => {
    const res = await request.delete(`/api/collection/${itemId}`);
    assert.equal(res.status, 401);
  });
});

// ── Portfolio summary ─────────────────────────────────────────────────────────

describe("GET /api/collection/summary", () => {
  let token: string;

  before(async () => {
    const { accessToken } = await createTestUser({ email: `${TAG}summ@example.com` });
    token = accessToken;
    // Add one item so summary is non-trivial
    await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-summ"));
  });

  after(cleanupTaggedUsers);

  test("returns an honest summary when prices are unavailable", async () => {
    const res = await request
      .get("/api/collection/summary")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.totalValue === null || typeof res.body.totalValue === "number");
    assert.equal(typeof res.body.cardCount, "number");
    assert.ok(res.body.cardCount >= 1);
  });

  test("unauthenticated returns 401", async () => {
    const res = await request.get("/api/collection/summary");
    assert.equal(res.status, 401);
  });
});
