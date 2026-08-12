import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const collectionItemsTable = pgTable("collection_items", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  cardId: text("card_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  condition: text("condition").notNull(),
  grading: jsonb("grading"),
  acquiredAt: date("acquired_at"),
  acquiredPrice: numeric("acquired_price", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("AUD"),
  notes: text("notes"),
  isForSale: boolean("is_for_sale").notNull().default(false),
  isForTrade: boolean("is_for_trade").notNull().default(false),
  cardSnapshot: jsonb("card_snapshot"),
  ...timestamps,
});

export const wishlistItemsTable = pgTable("wishlist_items", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  cardId: text("card_id").notNull(),
  desiredGrade: text("desired_grade"),
  targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("AUD"),
  priceAlertEnabled: boolean("price_alert_enabled").notNull().default(false),
  alertType: text("alert_type"),
  cardSnapshot: jsonb("card_snapshot"),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps,
});

export type User = typeof usersTable.$inferSelect;
export type CollectionItem = typeof collectionItemsTable.$inferSelect;
export type WishlistItem = typeof wishlistItemsTable.$inferSelect;
