import {
  boolean,
  index,
  integer,
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
  description: text("description"),
  address: text("address"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  timezone: text("timezone").notNull().default("Australia/Sydney"),
  status: text("status").notNull().default("upcoming"),
  eventModeEnabled: boolean("event_mode_enabled").notNull().default(true),
  capacity: integer("capacity"),
  featured: boolean("featured").notNull().default(false),
  // Admin who created this event via the operations console. NULL means the row
  // was not created by an operator (e.g. legacy fabricated seed data).
  createdByAdminId: uuid("created_by_admin_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    participationStatus: text("participation_status").notNull().default("participating"),
    removalReason: text("removal_reason"),
    removedByAdminId: uuid("removed_by_admin_id"),
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
