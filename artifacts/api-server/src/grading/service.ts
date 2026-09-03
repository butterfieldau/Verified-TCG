import { and, desc, eq, sql } from "drizzle-orm";
import { db, gradingCardMappingsTable, gradingPopulationSnapshotsTable } from "@workspace/db";
import { GemRateProvider, GemRateUnavailableError } from "./gemrate.js";
import { isPopulationCacheFresh } from "./cache.js";
import type { CardGradingResponse, CardMatchInput, GraderKey, GraderPopulation, MatchStatus } from "./types.js";

const PROVIDER_KEY = "gemrate";

type CanonicalCard = CardMatchInput;

async function resolveCanonicalCard(publicCardId: string): Promise<CanonicalCard | null> {
  const result = await db.execute<Record<string, unknown>>(sql`
    SELECT c.id, g.name AS game, s.name AS set_name, c.name,
      c.collector_number, c.release_date, c.language, c.rarity, c.is_promo
    FROM catalogue_external_ids external_id
    JOIN catalogue_cards c ON c.id = external_id.entity_id
    JOIN catalogue_sets s ON s.id = c.set_id
    JOIN catalogue_games g ON g.id = c.game_id
    WHERE external_id.entity_type = 'card'
      AND external_id.provider_key = 'justtcg'
      AND external_id.external_id = ${publicCardId}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  const releaseDate = typeof row.release_date === "string" ? row.release_date : null;
  return {
    canonicalCardId: String(row.id), game: String(row.game), setName: String(row.set_name), name: String(row.name),
    collectorNumber: typeof row.collector_number === "string" ? row.collector_number : null,
    releaseYear: releaseDate?.slice(0, 4) ?? null,
    language: typeof row.language === "string" ? row.language : null,
    rarity: typeof row.rarity === "string" ? row.rarity : null,
    isPromo: Boolean(row.is_promo),
  };
}

function empty(cardId: string, status: CardGradingResponse["status"], stale = false): CardGradingResponse {
  return { cardId, status, graders: {}, source: { provider: "gemrate", updatedAt: null, stale } };
}

async function latestPopulation(canonicalCardId: string): Promise<{ graders: Partial<Record<GraderKey, GraderPopulation>>; capturedAt: Date | null; updatedAt: string | null }> {
  const rows = await db
    .select()
    .from(gradingPopulationSnapshotsTable)
    .where(and(eq(gradingPopulationSnapshotsTable.canonicalCardId, canonicalCardId), eq(gradingPopulationSnapshotsTable.providerKey, PROVIDER_KEY)))
    .orderBy(desc(gradingPopulationSnapshotsTable.capturedAt));
  const capturedAt = rows[0]?.capturedAt ?? null;
  if (!capturedAt) return { graders: {}, capturedAt: null, updatedAt: null };
  const graders: Partial<Record<GraderKey, GraderPopulation>> = {};
  for (const row of rows) {
    if (row.capturedAt.getTime() !== capturedAt.getTime()) continue;
    if (row.grader !== "psa" && row.grader !== "bgs" && row.grader !== "cgc") continue;
    const grader = row.grader as GraderKey;
    const bucket = graders[grader] ?? { label: grader === "bgs" ? "Beckett / BGS" : grader.toUpperCase(), totalPopulation: row.totalPopulation, gemRate: row.gemRate, grades: {} };
    bucket.grades[row.gradeCode] = { code: row.gradeCode, label: row.gradeLabel, rawLabel: row.rawGradeLabel, population: row.population };
    graders[grader] = bucket;
  }
  return { graders, capturedAt, updatedAt: rows[0]?.sourceUpdatedAt?.toISOString() ?? null };
}

async function persistPopulation(canonicalCardId: string, result: Awaited<ReturnType<GemRateProvider["getPopulation"]>>): Promise<void> {
  const capturedAt = new Date();
  const values = Object.entries(result.graders).flatMap(([grader, summary]) =>
    Object.values(summary.grades).map((grade) => ({
      canonicalCardId, providerKey: PROVIDER_KEY, grader, gradeCode: grade.code, gradeLabel: grade.label,
      rawGradeLabel: grade.rawLabel ?? null, population: grade.population, totalPopulation: summary.totalPopulation,
      gemRate: summary.gemRate, capturedAt, sourceUpdatedAt: result.sourceUpdatedAt ? new Date(result.sourceUpdatedAt) : null,
      metadata: {},
    })),
  );
  if (values.length) await db.insert(gradingPopulationSnapshotsTable).values(values);
}

async function upsertMapping(input: { canonicalCardId: string; providerCardId?: string | null; confidence?: number | null; method?: string | null; status: MatchStatus | "unmatched"; raw?: Record<string, unknown> }): Promise<void> {
  await db.insert(gradingCardMappingsTable).values({
    canonicalCardId: input.canonicalCardId, providerKey: PROVIDER_KEY, providerCardId: input.providerCardId ?? null,
    matchConfidence: input.confidence ?? null, matchMethod: input.method ?? null, matchStatus: input.status,
    providerMatch: input.raw ?? {}, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [gradingCardMappingsTable.canonicalCardId, gradingCardMappingsTable.providerKey],
    set: { providerCardId: input.providerCardId ?? null, matchConfidence: input.confidence ?? null, matchMethod: input.method ?? null, matchStatus: input.status, providerMatch: input.raw ?? {}, updatedAt: new Date() },
  });
}

export async function getCardGradingPopulation(cardId: string): Promise<CardGradingResponse> {
  const canonical = await resolveCanonicalCard(cardId);
  if (!canonical) return empty(cardId, "unmatched");
  const cached = await latestPopulation(canonical.canonicalCardId);
  const mapping = (await db.select().from(gradingCardMappingsTable).where(and(eq(gradingCardMappingsTable.canonicalCardId, canonical.canonicalCardId), eq(gradingCardMappingsTable.providerKey, PROVIDER_KEY))).limit(1))[0] ?? null;
  const fresh = isPopulationCacheFresh(cached.capturedAt);
  if (fresh && Object.keys(cached.graders).length) {
    return { cardId, status: "available", match: mapping ? { confidence: mapping.matchConfidence ?? 0, method: mapping.matchMethod ?? "cached", status: mapping.matchStatus as MatchStatus } : undefined, graders: cached.graders, source: { provider: "gemrate", updatedAt: cached.updatedAt, stale: false } };
  }
  if (mapping && mapping.matchStatus !== "confirmed") return empty(cardId, "unmatched", Boolean(cached.capturedAt));
  const provider = new GemRateProvider();
  try {
    let providerCardId = mapping?.providerCardId ?? null;
    let match = mapping;
    if (!providerCardId) {
      const found = await provider.searchCard(canonical);
      if (!found) { await upsertMapping({ canonicalCardId: canonical.canonicalCardId, status: "unmatched" }); return empty(cardId, "unmatched"); }
      await upsertMapping({ canonicalCardId: canonical.canonicalCardId, providerCardId: found.providerCardId, confidence: found.matchConfidence, method: found.matchMethod, status: found.status, raw: found.raw });
      if (found.status !== "confirmed") return empty(cardId, "unmatched");
      providerCardId = found.providerCardId;
      match = { matchConfidence: found.matchConfidence, matchMethod: found.matchMethod, matchStatus: found.status } as typeof mapping;
    }
    const population = await provider.getPopulation(providerCardId);
    await persistPopulation(canonical.canonicalCardId, population);
    return { cardId, status: Object.keys(population.graders).length ? "available" : "unavailable", match: match ? { confidence: match.matchConfidence ?? 0, method: match.matchMethod ?? "provider", status: match.matchStatus as MatchStatus } : undefined, graders: population.graders, source: { provider: "gemrate", updatedAt: population.sourceUpdatedAt, stale: false } };
  } catch (error) {
    if (Object.keys(cached.graders).length) return { cardId, status: "available", graders: cached.graders, source: { provider: "gemrate", updatedAt: cached.updatedAt, stale: true } };
    if (error instanceof GemRateUnavailableError) return empty(cardId, "unavailable");
    return empty(cardId, "unavailable");
  }
}
