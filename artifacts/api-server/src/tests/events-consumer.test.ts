/**
 * Consumer events endpoint integration tests.
 *
 * Focus: a participant who was removed by staff (participation_status =
 * 'removed') must NOT be able to rejoin via POST /api/events/:id/join and
 * thereby wipe the staff-set removal state. Only the authorized admin restore
 * endpoint may reactivate such a participant.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  eventsTable,
  eventParticipantsTable,
  collectionItemsTable,
  wishlistItemsTable,
} from "@workspace/db";
import { and, eq, like, inArray } from "drizzle-orm";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { createTestUser } from "./helpers.js";

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-secret-placeholder-at-least-32-characters";
}

const request = supertest(app);
const TAG = `__events_consumer_${Date.now()}__`;

async function cleanup() {
  await db.delete(eventsTable).where(like(eventsTable.name, `${TAG}%`));
  await db.delete(usersTable).where(like(usersTable.email, `%${TAG}%`));
}

before(async () => {
  await runMigrations();
  await cleanup();
});

after(async () => {
  await cleanup();
  await pool.end();
});

async function createLiveEvent() {
  const [event] = await db
    .insert(eventsTable)
    .values({
      name: `${TAG}live event`,
      venue: "Venue",
      city: "City",
      eventDate: "2026-12-01",
      status: "live",
      isActive: true,
      eventModeEnabled: true,
    })
    .returning();
  assert.ok(event);
  return event;
}

async function createEvent(overrides: {
  label: string;
  status?: string;
  isActive?: boolean;
  eventModeEnabled?: boolean;
  eventDate?: string;
}) {
  const [event] = await db
    .insert(eventsTable)
    .values({
      name: `${TAG}${overrides.label}`,
      venue: "Venue",
      city: "City",
      eventDate: overrides.eventDate ?? "2026-12-01",
      status: overrides.status ?? "upcoming",
      isActive: overrides.isActive ?? true,
      eventModeEnabled: overrides.eventModeEnabled ?? true,
    })
    .returning();
  assert.ok(event);
  return event;
}

describe("POST /api/events/:id/join — staff removal is not self-resettable", () => {
  test("a fresh user can join a live event", async () => {
    const event = await createLiveEvent();
    const { user, accessToken } = await createTestUser({
      email: `${TAG}fresh@example.com`,
    });

    const res = await request
      .post(`/api/events/${event.id}/join`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.joined, true);

    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("a staff-removed participant is rejected on rejoin and removal state is preserved", async () => {
    const event = await createLiveEvent();
    const { user, accessToken } = await createTestUser({
      email: `${TAG}removed@example.com`,
    });

    // Seed a staff-removed participation row directly (simulating admin remove).
    await db.insert(eventParticipantsTable).values({
      eventId: event.id,
      userId: user.id,
      participationStatus: "removed",
      isVisible: false,
      leftAt: new Date(),
      removalReason: "policy violation",
    });

    // Attempt to rejoin — must be rejected with a clear non-success status.
    const res = await request
      .post(`/api/events/${event.id}/join`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.joined, false);
    assert.ok(
      typeof res.body.message === "string" && res.body.message.length > 10,
    );

    // Removal state must be untouched — still removed, not visible, reason kept.
    const [row] = await db
      .select()
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, event.id),
          eq(eventParticipantsTable.userId, user.id),
        ),
      )
      .limit(1);
    assert.ok(row);
    assert.equal(row.participationStatus, "removed");
    assert.equal(row.isVisible, false);
    assert.equal(row.removalReason, "policy violation");
    assert.notEqual(row.leftAt, null);

    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("a self-left participant (not staff-removed) CAN rejoin", async () => {
    const event = await createLiveEvent();
    const { user, accessToken } = await createTestUser({
      email: `${TAG}left@example.com`,
    });

    // User joins then leaves (self-service) — status becomes 'left'.
    const join1 = await request
      .post(`/api/events/${event.id}/join`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(join1.status, 200, JSON.stringify(join1.body));

    const leave = await request
      .post(`/api/events/${event.id}/leave`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(leave.status, 200, JSON.stringify(leave.body));

    // Rejoin should succeed since they left of their own accord.
    const join2 = await request
      .post(`/api/events/${event.id}/join`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(join2.status, 200, JSON.stringify(join2.body));
    assert.equal(join2.body.joined, true);

    const [row] = await db
      .select()
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, event.id),
          eq(eventParticipantsTable.userId, user.id),
        ),
      )
      .limit(1);
    assert.ok(row);
    assert.equal(row.participationStatus, "participating");
    assert.equal(row.isVisible, true);
    assert.equal(row.leftAt, null);

    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("staff-removed participant cannot use leave to reset state, then join still rejected", async () => {
    const event = await createLiveEvent();
    const { user, accessToken } = await createTestUser({
      email: `${TAG}removed-leave@example.com`,
    });

    // Seed a staff-removed participation row directly (simulating admin remove).
    await db.insert(eventParticipantsTable).values({
      eventId: event.id,
      userId: user.id,
      participationStatus: "removed",
      isVisible: false,
      leftAt: new Date(),
      removalReason: "policy violation",
    });

    // Attempt to leave — must be rejected and must NOT flip status to 'left'.
    const leave = await request
      .post(`/api/events/${event.id}/leave`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(leave.status, 403, JSON.stringify(leave.body));
    assert.equal(leave.body.left, false);

    // State unchanged — still 'removed'.
    const [afterLeave] = await db
      .select()
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, event.id),
          eq(eventParticipantsTable.userId, user.id),
        ),
      )
      .limit(1);
    assert.ok(afterLeave);
    assert.equal(afterLeave.participationStatus, "removed");
    assert.equal(afterLeave.isVisible, false);
    assert.equal(afterLeave.removalReason, "policy violation");

    // Join must STILL be rejected — the leave bypass did not open a path back.
    const join = await request
      .post(`/api/events/${event.id}/join`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(join.status, 403, JSON.stringify(join.body));
    assert.equal(join.body.joined, false);

    const [afterJoin] = await db
      .select()
      .from(eventParticipantsTable)
      .where(
        and(
          eq(eventParticipantsTable.eventId, event.id),
          eq(eventParticipantsTable.userId, user.id),
        ),
      )
      .limit(1);
    assert.ok(afterJoin);
    assert.equal(afterJoin.participationStatus, "removed");

    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});

describe("public event publication boundary — list and direct detail", () => {
  // Non-public lifecycle/flag combinations that must be excluded everywhere.
  const NON_PUBLIC: Array<{ label: string; overrides: Parameters<typeof createEvent>[0] }> = [
    { label: "draft", overrides: { label: "np-draft", status: "draft" } },
    { label: "paused", overrides: { label: "np-paused", status: "paused" } },
    { label: "ended", overrides: { label: "np-ended", status: "ended" } },
    { label: "completed", overrides: { label: "np-completed", status: "completed" } },
    { label: "archived", overrides: { label: "np-archived", status: "archived" } },
    { label: "cancelled", overrides: { label: "np-cancelled", status: "cancelled" } },
    { label: "inactive", overrides: { label: "np-inactive", status: "upcoming", isActive: false } },
    {
      label: "eventMode-disabled",
      overrides: { label: "np-nomode", status: "upcoming", eventModeEnabled: false },
    },
  ];

  test("GET /api/events lists upcoming and live, excludes all non-public states", async () => {
    const upcoming = await createEvent({ label: "pub-upcoming", status: "upcoming" });
    const live = await createEvent({ label: "pub-live", status: "live" });
    const nonPublic = [];
    for (const c of NON_PUBLIC) nonPublic.push(await createEvent(c.overrides));

    const res = await request.get("/api/events");
    assert.equal(res.status, 200);
    const ids = new Set((res.body as Array<{ id: string }>).map((e) => e.id));

    assert.ok(ids.has(upcoming.id), "upcoming event must be listed");
    assert.ok(ids.has(live.id), "live event must be listed");
    for (let i = 0; i < NON_PUBLIC.length; i++) {
      assert.ok(
        !ids.has(nonPublic[i].id),
        `${NON_PUBLIC[i].label} event must NOT be listed`,
      );
    }

    for (const e of [upcoming, live, ...nonPublic]) {
      await db.delete(eventsTable).where(eq(eventsTable.id, e.id));
    }
  });

  test("GET /api/events/:id returns upcoming and live public detail", async () => {
    const upcoming = await createEvent({ label: "detail-upcoming", status: "upcoming" });
    const live = await createEvent({ label: "detail-live", status: "live" });

    for (const e of [upcoming, live]) {
      const res = await request.get(`/api/events/${e.id}`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.id, e.id);
      assert.equal(res.body.status, e.status);
    }

    await db.delete(eventsTable).where(eq(eventsTable.id, upcoming.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, live.id));
  });

  test("GET /api/events/:id returns 404 (not metadata) for every non-public state", async () => {
    for (const c of NON_PUBLIC) {
      const event = await createEvent(c.overrides);
      const res = await request.get(`/api/events/${event.id}`);
      assert.equal(res.status, 404, `${c.label}: expected 404, got ${res.status}`);
      // Must not leak any event metadata.
      assert.equal(res.body.id, undefined, `${c.label}: must not expose id`);
      assert.equal(res.body.name, undefined, `${c.label}: must not expose name`);
      assert.equal(res.body.status, undefined, `${c.label}: must not expose status`);
      await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    }
  });

  test("participant count reflects only genuine active participating rows", async () => {
    const event = await createEvent({ label: "count-event", status: "live" });

    // participating + visible + not-left  → counted
    const active = await createTestUser({ email: `${TAG}count-active@example.com` });
    // left (self) → not counted
    const left = await createTestUser({ email: `${TAG}count-left@example.com` });
    // removed by staff → not counted
    const removed = await createTestUser({ email: `${TAG}count-removed@example.com` });
    // hidden (isVisible=false) → not counted
    const hidden = await createTestUser({ email: `${TAG}count-hidden@example.com` });

    await db.insert(eventParticipantsTable).values([
      {
        eventId: event.id,
        userId: active.user.id,
        participationStatus: "participating",
        isVisible: true,
      },
      {
        eventId: event.id,
        userId: left.user.id,
        participationStatus: "left",
        isVisible: false,
        leftAt: new Date(),
      },
      {
        eventId: event.id,
        userId: removed.user.id,
        participationStatus: "removed",
        isVisible: false,
        leftAt: new Date(),
      },
      {
        eventId: event.id,
        userId: hidden.user.id,
        participationStatus: "participating",
        isVisible: false,
      },
    ]);

    const detail = await request.get(`/api/events/${event.id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.participantCount, 1, "only the genuine active row counts");

    const list = await request.get("/api/events");
    const listed = (list.body as Array<{ id: string; participantCount: number }>).find(
      (e) => e.id === event.id,
    );
    assert.ok(listed);
    assert.equal(listed.participantCount, 1, "list count must match detail count");

    await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
    for (const u of [active, left, removed, hidden]) {
      await db.delete(usersTable).where(eq(usersTable.id, u.user.id));
    }
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});

describe("GET /api/events/:id/trade-matches — closes with event lifecycle", () => {
  // Seed a participant row with an explicit status/visibility.
  async function addParticipant(
    eventId: string,
    userId: string,
    opts: { status?: string; isVisible?: boolean; left?: boolean } = {},
  ) {
    await db.insert(eventParticipantsTable).values({
      eventId,
      userId,
      participationStatus: opts.status ?? "participating",
      isVisible: opts.isVisible ?? true,
      leftAt: opts.left ? new Date() : null,
    });
  }

  const CARD = "card-trade-match-001"; // requester wants this
  const CARD_B = "card-trade-match-002"; // requester offers this

  // Give a user a for-trade copy of a card.
  async function giveForTrade(userId: string, cardId = CARD) {
    await db.insert(collectionItemsTable).values({
      userId,
      cardId,
      cardData: { name: `Card ${cardId}` },
      acquiredAt: "2026-01-01",
      isForTrade: true,
    });
  }

  // Add a card to a user's wishlist.
  async function wantCard(userId: string, cardId = CARD) {
    await db.insert(wishlistItemsTable).values({
      userId,
      itemId: `${cardId}-wish-${userId}`,
      cardId,
      cardData: { name: `Card ${cardId}` },
      addedAt: "2026-01-01",
    });
  }

  test("active participant can access matches on a live event", async () => {
    const event = await createEvent({ label: "tm-live", status: "live" });
    const me = await createTestUser({ email: `${TAG}tm-me@example.com` });
    await addParticipant(event.id, me.user.id);
    await wantCard(me.user.id);

    const res = await request
      .get(`/api/events/${event.id}/trade-matches`)
      .set("Authorization", `Bearer ${me.accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.matches));

    await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
    await db.delete(usersTable).where(eq(usersTable.id, me.user.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("active participant can access matches on an upcoming event", async () => {
    const event = await createEvent({ label: "tm-upcoming", status: "upcoming" });
    const me = await createTestUser({ email: `${TAG}tm-me2@example.com` });
    await addParticipant(event.id, me.user.id);
    await wantCard(me.user.id);

    const res = await request
      .get(`/api/events/${event.id}/trade-matches`)
      .set("Authorization", `Bearer ${me.accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
    await db.delete(usersTable).where(eq(usersTable.id, me.user.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("returns 404 for every non-public event state, even to an active participant", async () => {
    const states: Array<Parameters<typeof createEvent>[0]> = [
      { label: "tm-draft", status: "draft" },
      { label: "tm-paused", status: "paused" },
      { label: "tm-completed", status: "completed" },
      { label: "tm-ended", status: "ended" },
      { label: "tm-archived", status: "archived" },
      { label: "tm-cancelled", status: "cancelled" },
      { label: "tm-inactive", status: "upcoming", isActive: false },
      { label: "tm-nomode", status: "upcoming", eventModeEnabled: false },
    ];
    for (const s of states) {
      const event = await createEvent(s);
      const me = await createTestUser({ email: `${TAG}${s.label}@example.com` });
      // Even a genuine active participant with matchable data is denied.
      await addParticipant(event.id, me.user.id);
      await wantCard(me.user.id);

      const res = await request
        .get(`/api/events/${event.id}/trade-matches`)
        .set("Authorization", `Bearer ${me.accessToken}`);
      assert.equal(res.status, 404, `${s.label}: expected 404, got ${res.status}`);
      // No trade/profile data leaked after lifecycle denial.
      assert.equal(res.body.matches, undefined, `${s.label}: must not return matches`);
      assert.equal(res.body.matchCount, undefined, `${s.label}: must not return matchCount`);

      await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
      await db.delete(usersTable).where(eq(usersTable.id, me.user.id));
      await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    }
  });

  test("removed or left requester is denied (403) on a public event", async () => {
    for (const kind of ["removed", "left"] as const) {
      const event = await createEvent({ label: `tm-req-${kind}`, status: "live" });
      const me = await createTestUser({ email: `${TAG}tm-req-${kind}@example.com` });
      await addParticipant(event.id, me.user.id, {
        status: kind,
        isVisible: false,
        left: true,
      });
      await wantCard(me.user.id);

      const res = await request
        .get(`/api/events/${event.id}/trade-matches`)
        .set("Authorization", `Bearer ${me.accessToken}`);
      assert.equal(res.status, 403, `${kind}: expected 403, got ${res.status}`);

      await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
      await db.delete(usersTable).where(eq(usersTable.id, me.user.id));
      await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    }
  });

  test("removed and left candidates are excluded from matches; participating candidate included", async () => {
    const event = await createEvent({ label: "tm-cand", status: "live" });
    // Requester must be Pro to receive the detailed matches array.
    const me = await createTestUser({
      email: `${TAG}tm-cand-me@example.com`,
      subscriptionTier: "pro",
    });
    const good = await createTestUser({ email: `${TAG}tm-cand-good@example.com` });
    const removed = await createTestUser({ email: `${TAG}tm-cand-removed@example.com` });
    const left = await createTestUser({ email: `${TAG}tm-cand-left@example.com` });

    // Mutual match setup: requester wants CARD and offers CARD_B; every
    // candidate has CARD for trade AND wants CARD_B. So all three would be
    // valid matches if lifecycle/participation were ignored.
    await wantCard(me.user.id, CARD);
    await giveForTrade(me.user.id, CARD_B);
    for (const c of [good, removed, left]) {
      await giveForTrade(c.user.id, CARD);
      await wantCard(c.user.id, CARD_B);
    }

    await addParticipant(event.id, me.user.id);
    await addParticipant(event.id, good.user.id);
    await addParticipant(event.id, removed.user.id, {
      status: "removed",
      isVisible: false,
      left: true,
    });
    await addParticipant(event.id, left.user.id, {
      status: "left",
      isVisible: false,
      left: true,
    });

    const res = await request
      .get(`/api/events/${event.id}/trade-matches`)
      .set("Authorization", `Bearer ${me.accessToken}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const matchedUserIds = new Set(
      (res.body.matches as Array<{ participantUserId: string }>).map(
        (m) => m.participantUserId,
      ),
    );
    assert.ok(
      matchedUserIds.has(good.user.id),
      "participating candidate must be a match",
    );
    assert.ok(
      !matchedUserIds.has(removed.user.id),
      "staff-removed candidate must be excluded",
    );
    assert.ok(
      !matchedUserIds.has(left.user.id),
      "self-left candidate must be excluded",
    );
    assert.equal(res.body.matchCount, 1, "only the participating candidate counts");

    await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
    const ids = [me.user.id, good.user.id, removed.user.id, left.user.id];
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});
