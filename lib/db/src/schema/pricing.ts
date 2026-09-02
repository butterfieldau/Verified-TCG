/**
 * Pricing domain schemas for PriceCharting provider integration.
 *
 * Tables:
 *  - pricing_providers          — registered price data providers + health
 *  - card_provider_mappings     — card-to-provider product ID mappings
 *  - current_quotes             — normalized latest price per card+grade+provider
 *  - sold_archive_items         — immutable record of sold/archived holdings
 *  - portfolio_snapshots        — periodic point-in-time portfolio value snapshots
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { collectionItemsTable } from "./collection";

// ── Provider registry ─────────────────────────────────────────────────────────

export const pricingProvidersTable = pgTable("pricing_providers", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Stable machine key, e.g. "pricecharting" */
  providerKey: text("provider_key").notNull().unique(),

  /** Human-readable label */
  label: text("label").notNull(),

  /** Whether the provider is currently active/configured */
  isActive: boolean("is_active").notNull().default(false),

  /** ISO timestamp of last successful health check */
  lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true }),

  /** ISO timestamp of last failed health check */
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

  /** Short human-readable description of the last error */
  lastErrorMessage: text("last_error_message"),

  /** Provider base URL */
  baseUrl: text("base_url"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PricingProviderRow = typeof pricingProvidersTable.$inferSelect;

// ── Card provider mappings ─────────────────────────────────────────────────────

export type MappingStatus =
  | "matched"       // strong unambiguous match — receives prices
  | "review_required" // ambiguous — human review needed, no prices served
  | "unmatched";    // no match found — no prices served

export const cardProviderMappingsTable = pgTable(
  "card_provider_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Internal catalog card ID */
    cardId: text("card_id").notNull(),

    /** Provider key (FK-like to pricing_providers.provider_key) */
    providerKey: text("provider_key").notNull(),

    /** Provider's product ID (used for refreshes) */
    providerProductId: text("provider_product_id"),

    /** Provider product name for display / audit */
    providerProductName: text("provider_product_name"),

    /** Provider-native product metadata retained for future market insights */
    providerSalesVolume: integer("provider_sales_volume"),
    providerReleaseDate: text("provider_release_date"),
    providerGenre: text("provider_genre"),
    providerUpc: text("provider_upc"),
    providerEpid: text("provider_epid"),

    /** Match quality: matched | review_required | unmatched */
    status: text("status").notNull().default("unmatched") as ReturnType<typeof text>,

    /** 0–1 confidence score from the matching algorithm */
    confidenceScore: real("confidence_score"),

    /** matched | review_required | unmatched */
    confidenceLevel: text("confidence_level"),

    /** Raw match metadata (scores per dimension) */
    matchMetadata: jsonb("match_metadata"),

    /** Card name used in the match attempt */
    matchedName: text("matched_name"),
    /** Card set used in the match attempt */
    matchedSet: text("matched_set"),
    /** Card number used in the match attempt */
    matchedNumber: text("matched_number"),
    /** Card game used in the match attempt */
    matchedGame: text("matched_game"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("card_provider_mappings_card_provider_uniq").on(t.cardId, t.providerKey),
    index("card_provider_mappings_card_idx").on(t.cardId),
    index("card_provider_mappings_provider_product_idx").on(t.providerKey, t.providerProductId),
  ],
);

export type CardProviderMappingRow = typeof cardProviderMappingsTable.$inferSelect;

// ── Normalized current quotes ─────────────────────────────────────────────────

export const currentQuotesTable = pgTable(
  "current_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    cardId: text("card_id").notNull(),
    providerKey: text("provider_key").notNull(),

    /** Canonical Verified TCG grade key; see api-server/src/pricing/grades.ts. */
    gradeKey: text("grade_key").notNull(),

    /** Price in integer minor units (cents) */
    priceCents: integer("price_cents").notNull(),

    /** ISO 4217 currency code of the price as stored by the provider (e.g. "USD") */
    currency: text("currency").notNull(),

    /** When this quote was fetched from the provider */
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),

    /** Provider product ID that this quote references */
    providerProductId: text("provider_product_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("current_quotes_card_provider_grade_uniq").on(t.cardId, t.providerKey, t.gradeKey),
    index("current_quotes_card_idx").on(t.cardId),
    index("current_quotes_fetched_at_idx").on(t.fetchedAt),
  ],
);

export type CurrentQuoteRow = typeof currentQuotesTable.$inferSelect;

// ── Deduplicated price history snapshots ──────────────────────────────────────
// Extends the legacy price_snapshots table concept with provider attribution.
// One row per (cardId, providerKey, gradeKey, snapshotDate) — idempotent upsert.

export const providerPriceHistoryTable = pgTable(
  "provider_price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    cardId: text("card_id").notNull(),
    providerKey: text("provider_key").notNull(),
    gradeKey: text("grade_key").notNull(),

    /** Price in integer minor units */
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),

    /** Calendar date of this snapshot (YYYY-MM-DD) */
    snapshotDate: text("snapshot_date").notNull(),

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("provider_price_history_dedup_uniq").on(t.cardId, t.providerKey, t.gradeKey, t.snapshotDate),
    index("provider_price_history_card_grade_idx").on(t.cardId, t.gradeKey, t.snapshotDate),
  ],
);

export type ProviderPriceHistoryRow = typeof providerPriceHistoryTable.$inferSelect;

// ── PriceCharting bulk guide cache ───────────────────────────────────────────
// The token is deliberately never stored. Rows are normalized provider payloads
// so a restarted process can reuse the day's downloaded guide without a call.
export const priceChartingGuideImportsTable = pgTable(
  "pricecharting_guide_imports",
  {
    category: text("category").primaryKey(),
    status: text("status").notNull().default("ready"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    rowCount: integer("row_count").notNull().default(0),
    lastErrorKind: text("last_error_kind"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    downloadClaimToken: text("download_claim_token"),
    reconciliationStatus: text("reconciliation_status").notNull().default("pending"),
    reconciliationCursor: text("reconciliation_cursor"),
    reconciliationLeaseUntil: timestamp("reconciliation_lease_until", { withTimezone: true }),
    reconciliationClaimToken: text("reconciliation_claim_token"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciliationStats: jsonb("reconciliation_stats").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const priceChartingGuideRowsTable = pgTable(
  "pricecharting_guide_rows",
  {
    category: text("category").notNull(),
    providerProductId: text("provider_product_id").notNull(),
    productName: text("product_name").notNull(),
    consoleName: text("console_name").notNull(),
    normalizedName: text("normalized_name").notNull().default(""),
    normalizedNumber: text("normalized_number"),
    normalizedSet: text("normalized_set").notNull().default(""),
    prices: jsonb("prices").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("pricecharting_guide_rows_category_product_uniq").on(t.category, t.providerProductId),
    index("pricecharting_guide_rows_category_product_idx").on(t.category, t.providerProductId),
    index("pricecharting_guide_rows_identity_idx").on(t.category, t.normalizedName, t.normalizedNumber),
  ],
);

/** Singleton cross-category CSV lease; PriceCharting's guide throttle is global. */
export const priceChartingGuideDownloadLeaseTable = pgTable("pricecharting_guide_download_lease", {
  leaseKey: text("lease_key").primaryKey(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  claimToken: text("claim_token"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Timestamped provider snapshots ──────────────────────────────────────────
// Unlike provider_price_history, this table permits multiple captures per
// calendar day. snapshotBucket is an application-defined UTC 12-hour bucket
// (YYYY-MM-DD:AM or YYYY-MM-DD:PM), making the intended twice-daily cadence
// explicit and deduplicable without relying on application timezone.
export const cardPriceSnapshotsTable = pgTable(
  "card_price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: text("card_id").notNull(),
    providerKey: text("provider_key").notNull(),
    providerProductId: text("provider_product_id"),
    gradeKey: text("grade_key").notNull(),
    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("USD"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    snapshotBucket: text("snapshot_bucket").notNull(),
    captureStatus: text("capture_status").notNull().default("success"),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("card_price_snapshots_card_provider_grade_bucket_uniq").on(
      t.cardId, t.providerKey, t.gradeKey, t.snapshotBucket,
    ),
    index("card_price_snapshots_card_grade_captured_idx").on(t.cardId, t.gradeKey, t.capturedAt),
    index("card_price_snapshots_provider_product_idx").on(t.providerProductId),
    index("card_price_snapshots_bucket_idx").on(t.snapshotBucket),
    index("card_price_snapshots_captured_idx").on(t.capturedAt),
  ],
);

export type CardPriceSnapshotRow = typeof cardPriceSnapshotsTable.$inferSelect;
export type InsertCardPriceSnapshot = typeof cardPriceSnapshotsTable.$inferInsert;

// ── Portfolio snapshots ────────────────────────────────────────────────────────

export const portfolioSnapshotsTable = pgTable(
  "portfolio_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Total portfolio value in minor units */
    totalValueCents: integer("total_value_cents").notNull(),
    currency: text("currency").notNull().default("AUD"),

    /** Total cost basis in minor units */
    totalCostCents: integer("total_cost_cents").notNull(),

    /** Number of holdings with a price */
    pricedHoldings: integer("priced_holdings").notNull().default(0),

    /** Total number of holdings */
    totalHoldings: integer("total_holdings").notNull().default(0),

    snapshotDate: text("snapshot_date").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("portfolio_snapshots_user_date_uniq").on(t.userId, t.snapshotDate),
    index("portfolio_snapshots_user_date_idx").on(t.userId, t.snapshotDate),
  ],
);

export type PortfolioSnapshotRow = typeof portfolioSnapshotsTable.$inferSelect;

// ── Sold / archived holdings ───────────────────────────────────────────────────
// Immutable rows written at sale time; only PATCH for sale correction is allowed.

export const soldArchiveItemsTable = pgTable(
  "sold_archive_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Original collection item ID (may no longer exist in collection_items) */
    originalCollectionItemId: uuid("original_collection_item_id"),

    /** Card catalog ID */
    cardId: text("card_id").notNull(),

    /** Full card object snapshot at time of sale */
    cardData: jsonb("card_data").notNull(),

    /** Quantity sold */
    quantity: integer("quantity").notNull().default(1),

    /** Condition at time of sale */
    condition: text("condition"),

    /** Grading data snapshot */
    gradingData: jsonb("grading_data"),
    isGraded: boolean("is_graded").notNull().default(false),

    // ── Cost basis (captured at sale) ────────────────────────────────────────
    /** Acquisition price in minor units */
    acquiredPriceCents: integer("acquired_price_cents").notNull().default(0),
    /** Acquisition currency (ISO 4217) */
    acquiredCurrency: text("acquired_currency").notNull().default("AUD"),
    /** ISO date string of acquisition */
    acquiredAt: text("acquired_at"),
    /** Start of the ownership interval that ended with this sale */
    ownershipStartedAt: text("ownership_started_at"),

    // ── Sale details ──────────────────────────────────────────────────────────
    /** Sale price in minor units */
    salePriceCents: integer("sale_price_cents").notNull(),
    /** Sale currency (ISO 4217) */
    saleCurrency: text("sale_currency").notNull().default("AUD"),
    /** ISO date string of sale */
    soldAt: text("sold_at").notNull(),
    /** When this archived quantity was restored to active ownership */
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    /** Active collection row created by the restore */
    restoredCollectionItemId: uuid("restored_collection_item_id"),

    /** Optional venue/platform of sale */
    venue: text("venue"),
    /** Optional buyer identifier */
    buyer: text("buyer"),
    /** Notes */
    notes: text("notes"),

    // ── Market value at disposal (nullable — only set if quote existed) ──────
    /** Market price in minor units at time of sale */
    marketValueAtDisposalCents: integer("market_value_at_disposal_cents"),
    marketValueCurrency: text("market_value_currency"),

    /** Grade key used for market value lookup */
    marketValueGradeKey: text("market_value_grade_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sold_archive_items_user_idx").on(t.userId),
    index("sold_archive_items_card_idx").on(t.cardId),
    index("sold_archive_items_sold_at_idx").on(t.userId, t.soldAt),
  ],
);

export type SoldArchiveItemRow = typeof soldArchiveItemsTable.$inferSelect;
