/**
 * Deliberately not part of the default suite: this is a development-DB
 * acceptance test. All rows have a unique stage-c prefix and are removed in
 * `after`, including on assertion failure.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import {
  activityLogTable, cardPriceSnapshotsTable, catalogueCardImagesTable, catalogueCardsTable,
  catalogueExternalIdsTable, catalogueGamesTable, catalogueSetsTable,
  currentQuotesTable, db, pool, usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app.js";
import { createTestUser, deleteTestUser } from "./helpers.js";

const request = supertest(app);
const ns = `stage-c-${Date.now()}`;
const ids = ["a", "b", "zero", "psa", "cad", "recent-priced", "recent-unpriced"]
  .map((name) => `${ns}-${name}`);
let userId = "";
let token = "";
let gamePokemon = "";
let gameMagic = "";
let setPokemon = "";
let setMagic = "";
const canonicalIds: string[] = [];

async function addCanonical(cardId: string, gameId: string, setId: string, createdAt: Date) {
  const [card] = await db.insert(catalogueCardsTable).values({
    gameId, setId, name: cardId, collectorNumber: cardId, createdAt, updatedAt: createdAt,
  }).returning();
  canonicalIds.push(card!.id);
  await db.insert(catalogueCardImagesTable).values({
    cardId: card!.id, url: `https://example.test/${cardId}.jpg`, source: "stage-c", isPrimary: true,
  });
  await db.insert(catalogueExternalIdsTable).values({
    entityType: "card", entityId: card!.id, providerKey: "justtcg", externalId: cardId,
    createdAt, updatedAt: createdAt,
  });
}
function snapshots(cardId: string, previous: number, current: number, gradeKey = "raw", currency = "USD") {
  const now = Date.now();
  return [
    { cardId, providerKey: "pricecharting", gradeKey, currency, priceCents: previous,
      capturedAt: new Date(now - 60 * 60_000), snapshotBucket: `${ns}-${cardId}-${gradeKey}-${currency}-old`, captureStatus: "success" },
    { cardId, providerKey: "pricecharting", gradeKey, currency, priceCents: current,
      capturedAt: new Date(now), snapshotBucket: `${ns}-${cardId}-${gradeKey}-${currency}-new`, captureStatus: "success" },
  ];
}

describe("Stage C persisted market acceptance (development DB)", () => {
  before(async () => {
    const created = await createTestUser({ email: `${ns}@example.com`, displayName: "Stage C disposable" });
    userId = created.user.id; token = created.accessToken;
    const [pokemon] = await db.insert(catalogueGamesTable).values({ slug: `${ns}-pokemon`, name: "Pokémon" }).returning();
    const [magic] = await db.insert(catalogueGamesTable).values({ slug: `${ns}-magic`, name: "Magic: The Gathering" }).returning();
    gamePokemon = pokemon!.id; gameMagic = magic!.id;
    const [ps] = await db.insert(catalogueSetsTable).values({ gameId: gamePokemon, slug: `${ns}-p`, name: "Stage C P" }).returning();
    const [ms] = await db.insert(catalogueSetsTable).values({ gameId: gameMagic, slug: `${ns}-m`, name: "Stage C M" }).returning();
    setPokemon = ps!.id; setMagic = ms!.id;
    const old = new Date(Date.now() - 10_000);
    for (const id of ids) await addCanonical(id, id === ids[1] ? gameMagic : gamePokemon, id === ids[1] ? setMagic : setPokemon,
      id === ids[6] ? new Date() : old);
    await db.insert(cardPriceSnapshotsTable).values([
      ...snapshots(ids[0]!, 100, 120), ...snapshots(ids[1]!, 100, 80),
      ...snapshots(ids[2]!, 50, 50), ...snapshots(ids[3]!, 100, 200, "psa_10"),
      ...snapshots(ids[4]!, 100, 50, "raw", "CAD"),
    ]);
    await db.insert(currentQuotesTable).values({
      cardId: ids[5]!, providerKey: "pricecharting", gradeKey: "raw", priceCents: 999,
      currency: "USD", fetchedAt: new Date(),
    });
    await db.update(usersTable).set({ preferredTcgs: "Pokemon TCG" }).where(eq(usersTable.id, userId));
    for (let index = 0; index < 3; index++) {
      const response = await request.post("/api/collection").set("Authorization", `Bearer ${token}`).send({
        cardId: ids[0], card: { id: ids[0], name: "A" }, acquiredAt: "2025-01-01",
        quantity: 1, condition: "near_mint",
      });
      assert.equal(response.status, 201);
    }
    const wishlistAdd = await request.post("/api/wishlist").set("Authorization", `Bearer ${token}`).send({
      id: `${ns}-wishlist-b`, cardId: ids[1], card: { id: ids[1], name: "B" },
      desiredGrade: null, targetPrice: null, priceAlertEnabled: false, addedAt: new Date().toISOString(),
    });
    assert.equal(wishlistAdd.status, 201);
  });

  after(async () => {
    try {
      await db.delete(activityLogTable).where(eq(activityLogTable.userId, userId));
      await db.delete(currentQuotesTable).where(inArray(currentQuotesTable.cardId, ids));
      await db.delete(cardPriceSnapshotsTable).where(inArray(cardPriceSnapshotsTable.cardId, ids));
      await db.delete(catalogueExternalIdsTable).where(inArray(catalogueExternalIdsTable.externalId, ids));
      await db.delete(catalogueCardImagesTable).where(inArray(catalogueCardImagesTable.cardId, canonicalIds));
      await db.delete(catalogueCardsTable).where(inArray(catalogueCardsTable.collectorNumber, ids));
      if (setPokemon || setMagic) await db.delete(catalogueSetsTable).where(inArray(catalogueSetsTable.id, [setPokemon, setMagic]));
      if (gamePokemon || gameMagic) await db.delete(catalogueGamesTable).where(inArray(catalogueGamesTable.id, [gamePokemon, gameMagic]));
      if (userId) await deleteTestUser(userId);
    } finally { await pool.end(); }
  });

  test("isolates persisted contexts, orders activity, recent provenance, and preferences", async () => {
    const movers = await request.get("/api/catalog/market-movers?currency=USD").set("Authorization", `Bearer ${token}`);
    assert.equal(movers.status, 200);
    assert.deepEqual(movers.body.data.map((x: { id: string }) => x.id), [ids[0]!], "preference removes Magic; raw USD movement is +20");
    assert.equal(movers.body.data[0].price_change_7d, 20);
    assert.equal(movers.body.data[0].absolute_change, 0.2);
    const publicMovers = await request.get("/api/catalog/market-movers?mode=losers&currency=USD");
    assert.ok(publicMovers.body.data.some((x: { id: string; price_change_7d: number }) => x.id === ids[1] && x.price_change_7d === -20));
    assert.ok(!publicMovers.body.data.some((x: { id: string }) => x.id === ids[2]), "zero movement is not a meaningful mover");
    assert.ok(!publicMovers.body.data.some((x: { id: string }) => x.id === ids[3] || x.id === ids[4]), "grade/currency contexts do not cross raw USD");
    const recent = await request.get("/api/catalog/recently-added");
    const unpriced = recent.body.data.find((x: { id: string }) => x.id === ids[6]);
    assert.equal(unpriced.market_price, null); assert.equal(unpriced.updated_at, null);
    assert.ok(recent.body.data.findIndex((x: { id: string }) => x.id === ids[6]) <
      recent.body.data.findIndex((x: { id: string }) => x.id === ids[5]), "newest provenance is first");
    assert.ok(recent.body.data.findIndex((x: { id: string }) => x.id === ids[0]) <
      recent.body.data.findIndex((x: { id: string }) => x.id === ids[1]), "tied provenance timestamps use external ID");
    const trending = await request.get("/api/catalog/trending");
    assert.ok(trending.body.data.findIndex((x: { id: string }) => x.id === ids[0]) < trending.body.data.findIndex((x: { id: string }) => x.id === ids[1]));
  });
});