import { createVerify } from "node:crypto";

const EBAY_OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";
const PUBLIC_KEY_CACHE_TTL_MS = 15 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

type EbayEnvironment = "production" | "sandbox";

export interface EbayChallengeConfig {
  verificationToken: string;
  endpointUrl: string;
}

export interface EbayNotificationConfig extends EbayChallengeConfig {
  clientId: string;
  clientSecret: string;
  environment: EbayEnvironment;
}

interface ConfigResult<T> {
  config?: T;
  missing: string[];
}

interface DecodedSignature {
  keyId: string;
  signature: Buffer;
}

interface CachedPublicKey {
  key: string;
  expiresAt: number;
}

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

const publicKeyCache = new Map<string, CachedPublicKey>();
const accessTokenCache = new Map<EbayEnvironment, CachedAccessToken>();

type PublicKeyResolver = (
  keyId: string,
  config: EbayNotificationConfig,
) => Promise<string>;

let publicKeyResolverForTests: PublicKeyResolver | undefined;

function environmentFromEnv(): EbayEnvironment | null {
  const value = (process.env.EBAY_ENVIRONMENT ?? "production").trim().toLowerCase();
  if (value === "production" || value === "sandbox") return value;
  return null;
}

/**
 * Reads only the configuration needed for eBay's endpoint challenge.
 * Values never leave this module or appear in diagnostics.
 */
export function getEbayChallengeConfig(): ConfigResult<EbayChallengeConfig> {
  const missing: string[] = [];
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
  const endpointUrl = process.env.EBAY_ENDPOINT_URL;

  if (!verificationToken) missing.push("EBAY_VERIFICATION_TOKEN");
  if (!endpointUrl) missing.push("EBAY_ENDPOINT_URL");

  return missing.length > 0
    ? { missing }
    : { config: { verificationToken: verificationToken!, endpointUrl: endpointUrl! }, missing };
}

/**
 * Reads the additional server-only OAuth settings required to retrieve eBay's
 * signing public key. EBAY_APP_ID remains available for existing price lookup
 * code; signature verification requires a client secret and therefore uses the
 * dedicated OAuth client-ID setting.
 */
export function getEbayNotificationConfig(): ConfigResult<EbayNotificationConfig> {
  const challenge = getEbayChallengeConfig();
  const missing = [...challenge.missing];
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const environment = environmentFromEnv();

  if (!clientId) missing.push("EBAY_CLIENT_ID");
  if (!clientSecret) missing.push("EBAY_CLIENT_SECRET");
  if (!environment) missing.push("EBAY_ENVIRONMENT");

  if (missing.length > 0 || !challenge.config || !clientId || !clientSecret || !environment) {
    return { missing };
  }

  return {
    config: {
      ...challenge.config,
      clientId,
      clientSecret,
      environment,
    },
    missing: [],
  };
}

function isStrictBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * eBay encodes JSON like {"kid":"...","signature":"..."} in the
 * X-EBAY-SIGNATURE header. Decode it strictly before any external key lookup.
 */
export function decodeEbaySignatureHeader(header: string): DecodedSignature | null {
  if (!header || header.length > 16_384 || !isStrictBase64(header)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown;
    if (!isPlainObject(decoded)) return null;

    const keyId = decoded["kid"];
    const signature = decoded["signature"];
    if (
      typeof keyId !== "string" ||
      keyId.length === 0 ||
      keyId.length > 512 ||
      typeof signature !== "string" ||
      signature.length === 0 ||
      signature.length > 16_384 ||
      !isStrictBase64(signature)
    ) {
      return null;
    }

    return { keyId, signature: Buffer.from(signature, "base64") };
  } catch {
    return null;
  }
}

function formatPublicKey(value: string): string | null {
  const compact = value.replace(/\s/g, "");
  const begin = "-----BEGINPUBLICKEY-----";
  const end = "-----ENDPUBLICKEY-----";
  if (!compact.startsWith(begin) || !compact.endsWith(end)) return null;

  const encoded = compact.slice(begin.length, -end.length);
  if (!encoded || !isStrictBase64(encoded)) return null;
  const lines = encoded.match(/.{1,64}/g);
  if (!lines) return null;
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

function endpointsFor(environment: EbayEnvironment): {
  oauthUrl: string;
  notificationBaseUrl: string;
} {
  const baseUrl =
    environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  return {
    oauthUrl: `${baseUrl}/identity/v1/oauth2/token`,
    notificationBaseUrl: `${baseUrl}/commerce/notification/v1/public_key/`,
  };
}

async function getApplicationAccessToken(config: EbayNotificationConfig): Promise<string> {
  const cached = accessTokenCache.get(config.environment);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return cached.value;
  }

  const { oauthUrl } = endpointsFor(config.environment);
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString(
    "base64",
  );
  const response = await fetch(oauthUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(EBAY_OAUTH_SCOPE)}`,
  });
  if (!response.ok) throw new Error("eBay OAuth token request failed");

  const payload = (await response.json()) as unknown;
  if (!isPlainObject(payload) || typeof payload["access_token"] !== "string") {
    throw new Error("eBay OAuth token response was malformed");
  }
  const expiresIn =
    typeof payload["expires_in"] === "number" && payload["expires_in"] > 0
      ? payload["expires_in"]
      : 300;
  const accessToken = payload["access_token"];
  accessTokenCache.set(config.environment, {
    value: accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return accessToken;
}

async function fetchEbayPublicKey(
  keyId: string,
  config: EbayNotificationConfig,
): Promise<string> {
  const cacheKey = `${config.environment}:${keyId}`;
  const cached = publicKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const accessToken = await getApplicationAccessToken(config);
  const { notificationBaseUrl } = endpointsFor(config.environment);
  const response = await fetch(`${notificationBaseUrl}${encodeURIComponent(keyId)}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) throw new Error("eBay public-key request failed");

  const payload = (await response.json()) as unknown;
  if (!isPlainObject(payload) || typeof payload["key"] !== "string") {
    throw new Error("eBay public-key response was malformed");
  }
  const publicKey = formatPublicKey(payload["key"]);
  if (!publicKey) throw new Error("eBay public key was malformed");

  publicKeyCache.set(cacheKey, {
    key: publicKey,
    expiresAt: Date.now() + PUBLIC_KEY_CACHE_TTL_MS,
  });
  return publicKey;
}

async function resolveEbayPublicKey(
  keyId: string,
  config: EbayNotificationConfig,
): Promise<string> {
  return publicKeyResolverForTests
    ? publicKeyResolverForTests(keyId, config)
    : fetchEbayPublicKey(keyId, config);
}

/**
 * Verifies an eBay ECDSA signature over the exact HTTP bytes supplied by
 * Express' raw-body parser. eBay's official Node SDK uses `ssl3-sha1`; `sha1`
 * is the current Node crypto spelling for the same digest verification.
 */
export async function verifyEbayNotificationSignature(
  rawBody: Buffer,
  signatureHeader: string,
  config: EbayNotificationConfig,
): Promise<boolean> {
  const decoded = decodeEbaySignatureHeader(signatureHeader);
  if (!decoded) return false;

  try {
    const publicKey = await resolveEbayPublicKey(decoded.keyId, config);
    const verifier = createVerify("sha1");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(publicKey, decoded.signature);
  } catch {
    // A failed key retrieval or signature is intentionally indistinguishable to
    // callers. Never expose eBay response data, IDs, or credential state.
    return false;
  }
}

/**
 * Test-only seam for deterministic public-key verification without contacting
 * eBay. It is never configured by runtime code.
 */
export function setEbayPublicKeyResolverForTests(
  resolver: PublicKeyResolver | undefined,
): () => void {
  const previous = publicKeyResolverForTests;
  publicKeyResolverForTests = resolver;
  return () => {
    publicKeyResolverForTests = previous;
  };
}