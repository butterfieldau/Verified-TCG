import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost, apiPatch } from '@/lib/api';

export function useTrades() {
  return useQuery({
    queryKey: ['trades'],
    queryFn: () => apiFetch<any>('/admin/trades')
  });
}

export function useCertifications(params: { page: number; limit: number; status?: string; provider?: string }) {
  return useQuery({
    queryKey: ['certifications', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/certifications?${q}`);
    }
  });
}

export function useCertification(id: string) {
  return useQuery({
    queryKey: ['certification', id],
    queryFn: () => apiFetch<any>(`/admin/certifications/${id}`),
    enabled: !!id
  });
}

export function useCreateCertification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPost(`/admin/certifications`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certifications'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useCertificationNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, reason }: { id: string; note: string; reason: string }) =>
      apiPost(`/admin/certifications/${id}/notes`, { note, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['certification', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useCertificationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) =>
      apiPost(`/admin/certifications/${id}/status`, { status, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['certifications'] });
      queryClient.invalidateQueries({ queryKey: ['certification', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useDrops(params: { page: number; limit: number; status?: string }) {
  return useQuery({
    queryKey: ['drops', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/drops?${q}`);
    }
  });
}

export function useCreateDrop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPost(`/admin/drops`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drops'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useEditDrop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => apiPatch(`/admin/drops/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['drops'] });
      queryClient.invalidateQueries({ queryKey: ['drop', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useDropStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason, confirmation }: { id: string; status: string; reason: string; confirmation?: string }) =>
      apiPost(`/admin/drops/${id}/status`, { status, reason, confirmation }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['drops'] });
      queryClient.invalidateQueries({ queryKey: ['drop', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useDrop(id: string) {
  return useQuery({
    queryKey: ['drop', id],
    queryFn: () => apiFetch<any>(`/admin/drops/${id}`),
    enabled: !!id
  });
}
