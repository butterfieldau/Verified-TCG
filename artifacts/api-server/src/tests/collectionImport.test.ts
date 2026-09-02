import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import {
  catalogueCardsTable,
  catalogueCardVariantsTable,
  catalogueExternalIdsTable,
  catalogueGamesTable,
  catalogueSetsTable,
  collectionImportJobsTable,
  collectionItemsTable,
  db,
  pool,
  wishlistItemsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { createTestUser, deleteTestUser } from "./helpers.js";
import {
  detectCollectionCsvSource,
  parseCollectionCsv,
} from "../routes/collectionImport.js";

const request = supertest(app);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const gameSlug = `pokemon-import-${suffix}`;
const setSlug = `import-set-${suffix}`;
const setCode = `IS${suffix.slice(-4)}`;
const externalIds = [
  `import-card-a-${suffix}`,
  `import-card-b-${suffix}`,
  `import-card-c-${suffix}`,
];
let userId = "";
let roundTripUserId = "";
let token = "";
let roundTripToken = "";
let gameId = "";
let setId = "";
const cardIds: string[] = [];

const COLLECTR_HEADER =
  "Portfolio Name,Category,Set,Product Name,Card Number,Rarity,Variance,Grade,Card Condition,Average Cost Paid,Quantity,Market Price (As of 2026-08-31),Price Override,Watchlist,Date Added,Notes";

function collectrFixture(): string {
  return [
    COLLECTR_HEADER,
    `Main,Pokemon,Import Set ${suffix},"Test Card, Alpha",001,Rare,Foil,SGC 9,Near Mint,12.50,2,999.99,0,false,2026-08-18,"Bought, locally"`,
    `,Pokemon,Import Set ${suffix},Test Card Beta,002,Rare,Normal,,Near Mint,,,100,0,true,,`,
    `,Pokemon,Import Set ${suffix},Test Card Gamma,003,Rare,Normal,PSA 10,Near Mint,,,100,0,true,,`,
  ].join("\r\n");
}

before(async () => {
  await runMigrations();
  const primary = await createTestUser({
    email: `test_suite_import_${suffix}@example.com`,
    subscriptionTier: "pro",
  });
  const roundTrip = await createTestUser({
    email: `test_suite_import_roundtrip_${suffix}@example.com`,
  });
  userId = primary.user.id;
  roundTripUserId = roundTrip.user.id;
  token = primary.accessToken;
  roundTripToken = roundTrip.accessToken;

  const [game] = await db.insert(catalogueGamesTable).values({
    slug: gameSlug,
    name: "Pokemon",
    shortName: "PKM",
    sortOrder: 999,
  }).returning();
  gameId = game!.id;
  const [set] = await db.insert(catalogueSetsTable).values({
    gameId,
    slug: setSlug,
    name: `Import Set ${suffix}`,
    code: setCode,
  }).returning();
  setId = set!.id;

  for (let index = 0; index < externalIds.length; index += 1) {
    const [card] = await db.insert(catalogueCardsTable).values({
      gameId,
      setId,
      name: index === 0 ? "Test Card, Alpha" : index === 1 ? "Test Card Beta" : "Test Card Gamma",
      collectorNumber: `00${index + 1}`,
      collectorNumberNormalized: `00${index + 1}`,
      rarity: "Rare",
    }).returning();
    cardIds.push(card!.id);
    await db.insert(catalogueExternalIdsTable).values({
      entityType: "card",
      entityId: card!.id,
      providerKey: "justtcg",
      externalId: externalIds[index]!,
    });
    await db.insert(catalogueCardVariantsTable).values({
      cardId: card!.id,
      variantKey: index === 0 ? "foil" : "normal",
      finish: index === 0 ? "Foil" : "Normal",
      isDefault: true,
    });
  }

  await db.insert(wishlistItemsTable).values({
    userId,
    itemId: `existing-beta-${suffix}`,
    cardId: externalIds[1]!,
    cardData: { id: externalIds[1], name: "Test Card Beta" },
    desiredGrade: "PSA 9",
    targetPrice: 2500,
    priceAlertEnabled: true,
    addedAt: "2026-08-01T00:00:00.000Z",
  });
});

after(async () => {
  if (userId) await deleteTestUser(userId);
  if (roundTripUserId) await deleteTestUser(roundTripUserId);
  for (const cardId of cardIds) {
    await db.delete(catalogueCardVariantsTable).where(eq(catalogueCardVariantsTable.cardId, cardId));
    await db.delete(catalogueExternalIdsTable).where(eq(catalogueExternalIdsTable.entityId, cardId));
    await db.delete(catalogueCardsTable).where(eq(catalogueCardsTable.id, cardId));
  }
  if (setId) await db.delete(catalogueSetsTable).where(eq(catalogueSetsTable.id, setId));
  if (gameId) await db.delete(catalogueGamesTable).where(eq(catalogueGamesTable.id, gameId));
  await pool.end();
});

describe("collection CSV parser", () => {
  test("handles quoted commas and detects the supplied Collectr header contract", () => {
    const parsed = parseCollectionCsv(collectrFixture());
    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.rows[0]?.productname, "Test Card, Alpha");
    assert.equal(parsed.rows[0]?.notes, "Bought, locally");
    assert.equal(detectCollectionCsvSource(parsed.headers), "collectr");
  });

  test("rejects malformed quoted CSV instead of guessing", () => {
    assert.throws(
      () => parseCollectionCsv(`${COLLECTR_HEADER}\nMain,Pokemon,\"broken`),
      /unclosed quoted field/i,
    );
  });

  test("rejects partial or extended header contracts", () => {
    const parsed = parseCollectionCsv(`${COLLECTR_HEADER},Unexpected\n${"value,".repeat(16)}value`);
    assert.throws(
      () => detectCollectionCsvSource(parsed.headers),
      /do not match/i,
    );
  });

  test("rejects padded headers in otherwise valid contracts", () => {
    const collectr = parseCollectionCsv(
      `${COLLECTR_HEADER.replace(",Category,", ", Category,")}\n${"value,".repeat(15)}value`,
    );
    assert.throws(() => detectCollectionCsvSource(collectr.headers), /do not match/i);

    const verifiedHeader = [
      "Verified TCG CSV Version", " Source", "Card ID", "Card Name", "TCG", "Set",
      "Set Code", "Card Number", "Rarity", "Finish", "Condition", "Graded",
      "Grade Company", "Grade", "Grade Designation", "Grade Original",
      "Certificate Number", "Graded Date", "Quantity", "Acquired Date",
      "Acquisition Currency", "Acquisition Unit Price", "For Sale", "For Trade", "Notes",
    ].join(",");
    const verified = parseCollectionCsv(
      `${verifiedHeader}\n${"value,".repeat(24)}value`,
    );
    assert.throws(() => detectCollectionCsvSource(verified.headers), /do not match/i);
  });
});

describe("collection CSV migration routes", () => {
  test("requires authentication for preview and commit", async () => {
    const preview = await request
      .post("/api/collection/import/preview")
      .send({ content: collectrFixture() });
    assert.equal(preview.status, 401);
    const commit = await request
      .post("/api/collection/import/00000000-0000-0000-0000-000000000000/commit")
      .send({ contentSha256: "a".repeat(64), sourceCurrency: "USD" });
    assert.equal(commit.status, 401);
  });

  test("previews, commits atomically, preserves wishlist preferences, and replays safely", async () => {
    const preview = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: collectrFixture(), filename: "collectr.csv" });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.source, "collectr");
    assert.equal(preview.body.summary.matched, 1);
    assert.equal(preview.body.summary.watchlistOnly, 2);
    assert.equal(preview.body.rows[0].supportedGrade, false);
    assert.equal(preview.body.rows[1].status, "watchlist_only");

    const missingCurrency = await request
      .post(`/api/collection/import/${preview.body.jobId}/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contentSha256: preview.body.contentSha256 });
    assert.equal(missingCurrency.status, 400);

    const commit = await request
      .post(`/api/collection/import/${preview.body.jobId}/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentSha256: preview.body.contentSha256,
        sourceCurrency: "USD",
      });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.equal(commit.body.summary.holdingsAdded, 1);
    assert.equal(commit.body.summary.wishlistAdded, 1);
    assert.equal(commit.body.summary.unsupportedGrades, 1);

    const [holding] = await db.select().from(collectionItemsTable)
      .where(eq(collectionItemsTable.userId, userId));
    assert.equal(holding?.quantity, 2);
    assert.equal(holding?.acquiredCurrency, "USD");
    assert.equal(holding?.acquiredPriceCents, 1250);
    assert.equal(holding?.notes, "Bought, locally");

    const wishlist = await db.select().from(wishlistItemsTable)
      .where(eq(wishlistItemsTable.userId, userId));
    assert.equal(wishlist.filter((item) => !item.deletedAt).length, 2);
    const beta = wishlist.find((item) => item.cardId === externalIds[1]);
    assert.equal(beta?.desiredGrade, "PSA 9");
    assert.equal(beta?.targetPrice, 2500);
    assert.equal(beta?.priceAlertEnabled, true);

    await db.update(collectionImportJobsTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(collectionImportJobsTable.id, preview.body.jobId));
    const replay = await request
      .post(`/api/collection/import/${preview.body.jobId}/commit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        contentSha256: preview.body.contentSha256,
        sourceCurrency: "USD",
      });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    const holdingsAfterReplay = await db.select().from(collectionItemsTable)
      .where(eq(collectionItemsTable.userId, userId));
    assert.equal(holdingsAfterReplay.length, 1);
  });

  test("exports stable currency metadata and previews the export for round trip", async () => {
    await db.insert(collectionItemsTable).values({
      userId,
      cardId: externalIds[0]!,
      cardData: {
        id: externalIds[0],
        name: "Test Card, Alpha",
        setName: `Import Set ${suffix}`,
        setId: setSlug,
        setCode,
        tcg: "pokemon",
        number: "001",
        rarity: "rare",
        finish: "Foil",
        price: { raw: 0, available: false, currency: "AUD", updatedAt: null },
      },
      quantity: 1,
      condition: "mint",
      isGraded: true,
      gradingData: {
        company: "BGS",
        grade: 10,
        designation: "Black Label",
        original: "BGS 10 Black Label",
        certNumber: "CERT-ROUNDTRIP",
        gradedAt: "2026-08-19",
      },
      acquiredAt: "2026-08-19",
      acquiredPriceCents: 50000,
      acquiredCurrency: "AUD",
    });

    const exported = await request
      .get("/api/me/export/collection.csv")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(exported.status, 200, exported.text);
    assert.match(exported.text, /^Verified TCG CSV Version,Source,Card ID,/);
    assert.match(exported.text, /Acquisition Currency,Acquisition Unit Price/);
    assert.match(exported.text, /,USD,12\.50,/);
    assert.match(exported.text, /Black Label,BGS 10 Black Label,CERT-ROUNDTRIP,2026-08-19/);

    const previewA = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${roundTripToken}`)
      .send({ content: exported.text, filename: "verified-tcg.csv" });
    const previewB = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${roundTripToken}`)
      .send({ content: `${exported.text}\n`, filename: "verified-tcg-copy.csv" });
    assert.equal(previewA.status, 200, JSON.stringify(previewA.body));
    assert.equal(previewB.status, 200, JSON.stringify(previewB.body));
    assert.equal(previewA.body.source, "verified_tcg");
    assert.equal(previewA.body.summary.matched, 2);
    assert.equal(previewA.body.rows[0].currency, "USD");
    assert.equal(previewA.body.rows[0].quantity, 2);
    assert.equal(previewA.body.rows[0].acquiredPrice, 12.5);

    const [commitA, commitB] = await Promise.all([
      request
        .post(`/api/collection/import/${previewA.body.jobId}/commit`)
        .set("Authorization", `Bearer ${roundTripToken}`)
        .send({ contentSha256: previewA.body.contentSha256 }),
      request
        .post(`/api/collection/import/${previewB.body.jobId}/commit`)
        .set("Authorization", `Bearer ${roundTripToken}`)
        .send({ contentSha256: previewB.body.contentSha256 }),
    ]);
    assert.equal(commitA.status, 200, JSON.stringify(commitA.body));
    assert.equal(commitB.status, 200, JSON.stringify(commitB.body));
    assert.equal(
      commitA.body.summary.holdingsAdded + commitB.body.summary.holdingsAdded,
      2,
    );
    const imported = await db.select().from(collectionItemsTable)
      .where(eq(collectionItemsTable.userId, roundTripUserId));
    assert.equal(imported.length, 2);
    const blackLabel = imported.find((item) =>
      (item.gradingData as Record<string, unknown> | null)?.designation === "Black Label"
    );
    assert.equal(
      (blackLabel?.gradingData as Record<string, unknown>)?.original,
      "BGS 10 Black Label",
    );
    assert.equal(
      (blackLabel?.gradingData as Record<string, unknown>)?.certNumber,
      "CERT-ROUNDTRIP",
    );
  });

  test("rejects contradictory or unsupported Verified TCG contract rows", async () => {
    const exportRes = await request
      .get("/api/me/export/collection.csv")
      .set("Authorization", `Bearer ${token}`);
    const lines = exportRes.text.split(/\r?\n/);
    const fields = parseCollectionCsv(exportRes.text);
    const badVersion = lines[1]!.replace(/^1,/, "2,");
    const preview = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: `${lines[0]}\n${badVersion}` });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.summary.invalid, 1);

    const paddedLiterals = lines[1]!.replace(
      /^1,Verified TCG,/,
      " 1 ,Verified TCG ,",
    );
    const padded = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: `${lines[0]}\n${paddedLiterals}` });
    assert.equal(padded.status, 200);
    assert.equal(padded.body.summary.invalid, 1);

    const contradictory = lines[1]!.replace("Test Card, Alpha", "Contradictory Name");
    const contradiction = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: `${lines[0]}\n${contradictory}` });
    assert.equal(contradiction.status, 200);
    assert.equal(contradiction.body.summary.unmatched, 1);
    const blankId = lines[1]!.replace(`,${externalIds[0]},`, ",,");
    const missingId = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ content: `${lines[0]}\n${blankId}` });
    assert.equal(missingId.status, 200);
    assert.equal(missingId.body.summary.invalid, 1);
    assert.equal(fields.headers.length, 25);
  });
});