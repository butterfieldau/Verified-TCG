import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import {
  catalogueCacheEntriesTable,
  catalogueCardVariantsTable,
  catalogueExternalIdsTable,
  catalogueImportJobsTable,
  createDatabasePool,
  db,
} from "@workspace/db";
import {
  createCatalogueImportJob,
  findCandidateCards,
  findCardByExternalId,
  findCatalogueProvenance,
  findSetByExternalId,
  findSetByGameSlug,
  getGameBySlug,
  recordCatalogueImportError,
  recordCatalogueProvenance,
  updateCanonicalCard,
  updateCatalogueImportJob,
  upsertCanonicalCard,
  upsertCanonicalGame,
  upsertCanonicalSet,
  upsertCardVariant,
  upsertCatalogueAlias,
  upsertCatalogueImage,
  upsertExternalIdentity,
} from "./catalogueRepository.js";
import type {
  CatalogueImportRepository,
  CatalogueImportSourceRecord,
  CatalogueEntityType,
} from "./catalogueSync.js";
import {
  normalizeCollectorNumber,
  normalizeForMatching,
} from "./catalogueNormalisation.js";
import { normalizeJustTcgCard } from "./justTcgCanonicalAdapter.js";

const CACHE_PAGE_SIZE = 100;

function providerCards(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body))
    return body.filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object",
    );
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object",
      )
    : [];
}

/**
 * Streams the durable, already-observed JustTCG card cache. It intentionally
 * does not call the provider, so initial backfills consume no additional API
 * budget. Duplicate cards found in several search-cache documents are safe:
 * reconciliation is external-ID idempotent.
 */
export async function* cachedJustTcgCards(
  input: {
    updatedAfter?: Date | null;
    setExternalId?: string | null;
    cardExternalId?: string | null;
    maxCacheEntries?: number;
    afterCursor?: string | null;
  } = {},
): AsyncGenerator<CatalogueImportSourceRecord> {
  const separator = input.afterCursor?.lastIndexOf(":") ?? -1;
  const afterCacheKey =
    separator > 0 ? input.afterCursor!.slice(0, separator) : null;
  const afterCardIndex =
    separator > 0 ? Number(input.afterCursor!.slice(separator + 1)) : -1;
  let offset = 0;
  let readEntries = 0;
  while (
    input.maxCacheEntries === undefined ||
    readEntries < input.maxCacheEntries
  ) {
    const conditions = [eq(catalogueCacheEntriesTable.resource, "cards")];
    if (input.updatedAfter)
      conditions.push(
        gt(catalogueCacheEntriesTable.updatedAt, input.updatedAfter),
      );
    if (afterCacheKey)
      conditions.push(gte(catalogueCacheEntriesTable.cacheKey, afterCacheKey));
    const rows = await db
      .select({
        cacheKey: catalogueCacheEntriesTable.cacheKey,
        body: catalogueCacheEntriesTable.body,
      })
      .from(catalogueCacheEntriesTable)
      .where(and(...conditions))
      .orderBy(asc(catalogueCacheEntriesTable.cacheKey))
      .limit(CACHE_PAGE_SIZE)
      .offset(offset);
    if (!rows.length) return;
    for (const row of rows) {
      readEntries++;
      const cards = providerCards(row.body);
      for (let index = 0; index < cards.length; index++) {
        if (row.cacheKey === afterCacheKey && index <= afterCardIndex) continue;
        const card = cards[index]!;
        const id =
          typeof card.id === "string" || typeof card.id === "number"
            ? String(card.id)
            : "";
        const setId =
          typeof card.set_id === "string" || typeof card.set_id === "number"
            ? String(card.set_id)
            : null;
        if (input.cardExternalId && id !== input.cardExternalId) continue;
        if (input.setExternalId && setId !== input.setExternalId) continue;
        yield { card: { ...card, id }, cursor: `${row.cacheKey}:${index}` };
      }
      if (
        input.maxCacheEntries !== undefined &&
        readEntries >= input.maxCacheEntries
      )
        return;
    }
    offset += rows.length;
  }
}

/**
 * Streams a separately configured cache database inside an explicit read-only
 * transaction. This is used to backfill a disposable target from HeliumDB
 * without modifying the populated source database.
 */
export async function* readOnlyJustTcgCacheCards(
  connectionString: string,
  input: {
    updatedAfter?: Date | null;
    setExternalId?: string | null;
    cardExternalId?: string | null;
    maxCacheEntries?: number;
    afterCursor?: string | null;
  } = {},
): AsyncGenerator<CatalogueImportSourceRecord> {
  const sourcePool = createDatabasePool(connectionString);
  const client = await sourcePool.connect();
  const separator = input.afterCursor?.lastIndexOf(":") ?? -1;
  const afterCacheKey =
    separator > 0 ? input.afterCursor!.slice(0, separator) : null;
  const afterCardIndex =
    separator > 0 ? Number(input.afterCursor!.slice(separator + 1)) : -1;
  let offset = 0;
  let readEntries = 0;
  try {
    await client.query("BEGIN READ ONLY");
    while (
      input.maxCacheEntries === undefined ||
      readEntries < input.maxCacheEntries
    ) {
      const values: unknown[] = ["cards"];
      let where = "resource = $1";
      if (input.updatedAfter) {
        values.push(input.updatedAfter);
        where += ` AND updated_at > $${values.length}`;
      }
      if (afterCacheKey) {
        values.push(afterCacheKey);
        where += ` AND cache_key >= $${values.length}`;
      }
      values.push(CACHE_PAGE_SIZE, offset);
      const rows = await client.query<{ cache_key: string; body: unknown }>(
        `SELECT cache_key, body FROM catalogue_cache_entries WHERE ${where} ORDER BY cache_key LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      if (!rows.rows.length) return;
      for (const row of rows.rows) {
        readEntries++;
        const cards = providerCards(row.body);
        for (let index = 0; index < cards.length; index++) {
          if (row.cache_key === afterCacheKey && index <= afterCardIndex)
            continue;
          const card = cards[index]!;
          const id =
            typeof card.id === "string" || typeof card.id === "number"
              ? String(card.id)
              : "";
          const setId =
            typeof card.set_id === "string" || typeof card.set_id === "number"
              ? String(card.set_id)
              : null;
          if (input.cardExternalId && id !== input.cardExternalId) continue;
          if (input.setExternalId && setId !== input.setExternalId) continue;
          yield { card: { ...card, id }, cursor: `${row.cache_key}:${index}` };
        }
        if (
          input.maxCacheEntries !== undefined &&
          readEntries >= input.maxCacheEntries
        )
          return;
      }
      offset += rows.rows.length;
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await sourcePool.end();
  }
}

export async function latestSuccessfulJustTcgImport(): Promise<Date | null> {
  const row = (
    await db
      .select({ completedAt: catalogueImportJobsTable.completedAt })
      .from(catalogueImportJobsTable)
      .where(
        and(
          eq(catalogueImportJobsTable.providerKey, "justtcg"),
          eq(catalogueImportJobsTable.status, "completed"),
        ),
      )
      .orderBy(desc(catalogueImportJobsTable.completedAt))
      .limit(1)
  )[0];
  return row?.completedAt ?? null;
}

export async function importJobCursor(jobId: string): Promise<string | null> {
  const row = (
    await db
      .select({ cursor: catalogueImportJobsTable.cursor })
      .from(catalogueImportJobsTable)
      .where(eq(catalogueImportJobsTable.id, jobId))
      .limit(1)
  )[0];
  if (!row) throw new Error("Catalogue import job was not found");
  return row.cursor;
}

export function createDatabaseCatalogueImportRepository(): CatalogueImportRepository {
  return {
    async createJob(input) {
      return createCatalogueImportJob(input);
    },
    async updateJob(input) {
      await updateCatalogueImportJob(input);
    },
    async recordError(input) {
      await recordCatalogueImportError({
        ...input,
        importJobId: input.jobId,
        providerKey: "justtcg",
      });
    },
    getGameBySlug,
    async upsertGame(input) {
      return upsertCanonicalGame(input);
    },
    findSetByExternalId,
    findSetByGameSlug,
    async upsertSet(input) {
      return upsertCanonicalSet(input);
    },
    findCardByExternalId,
    async findCandidateCards(input) {
      return findCandidateCards(input);
    },
    async createCard(input) {
      return upsertCanonicalCard(input);
    },
    async updateCard(input) {
      return updateCanonicalCard(input);
    },
    async upsertVariant(input) {
      const existing = (
        await db
          .select()
          .from(catalogueCardVariantsTable)
          .where(
            and(
              eq(catalogueCardVariantsTable.cardId, input.cardId),
              eq(catalogueCardVariantsTable.variantKey, input.evidence.key),
            ),
          )
          .limit(1)
      )[0];
      const entity = await upsertCardVariant({
        cardId: input.cardId,
        variantKey: input.evidence.key,
        name: input.evidence.name,
        finish: input.evidence.finish,
        edition: input.evidence.edition,
        stamp: input.evidence.stamp,
        language: input.evidence.language,
        metadata: input.metadata,
      });
      return { entity, created: !existing };
    },
    async upsertImage(input) {
      return (await upsertCatalogueImage(input)).created;
    },
    async upsertAlias(input) {
      return (await upsertCatalogueAlias(input)).created;
    },
    async findSourceRecord(input) {
      const row = await findCatalogueProvenance(input);
      return row
        ? { entityId: row.entityId, payloadHash: row.payloadHash }
        : null;
    },
    async recordProvenance(input) {
      const existing = await findCatalogueProvenance(input);
      await recordCatalogueProvenance(input);
      return !existing;
    },
    async upsertExternalIdentity(input) {
      const existing = await db
        .select()
        .from(catalogueExternalIdsTable)
        .where(
          and(
            eq(catalogueExternalIdsTable.providerKey, input.providerKey),
            eq(catalogueExternalIdsTable.entityType, input.entityType),
            eq(catalogueExternalIdsTable.externalId, input.externalId),
          ),
        )
        .limit(1);
      await upsertExternalIdentity(input);
      return !existing[0];
    },
  };
}

export interface CatalogueHealth {
  games: number;
  sets: number;
  cards: number;
  justTcgCards: number;
  cardsWithoutImages: number;
  unresolvedRecords: number;
  lastSuccessfulImport: Date | null;
  lastFailedImport: Date | null;
  failedRecords: number;
  mappingCoveragePercent: number;
}

/** A compact operational report for future admin tooling and Stage 3C shadow checks. */
export async function getCatalogueHealth(): Promise<CatalogueHealth> {
  const result = await db.execute<{
    games: number;
    sets: number;
    cards: number;
    justtcg_cards: number;
    justtcg_mapped_cards: number;
    cards_without_images: number;
    unresolved_records: number;
    failed_records: number;
    last_successful_import: Date | null;
    last_failed_import: Date | null;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM catalogue_games) AS games,
      (SELECT COUNT(*)::int FROM catalogue_sets) AS sets,
      (SELECT COUNT(*)::int FROM catalogue_cards) AS cards,
      (SELECT COUNT(*)::int FROM catalogue_external_ids WHERE provider_key = 'justtcg' AND entity_type = 'card') AS justtcg_cards,
       (SELECT COUNT(DISTINCT entity_id)::int FROM catalogue_external_ids WHERE provider_key = 'justtcg' AND entity_type = 'card') AS justtcg_mapped_cards,
      (SELECT COUNT(*)::int FROM catalogue_cards c WHERE NOT EXISTS (SELECT 1 FROM catalogue_card_images i WHERE i.card_id = c.id)) AS cards_without_images,
      (SELECT COUNT(*)::int FROM catalogue_import_errors WHERE error_code IN ('AMBIGUOUS_IDENTITY', 'EXTERNAL_ID_CONFLICT')) AS unresolved_records,
      (SELECT COUNT(*)::int FROM catalogue_import_errors) AS failed_records,
      (SELECT completed_at FROM catalogue_import_jobs WHERE provider_key = 'justtcg' AND status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1) AS last_successful_import,
      (SELECT completed_at FROM catalogue_import_jobs WHERE provider_key = 'justtcg' AND status IN ('failed', 'partial') ORDER BY completed_at DESC NULLS LAST LIMIT 1) AS last_failed_import
  `);
  const row = result.rows[0]!;
  return {
    games: Number(row.games),
    sets: Number(row.sets),
    cards: Number(row.cards),
    justTcgCards: Number(row.justtcg_cards),
    cardsWithoutImages: Number(row.cards_without_images),
    unresolvedRecords: Number(row.unresolved_records),
    lastSuccessfulImport: row.last_successful_import
      ? new Date(row.last_successful_import)
      : null,
    lastFailedImport: row.last_failed_import
      ? new Date(row.last_failed_import)
      : null,
    failedRecords: Number(row.failed_records),
    mappingCoveragePercent: Number(row.cards)
      ? Number(
          ((Number(row.justtcg_mapped_cards) / Number(row.cards)) * 100).toFixed(2),
        )
      : 0,
  };
}

export async function findCanonicalCardByJustTcgId(externalId: string) {
  const result = await db.execute<{
    canonical_id: string;
    collector_number: string | null;
    set_name: string;
    game_slug: string;
  }>(sql`
    SELECT c.id AS canonical_id, c.collector_number, s.name AS set_name, g.slug AS game_slug
    FROM catalogue_external_ids e
    JOIN catalogue_cards c ON c.id = e.entity_id
    JOIN catalogue_sets s ON s.id = c.set_id
    JOIN catalogue_games g ON g.id = c.game_id
    WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card' AND e.external_id = ${externalId}
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export interface CatalogueShadowComparison {
  recordsRead: number;
  mapped: number;
  missing: number;
  setMismatches: number;
  collectorNumberMismatches: number;
  unsupported: number;
}

/**
 * Bounded Stage 3C readiness signal. It compares observed JustTCG cache rows
 * with canonical records but is intentionally read-only and never affects the
 * public catalogue route.
 */
export async function compareCachedJustTcgCoverage(
  maxRecords = 500,
  source?: AsyncIterable<CatalogueImportSourceRecord>,
): Promise<CatalogueShadowComparison> {
  const result: CatalogueShadowComparison = {
    recordsRead: 0,
    mapped: 0,
    missing: 0,
    setMismatches: 0,
    collectorNumberMismatches: 0,
    unsupported: 0,
  };
  const seen = new Set<string>();
  for await (const sourceRecord of source ?? cachedJustTcgCards()) {
    const candidate = normalizeJustTcgCard(sourceRecord.card);
    if (!candidate.externalId || seen.has(candidate.externalId)) continue;
    seen.add(candidate.externalId);
    result.recordsRead++;
    if (!candidate.gameSlug || !candidate.setName) {
      result.unsupported++;
    } else {
      const canonical = await findCanonicalCardByJustTcgId(
        candidate.externalId,
      );
      if (!canonical) {
        result.missing++;
      } else {
        result.mapped++;
        if (
          canonical.game_slug !== candidate.gameSlug ||
          normalizeForMatching(canonical.set_name) !==
            normalizeForMatching(candidate.setName)
        ) {
          result.setMismatches++;
        }
        if (
          normalizeCollectorNumber(canonical.collector_number) !==
          candidate.collectorNumber
        ) {
          result.collectorNumberMismatches++;
        }
      }
    }
    if (result.recordsRead >= maxRecords) break;
  }
  return result;
}
