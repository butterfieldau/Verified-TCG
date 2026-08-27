/**
 * Notification service — real API-backed implementation.
 *
 * All functions require the user to be authenticated (JWT token retrieved via
 * getAccessToken()). Unauthenticated calls return sensible empty defaults.
 */

import { getAccessToken } from './auth';
import { apiRequest } from './apiClient';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Notification types as stored in the database.
 * price_alert  — wishlist card reached target price
 * trade_match  — new event trade match found
 * follower     — someone followed the user
 * community    — like / comment
 * system       — Pro update, security alert, welcome
 */
export type NotifType =
  | 'price_alert'
  | 'trade_match'
  | 'follower'
  | 'community'
  | 'system';

export interface NotifMetadata {
  cardId?: string;
  cardName?: string;
  currentPrice?: number;
  eventId?: string;
  matchUserId?: string;
  followerId?: string;
  followerUsername?: string;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  /** Metadata from the server — absent for client-generated notifications */
  metadata?: NotifMetadata;
  isRead: boolean;
  /** ISO timestamp from server — absent for client-generated notifications */
  createdAt?: string;
  /** Human-readable relative time — computed client-side */
  time: string;
  /** Optional CTA label shown in the notification row */
  actionLabel?: string;
  /** Expo Router href to push on tap — derived from type + metadata */
  route?: string;
}

export interface NotificationsPage {
  notifications: Notification[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return apiRequest(path, { ...init, accessToken: token });
}

// ── Time formatting ───────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

// ── Deep-link routing ─────────────────────────────────────────────────────────

function deriveRoute(type: string, meta: NotifMetadata): string | undefined {
  switch (type) {
    case 'price_alert':
      return meta.cardId ? `/card/${meta.cardId}` : '/wishlist';
    case 'trade_match':
      return meta.eventId ? '/trade-match' : '/trade-match';
    case 'follower':
      return meta.followerUsername ? `/collector/${meta.followerUsername}` : undefined;
    case 'community':
      return meta.cardId ? `/card/${meta.cardId}` : undefined;
    case 'system':
      return undefined;
    default:
      return undefined;
  }
}

function deriveActionLabel(type: string): string | undefined {
  switch (type) {
    case 'price_alert': return 'View Card';
    case 'trade_match': return 'View Matches';
    case 'follower':    return 'View Profile';
    case 'community':  return 'View Card';
    default:           return undefined;
  }
}

function enrichRow(raw: {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: NotifMetadata;
  isRead: boolean;
  createdAt: string;
}): Notification {
  const type = raw.type as NotifType;
  const meta = raw.metadata ?? {};
  return {
    id: raw.id,
    type,
    title: raw.title,
    body: raw.body,
    metadata: meta,
    isRead: raw.isRead,
    createdAt: raw.createdAt,
    time: relativeTime(raw.createdAt),
    actionLabel: deriveActionLabel(raw.type),
    route: deriveRoute(raw.type, meta),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a page of notifications for the authenticated user.
 *
 * Throws on network failure or server error so callers can distinguish
 * "request failed" (preserve existing state) from "empty result" (no data).
 * Returns an empty page only when the user is unauthenticated (no token).
 */
export async function fetchNotifications(page = 1, limit = 20): Promise<NotificationsPage> {
  const token = await getAccessToken();
  if (!token) return emptyPage(page, limit); // unauthenticated — expected empty state

  const res = await authedFetch(`/api/notifications?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error(`fetchNotifications failed: ${res.status}`);
  const data = await res.json() as {
    notifications: Array<{
      id: string; type: string; title: string; body: string;
      metadata: NotifMetadata; isRead: boolean; createdAt: string;
    }>;
    page: number; limit: number; total: number; hasMore: boolean;
  };
  return {
    notifications: data.notifications.map(enrichRow),
    page: data.page,
    limit: data.limit,
    total: data.total,
    hasMore: data.hasMore,
  };
}

function emptyPage(page: number, limit: number): NotificationsPage {
  return { notifications: [], page, limit, total: 0, hasMore: false };
}

/**
 * Fetch the current unread notification count.
 *
 * Throws on network failure or server error so callers can preserve existing
 * badge count when offline. Returns 0 only when unauthenticated (no token).
 */
export async function fetchUnreadCount(): Promise<number> {
  const token = await getAccessToken();
  if (!token) return 0; // unauthenticated — expected zero

  const res = await authedFetch('/api/notifications/count');
  if (!res.ok) throw new Error(`fetchUnreadCount failed: ${res.status}`);
  const data = await res.json() as { unreadCount: number };
  return data.unreadCount ?? 0;
}

/**
 * Mark a single notification as read on the server.
 */
export async function markNotificationReadOnServer(id: string): Promise<void> {
  try {
    await authedFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
  } catch {
    // Silently swallow — optimistic update already applied locally
  }
}

/**
 * Mark all notifications as read on the server.
 */
export async function markAllNotificationsReadOnServer(): Promise<void> {
  try {
    await authedFetch('/api/notifications/read-all', { method: 'POST' });
  } catch {
    // Silently swallow — optimistic update already applied locally
  }
}

/**
 * Register an Expo push token for the authenticated user.
 * Safe to call multiple times — the server upserts on conflict.
 * Will NOT override a collector-preference opt-out on the server side.
 */
export async function registerPushToken(token: string): Promise<void> {
  try {
    await authedFetch('/api/notifications/register-push-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  } catch {
    // Non-critical — push delivery is out of scope for MVP
  }
}

// ── Push preference ───────────────────────────────────────────────────────────

export interface NotificationPreference {
  pushEnabled: boolean;
  source: string | null;
  optedOutAt: string | null;
}

/**
 * Fetch the current server-side push notification preference for the
 * authenticated user. Throws on network/server error; returns null when
 * unauthenticated.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreference | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const res = await authedFetch('/api/notifications/preferences');
  if (!res.ok) throw new Error(`fetchNotificationPreferences failed: ${res.status}`);
  return res.json() as Promise<NotificationPreference>;
}

/**
 * Persist the master push-enabled preference to the server.
 * This is the collector-controlled opt-in/opt-out and is never silently
 * overridden by a later token registration.
 *
 * Throws on failure so callers can show a visible error.
 */
export async function setPushPreference(enabled: boolean): Promise<void> {
  const res = await authedFetch('/api/notifications/push-preference', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Failed to update push preference (${res.status})`);
  }
}

// ── Collector announcements ───────────────────────────────────────────────────

export interface CollectorAnnouncement {
  id: string;
  title: string;
  content: string;
  audience: string;
  publishedAt: string;
  createdAt: string;
}

export interface CollectorAnnouncementsResponse {
  announcements: CollectorAnnouncement[];
  tier: string;
}

/**
 * Fetch in-app announcements for the authenticated collector.
 * Returns published + scheduled-and-due announcements filtered by
 * the collector's subscription tier. Excludes internal audience records.
 *
 * Does NOT imply push or email delivery — in-app read feed only.
 * Returns empty list when unauthenticated.
 */
export async function fetchCollectorAnnouncements(): Promise<CollectorAnnouncementsResponse> {
  const token = await getAccessToken();
  if (!token) return { announcements: [], tier: 'free' };

  const res = await authedFetch('/api/collector/announcements');
  if (!res.ok) throw new Error(`fetchCollectorAnnouncements failed: ${res.status}`);
  return res.json() as Promise<CollectorAnnouncementsResponse>;
}
