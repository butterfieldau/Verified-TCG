import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost } from '@/lib/api';

export function useReports(params: { page: number; limit: number; search?: string; status?: string; assignedTo?: string }) {
  return useQuery({
    queryKey: ['reports', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v !== undefined && v !== "") as any).toString();
      return apiFetch<any>(`/admin/reports?${q}`);
    }
  });
}

export function useReport(id: string) {
  return useQuery({
    queryKey: ['report', id],
    queryFn: () => apiFetch<any>(`/admin/reports/${id}`),
    enabled: !!id
  });
}

export function useAssignReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, assignTo, reason }: { id: string; assignTo: string | null; reason: string }) =>
      apiPost(`/admin/reports/${id}/assign`, { assignTo, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useReportNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, reason }: { id: string; note: string; reason: string }) =>
      apiPost(`/admin/reports/${id}/notes`, { note, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['report', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useReportOutcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) =>
      apiPost(`/admin/reports/${id}/outcome`, { status, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, confirmation }: { id: string; reason: string; confirmation: string }) =>
      apiPost(`/admin/reports/${id}/suspend-user`, { reason, confirmation }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}
