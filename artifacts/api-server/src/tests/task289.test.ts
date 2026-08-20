/**
 * Task 289: Focused backend tests.
 *
 * Covers:
 * - Config validation / permissions / confirmed / optimistic-concurrency
 * - Telemetry sanitization / path normalization / semver
 * - Migration ordering / index presence
 * - Enforcement middleware: maintenance exempt/block, invalid version, 426
 * - Analytics availability-shape truthfulness
 * - Audit: immutable flag, sources filter, security merge fields
 * - Integration/route-level supertest coverage for config, runtime-config
 *
 * Integration tests (supertest) create/cleanup their own tagged rows.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { and, eq, gte, like, sql } from "drizzle-orm";
import {
  db,
  pool,
  adminAccountsTable,
  platformConfigTable,
  telemetryEventsTable,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { permissionsForRole } from "../lib/adminPermissions.js";
import {
  validateConfigValue,
  parseSemver,
  compareSemver,
  validatePlatformConfigValues,
  SUPPORTED_CONFIG_KEYS,
  CONFIG_KEY_TYPES,
  invalidateConfigCache,
} from "../lib/platformConfig.js";
import {
  sanitizeMetadata,
  sanitizePath,
  recordTelemetry,
} from "../lib/telemetry.js";
import { getModerationTableDDL } from "../lib/migrate.js";
import { APPEND_ONLY_LIFECYCLE_FK_MIGRATIONS } from "../lib/telemetryMigrations.js";

// ── Tag & constants ───────────────────────────────────────────────────────────
const TAG = `__task289_${Date.now()}__`;
const PASSWORD = "Task289-strong-pass!";

// ── Admin helpers ─────────────────────────────────────────────────────────────

async function createAdmin(suffix: string, role: "owner" | "admin" | "analyst" = "owner") {
  const [account] = await db
    .insert(adminAccountsTable)
    .values({
      email: `${TAG}${suffix}@example.com`,
      displayName: `T289 ${suffix}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      permissions: permissionsForRole(role),
      status: "active",
      invitationDeliveryStatus: "not_requested",
    })
    .returning();
  assert.ok(account);
  return account!;
}

/** Extract a named cookie value from a supertest response. */
function cookieValue(response: supertest.Response, name: string): string {
  const raw = response.headers["set-cookie"];
  const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  if (!cookie) return "";
  return decodeURIComponent(cookie.split(";")[0]!.slice(name.length + 1));
}

/** Login as an admin using a persistent supertest agent. Returns agent and csrf. */
async function loginAgent(email: string): Promise<{
  agent: ReturnType<typeof supertest.agent>;
  csrf: string;
}> {
  const agent = supertest.agent(app);
  const res = await agent
    .post("/api/admin/auth/login")
    .send({ email, password: PASSWORD });
  assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.body)}`);
  const csrf = cookieValue(res, "vtcg_admin_csrf");
  return { agent, csrf };
}

const TEST_CORRELATION_ID = `task289-${process.pid}`;

async function cleanup() {
  await db.execute(sql`ALTER TABLE telemetry_events DISABLE TRIGGER telemetry_events_append_only_mutation`);
  await db.execute(sql`ALTER TABLE telemetry_events DISABLE TRIGGER telemetry_events_append_only_truncate`);
  try {
    await db.delete(adminAccountsTable).where(like(adminAccountsTable.email, `${TAG}%`));
    await db.delete(telemetryEventsTable).where(like(telemetryEventsTable.action, `${TAG}%`));
    await db
      .delete(telemetryEventsTable)
      .where(eq(telemetryEventsTable.correlationId, TEST_CORRELATION_ID));
  } finally {
    await db.execute(sql`ALTER TABLE telemetry_events ENABLE TRIGGER telemetry_events_append_only_mutation`);
    await db.execute(sql`ALTER TABLE telemetry_events ENABLE TRIGGER telemetry_events_append_only_truncate`);
  }
  // Reset any config keys we touched during tests
  await db
    .update(platformConfigTable)
    .set({ value: "false", version: 1, reason: null, revisions: [] })
    .where(eq(platformConfigTable.key, "maintenance_mode"));
  await db
    .update(platformConfigTable)
    .set({ value: "true", version: 1, reason: null, revisions: [] })
    .where(eq(platformConfigTable.key, "scanner_enabled"));
  await db
    .update(platformConfigTable)
    .set({ value: "", version: 1, reason: null, revisions: [] })
    .where(eq(platformConfigTable.key, "maintenance_message"));
  await db
    .update(platformConfigTable)
    .set({ value: "0.0.0", version: 1, reason: null, revisions: [] })
    .where(eq(platformConfigTable.key, "minimum_app_version"));
  invalidateConfigCache();
}

before(async () => {
  await runMigrations();
  await cleanup();
});

after(async () => {
  await cleanup();
  await pool.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT: Config validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Config validation", () => {
  test("boolean key: only 'true'/'false' accepted", () => {
    assert.strictEqual(validateConfigValue("maintenance_mode", "true"), null);
    assert.strictEqual(validateConfigValue("maintenance_mode", "false"), null);
    assert.ok(validateConfigValue("maintenance_mode", "yes") !== null);
    assert.ok(validateConfigValue("maintenance_mode", "1") !== null);
    assert.ok(validateConfigValue("maintenance_mode", "") !== null);
    assert.ok(validateConfigValue("scanner_enabled", "TRUE") !== null);
    assert.strictEqual(validateConfigValue("pricing_enabled", "false"), null);
    assert.strictEqual(validateConfigValue("force_update", "true"), null);
  });

  test("semver key: only valid x.y.z accepted", () => {
    assert.strictEqual(validateConfigValue("minimum_app_version", "1.2.3"), null);
    assert.strictEqual(validateConfigValue("minimum_app_version", "0.0.0"), null);
    assert.strictEqual(validateConfigValue("minimum_app_version", "10.20.30"), null);
    assert.ok(validateConfigValue("minimum_app_version", "1.2") !== null);
    assert.ok(validateConfigValue("minimum_app_version", "v1.2.3") !== null);
    assert.ok(validateConfigValue("minimum_app_version", "1.2.3.4") !== null);
    assert.ok(validateConfigValue("minimum_app_version", "") !== null);
    assert.strictEqual(validateConfigValue("latest_app_version", "2.0.0"), null);
    assert.ok(validateConfigValue("latest_app_version", "not-semver") !== null);
  });

  test("string key: accepts any ≤2000 chars including empty string", () => {
    assert.strictEqual(validateConfigValue("maintenance_message", ""), null);
    assert.strictEqual(validateConfigValue("maintenance_message", "Down for maintenance"), null);
    assert.strictEqual(validateConfigValue("remote_announcement", "Hello collectors"), null);
    const long = "a".repeat(2001);
    assert.ok(validateConfigValue("maintenance_message", long) !== null);
  });

  test("all SUPPORTED_CONFIG_KEYS have CONFIG_KEY_TYPES entry", () => {
    for (const key of SUPPORTED_CONFIG_KEYS) {
      assert.ok(key in CONFIG_KEY_TYPES, `${key} missing from CONFIG_KEY_TYPES`);
    }
  });

  test("version controls reject unsafe cross-setting combinations", () => {
    assert.equal(
      validatePlatformConfigValues({
        maintenance_mode: false,
        maintenance_message: "",
        scanner_enabled: true,
        pricing_enabled: true,
        community_enabled: true,
        minimum_app_version: "0.0.0",
        latest_app_version: "0.0.0",
        force_update: true,
        remote_announcement: "",
      }),
      "latest_app_version must be set before force_update can be enabled",
    );
    assert.equal(
      validatePlatformConfigValues({
        maintenance_mode: false,
        maintenance_message: "",
        scanner_enabled: true,
        pricing_enabled: true,
        community_enabled: true,
        minimum_app_version: "3.0.0",
        latest_app_version: "2.0.0",
        force_update: false,
        remote_announcement: "",
      }),
      "minimum_app_version cannot be greater than latest_app_version",
    );
  });

  test("SUPPORTED_CONFIG_KEYS contains all 9 required controls", () => {
    const expected = [
      "maintenance_mode", "maintenance_message", "scanner_enabled",
      "pricing_enabled", "community_enabled", "minimum_app_version",
      "latest_app_version", "force_update", "remote_announcement",
    ];
    for (const key of expected) {
      assert.ok((SUPPORTED_CONFIG_KEYS as readonly string[]).includes(key), `${key} missing`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT: Semver helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe("Semver helpers", () => {
  test("parseSemver parses valid semver", () => {
    assert.deepStrictEqual(parseSemver("1.2.3"), [1, 2, 3]);
    assert.deepStrictEqual(parseSemver("0.0.0"), [0, 0, 0]);
    assert.deepStrictEqual(parseSemver("10.20.30"), [10, 20, 30]);
    assert.deepStrictEqual(parseSemver("  1.2.3  "), [1, 2, 3]);
  });

  test("parseSemver rejects invalid", () => {
    assert.strictEqual(parseSemver("1.2"), null);
    assert.strictEqual(parseSemver("v1.2.3"), null);
    assert.strictEqual(parseSemver("1.2.3.4"), null);
    assert.strictEqual(parseSemver(""), null);
    assert.strictEqual(parseSemver("abc"), null);
  });

  test("compareSemver orders correctly", () => {
    assert.strictEqual(compareSemver("1.0.0", "2.0.0"), -1);
    assert.strictEqual(compareSemver("2.0.0", "1.0.0"), 1);
    assert.strictEqual(compareSemver("1.2.3", "1.2.3"), 0);
    assert.strictEqual(compareSemver("1.2.3", "1.2.4"), -1);
    assert.strictEqual(compareSemver("1.10.0", "1.9.0"), 1);
    assert.strictEqual(compareSemver("0.0.0", "0.0.1"), -1);
  });

  test("compareSemver returns 0 for invalid input (safe fallback)", () => {
    assert.strictEqual(compareSemver("invalid", "1.0.0"), 0);
    assert.strictEqual(compareSemver("1.0.0", "invalid"), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT: Telemetry sanitization
// ═══════════════════════════════════════════════════════════════════════════════

describe("Telemetry sanitization", () => {
  test("sanitizeMetadata strips PII/secret keys", () => {
    const raw = {
      email: "user@example.com",
      password: "secret",
      token: "abc123",
      ip: "1.2.3.4",
      Authorization: "Bearer xyz",
      cookie: "session=...",
      bearer: "tok",
      credential: "cred",
      action: "card_added",
      cardId: "pokemon-001",
      duration: 123,
    };
    const result = sanitizeMetadata(raw);
    assert.ok(result !== null);
    for (const key of ["email", "password", "token", "ip", "Authorization", "cookie", "bearer", "credential"]) {
      assert.ok(!(key in result), `${key} should be stripped`);
    }
    assert.strictEqual(result["action"], "card_added");
    assert.strictEqual(result["cardId"], "pokemon-001");
    assert.strictEqual(result["duration"], 123);
  });

  test("sanitizeMetadata truncates strings >500 chars", () => {
    const long = "x".repeat(600);
    const result = sanitizeMetadata({ desc: long });
    assert.ok(result !== null);
    assert.strictEqual((result["desc"] as string).length, 500);
  });

  test("sanitizeMetadata returns null for null/undefined/empty after strip", () => {
    assert.strictEqual(sanitizeMetadata(null), null);
    assert.strictEqual(sanitizeMetadata(undefined), null);
    assert.strictEqual(sanitizeMetadata({ email: "x", token: "y" }), null);
  });

  test("sanitizeMetadata recursively strips nested PII", () => {
    const raw = {
      outer: "safe",
      nested: { email: "x@y.com", method: "POST" },
    };
    const result = sanitizeMetadata(raw);
    assert.ok(result !== null);
    assert.strictEqual(result["outer"], "safe");
    assert.ok(typeof result["nested"] === "object" && result["nested"] !== null);
    const nested = result["nested"] as Record<string, unknown>;
    assert.ok(!("email" in nested), "nested email should be stripped");
    assert.strictEqual(nested["method"], "POST");
  });

  test("sanitizePath strips query string", () => {
    assert.strictEqual(sanitizePath("/api/cards?q=pikachu&limit=10"), "/api/cards");
    assert.strictEqual(sanitizePath("/api/auth/signin"), "/api/auth/signin");
    assert.strictEqual(sanitizePath(undefined), "/");
    assert.strictEqual(sanitizePath(""), "/");
  });

  test("sanitizePath normalizes UUID segments", () => {
    const path = "/api/users/123e4567-e89b-12d3-a456-426614174000/profile";
    const result = sanitizePath(path);
    assert.ok(!result.includes("123e4567"), `UUID should be normalized: ${result}`);
    assert.ok(result.includes(":id"), `Should have :id placeholder: ${result}`);
  });

  test("sanitizePath normalizes numeric ID segments", () => {
    const path = "/api/cards/12345/prices";
    const result = sanitizePath(path);
    assert.ok(!result.includes("12345"), `Numeric ID should be normalized: ${result}`);
    assert.ok(result.includes(":id"), `Should have :id placeholder: ${result}`);
  });

  test("database triggers reject telemetry mutation and cover every audit source", async () => {
    const triggerResult = await db.execute<{ table_name: string; trigger_count: number }>(sql`
      SELECT event_object_table AS table_name, COUNT(*)::int AS trigger_count
      FROM information_schema.triggers
      WHERE trigger_name IN (
        'telemetry_events_append_only_mutation',
        'telemetry_events_append_only_truncate',
        'admin_audit_logs_append_only_mutation',
        'admin_audit_logs_append_only_truncate',
        'admin_audit_events_append_only_mutation',
        'admin_audit_events_append_only_truncate'
      )
      GROUP BY event_object_table
    `);
    const counts = new Map(
      triggerResult.rows.map((row) => [row.table_name, Number(row.trigger_count)]),
    );
    assert.equal(counts.get("telemetry_events"), 2);
    assert.equal(counts.get("admin_audit_logs"), 2);
    assert.equal(counts.get("admin_audit_events"), 2);

    await recordTelemetry({
      category: "security",
      action: `${TAG}append_only_probe`,
      status: "ok",
    });
    const [probe] = await db
      .select({ id: telemetryEventsTable.id })
      .from(telemetryEventsTable)
      .where(eq(telemetryEventsTable.action, `${TAG}append_only_probe`))
      .limit(1);
    assert.ok(probe);
    await assert.rejects(
      db
        .update(telemetryEventsTable)
        .set({ status: "failed" })
        .where(eq(telemetryEventsTable.id, probe.id)),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT: Migration DDL ordering
// ═══════════════════════════════════════════════════════════════════════════════

describe("Migration DDL ordering", () => {
  test("getModerationTableDDL returns user_reports before moderation_notes", () => {
    const ddls = getModerationTableDDL();
    assert.ok(ddls.length >= 2, "Expected at least 2 DDL entries");
    assert.ok(ddls[0]!.includes("user_reports"), "First DDL must create user_reports");
    assert.ok(ddls[1]!.includes("moderation_notes"), "Second DDL must create moderation_notes");
  });

  test("getModerationTableDDL returns frozen array", () => {
    const ddls = getModerationTableDDL();
    assert.ok(Object.isFrozen(ddls), "DDL array should be frozen");
  });

  test("legacy raw-DDL audit foreign keys are removed without rewriting retained identities", async () => {
    const schemaName = `task289_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}"`));
      await tx.execute(sql.raw(`
        CREATE TABLE admin_accounts (id UUID PRIMARY KEY);
        CREATE TABLE admin_sessions (id UUID PRIMARY KEY);
        CREATE TABLE users (id UUID PRIMARY KEY);
        CREATE TABLE telemetry_events (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL
        );
        CREATE TABLE admin_audit_logs (
          id UUID PRIMARY KEY,
          admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL
        );
        CREATE TABLE admin_audit_events (
          id UUID PRIMARY KEY,
          admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
          admin_session_id UUID REFERENCES admin_sessions(id) ON DELETE SET NULL
        )
      `));

      const adminId = "10000000-0000-4000-8000-000000000001";
      const sessionId = "10000000-0000-4000-8000-000000000002";
      const userId = "10000000-0000-4000-8000-000000000003";
      await tx.execute(sql.raw(`
        INSERT INTO admin_accounts (id) VALUES ('${adminId}');
        INSERT INTO admin_sessions (id) VALUES ('${sessionId}');
        INSERT INTO users (id) VALUES ('${userId}');
        INSERT INTO telemetry_events (id, user_id, admin_id)
          VALUES ('10000000-0000-4000-8000-000000000004', '${userId}', '${adminId}');
        INSERT INTO admin_audit_logs (id, admin_id)
          VALUES ('10000000-0000-4000-8000-000000000005', '${adminId}');
        INSERT INTO admin_audit_events (id, admin_id, admin_session_id)
          VALUES ('10000000-0000-4000-8000-000000000006', '${adminId}', '${sessionId}')
      `));

      const before = await tx.execute<{ conname: string }>(sql.raw(`
        SELECT constraint_row.conname
        FROM pg_constraint constraint_row
        JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
        JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
        WHERE constraint_row.contype = 'f'
          AND source_namespace.nspname = '${schemaName}'
        ORDER BY constraint_row.conname
      `));
      const legacyNames = before.rows.map((row) => row.conname);
      assert.ok(legacyNames.includes("admin_audit_logs_admin_id_fkey"));
      assert.ok(legacyNames.includes("admin_audit_events_admin_id_fkey"));
      assert.ok(legacyNames.includes("admin_audit_events_admin_session_id_fkey"));

      for (const migration of APPEND_ONLY_LIFECYCLE_FK_MIGRATIONS) {
        await tx.execute(sql.raw(migration));
      }

      const after = await tx.execute<{ count: number }>(sql.raw(`
        SELECT COUNT(*)::int AS count
        FROM pg_constraint constraint_row
        JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
        JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
        WHERE constraint_row.contype = 'f'
          AND source_namespace.nspname = '${schemaName}'
          AND source_table.relname IN (
            'telemetry_events',
            'admin_audit_logs',
            'admin_audit_events'
          )
      `));
      assert.equal(Number(after.rows[0]?.count ?? -1), 0);

      await tx.execute(sql.raw(`
        DELETE FROM admin_sessions WHERE id = '${sessionId}';
        DELETE FROM users WHERE id = '${userId}';
        DELETE FROM admin_accounts WHERE id = '${adminId}'
      `));

      const retained = await tx.execute<{
        telemetry_admin_id: string;
        telemetry_user_id: string;
        log_admin_id: string;
        event_admin_id: string;
        event_session_id: string;
      }>(sql.raw(`
        SELECT
          telemetry.admin_id::text AS telemetry_admin_id,
          telemetry.user_id::text AS telemetry_user_id,
          log.admin_id::text AS log_admin_id,
          event.admin_id::text AS event_admin_id,
          event.admin_session_id::text AS event_session_id
        FROM telemetry_events telemetry
        CROSS JOIN admin_audit_logs log
        CROSS JOIN admin_audit_events event
      `));
      assert.deepEqual(retained.rows[0], {
        telemetry_admin_id: adminId,
        telemetry_user_id: userId,
        log_admin_id: adminId,
        event_admin_id: adminId,
        event_session_id: sessionId,
      });

      await tx.execute(sql.raw(`DROP SCHEMA "${schemaName}" CASCADE`));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Enforcement middleware
// ═══════════════════════════════════════════════════════════════════════════════

describe("Enforcement middleware", () => {
  test("invalid x-app-version returns 400 (not bypass)", async () => {
    const res = await supertest(app)
      .get("/api/catalog/cards")
      .set("x-app-version", "invalid-version");
    assert.equal(res.status, 400, `Expected 400 for invalid version, got: ${res.status}`);
    assert.equal(res.body.error, "invalid_version");
  });

  test("valid version below minimum returns 426", async () => {
    await db
      .update(platformConfigTable)
      .set({ value: "99.0.0" })
      .where(eq(platformConfigTable.key, "minimum_app_version"));
    invalidateConfigCache();

    const unversioned = await supertest(app).get("/api/catalog/cards");
    assert.equal(
      unversioned.status,
      426,
      `Expected unversioned request to be rejected, got: ${unversioned.status}`,
    );
    assert.equal(unversioned.body.error, "update_required");
    assert.equal(unversioned.body.currentVersion, null);

    const res = await supertest(app)
      .get("/api/catalog/cards")
      .set("x-app-version", "1.0.0");
    assert.equal(res.status, 426, `Expected 426 for below-minimum version, got: ${res.status}`);
    assert.equal(res.body.error, "update_required");

    await db
      .update(platformConfigTable)
      .set({ value: "0.0.0" })
      .where(eq(platformConfigTable.key, "minimum_app_version"));
    invalidateConfigCache();
  });

  test("unversioned recovery and runtime-config requests remain available during a version policy", async () => {
    await db
      .update(platformConfigTable)
      .set({ value: "99.0.0" })
      .where(eq(platformConfigTable.key, "minimum_app_version"));
    invalidateConfigCache();

    const [runtimeConfig, recovery, resetPassword] = await Promise.all([
      supertest(app).get("/api/runtime-config"),
      supertest(app).post("/api/auth/recover").send({ email: "not-an-email" }),
      supertest(app).post("/api/auth/reset-password").send({}),
    ]);
    assert.notEqual(runtimeConfig.status, 426);
    assert.notEqual(recovery.status, 426);
    assert.notEqual(resetPassword.status, 426);

    await db
      .update(platformConfigTable)
      .set({ value: "0.0.0" })
      .where(eq(platformConfigTable.key, "minimum_app_version"));
    invalidateConfigCache();
  });

  test("admin paths exempt from maintenance mode", async () => {
    await db
      .update(platformConfigTable)
      .set({ value: "true" })
      .where(eq(platformConfigTable.key, "maintenance_mode"));
    invalidateConfigCache();

    const res = await supertest(app).get("/api/admin/auth/me");
    // Should not be 503 (might be 401/403 from missing session, but not maintenance)
    assert.notEqual(res.status, 503, "Admin path should be exempt from maintenance 503");

    await db
      .update(platformConfigTable)
      .set({ value: "false" })
      .where(eq(platformConfigTable.key, "maintenance_mode"));
    invalidateConfigCache();
  });

  test("healthz exempt from maintenance mode", async () => {
    await db
      .update(platformConfigTable)
      .set({ value: "true" })
      .where(eq(platformConfigTable.key, "maintenance_mode"));
    invalidateConfigCache();

    const res = await supertest(app).get("/api/healthz");
    assert.notEqual(res.status, 503, "healthz should be exempt from maintenance");

    await db
      .update(platformConfigTable)
      .set({ value: "false" })
      .where(eq(platformConfigTable.key, "maintenance_mode"));
    invalidateConfigCache();
  });

  test("runtime-config exempt from maintenance mode", async () => {
    await db
      .update(platformConfigTable)
      .set({ value: "true" })
      .where(eq(platformConfigTable.key, "maintenance_mode"));
    invalidateConfigCache();

    const res = await supertest(app).get("/api/runtime-config");
    assert.notEqual(res.status, 503, "runtime-config should be exempt from maintenance");

    await db
      .update(platformConfigTable)
      .set({ value: "false" })
      .where(eq(platformConfigTable.key, "maintenance_mode"));
    invalidateConfigCache();
  });

  test("eBay deletion challenge bypasses owner controls", async () => {
    const previousVerificationToken = process.env.EBAY_VERIFICATION_TOKEN;
    const previousEndpointUrl = process.env.EBAY_ENDPOINT_URL;
    const verificationToken = "task289-ebay-verification-token";
    const endpointUrl = "https://example.test/api/ebay/account-deletion";
    process.env.EBAY_VERIFICATION_TOKEN = verificationToken;
    process.env.EBAY_ENDPOINT_URL = endpointUrl;

    await Promise.all([
      db
        .update(platformConfigTable)
        .set({ value: "true" })
        .where(eq(platformConfigTable.key, "maintenance_mode")),
      db
        .update(platformConfigTable)
        .set({ value: "99.0.0" })
        .where(eq(platformConfigTable.key, "minimum_app_version")),
      db
        .update(platformConfigTable)
        .set({ value: "100.0.0" })
        .where(eq(platformConfigTable.key, "latest_app_version")),
      db
        .update(platformConfigTable)
        .set({ value: "true" })
        .where(eq(platformConfigTable.key, "force_update")),
    ]);
    invalidateConfigCache();

    try {
      const challengeCode = "task289-challenge";
      const expectedChallenge = createHash("sha256")
        .update(challengeCode)
        .update(verificationToken)
        .update(endpointUrl)
        .digest("hex");
      const challenge = await supertest(app)
        .get("/api/ebay/account-deletion")
        .query({ challenge_code: challengeCode });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body.challengeResponse, expectedChallenge);

      const missingChallenge = await supertest(app).get(
        "/api/ebay/account-deletion",
      );
      assert.equal(missingChallenge.status, 400);
    } finally {
      await Promise.all([
        db
          .update(platformConfigTable)
          .set({ value: "false" })
          .where(eq(platformConfigTable.key, "maintenance_mode")),
        db
          .update(platformConfigTable)
          .set({ value: "0.0.0" })
          .where(eq(platformConfigTable.key, "minimum_app_version")),
        db
          .update(platformConfigTable)
          .set({ value: "0.0.0" })
          .where(eq(platformConfigTable.key, "latest_app_version")),
        db
          .update(platformConfigTable)
          .set({ value: "false" })
          .where(eq(platformConfigTable.key, "force_update")),
      ]);
      invalidateConfigCache();

      if (previousVerificationToken === undefined) {
        delete process.env.EBAY_VERIFICATION_TOKEN;
      } else {
        process.env.EBAY_VERIFICATION_TOKEN = previousVerificationToken;
      }
      if (previousEndpointUrl === undefined) {
        delete process.env.EBAY_ENDPOINT_URL;
      } else {
        process.env.EBAY_ENDPOINT_URL = previousEndpointUrl;
      }
    }
  });

  test("scanner_enabled=false blocks /api/scan routes", async () => {
    await db
      .update(platformConfigTable)
      .set({ value: "false" })
      .where(eq(platformConfigTable.key, "scanner_enabled"));
    invalidateConfigCache();

    const res = await supertest(app).post("/api/scan");
    assert.equal(res.status, 503, `Expected 503 for disabled scanner, got: ${res.status}`);
    assert.equal(res.body.error, "feature_disabled");

    await db
      .update(platformConfigTable)
      .set({ value: "true" })
      .where(eq(platformConfigTable.key, "scanner_enabled"));
    invalidateConfigCache();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Public runtime-config
// ═══════════════════════════════════════════════════════════════════════════════

describe("Public runtime-config", () => {
  test("GET /api/runtime-config returns expected shape without auth", async () => {
    const res = await supertest(app).get("/api/runtime-config");
    assert.equal(res.status, 200, `Expected 200, got: ${res.status}`);
    const body = res.body;
    assert.ok("maintenanceMode" in body, "maintenanceMode missing");
    assert.ok("scannerEnabled" in body, "scannerEnabled missing");
    assert.ok("pricingEnabled" in body, "pricingEnabled missing");
    assert.ok("communityEnabled" in body, "communityEnabled missing");
    assert.ok("minimumAppVersion" in body, "minimumAppVersion missing");
    assert.ok("latestAppVersion" in body, "latestAppVersion missing");
    assert.ok("forceUpdate" in body, "forceUpdate missing");
    // Must not expose admin metadata
    assert.ok(!("changedByAdminId" in body), "must not expose changedByAdminId");
    assert.ok(!("revisions" in body), "must not expose revisions");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Config GET shape + PATCH requirements
// ═══════════════════════════════════════════════════════════════════════════════

describe("Config admin routes", () => {
  let ownerAgent: ReturnType<typeof supertest.agent>;
  let ownerCsrf = "";
  let analystAgent: ReturnType<typeof supertest.agent>;

  before(async () => {
    const ownerAcc = await createAdmin("cfg_owner");
    const analystAcc = await createAdmin("cfg_analyst", "analyst");
    ({ agent: ownerAgent, csrf: ownerCsrf } = await loginAgent(ownerAcc.email));
    ({ agent: analystAgent } = await loginAgent(analystAcc.email));
  });

  test("GET /api/admin/configuration returns controls array with expected shape", async () => {
    const res = await ownerAgent.get("/api/admin/configuration");
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const { controls, serverEnforced } = res.body;
    assert.ok(Array.isArray(controls), "controls must be an array");
    assert.strictEqual(serverEnforced, true, "serverEnforced must be true");
    const ctrl = controls[0];
    assert.ok("key" in ctrl, "key missing");
    assert.ok("label" in ctrl, "label missing");
    assert.ok("description" in ctrl, "description missing");
    assert.ok("risk" in ctrl, "risk missing");
    assert.ok("value" in ctrl, "value missing");
    assert.ok("version" in ctrl, "version missing");
    assert.ok("updatedAt" in ctrl, "updatedAt missing");
    assert.ok("history" in ctrl, "history missing");
    assert.ok(Array.isArray(ctrl.history), "history must be array");
  });

  test("GET /api/admin/configuration: boolean values typed correctly", async () => {
    const res = await ownerAgent.get("/api/admin/configuration");
    assert.equal(res.status, 200);
    const controls = res.body.controls as Array<{ key: string; value: unknown }>;
    const booleanKeys = ["maintenance_mode", "scanner_enabled", "pricing_enabled", "community_enabled", "force_update"];
    for (const k of booleanKeys) {
      const ctrl = controls.find((c) => c.key === k);
      if (ctrl) {
        assert.strictEqual(typeof ctrl.value, "boolean", `${k} value should be boolean, got ${typeof ctrl.value}`);
      }
    }
  });

  test("analyst cannot GET /api/admin/configuration (no configuration:read)", async () => {
    // Analyst role has system:read but not configuration:read per the permission catalog
    const res = await analystAgent.get("/api/admin/configuration");
    assert.equal(res.status, 403, `Analyst should be denied configuration:read, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("PATCH without confirmed:true returns 400", async () => {
    const [row] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.key, "maintenance_message")).limit(1);
    const res = await ownerAgent
      .patch("/api/admin/configuration/maintenance_message")
      .set("x-csrf-token", ownerCsrf)
      .send({
        value: "Test message",
        reason: "Testing confirmed field validation",
        expectedVersion: row?.version ?? 1,
        confirmed: false,
        confirmation: "UPDATE MAINTENANCE_MESSAGE",
      });
    assert.equal(res.status, 400, `Expected 400, got: ${res.status}`);
    assert.ok(
      res.body.message?.toLowerCase().includes("confirmed"),
      `Expected confirmed error, got: ${res.body.message}`,
    );
  });

  test("PATCH with wrong confirmation phrase returns 400", async () => {
    const [row] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.key, "maintenance_message")).limit(1);
    const res = await ownerAgent
      .patch("/api/admin/configuration/maintenance_message")
      .set("x-csrf-token", ownerCsrf)
      .send({
        value: "Test message",
        reason: "Testing confirmation phrase validation",
        expectedVersion: row?.version ?? 1,
        confirmed: true,
        confirmation: "WRONG PHRASE",
      });
    assert.equal(res.status, 400, `Expected 400, got: ${res.status}`);
    assert.ok(
      res.body.message?.includes("UPDATE MAINTENANCE_MESSAGE"),
      `Expected phrase in error, got: ${res.body.message}`,
    );
  });

  test("PATCH with version conflict returns 409", async () => {
    const [row] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.key, "maintenance_message")).limit(1);
    const wrongVersion = (row?.version ?? 1) + 999;
    const res = await ownerAgent
      .patch("/api/admin/configuration/maintenance_message")
      .set("x-csrf-token", ownerCsrf)
      .send({
        value: "Test message",
        reason: "Testing optimistic concurrency conflict",
        expectedVersion: wrongVersion,
        confirmed: true,
        confirmation: "UPDATE MAINTENANCE_MESSAGE",
      });
    assert.equal(res.status, 409, `Expected 409 for version conflict, got: ${res.status}`);
  });

  test("PATCH with no CSRF returns 403", async () => {
    const [row] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.key, "maintenance_message")).limit(1);
    // Use a fresh supertest request without agent (so no cookies/csrf from agent)
    const loginRes = await supertest(app)
      .post("/api/admin/auth/login")
      .send({ email: `${TAG}cfg_owner@example.com`, password: PASSWORD });
    const sessionCookie = cookieValue(loginRes, "vtcg_admin_session");
    // Send with session cookie but NO csrf header
    const res = await supertest(app)
      .patch("/api/admin/configuration/maintenance_message")
      .set("Cookie", `vtcg_admin_session=${sessionCookie}`)
      .send({
        value: "Test",
        reason: "Testing CSRF requirement check",
        expectedVersion: row?.version ?? 1,
        confirmed: true,
        confirmation: "UPDATE MAINTENANCE_MESSAGE",
      });
    assert.equal(res.status, 403, `Expected 403 without CSRF, got: ${res.status}`);
  });

  test("PATCH success: response has typed value", async () => {
    const [row] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.key, "maintenance_message")).limit(1);
    if (!row) return;

    const res = await ownerAgent
      .patch("/api/admin/configuration/maintenance_message")
      .set("x-csrf-token", ownerCsrf)
      .send({
        value: "Scheduled maintenance window",
        reason: "Integration test: verifying typed response",
        expectedVersion: row.version,
        confirmed: true,
        confirmation: "UPDATE MAINTENANCE_MESSAGE",
      });
    if (res.status === 409) return; // concurrent test run, skip gracefully
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(typeof res.body.value, "string", "maintenance_message value should be string");
    assert.ok(res.body.version > row.version, "Version should have incremented");
    invalidateConfigCache();
  });

  test("PATCH boolean control accepts and returns a typed boolean", async () => {
    const [row] = await db
      .select()
      .from(platformConfigTable)
      .where(eq(platformConfigTable.key, "scanner_enabled"))
      .limit(1);
    if (!row) return;

    const nextValue = row.value !== "true";
    const res = await ownerAgent
      .patch("/api/admin/configuration/scanner_enabled")
      .set("x-csrf-token", ownerCsrf)
      .send({
        value: nextValue,
        reason: "Integration test: typed boolean update",
        expectedVersion: row.version,
        confirmed: true,
        confirmation: "UPDATE SCANNER_ENABLED",
      });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.value, nextValue);

    await db
      .update(platformConfigTable)
      .set({ value: row.value, version: res.body.version + 1, updatedAt: new Date() })
      .where(eq(platformConfigTable.key, "scanner_enabled"));
    invalidateConfigCache();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Analytics truthful availability shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("Analytics availability shape", () => {
  let ownerAgent: ReturnType<typeof supertest.agent>;

  before(async () => {
    const admin = await createAdmin("analytics_owner");
    ({ agent: ownerAgent } = await loginAgent(admin.email));
  });

  test("analytics response has required top-level keys", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/analytics?preset=7d");
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const keys = ["range", "tracking", "acquisition", "activeUsers", "retention", "onboarding", "adoption", "performance", "comparisons", "dataAvailability"];
    for (const k of keys) {
      assert.ok(k in res.body, `Missing key: ${k}`);
    }
  });

  test("analytics.tracking.retainedEvents is true", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/analytics?preset=7d");
    assert.equal(res.status, 200);
    assert.strictEqual(res.body.tracking.retainedEvents, true, "tracking.retainedEvents must be true");
  });

  test("analytics.dataAvailability.revenue.available is false with reason", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/analytics?preset=7d");
    assert.equal(res.status, 200);
    assert.strictEqual(res.body.dataAvailability?.revenue?.available, false, "revenue must be available:false");
    assert.ok(res.body.dataAvailability?.revenue?.reason, "revenue.reason must be present");
  });

  test("analytics.activeUsers has definition field", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/analytics?preset=7d");
    assert.equal(res.status, 200);
    assert.ok(res.body.activeUsers?.definition, "activeUsers.definition must be present");
  });

  test("analytics.retention has available and cohorts fields", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/analytics?preset=7d");
    assert.equal(res.status, 200);
    assert.ok("available" in res.body.retention, "retention.available must be present");
    assert.ok(Array.isArray(res.body.retention.cohorts), "retention.cohorts must be an array");
  });

  test("analytics custom range: end before start returns 400", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/analytics?preset=custom&start=2024-12-31&end=2024-01-01");
    assert.equal(res.status, 400, `Expected 400 for invalid range`);
  });

  test("analytics custom range: valid range returns 200", async () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const res = await ownerAgent.get(`/api/admin/intelligence/analytics?preset=custom&start=${start}&end=${end}`);
    assert.equal(res.status, 200, `Expected 200 for valid custom range`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Audit immutable/security merge
// ═══════════════════════════════════════════════════════════════════════════════

describe("Audit endpoint", () => {
  let ownerAgent: ReturnType<typeof supertest.agent>;

  before(async () => {
    const admin = await createAdmin("audit_owner");
    ({ agent: ownerAgent } = await loginAgent(admin.email));
  });

  test("audit response has required envelope keys", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/audit");
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok("events" in res.body, "events missing");
    assert.ok("total" in res.body, "total missing");
    assert.ok("page" in res.body, "page missing");
    assert.ok("limit" in res.body, "limit missing");
    assert.ok("filters" in res.body, "filters missing");
    assert.ok(Array.isArray(res.body.filters?.sources), "filters.sources must be array");
    assert.ok(Array.isArray(res.body.filters?.categories), "filters.categories must be array");
  });

  test("all audit events have immutable:true", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/audit");
    assert.equal(res.status, 200);
    for (const ev of res.body.events ?? []) {
      assert.strictEqual(ev.immutable, true, `Event ${ev.id} must have immutable:true`);
    }
  });

  test("audit events have required fields", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/audit?limit=5");
    assert.equal(res.status, 200);
    for (const ev of res.body.events ?? []) {
      assert.ok("id" in ev, "id missing");
      assert.ok("source" in ev, "source missing");
      assert.ok("category" in ev, "category missing");
      assert.ok("severity" in ev, "severity missing");
      assert.ok("actorLabel" in ev, "actorLabel missing");
      assert.ok("action" in ev, "action missing");
      assert.ok("createdAt" in ev, "createdAt missing");
    }
  });

  test("audit source=admin_audit_logs filter works", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/audit?source=admin_audit_logs");
    assert.equal(res.status, 200);
    for (const ev of res.body.events ?? []) {
      assert.strictEqual(ev.source, "admin_audit_logs", "source filter not applied");
    }
  });

  test("audit source=security filter works", async () => {
    const res = await ownerAgent.get("/api/admin/intelligence/audit?source=security");
    assert.equal(res.status, 200);
    for (const ev of res.body.events ?? []) {
      assert.strictEqual(ev.source, "security", "security source filter not applied");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Job retry/cancel UUID validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Job retry/cancel UUID validation", () => {
  let ownerAgent: ReturnType<typeof supertest.agent>;
  let ownerCsrf = "";

  before(async () => {
    const admin = await createAdmin("job_owner");
    ({ agent: ownerAgent, csrf: ownerCsrf } = await loginAgent(admin.email));
  });

  test("retry with non-UUID id returns 400", async () => {
    const res = await ownerAgent
      .post("/api/admin/intelligence/jobs/not-a-uuid/retry")
      .set("x-csrf-token", ownerCsrf)
      .send({
        reason: "Testing UUID validation for job retry endpoint",
        confirmed: true,
        confirmation: "RETRY JOB",
      });
    assert.equal(res.status, 400, `Expected 400 for non-UUID, got: ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.message?.toLowerCase().includes("uuid"), `Expected UUID error, got: ${res.body.message}`);
  });

  test("cancel with non-UUID id returns 400", async () => {
    const res = await ownerAgent
      .post("/api/admin/intelligence/jobs/bad-id/cancel")
      .set("x-csrf-token", ownerCsrf)
      .send({
        reason: "Testing UUID validation for job cancel endpoint",
        confirmed: true,
        confirmation: "CANCEL JOB",
      });
    assert.equal(res.status, 400, `Expected 400 for non-UUID, got: ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.message?.toLowerCase().includes("uuid"), `Expected UUID error`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: Permission enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe("Permission enforcement", () => {
  let analystAgent: ReturnType<typeof supertest.agent>;
  let analystCsrf = "";

  before(async () => {
    const analyst = await createAdmin("perm_analyst", "analyst");
    ({ agent: analystAgent, csrf: analystCsrf } = await loginAgent(analyst.email));
  });

  test("analyst cannot PATCH config (not owner)", async () => {
    const [row] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.key, "maintenance_message")).limit(1);
    const res = await analystAgent
      .patch("/api/admin/configuration/maintenance_message")
      .set("x-csrf-token", analystCsrf)
      .send({
        value: "Analyst attempt",
        reason: "Testing permission enforcement on config patch",
        expectedVersion: row?.version ?? 1,
        confirmed: true,
        confirmation: "UPDATE MAINTENANCE_MESSAGE",
      });
    assert.equal(res.status, 403, `Analyst should not be able to PATCH config, got: ${res.status}`);
  });

  test("no session returns 401 for config endpoint", async () => {
    const res = await supertest(app).get("/api/admin/configuration");
    assert.equal(res.status, 401, `Expected 401 without session, got: ${res.status}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT + PERSISTENCE: Integration observability (sanitized)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration observability", () => {
  // Mirrors the regex adminIntelligence uses to derive the integration key.
  const KEY_RE = /^integration\.([^.]+)\./;

  const FIXED_ACTIONS = [
    "integration.pricecharting.request",
    "integration.justtcg.request",
    "integration.ebay.request",
    "integration.psa.request",
    "integration.resend.request",
  ] as const;

  test("fixed action names are recognized by the adminIntelligence key regex", () => {
    const expected = ["pricecharting", "justtcg", "ebay", "psa", "resend"];
    FIXED_ACTIONS.forEach((action, i) => {
      const match = KEY_RE.exec(action);
      assert.ok(match, `${action} should match integration key regex`);
      assert.strictEqual(match![1], expected[i], `${action} should resolve key ${expected[i]}`);
    });
  });

  test("recordTelemetry persists a sanitized integration event and strips PII", async () => {
    const since = new Date(Date.now() - 60_000);
    // Deliberately include PII/secret keys and forbidden fields; sanitizer must drop them.
    await recordTelemetry({
      category: "integration",
      action: "integration.justtcg.request",
      status: "ok",
      statusCode: 200,
      durationMs: 42,
      correlationId: TEST_CORRELATION_ID,
      metadata: {
        operation: "cards",
        // The following PII/secret keys must all be stripped by sanitizeMetadata
        // (BLOCKED_KEY_RE) before persistence:
        email: "collector@example.com",
        token: "sk-secret",
        authorization: "Bearer abc",
        credential: "cred",
      } as Record<string, unknown>,
    });

    const rows = await db
      .select({
        action: telemetryEventsTable.action,
        category: telemetryEventsTable.category,
        status: telemetryEventsTable.status,
        statusCode: telemetryEventsTable.statusCode,
        durationMs: telemetryEventsTable.durationMs,
        metadata: telemetryEventsTable.metadata,
      })
      .from(telemetryEventsTable)
      .where(
        and(
          eq(telemetryEventsTable.action, "integration.justtcg.request"),
          gte(telemetryEventsTable.recordedAt, since),
        ),
      )
      .orderBy(telemetryEventsTable.recordedAt)
      .limit(5);

    const row = rows.find((r) => (r.metadata as Record<string, unknown> | null)?.["operation"] === "cards");
    assert.ok(row, "expected persisted integration.justtcg.request event");
    assert.strictEqual(row!.category, "integration");
    assert.strictEqual(row!.status, "ok");
    assert.strictEqual(row!.statusCode, 200);
    assert.strictEqual(row!.durationMs, 42);

    const meta = (row!.metadata ?? {}) as Record<string, unknown>;
    assert.strictEqual(meta["operation"], "cards", "operation enum must be retained");
    for (const forbidden of ["email", "token", "authorization", "credential"]) {
      assert.ok(!(forbidden in meta), `${forbidden} must never be persisted in integration telemetry`);
    }
    // Instrumentation itself only ever emits the fixed operation enum; assert
    // the persisted metadata carries no unexpected keys beyond operation.
    assert.deepStrictEqual(Object.keys(meta).sort(), ["operation"], "only operation enum should remain");
  });

  test("integration events surface via GET /api/admin/intelligence/integrations", async () => {
    const admin = await createAdmin("integ_owner");
    const { agent } = await loginAgent(admin.email);

    // Record one failure so a known key has recent activity.
    await recordTelemetry({
      category: "integration",
      action: "integration.psa.request",
      status: "failed",
      statusCode: 503,
      durationMs: 10,
      correlationId: TEST_CORRELATION_ID,
      metadata: { operation: "cert_lookup" },
    });

    const res = await agent.get("/api/admin/intelligence/integrations");
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const list = res.body?.integrations ?? res.body;
    assert.ok(Array.isArray(list), "integrations response should be an array");
    const keys = list.map((i: { key: string }) => i.key);
    for (const k of ["pricecharting", "justtcg", "ebay", "psa", "resend"]) {
      assert.ok(keys.includes(k), `integrations should include key ${k}`);
    }
  });
});
