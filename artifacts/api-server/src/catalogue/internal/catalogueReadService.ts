import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordTelemetry } from "../../lib/telemetry.js";
import { normalizeForMatching } from "./catalogueNormalisation.js";
export { canonicalCatalogueReadsEnabled } from "./catalogueReadConfig.js";

export interface PublicCatalogueCard extends Record<string, unknown> {
  id: string;
  name: string;
  game: string;
  set: string;
  set_name: string;
  set_code: string | null;
  number: string | null;
  rarity: string | null;
  image_url: string | null;
  language: string | null;
  region: string | null;
  release_date: string | null;
  variants: Array<Record<string, unknown>>;
}

export type CatalogueReadOperation = "card_lookup" | "search" | "games";
export type CatalogueReadOutcome =
  | "canonical_hit"
  | "fallback"
  | "canonical_error"
  | "incomplete"
  | "unsupported_fallback";

type CatalogueMetricSample = {
  operation: CatalogueReadOperation;
  outcome: CatalogueReadOutcome;
  durationMs: number | null;
  delivery: "canonical" | "justtcg" | "mixed" | "failed";
};

const metricSamples: CatalogueMetricSample[] = [];
const MAX_METRIC_SAMPLES = 1_000;

export interface CatalogueReadMetrics {
  total: number;
  canonicalHits: number;
  justTcgFallbacks: number;
  mixedReads: number;
  canonicalErrors: number;
  unsupportedFallbacks: number;
  incompleteFallbacks: number;
  canonicalHitPercentage: number;
  fallbackPercentage: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
}

function percentage(value: number, total: number): number {
  return total ? Number(((value / total) * 100).toFixed(2)) : 0;
}

/** Returns process-local read metrics for acceptance and operational checks. */
export function getCatalogueReadMetrics(): CatalogueReadMetrics {
  const total = metricSamples.length;
  const canonicalHits = metricSamples.filter(
    (sample) => sample.delivery === "canonical",
  ).length;
  const justTcgFallbacks = metricSamples.filter(
    (sample) => sample.delivery === "justtcg",
  ).length;
  const mixedReads = metricSamples.filter(
    (sample) => sample.delivery === "mixed",
  ).length;
  const canonicalErrors = metricSamples.filter(
    (sample) => sample.outcome === "canonical_error",
  ).length;
  const unsupportedFallbacks = metricSamples.filter(
    (sample) => sample.outcome === "unsupported_fallback",
  ).length;
  const incompleteFallbacks = metricSamples.filter(
    (sample) => sample.outcome === "incomplete",
  ).length;
  const latencies = metricSamples
    .map((sample) => sample.durationMs)
    .filter((duration): duration is number => duration !== null)
    .sort((a, b) => a - b);
  const p95Index = latencies.length
    ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)
    : -1;
  return {
    total,
    canonicalHits,
    justTcgFallbacks,
    mixedReads,
    canonicalErrors,
    unsupportedFallbacks,
    incompleteFallbacks,
    canonicalHitPercentage: percentage(canonicalHits, total),
    fallbackPercentage: percentage(justTcgFallbacks, total),
    averageLatencyMs: latencies.length
      ? Number(
          (
            latencies.reduce((sum, duration) => sum + duration, 0) /
            latencies.length
          ).toFixed(2),
        )
      : null,
    p95LatencyMs: p95Index >= 0 ? latencies[p95Index]! : null,
  };
}

/** Clears process-local acceptance counters without changing persisted telemetry. */
export function resetCatalogueReadMetrics(): void {
  metricSamples.length = 0;
}

export function isUnsupportedCanonicalRecord(row: Record<string, unknown>): boolean {
  const game = normalizeForMatching(String(row.game ?? ""));
  const language = normalizeForMatching(String(row.language ?? ""));
  return (
    game === "pokemon" &&
    ["ja", "japanese", "jpn", "jp"].includes(language)
  );
}

export function shapeCanonicalCard(
  row: Record<string, unknown>,
): PublicCatalogueCard | null {
  if (
    !row.external_id ||
    !row.name ||
    !row.game ||
    !row.set_name
  )
    return null;
  return {
    id: String(row.external_id),
    name: String(row.name),
    game: String(row.game),
    set: String(row.set_code ?? row.set_name),
    set_name: String(row.set_name),
    set_code: typeof row.set_code === "string" ? row.set_code : null,
    number:
      typeof row.collector_number === "string" ? row.collector_number : null,
    rarity: typeof row.rarity === "string" ? row.rarity : null,
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    language: typeof row.language === "string" ? row.language : null,
    region: typeof row.region === "string" ? row.region : null,
    release_date:
      typeof row.release_date === "string" ? row.release_date : null,
    variants: Array.isArray(row.variants)
      ? (row.variants as Array<Record<string, unknown>>).map((variant) => ({
          key: typeof variant.key === "string" ? variant.key : null,
          name: typeof variant.name === "string" ? variant.name : null,
          finish: typeof variant.finish === "string" ? variant.finish : null,
          edition:
            typeof variant.edition === "string" ? variant.edition : null,
          stamp: typeof variant.stamp === "string" ? variant.stamp : null,
        }))
      : [],
  };
}

const CARD_SELECT = sql`
  SELECT e.external_id, c.id AS card_id, c.name, g.name AS game, s.name AS set_name,
    s.code AS set_code, c.collector_number, c.rarity, c.language, s.region,
    c.release_date,
    COALESCE(
      (SELECT i.url
       FROM catalogue_card_images i
       WHERE i.card_id = c.id AND i.is_primary = true
       ORDER BY i.created_at
       LIMIT 1),
      (SELECT 'https://product-images.tcgplayer.com/fit-in/1000x1000/'
          || NULLIF(source.raw_payload->>'tcgplayerId', '') || '.jpg'
       FROM catalogue_source_records source
       WHERE source.entity_type = 'card'
         AND source.entity_id = c.id
         AND source.provider_key = 'justtcg'
         AND (source.raw_payload->>'tcgplayerId') ~ '^[0-9]+$'
       ORDER BY source.last_seen_at DESC
       LIMIT 1)
    ) AS image_url,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('key', v.variant_key, 'name', v.name, 'finish', v.finish, 'edition', v.edition, 'stamp', v.stamp)) FROM catalogue_card_variants v WHERE v.card_id = c.id), '[]'::jsonb) AS variants
  FROM catalogue_external_ids e
  JOIN catalogue_cards c ON c.id = e.entity_id
  JOIN catalogue_sets s ON s.id = c.set_id
  JOIN catalogue_games g ON g.id = c.game_id
  WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
`;

export interface CanonicalReadResult<T> {
  value: T;
  outcome: CatalogueReadOutcome;
  durationMs: number;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function classifyCanonicalPage(
  rows: Record<string, unknown>[],
  deliveredCount: number,
): CatalogueReadOutcome {
  if (deliveredCount > 0 && deliveredCount === rows.length) return "canonical_hit";
  if (rows.some(isUnsupportedCanonicalRecord)) return "unsupported_fallback";
  return rows.length ? "incomplete" : "fallback";
}

export async function readCanonicalPublicCard(
  externalId: string,
): Promise<CanonicalReadResult<PublicCatalogueCard | null>> {
  const startedAt = Date.now();
  try {
    const result = await db.execute<Record<string, unknown>>(
      sql`${CARD_SELECT} AND e.external_id = ${externalId} LIMIT 1`,
    );
    const row = result.rows[0];
    const card =
      row && !isUnsupportedCanonicalRecord(row)
        ? shapeCanonicalCard(row)
        : null;
    const outcome: CatalogueReadOutcome = row
      ? isUnsupportedCanonicalRecord(row)
        ? "unsupported_fallback"
        : card
          ? "canonical_hit"
          : "incomplete"
      : "fallback";
    return { value: card, outcome, durationMs: Date.now() - startedAt };
  } catch {
    return {
      value: null,
      outcome: "canonical_error",
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function findCanonicalPublicCard(
  externalId: string,
): Promise<PublicCatalogueCard | null> {
  return (await readCanonicalPublicCard(externalId)).value;
}

export async function readCanonicalPublicCards(input: {
  query: string;
  game?: string;
  limit: number;
  offset: number;
}): Promise<CanonicalReadResult<PublicCatalogueCard[]>> {
  const startedAt = Date.now();
  const query = input.query.trim();
  if (!query) return { value: [], outcome: "fallback", durationMs: 0 };
  const matching = normalizeForMatching(query);
  try {
    const searchFilter = sql`
      AND c.is_active = true AND s.is_active = true AND g.is_active = true
      AND (
        c.name ILIKE ${`%${query}%`} OR c.collector_number ILIKE ${`%${query}%`} OR
        s.name ILIKE ${`%${query}%`} OR s.code ILIKE ${`%${query}%`} OR
        EXISTS (SELECT 1 FROM catalogue_aliases a WHERE a.entity_type = 'card' AND a.entity_id = c.id AND a.alias_normalized ILIKE ${`%${matching}%`})
      )
      ${input.game ? sql`AND (g.name ILIKE ${`%${input.game}%`} OR g.slug = ${normalizeForMatching(input.game).replace(/\s+/g, "-")})` : sql``}
      AND NOT (
        (g.name ILIKE '%pokemon%' OR g.slug = 'pokemon')
        AND LOWER(COALESCE(c.language, '')) IN ('ja', 'japanese', 'jpn', 'jp')
      )
    `;
    const [result, countResult] = await Promise.all([
      db.execute<Record<string, unknown>>(sql`
       ${CARD_SELECT}
       ${searchFilter}
      ORDER BY c.name, s.name, c.collector_number
      LIMIT ${input.limit} OFFSET ${input.offset}
      `),
      db.execute<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM catalogue_external_ids e
        JOIN catalogue_cards c ON c.id = e.entity_id
        JOIN catalogue_sets s ON s.id = c.set_id
        JOIN catalogue_games g ON g.id = c.game_id
        WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
        ${searchFilter}
      `),
    ]);
    const supportedRows = result.rows.filter(
      (row) => !isUnsupportedCanonicalRecord(row),
    );
    const cards = supportedRows
      .map(shapeCanonicalCard)
      .filter((card): card is PublicCatalogueCard => Boolean(card));
    const outcome = classifyCanonicalPage(result.rows, cards.length);
    const total = Number(countResult.rows[0]?.total ?? cards.length);
    return {
      value: cards,
      outcome,
      durationMs: Date.now() - startedAt,
      pagination: {
        total,
        limit: input.limit,
        offset: input.offset,
        hasMore: input.offset + cards.length < total,
      },
    };
  } catch {
    return {
      value: [],
      outcome: "canonical_error",
      durationMs: Date.now() - startedAt,
      pagination: {
        total: 0,
        limit: input.limit,
        offset: input.offset,
        hasMore: false,
      },
    };
  }
}

export async function searchCanonicalPublicCards(input: {
  query: string;
  game?: string;
  limit: number;
  offset: number;
}): Promise<PublicCatalogueCard[]> {
  return (await readCanonicalPublicCards(input)).value;
}

export async function canonicalCatalogueGames(): Promise<
  Array<{ id: string; name: string; slug: string }>
> {
  try {
    const result = await db.execute<{ id: string; name: string; slug: string }>(
      sql`SELECT id, name, slug FROM catalogue_games WHERE is_active = true ORDER BY sort_order, name`,
    );
    return result.rows;
  } catch {
    void recordCatalogueReadMetric("games", "canonical_error");
    return [];
  }
}

export function deduplicatePublicCards<T extends Record<string, unknown>>(
  canonical: PublicCatalogueCard[],
  fallback: T[],
): Array<PublicCatalogueCard | T> {
  const seen = new Set(canonical.map((card) => card.id));
  return [
    ...canonical,
    ...fallback.filter((card) => !seen.has(String(card.id ?? ""))),
  ];
}

export function recordCatalogueReadMetric(
  operation: CatalogueReadOperation,
  outcome: CatalogueReadOutcome,
  durationMs: number | null = null,
  delivery:
    | "canonical"
    | "justtcg"
    | "mixed"
    | "failed" = outcome === "canonical_hit" ? "canonical" : "justtcg",
) {
  metricSamples.push({ operation, outcome, durationMs, delivery });
  if (metricSamples.length > MAX_METRIC_SAMPLES) metricSamples.shift();
  const metrics = getCatalogueReadMetrics();
  void recordTelemetry({
    category: "integration",
    action: "catalogue.canonical_read",
    status: outcome === "canonical_error" ? "failed" : "ok",
    durationMs,
    metadata: {
      operation,
      outcome,
      delivery,
      canonicalHitPercentage: metrics.canonicalHitPercentage,
      fallbackPercentage: metrics.fallbackPercentage,
    },
  });
}
