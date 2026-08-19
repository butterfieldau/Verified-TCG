import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiPost, apiPatch } from '@/lib/api';

export function useVendors(params: { page: number; limit: number; search?: string; status?: string }) {
  return useQuery({
    queryKey: ['vendors', params],
    queryFn: () => {
      const q = new URLSearchParams(Object.entries(params).filter(([_, v]) => v) as any).toString();
      return apiFetch<any>(`/admin/vendors?${q}`);
    }
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiPost(`/admin/vendors`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useEditVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => apiPatch(`/admin/vendors/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useVendorStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) =>
      apiPost(`/admin/vendors/${id}/status`, { status, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useVendorNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note, reason }: { id: string; note: string; reason: string }) =>
      apiPost(`/admin/vendors/${id}/notes`, { note, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useVendorEventLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, eventId, booth, status, reason }: { id: string; eventId: string; booth?: string; status?: string; reason: string }) =>
      apiPost(`/admin/vendors/${id}/events`, { eventId, booth, status, reason }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', id] });
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: ['vendor', id],
    queryFn: () => apiFetch<any>(`/admin/vendors/${id}`),
    enabled: !!id
  });
}
