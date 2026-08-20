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
  userBlocksTable,
} from "@workspace/db";
import { eq, and, isNull, inArray, notInArray, ne, sql } from "drizzle-orm";
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

/**
 * The only event lifecycle states that are visible to / joinable by consumers.
 * Everything else (draft, paused, completed/ended, archived, cancelled) is
 * operator-facing and must never be exposed on public endpoints.
 */
const PUBLIC_EVENT_STATUSES = ["upcoming", "live"] as const;

/**
 * Single shared predicate for "is this event publicly visible?".
 *
 * An event is public iff it is active, has event mode enabled, and its
 * lifecycle status is one of the eligible public states. This is the ONE
 * definition used by GET /events (list), GET /events/:id (direct detail), and
 * the join eligibility check, so the publication boundary can never drift
 * between endpoints.
 */
function publicEventCondition() {
  return and(
    eq(eventsTable.isActive, true),
    eq(eventsTable.eventModeEnabled, true),
    inArray(eventsTable.status, [...PUBLIC_EVENT_STATUSES]),
  );
}

/**
 * Shared predicate for a genuine active participation row: visible, not left,
 * and participationStatus === 'participating'. Staff-removed and self-left rows
 * are excluded from public participant counts.
 */
function activeParticipantCondition() {
  return and(
    isNull(eventParticipantsTable.leftAt),
    eq(eventParticipantsTable.isVisible, true),
    eq(eventParticipantsTable.participationStatus, "participating"),
  );
}

// ── GET /api/events ───────────────────────────────────────────────────────────

router.get("/events", async (_req, res) => {
  const events = await db
    .select()
    .from(eventsTable)
    .where(publicEventCondition())
    .orderBy(eventsTable.eventDate);

  // Attach participant counts — only genuine active participating rows.
  const counts = await db
    .select({
      eventId: eventParticipantsTable.eventId,
      count: sql<number>`count(*)::int`,
    })
    .from(eventParticipantsTable)
    .where(activeParticipantCondition())
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
      status: e.status,
      eventModeEnabled: e.eventModeEnabled,
      participantCount: countMap.get(e.id) ?? 0,
    })),
  );
});

// ── GET /api/events/my-active-participation ──────────────────────────────────
// Returns the event the user is currently participating in (across all events),
// so the mobile app can restore currentEventId after a restart without knowing
// the specific event ID in advance. This static route must precede /events/:id.

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
        activeParticipantCondition(),
        publicEventCondition(),
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

// ── GET /api/events/:id ───────────────────────────────────────────────────────

router.get("/events/:id", async (req, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });

  // Apply the SAME public predicate as the list endpoint. A non-public event
  // (draft/paused/completed/archived/cancelled/inactive/eventMode-disabled)
  // must be indistinguishable from a missing one: return 404, never metadata.
  const event = await db
    .select()
    .from(eventsTable)
    .where(and(eq(eventsTable.id, eventId), publicEventCondition()))
    .limit(1);

  if (!event.length) return res.status(404).json({ message: "Event not found" });

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        activeParticipantCondition(),
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
    status: e.status,
    eventModeEnabled: e.eventModeEnabled,
    participantCount,
  });
});

// ── POST /api/events/:id/join ─────────────────────────────────────────────────

router.post("/events/:id/join", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });
  const userId = req.userId!;

  const result = await withPublicEvent(eventId, async (tx) => {
    const existing = await tx
      .select({ participationStatus: eventParticipantsTable.participationStatus })
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, eventId),
          eq(eventParticipantsTable.userId, userId),
        ),
      )
      .limit(1);

    if (existing.length && existing[0].participationStatus === "removed") {
      return { kind: "removed" as const };
    }

    const upsert = await tx.execute(
      sql`INSERT INTO event_participants (id, event_id, user_id, joined_at, left_at, is_visible, participation_status, removal_reason, removed_by_admin_id)
          VALUES (gen_random_uuid(), ${eventId}, ${userId}, NOW(), NULL, true, 'participating', NULL, NULL)
          ON CONFLICT (event_id, user_id) DO UPDATE SET
            left_at = NULL,
            is_visible = true,
            joined_at = NOW(),
            participation_status = 'participating',
            removal_reason = NULL,
            removed_by_admin_id = NULL
          WHERE event_participants.participation_status <> 'removed'
          RETURNING id`,
    );

    return { kind: upsert.rows.length === 0 ? "removed" as const : "joined" as const };
  });

  if (!result) {
    return res.status(404).json({ message: "Event not found" });
  }
  if (result.kind === "removed") {
    return res.status(403).json({
      joined: false,
      message:
        "You have been removed from this event by a moderator and cannot rejoin. Contact support if you believe this was a mistake.",
    });
  }

  return res.json({ joined: true, eventId });
});

// ── POST /api/events/:id/leave ────────────────────────────────────────────────

router.post("/events/:id/leave", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });
  const userId = req.userId!;

  // A staff-removed participant must NOT be able to overwrite the moderator's
  // 'removed' state by "leaving" (which would flip participation_status to
  // 'left' and thereby re-enable rejoin). The WHERE guard below is the
  // authoritative, TOCTOU-safe protection: even if a removal lands between any
  // read and this write, the update refuses to touch a 'removed' row.
  const updated = await db.execute(
    sql`UPDATE event_participants
        SET left_at = NOW(), is_visible = false, participation_status = 'left'
        WHERE event_id = ${eventId}
          AND user_id = ${userId}
          AND participation_status <> 'removed'
        RETURNING id`,
  );

  if (updated.rows.length === 0) {
    // Either no participation row at all, or the row is staff-removed. If a
    // removed row exists, reject clearly and leave its state untouched.
    const existing = await db
      .select({ participationStatus: eventParticipantsTable.participationStatus })
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, eventId),
          eq(eventParticipantsTable.userId, userId),
        ),
      )
      .limit(1);

    if (existing.length && existing[0].participationStatus === "removed") {
      return res.status(403).json({
        left: false,
        message:
          "You have been removed from this event by a moderator and cannot change your participation. Contact support if you believe this was a mistake.",
      });
    }
  }

  return res.json({ left: true, eventId });
});

// ── GET /api/events/:id/my-participation ─────────────────────────────────────

router.get("/events/:id/my-participation", requireActiveUser, async (req: AuthRequest, res) => {
  const eventId = typeof req.params.id === "string" ? req.params.id : "";
  if (!eventId) return res.status(400).json({ message: "Missing event id" });

  const rows = await db
    .select({
      joinedAt: eventParticipantsTable.joinedAt,
      leftAt: eventParticipantsTable.leftAt,
      isVisible: eventParticipantsTable.isVisible,
    })
    .from(eventParticipantsTable)
    .innerJoin(eventsTable, eq(eventParticipantsTable.eventId, eventsTable.id))
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.userId, req.userId!),
        activeParticipantCondition(),
        publicEventCondition(),
      ),
    )
    .orderBy(sql`joined_at DESC`)
    .limit(1);

  if (!rows.length) return res.json({ isParticipating: false });

  const row = rows[0];
  return res.json({
    isParticipating: true,
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

  return db.transaction(async (tx) => {
    // Hold a shared lock on the public event for the complete authorization and
    // match-data read, so an admin lifecycle close cannot commit after this
    // check but before sensitive participant/profile data is returned.
    const publicEvent = await tx
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(eq(eventsTable.id, eventId), publicEventCondition()))
      .for("share")
      .limit(1);

  if (!publicEvent.length) {
    return res.status(404).json({ message: "Event not found" });
  }

  // 1. Verify the requesting user is a genuine active participant
  //    (visible, not left, participationStatus === 'participating').
  const participation = await tx
    .select()
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        eq(eventParticipantsTable.userId, userId),
        activeParticipantCondition(),
      ),
    )
    .limit(1);

  if (!participation.length) {
    return res.status(403).json({ message: "You must join the event first" });
  }

  // 2. Get current user's Pro status
  const userRows = await tx
    .select({ subscriptionTier: usersTable.subscriptionTier })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const isPro = userRows[0]?.subscriptionTier === "pro";

  // 3. Get current user's for-trade collection items and wishlist
  const myForTrade = await tx
    .select()
    .from(collectionItemsTable)
    .where(
      and(
        eq(collectionItemsTable.userId, userId),
        eq(collectionItemsTable.isForTrade, true),
      ),
    );

  const myWishlist = await tx
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

  // 4. Get other genuine active participants in this event
  //    (visible, not left, participationStatus === 'participating').
  const otherParticipants = await tx
    .select({ userId: eventParticipantsTable.userId })
    .from(eventParticipantsTable)
    .where(
      and(
        eq(eventParticipantsTable.eventId, eventId),
        ne(eventParticipantsTable.userId, userId),
        activeParticipantCondition(),
      ),
    );

  if (!otherParticipants.length) {
    return res.json({ matches: [], matchCount: 0, isProRequired: false });
  }

  const otherUserIdsRaw = otherParticipants.map((p) => p.userId);

  // Filter out blocked users (bidirectional) from potential matches
  const [blockedByMe, blockedMe] = await Promise.all([
    tx.select({ id: userBlocksTable.blockedUserId }).from(userBlocksTable)
      .where(eq(userBlocksTable.blockerUserId, userId)),
    tx.select({ id: userBlocksTable.blockerUserId }).from(userBlocksTable)
      .where(eq(userBlocksTable.blockedUserId, userId)),
  ]);
  const blockedIdsSet = new Set([
    ...blockedByMe.map((r) => r.id),
    ...blockedMe.map((r) => r.id),
  ]);
  const otherUserIds = otherUserIdsRaw.filter((id) => !blockedIdsSet.has(id));

  if (!otherUserIds.length) {
    return res.json({ matches: [], matchCount: 0, isProRequired: false });
  }

  // 5. Batch-load other participants' for-trade items and wishlists
  const otherForTrade = await tx
    .select()
    .from(collectionItemsTable)
    .where(
      and(
        inArray(collectionItemsTable.userId, otherUserIds),
        eq(collectionItemsTable.isForTrade, true),
      ),
    );

  const otherWishlists = await tx
    .select()
    .from(wishlistItemsTable)
    .where(
      and(
        inArray(wishlistItemsTable.userId, otherUserIds),
        isNull(wishlistItemsTable.deletedAt), // exclude soft-deleted items
      ),
    );

  // 6. Get display info for matched participants
  const otherUsers = await tx
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
});

type EventTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function withPublicEvent<T>(
  eventId: string,
  operation: (tx: EventTransaction) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(eq(eventsTable.id, eventId), publicEventCondition()))
      .for("share")
      .limit(1);

    if (!event) return null;
    return operation(tx);
  });
}

export default router;
