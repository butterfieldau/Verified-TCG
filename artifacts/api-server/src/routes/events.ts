/**
 * Events API — join/leave events and get trade matches.
 *
 * All mutation routes require a valid JWT (requireActiveUser).
 * Trade match details (card names, scores) are Pro-only — free users
 * receive only the match count.
 *
 * Privacy guarantee: trade matching ONLY uses:
 *   - collection_items where is_for_trade = true
 *   - wishlist_items from the wishlist_items table
 * Private collection items are never exposed.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  eventsTable,
  eventParticipantsTable,
  collectionItemsTable,
  wishlistItemsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, isNull, inArray, ne, sql } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const router = Router();

/** Extract and validate a UUID path param; returns 400 if missing/invalid. */
function paramId(req: AuthRequest, res: Parameters<Parameters<typeof router.get>[1]>[1], name = "id"): string | null {
  const raw = req.params[name];
  const id = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  if (!id) {
    res.status(400).json({ message: `Missing path parameter: ${name}` });
    return null;
  }
  return id;
}

// ── GET /api/events ───────────────────────────────────────────────────────────

router.get("/events", async (_req, res) => {
  const events = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.isActive, true))
    .orderBy(eventsTable.eventDate);

  // Attach participant counts
  const counts = await db
    .select({
      eventId: eventParticipantsTable.eventId,
      count: sql<number>`count(*)::int`,
    })
    .from(eventParticipantsTable)
    .where(
      and(
        isNull(eventParticipantsTable.leftAt),
        eq(eventParticipantsTable.isVisible, true),
      ),
    )
    .groupBy(eventParticipantsTable.eventId);

  const countMap = new Map(counts.map((c) => [c.eventId, c.count]));

  return res.json(
    events.map((e) => ({
      id: e.id,
      name: e.name,
      venue: e.venue,
      city: e.city,
      eventDate: e.eventDate,
      isActive: e.isActive,
      participantCount: countMap.get(e.id) ?? 0,
    })),
  );
});

// ── GET /api/events/:id ───────────────────────────────────────────────────────

router.get("/events/:id", async (req, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });

  const event = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, eventId))
    .limit(1);

  if (!event.length) return res.status(404).json({ message: "Event not found" });

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        isNull(eventParticipantsTable.leftAt),
        eq(eventParticipantsTable.isVisible, true),
      ),
    );

  const participantCount = countRows[0]?.count ?? 0;
  const e = event[0];

  return res.json({
    id: e.id,
    name: e.name,
    venue: e.venue,
    city: e.city,
    eventDate: e.eventDate,
    isActive: e.isActive,
    participantCount,
  });
});

// ── POST /api/events/:id/join ─────────────────────────────────────────────────

router.post("/events/:id/join", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });
  const userId = req.userId!;

  const event = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, eventId))
    .limit(1);

  if (!event.length) return res.status(404).json({ message: "Event not found" });
  if (!event[0].isActive) return res.status(400).json({ message: "Event is not active" });

  // Find the most recent participation row for this user+event
  const existing = await db
    .select()
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.userId, userId),
      ),
    )
    .orderBy(sql`joined_at DESC`)
    .limit(1);

  // Single-row-per-(event,user) upsert using the unique constraint.
  // ON CONFLICT ensures concurrent join requests can never produce duplicate rows.
  // If the user previously left (leftAt IS NOT NULL), this reactivates them cleanly.
  await db.execute(
    // Using raw SQL because Drizzle's onConflictDoUpdate target must reference
    // columns defined in the schema-level uniqueIndex; our constraint is added via
    // a runtime migration so we use the underlying SQL directly.
    sql`INSERT INTO event_participants (id, event_id, user_id, joined_at, left_at, is_visible)
        VALUES (gen_random_uuid(), ${eventId}, ${userId}, NOW(), NULL, true)
        ON CONFLICT (event_id, user_id) DO UPDATE SET
          left_at   = NULL,
          is_visible = true,
          joined_at  = NOW()`
  );

  return res.json({ joined: true, eventId });
});

// ── POST /api/events/:id/leave ────────────────────────────────────────────────

router.post("/events/:id/leave", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });
  const userId = req.userId!;

  await db
    .update(eventParticipantsTable)
    .set({ leftAt: new Date(), isVisible: false })
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.userId, userId),
        isNull(eventParticipantsTable.leftAt),
      ),
    );

  return res.json({ left: true, eventId });
});

// ── GET /api/events/my-active-participation ──────────────────────────────────
// Returns the event the user is currently participating in (across all events),
// so the mobile app can restore currentEventId after a restart without knowing
// the specific event ID in advance.

router.get("/events/my-active-participation", requireActiveUser, async (req: AuthRequest, res) => {
  const userId = req.userId!;

  const rows = await db
    .select({
      eventId: eventParticipantsTable.eventId,
      joinedAt: eventParticipantsTable.joinedAt,
      eventName: eventsTable.name,
    })
    .from(eventParticipantsTable)
    .innerJoin(eventsTable, eq(eventParticipantsTable.eventId, eventsTable.id))
    .where(
      and(
        eq(eventParticipantsTable.userId, userId),
        isNull(eventParticipantsTable.leftAt),
        eq(eventParticipantsTable.isVisible, true),
        eq(eventsTable.isActive, true),
      ),
    )
    .limit(1);

  if (!rows.length) {
    return res.json({ eventId: null, eventName: null });
  }

  return res.json({
    eventId: rows[0].eventId,
    eventName: rows[0].eventName,
    joinedAt: rows[0].joinedAt,
  });
});

// ── GET /api/events/:id/my-participation ─────────────────────────────────────

router.get("/events/:id/my-participation", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });

  const rows = await db
    .select()
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.userId, req.userId!),
      ),
    )
    .orderBy(sql`joined_at DESC`)
    .limit(1);

  if (!rows.length) return res.json({ isParticipating: false });

  const row = rows[0];
  const isActive = row.leftAt === null && row.isVisible;
  return res.json({
    isParticipating: isActive,
    joinedAt: row.joinedAt,
    leftAt: row.leftAt,
    isVisible: row.isVisible,
  });
});

// ── GET /api/events/:id/trade-matches ─────────────────────────────────────────

router.get("/events/:id/trade-matches", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });
  const userId = req.userId!;

  // 1. Verify the requesting user is an active participant
  const participation = await db
    .select()
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.userId, userId),
        isNull(eventParticipantsTable.leftAt),
        eq(eventParticipantsTable.isVisible, true),
      ),
    )
    .limit(1);

  if (!participation.length) {
    return res.status(403).json({ message: "You must join the event first" });
  }

  // 2. Get current user's Pro status
  const userRows = await db
    .select({ subscriptionTier: usersTable.subscriptionTier })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const isPro = userRows[0]?.subscriptionTier === "pro";

  // 3. Get current user's for-trade collection items and wishlist
  const myForTrade = await db
    .select()
    .from(collectionItemsTable)
    .where(
      and(
        eq(collectionItemsTable.userId, userId),
        eq(collectionItemsTable.isForTrade, true),
      ),
    );

  const myWishlist = await db
    .select()
    .from(wishlistItemsTable)
    .where(
      and(
        eq(wishlistItemsTable.userId, userId),
        isNull(wishlistItemsTable.deletedAt), // exclude soft-deleted items
      ),
    );

  if (myForTrade.length === 0 && myWishlist.length === 0) {
    return res.json({ matches: [], matchCount: 0, isProRequired: false });
  }

  // 4. Get other active participants in this event
  const otherParticipants = await db
    .select({ userId: eventParticipantsTable.userId })
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        ne(eventParticipantsTable.userId, userId),
        isNull(eventParticipantsTable.leftAt),
        eq(eventParticipantsTable.isVisible, true),
      ),
    );

  if (!otherParticipants.length) {
    return res.json({ matches: [], matchCount: 0, isProRequired: false });
  }

  const otherUserIds = otherParticipants.map((p) => p.userId);

  // 5. Batch-load other participants' for-trade items and wishlists
  const otherForTrade = await db
    .select()
    .from(collectionItemsTable)
    .where(
      and(
        inArray(collectionItemsTable.userId, otherUserIds),
        eq(collectionItemsTable.isForTrade, true),
      ),
    );

  const otherWishlists = await db
    .select()
    .from(wishlistItemsTable)
    .where(
      and(
        inArray(wishlistItemsTable.userId, otherUserIds),
        isNull(wishlistItemsTable.deletedAt), // exclude soft-deleted items
      ),
    );

  // 6. Get display info for matched participants
  const otherUsers = await db
    .select({
      id: usersTable.id,
      displayName: usersTable.displayName,
      username: usersTable.username,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, otherUserIds));

  const userMap = new Map(otherUsers.map((u) => [u.id, u]));

  // 7. Compute mutual matches: A wants something B has FOR TRADE, AND B wants something A has FOR TRADE
  const myForTradeCardIds = new Set(myForTrade.map((i) => i.cardId));
  const myWishlistCardIds = new Set(myWishlist.map((i) => i.cardId));

  const matches: {
    participantUserId: string;
    displayName: string;
    username: string;
    theyHave: { cardId: string; name: string; set: string; grade: string }[];
    youHave: { cardId: string; name: string; set: string; grade: string }[];
    matchScore: number;
  }[] = [];

  // Group other participants' data by userId
  const forTradeByUser = new Map<string, typeof otherForTrade>();
  const wishlistByUser = new Map<string, typeof otherWishlists>();
  for (const uid of otherUserIds) {
    forTradeByUser.set(uid, otherForTrade.filter((i) => i.userId === uid));
    wishlistByUser.set(uid, otherWishlists.filter((i) => i.userId === uid));
  }

  for (const uid of otherUserIds) {
    const theirForTrade = forTradeByUser.get(uid) ?? [];
    const theirWishlist = wishlistByUser.get(uid) ?? [];

    // theyHave = their for-trade cards I want
    const theyHave = theirForTrade.filter((item) => myWishlistCardIds.has(item.cardId));

    // youHave = my for-trade cards they want
    const theirWishlistCardIds = new Set(theirWishlist.map((i) => i.cardId));
    const youHave = myForTrade.filter((item) => theirWishlistCardIds.has(item.cardId));

    // A valid match requires BOTH sides to have something for the other
    if (theyHave.length === 0 || youHave.length === 0) continue;

    // Match score: proportion of both wishlists that are satisfied
    const totalWishlistItems = Math.max(myWishlist.length + theirWishlist.length, 1);
    const matchedItems = theyHave.length + youHave.length;
    const matchScore = Math.round((matchedItems / totalWishlistItems) * 100);

    const profile = userMap.get(uid);

    matches.push({
      participantUserId: uid,
      displayName: profile?.displayName ?? "Collector",
      username: profile?.username ?? "collector",
      theyHave: theyHave.map((item) => {
        const card = item.cardData as Record<string, unknown>;
        return {
          cardId: item.cardId,
          name: String(card.name ?? item.cardId),
          set: String(card.setName ?? ""),
          grade: item.condition,
        };
      }),
      youHave: youHave.map((item) => {
        const card = item.cardData as Record<string, unknown>;
        return {
          cardId: item.cardId,
          name: String(card.name ?? item.cardId),
          set: String(card.setName ?? ""),
          grade: item.condition,
        };
      }),
      matchScore,
    });
  }

  // Sort by match score descending
  matches.sort((a, b) => b.matchScore - a.matchScore);

  // Free users get count only; Pro users get full details
  if (!isPro) {
    return res.json({
      matchCount: matches.length,
      matches: [],
      isProRequired: true,
    });
  }

  return res.json({
    matchCount: matches.length,
    matches,
    isProRequired: false,
  });
});

export default router;
