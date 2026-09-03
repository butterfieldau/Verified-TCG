import Constants from 'expo-constants';

const DEFAULT_TIMEOUT_MS = 15_000;
const RELEASE_API_ORIGIN = 'https://app.verifiedtcg.co';

export type ApiErrorKind =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'update_required'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'server';

export class ApiClientError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const API_APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/**
 * The one public API origin for a native release. It intentionally does not
 * fall back to a Replit editor/preview domain: such a fallback works in a
 * browser preview but is inaccessible or protected on a physical device.
 */
export function resolveApiOrigin(): string {
  const environmentOrigin = process.env.EXPO_PUBLIC_API_BASE_URL;
  const editorOrigin =
    __DEV__ &&
    environmentOrigin !== '' &&
    (!environmentOrigin || environmentOrigin.replace(/\/api\/?$/, '').replace(/\/$/, '') === RELEASE_API_ORIGIN) &&
    process.env.EXPO_PUBLIC_DOMAIN
      ? process.env.EXPO_PUBLIC_DOMAIN
      : null;
  const configured = (
    editorOrigin ??
    environmentOrigin ??
    (typeof Constants.expoConfig?.extra?.apiBaseUrl === 'string'
      ? Constants.expoConfig.extra.apiBaseUrl
      : RELEASE_API_ORIGIN)
  ).trim();
  if (!configured) return '';

  const withScheme = /^https?:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  try {
    const url = new URL(withScheme);
    const pathname = url.pathname;
    const path =
      pathname === '/'
        ? ''
        : pathname.endsWith('/')
          ? pathname.slice(0, -1)
          : pathname;
    if (path && path !== '/api') return '';
    // TestFlight/staging builds must always use TLS. HTTP remains useful only
    // for explicitly configured web/local development.
    if (!__DEV__ && url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function apiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === '/api' || normalized.startsWith('/api/')) return normalized;
  return `/api${normalized}`;
}

export function apiUrl(path: string): string {
  const origin = resolveApiOrigin();
  if (!origin) throw new ApiClientError(
    'configuration',
    'The app is not configured with a public API address.',
  );
  return `${origin}${apiPath(path)}`;
}

function errorKind(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'validation';
  if (status === 426) return 'update_required';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'provider_unavailable';
  return 'server';
}

function safeMessage(status: number, body: unknown, endpoint: string): string {
  if (status === 401) {
    return endpoint === '/api/auth/signin'
      ? 'Incorrect email or password.'
      : 'Your session has expired. Please sign in again.';
  }
  if (body && typeof body === 'object') {
    const value = body as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'error']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
  }
  // A non-JSON 403 is normally an upstream deployment/access-control response,
  // not an application authorisation decision. Never surface its HTML.
  if (status === 403 && !body) return 'The authentication service could not be reached. Please try again.';
  if (status === 403) return 'You are not allowed to perform this action.';
  if (status === 404) return 'The requested record could not be found.';
  if (status === 426) return 'A newer version of Verified TCG is required.';
  if (status === 429) return 'Too many requests. Please try again shortly.';
  if (status >= 500) return 'The service is temporarily unavailable. Please try again.';
  return 'The request could not be completed.';
}

export interface ApiRequestOptions extends RequestInit {
  accessToken?: string | null;
  timeoutMs?: number;
}

type UnauthorizedRecovery = () => Promise<string | null>;

// Auth owns the persisted refresh token, while this module owns the shared
// request transport. Registering the recovery callback avoids a circular
// dependency and lets every authenticated API call recover once when a server
// deployment invalidates an otherwise unexpired access token.
let unauthorizedRecovery: UnauthorizedRecovery | null = null;
let inFlightUnauthorizedRecovery: Promise<string | null> | null = null;

export function setUnauthorizedRecovery(recovery: UnauthorizedRecovery | null): void {
  unauthorizedRecovery = recovery;
}

async function recoverUnauthorizedAccessToken(): Promise<string | null> {
  if (!unauthorizedRecovery) return null;
  if (!inFlightUnauthorizedRecovery) {
    inFlightUnauthorizedRecovery = unauthorizedRecovery().finally(() => {
      inFlightUnauthorizedRecovery = null;
    });
  }
  return inFlightUnauthorizedRecovery;
}

/** A single transport for every mobile API call. */
export async function apiRequest(
  path: string,
  { accessToken, timeoutMs = DEFAULT_TIMEOUT_MS, headers: providedHeaders, ...init }: ApiRequestOptions = {},
): Promise<Response> {
  const endpoint = apiPath(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(providedHeaders);
  headers.set('Accept', 'application/json');
  headers.set('x-app-version', API_APP_VERSION);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  try {
    const makeRequest = (token: string | null | undefined) => {
      const requestHeaders = new Headers(headers);
      if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
      else requestHeaders.delete('Authorization');
      return fetch(apiUrl(endpoint), {
        ...init,
        headers: requestHeaders,
        signal: init.signal ?? controller.signal,
      });
    };

    let response = await makeRequest(accessToken);

    // A deployment can invalidate an access JWT before its locally-recorded
    // expiry (for example after a signing-key rotation). Refresh once and
    // replay the original safe API request instead of clearing the user's
    // session and leaving every authenticated screen offline. Auth endpoints
    // are explicitly excluded to prevent refresh recursion.
    if (
      response.status === 401 &&
      accessToken &&
      !endpoint.startsWith('/api/auth/')
    ) {
      const refreshedToken = await recoverUnauthorizedAccessToken();
      if (refreshedToken && refreshedToken !== accessToken) {
        response = await makeRequest(refreshedToken);
      }
    }
    if (response.ok) return response;

    const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? '';
    const body = contentType.includes('application/json')
      ? await (typeof response.clone === 'function' ? response.clone() : response).json().catch(() => null)
      : null;
    throw new ApiClientError(errorKind(response.status), safeMessage(response.status, body, endpoint), response.status, endpoint);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if ((error as { name?: string }).name === 'AbortError') {
      throw new ApiClientError('timeout', 'The request timed out. Please try again.', undefined, endpoint);
    }
    throw new ApiClientError('network', 'Unable to reach the Verified TCG service. Please check your connection.', undefined, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiJson<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const response = await apiRequest(path, options);
  return response.json() as Promise<T>;
}
