/**
 * Community API service — talks to /api/community and /api/collectors endpoints.
 *
 * Covers:
 *   - Activity feed (posts from followed collectors)
 *   - Post CRUD
 *   - Likes (toggle)
 *   - Comments
 *   - Public collector profiles
 *   - Follow / unfollow
 *   - Collector search
 */

import { getAccessToken } from '@/services/auth';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostAuthor {
  username: string;
  displayName: string;
  initials: string;
  subscriptionTier: string;
}

export interface FeedPost {
  id: string;
  userId: string;
  body: string;
  cardId: string | null;
  cardName: string | null;
  createdAt: string;
  author: PostAuthor;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  isOwn: boolean;
}

export interface PostComment {
  id: string;
  postId: string;
  body: string;
  createdAt: string;
  isOwn: boolean;
  author: {
    username: string;
    displayName: string;
    initials: string;
  };
}

export interface PublicCollector {
  id: string;
  username: string;
  displayName: string;
  initials: string;
  bio: string;
  location: string;
  subscriptionTier: string;
  isFoundingMember: boolean;
  joinedAt: string;
  avatarUrl?: string | null;
  favouriteTcg?: string | null;
  collectorSince?: string | null; // "YYYY-MM"
  profilePublic?: boolean;
  showCollection?: boolean;
  showWishlist?: boolean;
  showForTrade?: boolean;
  showForSale?: boolean;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  isFollowing?: boolean;
}

export interface FeedResponse {
  feed: FeedPost[];
  page: number;
  hasMore: boolean;
}

export interface CommentsResponse {
  comments: PostComment[];
  page: number;
  total: number;
  hasMore: boolean;
}

export interface CollectorSearchResponse {
  collectors: PublicCollector[];
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

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
  });
}

async function checkOk(res: Response): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
}

// ── Feed ──────────────────────────────────────────────────────────────────────

export async function fetchFeed(page = 1): Promise<FeedResponse> {
  const res = await authedFetch(`/api/community/feed?page=${page}`);
  await checkOk(res);
  return res.json() as Promise<FeedResponse>;
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export async function createPost(params: {
  body: string;
  cardId?: string;
  cardName?: string;
}): Promise<FeedPost> {
  const res = await authedFetch('/api/community/posts', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  await checkOk(res);
  return res.json() as Promise<FeedPost>;
}

export async function deletePost(postId: string): Promise<void> {
  const res = await authedFetch(`/api/community/posts/${postId}`, {
    method: 'DELETE',
  });
  await checkOk(res);
}

export async function fetchPost(postId: string): Promise<FeedPost> {
  const res = await authedFetch(`/api/community/posts/${postId}`);
  await checkOk(res);
  return res.json() as Promise<FeedPost>;
}

// ── Likes ─────────────────────────────────────────────────────────────────────

export async function likePost(postId: string): Promise<{ likeCount: number }> {
  const res = await authedFetch(`/api/community/posts/${postId}/like`, {
    method: 'POST',
  });
  await checkOk(res);
  return res.json() as Promise<{ likeCount: number }>;
}

export async function unlikePost(postId: string): Promise<{ likeCount: number }> {
  const res = await authedFetch(`/api/community/posts/${postId}/like`, {
    method: 'DELETE',
  });
  await checkOk(res);
  return res.json() as Promise<{ likeCount: number }>;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export async function fetchComments(postId: string, page = 1): Promise<CommentsResponse> {
  const res = await authedFetch(`/api/community/posts/${postId}/comments?page=${page}`);
  await checkOk(res);
  return res.json() as Promise<CommentsResponse>;
}

export async function addComment(postId: string, body: string): Promise<PostComment> {
  const res = await authedFetch(`/api/community/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  await checkOk(res);
  return res.json() as Promise<PostComment>;
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  const res = await authedFetch(
    `/api/community/posts/${postId}/comments/${commentId}`,
    { method: 'DELETE' },
  );
  await checkOk(res);
}

// ── Collectors ────────────────────────────────────────────────────────────────

export async function fetchCollectorProfile(username: string): Promise<PublicCollector> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/collectors/${encodeURIComponent(username)}`, {
    headers,
  });
  await checkOk(res);
  return res.json() as Promise<PublicCollector>;
}

export async function followCollector(username: string): Promise<{ followerCount: number }> {
  const res = await authedFetch(`/api/collectors/${encodeURIComponent(username)}/follow`, {
    method: 'POST',
  });
  await checkOk(res);
  return res.json() as Promise<{ followerCount: number }>;
}

export async function unfollowCollector(username: string): Promise<{ followerCount: number }> {
  const res = await authedFetch(`/api/collectors/${encodeURIComponent(username)}/follow`, {
    method: 'DELETE',
  });
  await checkOk(res);
  return res.json() as Promise<{ followerCount: number }>;
}

export async function searchCollectors(q: string): Promise<PublicCollector[]> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(
    `${API_BASE}/api/collectors/search?q=${encodeURIComponent(q)}`,
    { headers },
  );
  await checkOk(res);
  const data = await res.json() as CollectorSearchResponse;
  return data.collectors;
}

// ── Block / report ────────────────────────────────────────────────────────────

export interface BlockedUser {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}

export async function blockCollector(username: string): Promise<void> {
  const res = await authedFetch(`/api/collectors/${encodeURIComponent(username)}/block`, {
    method: 'POST',
  });
  await checkOk(res);
}

export async function unblockCollector(username: string): Promise<void> {
  const res = await authedFetch(`/api/collectors/${encodeURIComponent(username)}/block`, {
    method: 'DELETE',
  });
  await checkOk(res);
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const res = await authedFetch('/api/me/blocked-users');
  await checkOk(res);
  const data = await res.json() as { blocked: BlockedUser[] };
  return data.blocked;
}

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'fraud'
  | 'inappropriate'
  | 'other';

export async function reportCollector(
  username: string,
  reason: string,
  note?: string,
): Promise<void> {
  const res = await authedFetch(`/api/collectors/${encodeURIComponent(username)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, note: note || undefined }),
  });
  await checkOk(res);
}

// ── Time formatting helper ─────────────────────────────────────────────────────

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
