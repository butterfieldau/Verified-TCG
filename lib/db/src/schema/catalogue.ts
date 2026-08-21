/**
 * Durable JustTCG catalogue cache and daily outbound-call accounting.
 *
 * The cache intentionally stores provider response documents rather than
 * app-specific projections. This lets every read surface share the same
 * provider result while keeping route-specific response shaping local.
 */
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const catalogueCacheEntriesTable = pgTable(
  "catalogue_cache_entries",
  {
    cacheKey: text("cache_key").primaryKey(),
    resource: text("resource").notNull(),
    body: jsonb("body").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    freshUntil: timestamp("fresh_until", { withTimezone: true }).notNull(),
    staleUntil: timestamp("stale_until", { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("catalogue_cache_entries_resource_idx").on(t.resource),
    index("catalogue_cache_entries_stale_until_idx").on(t.staleUntil),
  ],
);

export const catalogueDailyUsageTable = pgTable("catalogue_daily_usage", {
  usageDate: text("usage_date").primaryKey(),
  outboundCalls: integer("outbound_calls").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Short-lived ownership lease used to collapse a cold cache miss across API
 * processes before a provider request consumes the shared daily budget.
 */
export const catalogueCacheLeasesTable = pgTable("catalogue_cache_leases", {
  cacheKey: text("cache_key").primaryKey(),
  ownerToken: text("owner_token").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CatalogueCacheEntryRow = typeof catalogueCacheEntriesTable.$inferSelect;
export type CatalogueDailyUsageRow = typeof catalogueDailyUsageTable.$inferSelect;
export type CatalogueCacheLeaseRow = typeof catalogueCacheLeasesTable.$inferSelect;