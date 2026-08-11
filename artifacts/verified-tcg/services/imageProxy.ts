/**
 * Rewrites a raw CDN image URL to go through the API server's image-proxy
 * endpoint, which adds CORS headers so the browser can load card artwork.
 *
 * On web (Expo web / Replit preview) all image loads go through the proxy.
 * On native the CDN is reachable directly, but routing through the proxy is
 * harmless and keeps the code path uniform.
 */

const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

/**
 * Returns a proxied URL for the given CDN image URL.
 * If the URL is empty/nullish it is returned as-is so the caller's existing
 * fallback logic (gradient + letter) still fires naturally.
 */
export function proxyImageUrl(url: string | undefined | null): string {
  if (!url) return '';
  return `${API_BASE}/image-proxy?url=${encodeURIComponent(url)}`;
}
