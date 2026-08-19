import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { adminAccountsTable } from "./admin";

/**
 * Retained operational telemetry for analytics, security, API performance,
 * integration health, configuration changes, and job events.
 *
 * Sanitized at write time: no raw IPs, emails, query strings, bodies,
 * credentials, or tokens are stored.
 */
export const telemetryEventsTable = pgTable(
  "telemetry_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** analytics | security | api_error | integration | config | job */
    category: text("category").notNull(),
    /** dot-separated action identifier, e.g. account_created, session_started */
    action: text("action").notNull(),
    /** Optional authenticated user ID (never email or PII) */
    userId: uuid("user_id"),
    /** Optional admin actor ID */
    adminId: uuid("admin_id"),
    /** HTTP status code for api_error events */
    statusCode: integer("status_code"),
    /** Duration in milliseconds for api/job events */
    durationMs: integer("duration_ms"),
    /** Correlation ID linking a request chain */
    correlationId: text("correlation_id"),
    /** Sanitized metadata: no secrets, IPs, emails, or tokens */
    metadata: jsonb("metadata"),
    /** ok | failed | degraded */
    status: text("status").notNull().default("ok"),
    /** Retention-aware indexed timestamp */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("telemetry_events_category_action_recorded_idx").on(
      table.category,
      table.action,
      table.recordedAt,
    ),
    index("telemetry_events_recorded_idx").on(table.recordedAt),
    index("telemetry_events_user_recorded_idx").on(table.userId, table.recordedAt),
    index("telemetry_events_correlation_idx").on(table.correlationId),
  ],
);

/**
 * Versioned platform configuration with monotonically increasing version,
 * prior revision history, actor/reason, and optimistic concurrency support.
 */
export const platformConfigTable = pgTable(
  "platform_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    /** Serialized current value (string for primitives, JSON for complex) */
    value: text("value").notNull(),
    /** Human-readable type hint: boolean | string | semver */
    valueType: text("value_type").notNull().default("string"),
    /** Monotonically increasing version counter for optimistic concurrency */
    version: integer("version").notNull().default(1),
    /** JSON array of prior revisions: [{version, value, changedBy, reason, changedAt}] */
    revisions: jsonb("revisions").notNull().default([]),
    /** Admin ID who last changed this config */
    changedByAdminId: uuid("changed_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_config_key_idx").on(table.key),
    index("platform_config_updated_idx").on(table.updatedAt),
  ],
);

// ── Insert schemas (for runtime validation) ───────────────────────────────────
export const insertTelemetryEventSchema = createInsertSchema(telemetryEventsTable);
export const insertPlatformConfigSchema = createInsertSchema(platformConfigTable);

// ── Types ─────────────────────────────────────────────────────────────────────
export type TelemetryEventRow = typeof telemetryEventsTable.$inferSelect;
export type TelemetryEventInsert = typeof telemetryEventsTable.$inferInsert;
export type PlatformConfigRow = typeof platformConfigTable.$inferSelect;
export type PlatformConfigInsert = typeof platformConfigTable.$inferInsert;
