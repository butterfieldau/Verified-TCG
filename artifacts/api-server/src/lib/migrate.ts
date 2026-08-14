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

  // Apply forward column migrations
  for (const statement of COLUMN_MIGRATIONS) {
    await db.execute(sql.raw(statement));
  }

  logger.info({ count: COLUMN_MIGRATIONS.length }, "Column migrations applied");
}
