/**
 * Fresh-schema regression for moderation-table migration ORDER.
 *
 * Reproduces a brand-new database using an isolated, throwaway PostgreSQL
 * schema (via search_path) so we never touch the real public schema. It then
 * executes the EXACT production DDL statements the runtime uses (obtained from
 * migrate.ts via the narrow getModerationTableDDL() accessor) in their declared
 * order and asserts both tables materialize.
 *
 * This is the regression that would have caught moderation_notes being created
 * before user_reports (its FK target): if the order regressed, the
 * moderation_notes CREATE would throw with "relation user_reports does not
 * exist" and this test would fail.
 *
 * Everything runs on ONE dedicated client bound to the temp schema and is torn
 * down with DROP SCHEMA ... CASCADE, so no state leaks into the shared DB.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { getModerationTableDDL } from "../lib/migrate.js";

/** Minimal client surface we use — avoids a direct dependency on pg's types. */
interface QueryClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

// Unique, isolated schema name for this run.
const TMP_SCHEMA = `fresh_mig_test_${Date.now()}`;

// Minimal stubs for the two tables user_reports references (users,
// admin_accounts). Only the columns needed to satisfy the FKs — the point of
// this test is migration ORDER, not the full production shape of those parents.
const USERS_STUB = `CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
)`;
const ADMIN_ACCOUNTS_STUB = `CREATE TABLE IF NOT EXISTS admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
)`;

let client: QueryClient;

before(async () => {
  client = (await pool.connect()) as unknown as QueryClient;
  // Create and enter an isolated schema; qualify pg_catalog so gen_random_uuid
  // etc. still resolve.
  await client.query(`CREATE SCHEMA "${TMP_SCHEMA}"`);
  await client.query(`SET search_path TO "${TMP_SCHEMA}", pg_catalog`);
  // pgcrypto's gen_random_uuid is available in modern Postgres core; ensure the
  // extension exists in case the target relies on the extension form.
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
});

after(async () => {
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${TMP_SCHEMA}" CASCADE`);
  } finally {
    client.release();
    await pool.end();
  }
});

describe("fresh-schema migration order: user_reports before moderation_notes", () => {
  test("exact production DDL creates both moderation tables in order", async () => {
    // Parent stubs first (users, admin_accounts) so FKs can resolve.
    await client.query(USERS_STUB);
    await client.query(ADMIN_ACCOUNTS_STUB);

    const ddl = getModerationTableDDL();
    // The accessor MUST return user_reports before moderation_notes.
    assert.equal(ddl.length, 2);
    assert.match(ddl[0]!, /CREATE TABLE IF NOT EXISTS user_reports/);
    assert.match(ddl[1]!, /CREATE TABLE IF NOT EXISTS moderation_notes/);

    // Execute in declared order. If moderation_notes preceded user_reports,
    // this second statement would throw ("relation user_reports does not
    // exist"), failing the test — exactly the regression we guard against.
    for (const statement of ddl) {
      await client.query(statement);
    }

    // Assert both tables now exist in the temp schema.
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = ANY($2)`,
      [TMP_SCHEMA, ["user_reports", "moderation_notes"]],
    );
    const names = new Set(res.rows.map((r) => r.table_name as string));
    assert.ok(names.has("user_reports"), "user_reports must exist");
    assert.ok(names.has("moderation_notes"), "moderation_notes must exist");

    // Sanity: user_reports carries the full normalized shape (a late-added
    // column like escalated_at must be present from the CREATE alone).
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'user_reports'`,
      [TMP_SCHEMA],
    );
    const colNames = new Set(cols.rows.map((r) => r.column_name as string));
    for (const expected of [
      "status",
      "priority",
      "severity",
      "assigned_admin_id",
      "evidence_refs",
      "resolution_reason",
      "resolved_by_admin_id",
      "escalated_at",
      "updated_at",
    ]) {
      assert.ok(colNames.has(expected), `user_reports.${expected} must exist from CREATE`);
    }
  });
});
