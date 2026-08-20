import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost } from '@/lib/api';

export function useCommunityPosts(params: { page: number; limit: number; search?: string; status?: string }) {
  return useQuery({
    queryKey: ['community-posts', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/community/posts?${q}`);
    }
  });
}

export function useCommunityBlocks(params: { page: number; limit: number; search?: string }) {
  return useQuery({
    queryKey: ['community-blocks', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/community/blocks?${q}`);
    }
  });
}

export function useModeratePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason, confirmation }: { id: string; status: string; reason: string; confirmation?: string }) =>
      apiPost(`/admin/community/posts/${id}/moderate`, { status, reason, confirmation }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}
