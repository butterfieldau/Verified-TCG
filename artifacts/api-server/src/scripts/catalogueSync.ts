import {
  runCatalogueImport,
  type CatalogueImportJobType,
} from "../catalogue/internal/catalogueSync.js";
import {
  cachedJustTcgCards,
  compareCachedJustTcgCoverage,
  createDatabaseCatalogueImportRepository,
  getCatalogueHealth,
  importJobCursor,
  latestSuccessfulJustTcgImport,
} from "../catalogue/internal/catalogueSyncRepository.js";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function positiveOption(name: string): number | undefined {
  const value = Number(option(name));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

const mode = option("--mode") ?? "full";
if (mode === "health") {
  console.log(JSON.stringify(await getCatalogueHealth(), null, 2));
  process.exit(0);
}
if (mode === "shadow") {
  console.log(
    JSON.stringify(
      await compareCachedJustTcgCoverage(
        positiveOption("--max-records") ?? 500,
      ),
      null,
      2,
    ),
  );
  process.exit(0);
}

const jobType: CatalogueImportJobType = [
  "full",
  "incremental",
  "set",
  "card",
  "reconciliation",
].includes(mode)
  ? (mode as CatalogueImportJobType)
  : "full";
const dryRun = process.argv.includes("--dry-run");
const setExternalId = option("--set");
const cardExternalId = option("--card");
if (jobType === "set" && !setExternalId)
  throw new Error("--set requires a JustTCG set ID");
if (jobType === "card" && !cardExternalId)
  throw new Error("--card requires a JustTCG card ID");

const priorSuccess =
  jobType === "incremental" ? await latestSuccessfulJustTcgImport() : null;
const resumeJobId = option("--resume");
const afterCursor = resumeJobId ? await importJobCursor(resumeJobId) : null;
const source = cachedJustTcgCards({
  updatedAfter: priorSuccess,
  setExternalId,
  cardExternalId,
  afterCursor,
  maxCacheEntries: positiveOption("--max-cache-entries"),
});
const result = await runCatalogueImport(
  createDatabaseCatalogueImportRepository(),
  source,
  {
    jobType,
    dryRun,
    batchSize: positiveOption("--batch-size"),
    metadata: {
      source: "durable_justtcg_cache",
      incrementalFallback:
        jobType === "incremental" && !priorSuccess
          ? "full_cache_scan"
          : undefined,
      cacheEntriesBound: positiveOption("--max-cache-entries") ?? null,
      resumedFromJobId: resumeJobId,
    },
  },
);
console.log(JSON.stringify(result, null, 2));
if (result.status === "failed") process.exitCode = 1;
