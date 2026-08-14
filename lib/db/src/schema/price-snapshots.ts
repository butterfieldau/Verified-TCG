import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * price_snapshots — stores periodic price recordings for cards across grades.
 *
 * Rows are inserted by the POST /api/catalog/cards/:id/snapshot-prices endpoint
 * (triggered on-demand when a card detail is viewed if no recent snapshot exists).
 * History accumulates from first deployment; no backfill is required.
 *
 * Queried by GET /api/catalog/cards/:id/price-history to return time-series data
 * for the price history chart.
 */
export const priceSnapshotsTable = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** External catalog card ID (e.g. "pokemon-sv-charizard-ex-special-illustration-rare") */
    cardId: text("card_id").notNull(),

    /** Grade key matching the graded-prices API (e.g. "raw", "psa10", "psa9", "cgc10", "bgs95", "bgs10") */
    gradeKey: text("grade_key").notNull(),

    /** Price in AUD cents */
    priceCents: integer("price_cents").notNull(),

    /** Always "AUD" for now */
    currency: text("currency").notNull().default("AUD"),

    /** Data source — "ebay_sold" for eBay completed listings */
    source: text("source").notNull().default("ebay_sold"),

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_snapshots_card_grade_idx").on(t.cardId, t.gradeKey, t.recordedAt),
  ],
);

export type PriceSnapshotRow = typeof priceSnapshotsTable.$inferSelect;
export type InsertPriceSnapshot = typeof priceSnapshotsTable.$inferInsert;
