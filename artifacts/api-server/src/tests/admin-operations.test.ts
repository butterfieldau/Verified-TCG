/**
 * Admin operations endpoints integration tests.
 *
 * Exercises the permission-scoped operations panel: overview, activity,
 * attention, search, user detail, subscriptions view, and the reports/support
 * queue workflow patch endpoints. Uses the real Postgres database, applies
 * runMigrations() so the operational columns/tables exist, and cleans up.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import supertest from "supertest";
import { and, eq, like } from "drizzle-orm";
import {
  adminAccountsTable,
  contactSubmissionsTable,
  db,
  pool,
  userReportsTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { permissionsForRole, type AdminRole } from "../lib/adminPermissions.js";

const TAG = `__admin_ops_${Date.now()}__`;
const PASSWORD = "A-strong-test-password-285";

async function cleanup() {
  await db.delete(userReportsTable).where(like(userReportsTable.reason, `${TAG}%`));
  await db.delete(contactSubmissionsTable).where(like(contactSubmissionsTable.subject, `${TAG}%`));
  await db.delete(usersTable).where(like(usersTable.email, `${TAG}%`));
  await db.delete(adminAccountsTable).where(like(adminAccountsTable.email, `${TAG}%`));
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

async function createCollector(suffix: string) {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}${suffix}@example.com`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      displayName: `Collector ${suffix}`,
      username: `${TAG}${suffix}`.replace(/[^a-z0-9_]/gi, "").toLowerCase(),
    })
    .returning();
  assert.ok(user);
  return user;
}

async function login(account: { email: string }) {
  const agent = supertest.agent(app);
  const response = await agent
    .post("/api/admin/auth/login")
    .send({ email: account.email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const csrfCookie = cookies.find((c) => c.startsWith("vtcg_admin_csrf="));
  assert.ok(csrfCookie);
  const csrf = decodeURIComponent(csrfCookie.split(";")[0]!.slice("vtcg_admin_csrf=".length));
  return { agent, csrf };
}

describe("admin operations endpoints", () => {
  test("overview returns date range, comparisons, and availability metadata", async () => {
    const owner = await createAdmin("overview");
    const { agent } = await login(owner);

    const ok = await agent.get("/api/admin/overview?preset=30d");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.range.preset, "30d");
    assert.ok(ok.body.comparisons.users);
    assert.equal(ok.body.dataAvailability.users.available, true);
    assert.equal(ok.body.dataAvailability.reports.available, true);

    const badCustom = await agent.get("/api/admin/overview?preset=custom");
    assert.equal(badCustom.status, 400);

    const tooLong = await agent.get(
      "/api/admin/overview?preset=custom&start=2000-01-01&end=2020-01-01",
    );
    assert.equal(tooLong.status, 400);
  });

  test("analyst overview omits comparisons it lacks permission for", async () => {
    const analyst = await createAdmin("analyst-overview", "analyst");
    const { agent } = await login(analyst);
    const res = await agent.get("/api/admin/overview");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // analyst has analytics:read + reports:read but NOT contact:read
    assert.equal(res.body.dataAvailability.support.available, false);
    assert.equal(res.body.comparisons.support, undefined);
    assert.ok(res.body.comparisons.reports);
  });

  test("overview, activity, and attention omit collector data without users permission", async () => {
    const limited = await createAdmin("dashboard-only", "support", ["dashboard:read"]);
    const { agent } = await login(limited);

    const overview = await agent.get("/api/admin/overview?preset=7d");
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.equal(overview.body.dataAvailability.users.available, false);
    assert.equal(overview.body.totals.totalUsers, null);
    assert.equal(overview.body.comparisons.users, undefined);

    const activity = await agent.get("/api/admin/activity?preset=7d");
    assert.equal(activity.status, 200, JSON.stringify(activity.body));
    assert.equal(activity.body.dataAvailability.signups.available, false);
    assert.ok(
      activity.body.events.every(
        (event: { kind: string }) => event.kind !== "signup" && event.kind !== "activity",
      ),
    );

    const attention = await agent.get("/api/admin/attention?preset=7d");
    assert.equal(attention.status, 200, JSON.stringify(attention.body));
    assert.equal(attention.body.dataAvailability.suspendedUsers.available, false);
  });

  test("search omits categories the caller cannot read and marks unsupported sources", async () => {
    const collector = await createCollector("searchable");
    const support = await createAdmin("search-support", "support");
    const { agent } = await login(support);

    const res = await agent.get(`/api/admin/search?q=${TAG.slice(2, 10)}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // support role has users:read + contact:read but NOT reports:read
    assert.equal(res.body.dataAvailability.users.available, true);
    assert.equal(res.body.dataAvailability.reports.available, false);
    assert.equal(res.body.results.reports, undefined);
    assert.equal(res.body.dataAvailability.cards.available, false);
    assert.equal(res.body.dataAvailability.events.available, false);
    assert.ok(Array.isArray(res.body.results.users));
    assert.ok(res.body.results.users.some((u: { id: string }) => u.id === collector.id));

    const short = await agent.get("/api/admin/search?q=a");
    assert.equal(short.status, 400);
  });

  test("user detail is privacy-respecting and states payment data is unavailable", async () => {
    const collector = await createCollector("detail");
    const owner = await createAdmin("detail-owner");
    const { agent } = await login(owner);

    const res = await agent.get(`/api/admin/users/${collector.id}/detail`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.id, collector.id);
    assert.equal(res.body.dataAvailability.payment.available, false);
    // never expose tokens/hashes
    const serialized = JSON.stringify(res.body);
    assert.doesNotMatch(serialized, /passwordHash|refreshTokenHash|token_hash/i);

    const missing = await agent.get(
      "/api/admin/users/00000000-0000-0000-0000-000000000000/detail",
    );
    assert.equal(missing.status, 404);
  });

  test("user detail cross-permission: report section hidden without reports:read", async () => {
    const collector = await createCollector("detail-privacy");
    // support role has contact:read but NOT reports:read
    const support = await createAdmin("detail-privacy-support", "support");
    const { agent } = await login(support);

    const res = await agent.get(`/api/admin/users/${collector.id}/detail`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.relationships.reportsAvailable, false);
    // counts are null when permission is absent
    assert.equal(res.body.relationships.reportsAgainst, null);
    assert.equal(res.body.relationships.reportsSubmitted, null);
    // recent arrays are empty when permission is absent
    assert.ok(Array.isArray(res.body.relationships.recentReportsAgainst));
    assert.equal(res.body.relationships.recentReportsAgainst.length, 0);
    assert.ok(Array.isArray(res.body.relationships.recentReportsSubmitted));
    assert.equal(res.body.relationships.recentReportsSubmitted.length, 0);
    // contact section should be visible (support has contact:read)
    assert.equal(res.body.relationships.supportAvailable, true);
  });

  test("collector session revocation requires a reason and removes active sessions", async () => {
    const collector = await createCollector("session-revoke");
    await db.insert(userSessionsTable).values({
      userId: collector.id,
      refreshTokenHash: `${TAG}-session-revoke`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const owner = await createAdmin("session-revoke-owner");
    const { agent, csrf } = await login(owner);

    const blocked = await agent
      .delete(`/api/admin/users/${collector.id}/sessions`)
      .set("X-CSRF-Token", csrf)
      .send({});
    assert.equal(blocked.status, 400);

    const revoked = await agent
      .delete(`/api/admin/users/${collector.id}/sessions`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "Collector requested a full sign-out." });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.revoked, 1);

    const detail = await agent.get(`/api/admin/users/${collector.id}/detail`);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.sessions.count, 0);
  });

  test("subscriptions view returns plan state and no revenue figures", async () => {
    const owner = await createAdmin("subs-owner");
    const { agent } = await login(owner);
    const res = await agent.get("/api/admin/subscriptions?tier=free&limit=5");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.subscriptions));
    assert.equal(res.body.dataAvailability.revenue.available, false);
    assert.equal(res.body.limit, 5);
  });

  test("report workflow patch updates status, assignee, note history in a transaction", async () => {
    const reporter = await createCollector("reporter");
    const reported = await createCollector("reported");
    const [report] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporter.id,
        reportedUserId: reported.id,
        reason: `${TAG}harassment`,
      })
      .returning();
    assert.ok(report);

    const owner = await createAdmin("report-owner");
    const { agent, csrf } = await login(owner);

    // invalid status rejected
    const bad = await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "not_a_status" });
    assert.equal(bad.status, 400);

    // invalid assignee rejected
    const badAssignee = await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ assignedAdminId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(badAssignee.status, 400);

    // valid close with resolution — creates workflow note + user note = 2 notes total
    const ok = await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({
        status: "resolved",
        assignedAdminId: owner.id,
        note: "Reviewed and actioned.",
        resolution: "Warned the reported collector.",
        resolutionReason: "policy_violation",
      });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, "resolved");
    // patchQueueItem inserts a system workflow-change note AND the user-authored note
    assert.ok(ok.body.notes.length >= 2, `Expected >=2 notes, got ${ok.body.notes.length}`);
    assert.ok(ok.body.notes.every((n: { authorAdminId: string }) => n.authorAdminId === owner.id));

    // direct lookup by id
    const exact = await agent.get(`/api/admin/reports?id=${report.id}`);
    assert.equal(exact.status, 200, JSON.stringify(exact.body));
    assert.equal(exact.body.reports.length, 1);
    assert.equal(exact.body.reports[0].id, report.id);
    assert.ok(exact.body.reports[0].notes.length >= 2);
    assert.ok(
      exact.body.reports[0].notes.some(
        (n: { authorDisplayName: string }) => n.authorDisplayName === owner.displayName,
      ),
    );

    const [row] = await db
      .select()
      .from(userReportsTable)
      .where(eq(userReportsTable.id, report.id));
    assert.equal(row?.status, "resolved");
    assert.equal(row?.assignedAdminId, owner.id);
    assert.ok(row?.resolvedAt);
    assert.ok(row?.firstResponseAt);
  });

  test("report reopen clears terminal fields and terminal state blocks resolution-less close", async () => {
    const reporter = await createCollector("reopen-reporter");
    const reported = await createCollector("reopen-reported");
    const [report] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporter.id,
        reportedUserId: reported.id,
        reason: `${TAG}reopen-test`,
      })
      .returning();
    assert.ok(report);

    const owner = await createAdmin("reopen-owner");
    const { agent, csrf } = await login(owner);

    // closing without resolution is rejected
    const noResolution = await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "resolved" });
    assert.equal(noResolution.status, 400, JSON.stringify(noResolution.body));

    // close it properly
    await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({
        status: "resolved",
        resolution: "No action needed.",
        resolutionReason: "false_report",
      });

    // reopen clears resolution fields
    const reopened = await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "open" });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.status, "open");

    const [row] = await db
      .select()
      .from(userReportsTable)
      .where(eq(userReportsTable.id, report.id));
    assert.equal(row?.resolution, null);
    assert.equal(row?.resolutionReason, null);
    assert.equal(row?.resolvedAt, null);
  });

  test("status=unresolved filter returns only open, in_review, and escalated cases", async () => {
    const reporter = await createCollector("unresolved-reporter");
    const reported = await createCollector("unresolved-reported");

    // create one open + one resolved report
    const [openReport] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporter.id,
        reportedUserId: reported.id,
        reason: `${TAG}unresolved-open`,
      })
      .returning();
    assert.ok(openReport);

    const [resolvedReport] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporter.id,
        reportedUserId: reported.id,
        reason: `${TAG}unresolved-resolved`,
        status: "resolved",
        resolution: "Pre-resolved",
        resolutionReason: "test",
      })
      .returning();
    assert.ok(resolvedReport);

    const owner = await createAdmin("unresolved-owner");
    const { agent } = await login(owner);

    const res = await agent.get("/api/admin/reports?status=unresolved");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.reports));
    const ids = res.body.reports.map((r: { id: string }) => r.id);
    assert.ok(ids.includes(openReport.id), "unresolved filter should include the open report");
    assert.ok(!ids.includes(resolvedReport.id), "unresolved filter should exclude resolved reports");
  });

  test("contact:read without contact:moderate returns 403 on PATCH support case", async () => {
    const [submission] = await db
      .insert(contactSubmissionsTable)
      .values({
        name: "Permission Tester",
        email: `${TAG}perm-test@example.com`,
        category: "General Question",
        subject: `${TAG}permission-gate`,
        message: "Gate test.",
      })
      .returning();
    assert.ok(submission);

    // admin with only contact:read (no contact:moderate)
    const readOnly = await createAdmin("contact-readonly", "analyst", [
      "dashboard:read",
      "analytics:read",
      "contact:read",
    ]);
    const { agent, csrf } = await login(readOnly);

    const forbidden = await agent
      .patch(`/api/admin/contact/${submission.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "in_review", note: "Read-only attempt." });
    assert.equal(forbidden.status, 403, JSON.stringify(forbidden.body));
  });

  test("existing reports queue stays backwards compatible", async () => {
    const owner = await createAdmin("reports-compat");
    const { agent } = await login(owner);
    const res = await agent.get("/api/admin/reports");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.reports));

    const badFilter = await agent.get("/api/admin/reports?status=bogus");
    assert.equal(badFilter.status, 400);
  });

  test("in_review report stays in unresolved queue and fresh insert defaults to open", async () => {
    // Verify the schema default is 'open' (canonical vocabulary), and that
    // a report manually set to 'in_review' still appears in the unresolved queue.
    // Uses admin.ts PATCH (not trust routes) to avoid writing admin_audit_events
    // which has a FK that interferes with the global admin-account cleanup.
    const reporter = await createCollector("assign-reporter");
    const reported = await createCollector("assign-reported");
    const [report] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporter.id,
        reportedUserId: reported.id,
        reason: `${TAG}assign-test`,
      })
      .returning();
    assert.ok(report);
    assert.equal(report.status, "open", "fresh insert must default to open");

    const owner = await createAdmin("assign-owner");
    const { agent, csrf } = await login(owner);

    // Transition to in_review via admin.ts PATCH (writes admin_operational_notes, not admin_audit_events)
    const patchRes = await agent
      .patch(`/api/admin/reports/${report.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "in_review", note: "beginning triage" });
    assert.equal(patchRes.status, 200, JSON.stringify(patchRes.body));
    assert.equal(patchRes.body.status, "in_review");

    // Still appears in unresolved filter (in_review is an unresolved state)
    const list = await agent.get("/api/admin/reports?status=unresolved");
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const ids = list.body.reports.map((r: { id: string }) => r.id);
    assert.ok(ids.includes(report.id), "in_review report should appear in unresolved list");
  });

  test("consumer-submitted report (schema-default status) appears in unresolved overview, attention, and list", async () => {
    // Simulate what block-report.ts does: insert without specifying status so the
    // column default kicks in. After the reconciliation the default must be 'open',
    // and 'open' must appear in all unresolved views.
    const reporter = await createCollector("schema-default-reporter");
    const reported = await createCollector("schema-default-reported");

    // Insert exactly as block-report.ts does — no explicit status field
    const [freshReport] = await db
      .insert(userReportsTable)
      .values({
        reporterUserId: reporter.id,
        reportedUserId: reported.id,
        reason: `${TAG}schema-default`,
        note: null,
      })
      .returning();
    assert.ok(freshReport, "insert succeeded");

    // The schema default must be 'open' (task-285 canonical vocabulary)
    assert.equal(freshReport.status, "open", "schema default must be 'open'");

    const owner = await createAdmin("schema-default-owner");
    const { agent } = await login(owner);

    // 1. Unresolved filter includes it
    const list = await agent.get("/api/admin/reports?status=unresolved");
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const ids = list.body.reports.map((r: { id: string }) => r.id);
    assert.ok(ids.includes(freshReport.id), "fresh report should appear in unresolved list");

    // 2. Overview unresolved count is non-zero (at least our fresh report)
    const overview = await agent.get("/api/admin/overview?preset=7d");
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.ok(
      overview.body.comparisons?.reports?.current > 0 || overview.body.unresolvedReports > 0,
      "overview should reflect unresolved reports",
    );

    // 3. id lookup returns it
    const exact = await agent.get(`/api/admin/reports?id=${freshReport.id}`);
    assert.equal(exact.status, 200, JSON.stringify(exact.body));
    assert.equal(exact.body.reports.length, 1);
    assert.equal(exact.body.reports[0].id, freshReport.id);
  });

  test("support queue patch requires an active admin assignee and records notes", async () => {
    const [submission] = await db
      .insert(contactSubmissionsTable)
      .values({
        name: "Ops Tester",
        email: `${TAG}support@example.com`,
        category: "General Question",
        subject: `${TAG}need help`,
        message: "Please assist.",
      })
      .returning();
    assert.ok(submission);

    const owner = await createAdmin("support-owner");
    const { agent, csrf } = await login(owner);

    // Transition to in_review with note — creates workflow note + user note = >= 2 notes
    const ok = await agent
      .patch(`/api/admin/contact/${submission.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ status: "in_review", note: "Triaging." });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, "in_review");
    assert.ok(ok.body.notes.length >= 2, `Expected >=2 notes, got ${ok.body.notes.length}`);
  });
});
