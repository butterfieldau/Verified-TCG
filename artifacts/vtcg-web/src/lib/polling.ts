export function isLatestPanelRequest(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId;
}

export function panelFreshness(input: {
  hasData: boolean;
  error: string | null;
  lastSuccessAt: string | null;
}): "empty" | "current" | "stale" {
  if (!input.hasData) return "empty";
  return input.error || !input.lastSuccessAt ? "stale" : "current";
}

export function canReadPricingJobs(permissions: readonly string[] | undefined): boolean {
  return permissions?.includes("pricing:read") ?? false;
}