/**
 * Events API service — talks to /api/events endpoints on the API server.
 *
 * Covers:
 *   - Listing active events
 *   - Joining / leaving an event
 *   - Checking participation status
 *   - Fetching trade matches for the current event
 */

import { getAccessToken } from '@/services/auth';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EventSummary {
  id: string;
  name: string;
  venue: string;
  city: string;
  eventDate: string;
  isActive: boolean;
  /** Lifecycle status from the API. Public endpoints only ever return 'live' or 'upcoming'. */
  status: string;
  participantCount: number;
}

export interface TradeMatchResult {
  participantUserId: string;
  displayName: string;
  username: string;
  theyHave: { cardId: string; name: string; set: string; grade: string }[];
  youHave: { cardId: string; name: string; set: string; grade: string }[];
  matchScore: number;
}

export interface TradeMatchesResponse {
  matchCount: number;
  matches: TradeMatchResult[];
  isProRequired: boolean;
}

export interface ActiveParticipationResponse {
  eventId: string | null;
  eventName: string | null;
  joinedAt?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function checkResponse(res: Response): Promise<void> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = body.message;
    } catch {}
    throw new Error(msg);
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function fetchActiveEvents(): Promise<EventSummary[]> {
  const res = await fetch(`${API_BASE}/api/events`);
  await checkResponse(res);
  return res.json();
}

export async function fetchEvent(eventId: string): Promise<EventSummary> {
  const res = await fetch(`${API_BASE}/api/events/${eventId}`);
  await checkResponse(res);
  return res.json();
}

// ── Participation ─────────────────────────────────────────────────────────────

export async function joinEvent(eventId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/events/${eventId}/join`, {
    method: 'POST',
    headers,
  });
  await checkResponse(res);
}

export async function leaveEvent(eventId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/events/${eventId}/leave`, {
    method: 'POST',
    headers,
  });
  await checkResponse(res);
}

export async function fetchMyParticipation(eventId: string): Promise<{
  isParticipating: boolean;
  joinedAt?: string;
}> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/events/${eventId}/my-participation`, {
    headers,
  });
  await checkResponse(res);
  return res.json();
}

/** Fetches the event (if any) the current user is actively participating in.
 *  Used at session restoration to rebuild currentEventId without requiring
 *  the user to navigate to Event Mode first. */
export async function fetchMyActiveParticipation(): Promise<ActiveParticipationResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/events/my-active-participation`, {
    headers,
  });
  await checkResponse(res);
  return res.json();
}

// ── Trade Matches ─────────────────────────────────────────────────────────────

export async function fetchTradeMatches(eventId: string): Promise<TradeMatchesResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/events/${eventId}/trade-matches`, {
    headers,
  });
  await checkResponse(res);
  return res.json();
}
