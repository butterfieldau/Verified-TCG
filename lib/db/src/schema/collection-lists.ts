import { createInsertSchema } from "drizzle-zod";
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { collectionItemsTable } from "./collection";
import { usersTable } from "./users";

/** User-owned, manually ordered collection folders. */
export const collectionListsTable = pgTable("collection_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("collection_lists_user_name_uniq").on(table.userId, table.name),
  index("collection_lists_user_position_idx").on(table.userId, table.position),
]);

/** A holding may appear in many lists, but at most once in each list. */
export const collectionListItemsTable = pgTable("collection_list_items", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  listId: uuid("list_id").notNull().references(() => collectionListsTable.id, { onDelete: "cascade" }),
  collectionItemId: uuid("collection_item_id").notNull().references(() => collectionItemsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("collection_list_items_list_holding_uniq").on(table.listId, table.collectionItemId),
  index("collection_list_items_user_list_idx").on(table.userId, table.listId),
  index("collection_list_items_holding_idx").on(table.collectionItemId),
]);

/** A single durable set of collection presentation controls per collector. */
export const collectionPreferencesTable = pgTable("collection_preferences", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  viewMode: text("view_mode").notNull().default("grid"),
  selectedListId: uuid("selected_list_id").references(() => collectionListsTable.id, { onDelete: "set null" }),
  filterState: jsonb("filter_state").notNull().default({}),
  sortKey: text("sort_key").notNull().default("date_desc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCollectionListSchema = createInsertSchema(collectionListsTable)
  .omit({ id: true, userId: true, createdAt: true, updatedAt: true });
export type InsertCollectionList = z.infer<typeof insertCollectionListSchema>;
export type CollectionList = typeof collectionListsTable.$inferSelect;
export type CollectionListItem = typeof collectionListItemsTable.$inferSelect;
export type CollectionPreferences = typeof collectionPreferencesTable.$inferSelect;