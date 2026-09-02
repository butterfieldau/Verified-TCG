const DEFAULT_CANONICAL_SITE_URL = "https://verifiedtcg.co";
const DEFAULT_SUPPORT_EMAIL = "support@verifiedtcg.co";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

type PublicEnvironment = Record<string, string | boolean | undefined>;

const runtimeEnvironment =
  (import.meta as ImportMeta & { env?: PublicEnvironment }).env ?? {};

function getBrowserOrigin(): string {
  return typeof window === "undefined" ? DEFAULT_CANONICAL_SITE_URL : window.location.origin;
}

function normaliseHttpUrl(value: string | undefined, fallback: string, origin: string): string {
  const candidate = value?.trim() || fallback;
  try {
    const url = new URL(candidate, origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback;
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normaliseOptionalHttpUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normaliseApiBase(value: string | undefined, origin: string): string {
  const fallback = `${origin}/api`;
  const base = normaliseHttpUrl(value, fallback, origin);
  return base.endsWith("/api") ? base : `${base}/api`;
}

export function isValidAppVersion(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

export interface PublicConfig {
  apiBaseUrl: string;
  canonicalSiteUrl: string;
  clientVersion: string;
  supportEmail: string;
  appUrl: string | null;
  iosStoreUrl: string | null;
  androidStoreUrl: string | null;
}

export function getPublicConfig(
  environment: PublicEnvironment = runtimeEnvironment,
  origin = getBrowserOrigin(),
): PublicConfig {
  const packageVersion = "1.0.0";
  const configuredVersion =
    typeof environment.VITE_APP_VERSION === "string"
      ? environment.VITE_APP_VERSION.trim()
      : undefined;
  const clientVersion =
    configuredVersion && isValidAppVersion(configuredVersion)
      ? configuredVersion
      : packageVersion;

  return {
    apiBaseUrl: normaliseApiBase(
      typeof environment.VITE_API_BASE_URL === "string"
        ? environment.VITE_API_BASE_URL
        : undefined,
      origin,
    ),
    canonicalSiteUrl: normaliseHttpUrl(
      typeof environment.VITE_CANONICAL_SITE_URL === "string"
        ? environment.VITE_CANONICAL_SITE_URL
        : undefined,
      DEFAULT_CANONICAL_SITE_URL,
      origin,
    ),
    clientVersion,
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    appUrl: normaliseOptionalHttpUrl(
      typeof environment.VITE_APP_URL === "string" ? environment.VITE_APP_URL : undefined,
    ),
    iosStoreUrl: normaliseOptionalHttpUrl(
      typeof environment.VITE_IOS_STORE_URL === "string"
        ? environment.VITE_IOS_STORE_URL
        : undefined,
    ),
    androidStoreUrl: normaliseOptionalHttpUrl(
      typeof environment.VITE_ANDROID_STORE_URL === "string"
        ? environment.VITE_ANDROID_STORE_URL
        : undefined,
    ),
  };
}

export const publicConfig = getPublicConfig();

export function buildApiUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), `${publicConfig.apiBaseUrl}/`).toString();
}

export function buildSiteUrl(path = "/"): string {
  return new URL(path.replace(/^\/+/, ""), `${publicConfig.canonicalSiteUrl}/`).toString();
}