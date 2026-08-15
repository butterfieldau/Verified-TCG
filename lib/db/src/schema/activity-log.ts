import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "card_added",
  "card_removed",
  "wishlist_added",
  "wishlist_removed",
  "price_alert_fired",
  "collection_updated",
]);

/**
 * Activity log — records user actions for the Home screen "Recent Activity" feed.
 * Indexed on (user_id, created_at DESC) for fast per-user reads.
 * Cascade-deletes when the user is deleted so no orphan rows remain.
 */
export const activityLogTable = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Enum describing what happened. */
    eventType: activityEventTypeEnum("event_type").notNull(),
    /** Card or item ID involved in the event — for future deep-link use. */
    entityId: text("entity_id"),
    /** Human-readable display name of the card/item (denormalized for fast read). */
    entityName: text("entity_name"),
    /** Optional extra data (e.g. price values, previous values). */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedAtIdx: index("activity_log_user_created_at_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);

export type ActivityLogRow = typeof activityLogTable.$inferSelect;
export type InsertActivityLog = typeof activityLogTable.$inferInsert;
