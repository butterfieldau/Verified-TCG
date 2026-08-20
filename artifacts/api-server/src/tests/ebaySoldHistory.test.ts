import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db, pool, usersTable } from "@workspace/db";
import { like } from "drizzle-orm";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { createTestUser } from "./helpers.js";

const request = supertest(app);
const TAG = `__ebay_history_${Date.now()}__`;
const previousAppId = process.env.EBAY_APP_ID;
const previousFetch = globalThis.fetch;

let token = "";
let freeToken = "";

function route({ grade = "raw", period = "90d" }: { grade?: string; period?: string } = {}): string {
  return `/api/catalog/cards/card-ebay-history/ebay-sold-history?name=Pikachu&set=Base+Set&game=pokemon&grade=${grade}&period=${period}&displayCurrency=USD`;
}

before(async () => {
  await runMigrations();
  const user = await createTestUser({
    email: `${TAG}@example.com`,
    subscriptionTier: "pro",
  });
  token = user.accessToken;
  const freeUser = await createTestUser({
    email: `${TAG}-free@example.com`,
    subscriptionTier: "free",
  });
  freeToken = freeUser.accessToken;
});

after(async () => {
  process.env.EBAY_APP_ID = previousAppId;
  globalThis.fetch = previousFetch;
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

  test("reports missing production configuration explicitly", async () => {
    delete process.env.EBAY_APP_ID;
    const response = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.source, "ebay_completed_sales");
    assert.equal(response.body.availability, "configuration_error");
    assert.equal(response.body.configured, false);
    assert.deepEqual(response.body.sales, []);
  });

  test("normalizes completed sales and derives the trend from those sales", async () => {
    process.env.EBAY_APP_ID = "production-app-id";
    const now = Date.now();
    const latest = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const prior = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        findCompletedItemsResponse: [{
          ack: ["Success"],
          searchResult: [{
            item: [
              {
                title: ["Pikachu Base Set NM"],
                viewItemURL: ["https://www.ebay.com/itm/123456?tracking=remove-me"],
                listingInfo: [{ endTime: [latest] }],
                conditionDisplayName: ["Near Mint"],
                sellingStatus: [{ currentPrice: [{ "__value__": "120.00", "@currencyId": "USD" }] }],
              },
              {
                title: ["Pikachu Base Set LP"],
                viewItemURL: ["https://www.ebay.com/itm/654321"],
                listingInfo: [{ endTime: [prior] }],
                sellingStatus: [{ currentPrice: [{ "__value__": "100.00", "@currencyId": "USD" }] }],
              },
              {
                title: ["Unsafe listing"],
                viewItemURL: ["https://not-ebay.example/itm/1"],
                listingInfo: [{ endTime: [latest] }],
                sellingStatus: [{ currentPrice: [{ "__value__": "1.00", "@currencyId": "USD" }] }],
              },
              {
                title: ["Pikachu Base Set PSA 10"],
                viewItemURL: ["https://www.ebay.com/itm/999999"],
                listingInfo: [{ endTime: [latest] }],
                sellingStatus: [{ currentPrice: [{ "__value__": "1000.00", "@currencyId": "USD" }] }],
              },
              {
                title: ["Pikachu Base Set with unsafe URL credentials"],
                viewItemURL: ["https://collector:secret@www.ebay.com/itm/888888"],
                listingInfo: [{ endTime: [latest] }],
                sellingStatus: [{ currentPrice: [{ "__value__": "5.00", "@currencyId": "USD" }] }],
              },
            ],
          }],
          paginationOutput: [{ totalEntries: ["101"] }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const response = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.availability, "available", JSON.stringify(response.body));
    assert.equal(response.body.currency, "USD");
    assert.equal(response.body.sales.length, 2);
    assert.equal(response.body.sales[0].condition, "Near Mint");
    assert.equal(response.body.sales[0].url, "https://www.ebay.com/itm/123456");
    assert.equal(response.body.points.length, 2);
    assert.equal(response.body.movement.direction, "up");
    assert.equal(response.body.movement.percent, 20);
    assert.equal(response.body.coverage, "provider_limited");
    assert.match(response.body.message, /limited set/i);
    assert.equal(JSON.stringify(response.body).includes("SECURITY-APPNAME"), false);
    assert.equal(JSON.stringify(response.body).includes("keywords"), false);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /findCompletedItems/);
    assert.match(calls[0]!, /EndTimeFrom/);
  });

  test("keeps eBay authorization failure distinct from no-results", async () => {
    process.env.EBAY_APP_ID = "production-app-id";
    globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;

    const response = await request.get(route()).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.availability, "authorization_error");
    assert.deepEqual(response.body.sales, []);
  });

  test("discloses incomplete all-period results even when the returned page has no usable sales", async () => {
    process.env.EBAY_APP_ID = "production-app-id";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      findCompletedItemsResponse: [{
        ack: ["Success"],
        searchResult: [{
          item: [{
            title: ["Pikachu Base Set PSA 10"],
            viewItemURL: ["https://www.ebay.com/itm/777777"],
            listingInfo: [{ endTime: [new Date().toISOString()] }],
            sellingStatus: [{ currentPrice: [{ "__value__": "999.00", "@currencyId": "USD" }] }],
          }],
        }],
        paginationOutput: [{ totalEntries: ["250"] }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    const response = await request.get(route({ period: "all" })).set("Authorization", `Bearer ${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.availability, "no_results");
    assert.equal(response.body.coverage, "provider_limited");
    assert.match(response.body.message, /not definitive/i);
    assert.deepEqual(response.body.sales, []);
  });
});