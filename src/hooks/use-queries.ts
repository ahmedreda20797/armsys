'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import { useCallback } from 'react';

// ═══════════════════════════════════════════════════
//  Query Key Factory — Centralized, consistent keys
// ═══════════════════════════════════════════════════

export const queryKeys = {
  // Home / Dashboard
  homeStats: ['home', 'stats'] as const,
  
  // Employees
  employees: ['employees'] as const,
  employee: (id: string) => ['employees', id] as const,
  
  // Attendance
  attendance: ['attendance'] as const,
  attendanceByDate: (date: string) => ['attendance', date] as const,
  
  // Requests
  requests: ['requests'] as const,
  
  // Rules
  rules: ['rules'] as const,
  
  // Quality
  quality: ['quality'] as const,
  
  // Travel
  travel: ['travel'] as const,
  
  // Biometrics
  biometrics: ['biometrics'] as const,
  
  // Reports
  reports: (month?: string) => ['reports', month] as const,
  
  // Notifications
  notifications: ['notifications'] as const,
  
  // Dashboard users
  dashboardUsers: ['dashboard', 'users'] as const,
};

// ═══════════════════════════════════════════════════
//  HOME STATS HOOK
// ═══════════════════════════════════════════════════

export function useHomeStats() {
  return useQuery({
    queryKey: queryKeys.homeStats,
    queryFn: () => apiFetch<any>('/api/home/stats'),
    // Home stats can be stale for 15 seconds (heavy computation)
    staleTime: 15_000,
  });
}

// ═══════════════════════════════════════════════════
//  EMPLOYEES HOOKS
// ═══════════════════════════════════════════════════

export function useEmployees() {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: () => apiFetch<any[]>('/api/employees'),
    staleTime: 30_000, // Employees rarely change
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
    },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/employees/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees });
    },
  });
}

// ═══════════════════════════════════════════════════
//  ATTENDANCE HOOKS
// ═══════════════════════════════════════════════════

export function useAttendance() {
  return useQuery({
    queryKey: queryKeys.attendance,
    queryFn: () => apiFetch<any[]>('/api/attendance'),
    staleTime: 15_000,
  });
}

export function useCreateAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.attendance });
      qc.invalidateQueries({ queryKey: queryKeys.homeStats });
    },
  });
}

export function useUpdateAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/attendance/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.attendance });
      qc.invalidateQueries({ queryKey: queryKeys.homeStats });
    },
  });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/attendance/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.attendance });
      qc.invalidateQueries({ queryKey: queryKeys.homeStats });
    },
  });
}

// ═══════════════════════════════════════════════════
//  REQUESTS HOOKS
// ═══════════════════════════════════════════════════

export function useRequests() {
  return useQuery({
    queryKey: queryKeys.requests,
    queryFn: () => apiFetch<any[]>('/api/requests'),
    staleTime: 10_000,
  });
}

export function useUpdateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/requests/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.requests });
      qc.invalidateQueries({ queryKey: queryKeys.homeStats });
    },
  });
}

// ═══════════════════════════════════════════════════
//  RULES HOOKS
// ═══════════════════════════════════════════════════

export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => apiFetch<any[]>('/api/rules'),
    staleTime: 60_000, // Rules rarely change
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/rules', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rules });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rules });
    },
  });
}

// ═══════════════════════════════════════════════════
//  QUALITY HOOKS
// ═══════════════════════════════════════════════════

export function useQuality() {
  return useQuery({
    queryKey: queryKeys.quality,
    queryFn: () => apiFetch<any[]>('/api/quality'),
    staleTime: 15_000,
  });
}

// ═══════════════════════════════════════════════════
//  TRAVEL HOOKS
// ═══════════════════════════════════════════════════

export interface TravelPageParams {
  tab?: string;
  employeeId?: string;
  month?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface TravelApiResponse {
  data: any[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { all: number; upcoming: number; in_progress: number; returned: number };
  availableMonths: string[];
  urgentTrips: any[];
}

export function useTravel(params: TravelPageParams = {}) {
  const { tab = 'all', employeeId = '', month = '', search = '', page = 1, pageSize = 50 } = params;
  return useQuery({
    queryKey: [...queryKeys.travel, tab, employeeId, month, search, page, pageSize],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (tab !== 'all') sp.set('tab', tab);
      if (employeeId && employeeId !== 'all') sp.set('employeeId', employeeId);
      if (month && month !== 'all') sp.set('month', month);
      if (search.trim()) sp.set('search', search.trim());
      if (page > 1) sp.set('page', String(page));
      if (pageSize !== 50) sp.set('pageSize', String(pageSize));
      const qs = sp.toString();
      return apiFetch<TravelApiResponse>(`/api/travel${qs ? `?${qs}` : ''}`);
    },
    staleTime: 10_000,
  });
}

export function useCreateTravel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/travel', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.travel });
    },
  });
}

export function useUpdateTravel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/travel/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['travel'] });
    },
  });
}

export function useDeleteTravel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/travel/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['travel'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  BIOMETRICS HOOKS
// ═══════════════════════════════════════════════════

export function useBiometrics() {
  return useQuery({
    queryKey: queryKeys.biometrics,
    queryFn: () => apiFetch<any[]>('/api/biometric'),
    staleTime: 30_000,
  });
}

// ═══════════════════════════════════════════════════
//  NOTIFICATIONS HOOK
// ═══════════════════════════════════════════════════

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => apiFetch<any[]>('/api/firebase/notifications'),
    staleTime: 30_000,
    refetchInterval: enabled ? 30_000 : false, // Only poll when enabled
    retry: 1,
  });
}

// ═══════════════════════════════════════════════════
//  GENERIC INVALIDATION HELPER
// ═══════════════════════════════════════════════════

export function useInvalidateQueries() {
  const qc = useQueryClient();
  
  const invalidate = useCallback((keys: readonly string[][]) => {
    keys.forEach(key => qc.invalidateQueries({ queryKey: key }));
  }, [qc]);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries();
  }, [qc]);

  return { invalidate, invalidateAll };
}
