import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const collectionItemsTable = pgTable("collection_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  // External catalog reference
  cardId: text("card_id").notNull(),

  // Full Card object stored as JSONB so we don't need a separate cards table.
  // This includes name, setName, imageUrl, price, gradients, etc.
  cardData: jsonb("card_data").notNull(),

  // Quantity owned
  quantity: integer("quantity").notNull().default(1),

  // Condition: one of the CardCondition values in the mobile app types
  condition: text("condition").notNull().default("near_mint"),

  // Grading
  isGraded: boolean("is_graded").notNull().default(false),
  gradingData: jsonb("grading_data"),  // GradingRecord | null

  // Acquisition
  acquiredAt: text("acquired_at").notNull(),  // ISO date string
  // Start of the current ownership interval. Null means the original
  // acquisition date; restored holdings resume ownership on the restore date.
  ownershipStartedAt: text("ownership_started_at"),
  acquiredPriceCents: integer("acquired_price_cents").notNull().default(0),  // minor units
  acquiredCurrency: text("acquired_currency").notNull().default("AUD"),  // ISO 4217

  // Optional metadata
  notes: text("notes"),
  isForSale: boolean("is_for_sale").notNull().default(false),
  isForTrade: boolean("is_for_trade").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CollectionItemRow = typeof collectionItemsTable.$inferSelect;
export type InsertCollectionItem = typeof collectionItemsTable.$inferInsert;
