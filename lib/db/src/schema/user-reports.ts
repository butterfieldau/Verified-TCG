import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { adminAccountsTable } from "./admin";
import { usersTable } from "./users";

/**
 * User report submissions. Each row records one report made by a reporter
 * against a reported user. Admin review is handled out-of-band.
 */
export const userReportsTable = pgTable(
  "user_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reportedUserId: uuid("reported_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note"),
    status: varchar("status", { length: 24 }).notNull().default("new"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    severity: varchar("severity", { length: 16 }).notNull().default("medium"),
    assignedAdminId: uuid("assigned_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
    resolutionReason: text("resolution_reason"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByAdminId: uuid("resolved_by_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_reports_status_created_idx").on(table.status, table.createdAt),
    index("user_reports_assignee_status_idx").on(table.assignedAdminId, table.status),
    index("user_reports_reported_created_idx").on(table.reportedUserId, table.createdAt),
  ],
);

export type UserReport = typeof userReportsTable.$inferSelect;
export type InsertUserReport = typeof userReportsTable.$inferInsert;
