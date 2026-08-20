/**
 * Additive startup migrations for communications and governance.
 *
 * The API server, rather than the Drizzle CLI, is the migration entry point in
 * deployed environments. Keep these statements idempotent so an existing
 * database can be upgraded safely before the server accepts traffic.
 */

export const GOVERNANCE_COLUMN_MIGRATIONS: string[] = [
  `ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ`,
  `ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS last_failure_reason TEXT`,
  `ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ`,
];

export const GOVERNANCE_TABLE_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID,
    admin_email TEXT,
    action TEXT NOT NULL,
    resource_type VARCHAR(64),
    resource_id TEXT,
    details JSONB,
    outcome VARCHAR(32) NOT NULL DEFAULT 'success',
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT admin_audit_log_admin_id_admin_accounts_id_fk
      FOREIGN KEY (admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    title_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    default_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_by_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_templates_created_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notification_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    template_id UUID,
    title_override TEXT,
    body_override TEXT,
    variables JSONB NOT NULL DEFAULT '{}'::jsonb,
    audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    provider_status VARCHAR(32) NOT NULL DEFAULT 'not_connected',
    delivery_outcome VARCHAR(32) NOT NULL DEFAULT 'not_connected',
    scheduled_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    confirmed_by_admin_id UUID,
    audience_count INTEGER,
    created_by_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_campaigns_template_id_notification_templates_id_fk
      FOREIGN KEY (template_id) REFERENCES notification_templates(id) ON DELETE SET NULL,
    CONSTRAINT notification_campaigns_confirmed_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (confirmed_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL,
    CONSTRAINT notification_campaigns_created_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID PRIMARY KEY,
    push_enabled BOOLEAN NOT NULL DEFAULT false,
    email_enabled BOOLEAN NOT NULL DEFAULT false,
    source VARCHAR(32) NOT NULL DEFAULT 'unknown',
    opted_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_preferences_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL,
    attempted_by_admin_id UUID,
    target_user_id UUID,
    attempt_type VARCHAR(24) NOT NULL,
    channel VARCHAR(24) NOT NULL DEFAULT 'push',
    provider VARCHAR(48) NOT NULL DEFAULT 'none',
    status VARCHAR(32) NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    error_code VARCHAR(64),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notification_delivery_attempts_campaign_id_notification_campaigns_id_fk
      FOREIGN KEY (campaign_id) REFERENCES notification_campaigns(id) ON DELETE CASCADE,
    CONSTRAINT notification_delivery_attempts_attempted_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (attempted_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL,
    CONSTRAINT notification_delivery_attempts_target_user_id_users_id_fk
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS support_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    priority VARCHAR(16) NOT NULL DEFAULT 'normal',
    assigned_to_admin_id UUID,
    outcome VARCHAR(32),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT support_cases_submission_id_contact_submissions_id_fk
      FOREIGN KEY (submission_id) REFERENCES contact_submissions(id) ON DELETE CASCADE,
    CONSTRAINT support_cases_assigned_to_admin_id_admin_accounts_id_fk
      FOREIGN KEY (assigned_to_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS support_case_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL,
    author_admin_id UUID,
    content TEXT NOT NULL,
    note_type VARCHAR(32) NOT NULL DEFAULT 'internal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT support_case_notes_case_id_support_cases_id_fk
      FOREIGN KEY (case_id) REFERENCES support_cases(id) ON DELETE CASCADE,
    CONSTRAINT support_case_notes_author_admin_id_admin_accounts_id_fk
      FOREIGN KEY (author_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS privacy_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    requester_email TEXT NOT NULL,
    request_type VARCHAR(32) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    identity_verified BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMPTZ,
    verified_by_admin_id UUID,
    assigned_to_admin_id UUID,
    approved_at TIMESTAMPTZ,
    approved_by_admin_id UUID,
    completed_at TIMESTAMPTZ,
    export_payload JSONB,
    export_outcome VARCHAR(32),
    error_details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT privacy_requests_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT privacy_requests_verified_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (verified_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL,
    CONSTRAINT privacy_requests_assigned_to_admin_id_admin_accounts_id_fk
      FOREIGN KEY (assigned_to_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL,
    CONSTRAINT privacy_requests_approved_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (approved_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS privacy_request_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL,
    author_admin_id UUID,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT privacy_request_notes_request_id_privacy_requests_id_fk
      FOREIGN KEY (request_id) REFERENCES privacy_requests(id) ON DELETE CASCADE,
    CONSTRAINT privacy_request_notes_author_admin_id_admin_accounts_id_fk
      FOREIGN KEY (author_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    data_type VARCHAR(64) NOT NULL,
    retention_days INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_by_admin_id UUID,
    updated_by_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT retention_policies_created_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL,
    CONSTRAINT retention_policies_updated_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (updated_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS retention_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL,
    is_dry_run BOOLEAN NOT NULL DEFAULT true,
    outcome VARCHAR(32) NOT NULL DEFAULT 'pending',
    affected_count INTEGER,
    notes TEXT,
    triggered_by_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT retention_runs_policy_id_retention_policies_id_fk
      FOREIGN KEY (policy_id) REFERENCES retention_policies(id) ON DELETE RESTRICT,
    CONSTRAINT retention_runs_triggered_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (triggered_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_admin_id UUID NOT NULL,
    visibility VARCHAR(24) NOT NULL DEFAULT 'staff_only',
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT internal_notes_author_admin_id_admin_accounts_id_fk
      FOREIGN KEY (author_admin_id) REFERENCES admin_accounts(id) ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS internal_note_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL,
    edited_by_admin_id UUID,
    previous_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT internal_note_history_note_id_internal_notes_id_fk
      FOREIGN KEY (note_id) REFERENCES internal_notes(id) ON DELETE CASCADE,
    CONSTRAINT internal_note_history_edited_by_admin_id_admin_accounts_id_fk
      FOREIGN KEY (edited_by_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    audience VARCHAR(32) NOT NULL DEFAULT 'all_collectors',
    author_admin_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    scheduled_publish_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT announcements_author_admin_id_admin_accounts_id_fk
      FOREIGN KEY (author_admin_id) REFERENCES admin_accounts(id) ON DELETE SET NULL
  )`,
];

export const GOVERNANCE_CONSTRAINT_MIGRATIONS: string[] = [
  `CREATE INDEX IF NOT EXISTS admin_audit_log_admin_id_idx
     ON admin_audit_log (admin_id)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx
     ON admin_audit_log (action)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
     ON admin_audit_log (created_at)`,
  `CREATE INDEX IF NOT EXISTS notification_campaigns_status_idx
     ON notification_campaigns (status)`,
  `CREATE INDEX IF NOT EXISTS notification_campaigns_scheduled_at_idx
     ON notification_campaigns (scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS notification_preferences_push_enabled_idx
     ON notification_preferences (push_enabled)`,
  `CREATE INDEX IF NOT EXISTS notification_delivery_attempts_campaign_idx
     ON notification_delivery_attempts (campaign_id)`,
  `CREATE INDEX IF NOT EXISTS notification_delivery_attempts_status_idx
     ON notification_delivery_attempts (status)`,
  `CREATE INDEX IF NOT EXISTS notification_delivery_attempts_created_idx
     ON notification_delivery_attempts (created_at)`,
  `CREATE INDEX IF NOT EXISTS support_cases_submission_id_idx
     ON support_cases (submission_id)`,
  `CREATE INDEX IF NOT EXISTS support_cases_status_idx
     ON support_cases (status)`,
  `CREATE INDEX IF NOT EXISTS support_cases_assigned_to_idx
     ON support_cases (assigned_to_admin_id)`,
  `CREATE INDEX IF NOT EXISTS support_case_notes_case_id_idx
     ON support_case_notes (case_id)`,
  `CREATE INDEX IF NOT EXISTS privacy_requests_user_id_idx
     ON privacy_requests (user_id)`,
  `CREATE INDEX IF NOT EXISTS privacy_requests_status_idx
     ON privacy_requests (status)`,
  `CREATE INDEX IF NOT EXISTS privacy_requests_request_type_idx
     ON privacy_requests (request_type)`,
  `CREATE INDEX IF NOT EXISTS privacy_request_notes_request_id_idx
     ON privacy_request_notes (request_id)`,
  `CREATE INDEX IF NOT EXISTS retention_runs_policy_id_idx
     ON retention_runs (policy_id)`,
  `CREATE INDEX IF NOT EXISTS internal_note_history_note_id_idx
     ON internal_note_history (note_id)`,
  `CREATE INDEX IF NOT EXISTS announcements_status_idx
     ON announcements (status)`,
  `INSERT INTO notification_preferences (user_id, push_enabled, source)
     SELECT DISTINCT user_id, true, 'existing_push_token'
     FROM push_tokens
     ON CONFLICT (user_id) DO NOTHING`,
  `INSERT INTO support_cases (submission_id)
     SELECT submission.id
     FROM contact_submissions submission
     WHERE NOT EXISTS (
       SELECT 1
       FROM support_cases support_case
       WHERE support_case.submission_id = submission.id
     )`,
];