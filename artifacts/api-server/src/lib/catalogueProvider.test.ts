import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { runMigrations } from "./migrate.js";
import {
  CatalogueReadFailure,
  canonicalizeJustTcgPath,
  justTcg,
  requireFreshCatalogueReads,
  withCatalogueCache,
} from "./catalogueProvider.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.JUSTTCG_API_KEY;
const originalBudget = process.env.JUSTTCG_DAILY_CALL_BUDGET;
const testPath = "/cards?q=quota-cache-regression&limit=5&include_price_history=false";
const aggregateKey = "composed:test-aggregate-cache-regression";
const cacheKey = `justtcg:${canonicalizeJustTcgPath(testPath)}`;
const usageDate = new Date().toISOString().slice(0, 10);
let priorUsage: number | null = null;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function clearCache(): Promise<void> {
  await db.execute(sql`
    DELETE FROM catalogue_cache_entries
    WHERE cache_key IN (${cacheKey}, ${aggregateKey})
  `);
  await db.execute(sql`
    DELETE FROM catalogue_cache_leases
    WHERE cache_key IN (${cacheKey}, ${aggregateKey})
  `);
}

before(async () => {
  await runMigrations();
  const result = await db.execute<{ outbound_calls: number }>(sql`
    SELECT outbound_calls FROM catalogue_daily_usage WHERE usage_date = ${usageDate}
  `);
  priorUsage = result.rows[0]?.outbound_calls ?? null;
  process.env.JUSTTCG_API_KEY = "test-key";
  process.env.JUSTTCG_DAILY_CALL_BUDGET = "1000000";
});

beforeEach(async () => {
  await clearCache();
  process.env.JUSTTCG_DAILY_CALL_BUDGET = "1000000";
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.JUSTTCG_API_KEY;
  else process.env.JUSTTCG_API_KEY = originalKey;
  if (originalBudget === undefined) delete process.env.JUSTTCG_DAILY_CALL_BUDGET;
  else process.env.JUSTTCG_DAILY_CALL_BUDGET = originalBudget;
  await clearCache();
  if (priorUsage === null) {
    await db.execute(sql`DELETE FROM catalogue_daily_usage WHERE usage_date = ${usageDate}`);
  } else {
    await db.execute(sql`
      UPDATE catalogue_daily_usage SET outbound_calls = ${priorUsage}, updated_at = NOW()
      WHERE usage_date = ${usageDate}
    `);
  }
});

test("coalesces concurrent catalogue reads and serves the durable fresh entry", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return response({ data: [{ id: "cached-card" }] });
  }) as typeof fetch;

  const [a, b, c] = await Promise.all([justTcg(testPath), justTcg(testPath), justTcg(testPath)]);
  assert.equal(calls, 1, "identical misses must share a single provider request");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);

  // No in-flight request remains after the first call. This second read proves
  // the response was read back from Postgres rather than a process-local map.
  const afterRestartEquivalent = await justTcg(testPath);
  assert.equal(calls, 1);
  assert.equal(afterRestartEquivalent.cached, true);
  assert.equal(afterRestartEquivalent.cacheStatus, "fresh");
});

test("coalesces a simultaneous cold miss across independent provider module contexts", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 100));
    return response({ data: [{ id: "cross-process-card" }] });
  }) as typeof fetch;

  const nonce = `${Date.now()}-${Math.random()}`;
  const [replicaA, replicaB] = await Promise.all([
    import(`./catalogueProvider.js?replica=${nonce}-a`),
    import(`./catalogueProvider.js?replica=${nonce}-b`),
  ]);
  const [a, b] = await Promise.all([replicaA.justTcg(testPath), replicaB.justTcg(testPath)]);

  assert.equal(calls, 1, "separate API processes must share the persisted cold-miss lease");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal([a.outboundCall, b.outboundCall].filter(Boolean).length, 1);
});

test("a late cold-miss owner cannot release a replacement lease", async () => {
  let calls = 0;
  let resolveFirst!: () => void;
  let resolveSecond!: () => void;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((resolve) => {
        resolveFirst = () => resolve(response({ data: [{ id: "late-owner" }] }));
      });
    }
    if (calls === 2) {
      return new Promise<Response>((resolve) => {
        resolveSecond = () => resolve(response({ data: [{ id: "replacement-owner" }] }));
      });
    }
    return response({ data: [{ id: "unexpected-third-owner" }] });
  }) as typeof fetch;

  const first = justTcg(testPath);
  while (calls < 1) await new Promise(resolve => setTimeout(resolve, 5));
  await db.execute(sql`
    UPDATE catalogue_cache_leases
    SET lease_until = NOW() - INTERVAL '1 millisecond'
    WHERE cache_key = ${cacheKey}
  `);

  const nonce = `${Date.now()}-${Math.random()}`;
  const replacementModule = await import(`./catalogueProvider.js?replacement=${nonce}`);
  const replacement = replacementModule.justTcg(testPath);
  while (calls < 2) await new Promise(resolve => setTimeout(resolve, 5));

  resolveFirst();
  await new Promise(resolve => setTimeout(resolve, 30));
  const waitingModule = await import(`./catalogueProvider.js?waiter=${nonce}`);
  const waiting = waitingModule.justTcg(testPath);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(calls, 2, "a late owner must not delete the replacement lease");

  resolveSecond();
  const [firstResult, replacementResult, waitingResult] = await Promise.all([first, replacement, waiting]);
  assert.equal(firstResult.status, 200);
  assert.equal(replacementResult.status, 200);
  assert.equal(waitingResult.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual((waitingResult.body as { data: Array<{ id: string }> }).data[0]?.id, "replacement-owner");
});

test("serves stale catalogue data while exactly one controlled revalidation runs", async () => {
  globalThis.fetch = (async () => response({ data: [{ id: "old-card" }] })) as typeof fetch;
  await justTcg(testPath);
  await db.execute(sql`
    UPDATE catalogue_cache_entries
    SET fresh_until = NOW() - INTERVAL '1 minute',
        stale_until = NOW() + INTERVAL '1 hour',
        last_attempt_at = NULL
    WHERE cache_key = ${cacheKey}
  `);

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return response({ data: [{ id: "new-card" }] });
  }) as typeof fetch;

  const [first, second] = await Promise.all([justTcg(testPath), justTcg(testPath)]);
  assert.equal(first.cacheStatus, "stale");
  assert.equal(second.cacheStatus, "stale");
  assert.deepEqual((first.body as { data: Array<{ id: string }> }).data[0]?.id, "old-card");
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls, 1, "stale callers must share one background refresh");

  const refreshed = await justTcg(testPath);
  assert.equal(refreshed.cacheStatus, "fresh");
  assert.equal((refreshed.body as { data: Array<{ id: string }> }).data[0]?.id, "new-card");
});

test("does not make an outbound request for an uncached budget-exhausted read", async () => {
  process.env.JUSTTCG_DAILY_CALL_BUDGET = "0";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return response({ data: [] });
  }) as typeof fetch;

  const result = await justTcg(testPath);
  assert.equal(result.status, 429);
  assert.equal(result.outboundCall, false);
  assert.equal(calls, 0);
  assert.equal((result.body as { code: string }).code, "CATALOGUE_DAILY_BUDGET_EXHAUSTED");
});

test("keeps stale data available when the provider fails or the budget closes", async () => {
  globalThis.fetch = (async () => response({ data: [{ id: "last-known-card" }] })) as typeof fetch;
  await justTcg(testPath);
  await db.execute(sql`
    UPDATE catalogue_cache_entries
    SET fresh_until = NOW() - INTERVAL '1 minute',
        stale_until = NOW() + INTERVAL '1 hour',
        last_attempt_at = NULL
    WHERE cache_key = ${cacheKey}
  `);

  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return response({ error: "provider unavailable" }, 503);
  }) as typeof fetch;
  const providerFailureFallback = await justTcg(testPath);
  assert.equal(providerFailureFallback.cacheStatus, "stale");
  assert.equal((providerFailureFallback.body as { data: Array<{ id: string }> }).data[0]?.id, "last-known-card");
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(providerCalls, 1);

  process.env.JUSTTCG_DAILY_CALL_BUDGET = "0";
  const budgetFallback = await justTcg(testPath);
  assert.equal(budgetFallback.cacheStatus, "stale");
  assert.equal((budgetFallback.body as { data: Array<{ id: string }> }).data[0]?.id, "last-known-card");
  assert.equal(providerCalls, 1, "budget denial must not make another provider call");
});

test("composed cache prevents aggregation fan-out from repeating its loader", async () => {
  let loaders = 0;
  const loader = async () => {
    loaders += 1;
    await new Promise(resolve => setTimeout(resolve, 15));
    return [{ id: "market-card" }];
  };

  const [a, b] = await Promise.all([
    withCatalogueCache(aggregateKey, "market", loader),
    withCatalogueCache(aggregateKey, "market", loader),
  ]);
  assert.equal(loaders, 1);
  assert.deepEqual(a.data, b.data);
});

test("composed feeds reject stale and budget-denied source reads", () => {
  assert.throws(
    () => requireFreshCatalogueReads([{
      status: 200,
      body: { data: [] },
      cached: true,
      cacheStatus: "stale",
      outboundCall: false,
    }]),
    (error: unknown) => error instanceof CatalogueReadFailure && error.status === 503,
  );
  assert.throws(
    () => requireFreshCatalogueReads([{
      status: 429,
      body: { code: "CATALOGUE_DAILY_BUDGET_EXHAUSTED" },
      cached: false,
      cacheStatus: "miss",
      outboundCall: false,
    }]),
    (error: unknown) => error instanceof CatalogueReadFailure && error.status === 429,
  );
});