/**
 * Activity API — fetches the signed-in user's recent activity for the Home screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const SESSION_KEY = '@verified_tcg/auth_session';

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
    const sessionRaw = await AsyncStorage.getItem(SESSION_KEY);
    if (!sessionRaw) return [];
    const session = JSON.parse(sessionRaw) as { access_token?: string };
    const token = session.access_token;
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
