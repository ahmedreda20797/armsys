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
  notification: (id: string) => ['notifications', id] as const,

  // Follow-Ups
  followUps: ['followUps'] as const,
  followUpsByEmployee: (employeeId: string) => ['followUps', 'employee', employeeId] as const,

  // CAPA
  capaCases: ['capaCases'] as const,

  // Complaints
  complaints: ['complaints'] as const,

  // Knowledge Base
  knowledgeBase: ['knowledgeBase'] as const,

  // Risk Center
  riskCenter: ['riskCenter'] as const,
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
//  FOLLOW-UPS HOOKS
// ═══════════════════════════════════════════════════

export interface FollowUpsPageParams {
  status?: string;
  employeeId?: string;
  type?: string;
  priorityLevel?: string;
 page?: number;
  pageSize?: number;
}

export function useFollowUps(params: FollowUpsPageParams = {}) {
  const { status = '', employeeId = '', type = '', priorityLevel = '', page = 1, pageSize = 50 } = params;
  return useQuery({
    queryKey: [...queryKeys.followUps, status, employeeId, type, priorityLevel, page, pageSize],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (status && status !== 'all') sp.set('status', status);
      if (employeeId && employeeId !== 'all') sp.set('employeeId', employeeId);
      if (type && type !== 'all') sp.set('type', type);
      if (priorityLevel && priorityLevel !== 'all') sp.set('priorityLevel', priorityLevel);
      if (page > 1) sp.set('page', String(page));
      if (pageSize !== 50) sp.set('pageSize', String(pageSize));
      const qs = sp.toString();
      return apiFetch<any>(`/api/follow-ups${qs ? `?${qs}` : ''}`);
    },
    staleTime: 10_000,
  });
}

export function useCreateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/follow-ups', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.followUps });
    },
  });
}

export function useUpdateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/follow-ups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['followUps'] });
    },
  });
}

export function useDeleteFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/follow-ups/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['followUps'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  CAPA HOOKS
// ═══════════════════════════════════════════════════

export interface CAPAPageParams {
  status?: string;
  priority?: string;
  source?: string;
  page?: number;
  pageSize?: number;
}

export function useCAPACases(params: CAPAPageParams = {}) {
  const { status = '', priority = '', source = '', page = 1, pageSize = 50 } = params;
  return useQuery({
    queryKey: [...queryKeys.capaCases, status, priority, source, page, pageSize],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (status && status !== 'all') sp.set('status', status);
      if (priority && priority !== 'all') sp.set('priority', priority);
      if (source && source !== 'all') sp.set('source', source);
      if (page > 1) sp.set('page', String(page));
      if (pageSize !== 50) sp.set('pageSize', String(pageSize));
      const qs = sp.toString();
      return apiFetch<any>(`/api/capa${qs ? `?${qs}` : ''}`);
    },
    staleTime: 10_000,
  });
}

export function useCreateCAPACase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/capa', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.capaCases });
    },
  });
}

export function useUpdateCAPACase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/capa/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['capaCases'] });
    },
  });
}

export function useDeleteCAPACase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/capa/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['capaCases'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  COMPLAINTS HOOKS
// ═══════════════════════════════════════════════════

export interface ComplaintsPageParams {
  status?: string;
  severity?: string;
  complaintType?: string;
  page?: number;
  pageSize?: number;
}

export function useComplaints(params: ComplaintsPageParams = {}) {
  const { status = '', severity = '', complaintType = '', page = 1, pageSize = 50 } = params;
  return useQuery({
    queryKey: [...queryKeys.complaints, status, severity, complaintType, page, pageSize],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (status && status !== 'all') sp.set('status', status);
      if (severity && severity !== 'all') sp.set('severity', severity);
      if (complaintType && complaintType !== 'all') sp.set('complaintType', complaintType);
      if (page > 1) sp.set('page', String(page));
      if (pageSize !== 50) sp.set('pageSize', String(pageSize));
      const qs = sp.toString();
      return apiFetch<any>(`/api/complaints${qs ? `?${qs}` : ''}`);
    },
    staleTime: 10_000,
  });
}

export function useCreateComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/complaints', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.complaints });
    },
  });
}

export function useUpdateComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/complaints/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['complaints'] });
    },
  });
}

export function useDeleteComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/complaints/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['complaints'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  KNOWLEDGE BASE HOOKS
// ═══════════════════════════════════════════════════

export interface KnowledgeBasePageParams {
  department?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useKnowledgeBase(params: KnowledgeBasePageParams = {}) {
  const { department = '', status = '', search = '', page = 1, pageSize = 50 } = params;
  return useQuery({
    queryKey: [...queryKeys.knowledgeBase, department, status, search, page, pageSize],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (department && department !== 'all') sp.set('department', department);
      if (status && status !== 'all') sp.set('status', status);
      if (search.trim()) sp.set('search', search.trim());
      if (page > 1) sp.set('page', String(page));
      if (pageSize !== 50) sp.set('pageSize', String(pageSize));
      const qs = sp.toString();
      return apiFetch<any>(`/api/knowledge-base${qs ? `?${qs}` : ''}`);
    },
    staleTime: 10_000,
  });
}

export function useCreateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/knowledge-base', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.knowledgeBase });
    },
  });
}

export function useUpdateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/knowledge-base/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['knowledgeBase'] });
    },
  });
}

export function useDeleteKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/knowledge-base/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['knowledgeBase'] });
    },
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
