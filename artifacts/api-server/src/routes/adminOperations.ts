import { Router, type Response } from "express";
import {
  adminAuditLogsTable,
  cardProviderMappingsTable,
  collectionItemsTable,
  currentQuotesTable,
  db,
  pricingOverridesTable,
  pricingProvidersTable,
  pricingRefreshJobsTable,
  providerPriceHistoryTable,
  scanAttemptsTable,
  wishlistItemsTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  requireAdminCsrf,
  requireAdminPermission,
  requireAdminSession,
  requireRecentAdminAuth,
  type AdminRequest,
} from "../lib/adminSession";
import { recordAdminAudit } from "../lib/adminAudit";
import { logger } from "../lib/logger";
import { isPCConfigured, PROVIDER_KEY } from "../pricing/pricecharting";
import { refreshPricingExplicit } from "../pricing/service";
import { isValidGradeKey } from "../pricing/grades";

const router = Router();
router.use("/admin", requireAdminSession, requireAdminCsrf);

const JUSTTCG_BASE_URL = "https://api.justtcg.com/v1";
const STALE_QUOTE_CUTOFF_MS = 12 * 60 * 60 * 1000;
const VALID_SCAN_REVIEW_OUTCOMES = new Set([
  "confirmed_match",
  "false_positive",
  "unreadable",
  "catalogue_gap",
  "dismissed",
]);

function pageValue(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

function requiredReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 10 && reason.length <= 500 ? reason : null;
}

function confirmed(body: Record<string, unknown>, phrase: string): boolean {
  return body["confirmed"] === true && body["confirmation"] === phrase;
}

function isSandboxEbayId(value: string): boolean {
  const normalized = value.toUpperCase();
  return normalized.includes("-SBX-") || normalized.includes("SANDBOX");
}

type ProviderStatus =
  | "LIVE"
  | "HEALTHY"
  | "DEGRADED"
  | "RATE LIMITED"
  | "MISCONFIGURED"
  | "NOT CONNECTED";

function priceChartingStatus(
  configured: boolean,
  row: typeof pricingProvidersTable.$inferSelect | undefined,
): ProviderStatus {
  if (!configured) return "NOT CONNECTED";
  if (row && !row.isActive) return "MISCONFIGURED";
  if (!row?.lastHealthyAt && !row?.lastErrorAt) return "LIVE";
  if (
    row.lastErrorAt &&
    (!row.lastHealthyAt || row.lastErrorAt.getTime() > row.lastHealthyAt.getTime())
  ) {
    if (/rate|429|queue is full/i.test(row.lastErrorMessage ?? "")) return "RATE LIMITED";
    return "DEGRADED";
  }
  return "HEALTHY";
}

function providerDescriptor(
  key: string,
  label: string,
  configured: boolean,
  status: ProviderStatus,
  purpose: string,
) {
  return {
    key,
    label,
    purpose,
    configured,
    status,
  };
}

router.get(
  "/admin/catalogue/status",
  requireAdminPermission("catalogue:read"),
  async (_req: AdminRequest, res: Response) => {
    const configured = Boolean(process.env.JUSTTCG_API_KEY);
    res.json({
      source: "JustTCG",
      authority: "external_read_only",
      configured,
      status: configured ? "LIVE" : "NOT CONNECTED",
      writable: false,
      message: configured
        ? "Catalogue records are read live from JustTCG. Verified TCG does not own an editable local catalogue."
        : "JustTCG is not connected. Catalogue browsing and import comparison are unavailable.",
    });
  },
);

router.get(
  "/admin/catalogue/cards",
  requireAdminPermission("catalogue:read"),
  async (req: AdminRequest, res: Response) => {
    const key = process.env.JUSTTCG_API_KEY;
    if (!key) {
      res.status(503).json({ message: "JustTCG is not connected.", code: "PROVIDER_NOT_CONNECTED" });
      return;
    }
    const query = typeof req.query["q"] === "string" ? req.query["q"].trim().slice(0, 120) : "";
    const game = typeof req.query["game"] === "string" ? req.query["game"].trim().slice(0, 80) : "";
    if (!query && !game) {
      res.status(400).json({ message: "Provide a card search or game filter." });
      return;
    }
    const limit = pageValue(req.query["limit"], 25, 100);
    const offset = Math.max(Number(req.query["offset"]) || 0, 0);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(Math.floor(offset)),
      include_price_history: "false",
    });
    if (query) params.set("q", query);
    if (game) params.set("game", game);
    try {
      const providerResponse = await fetch(`${JUSTTCG_BASE_URL}/cards?${params.toString()}`, {
        headers: { "x-api-key": key, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await providerResponse.json().catch(() => ({}))) as Record<string, unknown>;
      if (!providerResponse.ok) {
        req.log.warn({ status: providerResponse.status }, "Admin catalogue provider request failed");
        res.status(502).json({ message: "Catalogue provider request failed." });
        return;
      }
      res.json({ ...body, source: "JustTCG", authority: "external_read_only" });
    } catch (error) {
      req.log.warn({ err: error }, "Admin catalogue provider unavailable");
      res.status(503).json({ message: "Catalogue provider is temporarily unavailable." });
    }
  },
);

router.post(
  "/admin/catalogue/imports/dry-run",
  requireAdminPermission("catalogue:read"),
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const records = Array.isArray(body["records"]) ? body["records"] : null;
    if (!records) {
      res.status(400).json({ message: "records must be a JSON array." });
      return;
    }
    if (records.length > 1_000) {
      res.status(400).json({ message: "A dry run is limited to 1,000 records." });
      return;
    }
    const errors: Array<{ row: number; message: string }> = [];
    const seen = new Set<string>();
    let duplicates = 0;
    records.forEach((record, index) => {
      if (!record || typeof record !== "object") {
        errors.push({ row: index + 1, message: "Record must be an object." });
        return;
      }
      const row = record as Record<string, unknown>;
      const name = typeof row["name"] === "string" ? row["name"].trim() : "";
      const set = typeof (row["set"] ?? row["setName"]) === "string"
        ? String(row["set"] ?? row["setName"]).trim()
        : "";
      const number = typeof row["number"] === "string" ? row["number"].trim() : "";
      if (!name) errors.push({ row: index + 1, message: "name is required." });
      if (!set) errors.push({ row: index + 1, message: "set or setName is required." });
      if (name.length > 200 || set.length > 200 || number.length > 80) {
        errors.push({ row: index + 1, message: "One or more fields exceed safe length limits." });
      }
      const fingerprint = `${name.toLowerCase()}|${set.toLowerCase()}|${number.toLowerCase()}`;
      if (seen.has(fingerprint)) duplicates += 1;
      seen.add(fingerprint);
    });
    res.json({
      dryRun: true,
      format: "json",
      received: records.length,
      valid: Math.max(0, records.length - new Set(errors.map((error) => error.row)).size),
      duplicateRows: duplicates,
      errors: errors.slice(0, 100),
      changes: [],
      canApply: false,
      message:
        "Validated only. The connected catalogue is externally authoritative and read-only, so this import cannot write production data.",
    });
  },
);

router.get(
  "/admin/pricing/providers",
  requireAdminPermission("pricing:read"),
  async (_req: AdminRequest, res: Response) => {
    const rows = await db.select().from(pricingProvidersTable);
    const priceChartingRow = rows.find((row) => row.providerKey === PROVIDER_KEY);
    const pcConfigured = isPCConfigured();
    const ebayId = process.env.EBAY_APP_ID ?? "";
    const providers = [
      {
        ...providerDescriptor(
          "pricecharting",
          "PriceCharting",
          pcConfigured,
          priceChartingStatus(pcConfigured, priceChartingRow),
          "Verified Market quotes",
        ),
        lastHealthyAt: priceChartingRow?.lastHealthyAt?.toISOString() ?? null,
        lastErrorAt: priceChartingRow?.lastErrorAt?.toISOString() ?? null,
        lastResult: priceChartingRow?.lastErrorAt &&
          (!priceChartingRow.lastHealthyAt ||
            priceChartingRow.lastErrorAt > priceChartingRow.lastHealthyAt)
          ? "The most recent provider request failed."
          : null,
      },
      providerDescriptor(
        "justtcg",
        "JustTCG",
        Boolean(process.env.JUSTTCG_API_KEY),
        process.env.JUSTTCG_API_KEY ? "LIVE" : "NOT CONNECTED",
        "External card catalogue",
      ),
      providerDescriptor(
        "ebay",
        "eBay",
        Boolean(ebayId) && !isSandboxEbayId(ebayId),
        !ebayId ? "NOT CONNECTED" : isSandboxEbayId(ebayId) ? "MISCONFIGURED" : "LIVE",
        "Sold-listing price snapshots",
      ),
      providerDescriptor(
        "psa",
        "PSA",
        Boolean(process.env.PSA_API_TOKEN),
        process.env.PSA_API_TOKEN ? "LIVE" : "NOT CONNECTED",
        "Certification lookup",
      ),
      providerDescriptor("cgc", "CGC", false, "NOT CONNECTED", "Future grading provider"),
      providerDescriptor("bgs", "BGS", false, "NOT CONNECTED", "Future grading provider"),
      providerDescriptor("tag", "TAG", false, "NOT CONNECTED", "Future grading provider"),
    ];
    res.json({ providers });
  },
);

router.get(
  "/admin/pricing/overview",
  requireAdminPermission("pricing:read"),
  async (_req: AdminRequest, res: Response) => {
    const cutoff = new Date(Date.now() - STALE_QUOTE_CUTOFF_MS);
    const [mappingRows, quoteRows, jobRows, overrideRows, anomalyRows] = await Promise.all([
      db.execute<{
        total: number;
        matched: number;
        review_required: number;
        unmatched: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
          COUNT(*) FILTER (WHERE status = 'review_required')::int AS review_required,
          COUNT(*) FILTER (WHERE status = 'unmatched')::int AS unmatched
        FROM card_provider_mappings
      `),
      db.execute<{ priced_cards: number; stale_cards: number; latest_quote: Date | null }>(sql`
        SELECT
          COUNT(DISTINCT card_id)::int AS priced_cards,
          COUNT(DISTINCT card_id) FILTER (WHERE fetched_at < ${cutoff})::int AS stale_cards,
          MAX(fetched_at) AS latest_quote
        FROM current_quotes
      `),
      db.execute<{ queued: number; running: number; failed: number }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
          COUNT(*) FILTER (WHERE status = 'running')::int AS running,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM pricing_refresh_jobs
      `),
      db.execute<{ active: number }>(sql`
        SELECT COUNT(*)::int AS active
        FROM pricing_overrides
        WHERE revoked_at IS NULL AND starts_at <= NOW()
          AND (expires_at IS NULL OR expires_at > NOW())
      `),
      db.execute<{
        card_id: string;
        grade_key: string;
        provider_key: string;
        current_price_cents: number;
        previous_price_cents: number;
        currency: string;
        change_percent: number;
        snapshot_date: string;
      }>(sql`
        WITH ranked AS (
          SELECT card_id, grade_key, provider_key, price_cents, currency, snapshot_date,
            ROW_NUMBER() OVER (
              PARTITION BY card_id, grade_key, provider_key ORDER BY snapshot_date DESC
            ) AS position
          FROM provider_price_history
        ),
        paired AS (
          SELECT current.card_id, current.grade_key, current.provider_key,
            current.price_cents AS current_price_cents,
            previous.price_cents AS previous_price_cents,
            current.currency, current.snapshot_date,
            ROUND(((current.price_cents - previous.price_cents)::numeric /
              NULLIF(previous.price_cents, 0)) * 100, 1) AS change_percent
          FROM ranked current
          INNER JOIN ranked previous
            ON previous.card_id = current.card_id
            AND previous.grade_key = current.grade_key
            AND previous.provider_key = current.provider_key
            AND previous.position = 2
          WHERE current.position = 1 AND previous.price_cents > 0
        )
        SELECT * FROM paired
        WHERE change_percent >= 200 OR change_percent <= -70
        ORDER BY ABS(change_percent) DESC
        LIMIT 50
      `),
    ]);
    const mapping = mappingRows.rows[0];
    const quotes = quoteRows.rows[0];
    const jobs = jobRows.rows[0];
    res.json({
      mappings: {
        total: Number(mapping?.total ?? 0),
        matched: Number(mapping?.matched ?? 0),
        reviewRequired: Number(mapping?.review_required ?? 0),
        unmatched: Number(mapping?.unmatched ?? 0),
      },
      quotes: {
        pricedCards: Number(quotes?.priced_cards ?? 0),
        staleCards: Number(quotes?.stale_cards ?? 0),
        latestQuoteAt: quotes?.latest_quote
          ? new Date(quotes.latest_quote).toISOString()
          : null,
        staleAfterHours: 12,
      },
      refreshWork: {
        queued: Number(jobs?.queued ?? 0),
        running: Number(jobs?.running ?? 0),
        failed: Number(jobs?.failed ?? 0),
      },
      activeOverrides: Number(overrideRows.rows[0]?.active ?? 0),
      anomalies: anomalyRows.rows.map((row) => ({
        cardId: row.card_id,
        gradeKey: row.grade_key,
        providerKey: row.provider_key,
        currentPriceCents: Number(row.current_price_cents),
        previousPriceCents: Number(row.previous_price_cents),
        currency: row.currency,
        changePercent: Number(row.change_percent),
        snapshotDate: row.snapshot_date,
      })),
    });
  },
);

router.get(
  "/admin/pricing/mappings",
  requireAdminPermission("pricing:read"),
  async (req: AdminRequest, res: Response) => {
    const page = pageValue(req.query["page"], 1, 1_000_000);
    const limit = pageValue(req.query["limit"], 25, 100);
    const offset = (page - 1) * limit;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : "";
    const query = typeof req.query["q"] === "string" ? req.query["q"].trim().slice(0, 120) : "";
    const conditions = [];
    if (["matched", "review_required", "unmatched"].includes(status)) {
      conditions.push(eq(cardProviderMappingsTable.status, status));
    }
    if (query) {
      conditions.push(
        or(
          ilike(cardProviderMappingsTable.cardId, `%${query}%`),
          ilike(cardProviderMappingsTable.matchedName, `%${query}%`),
          ilike(cardProviderMappingsTable.providerProductName, `%${query}%`),
        )!,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [[totalRow], rows] = await Promise.all([
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(cardProviderMappingsTable)
        .where(where),
      db
        .select()
        .from(cardProviderMappingsTable)
        .where(where)
        .orderBy(desc(cardProviderMappingsTable.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);
    res.json({
      mappings: rows,
      total: Number(totalRow?.total ?? 0),
      page,
      limit,
    });
  },
);

router.get(
  "/admin/pricing/history/:cardId",
  requireAdminPermission("pricing:read"),
  async (req: AdminRequest, res: Response) => {
    const cardId = String(req.params["cardId"] ?? "").trim().slice(0, 300);
    const gradeKey =
      typeof req.query["gradeKey"] === "string" ? req.query["gradeKey"].trim() : "";
    const limit = pageValue(req.query["limit"], 100, 500);
    if (!cardId) {
      res.status(400).json({ message: "Card ID is required." });
      return;
    }
    const historyConditions = [eq(providerPriceHistoryTable.cardId, cardId)];
    const overrideConditions = [eq(pricingOverridesTable.cardId, cardId)];
    if (gradeKey) {
      historyConditions.push(eq(providerPriceHistoryTable.gradeKey, gradeKey));
      overrideConditions.push(eq(pricingOverridesTable.gradeKey, gradeKey));
    }
    const [history, overrides] = await Promise.all([
      db
        .select()
        .from(providerPriceHistoryTable)
        .where(and(...historyConditions))
        .orderBy(desc(providerPriceHistoryTable.snapshotDate))
        .limit(limit),
      db
        .select()
        .from(pricingOverridesTable)
        .where(and(...overrideConditions))
        .orderBy(desc(pricingOverridesTable.createdAt))
        .limit(100),
    ]);
    res.json({
      cardId,
      history,
      overrides,
      provenance: "provider_price_history",
      incomplete: history.length === limit,
    });
  },
);

router.get(
  "/admin/pricing/overrides",
  requireAdminPermission("pricing:read"),
  async (req: AdminRequest, res: Response) => {
    const activeOnly = String(req.query["activeOnly"] ?? "true") !== "false";
    const conditions = activeOnly
      ? [
          isNull(pricingOverridesTable.revokedAt),
          lte(pricingOverridesTable.startsAt, new Date()),
          or(
            isNull(pricingOverridesTable.expiresAt),
            gte(pricingOverridesTable.expiresAt, new Date()),
          )!,
        ]
      : [];
    const rows = await db
      .select()
      .from(pricingOverridesTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pricingOverridesTable.createdAt))
      .limit(100);
    res.json({ overrides: rows, activeOnly });
  },
);

router.post(
  "/admin/pricing/mappings/:mappingId/review",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    const outcome = body["outcome"];
    if (!reason || !["approve", "reject"].includes(String(outcome))) {
      res.status(400).json({ message: "A valid outcome and reason of 10–500 characters are required." });
      return;
    }
    if (!confirmed(body, "REVIEW MAPPING")) {
      res.status(400).json({ message: "Confirm this decision with REVIEW MAPPING." });
      return;
    }
    const nextStatus = outcome === "approve" ? "matched" : "unmatched";
    // Row read, validation, mutation, and audit happen inside one transaction
    // with a FOR UPDATE lock to prevent concurrent reviewers from producing
    // split-brain audit records.
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(cardProviderMappingsTable)
        .where(eq(cardProviderMappingsTable.id, String(req.params["mappingId"])))
        .for("update")
        .limit(1);
      if (!existing) return { status: 404 as const, message: "Mapping not found." };
      // Reject if the mapping has already been admin-reviewed. This covers both
      // the sequential case and the concurrent-race case where the loser of a
      // FOR UPDATE race reads the winner's committed state.
      const alreadyReviewed = !!(existing.matchMetadata as Record<string, unknown> | null)?.["adminReview"];
      if (alreadyReviewed) {
        return { status: 409 as const, message: "This mapping has already been reviewed. Reload to see the current decision." };
      }
      if (outcome === "approve" && !existing.providerProductId) {
        return { status: 400 as const, message: "A mapping without a provider product ID cannot be approved." };
      }
      // Conditional update: target must still be in its pre-review status to
      // guard against the narrow window of concurrent entry before either commits.
      const [row] = await tx
        .update(cardProviderMappingsTable)
        .set({
          status: nextStatus,
          matchMetadata: {
            ...((existing.matchMetadata as Record<string, unknown> | null) ?? {}),
            adminReview: { outcome, reason, reviewedAt: new Date().toISOString() },
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cardProviderMappingsTable.id, existing.id),
            // Cast: schema uses `as ReturnType<typeof text>` which loses notNull;
            // status is always a non-null string at runtime.
            eq(cardProviderMappingsTable.status, existing.status as string),
          ),
        )
        .returning();
      if (!row) {
        return { status: 409 as const, message: "Another reviewer modified this mapping concurrently. Reload and try again." };
      }
      await recordAdminAudit(
        req,
        {
          action: `pricing.mapping.${String(outcome)}`,
          resourceType: "pricing_mapping",
          resourceId: existing.id,
          reason,
          beforeState: { status: existing.status, providerProductId: existing.providerProductId },
          afterState: { status: row.status, providerProductId: row.providerProductId },
        },
        tx,
      );
      return { status: 200 as const, mapping: row };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.json({ mapping: result.mapping });
  },
);

async function runRefreshJob(jobId: string): Promise<void> {
  // Atomically claim the job. If the job is no longer queued (e.g. cancelled,
  // or another worker beat us in the startup recovery race) this is a no-op.
  const [job] = await db
    .update(pricingRefreshJobsTable)
    .set({ status: "running", startedAt: new Date(), attemptCount: 1, updatedAt: new Date() })
    .where(and(eq(pricingRefreshJobsTable.id, jobId), eq(pricingRefreshJobsTable.status, "queued")))
    .returning();
  if (!job) return;
  try {
    const [mapping] = await db
      .select()
      .from(cardProviderMappingsTable)
      .where(
        and(
          eq(cardProviderMappingsTable.cardId, job.cardId),
          eq(cardProviderMappingsTable.providerKey, job.providerKey),
        ),
      )
      .limit(1);
    if (!mapping?.providerProductId) {
      throw new Error("No persisted provider product ID — cannot contact provider");
    }
    // Use the explicit refresh path: contacts the provider unconditionally with
    // bypassCache, awaits quote + history persistence, and propagates failures.
    // This ensures the job is only marked succeeded after real data is persisted.
    const result = await refreshPricingExplicit(job.cardId, mapping.providerProductId);
    if (result.status === "failed") {
      throw new Error(result.error);
    }
    await db
      .update(pricingRefreshJobsTable)
      .set({ status: "succeeded", finishedAt: new Date(), errorMessage: null, updatedAt: new Date() })
      .where(eq(pricingRefreshJobsTable.id, job.id));
  } catch (error) {
    await db
      .update(pricingRefreshJobsTable)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : "Refresh failed",
        updatedAt: new Date(),
      })
      .where(eq(pricingRefreshJobsTable.id, job.id));
  }
}

/**
 * On server startup, recover pricing refresh jobs that did not finish:
 *
 * 1. `running` jobs whose process was killed mid-flight are reset to `queued`
 *    so they are re-attempted.  A job is considered stale if it has been in
 *    `running` for more than 30 minutes (generous, to exclude very slow refreshes
 *    on a live server).
 *
 * 2. `queued` jobs (never started) are dispatched immediately.
 *
 * Each actual refresh claim is atomic (UPDATE WHERE status = 'queued'), so
 * concurrent calls or rapid restarts are safe.
 */
export async function recoverQueuedRefreshJobs(): Promise<void> {
  const STALE_RUNNING_CUTOFF_MS = 30 * 60 * 1000;
  const cutoff = new Date(Date.now() - STALE_RUNNING_CUTOFF_MS);

  // Reset stale `running` jobs back to `queued` so they can be re-dispatched below.
  const reset = await db
    .update(pricingRefreshJobsTable)
    .set({ status: "queued", startedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(pricingRefreshJobsTable.status, "running"),
        lt(pricingRefreshJobsTable.startedAt, cutoff),
      ),
    )
    .returning({ id: pricingRefreshJobsTable.id });
  if (reset.length > 0) {
    logger.info({ count: reset.length }, "Reset stale running refresh jobs back to queued");
  }

  const queued = await db
    .select({ id: pricingRefreshJobsTable.id })
    .from(pricingRefreshJobsTable)
    .where(eq(pricingRefreshJobsTable.status, "queued"));
  if (queued.length === 0) return;
  logger.info({ count: queued.length }, "Recovering queued pricing refresh jobs");
  for (const job of queued) {
    void runRefreshJob(job.id);
  }
}

router.get(
  "/admin/pricing/refresh-jobs",
  requireAdminPermission("pricing:read"),
  async (req: AdminRequest, res: Response) => {
    const limit = pageValue(req.query["limit"], 50, 100);
    const rows = await db
      .select()
      .from(pricingRefreshJobsTable)
      .orderBy(desc(pricingRefreshJobsTable.createdAt))
      .limit(limit);
    res.json({ jobs: rows });
  },
);

router.post(
  "/admin/pricing/refresh-jobs",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    const cardIds = Array.isArray(body["cardIds"])
      ? [...new Set(body["cardIds"].filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
      : [];
    if (!reason || cardIds.length === 0 || cardIds.length > 50) {
      res.status(400).json({ message: "Provide 1–50 card IDs and a reason of 10–500 characters." });
      return;
    }
    const mappings = await db
      .select()
      .from(cardProviderMappingsTable)
      .where(
        and(
          inArray(cardProviderMappingsTable.cardId, cardIds),
          eq(cardProviderMappingsTable.providerKey, PROVIDER_KEY),
        ),
      );
    const eligible = mappings.filter(
      (mapping) => mapping.status === "matched" && mapping.providerProductId && mapping.matchedName,
    );
    const preview = {
      requested: cardIds.length,
      eligible: eligible.map((mapping) => mapping.cardId),
      skipped: cardIds.filter((cardId) => !eligible.some((mapping) => mapping.cardId === cardId)),
      providerConfigured: isPCConfigured(),
    };
    if (body["dryRun"] === true) {
      res.json({ dryRun: true, ...preview });
      return;
    }
    if (!isPCConfigured()) {
      res.status(409).json({ message: "PriceCharting is not connected.", preview });
      return;
    }
    if (!confirmed(body, "QUEUE REFRESH")) {
      res.status(400).json({ message: "Run a dry run, then confirm with QUEUE REFRESH." });
      return;
    }
    // Insert jobs + write the batch audit record atomically so a failed audit
    // insert cannot leave queued work without a paper trail.
    const created = await db.transaction(async (tx) => {
      const jobs: Array<typeof pricingRefreshJobsTable.$inferSelect> = [];
      for (const mapping of eligible) {
        // The partial unique index (active_card_provider_uniq) enforces at most one
        // queued/running job per card+provider atomically. ON CONFLICT DO NOTHING
        // means concurrent requests silently skip duplicates without a separate
        // SELECT round-trip, eliminating the TOCTOU race.
        const [job] = await tx
          .insert(pricingRefreshJobsTable)
          .values({
            cardId: mapping.cardId,
            providerKey: PROVIDER_KEY,
            requestedByAdminId: req.admin!.id,
            reason,
          })
          .onConflictDoNothing()
          .returning();
        if (job) jobs.push(job);
      }
      await recordAdminAudit(
        req,
        {
          action: "pricing.refresh.queue",
          resourceType: "pricing_refresh_batch",
          reason,
          afterState: { jobIds: jobs.map((j) => j.id), cardIds: jobs.map((j) => j.cardId) },
        },
        tx,
      );
      return jobs;
    });
    // Fire-and-forget refresh jobs outside the transaction so a transient
    // processing failure doesn't roll back the queued records.
    created.forEach((job) => void runRefreshJob(job.id));
    res.status(202).json({ ...preview, queued: created.length, jobs: created });
  },
);

router.post(
  "/admin/pricing/refresh-jobs/:jobId/cancel",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    if (!reason || !confirmed(body, "CANCEL REFRESH")) {
      res.status(400).json({ message: "A reason and CANCEL REFRESH confirmation are required." });
      return;
    }
    const job = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(pricingRefreshJobsTable)
        .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pricingRefreshJobsTable.id, String(req.params["jobId"])),
            eq(pricingRefreshJobsTable.status, "queued"),
          ),
        )
        .returning();
      if (!row) return null;
      await recordAdminAudit(
        req,
        {
          action: "pricing.refresh.cancel",
          resourceType: "pricing_refresh_job",
          resourceId: row.id,
          reason,
          beforeState: { status: "queued" },
          afterState: { status: "cancelled" },
        },
        tx,
      );
      return row;
    });
    if (!job) {
      res.status(409).json({ message: "Only queued refresh work can be cancelled." });
      return;
    }
    res.json({ job });
  },
);

router.post(
  "/admin/pricing/overrides",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cardId = typeof body["cardId"] === "string" ? body["cardId"].trim().slice(0, 300) : "";
    const gradeKey = typeof body["gradeKey"] === "string" ? body["gradeKey"].trim() : "";
    const priceCents = Number(body["priceCents"]);
    const currency = typeof body["currency"] === "string" ? body["currency"].trim().toUpperCase() : "";
    const reason = requiredReason(body["reason"]);
    const expiresAt = typeof body["expiresAt"] === "string" && body["expiresAt"]
      ? new Date(body["expiresAt"])
      : null;
    if (
      !cardId ||
      !isValidGradeKey(gradeKey) ||
      !Number.isSafeInteger(priceCents) ||
      priceCents <= 0 ||
      !/^[A-Z]{3}$/.test(currency) ||
      !reason ||
      (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()))
    ) {
      res.status(400).json({ message: "Invalid override input. Price must be positive, currency valid, and reason 10–500 characters." });
      return;
    }
    const [quote] = await db
      .select()
      .from(currentQuotesTable)
      .where(
        and(
          eq(currentQuotesTable.cardId, cardId),
          eq(currentQuotesTable.gradeKey, gradeKey),
        ),
      )
      .orderBy(desc(currentQuotesTable.fetchedAt))
      .limit(1);
    const preview = {
      cardId,
      gradeKey,
      override: { priceCents, currency, expiresAt: expiresAt?.toISOString() ?? null },
      providerQuote: quote
        ? { priceCents: quote.priceCents, currency: quote.currency, fetchedAt: quote.fetchedAt.toISOString() }
        : null,
      providerPricingRetained: true,
    };
    if (body["dryRun"] === true) {
      res.json({ dryRun: true, ...preview });
      return;
    }
    if (!confirmed(body, "APPLY OVERRIDE")) {
      res.status(400).json({ message: "Run a dry run, then confirm with APPLY OVERRIDE." });
      return;
    }
    const override = await db.transaction(async (tx) => {
      await tx
        .update(pricingOverridesTable)
        .set({
          revokedAt: new Date(),
          revokedByAdminId: req.admin!.id,
          revokeReason: "Superseded by a newer override",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pricingOverridesTable.cardId, cardId),
            eq(pricingOverridesTable.gradeKey, gradeKey),
            isNull(pricingOverridesTable.revokedAt),
          ),
        );
      const [created] = await tx
        .insert(pricingOverridesTable)
        .values({
          cardId,
          gradeKey,
          priceCents,
          currency,
          originalPriceCents: quote?.priceCents ?? null,
          originalCurrency: quote?.currency ?? null,
          reason,
          expiresAt,
          createdByAdminId: req.admin!.id,
        })
        .returning();
      // Audit inside the transaction so a failed audit rolls back the override.
      await recordAdminAudit(
        req,
        {
          action: "pricing.override.apply",
          resourceType: "pricing_override",
          resourceId: created!.id,
          reason,
          beforeState: preview.providerQuote,
          afterState: { priceCents, currency, expiresAt: expiresAt?.toISOString() ?? null },
        },
        tx,
      );
      return created!;
    });
    res.status(201).json({ override, providerPricingRetained: true });
  },
);

router.post(
  "/admin/pricing/overrides/:overrideId/revoke",
  requireAdminPermission("pricing:manage"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    if (!reason || !confirmed(body, "REVOKE OVERRIDE")) {
      res.status(400).json({ message: "A reason and REVOKE OVERRIDE confirmation are required." });
      return;
    }
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(pricingOverridesTable)
        .set({
          revokedAt: new Date(),
          revokedByAdminId: req.admin!.id,
          revokeReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pricingOverridesTable.id, String(req.params["overrideId"])),
            isNull(pricingOverridesTable.revokedAt),
          ),
        )
        .returning();
      if (!row) return null;
      await recordAdminAudit(
        req,
        {
          action: "pricing.override.revoke",
          resourceType: "pricing_override",
          resourceId: row.id,
          reason,
          beforeState: { priceCents: row.priceCents, currency: row.currency },
          afterState: { revokedAt: row.revokedAt?.toISOString() ?? null },
        },
        tx,
      );
      return row;
    });
    if (!updated) {
      res.status(404).json({ message: "Active override not found." });
      return;
    }
    res.json({ override: updated });
  },
);

router.get(
  "/admin/scanner/overview",
  requireAdminPermission("scanner:read"),
  async (req: AdminRequest, res: Response) => {
    const days = pageValue(req.query["days"], 30, 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [summary, buckets, failures] = await Promise.all([
      db.execute<{
        attempts: number;
        matched: number;
        failed: number;
        low_confidence: number;
        unmatched: number;
        unreadable: number;
        average_confidence: number | null;
        average_duration_ms: number | null;
        unique_users: number;
        pending_review: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS attempts,
          COUNT(*) FILTER (WHERE status = 'matched')::int AS matched,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'low_confidence')::int AS low_confidence,
          COUNT(*) FILTER (WHERE status = 'unmatched')::int AS unmatched,
          COUNT(*) FILTER (WHERE status = 'unreadable')::int AS unreadable,
          ROUND(AVG(top_match_confidence), 1) AS average_confidence,
          ROUND(AVG(duration_ms), 0) AS average_duration_ms,
          COUNT(DISTINCT user_id)::int AS unique_users,
          COUNT(*) FILTER (
            WHERE review_status = 'pending'
              AND status IN ('failed', 'low_confidence', 'unmatched', 'unreadable')
          )::int AS pending_review
        FROM scan_attempts
        WHERE created_at >= ${since}
      `),
      db.execute<{ bucket: string; count: number }>(sql`
        SELECT CASE
          WHEN top_match_confidence >= 95 THEN '95-100'
          WHEN top_match_confidence >= 90 THEN '90-94'
          WHEN top_match_confidence >= 80 THEN '80-89'
          WHEN top_match_confidence >= 70 THEN '70-79'
          ELSE 'below-70'
        END AS bucket, COUNT(*)::int AS count
        FROM scan_attempts
        WHERE created_at >= ${since} AND top_match_confidence IS NOT NULL
        GROUP BY bucket
      `),
      db.execute<{ status: string; count: number }>(sql`
        SELECT status, COUNT(*)::int AS count
        FROM scan_attempts
        WHERE created_at >= ${since}
        GROUP BY status
        ORDER BY count DESC
      `),
    ]);
    const row = summary.rows[0];
    const attempts = Number(row?.attempts ?? 0);
    const successful = Number(row?.matched ?? 0);
    res.json({
      periodDays: days,
      attempts,
      successful,
      successRate: attempts > 0 ? Math.round((successful / attempts) * 1000) / 10 : null,
      failed: Number(row?.failed ?? 0),
      lowConfidence: Number(row?.low_confidence ?? 0),
      unmatched: Number(row?.unmatched ?? 0),
      unreadable: Number(row?.unreadable ?? 0),
      averageConfidence: row?.average_confidence == null ? null : Number(row.average_confidence),
      averageDurationMs: row?.average_duration_ms == null ? null : Number(row.average_duration_ms),
      uniqueUsers: Number(row?.unique_users ?? 0),
      pendingReview: Number(row?.pending_review ?? 0),
      confidenceBuckets: buckets.rows.map((bucket) => ({
        bucket: bucket.bucket,
        count: Number(bucket.count),
      })),
      outcomes: failures.rows.map((outcome) => ({
        status: outcome.status,
        count: Number(outcome.count),
      })),
      imageRetention: "not_stored",
    });
  },
);

router.get(
  "/admin/scanner/attempts",
  requireAdminPermission("scanner:read"),
  async (req: AdminRequest, res: Response) => {
    const page = pageValue(req.query["page"], 1, 1_000_000);
    const limit = pageValue(req.query["limit"], 25, 100);
    const status = typeof req.query["status"] === "string" ? req.query["status"] : "";
    const reviewStatus =
      typeof req.query["reviewStatus"] === "string" ? req.query["reviewStatus"] : "pending";
    const conditions = [];
    if (status) conditions.push(eq(scanAttemptsTable.status, status));
    if (reviewStatus) conditions.push(eq(scanAttemptsTable.reviewStatus, reviewStatus));
    const where = conditions.length ? and(...conditions) : undefined;
    const [[total], attempts] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(scanAttemptsTable)
        .where(where),
      db
        .select({
          id: scanAttemptsTable.id,
          status: scanAttemptsTable.status,
          extractedName: scanAttemptsTable.extractedName,
          extractedSet: scanAttemptsTable.extractedSet,
          extractedNumber: scanAttemptsTable.extractedNumber,
          topMatchCardId: scanAttemptsTable.topMatchCardId,
          topMatchName: scanAttemptsTable.topMatchName,
          topMatchConfidence: scanAttemptsTable.topMatchConfidence,
          candidateSummary: scanAttemptsTable.candidateSummary,
          model: scanAttemptsTable.model,
          durationMs: scanAttemptsTable.durationMs,
          errorCode: scanAttemptsTable.errorCode,
          reviewStatus: scanAttemptsTable.reviewStatus,
          reviewOutcome: scanAttemptsTable.reviewOutcome,
          reviewReason: scanAttemptsTable.reviewReason,
          reviewedAt: scanAttemptsTable.reviewedAt,
          createdAt: scanAttemptsTable.createdAt,
        })
        .from(scanAttemptsTable)
        .where(where)
        .orderBy(desc(scanAttemptsTable.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);
    res.json({
      attempts,
      total: Number(total?.count ?? 0),
      page,
      limit,
      imageRetention: "not_stored",
      reprocessingAvailable: false,
      reprocessingMessage:
        "Source photos are not retained, so server-side reprocessing is intentionally unavailable.",
    });
  },
);

router.post(
  "/admin/scanner/attempts/:attemptId/review",
  requireAdminPermission("scanner:review"),
  requireRecentAdminAuth,
  async (req: AdminRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = requiredReason(body["reason"]);
    const outcome = typeof body["outcome"] === "string" ? body["outcome"] : "";
    if (
      !reason ||
      !VALID_SCAN_REVIEW_OUTCOMES.has(outcome) ||
      !confirmed(body, "REVIEW SCAN")
    ) {
      res.status(400).json({ message: "A valid outcome, reason, and REVIEW SCAN confirmation are required." });
      return;
    }
    // Row read, validation, mutation, and audit happen inside one transaction
    // with a FOR UPDATE lock so concurrent reviewers produce exactly one
    // accepted outcome and one audit entry; the loser receives 409.
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(scanAttemptsTable)
        .where(eq(scanAttemptsTable.id, String(req.params["attemptId"])))
        .for("update")
        .limit(1);
      if (!existing) return { status: 404 as const, message: "Scan attempt not found." };
      // Reject if the attempt is already reviewed — covers both the sequential
      // case (a second reviewer submits after seeing the result) and the race
      // case (the loser of a concurrent race sees the winner's committed state).
      if (existing.reviewStatus !== "pending") {
        return { status: 409 as const, message: "This scan attempt has already been reviewed. Reload to see the current decision." };
      }
      // Conditional update guards against the narrow concurrent window where
      // two reviewers both entered the transaction before either committed.
      const [row] = await tx
        .update(scanAttemptsTable)
        .set({
          reviewStatus: "reviewed",
          reviewOutcome: outcome,
          reviewReason: reason,
          reviewedByAdminId: req.admin!.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(scanAttemptsTable.id, existing.id),
            eq(scanAttemptsTable.reviewStatus, "pending"),
          ),
        )
        .returning();
      if (!row) {
        return { status: 409 as const, message: "Another reviewer submitted a decision concurrently. Reload and try again." };
      }
      await recordAdminAudit(
        req,
        {
          action: "scanner.attempt.review",
          resourceType: "scan_attempt",
          resourceId: existing.id,
          reason,
          beforeState: { reviewStatus: existing.reviewStatus, status: existing.status },
          afterState: { reviewStatus: "reviewed", reviewOutcome: outcome },
        },
        tx,
      );
      return { status: 200 as const, attempt: row };
    });
    if (result.status !== 200) {
      res.status(result.status).json({ message: result.message });
      return;
    }
    res.json({ attempt: result.attempt });
  },
);

router.get(
  "/admin/collections/overview",
  requireAdminPermission("collections:read"),
  async (_req: AdminRequest, res: Response) => {
    const [collectionRows, wishlistRows, topCollected, topWishlisted, qualityRows] =
      await Promise.all([
        db.execute<{
          entries: number;
          quantity: number;
          unique_cards: number;
          collectors: number;
          graded_entries: number;
          for_sale: number;
          for_trade: number;
          priced_entries: number;
          tracked_value_cents: number;
        }>(sql`
          SELECT
            COUNT(*)::int AS entries,
            COALESCE(SUM(ci.quantity), 0)::int AS quantity,
            COUNT(DISTINCT ci.card_id)::int AS unique_cards,
            COUNT(DISTINCT ci.user_id)::int AS collectors,
            COUNT(*) FILTER (WHERE ci.is_graded)::int AS graded_entries,
            COUNT(*) FILTER (WHERE ci.is_for_sale)::int AS for_sale,
            COUNT(*) FILTER (WHERE ci.is_for_trade)::int AS for_trade,
            COUNT(*) FILTER (WHERE quote.price_cents IS NOT NULL)::int AS priced_entries,
            COALESCE(SUM(quote.price_cents * ci.quantity), 0)::bigint AS tracked_value_cents
          FROM collection_items ci
          LEFT JOIN LATERAL (
            SELECT price_cents
            FROM current_quotes cq
            WHERE cq.card_id = ci.card_id AND cq.provider_key = 'pricecharting'
            ORDER BY
              CASE WHEN cq.grade_key = 'raw' THEN 0 ELSE 1 END,
              cq.fetched_at DESC
            LIMIT 1
          ) quote ON TRUE
        `),
        db.execute<{
          active: number;
          unique_cards: number;
          collectors: number;
          alerts: number;
          missing_price: number;
        }>(sql`
          SELECT
            COUNT(*)::int AS active,
            COUNT(DISTINCT wi.card_id)::int AS unique_cards,
            COUNT(DISTINCT wi.user_id)::int AS collectors,
            COUNT(*) FILTER (WHERE wi.price_alert_enabled)::int AS alerts,
            COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM current_quotes cq
                WHERE cq.card_id = wi.card_id AND cq.provider_key = 'pricecharting'
              )
            )::int AS missing_price
          FROM wishlist_items wi
          WHERE wi.deleted_at IS NULL
        `),
        db.execute<{ card_id: string; card_name: string; quantity: number; collectors: number }>(sql`
          SELECT
            card_id,
            COALESCE(MAX(card_data->>'name'), card_id) AS card_name,
            SUM(quantity)::int AS quantity,
            COUNT(DISTINCT user_id)::int AS collectors
          FROM collection_items
          GROUP BY card_id
          ORDER BY SUM(quantity) DESC
          LIMIT 10
        `),
        db.execute<{ card_id: string; card_name: string; wishlists: number }>(sql`
          SELECT
            card_id,
            COALESCE(MAX(card_data->>'name'), card_id) AS card_name,
            COUNT(*)::int AS wishlists
          FROM wishlist_items
          WHERE deleted_at IS NULL
          GROUP BY card_id
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `),
        db.execute<{
          invalid_quantity: number;
          invalid_currency: number;
          missing_pricing: number;
          stale_pricing: number;
          wishlist_missing_pricing: number;
        }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE ci.quantity < 1)::int AS invalid_quantity,
            COUNT(*) FILTER (WHERE ci.acquired_currency !~ '^[A-Z]{3}$')::int AS invalid_currency,
            COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM current_quotes cq
                WHERE cq.card_id = ci.card_id AND cq.provider_key = 'pricecharting'
              )
            )::int AS missing_pricing,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM current_quotes cq
                WHERE cq.card_id = ci.card_id
                  AND cq.provider_key = 'pricecharting'
                  AND cq.fetched_at < ${new Date(Date.now() - STALE_QUOTE_CUTOFF_MS)}
              )
            )::int AS stale_pricing,
            (SELECT COUNT(*)::int FROM wishlist_items wi
              WHERE wi.deleted_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM current_quotes cq
                WHERE cq.card_id = wi.card_id AND cq.provider_key = 'pricecharting'
              )
            ) AS wishlist_missing_pricing
          FROM collection_items ci
        `),
      ]);
    const collection = collectionRows.rows[0];
    const wishlist = wishlistRows.rows[0];
    const entries = Number(collection?.entries ?? 0);
    const pricedEntries = Number(collection?.priced_entries ?? 0);
    res.json({
      collection: {
        entries,
        totalQuantity: Number(collection?.quantity ?? 0),
        uniqueCards: Number(collection?.unique_cards ?? 0),
        collectors: Number(collection?.collectors ?? 0),
        gradedEntries: Number(collection?.graded_entries ?? 0),
        forSale: Number(collection?.for_sale ?? 0),
        forTrade: Number(collection?.for_trade ?? 0),
        pricedEntries,
        pricingCoveragePercent:
          entries > 0 ? Math.round((pricedEntries / entries) * 1000) / 10 : null,
        trackedValue:
          pricedEntries > 0
            ? {
                valueCents: Number(collection?.tracked_value_cents ?? 0),
                currency: "USD",
                coverageIncomplete: pricedEntries < entries,
              }
            : null,
      },
      wishlist: {
        activeItems: Number(wishlist?.active ?? 0),
        uniqueCards: Number(wishlist?.unique_cards ?? 0),
        collectors: Number(wishlist?.collectors ?? 0),
        priceAlerts: Number(wishlist?.alerts ?? 0),
        missingPricing: Number(wishlist?.missing_price ?? 0),
      },
      topCollected: topCollected.rows.map((row) => ({
        cardId: row.card_id,
        cardName: row.card_name,
        quantity: Number(row.quantity),
        collectors: Number(row.collectors),
      })),
      topWishlisted: topWishlisted.rows.map((row) => ({
        cardId: row.card_id,
        cardName: row.card_name,
        wishlists: Number(row.wishlists),
      })),
      quality: {
        invalidQuantity: Number(qualityRows.rows[0]?.invalid_quantity ?? 0),
        invalidCurrency: Number(qualityRows.rows[0]?.invalid_currency ?? 0),
        missingPricing: Number(qualityRows.rows[0]?.missing_pricing ?? 0),
        stalePricing: Number(qualityRows.rows[0]?.stale_pricing ?? 0),
        wishlistMissingPricing: Number(
          qualityRows.rows[0]?.wishlist_missing_pricing ?? 0,
        ),
        automaticPrivateDataRepairAvailable: false,
      },
      privacy: {
        collectorIdentitiesIncluded: false,
        note: "This view contains aggregate operational data only.",
      },
    });
  },
);

router.get(
  "/admin/audit",
  requireAdminPermission("audit:read"),
  async (req: AdminRequest, res: Response) => {
    const page = pageValue(req.query["page"], 1, 1_000_000);
    const limit = pageValue(req.query["limit"], 50, 100);
    const resourceType =
      typeof req.query["resourceType"] === "string" ? req.query["resourceType"].trim() : "";
    const rows = await db
      .select()
      .from(adminAuditLogsTable)
      .where(resourceType ? eq(adminAuditLogsTable.resourceType, resourceType) : undefined)
      .orderBy(desc(adminAuditLogsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    res.json({
      events: rows.map((row) => ({
        id: row.id,
        actorEmail: row.actorEmail,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        reason: row.reason,
        beforeState: row.beforeState,
        afterState: row.afterState,
        createdAt: row.createdAt,
      })),
      page,
      limit,
    });
  },
);

export default router;