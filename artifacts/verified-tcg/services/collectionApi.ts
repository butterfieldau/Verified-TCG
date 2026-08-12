import type { CollectionItem } from '@/types';
import { getAccessToken } from './auth';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '') + '/api';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function check(response: Response): Promise<void> {
  if (!response.ok) throw new Error(`Collection API ${response.status}: ${await response.text().catch(() => '')}`);
}

export async function getCollectionFromServer(): Promise<CollectionItem[]> {
  const response = await request('/collection');
  await check(response);
  const data = await response.json() as { items?: CollectionItem[] };
  return Array.isArray(data.items) ? data.items : [];
}

export async function saveCollectionItemToServer(item: CollectionItem): Promise<void> {
  const response = await request('/collection', { method: 'POST', body: JSON.stringify(item) });
  await check(response);
}

export async function removeCollectionItemFromServer(id: string): Promise<void> {
  const response = await request(`/collection/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await check(response);
}
