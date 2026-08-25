import { createHash } from "node:crypto";
import {
  normalizeForMatching,
  normalizeText,
} from "./catalogueNormalisation.js";
import {
  normalizeJustTcgCard,
  type CatalogueVariantEvidence,
  type JustTcgProviderCard,
} from "./justTcgCanonicalAdapter.js";
import {
  emptyImportCounters,
  sanitizeImportError,
  type ImportCounters,
} from "./catalogueIngestion.js";

export type CatalogueImportJobType =
  "full" | "incremental" | "set" | "card" | "reconciliation";
export type CatalogueImportJobStatus =
  "queued" | "running" | "completed" | "partial" | "failed";
export type CatalogueEntityType = "game" | "set" | "card" | "variant";

export interface CatalogueEntity {
  id: string;
  /** Present for cards so an external ID cannot silently cross game/set ownership. */
  gameId?: string | null;
  setId?: string | null;
}

export interface CatalogueSourceRecord {
  entityId: string;
  payloadHash: string | null;
}

export interface CatalogueImportSourceRecord {
  card: JustTcgProviderCard;
  /** Provider/cache position, persisted so a bounded source can resume. */
  cursor?: string | null;
}

export interface CatalogueImportMetrics extends ImportCounters {
  gamesCreated: number;
  setsCreated: number;
  cardsCreated: number;
  variantsCreated: number;
  imagesCreated: number;
  aliasesCreated: number;
  externalIdsCreated: number;
  provenanceCreated: number;
  provenanceUpdated: number;
  ambiguous: number;
}

export interface CatalogueImportResult {
  jobId: string | null;
  status: CatalogueImportJobStatus;
  cursor: string | null;
  dryRun: boolean;
  metrics: CatalogueImportMetrics;
}

export interface CatalogueImportRepository {
  createJob(input: {
    providerKey: string;
    jobType: CatalogueImportJobType;
    metadata: Record<string, unknown>;
  }): Promise<CatalogueEntity>;
  updateJob(input: {
    id: string;
    status?: CatalogueImportJobStatus;
    cursor?: string | null;
    counters?: ImportCounters;
    errorCode?: string | null;
    errorMessage?: string | null;
    completed?: boolean;
  }): Promise<void>;
  recordError(input: {
    jobId: string;
    externalId: string | null;
    entityType: CatalogueEntityType;
    errorCode: string;
    errorMessage: string;
    payload: Record<string, unknown> | null;
  }): Promise<void>;

  getGameBySlug(slug: string): Promise<CatalogueEntity | null>;
  upsertGame(input: { slug: string; name: string }): Promise<CatalogueEntity>;
  findSetByExternalId(
    providerKey: string,
    externalId: string,
  ): Promise<CatalogueEntity | null>;
  findSetByGameSlug(
    gameId: string,
    slug: string,
  ): Promise<CatalogueEntity | null>;
  upsertSet(input: {
    gameId: string;
    slug: string;
    name: string;
    code: string | null;
    language: string | null;
    metadata: Record<string, unknown>;
  }): Promise<CatalogueEntity>;
  findCardByExternalId(
    providerKey: string,
    externalId: string,
  ): Promise<CatalogueEntity | null>;
  findCandidateCards(input: {
    gameId: string;
    setId: string;
    collectorNumber: string | null;
    name: string;
    language: string | null;
  }): Promise<CatalogueEntity[]>;
  createCard(input: {
    gameId: string;
    setId: string;
    name: string;
    collectorNumber: string | null;
    language: string | null;
    rarity: string | null;
    metadata: Record<string, unknown>;
  }): Promise<CatalogueEntity>;
  updateCard(input: {
    id: string;
    name: string;
    collectorNumber: string | null;
    language: string | null;
    rarity: string | null;
    metadata: Record<string, unknown>;
  }): Promise<CatalogueEntity>;
  upsertVariant(input: {
    cardId: string;
    evidence: CatalogueVariantEvidence;
    metadata: Record<string, unknown>;
  }): Promise<{ entity: CatalogueEntity; created: boolean }>;
  upsertImage(input: {
    cardId: string;
    variantId: string | null;
    url: string;
    source: string;
  }): Promise<boolean>;
  upsertAlias(input: {
    entityType: CatalogueEntityType;
    entityId: string;
    alias: string;
    aliasType: string;
    source: string;
  }): Promise<boolean>;
  findSourceRecord(input: {
    providerKey: string;
    entityType: CatalogueEntityType;
    externalId: string;
  }): Promise<CatalogueSourceRecord | null>;
  recordProvenance(input: {
    entityType: CatalogueEntityType;
    entityId: string;
    providerKey: string;
    externalId: string;
    payloadHash: string;
    rawPayload: Record<string, unknown>;
    sourceUpdatedAt: Date | null;
  }): Promise<boolean>;
  upsertExternalIdentity(input: {
    entityType: CatalogueEntityType;
    entityId: string;
    providerKey: string;
    externalId: string;
    metadata: Record<string, unknown>;
  }): Promise<boolean>;
}

export interface RunCatalogueImportOptions {
  jobType: CatalogueImportJobType;
  dryRun?: boolean;
  batchSize?: number;
  metadata?: Record<string, unknown>;
}

function newMetrics(): CatalogueImportMetrics {
  return {
    ...emptyImportCounters(),
    gamesCreated: 0,
    setsCreated: 0,
    cardsCreated: 0,
    variantsCreated: 0,
    imagesCreated: 0,
    aliasesCreated: 0,
    externalIdsCreated: 0,
    provenanceCreated: 0,
    provenanceUpdated: 0,
    ambiguous: 0,
  };
}

function stableSlug(value: string): string {
  return normalizeForMatching(value).replace(/\s+/g, "-");
}

function canonicalGameName(slug: string): string {
  return (
    {
      pokemon: "Pokémon",
      "one-piece": "One Piece",
      "magic-the-gathering": "Magic: The Gathering",
      "yu-gi-oh": "Yu-Gi-Oh!",
      "dragon-ball": "Dragon Ball",
      lorcana: "Lorcana",
      digimon: "Digimon",
    }[slug] ?? slug
  );
}

function isSafeImageUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Never persist credentials accidentally included in a provider response. */
export function sanitizeProviderPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const redact = (input: unknown, depth: number): unknown => {
    if (depth > 8) return "[TRUNCATED]";
    if (typeof input === "string") {
      return input
        .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
        .replace(
          /([?&](?:token|api[_-]?key|key|authorization)=)[^&\s]+/gi,
          "$1[REDACTED]",
        );
    }
    if (Array.isArray(input))
      return input.slice(0, 100).map((item) => redact(item, depth + 1));
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, nested]) => [
        key,
        /(?:api[_-]?key|token|authorization|cookie|password|secret)/i.test(key)
          ? "[REDACTED]"
          : redact(nested, depth + 1),
      ]),
    );
  };
  return redact(value, 0) as Record<string, unknown>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cataloguePayloadHash(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(stableJson(sanitizeProviderPayload(value)))
    .digest("hex");
}

function malformed(
  candidate: ReturnType<typeof normalizeJustTcgCard>,
): string | null {
  if (!candidate.externalId.trim()) return "missing external card ID";
  if (!candidate.gameSlug) return "unsupported or missing game";
  if (!candidate.name) return "missing card name";
  if (!candidate.setName) return "missing set name";
  return null;
}

async function writeFailure(
  repository: CatalogueImportRepository,
  jobId: string | null,
  metrics: CatalogueImportMetrics,
  input: {
    externalId: string | null;
    error: unknown;
    payload: Record<string, unknown>;
    code: string;
  },
) {
  metrics.recordsFailed++;
  if (!jobId) return;
  await repository.recordError({
    jobId,
    externalId: input.externalId,
    entityType: "card",
    errorCode: input.code,
    errorMessage: sanitizeImportError(input.error),
    payload: sanitizeProviderPayload(input.payload),
  });
}

async function importOne(
  repository: CatalogueImportRepository,
  jobId: string | null,
  source: CatalogueImportSourceRecord,
  metrics: CatalogueImportMetrics,
  dryRun: boolean,
) {
  metrics.recordsRead++;
  const candidate = normalizeJustTcgCard(source.card);
  const invalidReason = malformed(candidate);
  if (invalidReason) {
    await writeFailure(repository, jobId, metrics, {
      externalId: candidate.externalId || null,
      error: invalidReason,
      payload: source.card,
      code: "MALFORMED_PROVIDER_RECORD",
    });
    return;
  }

  const payload = sanitizeProviderPayload(source.card);
  const payloadHash = cataloguePayloadHash(source.card);
  const prior = await repository.findSourceRecord({
    providerKey: candidate.providerKey,
    entityType: "card",
    externalId: candidate.externalId,
  });
  if (prior?.payloadHash === payloadHash) {
    if (!dryRun) {
      await repository.recordProvenance({
        entityType: "card",
        entityId: prior.entityId,
        providerKey: candidate.providerKey,
        externalId: candidate.externalId,
        payloadHash,
        rawPayload: payload,
        sourceUpdatedAt: candidate.sourceUpdatedAt,
      });
      metrics.provenanceUpdated++;
    }
    metrics.recordsSkipped++;
    return;
  }

  try {
    const existingGame = await repository.getGameBySlug(candidate.gameSlug!);
    const game = dryRun
      ? (existingGame ?? { id: `dry-game:${candidate.gameSlug}` })
      : await repository.upsertGame({
          slug: candidate.gameSlug!,
          name: canonicalGameName(candidate.gameSlug!),
        });
    if (!existingGame) metrics.gamesCreated++;
    if (!dryRun && candidate.gameExternalId) {
      if (
        await repository.upsertExternalIdentity({
          entityType: "game",
          entityId: game.id,
          providerKey: candidate.providerKey,
          externalId: candidate.gameExternalId,
          metadata: {},
        })
      ) {
        metrics.externalIdsCreated++;
      }
      if (
        await repository.recordProvenance({
          entityType: "game",
          entityId: game.id,
          providerKey: candidate.providerKey,
          externalId: candidate.gameExternalId,
          payloadHash,
          rawPayload: payload,
          sourceUpdatedAt: candidate.sourceUpdatedAt,
        })
      )
        metrics.provenanceCreated++;
      else metrics.provenanceUpdated++;
    }

    const setSlug = stableSlug(candidate.setCode ?? candidate.setName!);
    let set = candidate.setExternalId
      ? await repository.findSetByExternalId(
          candidate.providerKey,
          candidate.setExternalId,
        )
      : null;
    if (!set) set = await repository.findSetByGameSlug(game.id, setSlug);
    const setWasNew = !set;
    if (!set) {
      set = dryRun
        ? { id: `dry-set:${game.id}:${setSlug}` }
        : await repository.upsertSet({
            gameId: game.id,
            slug: setSlug,
            name: candidate.setName!,
            code: candidate.setCode,
            language: candidate.language,
            metadata: { provider: candidate.providerKey },
          });
    }
    if (setWasNew) metrics.setsCreated++;

    if (!dryRun && candidate.setExternalId) {
      if (
        await repository.upsertExternalIdentity({
          entityType: "set",
          entityId: set.id,
          providerKey: candidate.providerKey,
          externalId: candidate.setExternalId,
          metadata: {},
        })
      )
        metrics.externalIdsCreated++;
      if (
        await repository.recordProvenance({
          entityType: "set",
          entityId: set.id,
          providerKey: candidate.providerKey,
          externalId: candidate.setExternalId,
          payloadHash,
          rawPayload: payload,
          sourceUpdatedAt: candidate.sourceUpdatedAt,
        })
      )
        metrics.provenanceCreated++;
      else metrics.provenanceUpdated++;
    }

    let card = await repository.findCardByExternalId(
      candidate.providerKey,
      candidate.externalId,
    );
    let cardCreated = false;
    if (card) {
      if (
        card.gameId !== undefined &&
        (card.gameId !== game.id || card.setId !== set.id)
      ) {
        throw new Error(
          "External identity conflicts with canonical game or set ownership",
        );
      }
      if (!dryRun)
        card = await repository.updateCard({
          id: card.id,
          name: candidate.name,
          collectorNumber: candidate.collectorNumber,
          language: candidate.language,
          rarity: candidate.rarity,
          metadata: { provider: candidate.providerKey },
        });
    } else {
      const matches = await repository.findCandidateCards({
        gameId: game.id,
        setId: set.id,
        collectorNumber: candidate.collectorNumber,
        name: candidate.name,
        language: candidate.language,
      });
      if (matches.length > 1) {
        metrics.ambiguous++;
        await writeFailure(repository, jobId, metrics, {
          externalId: candidate.externalId,
          error: "Ambiguous canonical card identity; no merge was performed",
          payload: source.card,
          code: "AMBIGUOUS_IDENTITY",
        });
        return;
      }
      card = matches[0] ?? null;
      if (card) {
        if (!dryRun)
          card = await repository.updateCard({
            id: card.id,
            name: candidate.name,
            collectorNumber: candidate.collectorNumber,
            language: candidate.language,
            rarity: candidate.rarity,
            metadata: { provider: candidate.providerKey },
          });
      } else {
        cardCreated = true;
        card = dryRun
          ? { id: `dry-card:${candidate.externalId}` }
          : await repository.createCard({
              gameId: game.id,
              setId: set.id,
              name: candidate.name,
              collectorNumber: candidate.collectorNumber,
              language: candidate.language,
              rarity: candidate.rarity,
              metadata: { provider: candidate.providerKey },
            });
      }
    }

    if (cardCreated) {
      metrics.recordsCreated++;
      metrics.cardsCreated++;
    } else {
      metrics.recordsUpdated++;
    }

    if (dryRun) return;
    if (
      await repository.upsertExternalIdentity({
        entityType: "card",
        entityId: card.id,
        providerKey: candidate.providerKey,
        externalId: candidate.externalId,
        metadata: {},
      })
    )
      metrics.externalIdsCreated++;

    let variantId: string | null = null;
    if (candidate.variant) {
      const variant = await repository.upsertVariant({
        cardId: card.id,
        evidence: candidate.variant,
        metadata: { provider: candidate.providerKey },
      });
      variantId = variant.entity.id;
      if (variant.created) metrics.variantsCreated++;
    }
    if (
      isSafeImageUrl(candidate.imageUrl) &&
      (await repository.upsertImage({
        cardId: card.id,
        variantId,
        url: candidate.imageUrl,
        source: candidate.providerKey,
      }))
    )
      metrics.imagesCreated++;
    if (
      await repository.upsertAlias({
        entityType: "card",
        entityId: card.id,
        alias: candidate.name,
        aliasType: "provider_name",
        source: candidate.providerKey,
      })
    )
      metrics.aliasesCreated++;

    const provenanceCreated = !prior;
    await repository.recordProvenance({
      entityType: "card",
      entityId: card.id,
      providerKey: candidate.providerKey,
      externalId: candidate.externalId,
      payloadHash,
      rawPayload: payload,
      sourceUpdatedAt: candidate.sourceUpdatedAt,
    });
    if (provenanceCreated) metrics.provenanceCreated++;
    else metrics.provenanceUpdated++;
  } catch (error) {
    await writeFailure(repository, jobId, metrics, {
      externalId: candidate.externalId,
      error,
      payload: source.card,
      code:
        error instanceof Error && /external identity/i.test(error.message)
          ? "EXTERNAL_ID_CONFLICT"
          : "RECONCILIATION_ERROR",
    });
  }
}

/**
 * Runs one bounded, single-process import. Database writes are intentionally
 * record-sized: malformed records are isolated and a large sync never holds a
 * single transaction open.
 */
export async function runCatalogueImport(
  repository: CatalogueImportRepository,
  source:
    | AsyncIterable<CatalogueImportSourceRecord>
    | Iterable<CatalogueImportSourceRecord>,
  options: RunCatalogueImportOptions,
): Promise<CatalogueImportResult> {
  const dryRun = options.dryRun ?? false;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 500));
  const metrics = newMetrics();
  let cursor: string | null = null;
  let jobId: string | null = null;
  try {
    if (!dryRun) {
      const job = await repository.createJob({
        providerKey: "justtcg",
        jobType: options.jobType,
        metadata: options.metadata ?? {},
      });
      jobId = job.id;
      await repository.updateJob({ id: jobId, status: "running" });
    }
    let processedSinceCheckpoint = 0;
    for await (const record of source) {
      await importOne(repository, jobId, record, metrics, dryRun);
      cursor = record.cursor ?? cursor;
      processedSinceCheckpoint++;
      if (jobId && processedSinceCheckpoint >= batchSize) {
        await repository.updateJob({ id: jobId, cursor, counters: metrics });
        processedSinceCheckpoint = 0;
      }
    }
    const status: CatalogueImportJobStatus = metrics.recordsFailed
      ? "partial"
      : "completed";
    if (jobId)
      await repository.updateJob({
        id: jobId,
        status,
        cursor,
        counters: metrics,
        completed: true,
      });
    return { jobId, status, cursor, dryRun, metrics };
  } catch (error) {
    if (jobId)
      await repository.updateJob({
        id: jobId,
        status: "failed",
        cursor,
        counters: metrics,
        errorCode: "IMPORT_ABORTED",
        errorMessage: sanitizeImportError(error),
        completed: true,
      });
    return { jobId, status: "failed", cursor, dryRun, metrics };
  }
}
