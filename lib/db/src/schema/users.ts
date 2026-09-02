import { boolean, date, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  displayName: text("display_name").notNull(),
  username: text("username").notNull(),
  bio: text("bio").notNull().default(""),
  location: text("location").notNull().default(""),
  subscriptionTier: varchar("subscription_tier", { length: 20 }).notNull().default("free"),
  isFoundingMember: boolean("is_founding_member").notNull().default(false),
  // Extended profile fields
  avatarUrl: varchar("avatar_url", { length: 2048 }),
  favouriteTcg: varchar("favourite_tcg", { length: 100 }),
  collectorSince: varchar("collector_since", { length: 7 }), // stored as "YYYY-MM"
  profilePublic: boolean("profile_public").notNull().default(true),
  showCollection: boolean("show_collection").notNull().default(true),
  showWishlist: boolean("show_wishlist").notNull().default(true),
  showForTrade: boolean("show_for_trade").notNull().default(true),
  showForSale: boolean("show_for_sale").notNull().default(true),
  /** Comma-separated list of TCG names the user selected during onboarding, e.g. "Pokémon,One Piece TCG". */
  preferredTcgs: text("preferred_tcgs"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
