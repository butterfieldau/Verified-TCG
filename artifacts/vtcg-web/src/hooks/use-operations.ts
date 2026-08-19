import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useOperationsSummary() {
  return useQuery({
    queryKey: ['operations-summary'],
    queryFn: () => apiFetch<any>('/admin/operations/summary'),
    refetchInterval: 15000,
  });
}

export function useActivity(params: { page: number; limit: number; category?: string; targetType?: string }) {
  return useQuery({
    queryKey: ['activity', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/activity?${q}`);
    },
    refetchInterval: 15000,
  });
}
