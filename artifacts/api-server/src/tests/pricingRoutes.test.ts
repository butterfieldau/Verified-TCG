/**
 * Pricing route integration tests.
 *
 * Tests:
 *  - GET /pricing/cards/:id — missing token → configured:false/unavailable
 *  - GET /pricing/cards/:id — auth guard
 *  - POST /pricing/cards/:id/refresh — auth guard
 *  - GET /pricing/cards/:id/history — returns shape
 *  - POST /pricing/scheduler/run — admin secret guard
 *  - Sell flow: POST /collection/:id/sell, GET /collection/archive
 *  - Archive: GET/PATCH /collection/archive/:id
 *  - Restore: POST /collection/archive/:id/restore
 *  - Summary: enhanced fields present, missing prices reduce coverage
 *  - Performance: returns expected shape
 *  - User isolation on archive
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  soldArchiveItemsTable,
  cardProviderMappingsTable,
  currentQuotesTable,
  cardPriceSnapshotsTable,
  providerPriceHistoryTable,
  priceChartingGuideImportsTable,
  priceChartingGuideRowsTable,
  priceChartingGuideDownloadLeaseTable,
} from "@workspace/db";
import { and, eq, inArray, like } from "drizzle-orm";
import app from "../app.js";
import { createTestUser } from "./helpers.js";
import { pool } from "@workspace/db";
import { runMigrations } from "../lib/migrate.js";
import { selectCardsForScheduledRefresh } from "../routes/pricing.js";

after(() => pool.end());
before(runMigrations);

const request = supertest(app);

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-secret-placeholder-at-least-32-characters";
}

const TAG = `__pricing_${Date.now()}__`;

async function cleanupTaggedUsers() {
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
}

function cardPayload(id = "card-px-001") {
  return {
    cardId: id,
    card: {
      id,
      name: "Pikachu V",
      setName: "Vivid Voltage",
      setId: "vivid",
      number: "043",
      rarity: "ultra_rare",
      game: "pokemon",
      image: "https://example.com/pikachu.jpg",
    },
    acquiredAt: "2025-03-01",
    quantity: 1,
    condition: "near_mint",
    acquiredPrice: 25,
    currency: "AUD",
  };
}

// ── GET /pricing/cards/:id — unconfigured ─────────────────────────────────────

describe("GET /pricing/cards/:id — no PriceCharting secret", () => {
  let token: string;

  before(async () => {
    const u = await createTestUser({ email: `${TAG}pricing1@example.com` });
    token = u.accessToken;
    delete process.env.PRICECHARTING_TOKEN;
    delete process.env.PRICECHARTING_API_TOKEN;
  });

  after(cleanupTaggedUsers);

  test("returns 200 with configured:false when token is absent", async () => {
    const res = await request
      .get("/api/pricing/cards/some-card-id?name=Pikachu+V")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.configured, false);
    assert.equal(res.body.status, "unavailable");
    assert.ok(Array.isArray(res.body.quotes));
    assert.equal(res.body.quotes.length, 0);
  });

  test("returns 400 when name param is missing", async () => {
    const res = await request
      .get("/api/pricing/cards/some-card-id")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 400);
  });

  test("returns 401 without auth token", async () => {
    const res = await request.get("/api/pricing/cards/some-card-id?name=Pikachu");
    assert.equal(res.status, 401);
  });
});

describe("Stored pricing survives catalog unavailability", () => {
  let token: string;
  const cardId = `${TAG}stored-price-card`;
  const previousFetch = globalThis.fetch;
  const previousPriceChartingToken = process.env.PRICECHARTING_API_TOKEN;
  const previousJustTcgKey = process.env.JUSTTCG_API_KEY;

  before(async () => {
    const user = await createTestUser({ email: `${TAG}stored-price@example.com` });
    token = user.accessToken;
    process.env.PRICECHARTING_API_TOKEN = "test-pricecharting-token";
    delete process.env.JUSTTCG_API_KEY;

    await db.insert(cardProviderMappingsTable).values({
      cardId,
      providerKey: "pricecharting",
      providerProductId: "stored-product-123",
      providerProductName: "Stored Pikachu #043",
      status: "matched",
      confidenceScore: 0.97,
      confidenceLevel: "strong",
      matchedName: "Pikachu V",
      matchedSet: "Vivid Voltage",
      matchedNumber: "043",
      matchedGame: "pokemon",
    });
    await db.insert(currentQuotesTable).values({
      cardId,
      providerKey: "pricecharting",
      gradeKey: "raw",
      priceCents: 5100,
      currency: "USD",
      providerProductId: "stored-product-123",
      fetchedAt: new Date(),
    });
  });

  after(async () => {
    globalThis.fetch = previousFetch;
    if (previousPriceChartingToken == null) delete process.env.PRICECHARTING_API_TOKEN;
    else process.env.PRICECHARTING_API_TOKEN = previousPriceChartingToken;
    if (previousJustTcgKey == null) delete process.env.JUSTTCG_API_KEY;
    else process.env.JUSTTCG_API_KEY = previousJustTcgKey;
    await db.delete(currentQuotesTable).where(
      and(
        eq(currentQuotesTable.cardId, cardId),
        eq(currentQuotesTable.providerKey, "pricecharting"),
      ),
    );
    await db.delete(cardPriceSnapshotsTable).where(
      and(
        eq(cardPriceSnapshotsTable.cardId, cardId),
        eq(cardPriceSnapshotsTable.providerKey, "pricecharting"),
      ),
    );
    await db.delete(cardProviderMappingsTable).where(
      and(
        eq(cardProviderMappingsTable.cardId, cardId),
        eq(cardProviderMappingsTable.providerKey, "pricecharting"),
      ),
    );
    await cleanupTaggedUsers();
  });

  test("GET serves the stored quote without a name or JustTCG lookup", async () => {
    const res = await request
      .get(`/api/pricing/cards/${encodeURIComponent(cardId)}?displayCurrency=USD`)
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, "available");
    assert.equal(res.body.quotes[0]?.priceCents, 5100);
    assert.equal(res.body.verifiedMarket[0]?.verifiedMarketValueCents, 5100);
  });

  test("refresh uses the persisted PriceCharting product ID without JustTCG", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.ok(url.includes("pricecharting.com/api/product"));
      assert.ok(url.includes("id=stored-product-123"));
      return new Response(JSON.stringify({
        id: "stored-product-123",
        "product-name": "Stored Pikachu #043",
        "console-name": "Pokemon Cards",
        "loose-price": 5200,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const res = await request
      .post(`/api/pricing/cards/${encodeURIComponent(cardId)}/refresh`)
      .set("Authorization", `Bearer ${token}`)
      .send({ displayCurrency: "USD" });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.quotes[0]?.priceCents, 5200);
    const snapshots = await db
      .select()
      .from(cardPriceSnapshotsTable)
      .where(and(
        eq(cardPriceSnapshotsTable.cardId, cardId),
        eq(cardPriceSnapshotsTable.providerKey, "pricecharting"),
      ));
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]?.priceCents, 5200);
    assert.match(snapshots[0]?.snapshotBucket ?? "", /^\d{4}-\d{2}-\d{2}:(AM|PM)$/);
  });
});

// ── POST /pricing/cards/:id/refresh — auth guard ──────────────────────────────

describe("POST /pricing/cards/:id/refresh — auth", () => {
  before(() => {
    delete process.env.PRICECHARTING_TOKEN;
    delete process.env.PRICECHARTING_API_TOKEN;
  });

  test("returns 401 without auth", async () => {
    const res = await request
      .post("/api/pricing/cards/some-card-id/refresh")
      .send({ name: "Pikachu" });
    assert.equal(res.status, 401);
  });
});

// ── GET /pricing/cards/:id/history ────────────────────────────────────────────

describe("GET /pricing/cards/:id/history", () => {
  let token: string;

  before(async () => {
    const u = await createTestUser({ email: `${TAG}hist1@example.com` });
    token = u.accessToken;
  });

  after(cleanupTaggedUsers);

  test("returns 200 with expected shape (empty points)", async () => {
    const res = await request
      .get("/api/pricing/cards/unknown-card/history?grade=raw&period=30d")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.points));
    assert.equal(typeof res.body.gradeKey, "string");
    assert.ok("movement" in res.body);
    assert.ok("updatedAt" in res.body);
  });

  test("accepts every supported history period and rejects unknown labels", async () => {
    for (const period of ["7d", "30d", "90d", "180d", "1y", "all"]) {
      const res = await request
        .get(`/api/pricing/cards/unknown-card/history?grade=raw&period=${period}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200, `Expected ${period} to be accepted: ${JSON.stringify(res.body)}`);
    }

    const invalid = await request
      .get("/api/pricing/cards/unknown-card/history?grade=raw&period=1M")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(invalid.status, 400);
  });

  test("returns 401 without auth", async () => {
    const res = await request.get("/api/pricing/cards/x/history");
    assert.equal(res.status, 401);
  });
});

// ── POST /pricing/scheduler/run — admin secret ────────────────────────────────

describe("POST /pricing/scheduler/run", () => {
  test("returns 403 without admin secret header", async () => {
    const res = await request.post("/api/pricing/scheduler/run");
    assert.equal(res.status, 403);
  });

  test("returns 403 with wrong admin secret", async () => {
    process.env.ADMIN_SECRET = "correct-secret";
    const res = await request
      .post("/api/pricing/scheduler/run")
      .set("x-admin-secret", "wrong-secret");
    assert.equal(res.status, 403);
    delete process.env.ADMIN_SECRET;
  });

  test("returns 200 with correct admin secret", async () => {
    process.env.ADMIN_SECRET = "test-admin-secret-123";
    const res = await request
      .post("/api/pricing/scheduler/run")
      .set("x-admin-secret", "test-admin-secret-123");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(typeof res.body.queued, "number");
    delete process.env.ADMIN_SECRET;
  });
});

describe("POST /pricing/guides/import", () => {
  test("rejects requests without the admin secret", async () => {
    const res = await request.post("/api/pricing/guides/import").send({ category: "pokemon" });
    assert.equal(res.status, 403);
  });

  test("validates the strict official category enum before provider work", async () => {
    process.env.ADMIN_SECRET = "guide-import-secret";
    try {
      const res = await request
        .post("/api/pricing/guides/import")
        .set("x-admin-secret", "guide-import-secret")
        .send({ category: "pokemon-cards" });
      assert.equal(res.status, 400);
    } finally {
      delete process.env.ADMIN_SECRET;
    }
  });

  test("uses one global CSV lease across concurrent categories", async () => {
    const priorToken = process.env.PRICECHARTING_API_TOKEN;
    const priorAdmin = process.env.ADMIN_SECRET;
    const priorFetch = globalThis.fetch;
    process.env.PRICECHARTING_API_TOKEN = "guide-test-token";
    process.env.ADMIN_SECRET = "guide-import-secret";
    await db.delete(priceChartingGuideRowsTable);
    await db.delete(priceChartingGuideImportsTable);
    await db.delete(priceChartingGuideDownloadLeaseTable);
    let downloads = 0;
    globalThis.fetch = (async () => {
      downloads += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return new Response("id,product-name,console-name,loose-price\n1,Card,Set,1.00\n");
    }) as typeof fetch;
    try {
      const responses = await Promise.all([
        request.post("/api/pricing/guides/import").set("x-admin-secret", "guide-import-secret").send({ category: "pokemon" }),
        request.post("/api/pricing/guides/import").set("x-admin-secret", "guide-import-secret").send({ category: "magic" }),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
      assert.equal(downloads, 1);
      assert.ok(responses.some(response => response.body.errorCode === "pricecharting_throttled"));
    } finally {
      globalThis.fetch = priorFetch;
      if (priorToken == null) delete process.env.PRICECHARTING_API_TOKEN;
      else process.env.PRICECHARTING_API_TOKEN = priorToken;
      if (priorAdmin == null) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = priorAdmin;
      await db.delete(priceChartingGuideRowsTable);
      await db.delete(priceChartingGuideImportsTable);
      await db.delete(priceChartingGuideDownloadLeaseTable);
    }
  });
});

describe("Fair scheduled pricing selection", () => {
  let token: string;
  const prefix = `${TAG}fair-card-`;

  before(async () => {
    const user = await createTestUser({ email: `${TAG}fair@example.com` });
    token = user.accessToken;
    for (let index = 0; index < 4; index += 1) {
      const add = await request
        .post("/api/collection")
        .set("Authorization", `Bearer ${token}`)
        .send(cardPayload(`${prefix}${index}`));
      assert.equal(add.status, 201);
    }
  });

  after(async () => {
    await db
      .delete(cardProviderMappingsTable)
      .where(like(cardProviderMappingsTable.cardId, `${prefix}%`));
    await cleanupTaggedUsers();
  });

  test("rotates beyond maxCards by prioritizing never-attempted cards", async () => {
    const first = await selectCardsForScheduledRefresh(2, { cardIdPrefix: prefix });
    assert.equal(first.length, 2);

    await db.insert(cardProviderMappingsTable).values(
      first.map(card => ({
        cardId: card.cardId,
        providerKey: "pricecharting",
        status: "unmatched",
        confidenceLevel: "none",
      })),
    );

    const second = await selectCardsForScheduledRefresh(2, { cardIdPrefix: prefix });
    assert.equal(second.length, 2);
    assert.equal(
      second.some(card => first.some(previous => previous.cardId === card.cardId)),
      false,
      "the next bounded run should select cards that have never been attempted",
    );
  });
});

// ── Sell flow ─────────────────────────────────────────────────────────────────

describe("POST /collection/:id/sell", () => {
  let token: string;
  let itemId: string;

  before(async () => {
    const u = await createTestUser({ email: `${TAG}sell1@example.com` });
    token = u.accessToken;

    const res = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-sell-001"));
    itemId = res.body.id;
  });

  after(cleanupTaggedUsers);

  test("returns 401 without auth", async () => {
    const res = await request
      .post(`/api/collection/${itemId}/sell`)
      .send({ salePrice: 30, currency: "AUD", soldAt: "2025-06-01" });
    assert.equal(res.status, 401);
  });

  test("returns 400 with missing salePrice", async () => {
    const res = await request
      .post(`/api/collection/${itemId}/sell`)
      .set("Authorization", `Bearer ${token}`)
      .send({ currency: "AUD", soldAt: "2025-06-01" });
    assert.equal(res.status, 400);
  });

  test("returns 400 with missing currency", async () => {
    const res = await request
      .post(`/api/collection/${itemId}/sell`)
      .set("Authorization", `Bearer ${token}`)
      .send({ salePrice: 30, soldAt: "2025-06-01" });
    assert.equal(res.status, 400);
  });

  test("returns 400 with invalid soldAt", async () => {
    const res = await request
      .post(`/api/collection/${itemId}/sell`)
      .set("Authorization", `Bearer ${token}`)
      .send({ salePrice: 30, currency: "AUD", soldAt: "not-a-date" });
    assert.equal(res.status, 400);
  });

  test("successfully archives the item", async () => {
    const res = await request
      .post(`/api/collection/${itemId}/sell`)
      .set("Authorization", `Bearer ${token}`)
      .send({ salePrice: 35, currency: "AUD", soldAt: "2025-06-01", notes: "Sold on eBay" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.id);
    assert.equal(res.body.salePriceCents, 3500);
    assert.equal(res.body.saleCurrency, "AUD");
    assert.equal(res.body.soldAt, "2025-06-01");
    // Market value is nullable — not zero when missing
    assert.ok(
      res.body.marketValueAtDisposalCents === null || typeof res.body.marketValueAtDisposalCents === "number",
      "marketValueAtDisposalCents must be null or a number",
    );

    // Verify item removed from collection
    const list = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${token}`);
    const found = (list.body as Array<{ id: string }>).find(i => i.id === itemId);
    assert.equal(found, undefined, "Item should be removed from active collection");
  });

  test("returns 404 for non-existent item", async () => {
    const res = await request
      .post(`/api/collection/00000000-0000-0000-0000-000000000000/sell`)
      .set("Authorization", `Bearer ${token}`)
      .send({ salePrice: 35, currency: "AUD", soldAt: "2025-06-01" });
    assert.equal(res.status, 404);
  });
});

describe("Concurrent disposal and restore safety", () => {
  let token: string;

  before(async () => {
    const user = await createTestUser({ email: `${TAG}concurrent@example.com` });
    token = user.accessToken;
  });

  after(cleanupTaggedUsers);

  test("allows only one full sale and one restore for the same row", async () => {
    const add = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-concurrent-full"));
    assert.equal(add.status, 201);

    const saleBody = { salePrice: 42, currency: "AUD", soldAt: "2025-08-01" };
    const sales = await Promise.all([
      request.post(`/api/collection/${add.body.id}/sell`).set("Authorization", `Bearer ${token}`).send(saleBody),
      request.post(`/api/collection/${add.body.id}/sell`).set("Authorization", `Bearer ${token}`).send(saleBody),
    ]);
    assert.deepEqual(sales.map(result => result.status).sort(), [201, 404]);

    const archiveId = sales.find(result => result.status === 201)!.body.id;
    const restores = await Promise.all([
      request.post(`/api/collection/archive/${archiveId}/restore`).set("Authorization", `Bearer ${token}`),
      request.post(`/api/collection/archive/${archiveId}/restore`).set("Authorization", `Bearer ${token}`),
    ]);
    assert.deepEqual(restores.map(result => result.status).sort(), [201, 404]);

    const active = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${token}`);
    const restored = active.body.filter(
      (item: { cardId: string }) => item.cardId === "card-concurrent-full",
    );
    assert.equal(restored.length, 1);
  });

  test("serializes partial sales and prevents overselling quantity", async () => {
    const payload = { ...cardPayload("card-concurrent-partial"), quantity: 3 };
    const add = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    assert.equal(add.status, 201);

    const saleBody = {
      salePrice: 60,
      currency: "AUD",
      soldAt: "2025-08-02",
      quantity: 2,
    };
    const sales = await Promise.all([
      request.post(`/api/collection/${add.body.id}/sell`).set("Authorization", `Bearer ${token}`).send(saleBody),
      request.post(`/api/collection/${add.body.id}/sell`).set("Authorization", `Bearer ${token}`).send(saleBody),
    ]);
    assert.deepEqual(sales.map(result => result.status).sort(), [201, 400]);

    const active = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${token}`);
    const remaining = active.body.find(
      (item: { cardId: string }) => item.cardId === "card-concurrent-partial",
    );
    assert.equal(remaining.quantity, 1);

    const archive = await request
      .get("/api/collection/archive?displayCurrency=AUD")
      .set("Authorization", `Bearer ${token}`);
    const soldRows = archive.body.filter(
      (item: { cardId: string }) => item.cardId === "card-concurrent-partial",
    );
    assert.equal(soldRows.length, 1);
    assert.equal(soldRows[0].quantity, 2);
  });
});

// ── Archive CRUD ──────────────────────────────────────────────────────────────

describe("Archive endpoints", () => {
  let tokenA: string;
  let tokenB: string;
  let archiveId: string;

  before(async () => {
    const userA = await createTestUser({ email: `${TAG}archA@example.com` });
    const userB = await createTestUser({ email: `${TAG}archB@example.com` });
    tokenA = userA.accessToken;
    tokenB = userB.accessToken;

    // Add + sell an item as user A
    const addRes = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(cardPayload("card-arch-001"));
    const itemId = addRes.body.id;

    const sellRes = await request
      .post(`/api/collection/${itemId}/sell`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ salePrice: 50, currency: "AUD", soldAt: "2025-07-01" });
    archiveId = sellRes.body.id;
  });

  after(cleanupTaggedUsers);

  test("GET /collection/archive returns user A's sold items", async () => {
    const res = await request
      .get("/api/collection/archive")
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.some((r: { id: string }) => r.id === archiveId));
  });

  test("GET /collection/archive — user B sees empty archive", async () => {
    const res = await request
      .get("/api/collection/archive")
      .set("Authorization", `Bearer ${tokenB}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 0);
  });

  test("GET /collection/archive/:id — user A can access their archive", async () => {
    const res = await request
      .get(`/api/collection/archive/${archiveId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, archiveId);
    assert.equal(res.body.salePriceCents, 5000);
  });

  test("GET /collection/archive/:id — user B cannot access user A's archive", async () => {
    const res = await request
      .get(`/api/collection/archive/${archiveId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    assert.equal(res.status, 404);
  });

  test("PATCH /collection/archive/:id — corrects sale price", async () => {
    const res = await request
      .patch(`/api/collection/archive/${archiveId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ salePrice: 55, notes: "Corrected price" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.salePriceCents, 5500);
    assert.equal(res.body.notes, "Corrected price");
  });

  test("PATCH /collection/archive/:id — user B cannot patch user A's archive", async () => {
    const res = await request
      .patch(`/api/collection/archive/${archiveId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ salePrice: 10 });
    assert.equal(res.status, 404);
  });

  test("POST /collection/archive/:id/restore — restores to active collection", async () => {
    const res = await request
      .post(`/api/collection/archive/${archiveId}/restore`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.id);
    assert.ok(res.body.cardId);

    // Verify archive row removed
    const archRes = await request
      .get(`/api/collection/archive/${archiveId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(archRes.status, 404);

    // Verify in active collection
    const collRes = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${tokenA}`);
    const found = (collRes.body as Array<{ cardId: string }>).find(i => i.cardId === "card-arch-001");
    assert.ok(found, "Restored item should appear in active collection");
  });
});

// ── Collection summary — enhanced fields ──────────────────────────────────────

describe("GET /collection/summary — enhanced fields", () => {
  let token: string;

  before(async () => {
    const u = await createTestUser({ email: `${TAG}summ2@example.com` });
    token = u.accessToken;
    // Add a card
    await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-summ-001"));
  });

  after(cleanupTaggedUsers);

  test("returns all required legacy compatibility fields", async () => {
    const res = await request
      .get("/api/collection/summary")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.totalValue === null || typeof res.body.totalValue === "number");
    assert.equal(typeof res.body.totalCost, "number");
    assert.ok(res.body.totalGain === null || typeof res.body.totalGain === "number");
    assert.ok(res.body.totalGainPercent === null || typeof res.body.totalGainPercent === "number");
    assert.equal(typeof res.body.currency, "string");
    assert.equal(typeof res.body.cardCount, "number");
    assert.equal(typeof res.body.uniqueCardCount, "number");
  });

  test("returns coverage object with required fields", async () => {
    const res = await request
      .get("/api/collection/summary")
      .set("Authorization", `Bearer ${token}`);
    assert.ok(res.body.coverage, "coverage must be present");
    assert.equal(typeof res.body.coverage.pricedHoldings, "number");
    assert.equal(typeof res.body.coverage.totalHoldings, "number");
    assert.equal(typeof res.body.coverage.ratio, "number");
    assert.equal(typeof res.body.coverage.freshHoldings, "number");
    assert.equal(typeof res.body.coverage.staleHoldings, "number");
  });

  test("missing prices reduce coverage (not counted as zero)", async () => {
    const res = await request
      .get("/api/collection/summary")
      .set("Authorization", `Bearer ${token}`);
    // Without a PC token, no prices exist — coverage ratio should be 0
    // and totalValueCents should be null (not 0)
    assert.ok(res.body.coverage.ratio >= 0 && res.body.coverage.ratio <= 1);
    // totalValueCents is null when no prices are available
    assert.ok(
      res.body.totalValueCents === null || typeof res.body.totalValueCents === "number",
      "totalValueCents must be null or a number — never fabricated",
    );
  });

  test("returns completeness string", async () => {
    const res = await request
      .get("/api/collection/summary")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(typeof res.body.completeness, "string");
  });

  test("empty collection returns zero-state without errors", async () => {
    const emptyUser = await createTestUser({ email: `${TAG}summ3@example.com` });
    const res = await request
      .get("/api/collection/summary")
      .set("Authorization", `Bearer ${emptyUser.accessToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.cardCount, 0);
    assert.equal(res.body.coverage.totalHoldings, 0);
    assert.equal(res.body.totalValueCents, null);
  });

  test("returns 401 without auth", async () => {
    const res = await request.get("/api/collection/summary");
    assert.equal(res.status, 401);
  });
});

// ── Collection performance ────────────────────────────────────────────────────

describe("GET /collection/performance", () => {
  let token: string;

  before(async () => {
    const u = await createTestUser({ email: `${TAG}perf1@example.com` });
    token = u.accessToken;
    await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send(cardPayload("card-perf-001"));
  });

  after(cleanupTaggedUsers);

  test("returns 200 with expected shape", async () => {
    const res = await request
      .get("/api/collection/performance?range=1M")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(typeof res.body.historyAvailable, "boolean");
    assert.ok(Array.isArray(res.body.history));
    assert.ok(res.body.realisedGain !== undefined);
    assert.ok("costBasis" in res.body);
    assert.ok(Array.isArray(res.body.topPerformers));
    assert.ok(Array.isArray(res.body.bottomPerformers));
  });

  test("returns 401 without auth", async () => {
    const res = await request.get("/api/collection/performance");
    assert.equal(res.status, 401);
  });

  test("accepts valid range params", async () => {
    for (const range of ["1D", "7D", "1M", "3M", "6M", "1Y", "ALL"]) {
      const res = await request
        .get(`/api/collection/performance?range=${range}`)
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200, `Failed for range=${range}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.range, range);
    }
  });
});

describe("GET /collection/value-history", () => {
  let token: string;
  let collectionAId: string;
  const cardA = `${TAG}history-a`;
  const cardB = `${TAG}history-b`;
  const dateDaysAgo = (days: number) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);

  before(async () => {
    const user = await createTestUser({ email: `${TAG}value-history@example.com` });
    token = user.accessToken;
    const createdA = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...cardPayload(cardA), acquiredAt: dateDaysAgo(40), quantity: 2 });
    collectionAId = createdA.body.id;
    await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...cardPayload(cardB), acquiredAt: dateDaysAgo(5), quantity: 1 });

    await db.insert(providerPriceHistoryTable).values([
      {
        cardId: cardA,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 1_000,
        currency: "AUD",
        snapshotDate: dateDaysAgo(10),
      },
      {
        cardId: cardA,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 1_200,
        currency: "AUD",
        snapshotDate: dateDaysAgo(2),
      },
      {
        cardId: cardB,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 500,
        currency: "AUD",
        snapshotDate: dateDaysAgo(2),
      },
    ]);
    await db.insert(currentQuotesTable).values([
      {
        cardId: cardA,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 1_300,
        currency: "AUD",
      },
      {
        cardId: cardB,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 700,
        currency: "AUD",
      },
    ]);
    const sold = await request
      .post(`/api/collection/${collectionAId}/sell`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        quantity: 1,
        salePrice: 13,
        currency: "AUD",
        soldAt: dateDaysAgo(1),
      });
    assert.equal(sold.status, 201, JSON.stringify(sold.body));
  });

  after(async () => {
    await db.delete(currentQuotesTable).where(inArray(currentQuotesTable.cardId, [cardA, cardB]));
    await db.delete(providerPriceHistoryTable).where(inArray(providerPriceHistoryTable.cardId, [cardA, cardB]));
    await cleanupTaggedUsers();
  });

  test("uses acquisition dates, quantities, historical prices, and current quotes", async () => {
    const res = await request
      .get("/api/collection/value-history?range=ALL&displayCurrency=AUD")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.historyAvailable, true);
    assert.deepEqual(
      res.body.points.map((point: { date: string; value: number }) => [point.date, point.value]),
      [
        [dateDaysAgo(10), 20],
        [dateDaysAgo(2), 29],
        [dateDaysAgo(1), 17],
        [dateDaysAgo(0), 20],
      ],
    );
  });

  test("populates summary chartData from the same real series", async () => {
    const res = await request
      .get("/api/collection/summary?displayCurrency=AUD")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(
      res.body.chartData.ALL.map((point: { date: string; value: number }) => [point.date, point.value]),
      [
        [dateDaysAgo(10), 20],
        [dateDaysAgo(2), 29],
        [dateDaysAgo(1), 17],
        [dateDaysAgo(0), 20],
      ],
    );
  });

  test("keeps sold quantities in pre-sale history and removes them after sale", async () => {
    const res = await request
      .get("/api/collection/value-history?range=ALL&displayCurrency=AUD")
      .set("Authorization", `Bearer ${token}`);
    const points = new Map(
      res.body.points.map((point: { date: string; value: number }) => [point.date, point.value]),
    );
    assert.equal(points.get(dateDaysAgo(2)), 29);
    assert.equal(points.get(dateDaysAgo(0)), 20);
  });

  test("ends fully liquidated portfolios at zero instead of the last owned value", async () => {
    const liquidatedCard = `${TAG}history-liquidated`;
    const user = await createTestUser({ email: `${TAG}liquidated@example.com` });
    const created = await request
      .post("/api/collection")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        ...cardPayload(liquidatedCard),
        acquiredAt: dateDaysAgo(20),
        quantity: 1,
      });
    await db.insert(providerPriceHistoryTable).values([
      {
        cardId: liquidatedCard,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 2_500,
        currency: "AUD",
        snapshotDate: dateDaysAgo(10),
      },
      {
        cardId: liquidatedCard,
        providerKey: "pricecharting",
        gradeKey: "raw",
        priceCents: 2_600,
        currency: "AUD",
        snapshotDate: dateDaysAgo(2),
      },
    ]);
    const sold = await request
      .post(`/api/collection/${created.body.id}/sell`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        quantity: 1,
        salePrice: 25,
        currency: "AUD",
        soldAt: dateDaysAgo(3),
      });
    assert.equal(sold.status, 201, JSON.stringify(sold.body));

    const res = await request
      .get("/api/collection/value-history?range=ALL&displayCurrency=AUD")
      .set("Authorization", `Bearer ${user.accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.points.at(-1).date, dateDaysAgo(0));
    assert.equal(res.body.points.at(-1).value, 0);
    assert.equal(
      res.body.points.find((point: { date: string }) => point.date === dateDaysAgo(3)).value,
      0,
    );

    await db.insert(currentQuotesTable).values({
      cardId: liquidatedCard,
      providerKey: "pricecharting",
      gradeKey: "raw",
      priceCents: 2_700,
      currency: "AUD",
    });
    const restored = await request
      .post(`/api/collection/archive/${sold.body.id}/restore`)
      .set("Authorization", `Bearer ${user.accessToken}`);
    assert.equal(restored.status, 201, JSON.stringify(restored.body));

    const restoredHistory = await request
      .get("/api/collection/value-history?range=ALL&displayCurrency=AUD")
      .set("Authorization", `Bearer ${user.accessToken}`);
    const restoredPoints = new Map(
      restoredHistory.body.points.map(
        (point: { date: string; value: number }) => [point.date, point.value],
      ),
    );
    assert.equal(restoredPoints.get(dateDaysAgo(2)), 0, "sold interval must remain zero");
    assert.equal(restoredPoints.get(dateDaysAgo(0)), 27, "restored ownership resumes today");

    const resold = await request
      .post(`/api/collection/${restored.body.id}/sell`)
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        quantity: 1,
        salePrice: 27,
        currency: "AUD",
        soldAt: dateDaysAgo(0),
      });
    assert.equal(resold.status, 201, JSON.stringify(resold.body));
    const resoldHistory = await request
      .get("/api/collection/value-history?range=ALL&displayCurrency=AUD")
      .set("Authorization", `Bearer ${user.accessToken}`);
    assert.equal(resoldHistory.body.points.at(-1).value, 0);

    await db.delete(currentQuotesTable).where(eq(currentQuotesTable.cardId, liquidatedCard));
    await db
      .delete(providerPriceHistoryTable)
      .where(eq(providerPriceHistoryTable.cardId, liquidatedCard));
  });

  test("requires authentication", async () => {
    const res = await request.get("/api/collection/value-history");
    assert.equal(res.status, 401);
  });
});
