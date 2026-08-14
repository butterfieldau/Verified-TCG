import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Per-user notification store.
 * Rows are inserted by server-side triggers (price alerts, trade matches, etc.)
 * and read by the notification centre API.
 *
 * Supported types:
 *   price_alert  — wishlist card reached target price
 *   trade_match  — new event trade match found
 *   follower     — someone followed the user
 *   community    — like / comment on a card or post
 *   system       — Pro update, security alert, welcome message
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),

    /** Discriminator for routing + icon selection in the client */
    type: varchar("type", { length: 30 }).notNull(),

    title: text("title").notNull(),
    body: text("body").notNull(),

    /**
     * Free-form metadata used for deep-link routing on the client.
     * Examples:
     *   price_alert  → { cardId, cardName, currentPrice }
     *   trade_match  → { eventId, matchUserId }
     *   follower     → { followerId, followerUsername }
     */
    metadata: jsonb("metadata").notNull().default({}),

    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_read_created_idx").on(t.userId, t.isRead, t.createdAt),
  ],
);

export type NotificationRow = typeof notificationsTable.$inferSelect;
export type InsertNotification = typeof notificationsTable.$inferInsert;
