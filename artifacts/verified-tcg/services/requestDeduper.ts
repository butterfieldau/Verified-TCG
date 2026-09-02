export interface RequestDeduper {
  run(task: () => Promise<void>): Promise<void>;
}

/**
 * Shares one in-flight request and permits a new request only after it settles.
 * This keeps pull-to-refresh gestures and focus events from overlapping.
 */
export function createRequestDeduper(): RequestDeduper {
  let inFlight: Promise<void> | null = null;
  return {
    run(task) {
      if (inFlight) return inFlight;
      const request = Promise.resolve().then(task);
      const tracked = request.finally(() => {
        if (inFlight === tracked) inFlight = null;
      });
      inFlight = tracked;
      return tracked;
    },
  };
}