import { index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * User-blocking relationships. When A blocks B:
 *   - B is hidden from A's search results, community feed, and event matches.
 *   - A is hidden from B's results too (symmetric hide).
 */
export const userBlocksTable = pgTable(
  "user_blocks",
  {
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("user_blocks_unique_pair").on(t.blockerUserId, t.blockedUserId),
    index("user_blocks_blocker_idx").on(t.blockerUserId),
    index("user_blocks_blocked_idx").on(t.blockedUserId),
  ],
);

export type UserBlock = typeof userBlocksTable.$inferSelect;
export type InsertUserBlock = typeof userBlocksTable.$inferInsert;
