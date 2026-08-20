import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, like } from "drizzle-orm";
import supertest from "supertest";
import {
  adminAccountsTable,
  adminAuditLogTable,
  db,
  notificationTemplatesTable,
  pool,
} from "@workspace/db";
import app from "../app.js";
import { permissionsForRole } from "../lib/adminPermissions.js";
import {
  runMigrations,
  runMigrationsWithDatabase,
} from "../lib/migrate.js";

const TAG = `__governance_migration_${process.pid}_${Date.now()}__`;
const PASSWORD = "A-strong-governance-test-password-288";
const request = supertest(app);

function cookieValue(response: supertest.Response, name: string): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `${name} cookie should be set`);
  return decodeURIComponent(cookie.split(";")[0]!.slice(name.length + 1));
}

async function cleanupPublicRows(): Promise<void> {
  const admins = await db
    .select({ id: adminAccountsTable.id })
    .from(adminAccountsTable)
    .where(like(adminAccountsTable.email, `${TAG}%`));
  for (const admin of admins) {
    await db.delete(adminAuditLogTable).where(eq(adminAuditLogTable.adminId, admin.id));
  }
  await db
    .delete(notificationTemplatesTable)
    .where(like(notificationTemplatesTable.name, `${TAG}%`));
  await db.delete(adminAccountsTable).where(like(adminAccountsTable.email, `${TAG}%`));
}

before(async () => {
  await runMigrations();
  await cleanupPublicRows();
});

after(async () => {
  await cleanupPublicRows();
  await pool.end();
});

describe("governance migration readiness", () => {
  test("upgrades a prior schema with tables, constraints, indexes, health columns, and backfills", async () => {
    const client = await pool.connect();
    const schemaName = `governance_migration_${process.pid}_${Date.now()}`;
    assert.match(schemaName, /^[a-z0-9_]+$/);

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE user_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE collection_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE password_reset_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE contact_submissions (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE TABLE push_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const userId = "00000000-0000-4000-8000-000000000288";
      const submissionId = "00000000-0000-4000-8000-000000000289";
      await client.query("INSERT INTO users (id) VALUES ($1)", [userId]);
      await client.query(
        "INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)",
        [userId, `${TAG}-push-token`],
      );
      await client.query(
        "INSERT INTO contact_submissions (id) VALUES ($1)",
        [submissionId],
      );

      const isolatedDb = drizzle(client);
      await runMigrationsWithDatabase(isolatedDb);
      await runMigrationsWithDatabase(isolatedDb);

      const expectedTables = [
        "admin_audit_log",
        "announcements",
        "internal_note_history",
        "internal_notes",
        "notification_campaigns",
        "notification_delivery_attempts",
        "notification_preferences",
        "notification_templates",
        "privacy_request_notes",
        "privacy_requests",
        "retention_policies",
        "retention_runs",
        "support_case_notes",
        "support_cases",
      ];
      const tableResult = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = ANY($2::text[])`,
        [schemaName, expectedTables],
      );
      assert.deepEqual(
        tableResult.rows.map((row) => row.table_name).sort(),
        expectedTables,
      );

      const healthColumns = await client.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = 'push_tokens'
            AND column_name = ANY($2::text[])`,
        [
          schemaName,
          [
            "status",
            "failure_count",
            "last_failure_at",
            "last_failure_reason",
            "last_validated_at",
          ],
        ],
      );
      assert.equal(healthColumns.rowCount, 5);

      const constraints = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.table_constraints
          WHERE table_schema = $1
            AND table_name = ANY($2::text[])
            AND constraint_type = 'FOREIGN KEY'`,
        [schemaName, expectedTables],
      );
      assert.ok(Number(constraints.rows[0]?.count ?? 0) >= 20);

      const indexes = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_indexes
          WHERE schemaname = $1
            AND indexname IN (
              'admin_audit_log_created_at_idx',
              'notification_campaigns_status_idx',
              'notification_delivery_attempts_created_idx',
              'privacy_requests_status_idx',
              'announcements_status_idx'
            )`,
        [schemaName],
      );
      assert.equal(Number(indexes.rows[0]?.count ?? 0), 5);

      const preference = await client.query<{
        push_enabled: boolean;
        source: string;
      }>(
        "SELECT push_enabled, source FROM notification_preferences WHERE user_id = $1",
        [userId],
      );
      assert.deepEqual(preference.rows[0], {
        push_enabled: true,
        source: "existing_push_token",
      });

      const supportCase = await client.query<{ submission_id: string }>(
        "SELECT submission_id FROM support_cases WHERE submission_id = $1",
        [submissionId],
      );
      assert.equal(supportCase.rows[0]?.submission_id, submissionId);
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      client.release();
    }
  });

  test("serves key governance endpoints after startup migration", async () => {
    const [owner] = await db
      .insert(adminAccountsTable)
      .values({
        email: `${TAG}-owner@example.com`,
        displayName: "Governance Migration Owner",
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        role: "owner",
        permissions: permissionsForRole("owner"),
        status: "active",
        invitationDeliveryStatus: "not_requested",
      })
      .returning();
    assert.ok(owner);

    const agent = supertest.agent(app);
    const login = await agent
      .post("/api/admin/auth/login")
      .send({ email: owner.email, password: PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const csrf = cookieValue(login, "vtcg_admin_csrf");

    const created = await agent
      .post("/api/admin/governance/templates")
      .set("x-csrf-token", csrf)
      .send({
        name: `${TAG}-template`,
        description: "Migration readiness test",
        titleTemplate: "Test title",
        bodyTemplate: "Test body",
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.template.name, `${TAG}-template`);

    const templates = await agent.get("/api/admin/governance/templates");
    assert.equal(templates.status, 200, JSON.stringify(templates.body));
    assert.ok(
      templates.body.templates.some(
        (template: { id: string }) => template.id === created.body.template.id,
      ),
    );

    const campaigns = await agent.get("/api/admin/governance/campaigns");
    assert.equal(campaigns.status, 200, JSON.stringify(campaigns.body));
    assert.equal(campaigns.body.providerStatus, "not_connected");
    assert.equal(campaigns.body.deliveryBlocked, true);
  });
});