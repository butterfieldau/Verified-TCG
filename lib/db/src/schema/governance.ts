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
import { usersTable } from "./users";
import { adminAccountsTable } from "./admin";
import { contactSubmissionsTable } from "./contact-submissions";

// ─── Admin Audit Log ──────────────────────────────────────────────────────────

/**
 * Durable audit trail for all governance and sensitive admin actions.
 * Never delete rows from this table; keep as an immutable append-only log.
 */
export const adminAuditLogTable = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    adminEmail: text("admin_email"),
    action: text("action").notNull(),
    resourceType: varchar("resource_type", { length: 64 }),
    resourceId: text("resource_id"),
    /** JSON snapshot of changed fields or operation outcome */
    details: jsonb("details"),
    outcome: varchar("outcome", { length: 32 }).notNull().default("success"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_log_admin_id_idx").on(t.adminId),
    index("admin_audit_log_action_idx").on(t.action),
    index("admin_audit_log_created_at_idx").on(t.createdAt),
  ],
);

export type AdminAuditLogRow = typeof adminAuditLogTable.$inferSelect;

// ─── Notification Templates ───────────────────────────────────────────────────

/**
 * Reusable push notification templates.
 * Templates have a title/body with optional {{variable}} placeholders
 * that are filled at send time.
 */
export const notificationTemplatesTable = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    titleTemplate: text("title_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    /** JSON object of default variable values */
    defaultVariables: jsonb("default_variables").notNull().default({}),
    /** active | archived */
    status: varchar("status", { length: 24 }).notNull().default("active"),
    createdByAdminId: uuid("created_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type NotificationTemplateRow = typeof notificationTemplatesTable.$inferSelect;

// ─── Notification Campaigns ───────────────────────────────────────────────────

/**
 * Broadcast notification campaigns targeting a subset of users.
 * NOTE: There is no connected outbound push provider. Campaigns are
 * durable records only; delivery status will always be `not_connected`.
 */
export const notificationCampaignsTable = pgTable(
  "notification_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    templateId: uuid("template_id").references(() => notificationTemplatesTable.id, {
      onDelete: "set null",
    }),
    /** Inline override — used when not using a template */
    titleOverride: text("title_override"),
    bodyOverride: text("body_override"),
    /** JSON object of variable values for the template */
    variables: jsonb("variables").notNull().default({}),
    /**
     * Audience filter — JSON describing targeting criteria:
     * { tier?: "free"|"pro", hasConsent?: boolean, ... }
     */
    audienceFilter: jsonb("audience_filter").notNull().default({}),
    /**
     * draft | confirmed | scheduled | sending | completed | cancelled
     * Campaigns are delivery-blocked until a provider is configured.
     */
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    /** Provider connection status recorded at confirmation time */
    providerStatus: varchar("provider_status", { length: 32 }).notNull().default("not_connected"),
    /** Delivery outcome — always not_connected when no provider */
    deliveryOutcome: varchar("delivery_outcome", { length: 32 }).notNull().default("not_connected"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByAdminId: uuid("confirmed_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    /** Estimated audience size at the time of confirmation */
    audienceCount: integer("audience_count"),
    createdByAdminId: uuid("created_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_campaigns_status_idx").on(t.status),
    index("notification_campaigns_scheduled_at_idx").on(t.scheduledAt),
  ],
);

export type NotificationCampaignRow = typeof notificationCampaignsTable.$inferSelect;

// ─── Notification Preferences & Delivery Attempts ─────────────────────────────

/**
 * Explicit per-user communication preferences. A registered push token is
 * treated as an opt-in only when this row also has pushEnabled=true.
 */
export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    pushEnabled: boolean("push_enabled").notNull().default(false),
    emailEnabled: boolean("email_enabled").notNull().default(false),
    source: varchar("source", { length: 32 }).notNull().default("unknown"),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_preferences_push_enabled_idx").on(t.pushEnabled),
  ],
);

export type NotificationPreferenceRow =
  typeof notificationPreferencesTable.$inferSelect;

/**
 * Durable record of every requested campaign/test delivery. These rows record
 * provider-unavailable and failure outcomes as well as real delivery outcomes
 * when a provider is eventually connected.
 */
export const notificationDeliveryAttemptsTable = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => notificationCampaignsTable.id, { onDelete: "cascade" }),
    attemptedByAdminId: uuid("attempted_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    targetUserId: uuid("target_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    attemptType: varchar("attempt_type", { length: 24 }).notNull(),
    channel: varchar("channel", { length: 24 }).notNull().default("push"),
    provider: varchar("provider", { length: 48 }).notNull().default("none"),
    status: varchar("status", { length: 32 }).notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_delivery_attempts_campaign_idx").on(t.campaignId),
    index("notification_delivery_attempts_status_idx").on(t.status),
    index("notification_delivery_attempts_created_idx").on(t.createdAt),
  ],
);

export type NotificationDeliveryAttemptRow =
  typeof notificationDeliveryAttemptsTable.$inferSelect;

// ─── Support Case Workflow ────────────────────────────────────────────────────

/**
 * Support case companion records — linked to existing contact_submissions.
 * Tracks status, priority, assignee, and outcome for each submission.
 */
export const supportCasesTable = pgTable(
  "support_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** References the original contact submission */
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => contactSubmissionsTable.id, { onDelete: "cascade" }),
    /** open | in_progress | waiting | resolved | closed */
    status: varchar("status", { length: 32 }).notNull().default("open"),
    /** low | normal | high | urgent */
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    assignedToAdminId: uuid("assigned_to_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    /** resolved | unresolved | duplicate | spam */
    outcome: varchar("outcome", { length: 32 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_cases_submission_id_idx").on(t.submissionId),
    index("support_cases_status_idx").on(t.status),
    index("support_cases_assigned_to_idx").on(t.assignedToAdminId),
  ],
);

export type SupportCaseRow = typeof supportCasesTable.$inferSelect;

/**
 * Internal notes on a support case.
 * Off-platform replies and internal discussion only — never delivery records.
 */
export const supportCaseNotesTable = pgTable(
  "support_case_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => supportCasesTable.id, { onDelete: "cascade" }),
    authorAdminId: uuid("author_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    /** internal | off_platform_reply — never implies delivery */
    noteType: varchar("note_type", { length: 32 }).notNull().default("internal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("support_case_notes_case_id_idx").on(t.caseId),
  ],
);

export type SupportCaseNoteRow = typeof supportCaseNotesTable.$inferSelect;

// ─── Privacy / Account Requests ───────────────────────────────────────────────

/**
 * Durable admin intake for GDPR/privacy and account management requests.
 * export_data | delete_account | right_to_forget | data_correction
 */
export const privacyRequestsTable = pgTable(
  "privacy_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullable — request may come from a non-registered user */
    userId: uuid("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    requesterEmail: text("requester_email").notNull(),
    requestType: varchar("request_type", { length: 32 }).notNull(),
    description: text("description").notNull().default(""),
    /**
     * pending | under_review | verified | approved | rejected | completed | failed
     */
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    /** Whether the requester identity has been verified by an admin */
    identityVerified: boolean("identity_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedByAdminId: uuid("verified_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    assignedToAdminId: uuid("assigned_to_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    /** Approval timestamp — set only by the dedicated approve endpoint */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByAdminId: uuid("approved_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    /** Completion timestamp */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** For export requests — the actual JSON export data is stored here */
    exportPayload: jsonb("export_payload"),
    /** persisted outcome for export: success | failed | not_applicable */
    exportOutcome: varchar("export_outcome", { length: 32 }),
    /** General error details if processing failed */
    errorDetails: text("error_details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("privacy_requests_user_id_idx").on(t.userId),
    index("privacy_requests_status_idx").on(t.status),
    index("privacy_requests_request_type_idx").on(t.requestType),
  ],
);

export type PrivacyRequestRow = typeof privacyRequestsTable.$inferSelect;

/**
 * Internal notes on a privacy request.
 */
export const privacyRequestNotesTable = pgTable(
  "privacy_request_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequestsTable.id, { onDelete: "cascade" }),
    authorAdminId: uuid("author_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("privacy_request_notes_request_id_idx").on(t.requestId),
  ],
);

export type PrivacyRequestNoteRow = typeof privacyRequestNotesTable.$inferSelect;

// ─── Retention Policies ───────────────────────────────────────────────────────

/**
 * Data retention policies.
 * Automated execution is currently unavailable — runs are dry-run only
 * and record outcomes without performing broad data purges.
 */
export const retentionPoliciesTable = pgTable(
  "retention_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** The data type this policy covers, e.g. activity_log, audit_log */
    dataType: varchar("data_type", { length: 64 }).notNull(),
    /** Retention period in days */
    retentionDays: integer("retention_days").notNull(),
    /** active | inactive */
    status: varchar("status", { length: 24 }).notNull().default("active"),
    createdByAdminId: uuid("created_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    updatedByAdminId: uuid("updated_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type RetentionPolicyRow = typeof retentionPoliciesTable.$inferSelect;

/**
 * Records each retention policy run (dry or actual).
 * Actual broad purges are not performed — execution is always blocked.
 */
export const retentionRunsTable = pgTable(
  "retention_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => retentionPoliciesTable.id, { onDelete: "restrict" }),
    isDryRun: boolean("is_dry_run").notNull().default(true),
    /**
     * pending | dry_run_complete | blocked | failed
     * Real runs always produce `blocked` because no automated execution is configured.
     */
    outcome: varchar("outcome", { length: 32 }).notNull().default("pending"),
    /** Number of rows that would be / were affected */
    affectedCount: integer("affected_count"),
    notes: text("notes"),
    triggeredByAdminId: uuid("triggered_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("retention_runs_policy_id_idx").on(t.policyId),
  ],
);

export type RetentionRunRow = typeof retentionRunsTable.$inferSelect;

// ─── Internal Notes ───────────────────────────────────────────────────────────

/**
 * Internal admin notes — private to the admin team, not visible to collectors.
 */
export const internalNotesTable = pgTable(
  "internal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    /** Restricted authorship — must be an admin account */
    authorAdminId: uuid("author_admin_id")
      .notNull()
      .references(() => adminAccountsTable.id, { onDelete: "restrict" }),
    /** staff_only | owner_only */
    visibility: varchar("visibility", { length: 24 }).notNull().default("staff_only"),
    /** active | archived */
    status: varchar("status", { length: 24 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type InternalNoteRow = typeof internalNotesTable.$inferSelect;

/**
 * Edit history for internal notes.
 */
export const internalNoteHistoryTable = pgTable(
  "internal_note_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => internalNotesTable.id, { onDelete: "cascade" }),
    editedByAdminId: uuid("edited_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    previousContent: text("previous_content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("internal_note_history_note_id_idx").on(t.noteId),
  ],
);

export type InternalNoteHistoryRow = typeof internalNoteHistoryTable.$inferSelect;

// ─── Announcements ────────────────────────────────────────────────────────────

/**
 * Internal announcements — can be published to a dashboard notice area.
 * States: draft | scheduled | published | archived
 * NOTE: State transitions do NOT imply any message was delivered to collectors.
 */
export const announcementsTable = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    /** all_collectors | pro_collectors | free_collectors | internal */
    audience: varchar("audience", { length: 32 }).notNull().default("all_collectors"),
    authorAdminId: uuid("author_admin_id").references(() => adminAccountsTable.id, {
      onDelete: "set null",
    }),
    /** draft | scheduled | published | archived */
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    /** When to transition to published (nullable for manual publish) */
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("announcements_status_idx").on(t.status),
  ],
);

export type AnnouncementRow = typeof announcementsTable.$inferSelect;
