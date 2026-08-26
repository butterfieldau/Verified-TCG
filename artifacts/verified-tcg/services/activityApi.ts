/**
 * Activity API — fetches the signed-in user's recent activity for the Home screen.
 */
import { getAccessToken } from "./auth";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

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
 * Returns an empty array if the user is not signed in or the request fails.
 */
export async function fetchRecentActivity(limit = 10): Promise<ActivityItem[]> {
  try {
    const token = await getAccessToken();
    if (!token) return [];

    const res = await fetch(`${API_BASE}/api/me/activity?limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: ActivityItem[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}
