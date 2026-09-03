/** Population data is intentionally cached for a day to protect provider limits. */
export const POPULATION_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export function isPopulationCacheFresh(capturedAt: Date | null, now = Date.now()): boolean {
  return Boolean(capturedAt && now - capturedAt.getTime() >= 0 && now - capturedAt.getTime() < POPULATION_CACHE_TTL_MS);
}
