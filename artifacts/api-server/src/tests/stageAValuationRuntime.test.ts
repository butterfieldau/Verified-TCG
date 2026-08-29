import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db, currentQuotesTable, pool } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app.js";
import { PROVIDER_KEY } from "../pricing/pricecharting.js";
import { createTestUser, deleteTestUser, makeCard } from "./helpers.js";

const request = supertest(app);
const namespace = `stage_a_runtime_${Date.now()}`;
const exactCardId = `${namespace}_psa10`;
const missingCardId = `${namespace}_missing_grade`;

describe("Stage A exact graded valuation runtime acceptance", () => {
  let userId = "";
  let accessToken = "";

  before(async () => {
    const created = await createTestUser({
      email: `${namespace}@example.com`,
      displayName: "Disposable Stage A Runtime",
    });
    userId = created.user.id;
    accessToken = created.accessToken;

    await db.insert(currentQuotesTable).values([
      {
        cardId: exactCardId,
        providerKey: PROVIDER_KEY,
        gradeKey: "psa_10",
        priceCents: 15_000,
        currency: "AUD",
        providerProductId: `${namespace}_product_exact`,
      },
      {
        cardId: exactCardId,
        providerKey: PROVIDER_KEY,
        gradeKey: "raw",
        priceCents: 8_000,
        currency: "AUD",
        providerProductId: `${namespace}_product_exact`,
      },
      {
        cardId: missingCardId,
        providerKey: PROVIDER_KEY,
        gradeKey: "raw",
        priceCents: 99_900,
        currency: "AUD",
        providerProductId: `${namespace}_product_missing`,
      },
    ]);

    for (const cardId of [exactCardId, missingCardId]) {
      const response = await request
        .post("/api/collection")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          cardId,
          card: makeCard(cardId),
          acquiredAt: "2026-08-29",
          acquiredPrice: 100,
          currency: "AUD",
          quantity: 1,
          condition: "near_mint",
          grading: { company: "PSA", grade: cardId === exactCardId ? 10 : 9 },
        });
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }
  });

  after(async () => {
    try {
      if (userId) await deleteTestUser(userId);
      await db
        .delete(currentQuotesTable)
        .where(inArray(currentQuotesTable.cardId, [exactCardId, missingCardId]));
    } finally {
      await pool.end();
    }
  });

  test("uses the exact PSA 10 quote in collection and summary", async () => {
    const collection = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(collection.status, 200, JSON.stringify(collection.body));

    const exact = collection.body.find(
      (item: { cardId: string }) => item.cardId === exactCardId,
    );
    assert.equal(exact.valuation.gradeKey, "psa_10");
    assert.equal(exact.valuation.priceCents, 15_000);

    const summary = await request
      .get("/api/collection/summary?displayCurrency=AUD")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.totalValueCents, 15_000);
    assert.equal(summary.body.totalValue, 150);
    assert.equal(summary.body.coverage.pricedHoldings, 1);
    assert.equal(summary.body.coverage.totalHoldings, 2);
  });

  test("does not substitute a raw quote for a graded holding", async () => {
    const collection = await request
      .get("/api/collection")
      .set("Authorization", `Bearer ${accessToken}`);
    const missing = collection.body.find(
      (item: { cardId: string }) => item.cardId === missingCardId,
    );
    assert.equal(missing.valuation, null);
  });
});