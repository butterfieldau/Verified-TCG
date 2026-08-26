import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabasePool } from "@workspace/db";
import { bootstrapDatabase } from "../lib/databaseBootstrap.js";

const SOURCE_DATABASE_URL = process.env.DATABASE_URL;
if (!SOURCE_DATABASE_URL) throw new Error("DATABASE_URL is required for fresh database bootstrap tests");

const DATABASE_NAME = `vtcg_fresh_bootstrap_${process.pid}_${Date.now()}`;
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../lib/db/drizzle/", import.meta.url),
);
const maintenanceUrl = new URL(SOURCE_DATABASE_URL);
maintenanceUrl.pathname = "/postgres";
const freshDatabaseUrl = new URL(SOURCE_DATABASE_URL);
freshDatabaseUrl.pathname = `/${DATABASE_NAME}`;

const REQUIRED_TABLES = [
  "users",
  "user_sessions",
  "collection_items",
  "wishlist_items",
  "follows",
  "scan_usage",
  "events",
  "event_participants",
  "notifications",
  "push_tokens",
  "admin_accounts",
  "admin_sessions",
  "card_provider_mappings",
  "pricing_providers",
  "current_quotes",
  "portfolio_snapshots",
  "telemetry_events",
  "catalogue_cache_entries",
  "catalogue_games",
  "catalogue_sets",
  "catalogue_cards",
  "catalogue_card_variants",
  "catalogue_card_images",
  "catalogue_aliases",
  "catalogue_external_ids",
  "catalogue_source_records",
  "catalogue_import_jobs",
  "catalogue_import_errors",
] as const;

let maintenancePool: ReturnType<typeof createDatabasePool>;

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}

async function expectedJournalEntries(): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"),
  ) as {
    entries: Array<{ when: number; tag: string }>;
  };

  return Promise.all(
    journal.entries.map(async (entry) => {
      const migrationSql = await readFile(`${MIGRATIONS_FOLDER}/${entry.tag}.sql`, "utf8");
      return `${entry.when}:${createHash("sha256").update(migrationSql).digest("hex")}`;
    }),
  );
}

async function waitForFreshDatabaseConnectionsToClose(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await maintenancePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE datname = $1
         AND pid <> pg_backend_pid()`,
      [DATABASE_NAME],
    );
    if (Number(result.rows[0]?.count ?? 0) === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  assert.fail(`bootstrap test left open database connections for ${DATABASE_NAME}`);
}

async function schemaFingerprint(
  pool: ReturnType<typeof createDatabasePool>,
  includeJournal = true,
): Promise<{
  tables: string[];
  constraints: string[];
  indexes: string[];
  migrations: string[];
}> {
  const [tables, constraints, indexes] = await Promise.all([
    pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    ),
    pool.query<{ conname: string }>(
      `SELECT conname
       FROM pg_constraint
       WHERE connamespace = 'public'::regnamespace
       ORDER BY conname`,
    ),
    pool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
       ORDER BY indexname`,
    ),
  ]);
  const migrations = includeJournal
    ? await pool.query<{ hash: string; created_at: string }>(
        `SELECT hash, created_at::text
         FROM drizzle.__drizzle_migrations
         ORDER BY created_at`,
      )
    : { rows: [] as Array<{ hash: string; created_at: string }> };

  return {
    tables: tables.rows.map((row) => row.table_name),
    constraints: constraints.rows.map((row) => row.conname),
    indexes: indexes.rows.map((row) => row.indexname),
    migrations: migrations.rows.map((row) => `${row.created_at}:${row.hash}`),
  };
}

before(async () => {
  maintenancePool = createDatabasePool(maintenanceUrl.toString());
  await maintenancePool.query(`CREATE DATABASE ${quotedIdentifier(DATABASE_NAME)}`);
});

after(async () => {
  try {
    // All pools opened by the bootstrap and the assertions must have closed
    // before the disposable database is removed. Using DROP ... WITH (FORCE)
    // races pg's asynchronous connection teardown and can create a late
    // uncaught error after this test has already passed.
    await waitForFreshDatabaseConnectionsToClose();
    await maintenancePool.query(
      `DROP DATABASE IF EXISTS ${quotedIdentifier(DATABASE_NAME)}`,
    );
  } finally {
    await maintenancePool.end();
  }
});

describe("fresh database bootstrap", () => {
  test("runs the official journal, creates the current schema, and is idempotent", { timeout: 90_000 }, async () => {
    await bootstrapDatabase({ connectionString: freshDatabaseUrl.toString() });

    const freshPool = createDatabasePool(freshDatabaseUrl.toString());
    try {
      const beforeSecondBootstrap = await schemaFingerprint(freshPool);
      const presentTables = new Set(beforeSecondBootstrap.tables);
      assert.equal(beforeSecondBootstrap.tables.length, 72);
      for (const tableName of REQUIRED_TABLES) {
        assert.ok(presentTables.has(tableName), `expected ${tableName} after fresh bootstrap`);
      }

      assert.equal(beforeSecondBootstrap.migrations.length, 7);
      assert.equal(
        new Set(beforeSecondBootstrap.migrations).size,
        7,
        "each recorded migration must be present exactly once",
      );
      assert.deepEqual(
        beforeSecondBootstrap.migrations,
        await expectedJournalEntries(),
        "journal rows must be the real Drizzle records for the repository migration sources",
      );

      const [pushTokenFk, providerEpid] = await Promise.all([
        freshPool.query<{ conname: string }>(
          `SELECT conname
           FROM pg_constraint
           WHERE conrelid = 'push_tokens'::regclass
             AND contype = 'f'
             AND confrelid = 'users'::regclass`,
        ),
        freshPool.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'card_provider_mappings'
             AND column_name = 'provider_epid'`,
        ),
      ]);
      assert.equal(pushTokenFk.rows.length, 1, "push_tokens must reference users");
      assert.equal(providerEpid.rows.length, 1, "card_provider_mappings.provider_epid must exist");

      const bootstrapData = await freshPool.query<{ table_name: string; count: string }>(
        `SELECT 'pricing_providers' AS table_name, count(*)::text FROM pricing_providers
         UNION ALL SELECT 'platform_config', count(*)::text FROM platform_config
         UNION ALL SELECT 'notification_preferences', count(*)::text FROM notification_preferences
         UNION ALL SELECT 'support_cases', count(*)::text FROM support_cases`,
      );
      assert.deepEqual(
        bootstrapData.rows,
        [
          { table_name: "pricing_providers", count: "0" },
          { table_name: "platform_config", count: "0" },
          { table_name: "notification_preferences", count: "0" },
          { table_name: "support_cases", count: "0" },
        ],
        "bootstrap must not seed or backfill operational records",
      );

      await bootstrapDatabase({ connectionString: freshDatabaseUrl.toString() });
      const afterSecondBootstrap = await schemaFingerprint(freshPool);
      assert.deepEqual(afterSecondBootstrap, beforeSecondBootstrap);

      const publicSchemaBeforeLegacyBypass = {
        tables: beforeSecondBootstrap.tables,
        constraints: beforeSecondBootstrap.constraints,
        indexes: beforeSecondBootstrap.indexes,
      };
      await freshPool.query("DROP SCHEMA drizzle CASCADE");
      await bootstrapDatabase({ connectionString: freshDatabaseUrl.toString() });
      const afterLegacyBypass = await schemaFingerprint(freshPool, false);
      assert.deepEqual(
        {
          tables: afterLegacyBypass.tables,
          constraints: afterLegacyBypass.constraints,
          indexes: afterLegacyBypass.indexes,
        },
        publicSchemaBeforeLegacyBypass,
        "legacy journal bypass must preserve the existing public schema",
      );
      assert.equal(afterLegacyBypass.migrations.length, 0);

      await freshPool.query("CREATE SCHEMA drizzle");
      await freshPool.query(
        `CREATE TABLE drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )`,
      );
      await assert.rejects(
        () => bootstrapDatabase({ connectionString: freshDatabaseUrl.toString() }),
        /empty Drizzle migration journal/,
      );
    } finally {
      await freshPool.end();
    }
  });
});
