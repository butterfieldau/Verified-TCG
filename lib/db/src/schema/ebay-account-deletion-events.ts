import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Minimal, append-only evidence that an authenticated eBay account-deletion
 * notification was handled. eBay account identifiers are deliberately not
 * persisted because Verified TCG does not currently maintain an eBay account
 * linkage.
 */
export const ebayAccountDeletionEventsTable = pgTable("ebay_account_deletion_events", {
  notificationId: text("notification_id").primaryKey(),
  outcome: varchar("outcome", { length: 64 }).notNull().default("no_linked_ebay_data"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EbayAccountDeletionEvent = typeof ebayAccountDeletionEventsTable.$inferSelect;