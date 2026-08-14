import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Durable store for contact form submissions.
 * All fields needed for the support team to reply are stored here so the
 * submission is always actionable regardless of email delivery status.
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
});

export type ContactSubmission = typeof contactSubmissionsTable.$inferSelect;
export type InsertContactSubmission = typeof contactSubmissionsTable.$inferInsert;
