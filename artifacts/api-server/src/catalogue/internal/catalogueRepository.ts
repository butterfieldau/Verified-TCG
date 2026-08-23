import { and, eq, ilike, isNull } from "drizzle-orm";
import {
  catalogueCardVariantsTable,
  catalogueCardsTable,
  catalogueExternalIdsTable,
  catalogueGamesTable,
  catalogueSetsTable,
  catalogueSourceRecordsTable,
  db,
} from "@workspace/db";
import { normalizeCollectorNumber } from "./catalogueNormalisation.js";

type EntityType = "game" | "set" | "card" | "variant";

export async function getGameBySlug(slug: string) {
  return (
    (
      await db
        .select()
        .from(catalogueGamesTable)
        .where(eq(catalogueGamesTable.slug, slug))
        .limit(1)
    )[0] ?? null
  );
}

export async function getSetById(id: string) {
  return (
    (
      await db
        .select()
        .from(catalogueSetsTable)
        .where(eq(catalogueSetsTable.id, id))
        .limit(1)
    )[0] ?? null
  );
}

export async function getCardById(id: string) {
  return (
    (
      await db
        .select()
        .from(catalogueCardsTable)
        .where(eq(catalogueCardsTable.id, id))
        .limit(1)
    )[0] ?? null
  );
}

export async function getVariantById(id: string) {
  return (
    (
      await db
        .select()
        .from(catalogueCardVariantsTable)
        .where(eq(catalogueCardVariantsTable.id, id))
        .limit(1)
    )[0] ?? null
  );
}

export async function findCardByExternalId(
  providerKey: string,
  externalId: string,
) {
  const identity = (
    await db
      .select()
      .from(catalogueExternalIdsTable)
      .where(
        and(
          eq(catalogueExternalIdsTable.providerKey, providerKey),
          eq(catalogueExternalIdsTable.entityType, "card"),
          eq(catalogueExternalIdsTable.externalId, externalId),
        ),
      )
      .limit(1)
  )[0];
  return identity ? getCardById(identity.entityId) : null;
}

export async function findSetByExternalId(
  providerKey: string,
  externalId: string,
) {
  const identity = (
    await db
      .select()
      .from(catalogueExternalIdsTable)
      .where(
        and(
          eq(catalogueExternalIdsTable.providerKey, providerKey),
          eq(catalogueExternalIdsTable.entityType, "set"),
          eq(catalogueExternalIdsTable.externalId, externalId),
        ),
      )
      .limit(1)
  )[0];
  return identity ? getSetById(identity.entityId) : null;
}

export async function findCandidateCards(input: {
  gameId: string;
  setId?: string | null;
  collectorNumber?: string | null;
  name?: string | null;
}) {
  const conditions = [eq(catalogueCardsTable.gameId, input.gameId)];
  if (input.setId) conditions.push(eq(catalogueCardsTable.setId, input.setId));
  const number = normalizeCollectorNumber(input.collectorNumber);
  if (number)
    conditions.push(eq(catalogueCardsTable.collectorNumberNormalized, number));
  if (input.name?.trim())
    conditions.push(ilike(catalogueCardsTable.name, input.name.trim()));
  return db
    .select()
    .from(catalogueCardsTable)
    .where(and(...conditions))
    .limit(25);
}

export async function upsertCanonicalGame(input: {
  slug: string;
  name: string;
  shortName?: string | null;
  publisher?: string | null;
  sortOrder?: number;
}) {
  const [row] = await db
    .insert(catalogueGamesTable)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: catalogueGamesTable.slug,
      set: {
        name: input.name,
        shortName: input.shortName ?? null,
        publisher: input.publisher ?? null,
        sortOrder: input.sortOrder ?? 0,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function upsertCanonicalSet(input: {
  gameId: string;
  slug: string;
  name: string;
  code?: string | null;
  series?: string | null;
  language?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(catalogueSetsTable)
    .values({ ...input, metadata: input.metadata ?? {}, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [catalogueSetsTable.gameId, catalogueSetsTable.slug],
      set: {
        name: input.name,
        code: input.code ?? null,
        series: input.series ?? null,
        language: input.language ?? null,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

/**
 * Deliberately only reconciles cards when game, resolved set and collector
 * number agree. Missing identifiers produce a new candidate for review later.
 */
export async function upsertCanonicalCard(input: {
  gameId: string;
  setId?: string | null;
  name: string;
  collectorNumber?: string | null;
  language?: string | null;
  rarity?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const collectorNumberNormalized = normalizeCollectorNumber(
    input.collectorNumber,
  );
  if (input.setId && collectorNumberNormalized) {
    const existing = (
      await db
        .select()
        .from(catalogueCardsTable)
        .where(
          and(
            eq(catalogueCardsTable.gameId, input.gameId),
            eq(catalogueCardsTable.setId, input.setId),
            eq(
              catalogueCardsTable.collectorNumberNormalized,
              collectorNumberNormalized,
            ),
            input.language
              ? eq(catalogueCardsTable.language, input.language)
              : isNull(catalogueCardsTable.language),
          ),
        )
        .limit(1)
    )[0];
    if (existing) {
      const [updated] = await db
        .update(catalogueCardsTable)
        .set({
          name: input.name,
          rarity: input.rarity ?? null,
          metadata: input.metadata ?? {},
          updatedAt: new Date(),
        })
        .where(eq(catalogueCardsTable.id, existing.id))
        .returning();
      return updated!;
    }
  }
  const [created] = await db
    .insert(catalogueCardsTable)
    .values({
      ...input,
      collectorNumberNormalized,
      metadata: input.metadata ?? {},
    })
    .returning();
  return created!;
}

export async function upsertCardVariant(input: {
  cardId: string;
  variantKey: string;
  name?: string | null;
  finish?: string | null;
  edition?: string | null;
  stamp?: string | null;
  language?: string | null;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(catalogueCardVariantsTable)
    .values({ ...input, metadata: input.metadata ?? {}, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        catalogueCardVariantsTable.cardId,
        catalogueCardVariantsTable.variantKey,
      ],
      set: {
        name: input.name ?? null,
        finish: input.finish ?? null,
        edition: input.edition ?? null,
        stamp: input.stamp ?? null,
        language: input.language ?? null,
        isDefault: input.isDefault ?? false,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function upsertExternalIdentity(input: {
  entityType: EntityType;
  entityId: string;
  providerKey: string;
  externalId: string;
  externalUrl?: string | null;
  externalSlug?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const existing = (
    await db
      .select()
      .from(catalogueExternalIdsTable)
      .where(
        and(
          eq(catalogueExternalIdsTable.providerKey, input.providerKey),
          eq(catalogueExternalIdsTable.entityType, input.entityType),
          eq(catalogueExternalIdsTable.externalId, input.externalId),
        ),
      )
      .limit(1)
  )[0];
  if (existing && existing.entityId !== input.entityId)
    throw new Error(
      "External identity already belongs to another canonical entity",
    );
  const [row] = await db
    .insert(catalogueExternalIdsTable)
    .values({ ...input, metadata: input.metadata ?? {}, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        catalogueExternalIdsTable.providerKey,
        catalogueExternalIdsTable.entityType,
        catalogueExternalIdsTable.externalId,
      ],
      set: {
        externalUrl: input.externalUrl ?? null,
        externalSlug: input.externalSlug ?? null,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function recordCatalogueProvenance(input: {
  entityType: EntityType;
  entityId: string;
  providerKey: string;
  externalId: string;
  payloadHash?: string | null;
  rawPayload?: Record<string, unknown> | null;
  sourceUpdatedAt?: Date | null;
  status?: string;
}) {
  const [row] = await db
    .insert(catalogueSourceRecordsTable)
    .values({
      ...input,
      rawPayload: input.rawPayload ?? null,
      status: input.status ?? "active",
      lastSeenAt: new Date(),
      lastImportedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        catalogueSourceRecordsTable.providerKey,
        catalogueSourceRecordsTable.entityType,
        catalogueSourceRecordsTable.externalId,
      ],
      set: {
        entityId: input.entityId,
        payloadHash: input.payloadHash ?? null,
        rawPayload: input.rawPayload ?? null,
        sourceUpdatedAt: input.sourceUpdatedAt ?? null,
        status: input.status ?? "active",
        lastSeenAt: new Date(),
        lastImportedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}
