/**
 * Platform configuration cache and accessor helpers.
 *
 * The cache is refreshed every 30 seconds so enforcement middleware
 * picks up changes without per-request DB reads.
 */
import { db, platformConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface PlatformConfigValues {
  maintenance_mode: boolean;
  maintenance_message: string;
  scanner_enabled: boolean;
  pricing_enabled: boolean;
  community_enabled: boolean;
  minimum_app_version: string;
  latest_app_version: string;
  force_update: boolean;
  remote_announcement: string;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfigValues = {
  maintenance_mode: false,
  maintenance_message: "",
  scanner_enabled: true,
  pricing_enabled: true,
  community_enabled: true,
  minimum_app_version: "0.0.0",
  latest_app_version: "0.0.0",
  force_update: false,
  remote_announcement: "",
};

let cachedConfig: PlatformConfigValues = { ...DEFAULT_PLATFORM_CONFIG };
let cacheExpiresAt = 0;

const CACHE_TTL_MS = 30_000;

export async function loadConfig(): Promise<PlatformConfigValues> {
  if (Date.now() < cacheExpiresAt) return cachedConfig;
  try {
    const rows = await db.select().from(platformConfigTable);
    const fresh = platformConfigFromRows(rows);
    cachedConfig = fresh;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return fresh;
  } catch (err) {
    logger.warn({ err }, "Failed to load platform config, using cached/defaults");
    return cachedConfig;
  }
}

export function platformConfigFromRows(
  rows: Array<{ key: string; value: string; valueType: string }>,
): PlatformConfigValues {
  const fresh: PlatformConfigValues = { ...DEFAULT_PLATFORM_CONFIG };
  const freshRecord = fresh as unknown as Record<string, unknown>;
  for (const row of rows) {
    const key = row.key as keyof PlatformConfigValues;
    if (!(key in DEFAULT_PLATFORM_CONFIG)) continue;
    freshRecord[key] = row.valueType === "boolean" ? row.value === "true" : row.value;
  }
  return fresh;
}

/** Validate relationships between independently editable version controls. */
export function validatePlatformConfigValues(values: PlatformConfigValues): string | null {
  if (values.force_update && values.latest_app_version === "0.0.0") {
    return "latest_app_version must be set before force_update can be enabled";
  }
  if (
    values.latest_app_version !== "0.0.0" &&
    values.minimum_app_version !== "0.0.0" &&
    compareSemver(values.minimum_app_version, values.latest_app_version) > 0
  ) {
    return "minimum_app_version cannot be greater than latest_app_version";
  }
  return null;
}

/** Invalidate cache immediately after a config write. */
export function invalidateConfigCache(): void {
  cacheExpiresAt = 0;
}

/** Read a single config row by key (uncached, for admin routes). */
export async function getConfigRow(key: string) {
  const [row] = await db
    .select()
    .from(platformConfigTable)
    .where(eq(platformConfigTable.key, key))
    .limit(1);
  return row ?? null;
}

/** Valid supported configuration controls */
export const SUPPORTED_CONFIG_KEYS = [
  "maintenance_mode",
  "maintenance_message",
  "scanner_enabled",
  "pricing_enabled",
  "community_enabled",
  "minimum_app_version",
  "latest_app_version",
  "force_update",
  "remote_announcement",
] as const;

export type ConfigKey = (typeof SUPPORTED_CONFIG_KEYS)[number];

export const CONFIG_KEY_TYPES: Record<ConfigKey, "boolean" | "string" | "semver"> = {
  maintenance_mode: "boolean",
  maintenance_message: "string",
  scanner_enabled: "boolean",
  pricing_enabled: "boolean",
  community_enabled: "boolean",
  minimum_app_version: "semver",
  latest_app_version: "semver",
  force_update: "boolean",
  remote_announcement: "string",
};

/** Parse a semver string like "1.2.3" into [major, minor, patch] */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!)];
}

/** Compare two semver strings: -1 if a<b, 0 if equal, 1 if a>b */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

/** Validate a value for a given config key type. Returns error string or null. */
export function validateConfigValue(key: ConfigKey, value: string): string | null {
  const t = CONFIG_KEY_TYPES[key];
  if (t === "boolean") {
    if (value !== "true" && value !== "false") {
      return `${key} must be 'true' or 'false'`;
    }
  } else if (t === "semver") {
    if (!parseSemver(value)) {
      return `${key} must be a valid semver string (e.g. 1.2.3)`;
    }
  } else {
    // string — enforce reasonable length
    if (value.length > 2000) {
      return `${key} value must be at most 2000 characters`;
    }
  }
  return null;
}
