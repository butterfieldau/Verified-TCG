import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Persistent wishlist items table.
 * Mirrors the in-memory wishlist store so trade matching and cross-device
 * sync can use real data from the database.
 *
 * The client-generated `itemId` is preserved as the canonical ID
 * (not a DB-generated UUID) so clients can correlate their local state
 * without needing a mapping table.
 */
export const wishlistItemsTable = pgTable("wishlist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  // Client-generated item ID (from the mobile app's WishlistItem.id)
  itemId: text("item_id").notNull(),

  // External catalog reference
  cardId: text("card_id").notNull(),

  // Full Card object stored as JSONB
  cardData: jsonb("card_data").notNull(),

  // Optional user preferences
  desiredGrade: text("desired_grade"),
  targetPrice: integer("target_price_cents"),
  priceAlertEnabled: boolean("price_alert_enabled").notNull().default(false),

  // ISO date string from the client
  addedAt: text("added_at").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Soft-delete tombstone: NULL = active, non-NULL = deleted.
  // Durable across server restarts so sync cannot resurrect a deleted item.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type WishlistItemRow = typeof wishlistItemsTable.$inferSelect;
export type InsertWishlistItem = typeof wishlistItemsTable.$inferInsert;
