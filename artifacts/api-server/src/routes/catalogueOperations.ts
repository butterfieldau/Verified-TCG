import { Router } from "express";
import {
  cachedJustTcgCards,
  createDatabaseCatalogueImportRepository,
  latestSuccessfulJustTcgImport,
} from "../catalogue/internal/catalogueSyncRepository.js";
import { runCatalogueImport } from "../catalogue/internal/catalogueSync.js";
import { logger } from "../lib/logger.js";

const router = Router();

function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  return Number.isInteger(value) && (value as number) > 0
    ? Math.min(value as number, maximum)
    : fallback;
}

router.post("/catalogue/operations/import-cache", async (req, res) => {
  const suppliedSecret = req.headers["x-admin-secret"];
  const expectedSecret = process.env.ADMIN_SECRET;
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = body["mode"] === "full" ? "full" : "incremental";
  const reason =
    typeof body["reason"] === "string" ? body["reason"].trim() : "";
  if (
    reason.length < 10 ||
    reason.length > 500 ||
    body["confirmation"] !== "IMPORT CACHED CATALOGUE"
  ) {
    res.status(400).json({
      message:
        "Provide a reason of 10–500 characters and confirm with IMPORT CACHED CATALOGUE.",
    });
    return;
  }

  const maxCacheEntries = boundedInteger(body["maxCacheEntries"], 100, 1_000);
  const batchSize = boundedInteger(body["batchSize"], 100, 500);

  try {
    const priorSuccess =
      mode === "incremental" ? await latestSuccessfulJustTcgImport() : null;
    const result = await runCatalogueImport(
      createDatabaseCatalogueImportRepository(),
      cachedJustTcgCards({
        updatedAfter: priorSuccess,
        maxCacheEntries,
      }),
      {
        jobType: mode,
        batchSize,
        metadata: {
          source: "durable_justtcg_cache",
          trigger: "protected_operations_api",
          reason,
          cacheEntriesBound: maxCacheEntries,
          incrementalFallback:
            mode === "incremental" && !priorSuccess
              ? "full_cache_scan"
              : undefined,
        },
      },
    );

    res.status(result.status === "failed" ? 500 : 200).json({
      configured: true,
      mode,
      maxCacheEntries,
      result,
    });
  } catch (error) {
    logger.error({ error }, "Protected catalogue cache import failed");
    res.status(500).json({ message: "Catalogue cache import failed." });
  }
});

export default router;