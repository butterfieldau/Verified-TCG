import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Platform operators are deliberately separate from collector accounts. This
 * keeps collector JWT auth and staff access independently revocable.
 */
export const adminAccountsTable = pgTable("admin_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 24 }).notNull().default("support"),
  /** Explicit role-bounded permission set chosen by an Owner. */
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  status: varchar("status", { length: 24 }).notNull().default("invited"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  invitationTokenHash: text("invitation_token_hash"),
  invitationExpiresAt: timestamp("invitation_expires_at", { withTimezone: true }),
  invitationDeliveryStatus: varchar("invitation_delivery_status", { length: 24 })
    .notNull()
    .default("not_requested"),
  createdByAdminId: uuid("created_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminSessionsTable = pgTable("admin_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => adminAccountsTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  csrfTokenHash: text("csrf_token_hash").notNull(),
  ipHash: text("ip_hash").notNull(),
  userAgentHash: text("user_agent_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  recentAuthAt: timestamp("recent_auth_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type AdminAccount = typeof adminAccountsTable.$inferSelect;
export type AdminSession = typeof adminSessionsTable.$inferSelect;