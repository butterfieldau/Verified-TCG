import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { createTestUser } from "./helpers.js";
import { runMigrationsWithDatabase } from "../lib/migrate.js";

const request = supertest(app);
let tokenA = "";
let tokenB = "";
let userA = "";
let userB = "";
let holdingA = "";
let holdingB = "";

function holding(cardId: string) {
  return {
    cardId,
    card: { id: cardId, name: cardId, image: "https://example.test/card.png" },
    acquiredAt: "2025-01-01",
    quantity: 1,
    acquiredPrice: 10,
  };
}

describe("collection organization isolation and atomicity", () => {
  before(async () => {
    await runMigrationsWithDatabase();
    const a = await createTestUser({});
    const b = await createTestUser({});
    tokenA = a.accessToken; tokenB = b.accessToken; userA = a.user.id; userB = b.user.id;
    holdingA = (await request.post("/api/collection").set("Authorization", `Bearer ${tokenA}`).send(holding("organization-a"))).body.id;
    holdingB = (await request.post("/api/collection").set("Authorization", `Bearer ${tokenB}`).send(holding("organization-b"))).body.id;
  });

  after(async () => {
    await db.delete(usersTable).where(eq(usersTable.id, userA));
    await db.delete(usersTable).where(eq(usersTable.id, userB));
  });

  test("isolates lists/preferences, preserves holdings on list delete, and orders deterministically", async () => {
    const first = await request.post("/api/collection/lists").set("Authorization", `Bearer ${tokenA}`).send({ name: "First" });
    const second = await request.post("/api/collection/lists").set("Authorization", `Bearer ${tokenA}`).send({ name: "Second" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const firstId = first.body.lists.find((list: { name: string }) => list.name === "First").id;
    const secondId = second.body.lists.find((list: { name: string }) => list.name === "Second").id;

    const reordered = await request.put("/api/collection/lists/order").set("Authorization", `Bearer ${tokenA}`).send({ listIds: [secondId, firstId] });
    assert.equal(reordered.status, 200);
    assert.deepEqual(reordered.body.lists.map((list: { id: string }) => list.id), [secondId, firstId]);

    const bState = await request.get("/api/collection/lists").set("Authorization", `Bearer ${tokenB}`);
    assert.equal(bState.status, 200);
    assert.deepEqual(bState.body.lists, []);
    const prefs = await request.put("/api/collection/preferences").set("Authorization", `Bearer ${tokenA}`)
      .send({ viewMode: "list", selectedListId: firstId, sortKey: "name_asc", filterState: { game: "pokemon" } });
    assert.equal(prefs.status, 200);
    const bPrefs = await request.get("/api/collection/preferences").set("Authorization", `Bearer ${tokenB}`);
    assert.equal(bPrefs.body.viewMode, "grid");
    assert.equal(bPrefs.body.selectedListId, null);
    for (const sortKey of ["quantity_asc", "quantity_desc", "gain_asc", "gain_desc"]) {
      const saved = await request.put("/api/collection/preferences")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ sortKey });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.sortKey, sortKey);
    }

    const membership = await request.post(`/api/collection/lists/${firstId}/items`).set("Authorization", `Bearer ${tokenA}`).send({ holdingIds: [holdingA] });
    assert.equal(membership.status, 200);
    const deletedList = await request.delete(`/api/collection/lists/${firstId}`).set("Authorization", `Bearer ${tokenA}`);
    assert.equal(deletedList.status, 200);
    const holdings = await request.get("/api/collection").set("Authorization", `Bearer ${tokenA}`);
    assert.ok(holdings.body.some((item: { id: string }) => item.id === holdingA), "deleting a list must not delete a holding");
  });

  test("allows one holding in multiple lists without changing portfolio totals and cascades membership on holding delete", async () => {
    const one = await request.post("/api/collection/lists").set("Authorization", `Bearer ${tokenA}`).send({ name: "Multi one" });
    const two = await request.post("/api/collection/lists").set("Authorization", `Bearer ${tokenA}`).send({ name: "Multi two" });
    const oneId = one.body.lists.find((list: { name: string }) => list.name === "Multi one").id;
    const twoId = two.body.lists.find((list: { name: string }) => list.name === "Multi two").id;
    await request.post(`/api/collection/lists/${oneId}/items`).set("Authorization", `Bearer ${tokenA}`).send({ holdingIds: [holdingA] });
    await request.post(`/api/collection/lists/${twoId}/items`).set("Authorization", `Bearer ${tokenA}`).send({ holdingIds: [holdingA] });
    const summary = await request.get("/api/collection/summary").set("Authorization", `Bearer ${tokenA}`);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.cardCount, 1, "memberships must not inflate portfolio totals");

    const removed = await request.delete(`/api/collection/${holdingA}`).set("Authorization", `Bearer ${tokenA}`);
    assert.equal(removed.status, 200);
    const state = await request.get("/api/collection/lists").set("Authorization", `Bearer ${tokenA}`);
    assert.equal(state.body.lists.find((list: { id: string }) => list.id === oneId).holdingIds.length, 0);
    assert.equal(state.body.lists.find((list: { id: string }) => list.id === twoId).holdingIds.length, 0);
  });

  test("rejects mixed-owner bulk mutations without partial writes", async () => {
    const result = await request.post("/api/collection/bulk").set("Authorization", `Bearer ${tokenA}`)
      .send({ holdingIds: [holdingB], isForSale: true });
    assert.equal(result.status, 404);
    const bHoldings = await request.get("/api/collection").set("Authorization", `Bearer ${tokenB}`);
    assert.equal(bHoldings.body.find((item: { id: string }) => item.id === holdingB).isForSale, false);
    const crossAccountList = await request.post("/api/collection/lists").set("Authorization", `Bearer ${tokenB}`).send({ name: "B only" });
    const denied = await request.post(`/api/collection/lists/${crossAccountList.body.lists[0].id}/items`)
      .set("Authorization", `Bearer ${tokenA}`).send({ holdingIds: [holdingB] });
    assert.equal(denied.status, 404, "a collector cannot attach another collector's holding");
  });

  test("removes multiple memberships atomically through the bulk endpoint", async () => {
    const firstHolding = (await request.post("/api/collection")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(holding("organization-a-bulk-first"))).body.id;
    const secondHolding = (await request.post("/api/collection")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(holding("organization-a-bulk-second"))).body.id;
    const created = await request.post("/api/collection/lists")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Atomic removal" });
    const listId = created.body.lists.find((list: { name: string }) => list.name === "Atomic removal").id;
    const added = await request.post(`/api/collection/lists/${listId}/items`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ holdingIds: [firstHolding, secondHolding] });
    assert.equal(added.status, 200);
    assert.deepEqual(
      added.body.lists.find((list: { id: string }) => list.id === listId).holdingIds,
      [firstHolding, secondHolding],
    );

    const removed = await request.post("/api/collection/bulk")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ holdingIds: [firstHolding, secondHolding], removeFromListId: listId });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.deepEqual(
      removed.body.lists.find((list: { id: string }) => list.id === listId).holdingIds,
      [],
    );
    const holdings = await request.get("/api/collection").set("Authorization", `Bearer ${tokenA}`);
    assert.ok(holdings.body.some((item: { id: string }) => item.id === firstHolding));
    assert.ok(holdings.body.some((item: { id: string }) => item.id === secondHolding));
  });
});