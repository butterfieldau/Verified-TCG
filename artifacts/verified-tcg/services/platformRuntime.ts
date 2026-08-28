import Constants from 'expo-constants';
import { resolveApiOrigin } from './apiClient';
import { recordStartupPhase } from './startupDiagnostics';

export interface RuntimeConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  scannerEnabled: boolean;
  pricingEnabled: boolean;
  communityEnabled: boolean;
  minimumAppVersion: string;
  latestAppVersion: string;
  forceUpdate: boolean;
  remoteAnnouncement: string | null;
}

export interface UpdateRequirement {
  message: string;
  minimumVersion: string;
  currentVersion: string | null;
}

type UpdateListener = (requirement: UpdateRequirement) => void;
type RuntimeFetch = typeof globalThis.fetch;

interface FetchRuntimeState {
  originalFetch: RuntimeFetch;
  listeners: Set<UpdateListener>;
  installed: boolean;
}

type RuntimeGlobal = typeof globalThis & {
  __verifiedTcgVersionedFetch?: FetchRuntimeState;
};

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

function configuredApiHosts(): Set<string> {
  const hosts = new Set<string>();
  const values = [resolveApiOrigin()];
  for (const value of values) {
    if (!value) continue;
    try {
      hosts.add(new URL(value).host);
    } catch {
      // Invalid build-time API configuration will fail normally at request time.
    }
  }
  return hosts;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  return (input as Request).url;
}

export function isFirstPartyApiRequest(input: RequestInfo | URL): boolean {
  const raw = requestUrl(input);
  if (raw.startsWith('/api/') || raw === '/api') return true;
  try {
    const url = new URL(raw);
    return (
      configuredApiHosts().has(url.host) &&
      (url.pathname === '/api' || url.pathname.startsWith('/api/'))
    );
  } catch {
    return false;
  }
}

function updateRequirementFromResponse(response: Response): Promise<UpdateRequirement | null> {
  if (response.status !== 426) return Promise.resolve(null);
  return response
    .clone()
    .json()
    .then((body: unknown) => {
      if (!body || typeof body !== 'object') return null;
      const value = body as Record<string, unknown>;
      if (value.error !== 'update_required') return null;
      return {
        message:
          typeof value.message === 'string'
            ? value.message
            : 'A mandatory app update is required.',
        minimumVersion:
          typeof value.minimumVersion === 'string'
            ? value.minimumVersion
            : 'a newer version',
        currentVersion:
          typeof value.currentVersion === 'string' ? value.currentVersion : null,
      };
    })
    .catch(() => null);
}

export function createVersionedApiFetch(
  originalFetch: RuntimeFetch,
  notify: (requirement: UpdateRequirement) => void,
): RuntimeFetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isFirstPartyApiRequest(input)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request
        ? input.headers
        : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    // App code owns this value. Call sites cannot omit or override it.
    headers.set('x-app-version', APP_VERSION);

    const response = await originalFetch(input, { ...init, headers });
    void updateRequirementFromResponse(response)
      .then((requirement) => {
        if (requirement) notify(requirement);
      })
      .catch((error) => {
        recordStartupPhase('runtime-config-request', 'failure', error, false);
      });
    return response;
  }) as RuntimeFetch;
}

function runtimeState(): FetchRuntimeState {
  const global = globalThis as RuntimeGlobal;
  if (!global.__verifiedTcgVersionedFetch) {
    global.__verifiedTcgVersionedFetch = {
      originalFetch: globalThis.fetch.bind(globalThis),
      listeners: new Set<UpdateListener>(),
      installed: false,
    };
  }
  return global.__verifiedTcgVersionedFetch;
}

export function installVersionedApiFetch(): void {
  const state = runtimeState();
  if (state.installed) return;
  globalThis.fetch = createVersionedApiFetch(state.originalFetch, (requirement) => {
    for (const listener of state.listeners) listener(requirement);
  });
  state.installed = true;
}

export function onUpdateRequired(listener: UpdateListener): () => void {
  const state = runtimeState();
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const origin = resolveApiOrigin();
  if (!origin) throw new Error('Runtime configuration unavailable: API origin is not configured');
  const response = await fetch(`${origin}/api/runtime-config`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Runtime configuration unavailable (${response.status})`);
  }
  return (await response.json()) as RuntimeConfig;
}

export function compareAppVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    return match ? match.slice(1).map(Number) : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! < right[index]!) return -1;
    if (left[index]! > right[index]!) return 1;
  }
  return 0;
}

export function updateRequirementFromConfig(
  config: RuntimeConfig,
): UpdateRequirement | null {
  const target =
    config.forceUpdate && config.latestAppVersion !== '0.0.0'
      ? config.latestAppVersion
      : config.minimumAppVersion !== '0.0.0'
        ? config.minimumAppVersion
        : null;
  if (!target || compareAppVersions(APP_VERSION, target) >= 0) return null;
  return {
    message: config.forceUpdate
      ? 'A mandatory app update is required. Please update to continue.'
      : 'Your app version is no longer supported. Please update to continue.',
    minimumVersion: target,
    currentVersion: APP_VERSION,
  };
}
