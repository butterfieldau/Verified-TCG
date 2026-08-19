import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminAccountsTable, adminSessionsTable } from "./admin";
import { collectionItemsTable } from "./collection";
import { eventsTable } from "./events";
import { userReportsTable } from "./user-reports";
import { usersTable } from "./users";

export const moderationNotesTable = pgTable(
  "moderation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => userReportsTable.id, { onDelete: "cascade" }),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminAccountsTable.id, { onDelete: "restrict" }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("moderation_notes_report_created_idx").on(table.reportId, table.createdAt)],
);

export const vendorsTable = pgTable(
  "vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    profile: text("profile"),
    location: text("location"),
    contactEmail: text("contact_email"),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    verificationStatus: varchar("verification_status", { length: 32 })
      .notNull()
      .default("not_verified"),
    featured: boolean("featured").notNull().default(false),
    createdByAdminId: uuid("created_by_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("vendors_status_created_idx").on(table.status, table.createdAt),
    index("vendors_verification_idx").on(table.verificationStatus),
  ],
);

export const vendorNotesTable = pgTable(
  "vendor_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminAccountsTable.id, { onDelete: "restrict" }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("vendor_notes_vendor_created_idx").on(table.vendorId, table.createdAt)],
);

export const eventVendorsTable = pgTable(
  "event_vendors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    booth: text("booth"),
    status: varchar("status", { length: 24 }).notNull().default("approved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("event_vendors_event_idx").on(table.eventId),
    index("event_vendors_vendor_idx").on(table.vendorId),
  ],
);

export const certificationReviewsTable = pgTable(
  "certification_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    collectionItemId: uuid("collection_item_id").references(() => collectionItemsTable.id, {
      onDelete: "set null",
    }),
    cardId: text("card_id").notNull(),
    cardName: text("card_name").notNull(),
    provider: varchar("provider", { length: 32 }).notNull().default("internal"),
    certificationId: text("certification_id"),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    providerVerificationStatus: varchar("provider_verification_status", { length: 32 })
      .notNull()
      .default("not_requested"),
    evidenceSource: text("evidence_source"),
    providerResponse: jsonb("provider_response").$type<Record<string, unknown> | null>(),
    externalVerifiedAt: timestamp("external_verified_at", { withTimezone: true }),
    reviewedByAdminId: uuid("reviewed_by_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    outcomeReason: text("outcome_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("certification_reviews_status_created_idx").on(table.status, table.createdAt),
    index("certification_reviews_certification_idx").on(table.certificationId),
    index("certification_reviews_owner_idx").on(table.ownerUserId),
  ],
);

export const certificationNotesTable = pgTable(
  "certification_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    certificationReviewId: uuid("certification_review_id")
      .notNull()
      .references(() => certificationReviewsTable.id, { onDelete: "cascade" }),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminAccountsTable.id, { onDelete: "restrict" }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("certification_notes_review_created_idx").on(
      table.certificationReviewId,
      table.createdAt,
    ),
  ],
);

export const verifiedDropsTable = pgTable(
  "verified_drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    deepLink: text("deep_link"),
    eligibility: text("eligibility"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    proOnly: boolean("pro_only").notNull().default(false),
    featured: boolean("featured").notNull().default(false),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    createdByAdminId: uuid("created_by_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    publishedByAdminId: uuid("published_by_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verified_drops_status_schedule_idx").on(table.status, table.startsAt)],
);

export const trustStatusHistoryTable = pgTable(
  "trust_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: varchar("domain", { length: 32 }).notNull(),
    recordId: uuid("record_id").notNull(),
    fromStatus: varchar("from_status", { length: 32 }),
    toStatus: varchar("to_status", { length: 32 }).notNull(),
    reason: text("reason").notNull(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminAccountsTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trust_status_history_record_idx").on(table.domain, table.recordId, table.createdAt),
  ],
);

export const adminAuditEventsTable = pgTable(
  "admin_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").notNull(),
    adminSessionId: uuid("admin_session_id"),
    action: varchar("action", { length: 80 }).notNull(),
    category: varchar("category", { length: 32 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull().default("info"),
    targetType: varchar("target_type", { length: 48 }).notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    previousState: jsonb("previous_state").$type<Record<string, unknown> | null>(),
    newState: jsonb("new_state").$type<Record<string, unknown> | null>(),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_events_created_idx").on(table.createdAt),
    index("admin_audit_events_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("admin_audit_events_category_idx").on(table.category, table.createdAt),
  ],
);

export type Vendor = typeof vendorsTable.$inferSelect;
export type EventVendor = typeof eventVendorsTable.$inferSelect;
export type CertificationReview = typeof certificationReviewsTable.$inferSelect;
export type VerifiedDrop = typeof verifiedDropsTable.$inferSelect;
export type AdminAuditEvent = typeof adminAuditEventsTable.$inferSelect;