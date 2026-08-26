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
import { apiJson, apiRequest } from './apiClient';

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

async function authToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function fetchActiveEvents(): Promise<EventSummary[]> {
  return apiJson<EventSummary[]>('/api/events');
}

export async function fetchEvent(eventId: string): Promise<EventSummary> {
  return apiJson<EventSummary>(`/api/events/${encodeURIComponent(eventId)}`);
}

// ── Participation ─────────────────────────────────────────────────────────────

export async function joinEvent(eventId: string): Promise<void> {
  await apiRequest(`/api/events/${encodeURIComponent(eventId)}/join`, {
    method: 'POST',
    accessToken: await authToken(),
  });
}

export async function leaveEvent(eventId: string): Promise<void> {
  await apiRequest(`/api/events/${encodeURIComponent(eventId)}/leave`, {
    method: 'POST',
    accessToken: await authToken(),
  });
}

export async function fetchMyParticipation(eventId: string): Promise<{
  isParticipating: boolean;
  joinedAt?: string;
}> {
  return apiJson(`/api/events/${encodeURIComponent(eventId)}/my-participation`, {
    accessToken: await authToken(),
  });
}

/** Fetches the event (if any) the current user is actively participating in.
 *  Used at session restoration to rebuild currentEventId without requiring
 *  the user to navigate to Event Mode first. */
export async function fetchMyActiveParticipation(): Promise<ActiveParticipationResponse> {
  return apiJson<ActiveParticipationResponse>('/api/events/my-active-participation', {
    accessToken: await authToken(),
  });
}

// ── Trade Matches ─────────────────────────────────────────────────────────────

export async function fetchTradeMatches(eventId: string): Promise<TradeMatchesResponse> {
  return apiJson<TradeMatchesResponse>(`/api/events/${encodeURIComponent(eventId)}/trade-matches`, {
    accessToken: await authToken(),
  });
}
