-- Governance, communication and compliance tables for Task 288
-- ─── Admin Audit Log ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_id" uuid,
  "admin_email" text,
  "action" text NOT NULL,
  "resource_type" varchar(64),
  "resource_id" text,
  "details" jsonb,
  "outcome" varchar(32) DEFAULT 'success' NOT NULL,
  "ip_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_admin_id_idx" ON "admin_audit_log" ("admin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_action_idx" ON "admin_audit_log" ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" ("created_at");
--> statement-breakpoint
ALTER TABLE "admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Notification Templates ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "title_template" text NOT NULL,
  "body_template" text NOT NULL,
  "default_variables" jsonb DEFAULT '{}' NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "created_by_admin_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_created_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Notification Campaigns ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "template_id" uuid,
  "title_override" text,
  "body_override" text,
  "variables" jsonb DEFAULT '{}' NOT NULL,
  "audience_filter" jsonb DEFAULT '{}' NOT NULL,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "provider_status" varchar(32) DEFAULT 'not_connected' NOT NULL,
  "delivery_outcome" varchar(32) DEFAULT 'not_connected' NOT NULL,
  "scheduled_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "confirmed_by_admin_id" uuid,
  "audience_count" integer,
  "created_by_admin_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_campaigns_status_idx" ON "notification_campaigns" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_campaigns_scheduled_at_idx" ON "notification_campaigns" ("scheduled_at");
--> statement-breakpoint
ALTER TABLE "notification_campaigns"
  ADD CONSTRAINT "notification_campaigns_template_id_notification_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_campaigns"
  ADD CONSTRAINT "notification_campaigns_confirmed_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("confirmed_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_campaigns"
  ADD CONSTRAINT "notification_campaigns_created_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Notification Preferences ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "push_enabled" boolean DEFAULT false NOT NULL,
  "email_enabled" boolean DEFAULT false NOT NULL,
  "source" varchar(32) DEFAULT 'unknown' NOT NULL,
  "opted_out_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_preferences_push_enabled_idx" ON "notification_preferences" ("push_enabled");
--> statement-breakpoint
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "notification_preferences" ("user_id", "push_enabled", "source")
SELECT DISTINCT "user_id", true, 'existing_push_token'
FROM "push_tokens"
ON CONFLICT ("user_id") DO NOTHING;

-- ─── Notification Delivery Attempts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "attempted_by_admin_id" uuid,
  "target_user_id" uuid,
  "attempt_type" varchar(24) NOT NULL,
  "channel" varchar(24) DEFAULT 'push' NOT NULL,
  "provider" varchar(48) DEFAULT 'none' NOT NULL,
  "status" varchar(32) NOT NULL,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "error_code" varchar(64),
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_campaign_idx" ON "notification_delivery_attempts" ("campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_status_idx" ON "notification_delivery_attempts" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_created_idx" ON "notification_delivery_attempts" ("created_at");
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts"
  ADD CONSTRAINT "notification_delivery_attempts_campaign_id_notification_campaigns_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."notification_campaigns"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts"
  ADD CONSTRAINT "notification_delivery_attempts_attempted_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("attempted_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts"
  ADD CONSTRAINT "notification_delivery_attempts_target_user_id_users_id_fk"
  FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

-- ─── Support Cases ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "support_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "status" varchar(32) DEFAULT 'open' NOT NULL,
  "priority" varchar(16) DEFAULT 'normal' NOT NULL,
  "assigned_to_admin_id" uuid,
  "outcome" varchar(32),
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_cases_submission_id_idx" ON "support_cases" ("submission_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_cases_status_idx" ON "support_cases" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_cases_assigned_to_idx" ON "support_cases" ("assigned_to_admin_id");
--> statement-breakpoint
ALTER TABLE "support_cases"
  ADD CONSTRAINT "support_cases_submission_id_contact_submissions_id_fk"
  FOREIGN KEY ("submission_id") REFERENCES "public"."contact_submissions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_cases"
  ADD CONSTRAINT "support_cases_assigned_to_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("assigned_to_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "support_cases" ("submission_id")
SELECT "id" FROM "contact_submissions" submission
WHERE NOT EXISTS (
  SELECT 1 FROM "support_cases" support_case
  WHERE support_case."submission_id" = submission."id"
);

-- ─── Support Case Notes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "support_case_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "author_admin_id" uuid,
  "content" text NOT NULL,
  "note_type" varchar(32) DEFAULT 'internal' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_case_notes_case_id_idx" ON "support_case_notes" ("case_id");
--> statement-breakpoint
ALTER TABLE "support_case_notes"
  ADD CONSTRAINT "support_case_notes_case_id_support_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_case_notes"
  ADD CONSTRAINT "support_case_notes_author_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("author_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Privacy Requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "privacy_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "requester_email" text NOT NULL,
  "request_type" varchar(32) NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "identity_verified" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp with time zone,
  "verified_by_admin_id" uuid,
  "assigned_to_admin_id" uuid,
  "approved_at" timestamp with time zone,
  "approved_by_admin_id" uuid,
  "completed_at" timestamp with time zone,
  "export_payload" jsonb,
  "export_outcome" varchar(32),
  "error_details" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_user_id_idx" ON "privacy_requests" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_status_idx" ON "privacy_requests" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_request_type_idx" ON "privacy_requests" ("request_type");
--> statement-breakpoint
ALTER TABLE "privacy_requests"
  ADD CONSTRAINT "privacy_requests_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_requests"
  ADD CONSTRAINT "privacy_requests_approved_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("approved_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_requests"
  ADD CONSTRAINT "privacy_requests_verified_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("verified_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_requests"
  ADD CONSTRAINT "privacy_requests_assigned_to_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("assigned_to_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Privacy Request Notes ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "privacy_request_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "author_admin_id" uuid,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_request_notes_request_id_idx" ON "privacy_request_notes" ("request_id");
--> statement-breakpoint
ALTER TABLE "privacy_request_notes"
  ADD CONSTRAINT "privacy_request_notes_request_id_privacy_requests_id_fk"
  FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_request_notes"
  ADD CONSTRAINT "privacy_request_notes_author_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("author_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Retention Policies ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "data_type" varchar(64) NOT NULL,
  "retention_days" integer NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "created_by_admin_id" uuid,
  "updated_by_admin_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_created_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_updated_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Retention Runs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "retention_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_id" uuid NOT NULL,
  "is_dry_run" boolean DEFAULT true NOT NULL,
  "outcome" varchar(32) DEFAULT 'pending' NOT NULL,
  "affected_count" integer,
  "notes" text,
  "triggered_by_admin_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_runs_policy_id_idx" ON "retention_runs" ("policy_id");
--> statement-breakpoint
ALTER TABLE "retention_runs"
  ADD CONSTRAINT "retention_runs_policy_id_retention_policies_id_fk"
  FOREIGN KEY ("policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "retention_runs"
  ADD CONSTRAINT "retention_runs_triggered_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("triggered_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Internal Notes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "internal_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "author_admin_id" uuid NOT NULL,
  "visibility" varchar(24) DEFAULT 'staff_only' NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_notes"
  ADD CONSTRAINT "internal_notes_author_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("author_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;

-- ─── Internal Note History ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "internal_note_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "note_id" uuid NOT NULL,
  "edited_by_admin_id" uuid,
  "previous_content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internal_note_history_note_id_idx" ON "internal_note_history" ("note_id");
--> statement-breakpoint
ALTER TABLE "internal_note_history"
  ADD CONSTRAINT "internal_note_history_note_id_internal_notes_id_fk"
  FOREIGN KEY ("note_id") REFERENCES "public"."internal_notes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "internal_note_history"
  ADD CONSTRAINT "internal_note_history_edited_by_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("edited_by_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Announcements ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "audience" varchar(32) DEFAULT 'all_collectors' NOT NULL,
  "author_admin_id" uuid,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "scheduled_publish_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_status_idx" ON "announcements" ("status");
--> statement-breakpoint
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_author_admin_id_admin_accounts_id_fk"
  FOREIGN KEY ("author_admin_id") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- ─── Existing push-token health fields ────────────────────────────────────────
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "failure_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_failure_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_failure_reason" text;
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "last_validated_at" timestamp with time zone;
