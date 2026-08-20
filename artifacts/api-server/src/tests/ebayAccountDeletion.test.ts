import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import supertest from "supertest";
import { count, eq, sql } from "drizzle-orm";
import {
  db,
  ebayAccountDeletionEventsTable,
  pool,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import {
  setEbayPublicKeyResolverForTests,
} from "../lib/ebayNotificationVerifier.js";

const TAG = `test-ebay-deletion-${Date.now()}`;
const verificationToken = "test-ebay-verification-token-not-a-real-secret";
const endpointUrl = "https://example.test/api/ebay/account-deletion";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signRawPayload(rawPayload: string): string {
  const signer = createSign("sha1");
  signer.update(Buffer.from(rawPayload, "utf8"));
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");
  return Buffer.from(JSON.stringify({ kid: "test-key-id", signature }), "utf8").toString("base64");
}

function configureEbay() {
  process.env.EBAY_VERIFICATION_TOKEN = verificationToken;
  process.env.EBAY_ENDPOINT_URL = endpointUrl;
  process.env.EBAY_CLIENT_ID = "test-ebay-client-id";
  process.env.EBAY_CLIENT_SECRET = "test-ebay-client-secret";
  process.env.EBAY_ENVIRONMENT = "sandbox";
}

function deletionPayload(notificationId: string): string {
  // Intentional whitespace and key order prove that the signature is checked
  // against received bytes, not a re-serialized parsed object.
  return `{\n  "notification": { "notificationId": "${notificationId}", "data": { "username": "do-not-store" } },\n  "metadata": { "topic": "MARKETPLACE_ACCOUNT_DELETION" }\n}`;
}

async function requestSignedDeletion(notificationId: string) {
  const rawPayload = deletionPayload(notificationId);
  return supertest(app)
    .post("/api/ebay/account-deletion")
    .set("Content-Type", "application/json")
    .set("X-EBAY-SIGNATURE", signRawPayload(rawPayload))
    .send(rawPayload);
}

async function removeTestLedgerRows() {
  await db.execute(
    sql`ALTER TABLE ebay_account_deletion_events DISABLE TRIGGER ebay_account_deletion_events_append_only_mutation`,
  );
  await db.execute(
    sql`ALTER TABLE ebay_account_deletion_events DISABLE TRIGGER ebay_account_deletion_events_append_only_truncate`,
  );
  try {
    await db
      .delete(ebayAccountDeletionEventsTable)
      .where(sql`${ebayAccountDeletionEventsTable.notificationId} LIKE ${`${TAG}%`}`);
  } finally {
    await db.execute(
      sql`ALTER TABLE ebay_account_deletion_events ENABLE TRIGGER ebay_account_deletion_events_append_only_mutation`,
    );
    await db.execute(
      sql`ALTER TABLE ebay_account_deletion_events ENABLE TRIGGER ebay_account_deletion_events_append_only_truncate`,
    );
  }
}

before(async () => {
  await runMigrations();
  configureEbay();
});

after(async () => {
  await removeTestLedgerRows();
  await pool.end();
});

describe("eBay marketplace account-deletion callback", () => {
  test("returns the documented lowercase SHA-256 challenge response", async () => {
    configureEbay();
    const challengeCode = "challenge-with-raw-order";
    const expected = createHash("sha256")
      .update(challengeCode)
      .update(verificationToken)
      .update(endpointUrl)
      .digest("hex");

    const response = await supertest(app)
      .get("/api/ebay/account-deletion")
      .query({ challenge_code: challengeCode });

    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"]?.startsWith("application/json"), true);
    assert.equal(response.body.challengeResponse, expected);
    assert.match(response.body.challengeResponse, /^[a-f0-9]{64}$/);
  });

  test("rejects a missing challenge code and reports configuration by names only", async () => {
    configureEbay();
    const missingChallenge = await supertest(app).get("/api/ebay/account-deletion");
    assert.equal(missingChallenge.status, 400);

    delete process.env.EBAY_VERIFICATION_TOKEN;
    const missingConfiguration = await supertest(app)
      .get("/api/ebay/account-deletion")
      .query({ challenge_code: "configured-check" });
    assert.equal(missingConfiguration.status, 503);
    assert.deepEqual(missingConfiguration.body.missingConfiguration, ["EBAY_VERIFICATION_TOKEN"]);
    assert.equal(JSON.stringify(missingConfiguration.body).includes(verificationToken), false);
    configureEbay();

    delete process.env.EBAY_CLIENT_SECRET;
    const missingPostConfiguration = await supertest(app)
      .post("/api/ebay/account-deletion")
      .set("Content-Type", "application/json")
      .set("X-EBAY-SIGNATURE", "invalid-signature")
      .send("{}");
    assert.equal(missingPostConfiguration.status, 503);
    assert.deepEqual(missingPostConfiguration.body.missingConfiguration, ["EBAY_CLIENT_SECRET"]);
    assert.equal(JSON.stringify(missingPostConfiguration.body).includes("test-ebay-client-secret"), false);
    configureEbay();
  });

  test("verifies the exact raw bytes and acknowledges a valid notification", async () => {
    configureEbay();
    const restoreResolver = setEbayPublicKeyResolverForTests(async (keyId) => {
      assert.equal(keyId, "test-key-id");
      return publicKeyPem;
    });
    try {
      const response = await requestSignedDeletion(`${TAG}-raw-success`);
      assert.equal(response.status, 204);
      assert.equal(response.text, "");

      const [row] = await db
        .select()
        .from(ebayAccountDeletionEventsTable)
        .where(eq(ebayAccountDeletionEventsTable.notificationId, `${TAG}-raw-success`));
      assert.equal(row?.outcome, "no_linked_ebay_data");
      assert.deepEqual(Object.keys(row ?? {}).sort(), ["notificationId", "outcome", "receivedAt"]);
    } finally {
      restoreResolver();
    }
  });

  test("rejects missing, malformed, and invalid signatures without processing", async () => {
    configureEbay();
    const rawPayload = deletionPayload(`${TAG}-invalid-signature`);
    const restoreResolver = setEbayPublicKeyResolverForTests(async () => publicKeyPem);
    try {
      const missing = await supertest(app)
        .post("/api/ebay/account-deletion")
        .set("Content-Type", "application/json")
        .send(rawPayload);
      assert.equal(missing.status, 412);

      const malformed = await supertest(app)
        .post("/api/ebay/account-deletion")
        .set("Content-Type", "application/json")
        .set("X-EBAY-SIGNATURE", "not-a-base64-json-header")
        .send(rawPayload);
      assert.equal(malformed.status, 412);

      const invalid = await supertest(app)
        .post("/api/ebay/account-deletion")
        .set("Content-Type", "application/json")
        .set("X-EBAY-SIGNATURE", signRawPayload(`${rawPayload} `))
        .send(rawPayload);
      assert.equal(invalid.status, 412);

      const rows = await db
        .select({ total: count() })
        .from(ebayAccountDeletionEventsTable)
        .where(eq(ebayAccountDeletionEventsTable.notificationId, `${TAG}-invalid-signature`));
      assert.equal(rows[0]?.total, 0);
    } finally {
      restoreResolver();
    }
  });

  test("handles duplicate deliveries once and keeps the ledger immutable", async () => {
    configureEbay();
    const notificationId = `${TAG}-duplicate`;
    const restoreResolver = setEbayPublicKeyResolverForTests(async () => publicKeyPem);
    try {
      const first = await requestSignedDeletion(notificationId);
      const duplicate = await requestSignedDeletion(notificationId);
      assert.equal(first.status, 204);
      assert.equal(duplicate.status, 204);

      const rows = await db
        .select({ total: count() })
        .from(ebayAccountDeletionEventsTable)
        .where(eq(ebayAccountDeletionEventsTable.notificationId, notificationId));
      assert.equal(rows[0]?.total, 1);

      await assert.rejects(
        db
          .update(ebayAccountDeletionEventsTable)
          .set({ outcome: "changed" })
          .where(eq(ebayAccountDeletionEventsTable.notificationId, notificationId)),
        (error: unknown) => {
          const cause =
            typeof error === "object" && error !== null && "cause" in error
              ? (error as { cause?: unknown }).cause
              : error;
          assert.match(String(cause), /append-only/);
          return true;
        },
      );
      await assert.rejects(
        db.delete(ebayAccountDeletionEventsTable).where(
          eq(ebayAccountDeletionEventsTable.notificationId, notificationId),
        ),
        (error: unknown) => {
          const cause =
            typeof error === "object" && error !== null && "cause" in error
              ? (error as { cause?: unknown }).cause
              : error;
          assert.match(String(cause), /append-only/);
          return true;
        },
      );
    } finally {
      restoreResolver();
    }
  });
});