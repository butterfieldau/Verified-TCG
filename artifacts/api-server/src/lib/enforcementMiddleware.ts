/**
 * Server-side enforcement middleware backed by platform configuration cache.
 *
 * Uses req.originalUrl (full path as seen by the proxy) so path comparisons
 * work correctly when the router is mounted at /api.
 *
 * - maintenance_mode: 503 all consumer routes; exempt owner operations, health,
 *   runtime config, exact auth recovery paths, and external lifecycle callbacks.
 * - scanner_enabled: 503 /api/scan.
 * - pricing_enabled: 503 /api/pricing, /api/graded-prices, /api/catalog/cards
 *   (price-exposing catalogue paths).
 * - community_enabled: 503 /api/community, /api/posts, /api/events, /api/collectors.
 * - x-app-version: required on consumer routes whenever a version policy is
 *   active; 400 when supplied but invalid; 426 when missing or below policy.
 *   0.0.0 policy values mean "no policy set".
 */
import type { Request, Response, NextFunction } from "express";
import { loadConfig, compareSemver, parseSemver } from "./platformConfig";

/** Exact paths needed for recovery, infrastructure, or external lifecycle calls. */
const OPERATIONAL_EXEMPT_EXACT: string[] = [
  "/api/healthz",
  "/api/runtime-config",
  "/api/auth/signin",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/recover",
  "/api/auth/reset-password",
  "/api/ebay/account-deletion",
];

/** Prefix exemptions use slash-boundary matching, never loose startsWith. */
const OPERATIONAL_EXEMPT_PREFIXES: string[] = ["/api/admin"];

function matchesPathBoundary(fullUrl: string, path: string): boolean {
  return fullUrl === path || fullUrl.startsWith(`${path}/`);
}

function isOperationalExempt(fullUrl: string): boolean {
  return (
    OPERATIONAL_EXEMPT_EXACT.includes(fullUrl) ||
    OPERATIONAL_EXEMPT_PREFIXES.some((path) =>
      matchesPathBoundary(fullUrl, path),
    )
  );
}

const SCANNER_PREFIXES = ["/api/scan"];
const PRICING_PREFIXES = [
  "/api/pricing",
  "/api/graded-prices",
  "/api/catalog/cards",
  "/api/catalog/market-movers",
  "/api/catalog/trending",
  "/api/catalog/recently-added",
];
const COMMUNITY_PREFIXES = [
  "/api/community",
  "/api/posts",
  "/api/events",
  "/api/collectors",
];

function matchesAny(url: string, prefixes: string[]): boolean {
  return prefixes.some((p) => url.startsWith(p));
}

export async function enforcePlatformConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Use originalUrl (full URL before any router stripping) and strip query string
  const rawUrl = req.originalUrl ?? req.url ?? "/";
  const fullUrl = rawUrl.includes("?") ? rawUrl.slice(0, rawUrl.indexOf("?")) : rawUrl;

  // loadConfig provides safe defaults — do NOT catch its errors silently
  const cfg = await loadConfig();

  // Maintenance mode
  if (cfg.maintenance_mode && !isOperationalExempt(fullUrl)) {
    res.status(503).json({
      error: "maintenance",
      message: cfg.maintenance_message || "The service is temporarily unavailable for maintenance. Please try again shortly.",
    });
    return;
  }

  // Scanner feature flag
  if (!cfg.scanner_enabled && matchesAny(fullUrl, SCANNER_PREFIXES)) {
    res.status(503).json({
      error: "feature_disabled",
      message: "Card scanning is temporarily unavailable.",
    });
    return;
  }

  // Pricing feature flag
  if (!cfg.pricing_enabled && matchesAny(fullUrl, PRICING_PREFIXES)) {
    res.status(503).json({
      error: "feature_disabled",
      message: "Pricing data is temporarily unavailable.",
    });
    return;
  }

  // Community feature flag
  if (!cfg.community_enabled && matchesAny(fullUrl, COMMUNITY_PREFIXES)) {
    res.status(503).json({
      error: "feature_disabled",
      message: "Community features are temporarily unavailable.",
    });
    return;
  }

  // App version enforcement. Recovery/admin/health/runtime-config routes remain
  // reachable so an outdated client can explain the policy and an owner can
  // safely reverse it.
  if (isOperationalExempt(fullUrl)) {
    next();
    return;
  }

  const minVersion = cfg.minimum_app_version;
  const forceUpdate = cfg.force_update;
  const latestVersion = cfg.latest_app_version;
  const forcedTarget =
    forceUpdate && latestVersion !== "0.0.0" ? latestVersion : null;
  const minimumTarget = minVersion !== "0.0.0" ? minVersion : null;
  const requiredVersion = forcedTarget ?? minimumTarget;
  const clientVersionRaw = req.get("x-app-version");
  if (!clientVersionRaw && requiredVersion) {
    res.status(426).json({
      error: "update_required",
      message: "This client must identify its app version before it can continue.",
      minimumVersion: requiredVersion,
      currentVersion: null,
    });
    return;
  }

  if (clientVersionRaw && !parseSemver(clientVersionRaw)) {
    res.status(400).json({
      error: "invalid_version",
      message: "x-app-version must be a valid semver string (e.g. 1.2.3).",
    });
    return;
  }

  if (clientVersionRaw && forcedTarget && compareSemver(clientVersionRaw, forcedTarget) < 0) {
    res.status(426).json({
      error: "update_required",
      message: "A mandatory app update is required. Please update to continue.",
      minimumVersion: forcedTarget,
      currentVersion: clientVersionRaw,
    });
    return;
  }

  if (clientVersionRaw && minimumTarget && compareSemver(clientVersionRaw, minimumTarget) < 0) {
    res.status(426).json({
      error: "update_required",
      message: "Your app version is no longer supported. Please update to continue.",
      minimumVersion: minimumTarget,
      currentVersion: clientVersionRaw,
    });
    return;
  }

  next();
}
