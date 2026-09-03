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
  collectionListItemsTable,
  collectionListsTable,
  db,
  pool,
  wishlistItemsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { createTestUser, deleteTestUser } from "./helpers.js";
import {
  collectrProductType,
  detectCollectionCsvSource,
  normalizeRows,
  parseCollectionCsv,
} from "../routes/collectionImport.js";
import {
  canonicalizeJustTcgPath,
  justTcgCatalogueForCollectrRow,
} from "../lib/catalogueProvider.js";

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

  test("routes representative Japanese and Chinese Collectr rows explicitly", () => {
    assert.deepEqual(
      justTcgCatalogueForCollectrRow({
        game: "Pokemon",
        set: "VSTAR Universe",
        name: "Deoxys (JP)",
      }),
      { gameId: "pokemon-japan", language: "japanese" },
    );
    assert.deepEqual(
      justTcgCatalogueForCollectrRow({
        game: "Pokemon",
        set: "Gem Pack Vol. 3",
        name: "Cubone (Full Art) (CN)",
      }),
      {
        gameId: null,
        language: "chinese",
        unsupportedReason:
          "Chinese Pokémon cards are not available from the current catalogue provider.",
      },
    );
  });

  test("uses matched provider identity for sealed products without misclassifying numberless cards", () => {
    for (const name of [
      "Ultra-Premium Collection",
      "Premium Collection",
      "Build & Battle Box",
      "Collector Tin",
      "Three-Pack Blister",
      "Booster Display",
    ]) {
      assert.equal(
        collectrProductType({ number: "", name, candidateNumber: "N/A" }),
        "sealed",
        name,
      );
    }
    assert.equal(
      collectrProductType({
        number: "",
        name: "Numberless Promotional Card",
        candidateNumber: null,
      }),
      "card",
    );
    assert.equal(
      collectrProductType({
        number: "009/054",
        name: "Pikachu (JP)",
        candidateNumber: "009/054",
      }),
      "card",
    );
  });
});

describe("collection CSV migration routes", () => {
  test("matches Japanese and sealed provider rows and explains unsupported Chinese rows", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.JUSTTCG_API_KEY;
    process.env.JUSTTCG_API_KEY = "collection-import-test-key";
    const rows = parseCollectionCsv([
      COLLECTR_HEADER,
      "Main,Pokemon,VSTAR Universe,Deoxys (JP),185/172,Secret Rare,Holofoil,Ungraded,Near Mint,4.2381,2,9.84,0,false,2026-08-14,",
      "Main,Pokemon,Gem Pack Vol. 3,Cubone (Full Art) (CN),0407/07,Art Rare,Holofoil,Ungraded,Near Mint,650,1,678.09,0,false,2026-08-07,",
      "Main,Pokemon,Surging Sparks,Surging Sparks Pokemon Center Elite Trainer Box (Exclusive),,,Normal,Ungraded,Near Mint,353,1,273.14,0,false,2026-08-07,",
    ].join("\n")).rows;
    const expected = {
      deoxys: {
        id: `pokemon-japan-import-deoxys-${suffix}`,
        name: "Deoxys - 185/172",
        set_name: "S12a: VSTAR Universe",
        number: "185/172",
        game: "Pokemon Japan",
      },
      sealed: {
        id: `pokemon-import-surging-sparks-etb-${suffix}`,
        name: "Surging Sparks Pokemon Center Elite Trainer Box (Exclusive)",
        set_name: "SV08: Surging Sparks",
        number: "N/A",
        game: "Pokemon",
      },
    };
    const providerPaths = [
      ["Deoxys (JP)", "pokemon-japan"],
      ["185/172", "pokemon-japan"],
      ["Surging Sparks Pokemon Center Elite Trainer Box (Exclusive)", "pokemon"],
    ].map(([q, game]) => `/cards?${new URLSearchParams({
      q: q!,
      game: game!,
      limit: "100",
      offset: "0",
      include_price_history: "false",
    }).toString()}`);
    const cacheKeys = providerPaths.map(
      (path) => `justtcg:${canonicalizeJustTcgPath(path)}`,
    );
    for (const cacheKey of cacheKeys) {
      await db.execute(sql`DELETE FROM catalogue_cache_entries WHERE cache_key = ${cacheKey}`);
      await db.execute(sql`DELETE FROM catalogue_cache_leases WHERE cache_key = ${cacheKey}`);
    }
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      const game = url.searchParams.get("game");
      const query = url.searchParams.get("q") ?? "";
      const data = game === "pokemon-japan" && (
        query === "Deoxys (JP)" || query === "185/172"
      )
        ? [expected.deoxys]
        : game === "pokemon" && query.includes("Elite Trainer Box")
          ? [expected.sealed]
          : [];
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const normalized = await normalizeRows("collectr", rows);
      assert.equal(normalized[0]?.status, "matched");
      assert.equal(normalized[0]?.cardId, expected.deoxys.id);
      assert.equal(normalized[0]?.productType, "card");
      assert.equal(normalized[1]?.status, "unmatched");
      assert.match(normalized[1]?.error ?? "", /Chinese Pokémon cards are not available/i);
      assert.equal(normalized[2]?.status, "matched");
      assert.equal(normalized[2]?.cardId, expected.sealed.id);
      assert.equal(normalized[2]?.productType, "sealed");
      assert.equal(
        (normalized[2]?.card as Record<string, unknown>)?.productType,
        "sealed",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.JUSTTCG_API_KEY;
      else process.env.JUSTTCG_API_KEY = originalKey;
      for (const cacheKey of cacheKeys) {
        await db.execute(sql`DELETE FROM catalogue_cache_entries WHERE cache_key = ${cacheKey}`);
        await db.execute(sql`DELETE FROM catalogue_cache_leases WHERE cache_key = ${cacheKey}`);
      }
    }
  });

  test("persists an ambiguous sealed provider selection as sealed", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.JUSTTCG_API_KEY;
    process.env.JUSTTCG_API_KEY = "collection-import-test-key";
    const productName = `Ambiguous Premium Collection ${suffix}`;
    const candidates = [
      {
        id: `pokemon-import-sealed-a-${suffix}`,
        name: productName,
        set_name: `Import Set ${suffix}`,
        number: "N/A",
        game: "Pokemon",
      },
      {
        id: `pokemon-import-sealed-b-${suffix}`,
        name: productName,
        set_name: `Import Set ${suffix}`,
        number: "N/A",
        game: "Pokemon",
      },
    ];
    const providerPath = `/cards?${new URLSearchParams({
      q: productName,
      game: "pokemon",
      limit: "100",
      offset: "0",
      include_price_history: "false",
    }).toString()}`;
    const cacheKey = `justtcg:${canonicalizeJustTcgPath(providerPath)}`;
    await db.execute(sql`DELETE FROM catalogue_cache_entries WHERE cache_key = ${cacheKey}`);
    await db.execute(sql`DELETE FROM catalogue_cache_leases WHERE cache_key = ${cacheKey}`);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: candidates }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const content = [
        COLLECTR_HEADER,
        `Main,Pokemon,Import Set ${suffix},${productName},,,Normal,Ungraded,Near Mint,20,1,30,0,false,2026-08-07,`,
      ].join("\n");
      const preview = await request
        .post("/api/collection/import/preview")
        .set("Authorization", `Bearer ${roundTripToken}`)
        .send({ content, filename: "ambiguous-sealed.csv" });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.rows[0].status, "ambiguous");
      assert.equal(preview.body.rows[0].candidates.length, 2);
      assert.equal(preview.body.rows[0].candidates[1].card.productType, "sealed");

      const resolve = await request
        .post(`/api/collection/import/${preview.body.jobId}/resolve`)
        .set("Authorization", `Bearer ${roundTripToken}`)
        .send({
          contentSha256: preview.body.contentSha256,
          resolutions: [{ rowNumber: 2, cardId: candidates[1]!.id }],
        });
      assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
      assert.equal(resolve.body.rows[0].card.productType, "sealed");

      const commit = await request
        .post(`/api/collection/import/${preview.body.jobId}/commit`)
        .set("Authorization", `Bearer ${roundTripToken}`)
        .send({
          contentSha256: preview.body.contentSha256,
          sourceCurrency: "USD",
        });
      assert.equal(commit.status, 200, JSON.stringify(commit.body));

      const [holding] = await db.select().from(collectionItemsTable)
        .where(eq(collectionItemsTable.cardId, candidates[1]!.id));
      assert.equal(
        (holding?.cardData as Record<string, unknown> | undefined)?.productType,
        "sealed",
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.JUSTTCG_API_KEY;
      else process.env.JUSTTCG_API_KEY = originalKey;
      await db.delete(collectionItemsTable)
        .where(eq(collectionItemsTable.cardId, candidates[1]!.id));
      await db.execute(sql`DELETE FROM catalogue_cache_entries WHERE cache_key = ${cacheKey}`);
      await db.execute(sql`DELETE FROM catalogue_cache_leases WHERE cache_key = ${cacheKey}`);
    }
  });

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

  test("round-trips v2 custom lists and memberships without duplicating holdings", async () => {
    const [sourceHolding] = await db
      .select()
      .from(collectionItemsTable)
      .where(eq(collectionItemsTable.userId, userId))
      .limit(1);
    assert.ok(sourceHolding);

    const listName = `Trade box ${suffix}`;
    const emptyListName = `Empty shelf ${suffix}`;
    const [sourceList] = await db
      .insert(collectionListsTable)
      .values({ userId, name: listName, position: 0 })
      .returning();
    await db.insert(collectionListsTable).values({
      userId,
      name: emptyListName,
      position: 5,
    });
    await db.insert(collectionListItemsTable).values({
      userId,
      listId: sourceList!.id,
      collectionItemId: sourceHolding.id,
    });
    await db.insert(collectionListsTable).values({
      userId: roundTripUserId,
      name: listName,
      position: 0,
    });

    const holdingsBefore = await db
      .select()
      .from(collectionItemsTable)
      .where(eq(collectionItemsTable.userId, roundTripUserId));
    const exported = await request
      .get("/api/me/export/collection.csv?version=2")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(exported.status, 200, exported.text);
    const parsed = parseCollectionCsv(exported.text);
    assert.equal(parsed.headers[2], "Record Type");
    assert.equal(parsed.rows.filter((row) => row.recordtype === "list").length, 2);
    assert.equal(parsed.rows.filter((row) => row.recordtype === "holding").length, 2);

    const orphanedMembershipCsv = exported.text
      .split(/\r?\n/)
      .filter((line) => !(line.includes(",list,") && line.includes(listName)))
      .join("\r\n");
    const orphanedPreview = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${roundTripToken}`)
      .send({ content: orphanedMembershipCsv, filename: "missing-list-definition.csv" });
    assert.equal(orphanedPreview.status, 200, JSON.stringify(orphanedPreview.body));
    assert.equal(orphanedPreview.body.summary.invalid, 1);
    assert.match(
      orphanedPreview.body.rows.find((row: { error?: string }) => row.error)?.error ?? "",
      /does not have a list-definition row/i,
    );

    const preview = await request
      .post("/api/collection/import/preview")
      .set("Authorization", `Bearer ${roundTripToken}`)
      .send({ content: exported.text, filename: "collection-with-lists.csv" });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.schemaVersion, 2);
    assert.deepEqual(preview.body.summary.listsToMerge, [listName]);
    assert.deepEqual(preview.body.summary.listsToCreate, [emptyListName]);
    assert.equal(preview.body.summary.membershipCount, 1);

    const commit = await request
      .post(`/api/collection/import/${preview.body.jobId}/commit`)
      .set("Authorization", `Bearer ${roundTripToken}`)
      .send({ contentSha256: preview.body.contentSha256 });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.equal(commit.body.summary.holdingsAdded, 0);
    assert.equal(commit.body.summary.listsCreated, 1);
    assert.equal(commit.body.summary.listsMerged, 1);
    assert.equal(commit.body.summary.membershipsAdded, 1);

    const holdingsAfter = await db
      .select()
      .from(collectionItemsTable)
      .where(eq(collectionItemsTable.userId, roundTripUserId));
    assert.equal(holdingsAfter.length, holdingsBefore.length);
    const importedLists = await db
      .select()
      .from(collectionListsTable)
      .where(eq(collectionListsTable.userId, roundTripUserId));
    assert.deepEqual(
      importedLists.map((list) => list.name).sort(),
      [emptyListName, listName].sort(),
    );
    assert.equal(
      importedLists.find((list) => list.name === emptyListName)?.position,
      5,
    );
    const importedMemberships = await db
      .select()
      .from(collectionListItemsTable)
      .where(eq(collectionListItemsTable.userId, roundTripUserId));
    assert.equal(importedMemberships.length, 1);
  });
});