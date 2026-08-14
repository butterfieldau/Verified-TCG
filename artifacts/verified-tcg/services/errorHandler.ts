/**
 * Translates raw errors from API calls into human-readable messages.
 * Use this in every catch block that surfaces an error to the user.
 */
export function handleApiError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.';

  if (error instanceof Error) {
    const msg = error.message;
    const lower = msg.toLowerCase();

    // Network / connectivity
    if (
      lower.includes('network') ||
      lower.includes('failed to fetch') ||
      lower.includes('networkrequest') ||
      lower.includes('connect') ||
      lower.includes('econnrefused') ||
      lower.includes('timeout') ||
      lower.includes('aborterror')
    ) {
      return "Couldn't connect. Check your internet connection and try again.";
    }

    // Auth errors
    if (
      lower.includes('401') ||
      lower.includes('unauthorized') ||
      lower.includes('session expired') ||
      lower.includes('invalid token')
    ) {
      return 'Your session expired. Please sign in again.';
    }

    // Permission
    if (lower.includes('403') || lower.includes('forbidden')) {
      return "You don't have permission to do that.";
    }

    // Not found
    if (lower.includes('404') || lower.includes('not found')) {
      return 'This content could not be found.';
    }

    // Rate limit
    if (lower.includes('429') || lower.includes('too many')) {
      return 'Too many requests. Please wait a moment and try again.';
    }

    // Server errors
    if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('server')) {
      return 'Something went wrong on our end. Please try again.';
    }

    // Pass through clean messages that don't look like stack traces or codes
    if (msg.length < 200 && !msg.includes('TypeError') && !msg.includes('at ')) {
      return msg;
    }
  }

  return 'Something went wrong. Please try again.';
}

/** Returns true when the error looks like a network connectivity problem. */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('connect') ||
    lower.includes('timeout')
  );
}
