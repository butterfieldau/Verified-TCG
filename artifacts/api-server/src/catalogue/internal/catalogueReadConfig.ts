/** Canonical reads are the default; operators can explicitly disable them. */
export function canonicalCatalogueReadsEnabled(env = process.env): boolean {
  const configured = env.CANONICAL_CATALOGUE_READS_ENABLED;
  if (configured == null || configured.trim() === "") return true;
  return !/^(0|false|no|off)$/i.test(configured);
}
