import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STARTUP_DIAGNOSTIC_STORAGE_KEY,
  flushStartupDiagnostics,
  getLastStartupDiagnostic,
  installStartupDiagnostics,
  recoverStartupTask,
  recordStartupPhase,
  sanitizeDiagnosticText,
  sanitizeStartupError,
} from '@/services/startupDiagnostics';

describe('startup diagnostics', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts credentials, bearer tokens, email addresses, and URL query values', () => {
    const sanitized = sanitizeDiagnosticText(
      'token=abc123 Authorization:Bearer-secret Bearer xyz user@example.com https://x.test/a?id=123&key=456',
    );

    expect(sanitized).not.toContain('abc123');
    expect(sanitized).not.toContain('xyz');
    expect(sanitized).not.toContain('user@example.com');
    expect(sanitized).not.toContain('123');
    expect(sanitized).not.toContain('456');
  });

  it('retains a sanitized fatal error and stack for symbolication', () => {
    const error = new Error('startup failed for user@example.com');
    error.stack = 'Error: startup failed\n    at RootLayout (app/_layout.tsx:27:1)';

    const diagnostic = recordStartupPhase('fatal-js-error', 'failure', error, true);

    expect(diagnostic).toMatchObject({
      phase: 'fatal-js-error',
      outcome: 'failure',
      fatal: true,
      error: {
        name: 'Error',
        message: 'startup failed for [redacted-email]',
      },
    });
    expect(diagnostic.error?.stack).toContain('app/_layout.tsx:27:1');
    expect(getLastStartupDiagnostic()).toEqual(diagnostic);
  });

  it('degrades a recoverable startup task without rethrowing', async () => {
    const fallback = await recoverStartupTask(
      'bootstrap-scan-state',
      Promise.reject(new Error('storage unavailable')),
      null,
    );

    expect(fallback).toBeNull();
    expect(getLastStartupDiagnostic()).toMatchObject({
      phase: 'bootstrap-scan-state',
      outcome: 'failure',
      fatal: false,
    });

    await flushStartupDiagnostics();
    const persisted = await AsyncStorage.getItem(STARTUP_DIAGNOSTIC_STORAGE_KEY);
    expect(persisted).toContain('bootstrap-scan-state');
    expect(sanitizeStartupError(new Error('Bearer abc')).message).not.toContain('abc');
  });

  it('records a fatal error before delegating to React Native original handler', () => {
    const originalHandler = jest.fn();
    let installedHandler: ((error: unknown, isFatal?: boolean) => void) | undefined;
    const diagnosticGlobal = globalThis as typeof globalThis & {
      ErrorUtils?: {
        getGlobalHandler: () => typeof originalHandler;
        setGlobalHandler: (handler: typeof installedHandler) => void;
      };
      __verifiedTcgStartupDiagnosticsInstalled?: boolean;
    };
    delete diagnosticGlobal.__verifiedTcgStartupDiagnosticsInstalled;
    diagnosticGlobal.ErrorUtils = {
      getGlobalHandler: () => originalHandler,
      setGlobalHandler: handler => {
        installedHandler = handler;
      },
    };

    installStartupDiagnostics();
    installedHandler?.(new Error('fatal startup failure'), true);

    expect(getLastStartupDiagnostic()).toMatchObject({
      phase: 'fatal-js-error',
      outcome: 'failure',
      fatal: true,
    });
    expect(originalHandler).toHaveBeenCalledWith(expect.any(Error), true);
  });
});