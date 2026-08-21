import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { and, eq, like } from "drizzle-orm";
import { db, pool, priceSnapshotsTable, usersTable } from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { resetEbaySalesCachesForTests } from "../lib/ebaySales.js";
import { createTestUser } from "./helpers.js";

const request = supertest(app);
const TAG = `__ebay_history_${Date.now()}__`;
const previousClientId = process.env.EBAY_CLIENT_ID;
const previousClientSecret = process.env.EBAY_CLIENT_SECRET;
const previousEnvironment = process.env.EBAY_ENVIRONMENT;
const previousFetch = globalThis.fetch;

let token = "";
let freeToken = "";

function route({
  grade = "raw",
  period = "90d",
  currency = "USD",
  number = "025",
}: {
  grade?: string;
  period?: string;
  currency?: string;
  number?: string;
} = {}): string {
  return `/api/catalog/cards/card-ebay-history/ebay-sold-history?name=Pikachu&set=Base+Set&game=pokemon&number=${encodeURIComponent(number)}&grade=${grade}&period=${period}&displayCurrency=${currency}`;
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3_600 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function salesResponse(items: unknown[], total = items.length): Response {
  return new Response(JSON.stringify({ itemSales: items, total }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sale({
  title,
  price,
  currency = "USD",
  endedAt,
  url,
}: {
  title: string;
  price: string;
  currency?: string;
  endedAt: string;
  url: string;
}) {
  return {
    title,
    lastSoldDate: endedAt,
    condition: "USED",
    itemWebUrl: url,
    price: { value: price, currency },
  };
}

before(async () => {
  await runMigrations();
  const user = await createTestUser({ email: `${TAG}@example.com`, subscriptionTier: "pro" });
  token = user.accessToken;
  const freeUser = await createTestUser({ email: `${TAG}-free@example.com`, subscriptionTier: "free" });
  freeToken = freeUser.accessToken;
});

beforeEach(() => {
  resetEbaySalesCachesForTests();
  process.env.EBAY_CLIENT_ID = "production-client-id";
  process.env.EBAY_CLIENT_SECRET = "production-client-secret";
  process.env.EBAY_ENVIRONMENT = "production";
});

after(async () => {
  process.env.EBAY_CLIENT_ID = previousClientId;
  process.env.EBAY_CLIENT_SECRET = previousClientSecret;
  process.env.EBAY_ENVIRONMENT = previousEnvironment;
  globalThis.fetch = previousFetch;
  await db.delete(priceSnapshotsTable).where(like(priceSnapshotsTable.cardId, `%${TAG}%`));
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
  await pool.end();
});

describe("GET /catalog/cards/:id/ebay-sold-history", () => {
  test("requires an authenticated Pro collector", async () => {
    const response = await request.get(route());
    assert.equal(response.status, 401);
  });

  test("does not expose sold history to Free collectors", async () => {
    const response = await request.get(route()).set("Authorization", `Bearer ${freeToken}`);
    assert.equal(response.status, 403);
  });

  test("reports missing OAuth configuration explicitly", async () => {
    delete process.env.EBAY_CLIENT_SECRET;
    const response = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.source, "ebay_completed_sales");
    assert.equal(response.body.availability, "configuration_error");
    assert.equal(response.body.configured, false);
    assert.deepEqual(response.body.sales, []);
  });

  test("uses Marketplace Insights, validates matched completed sales, and derives its trend", async () => {
    const now = Date.now();
    const latest = new Date(now - 24 * 60 * 60 * 1_000).toISOString();
    const prior = new Date(now - 48 * 60 * 60 * 1_000).toISOString();
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${url} ${String(init?.body ?? "")}`);
      if (url.includes("/identity/v1/oauth2/token")) return tokenResponse();
      return salesResponse([
        sale({
          title: "Pikachu Base Set 025 NM",
          price: "120.00",
          endedAt: latest,
          url: "https://www.ebay.com/itm/123456?tracking=remove-me",
        }),
        sale({
          title: "Pikachu Base Set 025 LP",
          price: "100.00",
          endedAt: prior,
          url: "https://www.ebay.com/itm/654321",
        }),
        sale({
          title: "Pikachu Base Set 025 unsafe",
          price: "1.00",
          endedAt: latest,
          url: "https://not-ebay.example/itm/1",
        }),
        sale({
          title: "Pikachu Base Set 025 PSA 10",
          price: "1000.00",
          endedAt: latest,
          url: "https://www.ebay.com/itm/999999",
        }),
        sale({
          title: "Pikachu Base Set 026 NM",
          price: "1.00",
          endedAt: latest,
          url: "https://www.ebay.com/itm/111111",
        }),
        sale({
          title: "Pikachu Base Set 025 credentials",
          price: "5.00",
          endedAt: latest,
          url: "https://collector:secret@www.ebay.com/itm/888888",
        }),
      ], 6);
    }) as typeof fetch;

    const response = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.availability, "available", JSON.stringify(response.body));
    assert.equal(response.body.currency, "USD");
    assert.equal(response.body.sales.length, 2);
    assert.equal(response.body.sales[0].condition, "USED");
    assert.equal(response.body.sales[0].sourceCurrency, "USD");
    assert.equal(response.body.sales[0].url, "https://www.ebay.com/itm/123456");
    assert.equal(response.body.points.length, 2);
    assert.equal(response.body.movement.direction, "up");
    assert.equal(response.body.movement.percent, 20);
    assert.equal(response.body.coverage, "returned_results");
    assert.equal(JSON.stringify(response.body).includes("Pikachu&set"), false);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /identity\/v1\/oauth2\/token/);
    assert.match(calls[0]!, /scope=https%3A%2F%2Fapi\.ebay\.com%2Foauth%2Fapi_scope%2Fbuy\.marketplace\.insights/);
    assert.match(calls[1]!, /marketplace_insights\/v1_beta\/item_sales/);
    assert.doesNotMatch(calls[1]!, /findCompletedItems|FindingService/);
  });

  test("keeps OAuth and Marketplace Insights permission failures distinct from no-results", async () => {
    globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
    const unauthorized = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(unauthorized.status, 200);
    assert.equal(unauthorized.body.availability, "authorization_error");

    resetEbaySalesCachesForTests();
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes("/identity/v1/oauth2/token")) return tokenResponse();
      return new Response("", { status: 403 });
    }) as typeof fetch;
    const forbidden = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(forbidden.status, 200);
    assert.equal(forbidden.body.availability, "permission_error");

    resetEbaySalesCachesForTests();
    globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
    const upstream = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(upstream.status, 200);
    assert.equal(upstream.body.availability, "upstream_error");
  });

  test("reports a conversion failure rather than treating completed sales as no results", async () => {
    const endedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) return tokenResponse();
      if (url.includes("marketplace_insights")) {
        return salesResponse([sale({
          title: "Pikachu Base Set 025 NM",
          price: "100.00",
          currency: "USD",
          endedAt,
          url: "https://www.ebay.com/itm/123",
        })]);
      }
      return new Response("", { status: 503 });
    }) as typeof fetch;

    const response = await request.get(route({ currency: "AUD" })).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.availability, "conversion_error");
    assert.deepEqual(response.body.sales, []);
  });

  test("reports title-match misses as no-results without inventing a price", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes("/identity/v1/oauth2/token")) return tokenResponse();
      return salesResponse([]);
    }) as typeof fetch;

    const response = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.availability, "no_results");
    assert.deepEqual(response.body.sales, []);
    assert.deepEqual(response.body.points, []);
  });

  test("requires the full printed number, including a one-digit number and denominator", async () => {
    const endedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes("/identity/v1/oauth2/token")) return tokenResponse();
      return salesResponse([
        sale({
          title: "Pikachu Base Set 1/102 NM",
          price: "50.00",
          endedAt,
          url: "https://www.ebay.com/itm/exact",
        }),
        sale({
          title: "Pikachu Base Set 1/198 NM",
          price: "1.00",
          endedAt,
          url: "https://www.ebay.com/itm/wrong-denominator",
        }),
      ]);
    }) as typeof fetch;

    const response = await request.get(route({ number: "1/102" })).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.availability, "available");
    assert.equal(response.body.sales.length, 1);
    assert.equal(response.body.sales[0].url, "https://www.ebay.com/itm/exact");
  });
});

describe("completed-sale snapshots", () => {
  test("requires an active collector before starting external snapshot requests", async () => {
    const response = await request
      .post("/api/catalog/cards/snapshot-auth-test/snapshot-prices")
      .send({ name: "Pikachu", set: "Base Set", game: "pokemon", number: "025" });
    assert.equal(response.status, 401);
  });

  test("inserts only grades backed by successful Marketplace Insights sales", async () => {
    const cardId = `${TAG}-snapshot`;
    const endedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/identity/v1/oauth2/token")) return tokenResponse();
      if (url.startsWith("https://api.justtcg.com/")) {
        return new Response(JSON.stringify({
          data: [{ id: cardId, name: "Pikachu", set_name: "Base Set", game: "Pokemon", number: "025" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return salesResponse([sale({
        title: "Pikachu Base Set 025 NM",
        price: "50.00",
        currency: "AUD",
        endedAt,
        url: "https://www.ebay.com/itm/321",
      })]);
    }) as typeof fetch;

    const response = await request
      .post(`/api/catalog/cards/${cardId}/snapshot-prices`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Wrong Card", set: "Wrong Set", game: "magic", number: "99" });
    assert.equal(response.status, 204);

    let rows: { gradeKey: string; priceCents: number; source: string }[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      rows = await db
        .select({
          gradeKey: priceSnapshotsTable.gradeKey,
          priceCents: priceSnapshotsTable.priceCents,
          source: priceSnapshotsTable.source,
        })
        .from(priceSnapshotsTable)
        .where(eq(priceSnapshotsTable.cardId, cardId));
      if (rows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.deepEqual(rows, [{ gradeKey: "raw", priceCents: 5_000, source: "ebay_completed_sales" }]);
    assert.ok(calls.some((url) => url.includes("Pikachu") && url.includes("Base")));
    assert.equal(calls.some((url) => url.includes("Wrong")), false);
    await db.delete(priceSnapshotsTable).where(and(
      eq(priceSnapshotsTable.cardId, cardId),
      eq(priceSnapshotsTable.gradeKey, "raw"),
    ));
  });

  test("does not relabel legacy snapshot rows as verified completed-sales history", async () => {
    const cardId = `${TAG}-legacy`;
    await db.insert(priceSnapshotsTable).values({
      cardId,
      gradeKey: "raw",
      priceCents: 9_999,
      source: "ebay_sold",
    });
    const response = await request
      .get(`/api/catalog/cards/${cardId}/price-history?grade=raw&period=90D`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.points, []);
    assert.equal(response.body.source, "ebay_completed_sales");
    await db.delete(priceSnapshotsTable).where(eq(priceSnapshotsTable.cardId, cardId));
  });
});

describe("GET /graded-prices", () => {
  test("returns raw and grade medians only when exact completed-sale evidence exists", async () => {
    const endedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/identity/v1/oauth2/token")) return tokenResponse();
      const query = new URL(url).searchParams.get("q") ?? "";
      if (query.includes("PSA 10")) {
        return salesResponse([sale({
          title: "Pikachu Base Set 025 PSA 10",
          price: "200.00",
          currency: "AUD",
          endedAt,
          url: "https://www.ebay.com/itm/psa10",
        })]);
      }
      if (!/\b(?:PSA|CGC|BGS)\b/.test(query)) {
        return salesResponse([sale({
          title: "Pikachu Base Set 025 NM",
          price: "50.00",
          currency: "AUD",
          endedAt,
          url: "https://www.ebay.com/itm/raw",
        })]);
      }
      return salesResponse([]);
    }) as typeof fetch;

    const response = await request
      .get("/api/graded-prices?name=Pikachu&set=Base+Set&game=pokemon&number=025")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.availability, "available");
    assert.deepEqual(response.body.prices, { raw: 50, psa10: 200 });
    assert.equal(response.body.prices.psa9, undefined);
  });
});