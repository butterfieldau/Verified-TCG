/**
 * Trust operations integration tests.
 *
 * Covers:
 *  - Permission enforcement (correct role required)
 *  - Mandatory reason/confirmation for mutations
 *  - Report state machine, assignment, escalation, suspension boundary
 *  - Event lifecycle validation and state transitions
 *  - Event lifecycle recent-auth boundary (upcoming/live require recent auth server-side)
 *  - Status history written for community_post, report, event, event_participant, vendor, certification, drop
 *  - Audit row written for every mutation
 *  - Note endpoints require {note, reason} and write audit transactionally
 *  - Transactional creates write initial status history + audit atomically
 *  - Truthful "unavailable" capabilities on summary + trades endpoints
 *  - Certification cannot falsely claim external verification
 *  - Owner-only + recent-auth required for drop publish
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { eq, like, and, inArray } from "drizzle-orm";
import {
  adminAccountsTable,
  adminSessionsTable,
  adminAuditEventsTable,
  trustStatusHistoryTable,
  db,
  pool,
  userReportsTable,
  usersTable,
  postsTable,
  postLikesTable,
  postCommentsTable,
  eventsTable,
  certificationReviewsTable,
  verifiedDropsTable,
  eventParticipantsTable,
  vendorsTable,
  vendorNotesTable,
  eventVendorsTable,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations, cleanupLegacySeedEvents } from "../lib/migrate.js";
import { hashAdminToken } from "../lib/adminSession.js";
import { permissionsForRole, type AdminRole } from "../lib/adminPermissions.js";

const TAG = `__trust_ops_${Date.now()}__`;
const PASSWORD = "Trust-test-password-287";

async function cleanup() {
  const admins = await db
    .select({ id: adminAccountsTable.id })
    .from(adminAccountsTable)
    .where(like(adminAccountsTable.email, `${TAG}%`));
  const adminIds = admins.map((a) => a.id);

  if (adminIds.length > 0) {
    await db.delete(adminAuditEventsTable).where(inArray(adminAuditEventsTable.adminId, adminIds));
    await db
      .delete(trustStatusHistoryTable)
      .where(inArray(trustStatusHistoryTable.adminId, adminIds));
  }

  // Vendor notes reference admin_id with ON DELETE RESTRICT, so delete tagged
  // vendors (and their cascade-linked notes/event links) before admin accounts.
  const vendors = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(like(vendorsTable.name, `${TAG}%`));
  const vendorIds = vendors.map((v) => v.id);
  if (vendorIds.length > 0) {
    await db.delete(vendorNotesTable).where(inArray(vendorNotesTable.vendorId, vendorIds));
    await db.delete(eventVendorsTable).where(inArray(eventVendorsTable.vendorId, vendorIds));
    await db.delete(vendorsTable).where(inArray(vendorsTable.id, vendorIds));
  }

  await db.delete(adminAccountsTable).where(like(adminAccountsTable.email, `${TAG}%`));
  await db.delete(usersTable).where(like(usersTable.email, `${TAG}%`));
  await db.delete(eventsTable).where(like(eventsTable.name, `${TAG}%`));
  // Belt-and-suspenders: remove any legacy-fingerprint event rows this suite's
  // migration tests may have left behind on a prior crashed run, so the
  // idempotency assertion always starts from a clean slate.
  await db.delete(eventsTable).where(
    inArray(eventsTable.name, [
      "TCXPO Sydney 2026",
      "Melbourne TCG Fest",
      "Brisbane Card Expo",
    ]),
  );
  await db.delete(verifiedDropsTable).where(like(verifiedDropsTable.title, `${TAG}%`));
  await db.delete(certificationReviewsTable).where(like(certificationReviewsTable.cardId, `${TAG}%`));
}

before(async () => {
  await runMigrations();
  await cleanup();
});

after(async () => {
  await cleanup();
  await pool.end();
});

async function createAdmin(
  suffix: string,
  role: AdminRole = "owner",
  permissions = permissionsForRole(role),
) {
  const [account] = await db
    .insert(adminAccountsTable)
    .values({
      email: `${TAG}${suffix}@example.com`,
      displayName: `Admin ${suffix}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      permissions,
      status: "active",
      invitationDeliveryStatus: "not_requested",
    })
    .returning();
  assert.ok(account);
  return account;
}

function cookieValue(response: supertest.Response, name: string): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = cookies.find((value: string) => value.startsWith(`${name}=`));
  assert.ok(cookie, `${name} cookie should be set`);
  return decodeURIComponent(cookie.split(";")[0]!.slice(name.length + 1));
}

async function login(account: { email: string }) {
  const agent = supertest.agent(app);
  const response = await agent
    .post("/api/admin/auth/login")
    .send({ email: account.email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    agent,
    csrf: cookieValue(response, "vtcg_admin_csrf"),
    sessionToken: cookieValue(response, "vtcg_admin_session"),
  };
}

async function createTestUser(suffix: string) {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}${suffix}@user.example.com`,
      passwordHash: await bcrypt.hash("userpass", 4),
      displayName: `Test User ${suffix}`,
      username: `testuser_trust_${suffix.replace(/[^a-z0-9]/g, "")}`,
    })
    .returning();
  assert.ok(user);
  return user;
}

function userAuthorization(userId: string): string {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret, "SESSION_SECRET must be set for consumer route tests");
  return `Bearer ${jwt.sign({ sub: userId }, secret, { expiresIn: "15m" })}`;
}

async function requestAfterModerationLockWins(
  postId: string,
  moderationStatus: "hidden" | "removed",
  requestFactory: () => PromiseLike<supertest.Response>,
): Promise<supertest.Response> {
  let signalModerationLocked!: () => void;
  const moderationLocked = new Promise<void>((resolve) => {
    signalModerationLocked = resolve;
  });
  let releaseModeration!: () => void;
  const moderationRelease = new Promise<void>((resolve) => {
    releaseModeration = resolve;
  });

  const moderationTransaction = db.transaction(async (tx) => {
    const [updated] = await tx
      .update(postsTable)
      .set({
        moderationStatus,
        moderationReason: "concurrency boundary test",
        moderatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(postsTable.id, postId))
      .returning({ id: postsTable.id });
    assert.ok(updated);
    signalModerationLocked();
    await moderationRelease;
  });

  await moderationLocked;
  let requestSettled = false;
  const requestPromise = Promise.resolve(requestFactory()).finally(() => {
    requestSettled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  const settledBeforeModerationCommit = requestSettled;
  releaseModeration();
  await moderationTransaction;
  const response = await requestPromise;

  assert.equal(
    settledBeforeModerationCommit,
    false,
    "consumer operation must wait for the moderation row lock",
  );
  return response;
}

type TestTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function queueTwoRequestsBehindRowLock(
  lockRow: (tx: TestTransaction) => Promise<void>,
  firstFactory: () => PromiseLike<supertest.Response>,
  secondFactory: () => PromiseLike<supertest.Response>,
): Promise<[supertest.Response, supertest.Response]> {
  let signalLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  let releaseLock!: () => void;
  const lockRelease = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const blockerTransaction = db.transaction(async (tx) => {
    await lockRow(tx);
    signalLocked();
    await lockRelease;
  });
  await locked;

  let firstSettled = false;
  const firstRequest = Promise.resolve(firstFactory()).finally(() => {
    firstSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  let secondSettled = false;
  const secondRequest = Promise.resolve(secondFactory()).finally(() => {
    secondSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  const firstSettledWhileBlocked = firstSettled;
  const secondSettledWhileBlocked = secondSettled;
  releaseLock();
  await blockerTransaction;
  const responses = await Promise.all([firstRequest, secondRequest]);

  assert.equal(firstSettledWhileBlocked, false, "first request must wait for the row lock");
  assert.equal(secondSettledWhileBlocked, false, "second request must wait for the row lock");
  return responses;
}

async function requestAfterEventClosureLockWins(
  eventId: string,
  requestFactory: () => PromiseLike<supertest.Response>,
): Promise<supertest.Response> {
  let signalClosureLocked!: () => void;
  const closureLocked = new Promise<void>((resolve) => {
    signalClosureLocked = resolve;
  });
  let releaseClosure!: () => void;
  const closureRelease = new Promise<void>((resolve) => {
    releaseClosure = resolve;
  });

  const closureTransaction = db.transaction(async (tx) => {
    const [updated] = await tx
      .update(eventsTable)
      .set({
        status: "cancelled",
        isActive: false,
        eventModeEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(eventsTable.id, eventId))
      .returning({ id: eventsTable.id });
    assert.ok(updated);
    signalClosureLocked();
    await closureRelease;
  });

  await closureLocked;
  let requestSettled = false;
  const requestPromise = Promise.resolve(requestFactory()).finally(() => {
    requestSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  const settledBeforeClosureCommit = requestSettled;
  releaseClosure();
  await closureTransaction;
  const response = await requestPromise;
  assert.equal(
    settledBeforeClosureCommit,
    false,
    "consumer event operation must wait for the lifecycle row lock",
  );
  return response;
}

async function createTestReport(reporterUserId: string, reportedUserId: string) {
  const [report] = await db
    .insert(userReportsTable)
    .values({
      reporterUserId,
      reportedUserId,
      reason: "test report reason",
      status: "open",
      priority: "normal",
      severity: "medium",
      evidenceRefs: [],
    })
    .returning();
  assert.ok(report);
  return report;
}

// Helper: count audit rows for a target
async function countAudit(targetId: string) {
  const rows = await db
    .select()
    .from(adminAuditEventsTable)
    .where(eq(adminAuditEventsTable.targetId, targetId));
  return rows.length;
}

// Helper: get all status history rows for a record
async function getHistory(domain: string, recordId: string) {
  return db
    .select()
    .from(trustStatusHistoryTable)
    .where(
      and(
        eq(trustStatusHistoryTable.domain, domain),
        eq(trustStatusHistoryTable.recordId, recordId),
      ),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations summary
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/operations/summary", () => {
  test("returns honest unavailable capabilities", async () => {
    const owner = await createAdmin("summary-owner");
    const { agent } = await login(owner);
    const res = await agent.get("/api/admin/operations/summary");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.capabilities);
    assert.equal(res.body.capabilities.tradeOffers.available, false);
    assert.ok(
      typeof res.body.capabilities.tradeOffers.reason === "string" &&
        res.body.capabilities.tradeOffers.reason.length > 10,
      "tradeOffers reason must be explanatory",
    );
    assert.equal(res.body.capabilities.attendanceVerification.available, false);
    assert.equal(res.body.capabilities.providerWriteBack.available, false);
    assert.ok(res.body.counts);
    assert.ok(res.body.recentActivity !== undefined);
  });

  test("requires operations:read permission", async () => {
    const analyst = await createAdmin("summary-analyst", "analyst", [
      "dashboard:read",
      "users:read",
      "analytics:read",
    ]);
    const { agent } = await login(analyst);
    const res = await agent.get("/api/admin/operations/summary");
    assert.equal(res.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Community posts moderation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /admin/community/posts/:id/moderate", () => {
  test("requires community:moderate permission", async () => {
    const user = await createTestUser("post-mod-user1");
    const [post] = await db
      .insert(postsTable)
      .values({ userId: user.id, body: "test post body" })
      .returning();
    assert.ok(post);

    const analyst = await createAdmin("post-mod-analyst", "analyst", [
      "analytics:read",
      "community:read",
      "operations:read",
    ]);
    const { agent, csrf } = await login(analyst);

    const res = await agent
      .post(`/api/admin/community/posts/${post.id}/moderate`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "hidden", reason: "spam" });
    assert.equal(res.status, 403, JSON.stringify(res.body));

    await db.delete(postsTable).where(eq(postsTable.id, post.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });

  test("requires non-empty reason", async () => {
    const user = await createTestUser("post-mod-user2");
    const [post] = await db
      .insert(postsTable)
      .values({ userId: user.id, body: "test post 2" })
      .returning();
    assert.ok(post);

    const owner = await createAdmin("post-mod-owner2");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/community/posts/${post.id}/moderate`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "hidden", reason: "" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(postsTable).where(eq(postsTable.id, post.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });

  test("removed status requires REMOVE confirmation", async () => {
    const user = await createTestUser("post-mod-user3");
    const [post] = await db
      .insert(postsTable)
      .values({ userId: user.id, body: "test post 3" })
      .returning();
    assert.ok(post);

    const owner = await createAdmin("post-mod-owner3");
    const { agent, csrf } = await login(owner);

    const noConfirm = await agent
      .post(`/api/admin/community/posts/${post.id}/moderate`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "removed", reason: "violates rules" });
    assert.equal(noConfirm.status, 400, JSON.stringify(noConfirm.body));
    assert.equal(noConfirm.body.code, "CONFIRMATION_REQUIRED");

    const wrongConfirm = await agent
      .post(`/api/admin/community/posts/${post.id}/moderate`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "removed", reason: "violates rules", confirmation: "DELETE" });
    assert.equal(wrongConfirm.status, 400, JSON.stringify(wrongConfirm.body));

    await db.delete(postsTable).where(eq(postsTable.id, post.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });

  test("moderation writes status history (community_post) and audit transactionally", async () => {
    const user = await createTestUser("post-mod-hist-user");
    const [post] = await db
      .insert(postsTable)
      .values({ userId: user.id, body: "history test post" })
      .returning();
    assert.ok(post);

    const owner = await createAdmin("post-mod-hist-owner");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/community/posts/${post.id}/moderate`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "hidden", reason: "testing history" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Verify status history row was created
    const hist = await getHistory("community_post", post.id);
    assert.equal(hist.length, 1, "should have 1 status history row");
    assert.equal(hist[0]!.toStatus, "hidden");
    assert.equal(hist[0]!.reason, "testing history");

    // Verify audit row was created
    const auditCount = await countAudit(post.id);
    assert.ok(auditCount >= 1, "should have at least 1 audit row");

    await db.delete(postsTable).where(eq(postsTable.id, post.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });

  test("concurrent moderators derive history and audit from the locked current status", async () => {
    const user = await createTestUser("post-mod-concurrent-user");
    const [post] = await db
      .insert(postsTable)
      .values({ userId: user.id, body: "concurrent moderation post" })
      .returning();
    assert.ok(post);

    const hiddenAdmin = await createAdmin("post-mod-concurrent-hidden");
    const removedAdmin = await createAdmin("post-mod-concurrent-removed");
    const hiddenSession = await login(hiddenAdmin);
    const removedSession = await login(removedAdmin);

    let signalBlockerLocked!: () => void;
    const blockerLocked = new Promise<void>((resolve) => {
      signalBlockerLocked = resolve;
    });
    let releaseBlocker!: () => void;
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const blockerTransaction = db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: postsTable.id })
        .from(postsTable)
        .where(eq(postsTable.id, post.id))
        .for("update")
        .limit(1);
      assert.ok(locked);
      signalBlockerLocked();
      await blockerRelease;
    });
    await blockerLocked;

    let hiddenSettled = false;
    const hiddenRequest = Promise.resolve(
      hiddenSession.agent
        .post(`/api/admin/community/posts/${post.id}/moderate`)
        .set("X-CSRF-Token", hiddenSession.csrf)
        .send({ status: "hidden", reason: "first queued moderation" }),
    ).finally(() => {
      hiddenSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    let removedSettled = false;
    const removedRequest = Promise.resolve(
      removedSession.agent
        .post(`/api/admin/community/posts/${post.id}/moderate`)
        .set("X-CSRF-Token", removedSession.csrf)
        .send({
          status: "removed",
          reason: "second queued moderation",
          confirmation: "REMOVE",
        }),
    ).finally(() => {
      removedSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const hiddenSettledWhileBlocked = hiddenSettled;
    const removedSettledWhileBlocked = removedSettled;
    releaseBlocker();
    await blockerTransaction;
    const [hiddenResponse, removedResponse] = await Promise.all([
      hiddenRequest,
      removedRequest,
    ]);

    assert.equal(hiddenSettledWhileBlocked, false);
    assert.equal(removedSettledWhileBlocked, false);
    assert.equal(hiddenResponse.status, 200, JSON.stringify(hiddenResponse.body));
    assert.equal(removedResponse.status, 200, JSON.stringify(removedResponse.body));

    const history = await getHistory("community_post", post.id);
    const hiddenHistory = history.find((row) => row.toStatus === "hidden");
    const removedHistory = history.find((row) => row.toStatus === "removed");
    assert.equal(hiddenHistory?.fromStatus, "visible");
    assert.equal(removedHistory?.fromStatus, "hidden");

    const audits = await db
      .select({
        action: adminAuditEventsTable.action,
        previousState: adminAuditEventsTable.previousState,
        newState: adminAuditEventsTable.newState,
      })
      .from(adminAuditEventsTable)
      .where(eq(adminAuditEventsTable.targetId, post.id));
    const removedAudit = audits.find((row) => row.action === "post.removed");
    assert.deepEqual(removedAudit?.previousState, { moderationStatus: "hidden" });
    assert.deepEqual(removedAudit?.newState, { moderationStatus: "removed" });

    const [finalPost] = await db
      .select({ moderationStatus: postsTable.moderationStatus })
      .from(postsTable)
      .where(eq(postsTable.id, post.id))
      .limit(1);
    assert.equal(finalPost?.moderationStatus, "removed");
  });
});

describe("consumer community moderation boundary", () => {
  for (const moderationStatus of ["hidden", "removed"] as const) {
    test(`${moderationStatus} posts return 404 from every consumer detail and engagement endpoint`, async () => {
      const author = await createTestUser(`consumer-boundary-${moderationStatus}-author`);
      const viewer = await createTestUser(`consumer-boundary-${moderationStatus}-viewer`);
      const [post] = await db
        .insert(postsTable)
        .values({ userId: author.id, body: `${moderationStatus} boundary post` })
        .returning();
      assert.ok(post);

      const [comment] = await db
        .insert(postCommentsTable)
        .values({ postId: post.id, userId: viewer.id, body: "existing comment" })
        .returning();
      assert.ok(comment);
      await db
        .insert(postLikesTable)
        .values({ postId: post.id, userId: viewer.id });

      const owner = await createAdmin(`consumer-boundary-${moderationStatus}-owner`);
      const { agent, csrf } = await login(owner);
      const moderation = await agent
        .post(`/api/admin/community/posts/${post.id}/moderate`)
        .set("X-CSRF-Token", csrf)
        .send({
          status: moderationStatus,
          reason: `consumer boundary ${moderationStatus}`,
          ...(moderationStatus === "removed" ? { confirmation: "REMOVE" } : {}),
        });
      assert.equal(moderation.status, 200, JSON.stringify(moderation.body));

      const authorization = userAuthorization(viewer.id);
      const client = supertest(app);
      const responses = await Promise.all([
        client
          .get(`/api/community/posts/${post.id}`)
          .set("Authorization", authorization),
        client
          .get(`/api/community/posts/${post.id}/comments`)
          .set("Authorization", authorization),
        client
          .post(`/api/community/posts/${post.id}/comments`)
          .set("Authorization", authorization)
          .send({ body: "must not be created" }),
        client
          .post(`/api/community/posts/${post.id}/like`)
          .set("Authorization", authorization),
        client
          .delete(`/api/community/posts/${post.id}/like`)
          .set("Authorization", authorization),
        client
          .delete(`/api/community/posts/${post.id}/comments/${comment.id}`)
          .set("Authorization", authorization),
      ]);

      for (const response of responses) {
        assert.equal(response.status, 404, JSON.stringify(response.body));
        assert.equal(response.body.message, "Post not found");
      }

      const [likes, comments] = await Promise.all([
        db
          .select({ userId: postLikesTable.userId })
          .from(postLikesTable)
          .where(eq(postLikesTable.postId, post.id)),
        db
          .select({ id: postCommentsTable.id })
          .from(postCommentsTable)
          .where(eq(postCommentsTable.postId, post.id)),
      ]);
      assert.equal(likes.length, 1, "hidden content must not be liked or unliked");
      assert.equal(comments.length, 1, "hidden content comments must not be read, added, or deleted");
    });
  }
});

describe("consumer moderation concurrency boundary", () => {
  for (const moderationStatus of ["hidden", "removed"] as const) {
    test(`${moderationStatus} row lock wins before comment and like operations`, async () => {
      const author = await createTestUser(`consumer-race-${moderationStatus}-author`);
      const viewer = await createTestUser(`consumer-race-${moderationStatus}-viewer`);
      const authorization = userAuthorization(viewer.id);
      const client = supertest(app);
      const cases = [
        "get-detail",
        "get-feed",
        "get-comments",
        "post-comment",
        "post-like",
        "delete-like",
        "delete-comment",
      ] as const;

      for (const operation of cases) {
        const [post] = await db
          .insert(postsTable)
          .values({
            userId: operation === "get-feed" ? viewer.id : author.id,
            body: `${moderationStatus} ${operation} race post`,
          })
          .returning();
        assert.ok(post);

        let commentId: string | undefined;
        if (operation === "get-comments" || operation === "delete-comment") {
          const [comment] = await db
            .insert(postCommentsTable)
            .values({ postId: post.id, userId: viewer.id, body: "must stay hidden" })
            .returning();
          assert.ok(comment);
          commentId = comment.id;
        }
        if (operation === "delete-like") {
          await db
            .insert(postLikesTable)
            .values({ postId: post.id, userId: viewer.id });
        }

        const response = await requestAfterModerationLockWins(
          post.id,
          moderationStatus,
          () => {
            switch (operation) {
              case "get-detail":
                return client
                  .get(`/api/community/posts/${post.id}`)
                  .set("Authorization", authorization);
              case "get-feed":
                return client
                  .get("/api/community/feed")
                  .set("Authorization", authorization);
              case "get-comments":
                return client
                  .get(`/api/community/posts/${post.id}/comments`)
                  .set("Authorization", authorization);
              case "post-comment":
                return client
                  .post(`/api/community/posts/${post.id}/comments`)
                  .set("Authorization", authorization)
                  .send({ body: "must not be created" });
              case "post-like":
                return client
                  .post(`/api/community/posts/${post.id}/like`)
                  .set("Authorization", authorization);
              case "delete-like":
                return client
                  .delete(`/api/community/posts/${post.id}/like`)
                  .set("Authorization", authorization);
              case "delete-comment":
                return client
                  .delete(`/api/community/posts/${post.id}/comments/${commentId}`)
                  .set("Authorization", authorization);
            }
          },
        );

        if (operation === "get-feed") {
          assert.equal(response.status, 200, JSON.stringify(response.body));
          assert.ok(
            !response.body.feed.some((item: { id: string }) => item.id === post.id),
            "feed must not return a post after its moderation lock wins",
          );
        } else {
          assert.equal(response.status, 404, `${operation}: ${JSON.stringify(response.body)}`);
          assert.equal(response.body.message, "Post not found");
        }

        const [likes, comments] = await Promise.all([
          db
            .select({ userId: postLikesTable.userId })
            .from(postLikesTable)
            .where(eq(postLikesTable.postId, post.id)),
          db
            .select({ id: postCommentsTable.id })
            .from(postCommentsTable)
            .where(eq(postCommentsTable.postId, post.id)),
        ]);
        assert.equal(
          likes.length,
          operation === "delete-like" ? 1 : 0,
          `${operation} must not change likes after moderation wins`,
        );
        assert.equal(
          comments.length,
          operation === "get-comments" || operation === "delete-comment" ? 1 : 0,
          `${operation} must not change comments after moderation wins`,
        );
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Report state machine and assignment
// ─────────────────────────────────────────────────────────────────────────────

describe("Reports operations", () => {
  test("GET /admin/reports requires reports:read", async () => {
    const support = await createAdmin("reports-support", "support");
    const { agent } = await login(support);
    const res = await agent.get("/api/admin/reports");
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("POST /admin/reports/:id/outcome requires non-empty reason", async () => {
    const reporter = await createTestUser("report-reporter1");
    const reported = await createTestUser("report-reported1");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-outcome-owner");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/outcome`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "actioned", reason: "" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/outcome invalid status is rejected", async () => {
    const reporter = await createTestUser("report-reporter2");
    const reported = await createTestUser("report-reported2");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-outcome-owner2");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/outcome`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "closed", reason: "some reason" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/outcome valid statuses accepted and writes history", async () => {
    const reporter = await createTestUser("report-reporter3");
    const reported = await createTestUser("report-reported3");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-outcome-owner3");
    const { agent, csrf } = await login(owner);

    for (const status of ["in_review", "escalated", "dismissed", "resolved"] as const) {
      await db
        .update(userReportsTable)
        .set({ status: "open", resolvedAt: null, resolvedByAdminId: null, resolution: null, resolutionReason: null })
        .where(eq(userReportsTable.id, report.id));

      const res = await agent
        .post(`/api/admin/reports/${report.id}/outcome`)
        .set("X-CSRF-Token", csrf)
        .send({ status, reason: `test reason for ${status}` });
      assert.equal(res.status, 200, `status=${status} body=${JSON.stringify(res.body)}`);
    }

    // Verify status history was written (4 transitions)
    const hist = await getHistory("report", report.id);
    assert.ok(hist.length >= 4, `expected ≥4 history rows, got ${hist.length}`);

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/assign self-assigns with reason and writes history for open→in_review", async () => {
    const reporter = await createTestUser("report-assign-r1");
    const reported = await createTestUser("report-assign-r2");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-assign-owner");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/assign`)
      .set("X-CSRF-Token", csrf)
      .send({ assignTo: "me", reason: "taking ownership" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.assignedAdminId, owner.id);

    // Assign from "open" to an admin auto-transitions to in_review — history should appear
    const hist = await getHistory("report", report.id);
    assert.equal(hist.length, 1, "should have 1 history row for open→in_review");
    assert.equal(hist[0]!.fromStatus, "open");
    assert.equal(hist[0]!.toStatus, "in_review");

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/assign requires reason", async () => {
    const reporter = await createTestUser("report-assign-r3");
    const reported = await createTestUser("report-assign-r4");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-assign-no-reason");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/assign`)
      .set("X-CSRF-Token", csrf)
      .send({ assignTo: "me" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/notes requires both note and reason, writes audit", async () => {
    const reporter = await createTestUser("report-note-r1");
    const reported = await createTestUser("report-note-r2");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-note-owner");
    const { agent, csrf } = await login(owner);

    // Missing reason
    const noReason = await agent
      .post(`/api/admin/reports/${report.id}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ note: "something suspicious" });
    assert.equal(noReason.status, 400, JSON.stringify(noReason.body));

    // Missing note
    const noNote = await agent
      .post(`/api/admin/reports/${report.id}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "reviewing" });
    assert.equal(noNote.status, 400, JSON.stringify(noNote.body));

    // Valid: both supplied
    const ok = await agent
      .post(`/api/admin/reports/${report.id}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ note: "this account has prior violations", reason: "documenting findings" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));

    // Verify audit row was written for the note
    const auditRows = await db
      .select()
      .from(adminAuditEventsTable)
      .where(
        and(
          eq(adminAuditEventsTable.targetId, report.id),
          eq(adminAuditEventsTable.action, "report.note.add"),
        ),
      );
    assert.ok(auditRows.length >= 1, "should have audit row for note.add");
    assert.equal(auditRows[0]!.reason, "documenting findings");

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/suspend-user requires both permissions + recent auth + SUSPEND confirmation", async () => {
    const reporter = await createTestUser("report-susp-r1");
    const reported = await createTestUser("report-susp-r2");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-susp-owner");
    const { agent, csrf, sessionToken } = await login(owner);

    // Expire recent auth
    await db
      .update(adminSessionsTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(sessionToken)));

    const noRecentAuth = await agent
      .post(`/api/admin/reports/${report.id}/suspend-user`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "fraud confirmed", confirmation: "SUSPEND" });
    assert.equal(noRecentAuth.status, 403, JSON.stringify(noRecentAuth.body));
    assert.equal(noRecentAuth.body.code, "RECENT_AUTH_REQUIRED");

    // Re-auth
    await agent.post("/api/admin/auth/reauth").set("X-CSRF-Token", csrf).send({ password: PASSWORD });

    // Missing confirmation
    const noConfirm = await agent
      .post(`/api/admin/reports/${report.id}/suspend-user`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "fraud confirmed" });
    assert.equal(noConfirm.status, 400, JSON.stringify(noConfirm.body));
    assert.equal(noConfirm.body.code, "CONFIRMATION_REQUIRED");

    // Missing reason
    const noReason = await agent
      .post(`/api/admin/reports/${report.id}/suspend-user`)
      .set("X-CSRF-Token", csrf)
      .send({ confirmation: "SUSPEND" });
    assert.equal(noReason.status, 400, JSON.stringify(noReason.body));

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("POST /admin/reports/:id/suspend-user works when preconditions met and writes history", async () => {
    const reporter = await createTestUser("report-susp-ok-r1");
    const reported = await createTestUser("report-susp-ok-r2");
    const report = await createTestReport(reporter.id, reported.id);
    const owner = await createAdmin("reports-susp-ok-owner");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/suspend-user`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "clear fraud evidence", confirmation: "SUSPEND" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.targetUserId, reported.id);

    // User is suspended
    const [updatedUser] = await db
      .select({ suspendedAt: usersTable.suspendedAt })
      .from(usersTable)
      .where(eq(usersTable.id, reported.id));
    assert.ok(updatedUser?.suspendedAt);

    // Report is resolved (canonical vocabulary)
    const [updatedReport] = await db
      .select({ status: userReportsTable.status })
      .from(userReportsTable)
      .where(eq(userReportsTable.id, report.id));
    assert.equal(updatedReport?.status, "resolved");

    // Status history row written for report (open → resolved)
    const hist = await getHistory("report", report.id);
    assert.ok(hist.length >= 1, "should have report status history row");
    const lastHist = hist[hist.length - 1]!;
    assert.equal(lastHist.toStatus, "resolved");
    assert.equal(lastHist.reason, "clear fraud evidence");

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("suspend-user is OWNER-only: a non-owner admin with both perms + recent auth is 403 OWNER_REQUIRED and alters no state", async () => {
    const reporter = await createTestUser("report-owner-r1");
    const reported = await createTestUser("report-owner-r2");
    const report = await createTestReport(reporter.id, reported.id);

    // The 'admin' role carries BOTH reports:moderate and users:manage, but is
    // NOT owner. Login yields a fresh recent_auth_at, so the recent-auth gate
    // passes and the ONLY failing gate is the owner requirement.
    const nonOwner = await createAdmin("reports-nonowner", "admin");
    assert.ok(nonOwner.permissions.includes("reports:moderate"));
    assert.ok(nonOwner.permissions.includes("users:manage"));
    assert.notEqual(nonOwner.role, "owner");
    const { agent, csrf } = await login(nonOwner);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/suspend-user`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "should be blocked", confirmation: "SUSPEND" });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, "OWNER_REQUIRED");

    // No user/report/session state was altered.
    const [userAfter] = await db
      .select({ suspendedAt: usersTable.suspendedAt })
      .from(usersTable)
      .where(eq(usersTable.id, reported.id));
    assert.equal(userAfter?.suspendedAt, null, "reported user must NOT be suspended");

    const [reportAfter] = await db
      .select({ status: userReportsTable.status })
      .from(userReportsTable)
      .where(eq(userReportsTable.id, report.id));
    assert.equal(reportAfter?.status, "open", "report status must be unchanged");

    // No report status-history row was written by this denied attempt.
    const hist = await getHistory("report", report.id);
    assert.equal(hist.length, 0, "no status history should be written on owner denial");

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });

  test("suspend-user without users:manage permission fails", async () => {
    const reporter = await createTestUser("report-perm-r1");
    const reported = await createTestUser("report-perm-r2");
    const report = await createTestReport(reporter.id, reported.id);

    const moderator = await createAdmin("reports-perm-mod", "moderator");
    const { agent, csrf } = await login(moderator);

    const res = await agent
      .post(`/api/admin/reports/${report.id}/suspend-user`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "test", confirmation: "SUSPEND" });
    assert.equal(res.status, 403, JSON.stringify(res.body));

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event lifecycle validation + recent-auth boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("Event lifecycle transitions", () => {
  test("invalid transitions are rejected", async () => {
    const owner = await createAdmin("event-lc-owner");
    const { agent, csrf } = await login(owner);

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}lifecycle test event`,
        venue: "Test Venue",
        city: "Test City",
        eventDate: "2025-12-01",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const invalid = await agent
      .post(`/api/admin/events/${event.id}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({ toStatus: "completed", reason: "skip ahead", confirmation: "CONFIRM" });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    assert.equal(invalid.body.code, "INVALID_TRANSITION");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("requires reason for lifecycle transition", async () => {
    const owner = await createAdmin("event-lc-owner2");
    const { agent, csrf } = await login(owner);

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}lifecycle no reason`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const res = await agent
      .post(`/api/admin/events/${event.id}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({ toStatus: "upcoming", confirmation: "CONFIRM" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("publish requires confirmation for sensitive transitions", async () => {
    const owner = await createAdmin("event-lc-owner3");
    const { agent, csrf } = await login(owner);

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}lifecycle confirm`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const noConfirm = await agent
      .post(`/api/admin/events/${event.id}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({ toStatus: "upcoming", reason: "ready to go" });
    assert.equal(noConfirm.status, 400, JSON.stringify(noConfirm.body));
    assert.equal(noConfirm.body.code, "CONFIRMATION_REQUIRED");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("upcoming transition requires recent auth — rejected when auth is stale", async () => {
    const owner = await createAdmin("event-lc-noauth");
    const { agent, csrf, sessionToken } = await login(owner);

    // Expire recent auth
    await db
      .update(adminSessionsTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(sessionToken)));

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}lifecycle reauth needed`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const res = await agent
      .post(`/api/admin/events/${event.id}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({ toStatus: "upcoming", reason: "going public", confirmation: "CONFIRM" });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, "RECENT_AUTH_REQUIRED");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("upcoming transition requires recent auth — succeeds immediately after login", async () => {
    const owner = await createAdmin("event-lc-owner4");
    // Fresh login always sets recentAuthAt = now
    const { agent, csrf } = await login(owner);

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}lifecycle valid`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const res = await agent
      .post(`/api/admin/events/${event.id}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({ toStatus: "upcoming", reason: "all set", confirmation: "CONFIRM" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [updated] = await db
      .select({ status: eventsTable.status })
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(updated?.status, "upcoming");

    // Status history was written
    const hist = await getHistory("event", event.id);
    assert.ok(hist.length >= 1, "should have at least 1 event status history row");
    assert.equal(hist[hist.length - 1]!.toStatus, "upcoming");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("admin create then upcoming publishes the event to consumer list, detail, and join", async () => {
    const owner = await createAdmin("event-public-owner");
    const { agent, csrf } = await login(owner);
    const consumer = await createTestUser("event-public-consumer");

    const created = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}public lifecycle event`,
        venue: "Public Venue",
        city: "Sydney",
        eventDate: "2030-12-01",
        reason: "create a collector event",
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const eventId = created.body.event.id as string;

    const published = await agent
      .post(`/api/admin/events/${eventId}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({
        toStatus: "upcoming",
        reason: "publish to collectors",
        confirmation: "CONFIRM",
      });
    assert.equal(published.status, 200, JSON.stringify(published.body));

    const [stored] = await db
      .select({
        status: eventsTable.status,
        isActive: eventsTable.isActive,
        eventModeEnabled: eventsTable.eventModeEnabled,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1);
    assert.deepEqual(stored, {
      status: "upcoming",
      isActive: true,
      eventModeEnabled: true,
    });

    const client = supertest(app);
    const [list, detail] = await Promise.all([
      client.get("/api/events"),
      client.get(`/api/events/${eventId}`),
    ]);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.ok(list.body.some((event: { id: string }) => event.id === eventId));
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.id, eventId);
    assert.equal(detail.body.status, "upcoming");

    const joined = await client
      .post(`/api/events/${eventId}/join`)
      .set("Authorization", userAuthorization(consumer.id));
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.joined, true);
  });

  test("queued event lifecycle requests validate and audit the locked predecessor", async () => {
    const upcomingAdmin = await createAdmin("event-concurrent-upcoming");
    const liveAdmin = await createAdmin("event-concurrent-live");
    const upcomingSession = await login(upcomingAdmin);
    const liveSession = await login(liveAdmin);
    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}concurrent lifecycle event`,
        venue: "Venue",
        city: "Sydney",
        eventDate: "2030-12-02",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const [upcomingResponse, liveResponse] = await queueTwoRequestsBehindRowLock(
      async (tx) => {
        const [locked] = await tx
          .select({ id: eventsTable.id })
          .from(eventsTable)
          .where(eq(eventsTable.id, event.id))
          .for("update")
          .limit(1);
        assert.ok(locked);
      },
      () =>
        upcomingSession.agent
          .post(`/api/admin/events/${event.id}/lifecycle`)
          .set("X-CSRF-Token", upcomingSession.csrf)
          .send({
            toStatus: "upcoming",
            reason: "first queued transition",
            confirmation: "CONFIRM",
          }),
      () =>
        liveSession.agent
          .post(`/api/admin/events/${event.id}/lifecycle`)
          .set("X-CSRF-Token", liveSession.csrf)
          .send({
            toStatus: "live",
            reason: "second queued transition",
            confirmation: "CONFIRM",
          }),
    );
    assert.equal(upcomingResponse.status, 200, JSON.stringify(upcomingResponse.body));
    assert.equal(liveResponse.status, 200, JSON.stringify(liveResponse.body));

    const history = await getHistory("event", event.id);
    assert.equal(
      history.find((row) => row.toStatus === "upcoming")?.fromStatus,
      "draft",
    );
    assert.equal(
      history.find((row) => row.toStatus === "live")?.fromStatus,
      "upcoming",
    );

    const audits = await db
      .select({
        action: adminAuditEventsTable.action,
        previousState: adminAuditEventsTable.previousState,
      })
      .from(adminAuditEventsTable)
      .where(eq(adminAuditEventsTable.targetId, event.id));
    assert.deepEqual(
      audits.find((row) => row.action === "event.lifecycle.live")?.previousState,
      { status: "upcoming", isActive: true },
    );

    const [finalEvent] = await db
      .select({
        status: eventsTable.status,
        isActive: eventsTable.isActive,
        eventModeEnabled: eventsTable.eventModeEnabled,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id))
      .limit(1);
    assert.deepEqual(finalEvent, {
      status: "live",
      isActive: true,
      eventModeEnabled: true,
    });
  });

  test("live transition also requires recent auth", async () => {
    const owner = await createAdmin("event-lc-live-noauth");
    const { agent, csrf, sessionToken } = await login(owner);

    // Expire recent auth
    await db
      .update(adminSessionsTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(sessionToken)));

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}lifecycle live reauth`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "upcoming",
        isActive: true,
        eventModeEnabled: false,
      })
      .returning();
    assert.ok(event);

    const res = await agent
      .post(`/api/admin/events/${event.id}/lifecycle`)
      .set("X-CSRF-Token", csrf)
      .send({ toStatus: "live", reason: "starting event", confirmation: "CONFIRM" });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, "RECENT_AUTH_REQUIRED");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("participant remove writes status history (event_participant) and audit", async () => {
    const owner = await createAdmin("event-part-rm-owner");
    const { agent, csrf } = await login(owner);
    const user = await createTestUser("event-part-rm-user");

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}participant remove test`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "live",
        isActive: true,
        eventModeEnabled: true,
      })
      .returning();
    assert.ok(event);

    const [participant] = await db
      .insert(eventParticipantsTable)
      .values({
        eventId: event.id,
        userId: user.id,
        participationStatus: "participating",
        isVisible: true,
      })
      .returning();
    assert.ok(participant);

    const res = await agent
      .post(`/api/admin/events/${event.id}/participants/${participant.id}/remove`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "disruptive behaviour" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Status history written for event_participant
    const hist = await getHistory("event_participant", participant.id);
    assert.equal(hist.length, 1, "should have 1 event_participant history row");
    assert.equal(hist[0]!.toStatus, "removed");
    assert.equal(hist[0]!.fromStatus, "participating");

    // Audit row written
    const auditCount = await countAudit(participant.id);
    assert.ok(auditCount >= 1, "should have audit row for participant remove");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });

  test("participant restore writes status history (event_participant) and audit", async () => {
    const owner = await createAdmin("event-part-restore-owner");
    const { agent, csrf } = await login(owner);
    const user = await createTestUser("event-part-restore-user");

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}participant restore test`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-01",
        status: "live",
        isActive: true,
        eventModeEnabled: true,
      })
      .returning();
    assert.ok(event);

    const [participant] = await db
      .insert(eventParticipantsTable)
      .values({
        eventId: event.id,
        userId: user.id,
        participationStatus: "removed",
        isVisible: false,
        leftAt: new Date(),
        removalReason: "original removal",
        removedByAdminId: owner.id,
      })
      .returning();
    assert.ok(participant);

    const res = await agent
      .post(`/api/admin/events/${event.id}/participants/${participant.id}/restore`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "appeal granted" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const hist = await getHistory("event_participant", participant.id);
    assert.equal(hist.length, 1, "should have 1 event_participant history row");
    assert.equal(hist[0]!.toStatus, "participating");
    assert.equal(hist[0]!.fromStatus, "removed");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });
});

describe("consumer event lifecycle concurrency boundary", () => {
  test("closure wins before join, so no participation is created or reactivated", async () => {
    const user = await createTestUser("event-close-join-user");
    const authorization = userAuthorization(user.id);
    const client = supertest(app);

    for (const existingState of ["none", "left"] as const) {
      const [event] = await db
        .insert(eventsTable)
        .values({
          name: `${TAG}closure join ${existingState}`,
          venue: "Venue",
          city: "Sydney",
          eventDate: "2030-12-03",
          status: "upcoming",
          isActive: true,
          eventModeEnabled: true,
        })
        .returning();
      assert.ok(event);

      if (existingState === "left") {
        await db.insert(eventParticipantsTable).values({
          eventId: event.id,
          userId: user.id,
          leftAt: new Date(),
          isVisible: false,
          participationStatus: "left",
        });
      }

      const response = await requestAfterEventClosureLockWins(
        event.id,
        () =>
          client
            .post(`/api/events/${event.id}/join`)
            .set("Authorization", authorization),
      );
      assert.equal(response.status, 404, JSON.stringify(response.body));
      assert.equal(response.body.message, "Event not found");

      const rows = await db
        .select({
          leftAt: eventParticipantsTable.leftAt,
          isVisible: eventParticipantsTable.isVisible,
          participationStatus: eventParticipantsTable.participationStatus,
        })
        .from(eventParticipantsTable)
        .where(
          and(
            eq(eventParticipantsTable.eventId, event.id),
            eq(eventParticipantsTable.userId, user.id),
          ),
        );
      if (existingState === "none") {
        assert.equal(rows.length, 0, "closed event join must not create participation");
      } else {
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.participationStatus, "left");
        assert.equal(rows[0]?.isVisible, false);
        assert.ok(rows[0]?.leftAt, "closed event join must not reactivate participation");
      }
    }
  });

  test("closure wins before trade matching, so no match or profile data is returned", async () => {
    const requester = await createTestUser("event-close-match-requester");
    const other = await createTestUser("event-close-match-other");
    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}closure trade match`,
        venue: "Venue",
        city: "Sydney",
        eventDate: "2030-12-04",
        status: "live",
        isActive: true,
        eventModeEnabled: true,
      })
      .returning();
    assert.ok(event);
    await db.insert(eventParticipantsTable).values([
      {
        eventId: event.id,
        userId: requester.id,
        isVisible: true,
        participationStatus: "participating",
      },
      {
        eventId: event.id,
        userId: other.id,
        isVisible: true,
        participationStatus: "participating",
      },
    ]);

    const response = await requestAfterEventClosureLockWins(
      event.id,
      () =>
        supertest(app)
          .get(`/api/events/${event.id}/trade-matches`)
          .set("Authorization", userAuthorization(requester.id)),
    );
    assert.equal(response.status, 404, JSON.stringify(response.body));
    assert.equal(response.body.message, "Event not found");
    assert.equal(response.body.matches, undefined);
    assert.equal(response.body.matchCount, undefined);
  });

  test("participation lookups hide every non-public lifecycle and inactive row", async () => {
    const user = await createTestUser("event-closed-participation-user");
    const authorization = userAuthorization(user.id);
    const client = supertest(app);

    for (const status of ["draft", "paused", "completed", "archived", "cancelled"] as const) {
      const [event] = await db
        .insert(eventsTable)
        .values({
          name: `${TAG}hidden participation ${status}`,
          venue: "Venue",
          city: "Sydney",
          eventDate: "2030-12-05",
          status,
          // Keep both legacy flags true to prove lifecycle status itself is
          // required by the shared public predicate.
          isActive: true,
          eventModeEnabled: true,
        })
        .returning();
      assert.ok(event);
      await db.insert(eventParticipantsTable).values({
        eventId: event.id,
        userId: user.id,
        isVisible: true,
        participationStatus: "participating",
      });

      const [active, direct] = await Promise.all([
        client
          .get("/api/events/my-active-participation")
          .set("Authorization", authorization),
        client
          .get(`/api/events/${event.id}/my-participation`)
          .set("Authorization", authorization),
      ]);
      assert.equal(active.status, 200, JSON.stringify(active.body));
      assert.deepEqual(active.body, { eventId: null, eventName: null });
      assert.equal(direct.status, 200, JSON.stringify(direct.body));
      assert.deepEqual(direct.body, { isParticipating: false });
    }

    const [publicEvent] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}removed participation`,
        venue: "Venue",
        city: "Sydney",
        eventDate: "2030-12-06",
        status: "upcoming",
        isActive: true,
        eventModeEnabled: true,
      })
      .returning();
    assert.ok(publicEvent);
    await db.insert(eventParticipantsTable).values({
      eventId: publicEvent.id,
      userId: user.id,
      leftAt: new Date(),
      isVisible: false,
      participationStatus: "removed",
    });

    const [active, direct] = await Promise.all([
      client
        .get("/api/events/my-active-participation")
        .set("Authorization", authorization),
      client
        .get(`/api/events/${publicEvent.id}/my-participation`)
        .set("Authorization", authorization),
    ]);
    assert.deepEqual(active.body, { eventId: null, eventName: null });
    assert.deepEqual(direct.body, { isParticipating: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Trades — truthful unavailable capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/trades", () => {
  test("reports aggregate counts and honest unavailable capabilities", async () => {
    const owner = await createAdmin("trades-owner");
    const { agent } = await login(owner);

    const res = await agent.get("/api/admin/trades");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.aggregates);
    assert.ok(typeof res.body.aggregates.forTradeItems === "number");
    assert.ok(typeof res.body.aggregates.activeWishlistItems === "number");
    assert.ok(res.body.unavailableCapabilities);
    assert.equal(res.body.unavailableCapabilities.tradeOffers.available, false);
    assert.ok(
      typeof res.body.unavailableCapabilities.tradeOffers.reason === "string" &&
        res.body.unavailableCapabilities.tradeOffers.reason.length > 10,
    );
    assert.equal(res.body.unavailableCapabilities.disputes.available, false);
    assert.equal(res.body.unavailableCapabilities.offerAcceptance.available, false);
  });

  test("requires trust:read permission", async () => {
    const support = await createAdmin("trades-support", "support");
    const { agent } = await login(support);
    const res = await agent.get("/api/admin/trades");
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Certifications — cannot falsely verify; notes require reason; create is transactional
// ─────────────────────────────────────────────────────────────────────────────

describe("Certification status transitions", () => {
  test("cannot set status=verified without providerVerificationStatus=completed", async () => {
    const owner = await createAdmin("cert-verify-owner");
    const { agent, csrf } = await login(owner);

    const [cert] = await db
      .insert(certificationReviewsTable)
      .values({
        cardId: `${TAG}cert-card-1`,
        cardName: "Test Card",
        provider: "internal",
        status: "under_review",
        providerVerificationStatus: "not_requested",
      })
      .returning();
    assert.ok(cert);

    const res = await agent
      .post(`/api/admin/certifications/${cert.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "verified", reason: "looks good" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "VERIFICATION_PRECONDITION_FAILED");

    await db.delete(certificationReviewsTable).where(eq(certificationReviewsTable.id, cert.id));
  });

  test("cannot set status=verified when externalVerifiedAt is null even if providerVerificationStatus=completed", async () => {
    const owner = await createAdmin("cert-verify-owner2");
    const { agent, csrf } = await login(owner);

    const [cert] = await db
      .insert(certificationReviewsTable)
      .values({
        cardId: `${TAG}cert-card-2`,
        cardName: "Test Card 2",
        provider: "psa",
        status: "under_review",
        providerVerificationStatus: "completed",
      })
      .returning();
    assert.ok(cert);

    const res = await agent
      .post(`/api/admin/certifications/${cert.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "verified", reason: "provider said so" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "VERIFICATION_PRECONDITION_FAILED");

    await db.delete(certificationReviewsTable).where(eq(certificationReviewsTable.id, cert.id));
  });

  test("internal admin can set internally_reviewed without external verification", async () => {
    const owner = await createAdmin("cert-internal-owner");
    const { agent, csrf } = await login(owner);

    const [cert] = await db
      .insert(certificationReviewsTable)
      .values({
        cardId: `${TAG}cert-card-3`,
        cardName: "Test Card 3",
        provider: "internal",
        status: "pending",
        providerVerificationStatus: "not_requested",
      })
      .returning();
    assert.ok(cert);

    const res = await agent
      .post(`/api/admin/certifications/${cert.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "internally_reviewed", reason: "admin reviewed evidence" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [updated] = await db
      .select({ status: certificationReviewsTable.status })
      .from(certificationReviewsTable)
      .where(eq(certificationReviewsTable.id, cert.id));
    assert.equal(updated?.status, "internally_reviewed");

    // Status history written
    const hist = await getHistory("certification", cert.id);
    assert.ok(hist.length >= 1, "should have status history row");
    assert.equal(hist[hist.length - 1]!.toStatus, "internally_reviewed");

    await db.delete(certificationReviewsTable).where(eq(certificationReviewsTable.id, cert.id));
  });

  test("certification status requires non-empty reason", async () => {
    const owner = await createAdmin("cert-reason-owner");
    const { agent, csrf } = await login(owner);

    const [cert] = await db
      .insert(certificationReviewsTable)
      .values({
        cardId: `${TAG}cert-card-4`,
        cardName: "Test Card 4",
        provider: "internal",
        status: "pending",
        providerVerificationStatus: "not_requested",
      })
      .returning();
    assert.ok(cert);

    const res = await agent
      .post(`/api/admin/certifications/${cert.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "rejected", reason: "" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(certificationReviewsTable).where(eq(certificationReviewsTable.id, cert.id));
  });

  test("certification create writes initial status history + audit transactionally", async () => {
    const owner = await createAdmin("cert-create-owner");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post("/api/admin/certifications")
      .set("X-CSRF-Token", csrf)
      .send({
        cardId: `${TAG}cert-create-card`,
        cardName: "Create Test Card",
        provider: "internal",
        reason: "initiating review",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const certId = res.body.certification.id as string;

    // Initial status history must exist (null → pending)
    const hist = await getHistory("certification", certId);
    assert.equal(hist.length, 1, "should have 1 initial status history row");
    assert.equal(hist[0]!.fromStatus, null);
    assert.equal(hist[0]!.toStatus, "pending");
    assert.equal(hist[0]!.reason, "initiating review");

    // Audit row must exist
    const auditCount = await countAudit(certId);
    assert.ok(auditCount >= 1, "should have audit row for certification create");

    await db.delete(certificationReviewsTable).where(eq(certificationReviewsTable.id, certId));
  });

  test("certification notes require both note and reason, write audit transactionally", async () => {
    const owner = await createAdmin("cert-note-owner");
    const { agent, csrf } = await login(owner);

    const [cert] = await db
      .insert(certificationReviewsTable)
      .values({
        cardId: `${TAG}cert-note-card`,
        cardName: "Note Test Card",
        provider: "internal",
        status: "pending",
        providerVerificationStatus: "not_requested",
      })
      .returning();
    assert.ok(cert);

    // Missing reason
    const noReason = await agent
      .post(`/api/admin/certifications/${cert.id}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ note: "checking card" });
    assert.equal(noReason.status, 400, JSON.stringify(noReason.body));

    // Missing note
    const noNote = await agent
      .post(`/api/admin/certifications/${cert.id}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "research" });
    assert.equal(noNote.status, 400, JSON.stringify(noNote.body));

    // Valid
    const ok = await agent
      .post(`/api/admin/certifications/${cert.id}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ note: "card appears genuine under UV", reason: "UV inspection result" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));

    // Audit row written
    const auditRows = await db
      .select()
      .from(adminAuditEventsTable)
      .where(
        and(
          eq(adminAuditEventsTable.targetId, cert.id),
          eq(adminAuditEventsTable.action, "certification.note.add"),
        ),
      );
    assert.ok(auditRows.length >= 1, "should have audit row for certification note.add");
    assert.equal(auditRows[0]!.reason, "UV inspection result");

    await db.delete(certificationReviewsTable).where(eq(certificationReviewsTable.id, cert.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drops — owner + recent auth required for publish
// ─────────────────────────────────────────────────────────────────────────────

describe("Drop status transitions", () => {
  test("non-owner cannot publish a drop", async () => {
    const admin = await createAdmin("drop-pub-admin", "admin");
    const { agent, csrf } = await login(admin);

    const [drop] = await db
      .insert(verifiedDropsTable)
      .values({
        title: `${TAG}drop publish test`,
        description: "test drop",
        status: "draft",
      })
      .returning();
    assert.ok(drop);

    const res = await agent
      .post(`/api/admin/drops/${drop.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "published", reason: "ready to publish", confirmation: "CONFIRM" });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, "OWNER_REQUIRED");

    await db.delete(verifiedDropsTable).where(eq(verifiedDropsTable.id, drop.id));
  });

  test("owner without recent auth cannot publish a drop", async () => {
    const owner = await createAdmin("drop-pub-owner-noauth");
    const { agent, csrf, sessionToken } = await login(owner);

    await db
      .update(adminSessionsTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(sessionToken)));

    const [drop] = await db
      .insert(verifiedDropsTable)
      .values({
        title: `${TAG}drop reauth test`,
        description: "test drop reauth",
        status: "draft",
      })
      .returning();
    assert.ok(drop);

    const res = await agent
      .post(`/api/admin/drops/${drop.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "published", reason: "going live", confirmation: "CONFIRM" });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, "RECENT_AUTH_REQUIRED");

    await db.delete(verifiedDropsTable).where(eq(verifiedDropsTable.id, drop.id));
  });

  test("owner with recent auth and CONFIRM can publish a drop and history is written", async () => {
    const owner = await createAdmin("drop-pub-owner-ok");
    const { agent, csrf } = await login(owner);

    const [drop] = await db
      .insert(verifiedDropsTable)
      .values({
        title: `${TAG}drop publish ok`,
        description: "test drop ok",
        status: "draft",
      })
      .returning();
    assert.ok(drop);

    const res = await agent
      .post(`/api/admin/drops/${drop.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "published", reason: "all systems go", confirmation: "CONFIRM" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const [updated] = await db
      .select({ status: verifiedDropsTable.status })
      .from(verifiedDropsTable)
      .where(eq(verifiedDropsTable.id, drop.id));
    assert.equal(updated?.status, "published");

    // Status history written
    const hist = await getHistory("drop", drop.id);
    assert.ok(hist.length >= 1, "should have drop status history row");
    assert.equal(hist[hist.length - 1]!.toStatus, "published");

    await db.delete(verifiedDropsTable).where(eq(verifiedDropsTable.id, drop.id));
  });

  test("queued drop transitions validate and audit the locked predecessor", async () => {
    const publishedAdmin = await createAdmin("drop-concurrent-published");
    const liveAdmin = await createAdmin("drop-concurrent-live");
    const publishedSession = await login(publishedAdmin);
    const liveSession = await login(liveAdmin);
    const [drop] = await db
      .insert(verifiedDropsTable)
      .values({
        title: `${TAG}concurrent drop`,
        description: "concurrent transition test",
        status: "draft",
      })
      .returning();
    assert.ok(drop);

    const [publishedResponse, liveResponse] = await queueTwoRequestsBehindRowLock(
      async (tx) => {
        const [locked] = await tx
          .select({ id: verifiedDropsTable.id })
          .from(verifiedDropsTable)
          .where(eq(verifiedDropsTable.id, drop.id))
          .for("update")
          .limit(1);
        assert.ok(locked);
      },
      () =>
        publishedSession.agent
          .post(`/api/admin/drops/${drop.id}/status`)
          .set("X-CSRF-Token", publishedSession.csrf)
          .send({
            status: "published",
            reason: "first queued transition",
            confirmation: "CONFIRM",
          }),
      () =>
        liveSession.agent
          .post(`/api/admin/drops/${drop.id}/status`)
          .set("X-CSRF-Token", liveSession.csrf)
          .send({
            status: "live",
            reason: "second queued transition",
            confirmation: "CONFIRM",
          }),
    );
    assert.equal(publishedResponse.status, 200, JSON.stringify(publishedResponse.body));
    assert.equal(liveResponse.status, 200, JSON.stringify(liveResponse.body));

    const history = await getHistory("drop", drop.id);
    assert.equal(
      history.find((row) => row.toStatus === "published")?.fromStatus,
      "draft",
    );
    assert.equal(
      history.find((row) => row.toStatus === "live")?.fromStatus,
      "published",
    );

    const audits = await db
      .select({
        action: adminAuditEventsTable.action,
        previousState: adminAuditEventsTable.previousState,
      })
      .from(adminAuditEventsTable)
      .where(eq(adminAuditEventsTable.targetId, drop.id));
    assert.deepEqual(
      audits.find((row) => row.action === "drop.status.live")?.previousState,
      { status: "published" },
    );

    const [finalDrop] = await db
      .select({ status: verifiedDropsTable.status })
      .from(verifiedDropsTable)
      .where(eq(verifiedDropsTable.id, drop.id))
      .limit(1);
    assert.equal(finalDrop?.status, "live");
  });

  test("drop status transition requires non-empty reason", async () => {
    const owner = await createAdmin("drop-reason-owner");
    const { agent, csrf } = await login(owner);

    const [drop] = await db
      .insert(verifiedDropsTable)
      .values({
        title: `${TAG}drop reason test`,
        description: "test drop",
        status: "draft",
      })
      .returning();
    assert.ok(drop);

    const res = await agent
      .post(`/api/admin/drops/${drop.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "cancelled", reason: "" });
    assert.equal(res.status, 400, JSON.stringify(res.body));

    await db.delete(verifiedDropsTable).where(eq(verifiedDropsTable.id, drop.id));
  });

  test("invalid drop status transition is rejected", async () => {
    const owner = await createAdmin("drop-invalid-owner");
    const { agent, csrf } = await login(owner);

    const [drop] = await db
      .insert(verifiedDropsTable)
      .values({
        title: `${TAG}drop invalid trans`,
        description: "test drop",
        status: "expired",
      })
      .returning();
    assert.ok(drop);

    const res = await agent
      .post(`/api/admin/drops/${drop.id}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "published", reason: "trying to resurrect", confirmation: "CONFIRM" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "INVALID_TRANSITION");

    await db.delete(verifiedDropsTable).where(eq(verifiedDropsTable.id, drop.id));
  });

  test("GET /admin/drops requires drops:read permission", async () => {
    const support = await createAdmin("drop-perm-support", "support");
    const { agent } = await login(support);
    const res = await agent.get("/api/admin/drops");
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("drop create writes initial status history + audit transactionally", async () => {
    const owner = await createAdmin("drop-create-owner");
    const { agent, csrf } = await login(owner);

    const res = await agent
      .post("/api/admin/drops")
      .set("X-CSRF-Token", csrf)
      .send({
        title: `${TAG}drop create history test`,
        description: "test drop for history",
        reason: "launching new drop program",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dropId = res.body.drop.id as string;

    // Initial status history must exist (null → draft)
    const hist = await getHistory("drop", dropId);
    assert.equal(hist.length, 1, "should have 1 initial status history row");
    assert.equal(hist[0]!.fromStatus, null);
    assert.equal(hist[0]!.toStatus, "draft");
    assert.equal(hist[0]!.reason, "launching new drop program");

    // Audit row written
    const auditCount = await countAudit(dropId);
    assert.ok(auditCount >= 1, "should have audit row for drop create");

    await db.delete(verifiedDropsTable).where(eq(verifiedDropsTable.id, dropId));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit activity
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/operations/activity", () => {
  test("requires operations:read permission", async () => {
    const analyst = await createAdmin("activity-analyst", "analyst", [
      "dashboard:read",
      "users:read",
    ]);
    const { agent } = await login(analyst);
    // Audit log endpoint moved to /admin/operations/activity; dashboard-read-only
    // admins should be denied because it requires operations:read.
    const res = await agent.get("/api/admin/operations/activity");
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("returns paginated immutable audit activity", async () => {
    const owner = await createAdmin("activity-owner");
    const { agent } = await login(owner);
    const res = await agent.get("/api/admin/operations/activity?limit=5");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.activity));
    assert.ok(typeof res.body.total === "number");
    assert.ok(typeof res.body.page === "number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/vendors/:id — read-only detail with notes, linked events, history
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/vendors/:id", () => {
  test("requires vendors:read permission", async () => {
    const support = await createAdmin("vendor-detail-support", "support");
    const { agent } = await login(support);
    const res = await agent.get(
      "/api/admin/vendors/00000000-0000-0000-0000-000000000000",
    );
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("returns 404 for unknown vendor", async () => {
    const owner = await createAdmin("vendor-detail-404");
    const { agent } = await login(owner);
    const res = await agent.get(
      "/api/admin/vendors/00000000-0000-0000-0000-000000000000",
    );
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  test("returns vendor, notes, linked events and chronological status history", async () => {
    const owner = await createAdmin("vendor-detail-owner");
    const { agent, csrf } = await login(owner);

    // Create vendor via API (writes initial "vendor" status history transactionally).
    const createRes = await agent
      .post("/api/admin/vendors")
      .set("X-CSRF-Token", csrf)
      .send({ name: `${TAG}Detail Vendor`, reason: "onboarding new vendor" });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const vendorId = createRes.body.vendor.id as string;

    // Add an internal note.
    const noteRes = await agent
      .post(`/api/admin/vendors/${vendorId}/notes`)
      .set("X-CSRF-Token", csrf)
      .send({ note: "internal note about vendor", reason: "recording context" });
    assert.equal(noteRes.status, 201, JSON.stringify(noteRes.body));

    // A second status transition so history is > 1 and ordering is testable.
    const statusRes = await agent
      .post(`/api/admin/vendors/${vendorId}/status`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "approved", reason: "meets requirements" });
    assert.equal(statusRes.status, 200, JSON.stringify(statusRes.body));

    // Link vendor to a real event.
    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}vendor detail event`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-15",
        status: "upcoming",
        isActive: true,
        eventModeEnabled: true,
      })
      .returning();
    assert.ok(event);

    const linkRes = await agent
      .post(`/api/admin/vendors/${vendorId}/events`)
      .set("X-CSRF-Token", csrf)
      .send({ eventId: event.id, booth: "B12", status: "approved", reason: "confirmed booth" });
    assert.equal(linkRes.status, 201, JSON.stringify(linkRes.body));

    const res = await agent.get(`/api/admin/vendors/${vendorId}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Vendor row
    assert.equal(res.body.vendor.id, vendorId);
    assert.equal(res.body.vendor.status, "approved");

    // Notes
    assert.ok(Array.isArray(res.body.notes));
    assert.equal(res.body.notes.length, 1);
    assert.equal(res.body.notes[0].note, "internal note about vendor");

    // Linked events — includes event name/status/date and booth/link status
    assert.ok(Array.isArray(res.body.linkedEvents));
    assert.equal(res.body.linkedEvents.length, 1);
    const link = res.body.linkedEvents[0];
    assert.equal(link.eventId, event.id);
    assert.equal(link.eventName, `${TAG}vendor detail event`);
    assert.equal(link.eventStatus, "upcoming");
    assert.equal(link.eventDate, "2025-12-15");
    assert.equal(link.booth, "B12");
    assert.equal(link.linkStatus, "approved");

    // Status history — chronological (pending create → approved)
    assert.ok(Array.isArray(res.body.statusHistory));
    assert.ok(res.body.statusHistory.length >= 2);
    assert.equal(res.body.statusHistory[0].toStatus, "pending");
    assert.equal(
      res.body.statusHistory[res.body.statusHistory.length - 1].toStatus,
      "approved",
    );
    for (let i = 1; i < res.body.statusHistory.length; i++) {
      assert.ok(
        new Date(res.body.statusHistory[i].createdAt).getTime() >=
          new Date(res.body.statusHistory[i - 1].createdAt).getTime(),
        "status history must be ordered chronologically",
      );
    }

    await db.delete(eventVendorsTable).where(eq(eventVendorsTable.vendorId, vendorId));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/drops/:id — read-only detail with chronological status history
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/drops/:id", () => {
  test("requires drops:read permission", async () => {
    const support = await createAdmin("drop-detail-support", "support");
    const { agent } = await login(support);
    const res = await agent.get(
      "/api/admin/drops/00000000-0000-0000-0000-000000000000",
    );
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("returns 404 for unknown drop", async () => {
    const owner = await createAdmin("drop-detail-404");
    const { agent } = await login(owner);
    const res = await agent.get(
      "/api/admin/drops/00000000-0000-0000-0000-000000000000",
    );
    assert.equal(res.status, 404, JSON.stringify(res.body));
  });

  test("returns drop and chronological status history", async () => {
    const owner = await createAdmin("drop-detail-owner");
    const { agent, csrf } = await login(owner);

    // Create via API so an initial "drop" status history row exists.
    const createRes = await agent
      .post("/api/admin/drops")
      .set("X-CSRF-Token", csrf)
      .send({
        title: `${TAG}Detail Drop`,
        description: "A detail drop",
        reason: "scheduling a new drop",
      });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const dropId = createRes.body.drop.id as string;

    const res = await agent.get(`/api/admin/drops/${dropId}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.drop.id, dropId);
    assert.ok(Array.isArray(res.body.statusHistory));
    assert.ok(res.body.statusHistory.length >= 1);
    assert.equal(res.body.statusHistory[0].toStatus, "draft");
    assert.equal(res.body.statusHistory[0].domain, "drop");
    for (let i = 1; i < res.body.statusHistory.length; i++) {
      assert.ok(
        new Date(res.body.statusHistory[i].createdAt).getTime() >=
          new Date(res.body.statusHistory[i - 1].createdAt).getTime(),
        "status history must be ordered chronologically",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/reports/:id — now includes chronological status history
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/reports/:id includes status history", () => {
  test("includes chronological report status history", async () => {
    const owner = await createAdmin("report-detail-owner");
    const { agent, csrf } = await login(owner);
    const reporter = await createTestUser("report-detail-reporter");
    const reported = await createTestUser("report-detail-reported");
    const report = await createTestReport(reporter.id, reported.id);

    // Drive two outcome transitions so history has multiple ordered rows.
    const o1 = await agent
      .post(`/api/admin/reports/${report.id}/outcome`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "in_review", reason: "beginning review" });
    assert.equal(o1.status, 200, JSON.stringify(o1.body));

    const o2 = await agent
      .post(`/api/admin/reports/${report.id}/outcome`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "dismissed", reason: "no violation found" });
    assert.equal(o2.status, 200, JSON.stringify(o2.body));

    const res = await agent.get(`/api/admin/reports/${report.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.statusHistory));
    assert.ok(res.body.statusHistory.length >= 2);
    assert.equal(res.body.statusHistory[0].domain, "report");
    assert.equal(
      res.body.statusHistory[res.body.statusHistory.length - 1].toStatus,
      "dismissed",
    );
    for (let i = 1; i < res.body.statusHistory.length; i++) {
      assert.ok(
        new Date(res.body.statusHistory[i].createdAt).getTime() >=
          new Date(res.body.statusHistory[i - 1].createdAt).getTime(),
        "status history must be ordered chronologically",
      );
    }

    await db.delete(userReportsTable).where(eq(userReportsTable.id, report.id));
    await db.delete(usersTable).where(eq(usersTable.id, reporter.id));
    await db.delete(usersTable).where(eq(usersTable.id, reported.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/events/:id/participants — truthful participation analytics
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /admin/events/:id/participants analytics", () => {
  test("requires events:read permission", async () => {
    const support = await createAdmin("event-part-analytics-support", "support");
    const { agent } = await login(support);
    const res = await agent.get(
      "/api/admin/events/00000000-0000-0000-0000-000000000000/participants",
    );
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("returns real counts derived from participation rows and honest attendance flag", async () => {
    const owner = await createAdmin("event-part-analytics-owner");
    const { agent } = await login(owner);

    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}participant analytics event`,
        venue: "Venue",
        city: "City",
        eventDate: "2025-12-20",
        status: "live",
        isActive: true,
        eventModeEnabled: true,
      })
      .returning();
    assert.ok(event);

    const u1 = await createTestUser("part-analytics-active1");
    const u2 = await createTestUser("part-analytics-active2");
    const u3 = await createTestUser("part-analytics-left");
    const u4 = await createTestUser("part-analytics-removed");

    // 2 active participants
    await db.insert(eventParticipantsTable).values([
      {
        eventId: event.id,
        userId: u1.id,
        participationStatus: "participating",
        isVisible: true,
      },
      {
        eventId: event.id,
        userId: u2.id,
        participationStatus: "participating",
        isVisible: true,
      },
      // 1 left (self-left): leftAt set, not admin-removed
      {
        eventId: event.id,
        userId: u3.id,
        participationStatus: "left",
        isVisible: false,
        leftAt: new Date(),
      },
      // 1 removed (admin)
      {
        eventId: event.id,
        userId: u4.id,
        participationStatus: "removed",
        isVisible: false,
        leftAt: new Date(),
        removalReason: "policy violation",
        removedByAdminId: owner.id,
      },
    ]);

    const res = await agent.get(`/api/admin/events/${event.id}/participants`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // Paginated rows preserved
    assert.ok(Array.isArray(res.body.participants));
    assert.equal(res.body.total, 4);

    // Real analytics
    assert.ok(res.body.analytics);
    assert.equal(res.body.analytics.totalRecords, 4);
    assert.equal(res.body.analytics.activeParticipants, 2);
    assert.equal(res.body.analytics.leftParticipants, 1);
    assert.equal(res.body.analytics.removedParticipants, 1);

    // Honest attendance verification declaration
    assert.equal(res.body.analytics.attendanceVerification.available, false);
    assert.ok(
      typeof res.body.analytics.attendanceVerification.reason === "string" &&
        res.body.analytics.attendanceVerification.reason.length > 10,
    );
    assert.ok(
      typeof res.body.analytics.note === "string" &&
        res.body.analytics.note.toLowerCase().includes("participation"),
    );

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, [u1.id, u2.id, u3.id, u4.id]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/events — startsAt/endsAt persistence + schedule validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /admin/events schedule handling", () => {
  test("persists supplied ISO startsAt/endsAt", async () => {
    const owner = await createAdmin("event-create-sched-owner");
    const { agent, csrf } = await login(owner);

    const startsAt = "2026-08-15T09:00:00.000Z";
    const endsAt = "2026-08-15T17:00:00.000Z";
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}scheduled event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        startsAt,
        endsAt,
        reason: "scheduling a new event",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.event.startsAt);
    assert.ok(res.body.event.endsAt);
    assert.equal(new Date(res.body.event.startsAt).toISOString(), startsAt);
    assert.equal(new Date(res.body.event.endsAt).toISOString(), endsAt);

    // Confirm persisted in DB
    const [row] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, res.body.event.id))
      .limit(1);
    assert.ok(row);
    assert.ok(row.startsAt);
    assert.equal(new Date(row.startsAt).toISOString(), startsAt);

    await db.delete(eventsTable).where(eq(eventsTable.id, res.body.event.id));
  });

  test("rejects invalid ISO startsAt", async () => {
    const owner = await createAdmin("event-create-badiso-owner");
    const { agent, csrf } = await login(owner);
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}bad iso event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        startsAt: "not-a-date",
        reason: "scheduling",
      });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /startsAt/);
  });

  test("strict ISO parser rejects permissive/rollover startsAt on create", async () => {
    const owner = await createAdmin("event-create-strict-owner");
    const { agent, csrf } = await login(owner);

    const rejects = [
      "March 10, 2026", // human-readable
      "2026-02-30T09:00:00.000Z", // Feb 30 does not exist
      "2026-13-01T09:00:00.000Z", // month 13
      "2026-08-15T24:00:00.000Z", // hour 24
      "2026-08-15T09:00:00.000+24:00", // offset hour 24
      "2026-08-15T09:00:00.0000Z", // 4-digit fraction (excess precision)
      "2026-08-15T09:00", // no seconds, no offset
      "2026-08-15T09:00:00.000", // no zone designator
    ];
    for (const startsAt of rejects) {
      const res = await agent
        .post("/api/admin/events")
        .set("X-CSRF-Token", csrf)
        .send({
          name: `${TAG}strict event`,
          venue: "Venue",
          city: "City",
          eventDate: "2026-08-15",
          startsAt,
          reason: "scheduling",
        });
      assert.equal(res.status, 400, `startsAt=${startsAt}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, /startsAt/);
    }
  });

  test("strict ISO parser accepts a valid leap-day with an explicit +10:00 offset on create", async () => {
    const owner = await createAdmin("event-create-leap-owner");
    const { agent, csrf } = await login(owner);

    // 2028 is a leap year → Feb 29 is valid. 09:00 +10:00 → 2028-02-28T23:00Z.
    const startsAt = "2028-02-29T09:00:00.000+10:00";
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}leap event`,
        venue: "Venue",
        city: "City",
        eventDate: "2028-02-29",
        startsAt,
        reason: "scheduling",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(
      new Date(res.body.event.startsAt).toISOString(),
      "2028-02-28T23:00:00.000Z",
    );
    await db.delete(eventsTable).where(eq(eventsTable.id, res.body.event.id));
  });

  test("rejects endsAt not after startsAt", async () => {
    const owner = await createAdmin("event-create-range-owner");
    const { agent, csrf } = await login(owner);
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}bad range event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        startsAt: "2026-08-15T17:00:00.000Z",
        endsAt: "2026-08-15T09:00:00.000Z",
        reason: "scheduling",
      });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /after startsAt/);
  });

  test("accepts a timezone-offset ISO time that crosses the UTC day for the eventDate local day", async () => {
    const owner = await createAdmin("event-create-tz-owner");
    const { agent, csrf } = await login(owner);

    // A Sydney evening event (2026-08-15 in local time, +10:00) whose ISO
    // instant lands on 2026-08-14T23:00Z — i.e. the PREVIOUS UTC calendar day.
    // A naive UTC-day check against eventDate "2026-08-15" would wrongly reject
    // this; the corrected validator must accept it and persist the instant.
    const startsAt = "2026-08-15T09:00:00.000+10:00"; // 2026-08-14T23:00:00Z
    const endsAt = "2026-08-15T17:00:00.000+10:00"; // 2026-08-15T07:00:00Z
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}tz offset event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        startsAt,
        endsAt,
        reason: "scheduling a local-evening event",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    // Persisted as the correct UTC instant (previous UTC day), not rejected.
    assert.equal(
      new Date(res.body.event.startsAt).toISOString(),
      "2026-08-14T23:00:00.000Z",
    );
    assert.equal(
      new Date(res.body.event.endsAt).toISOString(),
      "2026-08-15T07:00:00.000Z",
    );

    const [row] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, res.body.event.id))
      .limit(1);
    assert.ok(row);
    assert.ok(row.startsAt);
    assert.equal(new Date(row.startsAt).toISOString(), "2026-08-14T23:00:00.000Z");

    await db.delete(eventsTable).where(eq(eventsTable.id, res.body.event.id));
  });

  test("allows omitted schedule (backward compatible)", async () => {
    const owner = await createAdmin("event-create-nosched-owner");
    const { agent, csrf } = await login(owner);
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}no schedule event`,
        venue: "Venue",
        city: "City",
        eventDate: "Aug 15-17, 2026",
        reason: "scheduling",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.event.startsAt, null);
    assert.equal(res.body.event.endsAt, null);

    await db.delete(eventsTable).where(eq(eventsTable.id, res.body.event.id));
  });

  test("rejects an invalid IANA timezone on create", async () => {
    const owner = await createAdmin("event-create-badtz-owner");
    const { agent, csrf } = await login(owner);
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}bad tz event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        timezone: "Not/AZone",
        reason: "scheduling",
      });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /timezone/);
  });

  test("accepts UTC as a valid timezone on create", async () => {
    const owner = await createAdmin("event-create-utc-owner");
    const { agent, csrf } = await login(owner);
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}utc tz event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        timezone: "UTC",
        reason: "scheduling",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.event.timezone, "UTC");
    await db.delete(eventsTable).where(eq(eventsTable.id, res.body.event.id));
  });

  test("rejects a non-positive / non-integer capacity on create", async () => {
    const owner = await createAdmin("event-create-badcap-owner");
    const { agent, csrf } = await login(owner);
    for (const capacity of [0, -5, 1.5, "abc", {}]) {
      const res = await agent
        .post("/api/admin/events")
        .set("X-CSRF-Token", csrf)
        .send({
          name: `${TAG}bad cap event`,
          venue: "Venue",
          city: "City",
          eventDate: "2026-08-15",
          capacity,
          reason: "scheduling",
        });
      assert.equal(res.status, 400, `capacity=${JSON.stringify(capacity)}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, /capacity/);
    }
  });

  test("rejects a non-boolean featured on create", async () => {
    const owner = await createAdmin("event-create-badfeat-owner");
    const { agent, csrf } = await login(owner);
    const res = await agent
      .post("/api/admin/events")
      .set("X-CSRF-Token", csrf)
      .send({
        name: `${TAG}bad featured event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        featured: "yes",
        reason: "scheduling",
      });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /featured/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /admin/events/:id — centralized edit validation (schedule/tz/types)
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /admin/events/:id validation", () => {
  // Create a persisted event with a known schedule directly in the DB.
  async function seedEvent(
    label: string,
    overrides: Partial<typeof eventsTable.$inferInsert> = {},
  ) {
    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}${label}`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-08-15",
        status: "draft",
        isActive: false,
        eventModeEnabled: false,
        ...overrides,
      })
      .returning();
    assert.ok(event);
    return event;
  }

  // Assert the DB row's schedule/identity is unchanged and no audit row exists.
  async function assertUnchanged(
    eventId: string,
    snapshot: typeof eventsTable.$inferSelect,
  ) {
    const [row] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1);
    assert.ok(row);
    assert.equal(row.name, snapshot.name);
    assert.equal(row.timezone, snapshot.timezone);
    assert.equal(row.capacity, snapshot.capacity);
    assert.equal(
      row.startsAt ? new Date(row.startsAt).toISOString() : null,
      snapshot.startsAt ? new Date(snapshot.startsAt).toISOString() : null,
    );
    assert.equal(
      row.endsAt ? new Date(row.endsAt).toISOString() : null,
      snapshot.endsAt ? new Date(snapshot.endsAt).toISOString() : null,
    );
    // No audit row for this event was written by a rejected edit.
    assert.equal(await countAudit(eventId), 0, "rejected edit must not write audit");
  }

  async function patch(
    agent: ReturnType<typeof supertest.agent>,
    csrf: string,
    eventId: string,
    payload: Record<string, unknown>,
  ) {
    return agent
      .patch(`/api/admin/events/${eventId}`)
      .set("X-CSRF-Token", csrf)
      .send(payload);
  }

  const S0 = "2026-08-15T09:00:00.000Z";
  const E0 = "2026-08-15T17:00:00.000Z";

  test("rejects a non-date startsAt and leaves the row unchanged", async () => {
    const owner = await createAdmin("event-patch-badstart");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-badstart", { startsAt: new Date(S0), endsAt: new Date(E0) });

    const res = await patch(agent, csrf, event.id, { startsAt: "nope", reason: "edit" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /startsAt/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects a non-date endsAt and leaves the row unchanged", async () => {
    const owner = await createAdmin("event-patch-badend");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-badend", { startsAt: new Date(S0), endsAt: new Date(E0) });

    const res = await patch(agent, csrf, event.id, { endsAt: {}, reason: "edit" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /endsAt/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects endsAt when there is no effective start (none persisted, none provided)", async () => {
    const owner = await createAdmin("event-patch-endnostart");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-endnostart"); // no schedule persisted

    const res = await patch(agent, csrf, event.id, { endsAt: E0, reason: "edit" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /endsAt requires a startsAt/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects a new endsAt before the UNCHANGED existing start", async () => {
    const owner = await createAdmin("event-patch-endbeforestart");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-endbeforestart", { startsAt: new Date(E0) }); // start = 17:00

    // Provide only endsAt earlier than the persisted start → must be rejected.
    const res = await patch(agent, csrf, event.id, { endsAt: S0, reason: "edit" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /after startsAt/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects a new startsAt after the UNCHANGED existing end", async () => {
    const owner = await createAdmin("event-patch-startafterend");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-startafterend", {
      startsAt: new Date(S0),
      endsAt: new Date(E0),
    });

    // Provide only a new start LATER than the persisted end → must be rejected.
    const res = await patch(agent, csrf, event.id, {
      startsAt: "2026-08-15T18:00:00.000Z",
      reason: "edit",
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /after startsAt/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects clearing ONLY start while an existing end remains", async () => {
    const owner = await createAdmin("event-patch-clearstart");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-clearstart", {
      startsAt: new Date(S0),
      endsAt: new Date(E0),
    });

    const res = await patch(agent, csrf, event.id, { startsAt: null, reason: "edit" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /endsAt requires a startsAt/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("allows clearing BOTH endpoints together", async () => {
    const owner = await createAdmin("event-patch-clearboth");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-clearboth", {
      startsAt: new Date(S0),
      endsAt: new Date(E0),
    });

    const res = await patch(agent, csrf, event.id, {
      startsAt: null,
      endsAt: null,
      reason: "clear schedule",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.event.startsAt, null);
    assert.equal(res.body.event.endsAt, null);

    const [row] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id)).limit(1);
    assert.equal(row!.startsAt, null);
    assert.equal(row!.endsAt, null);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("accepts a valid timezone-offset schedule update and stores UTC instants", async () => {
    const owner = await createAdmin("event-patch-tzsched");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-tzsched");

    const res = await patch(agent, csrf, event.id, {
      startsAt: "2026-08-15T09:00:00.000+10:00", // 2026-08-14T23:00Z
      endsAt: "2026-08-15T17:00:00.000+10:00", // 2026-08-15T07:00Z
      reason: "set schedule",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(new Date(res.body.event.startsAt).toISOString(), "2026-08-14T23:00:00.000Z");
    assert.equal(new Date(res.body.event.endsAt).toISOString(), "2026-08-15T07:00:00.000Z");

    const [row] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id)).limit(1);
    // Stored as a real timestamp, not a raw string.
    assert.ok(row!.startsAt instanceof Date);
    assert.equal(new Date(row!.startsAt!).toISOString(), "2026-08-14T23:00:00.000Z");
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("strict ISO parser rejects permissive/rollover startsAt on PATCH and leaves the row unchanged", async () => {
    const owner = await createAdmin("event-patch-strict");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-strict", {
      startsAt: new Date(S0),
      endsAt: new Date(E0),
    });

    const rejects = [
      "March 10, 2026", // human-readable
      "2026-02-30T09:00:00.000Z", // Feb 30 does not exist
      "2026-13-01T09:00:00.000Z", // month 13
      "2026-08-15T24:00:00.000Z", // hour 24
      "2026-08-15T09:00:00.000+24:00", // offset hour 24
      "2026-08-15T09:00:00.0000Z", // 4-digit fraction (excess precision)
      "2026-08-15T09:00", // no seconds, no offset
      "2026-08-15T09:00:00.000", // no zone designator
    ];
    for (const startsAt of rejects) {
      const res = await patch(agent, csrf, event.id, { startsAt, reason: "edit" });
      assert.equal(res.status, 400, `startsAt=${startsAt}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, /startsAt/);
    }
    // Row and audit must be untouched after all rejected attempts.
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("strict ISO parser accepts a valid leap-day with +10:00 offset on PATCH", async () => {
    const owner = await createAdmin("event-patch-leap");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-leap");

    // 2028 leap year: Feb 29 valid. 09:00 +10:00 → 2028-02-28T23:00Z.
    const res = await patch(agent, csrf, event.id, {
      startsAt: "2028-02-29T09:00:00.000+10:00",
      reason: "set leap schedule",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      new Date(res.body.event.startsAt).toISOString(),
      "2028-02-28T23:00:00.000Z",
    );

    const [row] = await db.select().from(eventsTable).where(eq(eventsTable.id, event.id)).limit(1);
    assert.ok(row!.startsAt instanceof Date);
    assert.equal(new Date(row!.startsAt!).toISOString(), "2028-02-28T23:00:00.000Z");
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects an invalid IANA timezone on PATCH and leaves the row unchanged", async () => {
    const owner = await createAdmin("event-patch-badtz");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-badtz", { timezone: "Australia/Sydney" });

    const res = await patch(agent, csrf, event.id, { timezone: "Bogus/Zone", reason: "edit" });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /timezone/);
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("rejects invalid capacity/boolean/text field types on PATCH", async () => {
    const owner = await createAdmin("event-patch-badtypes");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-badtypes", { capacity: 100 });

    const cases: Array<{ payload: Record<string, unknown>; re: RegExp }> = [
      { payload: { capacity: -1 }, re: /capacity/ },
      { payload: { capacity: 2.5 }, re: /capacity/ },
      { payload: { capacity: "lots" }, re: /capacity/ },
      { payload: { featured: "true" }, re: /featured/ },
      { payload: { eventModeEnabled: 1 }, re: /eventModeEnabled/ },
      { payload: { name: "" }, re: /name/ },
      { payload: { name: 42 }, re: /name/ },
      { payload: { city: {} }, re: /city/ },
      { payload: { description: [] }, re: /description/ },
    ];
    for (const c of cases) {
      const res = await patch(agent, csrf, event.id, { ...c.payload, reason: "edit" });
      assert.equal(res.status, 400, `${JSON.stringify(c.payload)}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, c.re, JSON.stringify(c.payload));
    }
    await assertUnchanged(event.id, event);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("applies a valid partial edit (single field) and leaves schedule intact", async () => {
    const owner = await createAdmin("event-patch-partial");
    const { agent, csrf } = await login(owner);
    const event = await seedEvent("patch-partial", {
      startsAt: new Date(S0),
      endsAt: new Date(E0),
      capacity: 50,
    });

    const res = await patch(agent, csrf, event.id, { capacity: 75, reason: "bump capacity" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.event.capacity, 75);
    // Schedule untouched.
    assert.equal(new Date(res.body.event.startsAt).toISOString(), S0);
    assert.equal(new Date(res.body.event.endsAt).toISOString(), E0);
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/vendors/:id/events — link eligibility + no forged link status
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /admin/vendors/:id/events link eligibility", () => {
  // Helper: create a vendor via API (initial status "pending"), optionally
  // promote to "approved".
  async function makeVendor(
    agent: ReturnType<typeof supertest.agent>,
    csrf: string,
    suffix: string,
    approve: boolean,
  ) {
    const createRes = await agent
      .post("/api/admin/vendors")
      .set("X-CSRF-Token", csrf)
      .send({ name: `${TAG}${suffix} vendor`, reason: "onboarding" });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
    const vendorId = createRes.body.vendor.id as string;
    if (approve) {
      const s = await agent
        .post(`/api/admin/vendors/${vendorId}/status`)
        .set("X-CSRF-Token", csrf)
        .send({ status: "approved", reason: "meets requirements" });
      assert.equal(s.status, 200, JSON.stringify(s.body));
    }
    return vendorId;
  }

  async function makeEvent(suffix: string, status: string) {
    const [event] = await db
      .insert(eventsTable)
      .values({
        name: `${TAG}${suffix} event`,
        venue: "Venue",
        city: "City",
        eventDate: "2026-12-01",
        status,
        isActive: status === "live" || status === "upcoming",
        eventModeEnabled: status === "live" || status === "upcoming",
      })
      .returning();
    assert.ok(event);
    return event;
  }

  test("pending (non-approved) vendor cannot be linked", async () => {
    const owner = await createAdmin("vlink-pending-owner");
    const { agent, csrf } = await login(owner);
    const vendorId = await makeVendor(agent, csrf, "pending", false);
    const event = await makeEvent("pending-vendor", "upcoming");

    const res = await agent
      .post(`/api/admin/vendors/${vendorId}/events`)
      .set("X-CSRF-Token", csrf)
      .send({ eventId: event.id, reason: "confirmed booth" });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.message, /approved/);

    // No link row was created
    const links = await db
      .select()
      .from(eventVendorsTable)
      .where(eq(eventVendorsTable.vendorId, vendorId));
    assert.equal(links.length, 0);

    await db.delete(eventVendorsTable).where(eq(eventVendorsTable.vendorId, vendorId));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("approved vendor cannot be linked to a draft event", async () => {
    const owner = await createAdmin("vlink-draft-owner");
    const { agent, csrf } = await login(owner);
    const vendorId = await makeVendor(agent, csrf, "draft", true);
    const event = await makeEvent("draft-event", "draft");

    const res = await agent
      .post(`/api/admin/vendors/${vendorId}/events`)
      .set("X-CSRF-Token", csrf)
      .send({ eventId: event.id, reason: "confirmed booth" });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.message, /lifecycle/);

    await db.delete(eventVendorsTable).where(eq(eventVendorsTable.vendorId, vendorId));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("approved vendor + upcoming event succeeds with server-set link status", async () => {
    const owner = await createAdmin("vlink-ok-owner");
    const { agent, csrf } = await login(owner);
    const vendorId = await makeVendor(agent, csrf, "ok", true);
    const event = await makeEvent("upcoming-event", "upcoming");

    const res = await agent
      .post(`/api/admin/vendors/${vendorId}/events`)
      .set("X-CSRF-Token", csrf)
      .send({ eventId: event.id, booth: "A1", reason: "confirmed booth" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.link.status, "approved");
    assert.equal(res.body.link.booth, "A1");

    await db.delete(eventVendorsTable).where(eq(eventVendorsTable.vendorId, vendorId));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("malicious caller-supplied status cannot forge the link state", async () => {
    const owner = await createAdmin("vlink-forge-owner");
    const { agent, csrf } = await login(owner);
    const vendorId = await makeVendor(agent, csrf, "forge", true);
    const event = await makeEvent("forge-event", "live");

    const res = await agent
      .post(`/api/admin/vendors/${vendorId}/events`)
      .set("X-CSRF-Token", csrf)
      .send({
        eventId: event.id,
        status: "banned_but_forged",
        reason: "attempting to forge",
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // Server ignores the caller status and forces "approved".
    assert.equal(res.body.link.status, "approved");

    const [row] = await db
      .select()
      .from(eventVendorsTable)
      .where(eq(eventVendorsTable.vendorId, vendorId))
      .limit(1);
    assert.ok(row);
    assert.equal(row.status, "approved");

    await db.delete(eventVendorsTable).where(eq(eventVendorsTable.vendorId, vendorId));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration: one-time cleanup of legacy fabricated seed events
// ─────────────────────────────────────────────────────────────────────────────

describe("cleanupLegacySeedEvents", () => {
  // Exact fingerprints of the three former seed rows (must match migrate.ts).
  const FINGERPRINT = {
    name: "TCXPO Sydney 2026",
    venue: "Sydney Olympic Park",
    city: "Sydney, NSW",
    eventDate: "Aug 15\u201317, 2026", // en-dash, as in the original seed
  };

  async function insertFingerprintEvent(overrides: Record<string, unknown> = {}) {
    const [event] = await db
      .insert(eventsTable)
      .values({
        name: FINGERPRINT.name,
        venue: FINGERPRINT.venue,
        city: FINGERPRINT.city,
        eventDate: FINGERPRINT.eventDate,
        isActive: true,
        status: "upcoming",
        eventModeEnabled: true,
        ...overrides,
      })
      .returning();
    assert.ok(event);
    return event;
  }

  test("deletes an exact-fingerprint unowned, unedited, unlinked row", async () => {
    const event = await insertFingerprintEvent();

    const removed = await cleanupLegacySeedEvents();
    assert.ok(removed >= 1);

    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(rows.length, 0, "fabricated seed row should be deleted");
  });

  test("is idempotent — a second run removes nothing new", async () => {
    // With no fingerprint rows present, cleanup removes zero.
    const removed = await cleanupLegacySeedEvents();
    assert.equal(removed, 0);
  });

  test("preserves an admin-created (owned) event sharing the fingerprint", async () => {
    const owner = await createAdmin("legacy-owned-owner");
    const event = await insertFingerprintEvent({ createdByAdminId: owner.id });

    const removed = await cleanupLegacySeedEvents();
    assert.equal(removed, 0);

    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(rows.length, 1, "admin-created event must be preserved");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("preserves an edited (scheduled/description) event sharing the fingerprint", async () => {
    const event = await insertFingerprintEvent({
      startsAt: new Date("2026-08-15T09:00:00.000Z"),
      description: "operator added details",
    });

    const removed = await cleanupLegacySeedEvents();
    assert.equal(removed, 0);

    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(rows.length, 1, "edited event must be preserved");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });

  test("preserves a fingerprint event that has a participant", async () => {
    const event = await insertFingerprintEvent();
    const user = await createTestUser("legacy-participant");
    await db.insert(eventParticipantsTable).values({
      eventId: event.id,
      userId: user.id,
      participationStatus: "participating",
      isVisible: true,
    });

    const removed = await cleanupLegacySeedEvents();
    assert.equal(removed, 0);

    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(rows.length, 1, "event with participants must be preserved");

    await db.delete(eventParticipantsTable).where(eq(eventParticipantsTable.eventId, event.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  });

  test("preserves a fingerprint event that has a vendor link", async () => {
    const [vendor] = await db
      .insert(vendorsTable)
      .values({ name: `${TAG}legacy-link-vendor`, status: "approved" })
      .returning();
    assert.ok(vendor);
    const event = await insertFingerprintEvent();
    await db
      .insert(eventVendorsTable)
      .values({ eventId: event.id, vendorId: vendor.id, status: "approved" });

    const removed = await cleanupLegacySeedEvents();
    assert.equal(removed, 0);

    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(rows.length, 1, "linked event must be preserved");

    await db.delete(eventVendorsTable).where(eq(eventVendorsTable.eventId, event.id));
    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
    await db.delete(vendorsTable).where(eq(vendorsTable.id, vendor.id));
  });

  test("does not delete a non-exact (different eventDate) row", async () => {
    const event = await insertFingerprintEvent({ eventDate: "Aug 18, 2026" });

    const removed = await cleanupLegacySeedEvents();
    assert.equal(removed, 0);

    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    assert.equal(rows.length, 1, "non-exact fingerprint must be preserved");

    await db.delete(eventsTable).where(eq(eventsTable.id, event.id));
  });
});
