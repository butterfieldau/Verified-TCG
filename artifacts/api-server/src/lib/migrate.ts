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
  GOVERNANCE_DATA_MIGRATIONS,
  GOVERNANCE_TABLE_MIGRATIONS,
} from "./governanceMigrations";
import {
  TELEMETRY_TABLE_MIGRATIONS,
  TELEMETRY_CONSTRAINT_MIGRATIONS,
  TELEMETRY_DATA_MIGRATIONS,
} from "./telemetryMigrations";

const REQUIRED_TABLES = ["users", "user_sessions", "collection_items", "password_reset_tokens", "contact_submissions"] as const;

/**
 * Idempotent column-level migrations.  Each entry is a raw SQL string that
 * adds a column only when it does not already exist, so running this on an
 * already-migrated database is always safe.
 */
const COLUMN_MIGRATIONS: string[] = [
  `ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS ownership_started_at TEXT`,
  `ALTER TABLE sold_archive_items ADD COLUMN IF NOT EXISTS ownership_started_at TEXT`,
  `ALTER TABLE sold_archive_items ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ`,
  `ALTER TABLE sold_archive_items ADD COLUMN IF NOT EXISTS restored_collection_item_id UUID`,
  // Added: subscription tier and founding-member flag for Pro persistence
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_founding_member BOOLEAN NOT NULL DEFAULT false`,
  // Extended public-profile fields. Defaults preserve existing user visibility.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(2048)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS favourite_tcg VARCHAR(100)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_since VARCHAR(7)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_collection BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_wishlist BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_for_trade BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_for_sale BOOLEAN NOT NULL DEFAULT true`,
  // Added: soft-delete support for wishlist items so deletions are durable across restarts
  // (NULL = active, non-NULL = tombstone; sync endpoint respects this column)
  `ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  // Added: TCG game preferences selected during onboarding, stored comma-separated
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_tcgs TEXT`,
  // Added: account suspension support — NULL means active, non-NULL means suspended
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ`,
  // Added: acquisition currency for collection items (default AUD preserves existing data)
  `ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS acquired_currency TEXT NOT NULL DEFAULT 'AUD'`,
  // PriceCharting product metadata used by provider-neutral market insights
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_sales_volume INTEGER`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_release_date TEXT`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_genre TEXT`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_upc TEXT`,
  `ALTER TABLE card_provider_mappings ADD COLUMN IF NOT EXISTS provider_epid TEXT`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS download_claim_token TEXT`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'pending'`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS reconciliation_cursor TEXT`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS reconciliation_lease_until TIMESTAMPTZ`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS reconciliation_claim_token TEXT`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ`,
  `ALTER TABLE pricecharting_guide_imports ADD COLUMN IF NOT EXISTS reconciliation_stats JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE pricecharting_guide_download_lease ADD COLUMN IF NOT EXISTS claim_token TEXT`,
  `ALTER TABLE pricecharting_guide_rows ADD COLUMN IF NOT EXISTS normalized_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE pricecharting_guide_rows ADD COLUMN IF NOT EXISTS normalized_number TEXT`,
  `ALTER TABLE pricecharting_guide_rows ADD COLUMN IF NOT EXISTS normalized_set TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE pricing_providers ADD COLUMN IF NOT EXISTS last_error_kind TEXT`,
  ...GOVERNANCE_COLUMN_MIGRATIONS,
  // user_reports operational workflow columns — queue status uses 'open' convention
  `ALTER TABLE catalogue_cache_leases ADD COLUMN IF NOT EXISTS owner_token TEXT`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE user_reports ALTER COLUMN status SET DEFAULT 'open'`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS priority VARCHAR(16) NOT NULL DEFAULT 'normal'`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS severity VARCHAR(16) NOT NULL DEFAULT 'medium'`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS resolution TEXT`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS resolution_reason TEXT`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS resolution_note TEXT`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS resolved_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS escalation_reason TEXT`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ`,
  `ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  // contact_submissions operational workflow columns for the support queue
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS resolution TEXT`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS resolution_reason TEXT`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS escalation_reason TEXT`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`,
  `ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(24) NOT NULL DEFAULT 'visible'`,
  `ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_reason TEXT`,
  `ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderated_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Australia/Sydney'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'upcoming'`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS event_mode_enabled BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS capacity INTEGER`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`,
  // Track the operator who created an event so legacy fabricated rows (NULL)
  // can be distinguished from admin-created events. ON DELETE SET NULL so
  // removing an admin never cascades to their events.
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS participation_status TEXT NOT NULL DEFAULT 'participating'`,
  `ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS removal_reason TEXT`,
  `ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS removed_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL`,
];

// Exact production DDL for the two moderation tables whose fresh-schema
// ordering matters (user_reports before moderation_notes). Kept as named
// constants so a test can execute the *exact* statements the runtime uses
// without re-running the full migration pipeline. Exported narrowly below.
const USER_REPORTS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS user_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority VARCHAR(16) NOT NULL DEFAULT 'normal',
    severity VARCHAR(16) NOT NULL DEFAULT 'medium',
    assigned_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    resolution_reason TEXT,
    resolution_note TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    escalated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

const MODERATION_NOTES_TABLE_DDL = `CREATE TABLE IF NOT EXISTS moderation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES user_reports(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

/**
 * Narrow, non-runtime accessor for the exact production DDL of the moderation
 * tables whose creation order is load-bearing. Intended for schema regression
 * tests only; the runtime uses these same constants inside TABLE_MIGRATIONS.
 * The returned array is ordered so user_reports precedes moderation_notes.
 */
export function getModerationTableDDL(): readonly string[] {
  return Object.freeze([USER_REPORTS_TABLE_DDL, MODERATION_NOTES_TABLE_DDL]);
}

/**
 * Idempotent table-level migrations.  Each entry is a raw SQL string that
 * creates a table only when it does not already exist, so running this on an
 * already-migrated database is always safe.
 */
const TABLE_MIGRATIONS: string[] = [
  // Collection organization is deliberately also reconciled here. Legacy
  // installations bypass the tracked journal, while fresh installations see
  // the identical shape through 0008_collection_organization.sql.
  `CREATE TABLE IF NOT EXISTS collection_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT collection_lists_user_name_uniq UNIQUE (user_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS collection_lists_user_position_idx
     ON collection_lists (user_id, position)`,
  `CREATE TABLE IF NOT EXISTS collection_list_items (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id UUID NOT NULL REFERENCES collection_lists(id) ON DELETE CASCADE,
    collection_item_id UUID NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT collection_list_items_list_holding_uniq UNIQUE (list_id, collection_item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS collection_list_items_holding_idx
     ON collection_list_items (collection_item_id)`,
  `CREATE INDEX IF NOT EXISTS collection_list_items_user_list_idx
     ON collection_list_items (user_id, list_id)`,
  `CREATE TABLE IF NOT EXISTS collection_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    view_mode TEXT NOT NULL DEFAULT 'grid',
    selected_list_id UUID REFERENCES collection_lists(id) ON DELETE SET NULL,
    filter_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_key TEXT NOT NULL DEFAULT 'date_desc',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS collection_import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    content_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'previewed',
    source_currency TEXT,
    normalized_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    preview_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    commit_summary JSONB,
    commit_results JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    committed_at TIMESTAMPTZ,
    CONSTRAINT collection_import_jobs_user_hash_uniq UNIQUE (user_id, content_sha256)
  )`,
  `CREATE INDEX IF NOT EXISTS collection_import_jobs_user_created_idx
     ON collection_import_jobs (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS follows (
    follower_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT follows_unique_pair UNIQUE (follower_user_id, followee_user_id)
  )`,
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
  // Community records are part of the durable consumer surface. Create their
  // full base shape here because startup readiness only guarantees the core
  // account tables; trust column migrations must also work on a minimal prior
  // schema rather than assuming a separate Drizzle push already created posts.
  `CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    card_id TEXT,
    card_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    moderation_status VARCHAR(24) NOT NULL DEFAULT 'visible',
    moderation_reason TEXT,
    moderated_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    moderated_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS post_likes (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT post_likes_unique_pair UNIQUE (post_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  // Durable JustTCG response cache and UTC daily outbound-call budget.
  `CREATE TABLE IF NOT EXISTS catalogue_cache_entries (
    cache_key TEXT PRIMARY KEY,
    resource TEXT NOT NULL,
    body JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    fresh_until TIMESTAMPTZ NOT NULL,
    stale_until TIMESTAMPTZ NOT NULL,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS catalogue_cache_entries_resource_idx
    ON catalogue_cache_entries (resource)`,
  `CREATE INDEX IF NOT EXISTS catalogue_cache_entries_stale_until_idx
    ON catalogue_cache_entries (stale_until)`,
  `CREATE TABLE IF NOT EXISTS catalogue_daily_usage (
    usage_date TEXT PRIMARY KEY,
    outbound_calls INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Cross-process ownership for cold misses. A waiter reads the completed
  // cache row instead of issuing a duplicate provider request.
  `CREATE TABLE IF NOT EXISTS catalogue_cache_leases (
    cache_key TEXT PRIMARY KEY,
    owner_token TEXT NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS catalogue_cache_leases_lease_until_idx
    ON catalogue_cache_leases (lease_until)`,
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
    last_error_kind TEXT,
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
  `CREATE TABLE IF NOT EXISTS pricecharting_guide_imports (
    category TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'ready',
    fetched_at TIMESTAMPTZ NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    last_error_kind TEXT,
    last_attempt_at TIMESTAMPTZ,
    lease_until TIMESTAMPTZ,
    download_claim_token TEXT,
    reconciliation_status TEXT NOT NULL DEFAULT 'pending',
    reconciliation_cursor TEXT,
    reconciliation_lease_until TIMESTAMPTZ,
    reconciliation_claim_token TEXT,
    reconciled_at TIMESTAMPTZ,
    reconciliation_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS pricecharting_guide_rows (
    category TEXT NOT NULL,
    provider_product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    console_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL DEFAULT '',
    normalized_number TEXT,
    normalized_set TEXT NOT NULL DEFAULT '',
    prices JSONB NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pricecharting_guide_rows_category_product_uniq
      UNIQUE (category, provider_product_id)
  )`,
  `CREATE INDEX IF NOT EXISTS pricecharting_guide_rows_category_product_idx
    ON pricecharting_guide_rows (category, provider_product_id)`,
  `CREATE TABLE IF NOT EXISTS pricecharting_guide_download_lease (
    lease_key TEXT PRIMARY KEY,
    last_attempt_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL,
    claim_token TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  // Timestamped PriceCharting snapshots. This is additive and intentionally
  // does not alter or delete provider_price_history or legacy price_snapshots.
  `CREATE TABLE IF NOT EXISTS card_price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    provider_product_id TEXT,
    grade_key TEXT NOT NULL,
    price_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot_bucket TEXT NOT NULL,
    capture_status TEXT NOT NULL DEFAULT 'success',
    failure_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT card_price_snapshots_card_provider_grade_bucket_uniq
      UNIQUE (card_id, provider_key, grade_key, snapshot_bucket)
  )`,
  ...GOVERNANCE_TABLE_MIGRATIONS,
  ...TELEMETRY_TABLE_MIGRATIONS,
  // user_reports MUST be created before moderation_notes (which FKs it) and
  // before any user_reports index. This CREATE carries the FULL normalized
  // operational shape so fresh databases are correct without relying on the
  // COLUMN_MIGRATIONS upgrades (those remain idempotent no-ops here for existing
  // databases). References users + admin_accounts, both defined above.
  USER_REPORTS_TABLE_DDL,
  MODERATION_NOTES_TABLE_DDL,
  `CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    profile TEXT,
    location TEXT,
    contact_email TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    verification_status VARCHAR(32) NOT NULL DEFAULT 'not_verified',
    featured BOOLEAN NOT NULL DEFAULT false,
    created_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS event_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    booth TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'approved',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT event_vendors_event_vendor_uniq UNIQUE (event_id, vendor_id)
  )`,
  `CREATE TABLE IF NOT EXISTS certification_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    collection_item_id UUID REFERENCES collection_items(id) ON DELETE SET NULL,
    card_id TEXT NOT NULL,
    card_name TEXT NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'internal',
    certification_id TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    provider_verification_status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
    evidence_source TEXT,
    provider_response JSONB,
    external_verified_at TIMESTAMPTZ,
    reviewed_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    outcome_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS certification_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certification_review_id UUID NOT NULL REFERENCES certification_reviews(id) ON DELETE CASCADE,
    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS verified_drops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    deep_link TEXT,
    eligibility TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    pro_only BOOLEAN NOT NULL DEFAULT false,
    featured BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    created_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    published_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS trust_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(32) NOT NULL,
    record_id UUID NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS admin_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL,
    admin_session_id UUID,
    action VARCHAR(80) NOT NULL,
    category VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info',
    target_type VARCHAR(48) NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // ── TCG data operations: audit, scan outcomes, refresh work, overrides ────────
  `CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    reason TEXT NOT NULL,
    before_state JSONB,
    after_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS scan_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    extracted_name TEXT,
    extracted_set TEXT,
    extracted_number TEXT,
    top_match_card_id TEXT,
    top_match_name TEXT,
    top_match_confidence INTEGER,
    candidate_summary JSONB,
    model TEXT,
    duration_ms INTEGER NOT NULL,
    error_code TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending',
    review_outcome TEXT,
    review_reason TEXT,
    reviewed_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS pricing_refresh_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    provider_key TEXT NOT NULL DEFAULT 'pricecharting',
    requested_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS pricing_scheduler_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_bucket TEXT NOT NULL UNIQUE,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    max_cards INTEGER NOT NULL,
    selected_cards INTEGER NOT NULL DEFAULT 0,
    identity_failures INTEGER NOT NULL DEFAULT 0,
    refresh_succeeded INTEGER NOT NULL DEFAULT 0,
    refresh_failed INTEGER NOT NULL DEFAULT 0,
    snapshots_captured INTEGER NOT NULL DEFAULT 0,
    snapshots_skipped INTEGER NOT NULL DEFAULT 0,
    snapshots_failed INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS pricing_scheduler_runs_status_started_idx
    ON pricing_scheduler_runs (status, started_at DESC)`,
  `ALTER TABLE pricing_scheduler_runs
    ADD COLUMN IF NOT EXISTS snapshots_failed INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS pricing_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id TEXT NOT NULL,
    grade_key TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    original_price_cents INTEGER,
    original_currency TEXT,
    reason TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    revoke_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  // Minimal eBay account-deletion processing evidence. Never store eBay
  // account identifiers here: there is currently no verified account linkage.
  `CREATE TABLE IF NOT EXISTS ebay_account_deletion_events (
    notification_id TEXT PRIMARY KEY,
    outcome VARCHAR(64) NOT NULL DEFAULT 'no_linked_ebay_data',
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

/**
 * Idempotent index/constraint migrations applied AFTER table creation.
 * Used to add constraints that were absent from older versions of a table
 * created before this migration was added.
 */
const CONSTRAINT_MIGRATIONS: string[] = [
  `CREATE INDEX IF NOT EXISTS pricecharting_guide_rows_identity_idx
    ON pricecharting_guide_rows (category, normalized_name, normalized_number)`,
  `CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_user_id)`,
  `CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_user_id)`,
  // Columns added by older ALTER ... ADD COLUMN IF NOT EXISTS statements can
  // exist without their inline FK. Reconcile those relationships separately.
  `DO $$ BEGIN
     ALTER TABLE events
       ADD CONSTRAINT events_created_by_admin_id_fkey
       FOREIGN KEY (created_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL;
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,
  `DO $$ BEGIN
     ALTER TABLE event_participants
       ADD CONSTRAINT event_participants_removed_by_admin_id_fkey
       FOREIGN KEY (removed_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL;
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,
  `DO $$ BEGIN
     ALTER TABLE event_vendors
       ADD CONSTRAINT event_vendors_event_vendor_uniq UNIQUE (event_id, vendor_id);
   EXCEPTION WHEN duplicate_table THEN NULL;
             WHEN duplicate_object THEN NULL;
   END $$`,
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
  // Anonymous aggregate card-detail lookup buckets for the Home Trending feed.
  // No raw search text, user IDs, IP addresses, or device identifiers are kept.
  `CREATE TABLE IF NOT EXISTS card_lookup_buckets (
     card_id TEXT NOT NULL,
     bucket_start TIMESTAMPTZ NOT NULL,
     lookup_count INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT card_lookup_buckets_card_bucket_uniq UNIQUE (card_id, bucket_start),
     CONSTRAINT card_lookup_buckets_count_nonnegative CHECK (lookup_count >= 0)
   )`,
  `CREATE INDEX IF NOT EXISTS card_lookup_buckets_bucket_count_idx
     ON card_lookup_buckets (bucket_start DESC, lookup_count DESC)`,
  `CREATE INDEX IF NOT EXISTS user_reports_status_created_idx
     ON user_reports (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS user_reports_assignee_status_idx
     ON user_reports (assigned_admin_id, status)`,
  `CREATE INDEX IF NOT EXISTS posts_moderation_created_idx
     ON posts (moderation_status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS posts_user_created_idx
     ON posts (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS posts_created_idx
     ON posts (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS post_likes_post_idx
     ON post_likes (post_id)`,
  `CREATE INDEX IF NOT EXISTS post_likes_user_idx
     ON post_likes (user_id)`,
  `CREATE INDEX IF NOT EXISTS post_comments_post_created_idx
     ON post_comments (post_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS moderation_notes_report_created_idx
     ON moderation_notes (report_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS vendors_status_created_idx
     ON vendors (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS event_vendors_event_idx
     ON event_vendors (event_id)`,
  `CREATE INDEX IF NOT EXISTS certification_reviews_status_created_idx
     ON certification_reviews (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS certification_reviews_certification_idx
     ON certification_reviews (certification_id)`,
  `CREATE INDEX IF NOT EXISTS verified_drops_status_schedule_idx
     ON verified_drops (status, starts_at)`,
  `CREATE INDEX IF NOT EXISTS trust_status_history_record_idx
     ON trust_status_history (domain, record_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_events_created_idx
     ON admin_audit_events (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_events_target_idx
     ON admin_audit_events (target_type, target_id, created_at DESC)`,
  // Added: user_blocks — symmetric block relationships between collectors.
  `CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_blocks_unique_pair UNIQUE (blocker_user_id, blocked_user_id)
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
  `CREATE INDEX IF NOT EXISTS card_price_snapshots_card_grade_captured_idx
     ON card_price_snapshots (card_id, grade_key, captured_at)`,
  `CREATE INDEX IF NOT EXISTS card_price_snapshots_provider_product_idx
     ON card_price_snapshots (provider_product_id)`,
  `CREATE INDEX IF NOT EXISTS card_price_snapshots_bucket_idx
     ON card_price_snapshots (snapshot_bucket)`,
  `CREATE INDEX IF NOT EXISTS card_price_snapshots_captured_idx
     ON card_price_snapshots (captured_at)`,
  `CREATE INDEX IF NOT EXISTS portfolio_snapshots_user_date_idx
     ON portfolio_snapshots (user_id, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS sold_archive_items_user_idx
     ON sold_archive_items (user_id)`,
  `CREATE INDEX IF NOT EXISTS sold_archive_items_card_idx
     ON sold_archive_items (card_id)`,
  `CREATE INDEX IF NOT EXISTS sold_archive_items_sold_at_idx
     ON sold_archive_items (user_id, sold_at)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_resource_idx
     ON admin_audit_logs (resource_type, resource_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_actor_idx
     ON admin_audit_logs (admin_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS scan_attempts_status_created_idx
     ON scan_attempts (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS scan_attempts_review_created_idx
     ON scan_attempts (review_status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS scan_attempts_user_created_idx
     ON scan_attempts (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS pricing_refresh_jobs_status_created_idx
     ON pricing_refresh_jobs (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS pricing_refresh_jobs_card_created_idx
     ON pricing_refresh_jobs (card_id, created_at DESC)`,
  // Enforce at most one active (queued or running) job per card+provider atomically.
  // The ON CONFLICT clause in the insert path references this partial unique index
  // so that concurrent admin requests skip duplicate inserts without a separate
  // SELECT round-trip.
  `CREATE UNIQUE INDEX IF NOT EXISTS pricing_refresh_jobs_active_card_provider_uniq
     ON pricing_refresh_jobs (card_id, provider_key)
     WHERE status = 'queued' OR status = 'running'`,
  `CREATE INDEX IF NOT EXISTS pricing_overrides_card_grade_idx
     ON pricing_overrides (card_id, grade_key, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS pricing_overrides_expiry_idx
     ON pricing_overrides (expires_at, revoked_at)`,
  `CREATE INDEX IF NOT EXISTS ebay_account_deletion_events_received_idx
     ON ebay_account_deletion_events (received_at DESC)`,
  ...GOVERNANCE_CONSTRAINT_MIGRATIONS,
  ...TELEMETRY_CONSTRAINT_MIGRATIONS,
  // vtcg_reject_append_only_mutation is created above by the shared telemetry
  // migrations, so these database guards apply safely to fresh databases too.
  `DROP TRIGGER IF EXISTS ebay_account_deletion_events_append_only_mutation ON ebay_account_deletion_events`,
  `CREATE TRIGGER ebay_account_deletion_events_append_only_mutation
     BEFORE UPDATE OR DELETE ON ebay_account_deletion_events
     FOR EACH ROW EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `DROP TRIGGER IF EXISTS ebay_account_deletion_events_append_only_truncate ON ebay_account_deletion_events`,
  `CREATE TRIGGER ebay_account_deletion_events_append_only_truncate
     BEFORE TRUNCATE ON ebay_account_deletion_events
     FOR EACH STATEMENT EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `COMMENT ON TABLE ebay_account_deletion_events IS
     'Append-only, privacy-safe eBay account-deletion processing ledger; contains no eBay account identifiers.'`,
  // NOTE: user_reports is now created (with its full normalized shape) in
  // TABLE_MIGRATIONS, ahead of moderation_notes and its own indexes. The former
  // late bare CREATE here was removed to fix fresh-schema ordering.
  // NOTE: No operational data is ever seeded here. Migrations are strictly
  // schema-only (additive DDL). Fresh deployments start with zero events, and
  // real operational rows are created exclusively through admin/consumer APIs.
  // Normalized internal notes for report/support operational workflows.
  `CREATE TABLE IF NOT EXISTS admin_operational_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    author_admin_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS admin_operational_notes_subject_idx
     ON admin_operational_notes (subject_type, subject_id, created_at)`,
];

/** Existing-data writes retained for normal application startup only. */
const DATA_MAINTENANCE_MIGRATIONS: string[] = [
  `INSERT INTO pricing_providers (id, provider_key, label, is_active, base_url, created_at, updated_at)
   SELECT gen_random_uuid(), 'pricecharting', 'PriceCharting', false,
          'https://www.pricecharting.com/api', NOW(), NOW()
   WHERE NOT EXISTS (SELECT 1 FROM pricing_providers WHERE provider_key = 'pricecharting')`,
  ...GOVERNANCE_DATA_MIGRATIONS,
  ...TELEMETRY_DATA_MIGRATIONS,
];

/**
 * ONE-TIME CLEANUP (NOT SEEDING).
 *
 * Earlier versions of this file seeded three sample events into fresh
 * databases. That seeding has been removed, but databases provisioned under
 * the old code may still contain those fabricated rows. This cleanup deletes
 * ONLY those exact, unmodified sample rows.
 *
 * Each DELETE is narrowly fingerprinted by the exact (name, venue, city,
 * event_date) tuple the old seed used, AND additionally guarded so we only ever
 * remove a genuinely-fabricated, untouched row:
 *   - created_by_admin_id IS NULL  (never remove admin-created events)
 *   - starts_at IS NULL AND ends_at IS NULL AND description IS NULL
 *       (never remove events an operator has since edited/scheduled)
 *   - no rows in event_participants for the event (never remove joined events)
 *   - no rows in event_vendors for the event (never remove linked events)
 *
 * The guards make this idempotent (a second run finds nothing) and safe: a
 * protected, edited, or linked event that happens to share the fingerprint is
 * preserved. This is a targeted data-repair migration, distinct from seeding.
 */
const LEGACY_SEED_EVENTS: Array<{
  name: string;
  venue: string;
  city: string;
  eventDate: string;
}> = [
  { name: "TCXPO Sydney 2026", venue: "Sydney Olympic Park", city: "Sydney, NSW", eventDate: "Aug 15–17, 2026" },
  { name: "Melbourne TCG Fest", venue: "Melbourne Convention Centre", city: "Melbourne, VIC", eventDate: "Sep 20–21, 2026" },
  { name: "Brisbane Card Expo", venue: "Brisbane Convention Centre", city: "Brisbane, QLD", eventDate: "Oct 5, 2026" },
];

/**
 * Delete legacy fabricated seed events matching the exact fingerprint and
 * safety guards. Idempotent and safe to run on every startup. Returns the
 * number of rows removed (primarily for tests/observability).
 */
export async function cleanupLegacySeedEvents(): Promise<number> {
  let removed = 0;
  for (const ev of LEGACY_SEED_EVENTS) {
    const result = await db.execute(sql`
      DELETE FROM events e
      WHERE e.name = ${ev.name}
        AND e.venue = ${ev.venue}
        AND e.city = ${ev.city}
        AND e.event_date = ${ev.eventDate}
        AND e.created_by_admin_id IS NULL
        AND e.starts_at IS NULL
        AND e.ends_at IS NULL
        AND e.description IS NULL
        AND NOT EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM event_vendors ev2 WHERE ev2.event_id = e.id)
    `);
    removed += result.rowCount ?? 0;
  }
  return removed;
}

export async function runMigrations(): Promise<void> {
  await runMigrationsWithDatabase(db);
}

export interface SchemaReconciliationOptions {
  /**
   * Runtime cleanup and data normalisation are intentionally excluded from the
   * fresh-install bootstrap. The bootstrap only creates or reconciles schema;
   * ordinary application startup retains the existing maintenance behaviour.
   */
  includeDataMaintenance?: boolean;
}

export async function runMigrationsWithDatabase(
  migrationDb: Pick<typeof db, "execute"> = db,
  options: SchemaReconciliationOptions = {},
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
        "For a new database, run 'pnpm --filter @workspace/api-server run db:bootstrap' first.",
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

  if (options.includeDataMaintenance === false) {
    logger.info("Database schema reconciliation completed without data maintenance");
    return;
  }

  for (const statement of DATA_MAINTENANCE_MIGRATIONS) {
    await migrationDb.execute(sql.raw(statement));
  }

  // One-time targeted cleanup of legacy fabricated seed events (NOT seeding).
  // Idempotent: only removes exact-fingerprint, unowned, unedited, unlinked rows.
  const legacyRemoved = await cleanupLegacySeedEvents();
  if (legacyRemoved > 0) {
    logger.warn({ count: legacyRemoved }, "Removed legacy fabricated seed events");
  }

  // Normalize legacy user_reports status vocabulary to canonical task-285 values.
  // Idempotent: only touches rows that still carry the old trust-route statuses.
  //   "new"         → "open"      (schema default before reconciliation)
  //   "under_review" → "in_review" (trust-route assignment auto-status)
  //   "actioned"    → "resolved"  (trust-route suspension outcome)
  // The ALTER TABLE default is already changed in the DDL but ADD COLUMN IF NOT
  // EXISTS cannot retroactively change an existing column default, so we run an
  // explicit UPDATE on first startup after the code change and on subsequent
  // restarts (zero rows matched = no-op cost).
  await migrationDb.execute(sql`
    UPDATE user_reports
    SET status = CASE status
      WHEN 'new'          THEN 'open'
      WHEN 'under_review' THEN 'in_review'
      WHEN 'actioned'     THEN 'resolved'
    END
    WHERE status IN ('new', 'under_review', 'actioned')
  `);

  logger.info("Legacy user_reports status values normalized");
}
