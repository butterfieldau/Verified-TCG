type StartupOutcome = 'started' | 'success' | 'failure';

export type StartupPhase =
  | 'js-entry'
  | 'api-fetch-install'
  | 'splash-setup'
  | 'font-load'
  | 'settings-provider'
  | 'runtime-config-gate'
  | 'runtime-config-request'
  | 'app-provider'
  | 'notification-setup'
  | 'bootstrap-watchlist'
  | 'bootstrap-prices'
  | 'bootstrap-scan-state'
  | 'bootstrap-alerts'
  | 'bootstrap-processing'
  | 'session-restore'
  | 'initial-navigation'
  | 'fatal-js-error';

interface SanitizedError {
  name: string;
  message: string;
  stack?: string;
}

export interface StartupDiagnostic {
  phase: StartupPhase;
  outcome: StartupOutcome;
  timestamp: string;
  fatal?: boolean;
  error?: SanitizedError;
}

type ErrorUtilsLike = {
  getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

type DiagnosticGlobal = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
  __verifiedTcgStartupDiagnosticsInstalled?: boolean;
};

declare const require: (moduleName: string) => {
  default?: {
    setItem: (key: string, value: string) => Promise<void>;
  };
  setItem?: (key: string, value: string) => Promise<void>;
};

export const STARTUP_DIAGNOSTIC_STORAGE_KEY = '@verified_tcg/startup_diagnostic_v1';

const SECRET_ASSIGNMENT = /\b(authorization|password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_QUERY = /([?&])[^=\s&]+=[^&\s)]+/g;

let lastDiagnostic: StartupDiagnostic | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let diagnosticStorage:
  | { setItem: (key: string, value: string) => Promise<void> }
  | undefined;

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}

export function sanitizeDiagnosticText(value: unknown, maximum = 600): string {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return truncate(
    raw
      .replace(SECRET_ASSIGNMENT, '$1=[redacted]')
      .replace(BEARER_TOKEN, 'Bearer [redacted]')
      .replace(EMAIL, '[redacted-email]')
      .replace(URL_QUERY, '$1[redacted]'),
    maximum,
  );
}

export function sanitizeStartupError(error: unknown): SanitizedError {
  if (error instanceof Error) {
    return {
      name: sanitizeDiagnosticText(error.name || 'Error', 100),
      message: sanitizeDiagnosticText(error.message || 'Unknown startup error'),
      ...(error.stack ? { stack: sanitizeDiagnosticText(error.stack, 4_000) } : {}),
    };
  }
  return {
    name: 'Error',
    message: sanitizeDiagnosticText(error || 'Unknown startup error'),
  };
}

function persistDiagnostic(diagnostic: StartupDiagnostic): void {
  if (!diagnosticStorage) {
    const module = require('@react-native-async-storage/async-storage');
    const storage = module.default ?? module;
    if (!storage.setItem) return;
    diagnosticStorage = storage as {
      setItem: (key: string, value: string) => Promise<void>;
    };
  }
  const storage = diagnosticStorage;
  persistenceQueue = persistenceQueue
    .then(() =>
      storage.setItem(
        STARTUP_DIAGNOSTIC_STORAGE_KEY,
        JSON.stringify(diagnostic),
      ),
    )
    .catch(() => {
      // Diagnostics must never introduce a second startup failure.
    });
}

export function recordStartupPhase(
  phase: StartupPhase,
  outcome: StartupOutcome,
  error?: unknown,
  fatal?: boolean,
): StartupDiagnostic {
  const diagnostic: StartupDiagnostic = {
    phase,
    outcome,
    timestamp: new Date().toISOString(),
    ...(fatal === undefined ? {} : { fatal }),
    ...(error === undefined ? {} : { error: sanitizeStartupError(error) }),
  };
  lastDiagnostic = diagnostic;
  persistDiagnostic(diagnostic);

  const serialized = JSON.stringify(diagnostic);
  if (outcome === 'failure') {
    console.error(`[VTCG_STARTUP] ${serialized}`);
  } else {
    console.info(`[VTCG_STARTUP] ${serialized}`);
  }
  return diagnostic;
}

export function getLastStartupDiagnostic(): StartupDiagnostic | null {
  return lastDiagnostic;
}

export function flushStartupDiagnostics(): Promise<void> {
  return persistenceQueue;
}

export function installStartupDiagnostics(): void {
  const diagnosticGlobal = globalThis as DiagnosticGlobal;
  if (diagnosticGlobal.__verifiedTcgStartupDiagnosticsInstalled) return;
  diagnosticGlobal.__verifiedTcgStartupDiagnosticsInstalled = true;

  const errorUtils = diagnosticGlobal.ErrorUtils;
  const originalHandler = errorUtils?.getGlobalHandler?.();
  if (errorUtils?.setGlobalHandler && originalHandler) {
    errorUtils.setGlobalHandler((error, isFatal) => {
      recordStartupPhase('fatal-js-error', 'failure', error, Boolean(isFatal));
      originalHandler(error, isFatal);
    });
  }
}

export async function recoverStartupTask<T>(
  phase: StartupPhase,
  task: Promise<T>,
  fallback: T,
): Promise<T> {
  recordStartupPhase(phase, 'started');
  try {
    const result = await task;
    recordStartupPhase(phase, 'success');
    return result;
  } catch (error) {
    recordStartupPhase(phase, 'failure', error, false);
    return fallback;
  }
}