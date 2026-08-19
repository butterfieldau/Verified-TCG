/**
 * Additive startup DDL migrations for retained operational telemetry
 * and versioned platform configuration.
 */

export const TELEMETRY_TABLE_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS telemetry_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id UUID,
    admin_id UUID,
    status_code INTEGER,
    duration_ms INTEGER,
    correlation_id TEXT,
    metadata JSONB,
    status TEXT NOT NULL DEFAULT 'ok',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS platform_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    value_type TEXT NOT NULL DEFAULT 'string',
    version INTEGER NOT NULL DEFAULT 1,
    revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    changed_by_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
    reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export const APPEND_ONLY_LIFECYCLE_FK_MIGRATIONS: string[] = [
  // Audit/telemetry actor identifiers are retained as pseudonymous snapshots.
  // Dropping lifecycle FKs prevents account/session deletion from mutating an
  // append-only event row through ON DELETE SET NULL.
  //
  // Raw PostgreSQL DDL and Drizzle generate different constraint names. Keep
  // both explicit variants for known upgrades, then defensively remove any
  // remaining lifecycle FK by table relationship rather than by name.
  `ALTER TABLE telemetry_events
     DROP CONSTRAINT IF EXISTS telemetry_events_user_id_fkey`,
  `ALTER TABLE telemetry_events
     DROP CONSTRAINT IF EXISTS telemetry_events_admin_id_fkey`,
  `ALTER TABLE admin_audit_logs
     DROP CONSTRAINT IF EXISTS admin_audit_logs_admin_id_fkey`,
  `ALTER TABLE admin_audit_logs
     DROP CONSTRAINT IF EXISTS admin_audit_logs_admin_id_admin_accounts_id_fk`,
  `ALTER TABLE admin_audit_events
     DROP CONSTRAINT IF EXISTS admin_audit_events_admin_id_fkey`,
  `ALTER TABLE admin_audit_events
     DROP CONSTRAINT IF EXISTS admin_audit_events_admin_id_admin_accounts_id_fk`,
  `ALTER TABLE admin_audit_events
     DROP CONSTRAINT IF EXISTS admin_audit_events_admin_session_id_fkey`,
  `ALTER TABLE admin_audit_events
     DROP CONSTRAINT IF EXISTS admin_audit_events_admin_session_id_admin_sessions_id_fk`,
  `DO $$
   DECLARE
     lifecycle_fk RECORD;
   BEGIN
     FOR lifecycle_fk IN
       SELECT
         source_namespace.nspname AS schema_name,
         source_table.relname AS table_name,
         constraint_row.conname AS constraint_name
       FROM pg_constraint constraint_row
       JOIN pg_class source_table
         ON source_table.oid = constraint_row.conrelid
       JOIN pg_namespace source_namespace
         ON source_namespace.oid = source_table.relnamespace
       JOIN pg_class referenced_table
         ON referenced_table.oid = constraint_row.confrelid
       WHERE constraint_row.contype = 'f'
         AND source_namespace.nspname = current_schema()
         AND (
           (
             source_table.relname = 'telemetry_events'
             AND referenced_table.relname IN ('users', 'admin_accounts')
           )
           OR (
             source_table.relname = 'admin_audit_logs'
             AND referenced_table.relname = 'admin_accounts'
           )
           OR (
             source_table.relname = 'admin_audit_events'
             AND referenced_table.relname IN ('admin_accounts', 'admin_sessions')
           )
         )
     LOOP
       EXECUTE format(
         'ALTER TABLE %I.%I DROP CONSTRAINT %I',
         lifecycle_fk.schema_name,
         lifecycle_fk.table_name,
         lifecycle_fk.constraint_name
       );
     END LOOP;
   END
   $$`,
];

export const TELEMETRY_CONSTRAINT_MIGRATIONS: string[] = [
  ...APPEND_ONLY_LIFECYCLE_FK_MIGRATIONS,
  `CREATE INDEX IF NOT EXISTS telemetry_events_category_action_recorded_idx
     ON telemetry_events (category, action, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS telemetry_events_recorded_idx
     ON telemetry_events (recorded_at)`,
  `CREATE INDEX IF NOT EXISTS telemetry_events_user_recorded_idx
     ON telemetry_events (user_id, recorded_at)`,
  `CREATE INDEX IF NOT EXISTS telemetry_events_correlation_idx
     ON telemetry_events (correlation_id)`,
  `CREATE INDEX IF NOT EXISTS platform_config_key_idx
     ON platform_config (key)`,
  `CREATE INDEX IF NOT EXISTS platform_config_updated_idx
     ON platform_config (updated_at)`,
  // Database-enforced append-only storage. Application writers retain INSERT
  // access but accidental UPDATE/DELETE/TRUNCATE operations are rejected.
  `CREATE OR REPLACE FUNCTION vtcg_reject_append_only_mutation()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$
     BEGIN
       RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
         USING ERRCODE = '55000';
     END
     $$`,
  `DROP TRIGGER IF EXISTS telemetry_events_append_only_mutation ON telemetry_events`,
  `CREATE TRIGGER telemetry_events_append_only_mutation
     BEFORE UPDATE OR DELETE ON telemetry_events
     FOR EACH ROW EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `DROP TRIGGER IF EXISTS telemetry_events_append_only_truncate ON telemetry_events`,
  `CREATE TRIGGER telemetry_events_append_only_truncate
     BEFORE TRUNCATE ON telemetry_events
     FOR EACH STATEMENT EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `DROP TRIGGER IF EXISTS admin_audit_logs_append_only_mutation ON admin_audit_logs`,
  `CREATE TRIGGER admin_audit_logs_append_only_mutation
     BEFORE UPDATE OR DELETE ON admin_audit_logs
     FOR EACH ROW EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `DROP TRIGGER IF EXISTS admin_audit_logs_append_only_truncate ON admin_audit_logs`,
  `CREATE TRIGGER admin_audit_logs_append_only_truncate
     BEFORE TRUNCATE ON admin_audit_logs
     FOR EACH STATEMENT EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `DROP TRIGGER IF EXISTS admin_audit_events_append_only_mutation ON admin_audit_events`,
  `CREATE TRIGGER admin_audit_events_append_only_mutation
     BEFORE UPDATE OR DELETE ON admin_audit_events
     FOR EACH ROW EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `DROP TRIGGER IF EXISTS admin_audit_events_append_only_truncate ON admin_audit_events`,
  `CREATE TRIGGER admin_audit_events_append_only_truncate
     BEFORE TRUNCATE ON admin_audit_events
     FOR EACH STATEMENT EXECUTE FUNCTION vtcg_reject_append_only_mutation()`,
  `COMMENT ON TABLE telemetry_events IS
     'Append-only retained telemetry and security events; UPDATE, DELETE, and TRUNCATE are rejected by database triggers.'`,
  `COMMENT ON TABLE admin_audit_logs IS
     'Append-only operational audit records; UPDATE, DELETE, and TRUNCATE are rejected by database triggers.'`,
  `COMMENT ON TABLE admin_audit_events IS
     'Append-only trust/governance audit records; UPDATE, DELETE, and TRUNCATE are rejected by database triggers.'`,
  // Seed default platform config values (idempotent)
  `INSERT INTO platform_config (key, value, value_type, version, revisions)
   VALUES
     ('maintenance_mode',    'false',  'boolean', 1, '[]'::jsonb),
     ('maintenance_message', '',       'string',  1, '[]'::jsonb),
     ('scanner_enabled',     'true',   'boolean', 1, '[]'::jsonb),
     ('pricing_enabled',     'true',   'boolean', 1, '[]'::jsonb),
     ('community_enabled',   'true',   'boolean', 1, '[]'::jsonb),
     ('minimum_app_version', '0.0.0',  'semver',  1, '[]'::jsonb),
     ('latest_app_version',  '0.0.0',  'semver',  1, '[]'::jsonb),
     ('force_update',        'false',  'boolean', 1, '[]'::jsonb),
     ('remote_announcement', '',       'string',  1, '[]'::jsonb)
   ON CONFLICT (key) DO NOTHING`,
];
