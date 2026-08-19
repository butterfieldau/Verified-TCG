import { after, before, describe, test } from "node:test";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import supertest from "supertest";
import { and, eq, like } from "drizzle-orm";
import {
  adminAccountsTable,
  adminSessionsTable,
  db,
  pool,
} from "@workspace/db";
import app from "../app.js";
import { runMigrations } from "../lib/migrate.js";
import {
  hashAdminToken,
} from "../lib/adminSession.js";
import {
  permissionsForRole,
  type AdminRole,
} from "../lib/adminPermissions.js";

const TAG = `__admin_security_${Date.now()}__`;
const PASSWORD = "A-strong-test-password-284";
const request = supertest(app);

async function cleanup() {
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
    sessionToken: cookieValue(response, "vtcg_admin_session"),
  };
}

function assertNoSensitiveFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /(password|csrf|token|secret|hash)/i);
    assertNoSensitiveFields(child);
  }
}

describe("administrator security boundaries", () => {
  test("owner bootstrap cannot run after a durable administrator exists", async () => {
    await createAdmin("bootstrap-owner");
    assert.ok(process.env.ADMIN_SECRET, "ADMIN_SECRET must be configured for the migration test");
    const response = await request.post("/api/admin/auth/bootstrap").send({
      secret: process.env.ADMIN_SECRET,
      email: `${TAG}second-owner@example.com`,
      displayName: "Second Owner",
      password: PASSWORD,
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));
  });

  test("five failed logins durably lock an account", async () => {
    const account = await createAdmin("lockout", "support");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request
        .post("/api/admin/auth/login")
        .send({ email: account.email, password: "incorrect-password" });
      assert.equal(response.status, 401);
      assert.equal(response.body.message, "Email or password is incorrect.");
    }
    const [locked] = await db
      .select()
      .from(adminAccountsTable)
      .where(eq(adminAccountsTable.id, account.id));
    assert.equal(locked?.failedLoginCount, 5);
    assert.ok(locked?.lockedUntil && locked.lockedUntil > new Date());

    const validPasswordWhileLocked = await request
      .post("/api/admin/auth/login")
      .send({ email: account.email, password: PASSWORD });
    assert.equal(validPasswordWhileLocked.status, 401);
  });

  test("parallel failed logins cannot bypass the durable lockout counter", async () => {
    const account = await createAdmin("parallel-lockout", "support");
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request
          .post("/api/admin/auth/login")
          .send({ email: account.email, password: "incorrect-password" }),
      ),
    );
    assert.ok(responses.every((response) => response.status === 401));
    const [locked] = await db
      .select()
      .from(adminAccountsTable)
      .where(eq(adminAccountsTable.id, account.id));
    assert.equal(locked?.failedLoginCount, 5);
    assert.ok(locked?.lockedUntil && locked.lockedUntil > new Date());
  });

  test("CSRF is required for authenticated state changes", async () => {
    const account = await createAdmin("csrf");
    const { agent } = await login(account);
    const response = await agent.post("/api/admin/auth/logout").send({});
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "CSRF_INVALID");
  });

  test("API permissions deny inaccessible sections even with a valid session", async () => {
    const account = await createAdmin("permission", "analyst", ["analytics:read"]);
    const { agent } = await login(account);
    const response = await agent.get("/api/admin/stats");
    assert.equal(response.status, 403);
    assert.equal(response.body.code, "PERMISSION_DENIED");

    const teamResponse = await agent.get("/api/admin/team");
    assert.equal(teamResponse.status, 403);
    assert.equal(teamResponse.body.code, "OWNER_REQUIRED");
  });

  test("revoked, idle-expired, and absolute-expired sessions are rejected", async () => {
    const account = await createAdmin("expiry");

    const revoked = await login(account);
    await db
      .update(adminSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(revoked.sessionToken)));
    assert.equal((await revoked.agent.get("/api/admin/auth/me")).status, 401);

    const idle = await login(account);
    await db
      .update(adminSessionsTable)
      .set({ lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(idle.sessionToken)));
    assert.equal((await idle.agent.get("/api/admin/auth/me")).status, 401);

    const absolute = await login(account);
    await db
      .update(adminSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(absolute.sessionToken)));
    assert.equal((await absolute.agent.get("/api/admin/auth/me")).status, 401);
  });

  test("sensitive actions require recent password confirmation", async () => {
    const owner = await createAdmin("recent-owner");
    const { agent, csrf, sessionToken } = await login(owner);
    await db
      .update(adminSessionsTable)
      .set({ recentAuthAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(adminSessionsTable.tokenHash, hashAdminToken(sessionToken)));

    const blocked = await agent
      .post("/api/admin/team/invitations")
      .set("X-CSRF-Token", csrf)
      .send({
        email: `${TAG}recent-target@example.com`,
        displayName: "Recent Target",
        role: "support",
      });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, "RECENT_AUTH_REQUIRED");

    const wrongPassword = await agent
      .post("/api/admin/auth/reauth")
      .set("X-CSRF-Token", csrf)
      .send({ password: "incorrect-password" });
    assert.equal(wrongPassword.status, 403);
    assert.equal(wrongPassword.body.code, "REAUTH_FAILED");

    const confirmed = await agent
      .post("/api/admin/auth/reauth")
      .set("X-CSRF-Token", csrf)
      .send({ password: PASSWORD });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  });

  test("an invitation token creates at most one session under concurrent redemption", async () => {
    const token = randomBytes(32).toString("base64url");
    const [invited] = await db
      .insert(adminAccountsTable)
      .values({
        email: `${TAG}single-use-invite@example.com`,
        displayName: "Single Use Invite",
        passwordHash: await bcrypt.hash(randomBytes(24).toString("base64url"), 4),
        role: "support",
        permissions: permissionsForRole("support"),
        status: "invited",
        invitationTokenHash: hashAdminToken(token),
        invitationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitationDeliveryStatus: "sent",
      })
      .returning();
    assert.ok(invited);

    const responses = await Promise.all([
      request.post("/api/admin/auth/activate").send({ token, password: PASSWORD }),
      request.post("/api/admin/auth/activate").send({ token, password: PASSWORD }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 400],
    );
    const sessions = await db
      .select()
      .from(adminSessionsTable)
      .where(eq(adminSessionsTable.adminId, invited.id));
    assert.equal(sessions.length, 1);
  });

  test("owners cannot alter themselves, create owners, or exceed role permissions", async () => {
    const owner = await createAdmin("authority-owner");
    const target = await createAdmin("authority-target", "support");
    const { agent, csrf } = await login(owner);

    const selfChange = await agent
      .patch(`/api/admin/team/${owner.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "admin" });
    assert.equal(selfChange.status, 400);

    const ownerInvite = await agent
      .post("/api/admin/team/invitations")
      .set("X-CSRF-Token", csrf)
      .send({
        email: `${TAG}forbidden-owner@example.com`,
        displayName: "Forbidden Owner",
        role: "owner",
      });
    assert.equal(ownerInvite.status, 400);

    const excessivePermission = await agent
      .patch(`/api/admin/team/${target.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "support", permissions: ["users:delete"] });
    assert.equal(excessivePermission.status, 400);
  });

  test("admin responses never expose credentials or raw security tokens", async () => {
    const owner = await createAdmin("safe-response-owner");
    const { agent } = await login(owner);
    const me = await agent.get("/api/admin/auth/me");
    const team = await agent.get("/api/admin/team");
    const sessions = await agent.get("/api/admin/sessions");
    assert.equal(me.status, 200);
    assert.equal(team.status, 200);
    assert.equal(sessions.status, 200);
    assertNoSensitiveFields(me.body);
    assertNoSensitiveFields(team.body);
    assertNoSensitiveFields(sessions.body);
  });

  test("revoking a non-current session invalidates it immediately", async () => {
    const owner = await createAdmin("revoke-owner");
    const first = await login(owner);
    const second = await login(owner);
    const [firstSession] = await db
      .select()
      .from(adminSessionsTable)
      .where(
        and(
          eq(adminSessionsTable.adminId, owner.id),
          eq(adminSessionsTable.tokenHash, hashAdminToken(first.sessionToken)),
        ),
      );
    assert.ok(firstSession);

    const response = await second.agent
      .delete(`/api/admin/sessions/${firstSession.id}`)
      .set("X-CSRF-Token", second.csrf);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal((await first.agent.get("/api/admin/auth/me")).status, 401);
  });
});