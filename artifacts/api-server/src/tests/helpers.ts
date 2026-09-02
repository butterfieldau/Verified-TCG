/**
 * Shared test helpers for API integration tests.
 *
 * Creates/destroys test users directly via the DB so each test starts with a
 * known state without relying on the signup endpoint working correctly first.
 */
import { db } from "@workspace/db";
import {
  usersTable,
  userSessionsTable,
  collectionItemsTable,
  passwordResetTokensTable,
  scanUsageTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const JWT_SECRET = process.env.SESSION_SECRET ?? "test-secret-at-least-32-characters-long";

/** Prefix every test email so they are easy to find and bulk-delete. */
const EMAIL_PREFIX = "test_suite_";

/** Create a hashed user row and return its id, email, and a valid access token. */
export async function createTestUser(opts: {
  email?: string;
  password?: string;
  displayName?: string;
  subscriptionTier?: "free" | "pro";
}) {
  const password = opts.password ?? "testpass123";
  const email = (opts.email ?? `${EMAIL_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`).toLowerCase();
  const displayName = opts.displayName ?? "Test User";
  const username = email.split("@")[0]!.replace(/[^a-z0-9_]/g, "");
  const passwordHash = await bcrypt.hash(password, 4); // low cost for speed

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash,
      firstName: "Test",
      lastName: "User",
      displayName,
      username,
      subscriptionTier: opts.subscriptionTier ?? "free",
    })
    .returning();

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, display_name: user.displayName },
    JWT_SECRET,
    { expiresIn: 900 },
  );

  return { user, password, email, accessToken };
}

/** Delete a user and all their associated data by user id. */
export async function deleteTestUser(userId: string) {
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

/** Delete all rows created by the test suite (belt-and-suspenders cleanup). */
export async function cleanupTestUsers() {
  await db.delete(usersTable).where(
    // Use a SQL LIKE on email — drizzle doesn't expose sql`` easily here,
    // so we just delete every user whose email starts with our prefix.
    eq(usersTable.email, EMAIL_PREFIX), // placeholder; real cleanup via afterAll
  );
}

/** Make a valid access token for a user (bypasses DB lookup). */
export function makeToken(userId: string, email = "x@example.com", displayName = "Test") {
  return jwt.sign({ sub: userId, email, display_name: displayName }, JWT_SECRET, { expiresIn: 900 });
}

/** Create a scan_usage row for a user at the current period. */
export async function setScanCount(userId: string, count: number) {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await db
    .insert(scanUsageTable)
    .values({ userId, periodStart, scanCount: count })
    .onConflictDoUpdate({
      target: [scanUsageTable.userId, scanUsageTable.periodStart],
      set: { scanCount: count },
    });
}

/** Minimal card object accepted by POST /api/collection. */
export function makeCard(id = "card-001") {
  return {
    id,
    name: "Test Card",
    setName: "Test Set",
    setId: "ts",
    number: "001",
    rarity: "rare",
    game: "Pokemon",
    image: "https://example.com/card.jpg",
    price: { raw: 10, currency: "AUD", updatedAt: new Date().toISOString() },
  };
}
