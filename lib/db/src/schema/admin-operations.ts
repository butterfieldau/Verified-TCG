import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { adminAccountsTable } from "./admin";
import { usersTable } from "./users";

/**
 * Immutable records of sensitive TCG-data actions taken through the command
 * centre. Audit records deliberately retain an actor snapshot if an admin
 * account is later removed.
 */
export const adminAuditLogsTable = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    reason: text("reason").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    index("admin_audit_actor_idx").on(table.adminId, table.createdAt),
  ],
);

/**
 * Sanitized recognition outcomes. Uploaded image bytes and raw OCR text are
 * never persisted; this table keeps only operational facts needed to measure
 * quality and review failed/low-confidence attempts.
 */
export const scanAttemptsTable = pgTable(
  "scan_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    extractedName: text("extracted_name"),
    extractedSet: text("extracted_set"),
    extractedNumber: text("extracted_number"),
    topMatchCardId: text("top_match_card_id"),
    topMatchName: text("top_match_name"),
    topMatchConfidence: integer("top_match_confidence"),
    candidateSummary: jsonb("candidate_summary"),
    model: text("model"),
    durationMs: integer("duration_ms").notNull(),
    errorCode: text("error_code"),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewOutcome: text("review_outcome"),
    reviewReason: text("review_reason"),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("scan_attempts_status_created_idx").on(table.status, table.createdAt),
    index("scan_attempts_review_created_idx").on(table.reviewStatus, table.createdAt),
    index("scan_attempts_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * Persistent operator-requested refresh work. Provider calls still run through
 * the existing pricing service and its shared rate-limited adapter.
 */
export const pricingRefreshJobsTable = pgTable(
  "pricing_refresh_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: text("card_id").notNull(),
    providerKey: text("provider_key").notNull().default("pricecharting"),
    requestedByAdminId: uuid("requested_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pricing_refresh_jobs_status_created_idx").on(table.status, table.createdAt),
    index("pricing_refresh_jobs_card_created_idx").on(table.cardId, table.createdAt),
  ],
);

/**
 * Time-bounded, auditable manual market overrides. Provider quotes remain
 * stored and visible; an override affects only the provider-neutral Verified
 * Market value while it is active.
 */
export const pricingOverridesTable = pgTable(
  "pricing_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: text("card_id").notNull(),
    gradeKey: text("grade_key").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    originalPriceCents: integer("original_price_cents"),
    originalCurrency: text("original_currency"),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByAdminId: uuid("created_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByAdminId: uuid("revoked_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pricing_overrides_card_grade_idx").on(
      table.cardId,
      table.gradeKey,
      table.createdAt,
    ),
    index("pricing_overrides_expiry_idx").on(table.expiresAt, table.revokedAt),
  ],
);

export type TcgAdminAuditLogRow = typeof adminAuditLogsTable.$inferSelect;
export type ScanAttemptRow = typeof scanAttemptsTable.$inferSelect;
export type PricingRefreshJobRow = typeof pricingRefreshJobsTable.$inferSelect;
export type PricingOverrideRow = typeof pricingOverridesTable.$inferSelect;