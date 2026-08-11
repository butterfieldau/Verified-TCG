/**
 * Rewrites a raw CDN image URL to go through the API server's image-proxy
 * endpoint on web (browser) only.
 *
 * Native apps (iOS / Android) can reach CDN hosts directly — CORS headers are
 * a browser-only concern.  Routing through the proxy on native requires a
 * fully-qualified EXPO_PUBLIC_API_BASE_URL which may not be set, turning the
 * URL into a broken relative path.  So on native we return the original URL
 * unchanged.
 */

import { Platform } from 'react-native';

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

/**
 * Returns a proxied URL on web, or the original CDN URL on native.
 * If the URL is empty/nullish it is returned as-is so the caller's existing
 * fallback logic (gradient + letter initial) still fires naturally.
 */
export function proxyImageUrl(url: string | undefined | null): string {
  if (!url) return '';
  // Native can load CDN images directly — no proxy needed.
  if (Platform.OS !== 'web') return url;
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
}
