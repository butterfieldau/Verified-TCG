import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordTelemetry } from "../lib/telemetry.js";
import { logger } from "../lib/logger.js";
import { resolveCatalogCardById } from "../routes/catalog.js";
import {
  getPricingMappingState,
  recordSchedulerIdentityFailure,
  refreshPricingForScheduler,
  snapshotBucketFor,
} from "./service.js";
import { captureAllPortfolioSnapshotsDetailed } from "./portfolio.js";
import { isPCConfigured } from "./pricecharting.js";

interface ScheduledCardRow extends Record<string, unknown> {
  card_id: string;
  card_data: Record<string, unknown>;
}

interface PricingIdentity {
  name: string;
  set?: string;
  number?: string;
  game?: string;
}

export interface PricingSchedulerResult {
  bucket: string;
  configured: boolean;
  status: "completed" | "failed" | "skipped" | "unconfigured";
  selectedCards: number;
  identityFailures: number;
  refreshSucceeded: number;
  refreshFailed: number;
  snapshotsCaptured: number;
  snapshotsSkipped: number;
  snapshotsFailed: number;
}

export function summarizeSchedulerOutcome(
  refreshes: PromiseSettledResult<void>[],
  snapshots: { captured: number; skipped: number; failed: number },
): {
  status: "completed" | "failed";
  refreshSucceeded: number;
  refreshFailed: number;
  errorMessage: string | null;
} {
  const refreshSucceeded = refreshes.filter(result => result.status === "fulfilled").length;
  const refreshFailed = refreshes.length - refreshSucceeded;
  const status = refreshFailed > 0 || snapshots.failed > 0 ? "failed" : "completed";
  const errorMessage = [
    refreshFailed > 0 ? `${refreshFailed} refreshes failed` : null,
    snapshots.failed > 0 ? `${snapshots.failed} portfolio snapshots failed` : null,
  ].filter(Boolean).join("; ") || null;
  return { status, refreshSucceeded, refreshFailed, errorMessage };
}

function identityFromCatalogCard(card: Record<string, unknown>): PricingIdentity | null {
  const name = typeof card["name"] === "string" ? card["name"].trim() : "";
  if (!name) return null;
  const setValue = card["setName"] ?? card["set"];
  const gameValue = card["tcg"] ?? card["game"];
  return {
    name,
    set: typeof setValue === "string" ? setValue.trim() : undefined,
    number: typeof card["number"] === "string" ? card["number"].trim() : undefined,
    game: typeof gameValue === "string" ? gameValue.trim().toLowerCase() : undefined,
  };
}

/**
 * Fair bounded scheduler selection. Never-attempted cards come first, then
 * cards whose mapping/quote was refreshed least recently.
 */
export async function selectCardsForScheduledRefresh(
  maxCards: number,
  options: { cardIdPrefix?: string } = {},
): Promise<Array<{ cardId: string; cardData: Record<string, unknown> }>> {
  const result = await db.execute<ScheduledCardRow>(sql`
    WITH eligible AS (
      SELECT card_id, card_data, created_at, 1 AS source_priority FROM collection_items
      UNION ALL
      SELECT card_id, card_data, created_at, 2 AS source_priority
      FROM wishlist_items WHERE deleted_at IS NULL
      UNION ALL
      SELECT card_id, card_data, created_at, 3 AS source_priority FROM sold_archive_items
    ), deduped AS (
      SELECT DISTINCT ON (card_id) card_id, card_data, created_at
      FROM eligible ORDER BY card_id, source_priority, created_at
    ), attempts AS (
      SELECT card_id, MAX(updated_at) AS last_attempt
      FROM card_provider_mappings
      WHERE provider_key = 'pricecharting'
      GROUP BY card_id
    ), quote_refreshes AS (
      SELECT card_id, MAX(fetched_at) AS last_quote
      FROM current_quotes
      WHERE provider_key = 'pricecharting'
      GROUP BY card_id
    )
    SELECT d.card_id, d.card_data
    FROM deduped d
    LEFT JOIN attempts a ON a.card_id = d.card_id
    LEFT JOIN quote_refreshes q ON q.card_id = d.card_id
    WHERE (${options.cardIdPrefix ?? null}::text IS NULL OR d.card_id LIKE ${`${options.cardIdPrefix ?? ""}%`})
    ORDER BY GREATEST(
      COALESCE(a.last_attempt, '-infinity'::timestamptz),
      COALESCE(q.last_quote, '-infinity'::timestamptz)
    ) ASC, d.created_at ASC, d.card_id ASC
    LIMIT ${maxCards}
  `);
  return result.rows.map(row => ({ cardId: row.card_id, cardData: row.card_data }));
}

async function claimRun(bucket: string, trigger: string, maxCards: number, force: boolean): Promise<string | null> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO pricing_scheduler_runs (snapshot_bucket, trigger, max_cards)
    VALUES (${bucket}, ${trigger}, ${maxCards})
    ON CONFLICT (snapshot_bucket) DO UPDATE SET
      trigger = EXCLUDED.trigger,
      status = 'running',
      max_cards = EXCLUDED.max_cards,
      selected_cards = 0,
      identity_failures = 0,
      refresh_succeeded = 0,
      refresh_failed = 0,
      snapshots_captured = 0,
      snapshots_skipped = 0,
      snapshots_failed = 0,
      attempt_count = pricing_scheduler_runs.attempt_count + 1,
      error_message = NULL,
      started_at = NOW(),
      finished_at = NULL,
      updated_at = NOW()
    WHERE ${force}
      OR pricing_scheduler_runs.status = 'failed'
      OR (
        pricing_scheduler_runs.status = 'running'
        AND pricing_scheduler_runs.started_at < NOW() - INTERVAL '2 hours'
      )
    RETURNING id
  `);
  return result.rows[0]?.id ?? null;
}

export async function runScheduledPricingBatch(input: {
  maxCards?: number;
  trigger: "startup" | "interval" | "admin";
  force?: boolean;
  now?: Date;
}): Promise<PricingSchedulerResult> {
  const maxCards = Math.min(Math.max(input.maxCards ?? 50, 1), 200);
  const bucket = snapshotBucketFor(input.now ?? new Date());
  const empty = {
    bucket,
    selectedCards: 0,
    identityFailures: 0,
    refreshSucceeded: 0,
    refreshFailed: 0,
    snapshotsCaptured: 0,
    snapshotsSkipped: 0,
    snapshotsFailed: 0,
  };
  if (!isPCConfigured()) {
    return { ...empty, configured: false, status: "unconfigured" };
  }

  const runId = await claimRun(bucket, input.trigger, maxCards, input.force === true);
  if (!runId) return { ...empty, configured: true, status: "skipped" };

  const startedAt = Date.now();
  try {
    const eligible = await selectCardsForScheduledRefresh(maxCards);
    const verified: Array<{ cardId: string } & PricingIdentity> = [];
    let identityFailures = 0;
    for (const row of eligible) {
      const mapping = await getPricingMappingState(row.cardId);
      const canUsePersistedMapping =
        mapping?.status === "matched" && Boolean(mapping.providerProductId);
      const resolved = canUsePersistedMapping
        ? mapping.identity
        : identityFromCatalogCard(
            (await resolveCatalogCardById(row.cardId).catch(() => null))?.card ?? {},
          );
      if (!resolved) {
        identityFailures += 1;
        await recordSchedulerIdentityFailure(row.cardId);
        continue;
      }
      verified.push({ cardId: row.cardId, ...resolved });
    }

    const refreshes = await Promise.allSettled(
      verified.map(card => refreshPricingForScheduler(card)),
    );
    const snapshots = await captureAllPortfolioSnapshotsDetailed();
    const {
      status,
      refreshSucceeded,
      refreshFailed,
      errorMessage,
    } = summarizeSchedulerOutcome(refreshes, snapshots);
    await db.execute(sql`
      UPDATE pricing_scheduler_runs SET
        status = ${status},
        selected_cards = ${eligible.length},
        identity_failures = ${identityFailures},
        refresh_succeeded = ${refreshSucceeded},
        refresh_failed = ${refreshFailed},
        snapshots_captured = ${snapshots.captured},
        snapshots_skipped = ${snapshots.skipped},
        snapshots_failed = ${snapshots.failed},
        error_message = ${errorMessage},
        finished_at = NOW(),
        updated_at = NOW()
      WHERE id = ${runId}
    `);
    await recordTelemetry({
      category: "job",
      action: "pricing.scheduler",
      status: status === "completed" ? "ok" : "degraded",
      durationMs: Date.now() - startedAt,
      metadata: {
        bucket,
        trigger: input.trigger,
        selectedCards: eligible.length,
        identityFailures,
        refreshSucceeded,
        refreshFailed,
        snapshotsCaptured: snapshots.captured,
        snapshotsSkipped: snapshots.skipped,
        snapshotsFailed: snapshots.failed,
      },
    });
    return {
      bucket,
      configured: true,
      status,
      selectedCards: eligible.length,
      identityFailures,
      refreshSucceeded,
      refreshFailed,
      snapshotsCaptured: snapshots.captured,
      snapshotsSkipped: snapshots.skipped,
      snapshotsFailed: snapshots.failed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown scheduler failure";
    await db.execute(sql`
      UPDATE pricing_scheduler_runs SET
        status = 'failed', error_message = ${message},
        finished_at = NOW(), updated_at = NOW()
      WHERE id = ${runId}
    `).catch(() => {});
    await recordTelemetry({
      category: "job",
      action: "pricing.scheduler",
      status: "failed",
      durationMs: Date.now() - startedAt,
      metadata: { bucket, trigger: input.trigger, failure: "scheduler_run_failed" },
    });
    throw error;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startPricingScheduler(): void {
  if (timer || process.env.NODE_ENV === "test") return;
  const invoke = (trigger: "startup" | "interval") => {
    void runScheduledPricingBatch({ trigger }).catch(error => {
      logger.error({ err: error, trigger }, "Recurring pricing scheduler failed");
    });
  };
  invoke("startup");
  timer = setInterval(() => invoke("interval"), 60 * 60 * 1_000);
  timer.unref();
}