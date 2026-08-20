import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { adminAccountsTable } from "./admin";
import { usersTable } from "./users";

/**
 * User report submissions. Each row records one report made by a reporter
 * against a reported user.
 *
 * Operational workflow columns (status/assignment/resolution/SLA) are managed
 * by the admin operations panel. They are additive and nullable so existing
 * consumer inserts (reporter/reported/reason/note only) keep working unchanged.
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
    /** One of: spam | harassment | fraud | inappropriate | other */
    reason: text("reason").notNull(),
    /** Optional free-text note from the reporter */
    note: text("note"),

    // ── Admin operational workflow (all additive/nullable) ────────────────────
    /** Workflow status: open | in_review | resolved | dismissed | escalated */
    status: text("status").notNull().default("open"),
    /** Moderation priority level */
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    /** Severity classification */
    severity: varchar("severity", { length: 16 }).notNull().default("medium"),
    /** Admin account currently responsible for this report (never a token). */
    assignedAdminId: uuid("assigned_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    /** Supporting evidence references (URLs, screenshot IDs, etc.) */
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
    /** Free-text resolution summary recorded when the report is closed. */
    resolution: text("resolution"),
    /** Short machine-ish reason code for the resolution/dismissal. */
    resolutionReason: text("resolution_reason"),
    /** Legacy free-text resolution note (older field, kept for compatibility). */
    resolutionNote: text("resolution_note"),
    /** When the report was escalated, plus why. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalationReason: text("escalation_reason"),
    /** SLA timestamps: first admin touch and final resolution. */
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Admin who resolved the report */
    resolvedByAdminId: uuid("resolved_by_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),

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
