import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import supertest from "supertest";
import { eq, like } from "drizzle-orm";
import {
  adminAccountsTable,
  adminAuditLogsTable,
  adminSessionsTable,
  db,
  pool,
  pricingRefreshJobsTable,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import { hashAdminToken } from "../lib/adminSession.js";
import type { AdminPermission, AdminRole } from "../lib/adminPermissions.js";
import { deepHealthFailure } from "../routes/health.js";
import { apiHealthFromCounts } from "../routes/adminIntelligence.js";

const TAG = `__command_health_${Date.now()}__`;
const PASSWORD = "Health-test-password-284";

async function cleanup(): Promise<void> {
  await db.delete(pricingRefreshJobsTable).where(like(pricingRefreshJobsTable.cardId, `${TAG}%`));
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

async function createAdmin(suffix: string, permissions: AdminPermission[], role: AdminRole = "analyst") {
  const [account] = await db
    .insert(adminAccountsTable)
    .values({
      email: `${TAG}${suffix}@example.com`,
      displayName: `Health ${suffix}`,
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
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie);
  return decodeURIComponent(cookie.split(";")[0]!.slice(name.length + 1));
}

async function login(account: { email: string }) {
  const agent = supertest.agent(app);
  const response = await agent.post("/api/admin/auth/login").send({
    email: account.email,
    password: PASSWORD,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return {
    agent,
    csrf: cookieValue(response, "vtcg_admin_csrf"),
    sessionToken: cookieValue(response, "vtcg_admin_session"),
  };
}

describe("Command Centre health boundaries", () => {
  test("deep health reports measured component evidence", async () => {
    const response = await supertest(app).get("/api/healthz?deep=1");
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, "ok");
    assert.equal(response.body.components.database.status, "ok");
    assert.ok(response.body.components.database.latencyMs >= 1);
    assert.ok(response.body.checkedAt);
  });

  test("failed deep probes never fabricate database latency", () => {
    const response = deepHealthFailure("2026-09-02T00:00:00.000Z");
    assert.equal(response.status, "degraded");
    assert.equal(response.components.database.status, "failed");
    assert.equal(response.components.database.latencyMs, null);
  });

  test("API error rate counts successful, 4xx, and 5xx responses in its denominator", () => {
    const boundary = apiHealthFromCounts(100, 5);
    assert.equal(boundary.errorRate, 0.05);
    assert.equal(boundary.status, "degraded");

    const belowBoundary = apiHealthFromCounts(100, 4);
    assert.equal(belowBoundary.errorRate, 0.04);
    assert.equal(belowBoundary.status, "healthy");

    const noTraffic = apiHealthFromCounts(0, 0);
    assert.equal(noTraffic.errorRate, null);
    assert.equal(noTraffic.status, "unobserved");
  });

  test("system-only staff can read health and integrations without pricing access", async () => {
    const account = await createAdmin("system-only", ["system:read"]);
    const { agent } = await login(account);

    const [health, integrations, jobs] = await Promise.all([
      agent.get("/api/admin/intelligence/health"),
      agent.get("/api/admin/intelligence/integrations"),
      agent.get("/api/admin/intelligence/jobs"),
    ]);

    assert.equal(health.status, 200, JSON.stringify(health.body));
    assert.ok(["healthy", "degraded", "unavailable"].includes(health.body.status));
    assert.notEqual(health.body.database.latencyMs, 0);
    assert.equal(integrations.status, 200, JSON.stringify(integrations.body));
    assert.ok(Array.isArray(integrations.body.integrations));
    assert.equal(jobs.status, 403);
    assert.equal(jobs.body.code, "PERMISSION_DENIED");
  });

  test("job reads stay separately permissioned and pagination is bounded", async () => {
    const account = await createAdmin("pricing-reader", ["pricing:read"]);
    const { agent } = await login(account);
    const response = await agent.get("/api/admin/intelligence/jobs?page=999999&limit=999");
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.page, 10_000);
    assert.equal(response.body.limit, 100);
    assert.equal(response.body.status, "available");
  });

  test("job mutation keeps CSRF, recent-auth, confirmation, transaction, and audit safeguards", async () => {
    const account = await createAdmin("pricing-manager", ["pricing:manage"], "admin");
    const { agent, csrf, sessionToken } = await login(account);
    const [job] = await db
      .insert(pricingRefreshJobsTable)
      .values({
        cardId: `${TAG}cancel`,
        requestedByAdminId: account.id,
        reason: "Created for protected cancellation test",
      })
      .returning();
    assert.ok(job);

    const withoutCsrf = await agent
      .post(`/api/admin/intelligence/jobs/${job.id}/cancel`)
      .send({ reason: "Operator cancellation test", confirmed: true, confirmation: "CANCEL JOB" });
    assert.equal(withoutCsrf.status, 403);
    assert.equal(withoutCsrf.body.code, "CSRF_INVALID");

    await db
      .update(adminSessionsTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(sessionToken)));
    const staleAuth = await agent
      .post(`/api/admin/intelligence/jobs/${job.id}/cancel`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "Operator cancellation test", confirmed: true, confirmation: "CANCEL JOB" });
    assert.equal(staleAuth.status, 403);
    assert.equal(staleAuth.body.code, "RECENT_AUTH_REQUIRED");

    const reauth = await agent
      .post("/api/admin/auth/reauth")
      .set("X-CSRF-Token", csrf)
      .send({ password: PASSWORD });
    assert.equal(reauth.status, 200);

    const cancelled = await agent
      .post(`/api/admin/intelligence/jobs/${job.id}/cancel`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "Operator cancellation test", confirmed: true, confirmation: "CANCEL JOB" });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.job.status, "cancelled");

    const auditRows = await db
      .select()
      .from(adminAuditLogsTable)
      .where(eq(adminAuditLogsTable.resourceId, job.id));
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0]?.action, "intelligence.job.cancel");
  });
});