import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { pool } from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";

const request = supertest(app);

before(async () => {
  await runMigrations();
});

after(async () => {
  await pool.end();
});

describe("POST /catalogue/operations/import-cache", () => {
  test("rejects missing and incorrect operation secrets", async () => {
    process.env.ADMIN_SECRET = "correct-catalogue-secret";
    const missing = await request.post(
      "/api/catalogue/operations/import-cache",
    );
    assert.equal(missing.status, 403);

    const incorrect = await request
      .post("/api/catalogue/operations/import-cache")
      .set("x-admin-secret", "incorrect-catalogue-secret");
    assert.equal(incorrect.status, 403);
    delete process.env.ADMIN_SECRET;
  });

  test("requires an explicit reason and confirmation before any import", async () => {
    process.env.ADMIN_SECRET = "catalogue-operation-secret";
    const response = await request
      .post("/api/catalogue/operations/import-cache")
      .set("x-admin-secret", "catalogue-operation-secret")
      .send({ mode: "incremental", reason: "Production recovery" });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /IMPORT CACHED CATALOGUE/);
    delete process.env.ADMIN_SECRET;
  });
});