import { integer, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Tracks monthly scan usage per user.
 * One row per user per billing period (period_start = first day of the month).
 * scan_count is incremented on each successful recognition attempt.
 *
 * The (user_id, period_start) pair is unique — enforced both in the Drizzle
 * schema (so db push creates the constraint) and via an additive migration for
 * databases that were provisioned before this constraint was added.
 */
export const scanUsageTable = pgTable("scan_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** First day of the billing month (ISO date, e.g. "2026-08-01"). */
  periodStart: timestamp("period_start", { withTimezone: false }).notNull(),
  scanCount: integer("scan_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("scan_usage_user_period_uniq").on(t.userId, t.periodStart),
]);

export type ScanUsageRow = typeof scanUsageTable.$inferSelect;
export type InsertScanUsage = typeof scanUsageTable.$inferInsert;
