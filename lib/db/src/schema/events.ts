import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * TCG events (conventions, tournaments, local meetups).
 * Created by admins/seed scripts — no user-facing creation UI.
 */
export const eventsTable = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  venue: text("venue").notNull(),
  city: text("city").notNull(),
  eventDate: text("event_date").notNull(),  // ISO date string or human-readable range
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventRow = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;

/**
 * Event participants — one row per (user, event) pair.
 * A user can rejoin after leaving; each rejoin creates a new row
 * (or we mark the previous row visible again by upserting).
 *
 * Privacy: only for_trade collection items and wishlist items are
 * exposed in trade matching — private collection items are never visible.
 */
export const eventParticipantsTable = pgTable(
  "event_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (table) => ({
    eventUserIdx: index("event_participants_event_user_idx").on(
      table.eventId,
      table.userId,
    ),
  }),
);

export type EventParticipantRow = typeof eventParticipantsTable.$inferSelect;
export type InsertEventParticipant = typeof eventParticipantsTable.$inferInsert;
