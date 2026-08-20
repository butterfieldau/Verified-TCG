import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminAccountsTable } from "./admin";

/**
 * Durable store for contact form submissions.
 * All fields needed for the support team to reply are stored here so the
 * submission is always actionable regardless of email delivery status.
 *
 * Operational workflow columns (status/assignment/resolution/SLA) are managed
 * by the admin operations panel. They are additive and nullable so the public
 * contact endpoint keeps inserting only the base fields.
 */
export const contactSubmissionsTable = pgTable("contact_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  /** Validated against the allowed-categories enum before insert. */
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Admin operational workflow (all additive/nullable) ────────────────────
  /** Workflow status: open | in_review | resolved | dismissed | escalated */
  status: text("status").notNull().default("open"),
  /** Admin account currently responsible for this submission. */
  assignedAdminId: uuid("assigned_admin_id").references(
    () => adminAccountsTable.id,
    { onDelete: "set null" },
  ),
  resolution: text("resolution"),
  resolutionReason: text("resolution_reason"),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  escalationReason: text("escalation_reason"),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContactSubmission = typeof contactSubmissionsTable.$inferSelect;
export type InsertContactSubmission = typeof contactSubmissionsTable.$inferInsert;
