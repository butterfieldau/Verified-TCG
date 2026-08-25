/** Server-only kill switch. Disabled by default so JustTCG remains unchanged. */
export function canonicalCatalogueReadsEnabled(env = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.CANONICAL_CATALOGUE_READS_ENABLED ?? "");
}
