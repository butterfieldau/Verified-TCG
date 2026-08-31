export type InitialRoute = '/(tabs)' | '/welcome';

export class InitialNavigationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Startup checks did not finish within ${timeoutMs}ms`);
    this.name = 'InitialNavigationTimeoutError';
  }
}

export async function resolveInitialRoute(
  restoreSession: () => Promise<unknown>,
  readOnboardingState: () => Promise<string | null>,
  timeoutMs = 10_000,
): Promise<InitialRoute> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new InitialNavigationTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });

  try {
    const [session, onboarded] = await Promise.race([
      Promise.all([restoreSession(), readOnboardingState()]),
      timeoutPromise,
    ]);
    return session || onboarded === 'true' ? '/(tabs)' : '/welcome';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}