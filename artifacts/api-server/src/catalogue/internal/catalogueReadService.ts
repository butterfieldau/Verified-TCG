import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordTelemetry } from "../../lib/telemetry.js";
import { normalizeForMatching } from "./catalogueNormalisation.js";
export { canonicalCatalogueReadsEnabled } from "./catalogueReadConfig.js";

export interface PublicCatalogueCard extends Record<string, unknown> {
  id: string;
  canonical_id: string;
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

function shapeCard(row: Record<string, unknown>): PublicCatalogueCard | null {
  if (
    !row.external_id ||
    !row.card_id ||
    !row.name ||
    !row.game ||
    !row.set_name
  )
    return null;
  return {
    id: String(row.external_id),
    canonical_id: String(row.card_id),
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
      ? (row.variants as Array<Record<string, unknown>>)
      : [],
  };
}

const CARD_SELECT = sql`
  SELECT e.external_id, c.id AS card_id, c.name, g.name AS game, s.name AS set_name,
    s.code AS set_code, c.collector_number, c.rarity, c.language, s.region,
    c.release_date,
    (SELECT i.url FROM catalogue_card_images i WHERE i.card_id = c.id AND i.is_primary = true ORDER BY i.created_at LIMIT 1) AS image_url,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'key', v.variant_key, 'name', v.name, 'finish', v.finish, 'edition', v.edition, 'stamp', v.stamp)) FROM catalogue_card_variants v WHERE v.card_id = c.id), '[]'::jsonb) AS variants
  FROM catalogue_external_ids e
  JOIN catalogue_cards c ON c.id = e.entity_id
  JOIN catalogue_sets s ON s.id = c.set_id
  JOIN catalogue_games g ON g.id = c.game_id
  WHERE e.provider_key = 'justtcg' AND e.entity_type = 'card'
`;

export async function findCanonicalPublicCard(
  externalId: string,
): Promise<PublicCatalogueCard | null> {
  try {
    const result = await db.execute<Record<string, unknown>>(
      sql`${CARD_SELECT} AND e.external_id = ${externalId} LIMIT 1`,
    );
    const card = result.rows[0] ? shapeCard(result.rows[0]) : null;
    void recordCatalogueReadMetric(
      "card_lookup",
      card ? "canonical_hit" : "fallback",
    );
    return card;
  } catch {
    void recordCatalogueReadMetric("card_lookup", "canonical_error");
    return null;
  }
}

export async function searchCanonicalPublicCards(input: {
  query: string;
  game?: string;
  limit: number;
  offset: number;
}): Promise<PublicCatalogueCard[]> {
  const query = input.query.trim();
  if (!query) return [];
  const matching = normalizeForMatching(query);
  try {
    const result = await db.execute<Record<string, unknown>>(sql`
      ${CARD_SELECT}
      AND (
        c.name ILIKE ${`%${query}%`} OR c.collector_number ILIKE ${`%${query}%`} OR
        s.name ILIKE ${`%${query}%`} OR s.code ILIKE ${`%${query}%`} OR
        EXISTS (SELECT 1 FROM catalogue_aliases a WHERE a.entity_type = 'card' AND a.entity_id = c.id AND a.alias_normalized ILIKE ${`%${matching}%`})
      )
      ${input.game ? sql`AND (g.name ILIKE ${`%${input.game}%`} OR g.slug = ${normalizeForMatching(input.game).replace(/\s+/g, "-")})` : sql``}
      ORDER BY c.name, s.name, c.collector_number
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);
    const cards = result.rows
      .map(shapeCard)
      .filter((card): card is PublicCatalogueCard => Boolean(card));
    void recordCatalogueReadMetric(
      "search",
      cards.length ? "canonical_hit" : "fallback",
    );
    return cards;
  } catch {
    void recordCatalogueReadMetric("search", "canonical_error");
    return [];
  }
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
  operation: "card_lookup" | "search" | "games",
  outcome: "canonical_hit" | "fallback" | "canonical_error" | "incomplete",
) {
  void recordTelemetry({
    category: "integration",
    action: "catalogue.canonical_read",
    status: outcome === "canonical_error" ? "failed" : "ok",
    metadata: { operation, outcome },
  });
}
