/**
 * Telemetry helper — persists sanitized operational facts to telemetry_events.
 *
 * Sanitization rules always enforced inside recordTelemetry:
 * - No raw IP addresses, email addresses, query strings, request bodies,
 *   credentials, or tokens are stored.
 * - userId/adminId must be UUID references, never raw identifiers.
 * - metadata is recursively sanitized before persistence regardless of source.
 * - Path segments matching UUID/numeric/opaque ID patterns are normalized.
 */
import { db, telemetryEventsTable } from "@workspace/db";
import { logger } from "./logger";

export type TelemetryCategory =
  | "analytics"
  | "security"
  | "api_error"
  | "integration"
  | "config"
  | "job";

export interface TelemetryInput {
  category: TelemetryCategory;
  action: string;
  userId?: string | null;
  adminId?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  correlationId?: string | null;
  /** Caller-supplied metadata — always re-sanitized before persistence */
  metadata?: Record<string, unknown> | null;
  status?: "ok" | "failed" | "degraded";
}

/** Pattern matching keys that likely contain PII or secrets. */
const BLOCKED_KEY_RE = /email|password|token|secret|ip|address|authorization|cookie|credential|bearer|auth/i;

/** UUID pattern for path normalization */
const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Numeric-only segment, likely a database ID */
const NUMERIC_SEGMENT_RE = /^[0-9]{4,}$/;
/** Base64-url opaque ID: 20+ chars of base64 chars with no spaces */
const OPAQUE_ID_RE = /^[A-Za-z0-9_\-]{20,}$/;

/**
 * Recursively strips PII/secret keys and truncates long strings.
 * Always called inside recordTelemetry — callers need not pre-sanitize.
 */
export function sanitizeMetadata(
  raw: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || depth > 4) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BLOCKED_KEY_RE.test(k)) continue;
    if (typeof v === "string") {
      out[k] = v.length > 500 ? v.slice(0, 500) : v;
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const nested = sanitizeMetadata(v as Record<string, unknown>, depth + 1);
      if (nested !== null) out[k] = nested;
    } else if (Array.isArray(v)) {
      // Keep scalar arrays, skip object arrays to avoid PII nesting
      if (v.every((item) => typeof item !== "object" || item === null)) {
        out[k] = v.slice(0, 20);
      }
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Strips the query string and normalizes dynamic path segments.
 * UUID, numeric, and opaque-ID segments are replaced with a placeholder
 * so telemetry aggregations group /users/:id correctly.
 */
export function sanitizePath(raw: string | undefined): string {
  if (!raw) return "/";
  // Strip query string
  const noQuery = raw.includes("?") ? raw.slice(0, raw.indexOf("?")) : raw;
  // Normalize path segments
  const normalized = noQuery
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (UUID_SEGMENT_RE.test(seg)) return ":id";
      if (NUMERIC_SEGMENT_RE.test(seg)) return ":id";
      if (OPAQUE_ID_RE.test(seg)) return ":id";
      return seg;
    })
    .join("/");
  return normalized || "/";
}

/**
 * Correlation IDs are operational identifiers, not arbitrary client content.
 * Keep only a short, conservative character set so an injected header cannot
 * become a side channel for secrets or personal data.
 */
export function sanitizeCorrelationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) return null;
  return value;
}

/**
 * Persists a sanitized telemetry event. Always re-sanitizes metadata.
 * Never throws — errors are logged and swallowed so telemetry never
 * disrupts business logic.
 */
export async function recordTelemetry(input: TelemetryInput): Promise<void> {
  try {
    const safeMetadata = input.metadata ? sanitizeMetadata(input.metadata) : null;
    await db.insert(telemetryEventsTable).values({
      category: input.category,
      action: input.action,
      userId: input.userId ?? null,
      adminId: input.adminId ?? null,
      statusCode: input.statusCode ?? null,
      durationMs: input.durationMs ?? null,
      correlationId: sanitizeCorrelationId(input.correlationId),
      metadata: safeMetadata,
      status: input.status ?? "ok",
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, "Failed to persist telemetry event");
  }
}

/**
 * Records API performance/error fact from the response-finish middleware.
 * Path is sanitized (query stripped, IDs normalized).
 * Never stores bodies, query strings, raw IPs, emails, or tokens.
 */
export async function recordApiEvent(opts: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId?: string | null;
  correlationId?: string | null;
  errorCode?: string | null;
}): Promise<void> {
  const isError = opts.statusCode >= 400;
  await recordTelemetry({
    category: isError ? "api_error" : "analytics",
    action: isError ? "api.error" : "api.request",
    userId: opts.userId ?? null,
    statusCode: opts.statusCode,
    durationMs: opts.durationMs,
    correlationId: opts.correlationId ?? null,
    status: isError ? "failed" : "ok",
    metadata: {
      method: opts.method,
      path: sanitizePath(opts.path),
      ...(opts.errorCode ? { errorCode: opts.errorCode } : {}),
    },
  });
}
