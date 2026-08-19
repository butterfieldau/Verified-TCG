import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost, apiPatch } from '@/lib/api';

export function useEvents(params: { page: number; limit: number; search?: string; status?: string }, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['events', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/events?${q}`);
    },
    enabled: opts?.enabled !== false
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPost(`/admin/events`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useEditEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => apiPatch(`/admin/events/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useEventParticipants(id: string, params: { page: number; limit: number }) {
  return useQuery({
    queryKey: ['event-participants', id, params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/events/${id}/participants?${q}`);
    },
    enabled: !!id
  });
}

export function useEventLifecycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toStatus, reason, confirmation }: { id: string; toStatus: string; reason: string; confirmation?: string }) =>
      apiPost(`/admin/events/${id}/lifecycle`, { toStatus, reason, confirmation }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useEventParticipantRemove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, participantId, reason }: { eventId: string; participantId: string; reason: string }) =>
      apiPost(`/admin/events/${eventId}/participants/${participantId}/remove`, { reason }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: ['event-participants', eventId] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useEventParticipantRestore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, participantId, reason }: { eventId: string; participantId: string; reason: string }) =>
      apiPost(`/admin/events/${eventId}/participants/${participantId}/restore`, { reason }),
    onSuccess: (_, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: ['event-participants', eventId] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}
