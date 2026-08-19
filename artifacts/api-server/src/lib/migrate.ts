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
import {
  GOVERNANCE_COLUMN_MIGRATIONS,
  GOVERNANCE_CONSTRAINT_MIGRATIONS,
  GOVERNANCE_TABLE_MIGRATIONS,
} from "./governanceMigrations";

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
  // Added: soft-delete support for wishlist items so deletions are durable across restarts
  // (NULL = active, non-NULL = tombstone; sync endpoint respects this column)
  `ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  // Added: TCG game preferences selected during onboarding, stored comma-separated
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_tcgs TEXT`,
  // Added: account suspension support — NULL means active, non-NULL means suspended
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ`,
  // Added: acquisition currency for collection items (task 283 — default AUD preserves existing data)
  `ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS acquired_currency TEXT NOT NULL DEFAULT 'AUD'`,
  // PriceCharting product metadata used by provider-neutral market insights
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_sales_volume INTEGER`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_release_date TEXT`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_genre TEXT`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_upc TEXT`,
  ...GOVERNANCE_COLUMN_MIGRATIONS,
];

/**
 * Idempotent table-level migrations.  Each entry is a raw SQL string that
 * creates a table only when it does not already exist, so running this on an
 * already-migrated database is always safe.
 */
const TABLE_MIGRATIONS: string[] = [
  // Dedicated staff identities and sessions. Operator credentials are never
  // mixed with collector accounts or JWT refresh sessions.
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
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    user_agent_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recent_auth_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
  )`,
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
  // Added: periodic price snapshots for the price history chart feature.
  `CREATE TABLE IF NOT EXISTS price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    grade_key TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AUD',
    source TEXT NOT NULL DEFAULT 'ebay_sold',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Added: persistent wishlist storage for trade matching and cross-device sync.
  `CREATE TABLE IF NOT EXISTS wishlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    card_data JSONB NOT NULL,
    desired_grade TEXT,
    target_price_cents INTEGER,
    price_alert_enabled BOOLEAN NOT NULL DEFAULT false,
    added_at TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Added: TCG events (conventions, meetups) that collectors can join.
  `CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    venue TEXT NOT NULL,
    city TEXT NOT NULL,
    event_date TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Added: tracks which users are participating in which events.
  `CREATE TABLE IF NOT EXISTS event_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    is_visible BOOLEAN NOT NULL DEFAULT true
  )`,
  // Added: per-user in-app notification store (price alerts, trade matches, etc.)
  `CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Added: Expo push notification tokens, one row per device per user.
  `CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT push_tokens_token_uniq UNIQUE (token)
  )`,
  // ── Task 283: Pricing domain tables ──────────────────────────────────────────
  // Provider registry
  `CREATE TABLE IF NOT EXISTS pricing_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    last_healthy_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error_message TEXT,
    base_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Card-to-provider product mappings
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
  // Normalized current quotes (one row per card+provider+grade)
  `CREATE TABLE IF NOT EXISTS current_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    grade_key TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider_product_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT current_quotes_card_provider_grade_uniq UNIQUE (card_id, provider_key, grade_key)
  )`,
  // Deduplicated provider price history (one row per card+provider+grade+date)
  `CREATE TABLE IF NOT EXISTS provider_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    grade_key TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT provider_price_history_dedup_uniq UNIQUE (card_id, provider_key, grade_key, snapshot_date)
  )`,
  // Portfolio snapshots (one row per user+date)
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_value_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AUD',
    total_cost_cents INTEGER NOT NULL,
    priced_holdings INTEGER NOT NULL DEFAULT 0,
    total_holdings INTEGER NOT NULL DEFAULT 0,
    snapshot_date TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT portfolio_snapshots_user_date_uniq UNIQUE (user_id, snapshot_date)
  )`,
  // Sold/archived holdings (immutable at creation; PATCH for corrections only)
  `CREATE TABLE IF NOT EXISTS sold_archive_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_collection_item_id UUID,
    card_id TEXT NOT NULL,
    card_data JSONB NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    condition TEXT,
    grading_data JSONB,
    is_graded BOOLEAN NOT NULL DEFAULT false,
    acquired_price_cents INTEGER NOT NULL DEFAULT 0,
    acquired_currency TEXT NOT NULL DEFAULT 'AUD',
    acquired_at TEXT,
    sale_price_cents INTEGER NOT NULL,
    sale_currency TEXT NOT NULL DEFAULT 'AUD',
    sold_at TEXT NOT NULL,
    venue TEXT,
    buyer TEXT,
    notes TEXT,
    market_value_at_disposal_cents INTEGER,
    market_value_currency TEXT,
    market_value_grade_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  ...GOVERNANCE_TABLE_MIGRATIONS,
];

/**
 * Idempotent index/constraint migrations applied AFTER table creation.
 * Used to add constraints that were absent from older versions of a table
 * created before this migration was added.
 */
const CONSTRAINT_MIGRATIONS: string[] = [
  `CREATE INDEX IF NOT EXISTS admin_sessions_admin_active_idx
     ON admin_sessions (admin_id, revoked_at, expires_at)`,
  `CREATE INDEX IF NOT EXISTS admin_accounts_status_idx
     ON admin_accounts (status, role)`,
  // Ensure scan_usage unique constraint exists on databases where the table
  // was created by an earlier version of TABLE_MIGRATIONS that omitted it.
  `DO $$ BEGIN
    ALTER TABLE scan_usage
      ADD CONSTRAINT scan_usage_user_period_uniq UNIQUE (user_id, period_start);
  EXCEPTION WHEN duplicate_table THEN NULL;
            WHEN duplicate_object THEN NULL;
  END $$`,
  // Add index on price_snapshots for efficient card+grade+time queries
  `CREATE INDEX IF NOT EXISTS price_snapshots_card_grade_idx
     ON price_snapshots (card_id, grade_key, recorded_at)`,
  // Index on event_participants for efficient (event_id, user_id) lookups
  `CREATE INDEX IF NOT EXISTS event_participants_event_user_idx
     ON event_participants (event_id, user_id)`,
  // Unique constraint on event_participants so each user has exactly one row per event.
  // Prevents concurrent joins from creating duplicate active-participation rows.
  // Uses DO $$ to swallow "already exists" rather than failing on already-migrated DBs.
  `DO $$ BEGIN
     ALTER TABLE event_participants
       ADD CONSTRAINT event_participants_event_user_uniq UNIQUE (event_id, user_id);
   EXCEPTION WHEN duplicate_table THEN NULL;
             WHEN duplicate_object THEN NULL;
   END $$`,
  // Unique constraint on wishlist_items (user_id, item_id) to enable upsert semantics.
  `DO $$ BEGIN
     ALTER TABLE wishlist_items
       ADD CONSTRAINT wishlist_items_user_item_uniq UNIQUE (user_id, item_id);
   EXCEPTION WHEN duplicate_table THEN NULL;
             WHEN duplicate_object THEN NULL;
   END $$`,
  // Index on notifications for efficient per-user reads (newest unread first)
  `CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
     ON notifications (user_id, is_read, created_at DESC)`,
  // Added: enum type for activity_log event_type column.
  // DO block swallows "already exists" so this is safe on re-runs.
  `DO $$ BEGIN
     CREATE TYPE activity_event_type AS ENUM (
       'card_added', 'card_removed', 'wishlist_added', 'wishlist_removed',
       'price_alert_fired', 'collection_updated'
     );
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,
  // Added: per-user activity log for the Home screen "Recent Activity" feed.
  `CREATE TABLE IF NOT EXISTS activity_log (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     event_type activity_event_type NOT NULL,
     entity_id TEXT,
     entity_name TEXT,
     metadata JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Index for fast per-user activity reads (newest first)
  `CREATE INDEX IF NOT EXISTS activity_log_user_created_at_idx
     ON activity_log (user_id, created_at DESC)`,
  // Added: user_blocks — symmetric block relationships between collectors.
  `CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_blocks_unique_pair UNIQUE (blocker_user_id, blocked_user_id)
  )`,
  // Added: user_reports — collector report submissions (admin review is out-of-band).
  `CREATE TABLE IF NOT EXISTS user_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // ── Task 283: Pricing domain indexes ─────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS card_provider_mappings_card_idx
     ON card_provider_mappings (card_id)`,
  `CREATE INDEX IF NOT EXISTS card_provider_mappings_provider_product_idx
     ON card_provider_mappings (provider_key, provider_product_id)`,
  `CREATE INDEX IF NOT EXISTS current_quotes_card_idx
     ON current_quotes (card_id)`,
  `CREATE INDEX IF NOT EXISTS current_quotes_fetched_at_idx
     ON current_quotes (fetched_at)`,
  `CREATE INDEX IF NOT EXISTS provider_price_history_card_grade_idx
     ON provider_price_history (card_id, grade_key, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_date_idx
     ON portfolio_snapshots (user_id, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS sold_archive_items_user_idx
     ON sold_archive_items (user_id)`,
  `CREATE INDEX IF NOT EXISTS sold_archive_items_card_idx
     ON sold_archive_items (card_id)`,
  `CREATE INDEX IF NOT EXISTS sold_archive_items_sold_at_idx
     ON sold_archive_items (user_id, sold_at)`,
  // Seed PriceCharting provider row (idempotent)
  `INSERT INTO pricing_providers (id, provider_key, label, is_active, base_url, created_at, updated_at)
   SELECT gen_random_uuid(), 'pricecharting', 'PriceCharting', false,
          'https://www.pricecharting.com/api', NOW(), NOW()
   WHERE NOT EXISTS (SELECT 1 FROM pricing_providers WHERE provider_key = 'pricecharting')`,
  // Seed initial events if the table is empty
  `INSERT INTO events (id, name, venue, city, event_date, is_active, created_at)
   SELECT gen_random_uuid(), 'TCXPO Sydney 2026', 'Sydney Olympic Park', 'Sydney, NSW', 'Aug 15–17, 2026', true, NOW()
   WHERE NOT EXISTS (SELECT 1 FROM events LIMIT 1)`,
  `INSERT INTO events (id, name, venue, city, event_date, is_active, created_at)
   SELECT gen_random_uuid(), 'Melbourne TCG Fest', 'Melbourne Convention Centre', 'Melbourne, VIC', 'Sep 20–21, 2026', true, NOW()
   WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'Melbourne TCG Fest')`,
  `INSERT INTO events (id, name, venue, city, event_date, is_active, created_at)
   SELECT gen_random_uuid(), 'Brisbane Card Expo', 'Brisbane Convention Centre', 'Brisbane, QLD', 'Oct 5, 2026', true, NOW()
   WHERE NOT EXISTS (SELECT 1 FROM events WHERE name = 'Brisbane Card Expo')`,
  ...GOVERNANCE_CONSTRAINT_MIGRATIONS,
];

export async function runMigrations(): Promise<void> {
  await runMigrationsWithDatabase(db);
}

export async function runMigrationsWithDatabase(
  migrationDb: Pick<typeof db, "execute"> = db,
): Promise<void> {
  logger.info("Verifying database schema");

  const result = await migrationDb.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
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
    await migrationDb.execute(sql.raw(statement));
  }

  logger.info({ count: TABLE_MIGRATIONS.length }, "Table migrations applied");

  // Apply forward column migrations
  for (const statement of COLUMN_MIGRATIONS) {
    await migrationDb.execute(sql.raw(statement));
  }

  logger.info({ count: COLUMN_MIGRATIONS.length }, "Column migrations applied");

  // Apply forward constraint/index migrations (idempotent, post-table)
  for (const statement of CONSTRAINT_MIGRATIONS) {
    await migrationDb.execute(sql.raw(statement));
  }

  logger.info({ count: CONSTRAINT_MIGRATIONS.length }, "Constraint migrations applied");
}
