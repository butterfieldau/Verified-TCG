/**
 * Activity API — fetches the signed-in user's recent activity for the Home screen.
 */
import { getAccessToken } from "./auth";
import { apiJson } from './apiClient';


export interface ActivityItem {
  id: string;
  type: string;
  description: string;
  entityId: string | null;
  entityName: string | null;
  cardImageUrl: string | null;
  timeAgo: string;
  createdAt: string;
}

/**
 * Fetch the most recent activity items for the signed-in user.
 * Returns an empty array only for a signed-out collector. Service failures are
 * propagated instead of being presented as a genuine empty activity feed.
 */
export async function fetchRecentActivity(limit = 10): Promise<ActivityItem[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const body = await apiJson<{ items?: ActivityItem[] }>(`/api/me/activity?limit=${limit}`, { accessToken: token });
  return Array.isArray(body.items) ? body.items : [];
}
