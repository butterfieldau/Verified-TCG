/** Helpers shared by future provider import jobs. No provider request is made here. */
export interface ImportCounters {
  recordsRead: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
}

export function emptyImportCounters(): ImportCounters {
  return {
    recordsRead: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
  };
}

/** Removes credential-bearing values before an upstream error reaches storage. */
export function sanitizeImportError(value: unknown): string {
  const message =
    value instanceof Error
      ? value.message
      : String(value ?? "Unknown import error");
  return message
    .replace(
      /([?&](?:token|api[_-]?key|key|authorization)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization:\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}
