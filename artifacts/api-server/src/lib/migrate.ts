/**
 * Schema readiness check and forward migrations.
 *
 * On startup this module:
 *   1. Verifies that all required base tables exist (hard fail if missing).
 *   2. Applies additive, idempotent column migrations using
 *      `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so new columns are always
 *      present regardless of when the database was first provisioned.
 *
 * Adding a new column:
 *   - Add an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statement to
 *     COLUMN_MIGRATIONS below.
 *   - Also update lib/db/src/schema/<table>.ts with the matching Drizzle
 *     column definition and run `pnpm --filter @workspace/db run push` to
 *     sync a fresh development database.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const REQUIRED_TABLES = ["users", "user_sessions", "collection_items", "password_reset_tokens", "contact_submissions"] as const;

/**
 * Idempotent column-level migrations.  Each entry is a raw SQL string that
 * adds a column only when it does not already exist, so running this on an
 * already-migrated database is always safe.
 */
const COLUMN_MIGRATIONS: string[] = [
  // Added: subscription tier and founding-member flag for Pro persistence
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_founding_member BOOLEAN NOT NULL DEFAULT false`,
];

/**
 * Idempotent table-level migrations.  Each entry is a raw SQL string that
 * creates a table only when it does not already exist, so running this on an
 * already-migrated database is always safe.
 */
const TABLE_MIGRATIONS: string[] = [
  // Added: per-user monthly scan usage tracking for the card scanner feature.
  // Includes the unique constraint so it is present on freshly-provisioned DBs.
  `CREATE TABLE IF NOT EXISTS scan_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start TIMESTAMP NOT NULL,
    scan_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scan_usage_user_period_uniq UNIQUE (user_id, period_start)
  )`,
];

/**
 * Idempotent index/constraint migrations applied AFTER table creation.
 * Used to add constraints that were absent from older versions of a table
 * created before this migration was added.
 */
const CONSTRAINT_MIGRATIONS: string[] = [
  // Ensure scan_usage unique constraint exists on databases where the table
  // was created by an earlier version of TABLE_MIGRATIONS that omitted it.
  `DO $$ BEGIN
    ALTER TABLE scan_usage
      ADD CONSTRAINT scan_usage_user_period_uniq UNIQUE (user_id, period_start);
  EXCEPTION WHEN duplicate_table THEN NULL;
            WHEN duplicate_object THEN NULL;
  END $$`,
];

export async function runMigrations(): Promise<void> {
  logger.info("Verifying database schema");

  const result = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(ARRAY[${sql.raw(REQUIRED_TABLES.map(t => `'${t}'`).join(", "))}])
  `);

  const found = new Set(result.rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !found.has(t));

  if (missing.length > 0) {
    throw new Error(
      `Required database tables are missing: [${missing.join(", ")}]. ` +
        "Run 'pnpm --filter @workspace/db run push' before starting the server.",
    );
  }

  logger.info({ tables: [...found] }, "Database schema verified");

  // Apply forward table migrations (CREATE TABLE IF NOT EXISTS)
  for (const statement of TABLE_MIGRATIONS) {
    await db.execute(sql.raw(statement));
  }

  logger.info({ count: TABLE_MIGRATIONS.length }, "Table migrations applied");

  // Apply forward column migrations
  for (const statement of COLUMN_MIGRATIONS) {
    await db.execute(sql.raw(statement));
  }

  logger.info({ count: COLUMN_MIGRATIONS.length }, "Column migrations applied");

  // Apply forward constraint/index migrations (idempotent, post-table)
  for (const statement of CONSTRAINT_MIGRATIONS) {
    await db.execute(sql.raw(statement));
  }

  logger.info({ count: CONSTRAINT_MIGRATIONS.length }, "Constraint migrations applied");
}
