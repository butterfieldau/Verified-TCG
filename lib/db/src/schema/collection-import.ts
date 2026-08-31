import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * User-scoped CSV preview jobs.
 *
 * The normalized rows are persisted so commit can use the exact preview the
 * collector confirmed. The original CSV bytes are deliberately not retained.
 */
export const collectionImportJobsTable = pgTable(
  "collection_import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    contentSha256: text("content_sha256").notNull(),
    status: text("status").notNull().default("previewed"),
    sourceCurrency: text("source_currency"),
    normalizedRows: jsonb("normalized_rows").notNull().default([]),
    previewSummary: jsonb("preview_summary").notNull().default({}),
    commitSummary: jsonb("commit_summary"),
    commitResults: jsonb("commit_results"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (table) => [
    unique("collection_import_jobs_user_hash_uniq").on(
      table.userId,
      table.contentSha256,
    ),
    index("collection_import_jobs_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export type CollectionImportJobRow =
  typeof collectionImportJobsTable.$inferSelect;