import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const LOOKUP_BUCKET_MS = 12 * 60 * 60 * 1_000;
const LOOKUP_RETENTION_DAYS = 30;
const countedContributions = new Set<string>();
let contributionBucketStart = 0;

export interface TrendingLookup {
  cardId: string;
  lookupCount: number;
  bucketStart: string;
  bucketEnd: string;
}

function bucketStartFor(date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / LOOKUP_BUCKET_MS) * LOOKUP_BUCKET_MS);
}

/**
 * Record an explicit card-detail lookup without retaining search text, user
 * IDs, IP addresses, or device identifiers. Card IDs are canonical public
 * catalogue identities, not personal data.
 */
export async function recordCardLookup(cardId: string, contributorId: string): Promise<boolean> {
  if (!cardId.trim() || cardId.length > 300 || !contributorId) return false;
  const bucketStart = bucketStartFor();
  const bucketStartMs = bucketStart.getTime();
  if (contributionBucketStart !== bucketStartMs) {
    countedContributions.clear();
    contributionBucketStart = bucketStartMs;
  }
  const contributionKey = `${contributorId}:${cardId.trim()}`;
  if (countedContributions.has(contributionKey)) return false;
  countedContributions.add(contributionKey);
  try {
    await db.execute(sql`
      INSERT INTO card_lookup_buckets (card_id, bucket_start, lookup_count)
      VALUES (${cardId.trim()}, ${bucketStart}, 1)
      ON CONFLICT (card_id, bucket_start) DO UPDATE
        SET lookup_count = card_lookup_buckets.lookup_count + 1,
            updated_at = NOW()
    `);
    await db.execute(sql`
      DELETE FROM card_lookup_buckets
      WHERE bucket_start < NOW() - (${LOOKUP_RETENTION_DAYS} * INTERVAL '1 day')
    `);
    return true;
  } catch (error) {
    countedContributions.delete(contributionKey);
    throw error;
  }
}

export async function getTrendingLookups(limit = 8): Promise<TrendingLookup[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 40);
  const result = await db.execute<{
    card_id: string;
    lookup_count: number;
    bucket_start: Date;
  }>(sql`
    SELECT card_id, lookup_count, bucket_start
    FROM card_lookup_buckets
    WHERE bucket_start = ${bucketStartFor()}
      AND lookup_count > 0
    ORDER BY lookup_count DESC, card_id ASC
    LIMIT ${safeLimit}
  `);
  return result.rows.map(row => {
    const start = new Date(row.bucket_start);
    return {
      cardId: row.card_id,
      lookupCount: Number(row.lookup_count),
      bucketStart: start.toISOString(),
      bucketEnd: new Date(start.getTime() + LOOKUP_BUCKET_MS).toISOString(),
    };
  });
}