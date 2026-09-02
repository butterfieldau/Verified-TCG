import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabasePool } from "@workspace/db";
import { runMigrationsWithDatabase } from "./migrate.js";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../lib/db/drizzle/", import.meta.url),
);
const CANONICAL_CATALOGUE_MIGRATION = fileURLToPath(
  new URL("../../../../lib/db/drizzle/0006_canonical_catalogue_foundation.sql", import.meta.url),
);

/**
 * These objects predate the tracked Drizzle journal but are referenced by
 * migrations 0004 and 0005. They deliberately do not reference `users` yet:
 * the official journal creates `users` in 0000 after this preflight runs.
 *
 * The shapes include all presently required columns so the later runtime
 * schema reconciler only needs to enforce the deferred user FK and other
 * ordinary idempotent application constraints.
 */
const HISTORICAL_MIGRATION_PREREQUISITES = [
  `CREATE TABLE IF NOT EXISTS admin_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(24) NOT NULL DEFAULT 'support',
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'invited',
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    invitation_token_hash TEXT,
    invitation_expires_at TIMESTAMPTZ,
    invitation_delivery_status VARCHAR(24) NOT NULL DEFAULT 'not_requested',
    created_by_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_failure_at TIMESTAMPTZ,
    last_failure_reason TEXT,
    last_validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT push_tokens_token_uniq UNIQUE (token)
  )`,
  `CREATE TABLE IF NOT EXISTS card_provider_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    provider_product_id TEXT,
    provider_product_name TEXT,
    provider_sales_volume INTEGER,
    provider_release_date TEXT,
    provider_genre TEXT,
    provider_upc TEXT,
    provider_epid TEXT,
    status TEXT NOT NULL DEFAULT 'unmatched',
    confidence_score REAL,
    confidence_level TEXT,
    match_metadata JSONB,
    matched_name TEXT,
    matched_set TEXT,
    matched_number TEXT,
    matched_game TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT card_provider_mappings_card_provider_uniq UNIQUE (card_id, provider_key)
  )`,
] as const;

const DEFERRED_PREREQUISITE_CONSTRAINTS = [
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'push_tokens'::regclass
        AND contype = 'f'
        AND confrelid = 'users'::regclass
        AND conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'push_tokens'::regclass
             AND attname = 'user_id'
             AND NOT attisdropped)
        ]
    ) THEN
      ALTER TABLE push_tokens
        ADD CONSTRAINT push_tokens_user_id_users_id_fk
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
  END $$`,
] as const;

export interface DatabaseBootstrapOptions {
  connectionString?: string;
}

/**
 * Official repository-controlled database setup path.
 *
 * It is safe to run again: prerequisite DDL is additive, Drizzle runs only
 * journal entries newer than the latest recorded migration, and schema
 * reconciliation is explicitly run without any data maintenance.
 */
export async function bootstrapDatabase(
  options: DatabaseBootstrapOptions = {},
): Promise<void> {
  const connectionString = options.connectionString ?? process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error("NEON_DATABASE_URL is required to bootstrap the database");
  }

  const pool = createDatabasePool(connectionString);
  const migrationDb = drizzle(pool);

  try {
    const publicTables = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'`,
    );
    const journalTable = await pool.query<{ journal_table: string | null }>(
      `SELECT to_regclass('drizzle.__drizzle_migrations')::text AS journal_table`,
    );

    if (Number(publicTables.rows[0]?.count ?? 0) > 0 && !journalTable.rows[0]?.journal_table) {
      // Legacy installations predate the journal entirely. Never fabricate
      // migration records or replay historical CREATE TABLE statements over
      // them; the existing idempotent schema reconciler is the safe bypass.
      await runMigrationsWithDatabase(migrationDb, {
        includeDataMaintenance: false,
      });

      // 0006 is fully additive and is the canonical source of the Stage 3A
      // catalogue schema. Legacy installations cannot journal it retroactively,
      // so execute its unchanged source statements without creating fake history.
      const canonicalCatalogueSql = await readFile(CANONICAL_CATALOGUE_MIGRATION, "utf8");
      for (const statement of canonicalCatalogueSql.split("--> statement-breakpoint")) {
        const sql = statement.trim();
        if (sql) await pool.query(sql);
      }
      return;
    }

    if (Number(publicTables.rows[0]?.count ?? 0) > 0) {
      const journalEntries = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
      );
      if (Number(journalEntries.rows[0]?.count ?? 0) === 0) {
        throw new Error(
          "Refusing to bootstrap an existing application schema with an empty Drizzle migration journal. " +
            "Restore the genuine drizzle.__drizzle_migrations records before retrying.",
        );
      }
    }

    for (const statement of HISTORICAL_MIGRATION_PREREQUISITES) {
      await pool.query(statement);
    }

    await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });

    for (const statement of DEFERRED_PREREQUISITE_CONSTRAINTS) {
      await pool.query(statement);
    }

    await runMigrationsWithDatabase(migrationDb, {
      includeDataMaintenance: false,
    });
  } finally {
    await pool.end();
  }
}
