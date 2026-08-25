import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cataloguePayloadHash,
  runCatalogueImport,
  sanitizeProviderPayload,
  type CatalogueEntity,
  type CatalogueImportRepository,
  type CatalogueImportSourceRecord,
} from "../catalogue/internal/catalogueSync.js";

class MemoryCatalogueRepository implements CatalogueImportRepository {
  private sequence = 0;
  readonly games = new Map<string, CatalogueEntity>();
  readonly sets = new Map<string, CatalogueEntity>();
  readonly cards = new Map<string, CatalogueEntity & Record<string, unknown>>();
  readonly external = new Map<string, string>();
  readonly provenance = new Map<
    string,
    { entityId: string; payloadHash: string | null }
  >();
  readonly variants = new Map<string, CatalogueEntity>();
  readonly images = new Set<string>();
  readonly aliases = new Set<string>();
  readonly jobs = new Map<string, Record<string, unknown>>();
  readonly errors: Array<Record<string, unknown>> = [];

  private id(prefix: string) {
    this.sequence++;
    return `${prefix}-${this.sequence}`;
  }
  private externalKey(type: string, externalId: string) {
    return `justtcg|${type}|${externalId}`;
  }
  async createJob() {
    const job = { id: this.id("job") };
    this.jobs.set(job.id, { ...job, status: "queued" });
    return job;
  }
  async updateJob(input: { id: string } & Record<string, unknown>) {
    this.jobs.set(input.id, { ...this.jobs.get(input.id), ...input });
  }
  async recordError(input: Record<string, unknown>) {
    this.errors.push(input);
  }
  async getGameBySlug(slug: string) {
    return this.games.get(slug) ?? null;
  }
  async upsertGame(input: { slug: string }) {
    const existing = this.games.get(input.slug);
    if (existing) return existing;
    const row = { id: this.id("game") };
    this.games.set(input.slug, row);
    return row;
  }
  async findSetByExternalId(_provider: string, externalId: string) {
    const id = this.external.get(this.externalKey("set", externalId));
    return id ? (this.sets.get(id) ?? null) : null;
  }
  async findSetByGameSlug(gameId: string, slug: string) {
    return this.sets.get(`${gameId}|${slug}`) ?? null;
  }
  async upsertSet(input: { gameId: string; slug: string }) {
    const key = `${input.gameId}|${input.slug}`;
    const existing = this.sets.get(key);
    if (existing) return existing;
    const row = { id: this.id("set") };
    this.sets.set(key, row);
    this.sets.set(row.id, row);
    return row;
  }
  async findCardByExternalId(_provider: string, externalId: string) {
    const id = this.external.get(this.externalKey("card", externalId));
    return id ? (this.cards.get(id) ?? null) : null;
  }
  async findCandidateCards(input: {
    gameId: string;
    setId: string;
    collectorNumber: string | null;
    name: string;
    language: string | null;
  }) {
    return [...this.cards.values()].filter(
      (card) =>
        card.gameId === input.gameId &&
        card.setId === input.setId &&
        card.collectorNumber === input.collectorNumber &&
        card.name === input.name &&
        card.language === input.language,
    );
  }
  async createCard(input: {
    gameId: string;
    setId: string;
    name: string;
    collectorNumber: string | null;
    language: string | null;
    rarity: string | null;
  }) {
    const row = { id: this.id("card"), ...input };
    this.cards.set(row.id, row);
    return row;
  }
  async updateCard(input: {
    id: string;
    name: string;
    collectorNumber: string | null;
    language: string | null;
    rarity: string | null;
  }) {
    const existing = this.cards.get(input.id)!;
    const row = { ...existing, ...input };
    this.cards.set(input.id, row);
    return row;
  }
  async upsertVariant(input: { cardId: string; evidence: { key: string } }) {
    const key = `${input.cardId}|${input.evidence.key}`;
    const existing = this.variants.get(key);
    if (existing) return { entity: existing, created: false };
    const entity = { id: this.id("variant") };
    this.variants.set(key, entity);
    return { entity, created: true };
  }
  async upsertImage(input: {
    cardId: string;
    variantId: string | null;
    url: string;
  }) {
    const key = `${input.cardId}|${input.variantId ?? "base"}|${input.url}`;
    if (this.images.has(key)) return false;
    this.images.add(key);
    return true;
  }
  async upsertAlias(input: {
    entityType: string;
    entityId: string;
    alias: string;
    aliasType: string;
    source: string;
  }) {
    const key = `${input.entityType}|${input.entityId}|${input.alias}|${input.aliasType}|${input.source}`;
    if (this.aliases.has(key)) return false;
    this.aliases.add(key);
    return true;
  }
  async findSourceRecord(input: { entityType: string; externalId: string }) {
    return (
      this.provenance.get(`${input.entityType}|${input.externalId}`) ?? null
    );
  }
  async recordProvenance(input: {
    entityType: string;
    entityId: string;
    externalId: string;
    payloadHash: string;
  }) {
    const key = `${input.entityType}|${input.externalId}`;
    const existing = this.provenance.has(key);
    this.provenance.set(key, {
      entityId: input.entityId,
      payloadHash: input.payloadHash,
    });
    return !existing;
  }
  async upsertExternalIdentity(input: {
    entityType: string;
    entityId: string;
    externalId: string;
  }) {
    const key = this.externalKey(input.entityType, input.externalId);
    const existing = this.external.get(key);
    if (existing && existing !== input.entityId)
      throw new Error(
        "External identity already belongs to another canonical entity",
      );
    this.external.set(key, input.entityId);
    return !existing;
  }
}

const records: CatalogueImportSourceRecord[] = [
  {
    card: {
      id: "pokemon-001",
      game: "Pokémon",
      set_id: "base-set",
      set_name: "Base Set",
      set_code: "base1",
      name: "Pikachu",
      number: "001 / 102",
      rarity: "Common",
      image_url: "https://images.example.test/pikachu.png",
    },
    cursor: "cache-a:0",
  },
  {
    card: {
      id: "mtg-001",
      game: "Magic: The Gathering",
      set_id: "m-set",
      set_name: "Test Set",
      set_code: "TST",
      name: "Lightning Bolt",
      number: "123",
      finish: "Foil",
      image_url: "https://images.example.test/bolt.png",
    },
    cursor: "cache-a:1",
  },
];

describe("Stage 3B cache-backed catalogue import", () => {
  test("imports real-shaped provider records and is idempotent", async () => {
    const repository = new MemoryCatalogueRepository();
    const first = await runCatalogueImport(repository, records, {
      jobType: "full",
      batchSize: 1,
    });
    assert.equal(first.status, "completed");
    assert.equal(first.metrics.recordsCreated, 2);
    assert.equal(first.metrics.gamesCreated, 2);
    assert.equal(first.metrics.setsCreated, 2);
    assert.equal(first.metrics.cardsCreated, 2);
    assert.equal(first.metrics.variantsCreated, 1);
    assert.equal(first.metrics.imagesCreated, 2);
    assert.equal(first.metrics.externalIdsCreated, 4);
    assert.equal(first.metrics.provenanceCreated, 4);
    const firstCardId = repository.external.get("justtcg|card|pokemon-001");

    const repeated = await runCatalogueImport(repository, records, {
      jobType: "full",
    });
    assert.equal(repeated.status, "completed");
    assert.equal(repeated.metrics.recordsSkipped, 2);
    assert.equal(repository.cards.size, 2);
    assert.equal(repository.variants.size, 1);
    assert.equal(repository.images.size, 2);
    assert.equal(
      repository.external.get("justtcg|card|pokemon-001"),
      firstCardId,
    );
  });

  test("updates mutable metadata without changing the canonical UUID", async () => {
    const repository = new MemoryCatalogueRepository();
    await runCatalogueImport(repository, [records[0]!], { jobType: "full" });
    const id = repository.external.get("justtcg|card|pokemon-001")!;
    const changed = structuredClone(records[0]!);
    changed.card.rarity = "Illustration Rare";
    changed.card.updated_at = "2026-08-25T00:00:00.000Z";
    const result = await runCatalogueImport(repository, [changed], {
      jobType: "incremental",
    });
    assert.equal(result.metrics.recordsUpdated, 1);
    assert.equal(repository.external.get("justtcg|card|pokemon-001"), id);
    assert.equal(repository.cards.get(id)?.rarity, "Illustration Rare");
  });

  test("records an identity conflict without reassigning an existing provider card", async () => {
    const repository = new MemoryCatalogueRepository();
    await runCatalogueImport(repository, [records[0]!], { jobType: "full" });
    const id = repository.external.get("justtcg|card|pokemon-001")!;
    const conflicting = structuredClone(records[0]!);
    conflicting.card.set_id = "other-set";
    conflicting.card.set_name = "Other Set";
    conflicting.card.set_code = "OTHER";
    conflicting.card.updated_at = "2026-08-25T01:00:00.000Z";
    const result = await runCatalogueImport(repository, [conflicting], {
      jobType: "card",
    });
    assert.equal(result.status, "partial");
    assert.equal(result.metrics.recordsFailed, 1);
    assert.equal(repository.errors[0]?.errorCode, "EXTERNAL_ID_CONFLICT");
    assert.equal(repository.external.get("justtcg|card|pokemon-001"), id);
    assert.equal(repository.cards.size, 1);
  });

  test("isolates malformed cards and redacts provider credentials", async () => {
    const repository = new MemoryCatalogueRepository();
    const result = await runCatalogueImport(
      repository,
      [{ card: { id: "bad", game: "Pokemon", name: "Broken" } }, records[0]!],
      { jobType: "full" },
    );
    assert.equal(result.status, "partial");
    assert.equal(result.metrics.recordsFailed, 1);
    assert.equal(result.metrics.recordsCreated, 1);
    const payload = sanitizeProviderPayload({
      token: "secret",
      image_url: "https://collector:secret@example.test/card.png?token=secret",
      nested: { authorization: "Bearer no" },
    });
    assert.deepEqual(payload, {
      token: "[REDACTED]",
      image_url: "https://[REDACTED]@example.test/card.png?token=[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
    assert.equal(
      cataloguePayloadHash({ b: 1, a: 2 }),
      cataloguePayloadHash({ a: 2, b: 1 }),
    );
  });

  test("supports a no-write dry run", async () => {
    const repository = new MemoryCatalogueRepository();
    const result = await runCatalogueImport(repository, records, {
      jobType: "full",
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.equal(repository.cards.size, 0);
    assert.equal(repository.jobs.size, 0);
  });

  test("marks an interrupted source job as failed while retaining prior work", async () => {
    const repository = new MemoryCatalogueRepository();
    async function* interrupted() {
      yield records[0]!;
      throw new Error("source connection interrupted");
    }
    const result = await runCatalogueImport(repository, interrupted(), {
      jobType: "incremental",
    });
    assert.equal(result.status, "failed");
    assert.equal(repository.cards.size, 1);
    assert.equal([...repository.jobs.values()][0]?.status, "failed");
  });
});
