import { index, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { adminAccountsTable } from "./admin";
import { usersTable } from "./users";

/**
 * Community posts — text with an optional card reference.
 * Indexed by user+created_at for profile feeds, and created_at for global feed.
 */
export const postsTable = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Post body text (max ~500 chars enforced at the API layer). */
    body: text("body").notNull(),
    /** Optional card ID from the catalog (e.g. "swsh4-25"). */
    cardId: text("card_id"),
    /** Denormalised card name for fast display without a catalog join. */
    cardName: text("card_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    moderationStatus: varchar("moderation_status", { length: 24 })
      .notNull()
      .default("visible"),
    moderationReason: text("moderation_reason"),
    moderatedByAdminId: uuid("moderated_by_admin_id").references(
      () => adminAccountsTable.id,
      { onDelete: "set null" },
    ),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  },
  (t) => [
    index("posts_user_created_idx").on(t.userId, t.createdAt),
    index("posts_created_idx").on(t.createdAt),
    index("posts_moderation_created_idx").on(t.moderationStatus, t.createdAt),
  ],
);

/**
 * Post likes — one like per (post, user) pair.
 */
export const postLikesTable = pgTable(
  "post_likes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("post_likes_unique_pair").on(t.postId, t.userId),
    index("post_likes_post_idx").on(t.postId),
    index("post_likes_user_idx").on(t.userId),
  ],
);

/**
 * Post comments — threaded comments on a post.
 */
export const postCommentsTable = pgTable(
  "post_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("post_comments_post_created_idx").on(t.postId, t.createdAt)],
);

export type Post = typeof postsTable.$inferSelect;
export type InsertPost = typeof postsTable.$inferInsert;
export type PostLike = typeof postLikesTable.$inferSelect;
export type PostComment = typeof postCommentsTable.$inferSelect;
export type InsertPostComment = typeof postCommentsTable.$inferInsert;
