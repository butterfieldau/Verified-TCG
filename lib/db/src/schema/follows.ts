import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Follower/following relationships between collectors.
 * Unique constraint on (follower_user_id, followee_user_id) prevents duplicates.
 */
export const followsTable = pgTable(
  "follows",
  {
    followerId: uuid("follower_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("follows_unique_pair").on(t.followerId, t.followeeId),
    index("follows_follower_idx").on(t.followerId),
    index("follows_followee_idx").on(t.followeeId),
  ],
);

export type Follow = typeof followsTable.$inferSelect;
export type InsertFollow = typeof followsTable.$inferInsert;
