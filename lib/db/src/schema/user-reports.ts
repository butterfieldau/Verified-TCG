import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * User report submissions. Each row records one report made by a reporter
 * against a reported user. Admin review is handled out-of-band.
 */
export const userReportsTable = pgTable("user_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterUserId: uuid("reporter_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  reportedUserId: uuid("reported_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** One of: spam | harassment | fraud | inappropriate | other */
  reason: text("reason").notNull(),
  /** Optional free-text note from the reporter */
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserReport = typeof userReportsTable.$inferSelect;
export type InsertUserReport = typeof userReportsTable.$inferInsert;
