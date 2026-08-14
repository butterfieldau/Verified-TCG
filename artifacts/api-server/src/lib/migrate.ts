/**
 * Schema readiness check — verifies required tables exist before the server
 * accepts any traffic. Throws with a clear message if a table is missing so
 * the process exits with a non-zero code instead of serving 500s.
 *
 * Migrations are NOT applied here. Apply them as a separate step before
 * deploying by running:
 *
 *   pnpm --filter @workspace/db run push
 *
 * or generate + apply a versioned migration:
 *
 *   cd lib/db && npx drizzle-kit generate && npx drizzle-kit migrate
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const REQUIRED_TABLES = ["users", "user_sessions", "collection_items", "password_reset_tokens", "contact_submissions"] as const;

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
}
