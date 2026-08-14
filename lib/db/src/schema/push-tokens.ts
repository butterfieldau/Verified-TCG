import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Expo push notification tokens — one row per device per user.
 * Tokens are registered when the user grants notification permission in-app.
 * A user can have multiple tokens (one per device/reinstall).
 */
export const pushTokensTable = pgTable("push_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  /** Expo push token — format: ExponentPushToken[xxxxxx] */
  token: text("token").notNull().unique(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushTokenRow = typeof pushTokensTable.$inferSelect;
export type InsertPushToken = typeof pushTokensTable.$inferInsert;
