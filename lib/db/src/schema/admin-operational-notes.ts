import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminAccountsTable } from "./admin";

/**
 * Normalized internal notes for admin operational workflows.
 *
 * Each row is one note left by an admin against a subject entity (a report or a
 * contact/support submission). This provides real author + time history rather
 * than overwriting a single free-text column, so an audit trail of who said
 * what and when is preserved.
 *
 * This is deliberately NOT a general audit log — it only stores operator notes
 * explicitly attached to a specific queue item.
 */
export const adminOperationalNotesTable = pgTable(
  "admin_operational_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which queue the subject belongs to: 'report' | 'support' */
    subjectType: text("subject_type").notNull(),
    /** ID of the user_reports / contact_submissions row this note is about. */
    subjectId: uuid("subject_id").notNull(),
    /** Admin account that authored the note. Kept even if the note is retained. */
    authorAdminId: uuid("author_admin_id")
      .notNull()
      .references(() => adminAccountsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_operational_notes_subject_idx").on(
      t.subjectType,
      t.subjectId,
      t.createdAt,
    ),
  ],
);

export type AdminOperationalNote = typeof adminOperationalNotesTable.$inferSelect;
export type InsertAdminOperationalNote =
  typeof adminOperationalNotesTable.$inferInsert;
