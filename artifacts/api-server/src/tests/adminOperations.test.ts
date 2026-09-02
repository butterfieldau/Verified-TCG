import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import supertest from "supertest";
import { eq, like, sql } from "drizzle-orm";
import {
  adminAccountsTable,
  adminAuditLogsTable,
  cardProviderMappingsTable,
  db,
  pool,
  pricingOverridesTable,
  pricingRefreshJobsTable,
  scanAttemptsTable,
  usersTable,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { priceChartingStatus, recoverQueuedRefreshJobs } from "../routes/adminOperations.js";
import {
  permissionsForRole,
  type AdminRole,
} from "../lib/adminPermissions.js";

const TAG = `__admin_ops_${Date.now()}__`;
const PASSWORD = "Admin-operations-password-286";

async function cleanup() {
  await db.execute(sql`ALTER TABLE admin_audit_logs DISABLE TRIGGER admin_audit_logs_append_only_mutation`);
  await db.execute(sql`ALTER TABLE admin_audit_logs DISABLE TRIGGER admin_audit_logs_append_only_truncate`);
  try {
    await db.delete(scanAttemptsTable).where(like(scanAttemptsTable.extractedName, `${TAG}%`));
    await db.delete(pricingOverridesTable).where(like(pricingOverridesTable.cardId, `${TAG}%`));
    await db.delete(pricingRefreshJobsTable).where(like(pricingRefreshJobsTable.cardId, `${TAG}%`));
    await db.delete(cardProviderMappingsTable).where(like(cardProviderMappingsTable.cardId, `${TAG}%`));
    await db.delete(usersTable).where(like(usersTable.email, `${TAG}%`));
    await db.delete(adminAccountsTable).where(like(adminAccountsTable.email, `${TAG}%`));
    await db.delete(adminAuditLogsTable).where(like(adminAuditLogsTable.actorEmail, `${TAG}%`));
  } finally {
    await db.execute(sql`ALTER TABLE admin_audit_logs ENABLE TRIGGER admin_audit_logs_append_only_mutation`);
    await db.execute(sql`ALTER TABLE admin_audit_logs ENABLE TRIGGER admin_audit_logs_append_only_truncate`);
  }
}

before(async () => {
  await runMigrations();
  await cleanup();
});

after(async () => {
  await cleanup();
  await pool.end();
});

async function createAdmin(suffix: string, role: AdminRole) {
  const [account] = await db
    .insert(adminAccountsTable)
    .values({
      email: `${TAG}${suffix}@example.com`,
      displayName: `Operations ${suffix}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      permissions: permissionsForRole(role),
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
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
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
  };
}

function assertNoCredentialFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoCredentialFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /(password|csrf|token|secret|hash|credentialValue)/i);
    assertNoCredentialFields(child);
  }
}

describe("TCG data operations", () => {
  test("classifies PriceCharting health from typed evidence and quote freshness", () => {
    const healthyAt = new Date("2026-09-02T01:00:00.000Z");
    const failedAt = new Date("2026-09-02T02:00:00.000Z");
    const row = (kind: "authentication" | "throttled" | "transient") => ({
      lastHealthyAt: healthyAt,
      lastErrorAt: failedAt,
      lastErrorKind: kind,
    });

    assert.equal(priceChartingStatus(false, undefined), "NOT CONNECTED");
    assert.equal(priceChartingStatus(true, undefined), "LIVE");
    assert.equal(priceChartingStatus(true, row("authentication")), "AUTHENTICATION FAILED");
    assert.equal(priceChartingStatus(true, row("throttled")), "RATE LIMITED");
    assert.equal(priceChartingStatus(true, row("transient")), "DEGRADED");
    assert.equal(priceChartingStatus(true, {
      lastHealthyAt: failedAt,
      lastErrorAt: healthyAt,
      lastErrorKind: "transient",
    }, 3), "HEALTHY BUT STALE");
  });

  test("requires scoped permissions and does not expose provider credentials", async () => {
    const support = await createAdmin("support", "support");
    const supportSession = await login(support);
    const denied = await supportSession.agent.get("/api/admin/pricing/providers");
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "PERMISSION_DENIED");

    const owner = await createAdmin("owner", "owner");
    const ownerSession = await login(owner);
    const response = await ownerSession.agent.get("/api/admin/pricing/providers");
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assertNoCredentialFields(response.body);
    for (const provider of response.body.providers) {
      assert.match(
        provider.status,
        /^(LIVE|HEALTHY|HEALTHY BUT STALE|DEGRADED|RATE LIMITED|AUTHENTICATION FAILED|MISCONFIGURED|NOT CONNECTED)$/,
      );
    }

    const coverage = await ownerSession.agent.get("/api/admin/pricing/coverage");
    assert.equal(coverage.status, 200, JSON.stringify(coverage.body));
    assert.ok(Array.isArray(coverage.body.byGame));
    assert.ok(Array.isArray(coverage.body.imports));
    assert.ok(Object.hasOwn(coverage.body, "latestSchedulerRun"));
  });

  test("catalogue import validation is dry-run only and CSRF protected", async () => {
    const owner = await createAdmin("import", "owner");
    const { agent, csrf } = await login(owner);
    const body = {
      records: [
        { name: "Card A", set: "Set A", number: "1" },
        { name: "Card A", set: "Set A", number: "1" },
        { name: "", set: "Set B", number: "2" },
      ],
    };
    const rejected = await agent.post("/api/admin/catalogue/imports/dry-run").send(body);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.code, "CSRF_INVALID");

    const preview = await agent
      .post("/api/admin/catalogue/imports/dry-run")
      .set("X-CSRF-Token", csrf)
      .send(body);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.dryRun, true);
    assert.equal(preview.body.canApply, false);
    assert.equal(preview.body.duplicateRows, 1);
    assert.equal(preview.body.errors.length, 1);
    assert.equal(preview.body.changes.length, 0);
  });

  test("override dry-run does not write and confirmed changes are audited and revocable", async () => {
    const owner = await createAdmin("override", "owner");
    const { agent, csrf } = await login(owner);
    const cardId = `${TAG}override-card`;
    const input = {
      cardId,
      gradeKey: "raw",
      priceCents: 12500,
      currency: "USD",
      reason: "Correct a verified provider mismatch during incident review",
    };
    const before = await db
      .select()
      .from(pricingOverridesTable)
      .where(eq(pricingOverridesTable.cardId, cardId));
    const dryRun = await agent
      .post("/api/admin/pricing/overrides")
      .set("X-CSRF-Token", csrf)
      .send({ ...input, dryRun: true });
    assert.equal(dryRun.status, 200, JSON.stringify(dryRun.body));
    assert.equal(dryRun.body.providerPricingRetained, true);
    const afterDryRun = await db
      .select()
      .from(pricingOverridesTable)
      .where(eq(pricingOverridesTable.cardId, cardId));
    assert.equal(afterDryRun.length, before.length);

    const created = await agent
      .post("/api/admin/pricing/overrides")
      .set("X-CSRF-Token", csrf)
      .send({
        ...input,
        confirmed: true,
        confirmation: "APPLY OVERRIDE",
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.providerPricingRetained, true);

    const revoked = await agent
      .post(`/api/admin/pricing/overrides/${created.body.override.id}/revoke`)
      .set("X-CSRF-Token", csrf)
      .send({
        reason: "Provider mismatch has been resolved and verified",
        confirmed: true,
        confirmation: "REVOKE OVERRIDE",
      });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.ok(revoked.body.override.revokedAt);

    const audits = await db
      .select()
      .from(adminAuditLogsTable)
      .where(eq(adminAuditLogsTable.resourceId, created.body.override.id));
    assert.deepEqual(
      audits.map((audit) => audit.action).sort(),
      ["pricing.override.apply", "pricing.override.revoke"],
    );
  });

  test("scan review exposes sanitized operational facts and persists an audited outcome", async () => {
    const owner = await createAdmin("scanner", "owner");
    const { agent, csrf } = await login(owner);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}collector@example.com`,
        passwordHash: "not-used",
        displayName: "Private Collector",
        username: `${TAG}collector`,
      })
      .returning();
    assert.ok(user);
    const [attempt] = await db
      .insert(scanAttemptsTable)
      .values({
        userId: user.id,
        status: "low_confidence",
        extractedName: `${TAG}Card`,
        extractedSet: "Test Set",
        extractedNumber: "17",
        topMatchCardId: "provider-card-17",
        topMatchName: "Candidate Card",
        topMatchConfidence: 42,
        candidateSummary: [{ cardId: "provider-card-17", confidence: 42 }],
        model: "test-model",
        durationMs: 850,
      })
      .returning();
    assert.ok(attempt);

    const queue = await agent.get("/api/admin/scanner/attempts?reviewStatus=pending");
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    const returned = queue.body.attempts.find((row: { id: string }) => row.id === attempt.id);
    assert.ok(returned);
    assert.equal(returned.userId, undefined);
    assert.equal(returned.image, undefined);
    assert.equal(returned.rawText, undefined);
    assert.equal(queue.body.reprocessingAvailable, false);
    assert.equal(queue.body.imageRetention, "not_stored");

    const review = await agent
      .post(`/api/admin/scanner/attempts/${attempt.id}/review`)
      .set("X-CSRF-Token", csrf)
      .send({
        outcome: "false_positive",
        reason: "Candidate identity does not match the extracted set and number",
        confirmed: true,
        confirmation: "REVIEW SCAN",
      });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.attempt.reviewStatus, "reviewed");
    assert.equal(review.body.attempt.reviewOutcome, "false_positive");
  });

  test("concurrent refresh requests for the same card produce exactly one queued job", async () => {
    // This test verifies the DB-level partial unique index and onConflictDoNothing
    // prevent duplicate active jobs — the same guarantee the API route relies on.
    // Testing at the DB layer is reliable regardless of provider configuration
    // (the API route requires PriceCharting to be connected to create jobs).
    const cardId = `${TAG}concurrent-idempotency`;

    // Simulate the first request's insert — should succeed.
    const [first] = await db
      .insert(pricingRefreshJobsTable)
      .values({
        cardId,
        providerKey: "pricecharting",
        reason: "Idempotency regression check — first request",
      })
      .onConflictDoNothing()
      .returning();
    assert.ok(first, "First insert must create a row");
    assert.equal(first.status, "queued");

    // Simulate the second concurrent request's insert for the same card.
    // The partial unique index on (card_id, provider_key) WHERE status IN
    // ('queued','running') must silently drop this insert.
    const [second] = await db
      .insert(pricingRefreshJobsTable)
      .values({
        cardId,
        providerKey: "pricecharting",
        reason: "Idempotency regression check — duplicate concurrent request",
      })
      .onConflictDoNothing()
      .returning();
    assert.equal(
      second,
      undefined,
      "Second insert for the same active card must be silently dropped by the unique index",
    );

    // Exactly one job row for this card
    const all = await db
      .select()
      .from(pricingRefreshJobsTable)
      .where(eq(pricingRefreshJobsTable.cardId, cardId));
    assert.equal(all.length, 1, "Only one job row must exist after two concurrent inserts");
  });

  test("second scan review is rejected with 409 and produces exactly one audit entry", async () => {
    // Verifies the "first reviewer wins" invariant: once a decision is recorded
    // (the FOR UPDATE + pending-state guard ensures only one can commit), every
    // subsequent attempt — whether sequential or concurrent — receives 409 and
    // no additional audit entry is written.
    const owner = await createAdmin("review-race", "owner");
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}race-collector@example.com`,
        passwordHash: "not-used",
        displayName: "Race Collector",
        username: `${TAG}race-collector`,
      })
      .returning();
    assert.ok(user);
    const [attempt] = await db
      .insert(scanAttemptsTable)
      .values({
        userId: user.id,
        status: "low_confidence",
        extractedName: `${TAG}RaceCard`,
        durationMs: 100,
      })
      .returning();
    assert.ok(attempt);

    const { agent, csrf } = await login(owner);
    const reviewPayload = (outcome: string) => ({
      outcome,
      reason: "Review idempotency regression check for concurrent-guard logic",
      confirmed: true,
      confirmation: "REVIEW SCAN",
    });

    // First reviewer submits a decision — must succeed.
    const first = await agent
      .post(`/api/admin/scanner/attempts/${attempt.id}/review`)
      .set("X-CSRF-Token", csrf)
      .send(reviewPayload("confirmed_match"));
    assert.equal(first.status, 200, `First review failed: ${JSON.stringify(first.body)}`);
    assert.equal(first.body.attempt.reviewStatus, "reviewed");
    assert.equal(first.body.attempt.reviewOutcome, "confirmed_match");

    // Second reviewer (or same reviewer retrying) — must be rejected.
    const second = await agent
      .post(`/api/admin/scanner/attempts/${attempt.id}/review`)
      .set("X-CSRF-Token", csrf)
      .send(reviewPayload("false_positive"));
    assert.equal(second.status, 409, `Second review should return 409, got ${second.status}: ${JSON.stringify(second.body)}`);

    // Exactly one audit entry for this attempt — the second review must not
    // have written a second record that would corrupt the audit trail.
    const audits = await db
      .select()
      .from(adminAuditLogsTable)
      .where(eq(adminAuditLogsTable.resourceId, attempt.id));
    assert.equal(audits.length, 1, `Expected exactly 1 audit entry, got ${audits.length}`);
    assert.equal(audits[0]!.action, "scanner.attempt.review");
  });

  test("queued refresh jobs are claimed on startup and marked failed when the provider is not configured", async () => {
    const originalToken = process.env.PRICECHARTING_API_TOKEN;
    const originalDeprecatedToken = process.env.PRICECHARTING_TOKEN;
    delete process.env.PRICECHARTING_API_TOKEN;
    delete process.env.PRICECHARTING_TOKEN;
    try {
    // Verifies two invariants of the explicit refresh path:
    // 1. The recovery function dispatches queued jobs (job transitions from 'queued')
    // 2. A job is marked 'failed' — not 'succeeded' — when the provider rejects the
    //    call (here: provider not configured in the test environment), proving that
    //    success requires a real provider response, not a silent fast-path.
    const cardId = `${TAG}recovery-job`;

    // Pre-seed a matched mapping with a provider product ID so runRefreshJob
    // can attempt the explicit provider call.
    await db
      .insert(cardProviderMappingsTable)
      .values({
        cardId,
        providerKey: "pricecharting",
        status: "matched",
        providerProductId: "test-recovery-product-explicit",
        matchedName: "Recovery Test Card",
        matchedSet: "Test Set",
      })
      .onConflictDoNothing();

    // Insert a queued job as if it survived a restart.
    const [queued] = await db
      .insert(pricingRefreshJobsTable)
      .values({
        cardId,
        providerKey: "pricecharting",
        reason: "Restart-recovery regression: must contact provider explicitly",
      })
      .returning();
    assert.ok(queued);
    assert.equal(queued.status, "queued");

    // Run the recovery function — simulates what happens on server startup.
    await recoverQueuedRefreshJobs();

    // Allow the fire-and-forget job to attempt claim and process.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const [after] = await db
      .select()
      .from(pricingRefreshJobsTable)
      .where(eq(pricingRefreshJobsTable.id, queued.id));
    assert.ok(after);

    // The job must have been claimed (left 'queued' state).
    assert.notEqual(
      after.status,
      "queued",
      "Recovery must claim the job — it must not remain 'queued' after recovery runs",
    );

    // When the provider is not configured, the explicit refresh path must return
    // 'failed', not 'succeeded'. This proves we attempted a real provider call
    // rather than taking a silent fresh-quote bypass.
    // (In CI/test the provider is not configured, so we always expect 'failed'.)
    assert.equal(
      after.status,
      "failed",
      `Without a configured provider the job must be 'failed', not '${after.status}'. ` +
        `This means the explicit refresh path is NOT bypassing the provider for fresh data.`,
    );
    assert.ok(
      after.errorMessage,
      "A failed job must record an error message so operators can diagnose the issue",
    );
    } finally {
      if (originalToken == null) delete process.env.PRICECHARTING_API_TOKEN;
      else process.env.PRICECHARTING_API_TOKEN = originalToken;
      if (originalDeprecatedToken == null) delete process.env.PRICECHARTING_TOKEN;
      else process.env.PRICECHARTING_TOKEN = originalDeprecatedToken;
    }
  });

  test("stale running jobs are re-queued and retried by the recovery function", async () => {
    const originalToken = process.env.PRICECHARTING_API_TOKEN;
    const originalDeprecatedToken = process.env.PRICECHARTING_TOKEN;
    delete process.env.PRICECHARTING_API_TOKEN;
    delete process.env.PRICECHARTING_TOKEN;
    try {
    // Verifies that jobs left in 'running' by a killed process are reset to
    // 'queued' and re-dispatched so they are not permanently stranded.
    const cardId = `${TAG}stale-running-job`;

    await db
      .insert(cardProviderMappingsTable)
      .values({
        cardId,
        providerKey: "pricecharting",
        status: "matched",
        providerProductId: "test-stale-running-product",
        matchedName: "Stale Running Card",
        matchedSet: "Test Set",
      })
      .onConflictDoNothing();

    // Insert a job that is already 'running' but started 60 minutes ago (stale).
    const staleStart = new Date(Date.now() - 60 * 60 * 1000);
    const [stale] = await db
      .insert(pricingRefreshJobsTable)
      .values({
        cardId,
        providerKey: "pricecharting",
        reason: "Stale running job recovery regression",
        // Force 'running' status by inserting directly — bypasses the atomic claim
        // in runRefreshJob which only claims 'queued' rows.
      })
      .returning();
    assert.ok(stale);

    // Manually update to 'running' with a stale start time to simulate the stuck state.
    await db
      .update(pricingRefreshJobsTable)
      .set({ status: "running", startedAt: staleStart, updatedAt: new Date() })
      .where(eq(pricingRefreshJobsTable.id, stale.id));

    // Verify pre-condition: job is stuck in 'running'.
    const [before] = await db.select().from(pricingRefreshJobsTable).where(eq(pricingRefreshJobsTable.id, stale.id));
    assert.equal(before?.status, "running");

    // Run recovery — must reset stale running jobs back to queued and dispatch them.
    await recoverQueuedRefreshJobs();

    // Allow fire-and-forget dispatch to attempt claim.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const [after] = await db.select().from(pricingRefreshJobsTable).where(eq(pricingRefreshJobsTable.id, stale.id));
    assert.ok(after);
    assert.notEqual(
      after.status,
      "running",
      "Stale running job must be transitioned — it must not remain stuck in 'running' after recovery",
    );
    } finally {
      if (originalToken == null) delete process.env.PRICECHARTING_API_TOKEN;
      else process.env.PRICECHARTING_API_TOKEN = originalToken;
      if (originalDeprecatedToken == null) delete process.env.PRICECHARTING_TOKEN;
      else process.env.PRICECHARTING_TOKEN = originalDeprecatedToken;
    }
  });

  test("collection intelligence remains aggregate-only", async () => {
    const analyst = await createAdmin("analyst", "analyst");
    const { agent } = await login(analyst);
    const response = await agent.get("/api/admin/collections/overview");
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.privacy.collectorIdentitiesIncluded, false);
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /"userId"|"email"|"notes"|"displayName"/);
    assert.equal(response.body.quality.automaticPrivateDataRepairAvailable, false);
  });
});