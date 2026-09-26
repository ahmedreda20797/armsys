'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { useCallback } from 'react';
import type { CAPACase } from '@/types';
import type { OrgAssignmentNode } from '@/lib/organization/assignment';
import { queryKeys } from '@/lib/cache/query-keys';
import { freshnessFor } from '@/lib/cache/cache-policy';
import { invalidateDomain, invalidateDomains, REFRESH_ALL_DOMAINS, type MutationDomain } from '@/lib/cache/invalidation';

// ═════════════════════════════════════════════════════════════
//  Query Key Factory — canonical definitions live in
//  lib/cache/query-keys.ts (§CACHE-KEYS); re-exported here so every
//  existing import path keeps working.
// ═══════════════════════════════════════════════════

export { queryKeys };

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

export function useEmployees(enabled = true) {
  return useQuery({
    queryKey: queryKeys.employees,
    queryFn: () => apiFetch<any[]>('/api/employees'),
    staleTime: 30_000, // Employees rarely change
    gcTime: freshnessFor('employees').gcTime,
    enabled,
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (_res, data) => {
      invalidateDomain(qc, 'employees', { employeeId: data?.employeeId });
    },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_res, vars) => {
      invalidateDomain(qc, 'employees', { employeeId: vars.id });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/employees/${id}`, { method: 'DELETE' }),
    onSuccess: (_res, id) => {
      invalidateDomain(qc, 'employees', { employeeId: id });
    },
  });
}

// ── ORGANIZATION ASSIGNMENT (employee form picker data) ──
// The DTO mirrors the shared picker-node type (lib/organization/
// assignment) — one shape from the API through the hook to the UI.
export type OrgAssignmentNodeDto = OrgAssignmentNode;

/** Lazy-loaded node list for the assignment selector (loaded with the dialog). */
export function useOrgNodesForAssignment(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.orgNodesForAssignment,
    queryFn: () => apiFetch<{ nodes: OrgAssignmentNodeDto[] }>('/api/employees/org-nodes'),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * The privileged organization transfer (M0.4 separation): moves an
 * employee between org nodes through /api/organization/employees/move
 * — the SAME route the organization page uses, with its own
 * permission gate, membership ledger, audit and manager notifications.
 */
export function useMoveEmployeeOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, orgNodeId }: { employeeId: string; orgNodeId: string | null }) =>
      apiFetch('/api/organization/employees/move', {
        method: 'POST',
        body: JSON.stringify({ employeeId, orgNodeId }),
      }),
    onSuccess: () => {
      invalidateDomains(qc, ['employees', 'organization']);
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
    onSuccess: (_res, data) => {
      invalidateDomain(qc, 'attendance', { employeeId: data?.employeeId });
    },
  });
}

export function useUpdateAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/attendance/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: (_res, vars) => {
      invalidateDomain(qc, 'attendance', { employeeId: vars.data?.employeeId });
    },
  });
}

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/attendance/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateDomain(qc, 'attendance');
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
      invalidateDomain(qc, 'requests');
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
      invalidateDomain(qc, 'rules');
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateDomain(qc, 'rules');
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
  /** §TRAVEL-TOMORROW — real server-side filters (mutually combinable). */
  tomorrowDeparture?: boolean;
  tomorrowReturn?: boolean;
  /** §DEAL-DATES — closure-month filter (CLOSED dimension / closedAt). */
  closedMonth?: string;
  /** §DEAL-DATES — which canonical date the `month` period applies to
   *  (dealClosedAt = closed with the employee, createdAt, departureDate,
   *  closedAt). Default: departureDate (the operational travel view). */
  dateBasis?: string;
  /** §9 — independent current-status filter (all|upcoming|in_progress|
   *  completed|canceled). Orthogonal to the tab and the date basis. */
  status?: string;
}

export interface TravelApiResponse {
  data: any[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  counts: { all: number; upcoming: number; in_progress: number; returned: number };
  availableMonths: string[];
  urgentTrips: any[];
  /** Echo of the resolved date basis the period filter used. */
  dateBasis?: string;
}

export function useTravel(params: TravelPageParams = {}) {
  const {
    tab = 'all', employeeId = '', month = '', search = '', page = 1, pageSize = 50,
    tomorrowDeparture = false, tomorrowReturn = false,
    // §DEAL-DATES — closure-month filter (CLOSED dimension / closedAt).
    closedMonth = '',
    // §DEAL-DATES — explicit date basis + independent status filter.
    dateBasis = 'departureDate', status = 'all',
  } = params;
  return useQuery({
    queryKey: [...queryKeys.travel, tab, employeeId, month, search, page, pageSize, tomorrowDeparture, tomorrowReturn, closedMonth, dateBasis, status],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (tab !== 'all') sp.set('tab', tab);
      if (employeeId && employeeId !== 'all') sp.set('employeeId', employeeId);
      if (month && month !== 'all') sp.set('month', month);
      if (search.trim()) sp.set('search', search.trim());
      if (page > 1) sp.set('page', String(page));
      if (pageSize !== 50) sp.set('pageSize', String(pageSize));
      if (tomorrowDeparture) sp.set('tomorrowDeparture', '1');
      if (tomorrowReturn) sp.set('tomorrowReturn', '1');
      if (closedMonth) sp.set('closedMonth', closedMonth);
      // §DEAL-DATES — the basis ALWAYS travels with the period so the
      // server and the page can never disagree about what `month` means.
      if (dateBasis && dateBasis !== 'departureDate') sp.set('dateBasis', dateBasis);
      if (status && status !== 'all') sp.set('status', status);
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
    onSuccess: (_res, data) => {
      invalidateDomain(qc, 'travel', { employeeId: data?.employeeId });
    },
  });
}

export function useUpdateTravel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/travel/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    // onSettled (existing semantics): refresh deal surfaces even when
    // the mutation errors — status transitions drive closedAt.
    onSettled: (_res, _err, vars) => {
      invalidateDomain(qc, 'travel', { employeeId: vars?.data?.employeeId });
    },
  });
}

export function useDeleteTravel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/travel/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      invalidateDomain(qc, 'travel');
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
    staleTime: 60_000,
    // No polling — NotificationContext handles polling via Firebase listener + 45s fallback
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
    onSuccess: (_res, data) => {
      invalidateDomain(qc, 'followUps', { employeeId: data?.employeeId });
    },
  });
}

export function useUpdateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/follow-ups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: (_res, _err, vars) => {
      invalidateDomain(qc, 'followUps', { employeeId: vars?.data?.employeeId });
    },
  });
}

export function useDeleteFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/follow-ups/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      invalidateDomain(qc, 'followUps');
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
      return apiFetch<any>(`/api/capa-cases${qs ? `?${qs}` : ''}`);
    },
    staleTime: 10_000,
  });
}

export function useCreateCAPACase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch('/api/capa-cases', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (_res, data) => {
      invalidateDomain(qc, 'capaCases', { employeeId: data?.employeeId });
    },
  });
}

export function useUpdateCAPACase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/capa-cases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: (_res, _err, vars) => {
      invalidateDomain(qc, 'capaCases', { employeeId: vars?.data?.employeeId });
    },
  });
}

export function useDeleteCAPACase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/capa-cases/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      invalidateDomain(qc, 'capaCases');
    },
  });
}

export function useCAPACase(id: string) {
  return useQuery({
    queryKey: queryKeys.capaCase(id),
    queryFn: () => apiFetch<CAPACase>(`/api/capa-cases/${id}`),
    enabled: !!id,
    staleTime: 5_000,
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
    onSuccess: (_res, data) => {
      invalidateDomain(qc, 'complaints', { employeeId: data?.employeeId });
    },
  });
}

export function useUpdateComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/complaints/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: (_res, _err, vars) => {
      invalidateDomain(qc, 'complaints', { employeeId: vars?.data?.employeeId });
    },
  });
}

export function useDeleteComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/complaints/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      invalidateDomain(qc, 'complaints');
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
      invalidateDomain(qc, 'knowledgeBase');
    },
  });
}

export function useUpdateKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      apiFetch(`/api/knowledge-base/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSettled: () => {
      invalidateDomain(qc, 'knowledgeBase');
    },
  });
}

export function useDeleteKnowledgeArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/knowledge-base/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      invalidateDomain(qc, 'knowledgeBase');
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

// ═════════════════════════════════════════════════════════════
//  DOMAIN LIST HOOKS — the operational pages that previously
//  fetched with useEffect + authFetch + local state (no caching,
//  no dedup, full download on every navigation). They now flow
//  through the canonical cache: first visit fetches, return visits
//  restore the snapshot instantly and revalidate in the background
//  when stale (§9/§28). Page state (filters/sort/pagination) stays
//  in usePageState — only DATA STATE lives here (§4).
//
//  `enabled` carries the page's existing canView gate — non-viewers
//  never trigger a request.
// ═════════════════════════════════════════════════════════════

/** dashboard/users — full management payload or the basic dept-filter
 *  variant. Variants are distinct cache entries (§43). */
export function useDashboardUsers(variant: 'basic' | 'full' = 'full', enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboardUsers(variant),
    queryFn: () => apiFetch<any[]>(
      variant === 'basic' ? '/api/dashboard/users?basic=1' : '/api/dashboard/users',
    ),
    staleTime: freshnessFor('dashboardUsers').staleTime,
    gcTime: freshnessFor('dashboardUsers').gcTime,
    enabled,
  });
}

/** Full follow-up list + per-employee risk scores (single endpoint). */
export function useFollowUpsList(enabled = true) {
  return useQuery({
    queryKey: queryKeys.followUpsList,
    queryFn: () => apiFetch<{ data?: any[]; employeeRiskScores?: Record<string, number> } | any[]>('/api/follow-ups'),
    select: (payload) => {
      const items = Array.isArray(payload) ? payload : payload?.data || [];
      return {
        followUps: Array.isArray(items) ? items : [],
        employeeRiskScores: (Array.isArray(payload) ? {} : payload?.employeeRiskScores) || {},
      };
    },
    staleTime: freshnessFor('followUps').staleTime,
    enabled,
  });
}

/** Legacy quality-deduction list. `includeArchived` is key identity. */
export function useQualityList(includeArchived: boolean, enabled = true) {
  return useQuery({
    queryKey: queryKeys.qualityList(includeArchived),
    queryFn: () => apiFetch<any[]>(
      includeArchived ? '/api/quality?includeArchived=1' : '/api/quality',
    ),
    staleTime: freshnessFor('quality').staleTime,
    enabled,
  });
}

export function useAttendanceList(enabled = true) {
  return useQuery({
    queryKey: queryKeys.attendanceList,
    queryFn: () => apiFetch<any[]>('/api/attendance'),
    staleTime: freshnessFor('attendance').staleTime,
    enabled,
  });
}

export function useRequestsList(enabled = true) {
  return useQuery({
    queryKey: queryKeys.requestsList,
    queryFn: () => apiFetch<any[]>('/api/requests'),
    staleTime: freshnessFor('requests').staleTime,
    enabled,
  });
}

export function useHrDeductionsList(includeArchived: boolean, enabled = true) {
  return useQuery({
    queryKey: queryKeys.hrDeductionsList(includeArchived),
    queryFn: () => apiFetch<any[]>(
      includeArchived ? '/api/hr-deductions?includeArchived=1' : '/api/hr-deductions',
    ),
    staleTime: freshnessFor('hrDeductions').staleTime,
    enabled,
  });
}

export function useBiometricsList(enabled = true) {
  return useQuery({
    queryKey: queryKeys.biometricsList,
    queryFn: () => apiFetch<any[]>('/api/biometric'),
    staleTime: freshnessFor('biometrics').staleTime,
    enabled,
  });
}

/** CAPA cases, unpaginated (the page needs the whole operational set). */
export function useCapaList(enabled = true) {
  return useQuery({
    queryKey: queryKeys.capaList,
    queryFn: () => apiFetch<{ data?: any[]; total?: number }>('/api/capa-cases'),
    staleTime: freshnessFor('capaCases').staleTime,
    enabled,
  });
}

export function useRepetitionAlerts(enabled = true) {
  return useQuery({
    queryKey: ['repetition-alerts'] as const,
    queryFn: () => apiFetch<{ alerts?: any[]; generatedAt?: string }>('/api/repetition-alerts'),
    staleTime: freshnessFor('aoccOperational').staleTime,
    enabled,
  });
}

/** Rules engine dataset — `fresh=1` cache-bypass semantics are
 *  preserved as part of the key identity. */
export function useRulesList(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rulesList,
    queryFn: () => apiFetch<{ data?: any[]; total?: number; stats?: any }>(
      '/api/rules?limit=100&fresh=1',
    ),
    staleTime: freshnessFor('rules').staleTime,
    enabled,
  });
}

export function useRuleLogs(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.ruleLogs, 'recent'] as const,
    queryFn: () => apiFetch<any>('/api/rule-logs?limit=50'),
    staleTime: freshnessFor('ruleLogs').staleTime,
    enabled,
  });
}

/** Deduction rules (RulesPage — distinct from the rules engine). */
export function useDeductionRules(enabled = true) {
  return useQuery({
    queryKey: ['deductionRules'] as const,
    queryFn: () => apiFetch<{ data?: any[] }>('/api/deduction-rules'),
    staleTime: freshnessFor('rules').staleTime,
    enabled,
  });
}

/** Risk-center snapshot for a reporting month — period-aware key (§16). */
export function useRiskCenterMonth(month: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.riskCenterMonth(month),
    queryFn: () => apiFetch<any>(`/api/risk-center${month ? `?month=${month}` : ''}`),
    staleTime: freshnessFor('riskCenter').staleTime,
    enabled,
  });
}

/** Employee 360 aggregate — subject-scoped key (§39). Section
 *  permissions stay server-enforced; the cache only avoids re-download.
 *  The REPORTING PERIOD is part of the cache identity: switching month
 *  selects another identity (cached snapshots render instantly, §16).
 *  The route's deterministic 404 body ('الموظف غير موجود') is surfaced
 *  as a not-found sentinel so callers keep their not-found UI. */
export function useEmployee360(employeeId: string, month = '', enabled = true) {
  return useQuery({
    queryKey: month
      ? [...queryKeys.employee360(employeeId), month] as const
      : queryKeys.employee360(employeeId),
    queryFn: async () => {
      try {
        const suffix = month ? `?month=${encodeURIComponent(month)}` : '';
        return await apiFetch<any>(`/api/employee-360/${employeeId}${suffix}`);
      } catch (err: any) {
        if (err?.message === 'الموظف غير موجود') {
          return { __notFound: true as const };
        }
        throw err;
      }
    },
    staleTime: freshnessFor('employee360').staleTime,
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeePerformance(
  employeeId: string,
  options?: { scope?: string; month?: string; enabled?: boolean },
) {
  const { scope = 'career', month = '', enabled = true } = options ?? {};
  return useQuery({
    // Scope + month are part of the identity — different metric
    // dimensions never collide (§16/§43).
    queryKey: [...queryKeys.employeePerformance(employeeId), scope, month] as const,
    queryFn: () => {
      const params = new URLSearchParams({ scope });
      if (scope === 'selected_month' && month) params.set('month', month);
      return apiFetch<any>(`/api/employee-performance/${employeeId}?${params.toString()}`);
    },
    staleTime: freshnessFor('employeePerformance').staleTime,
    enabled: enabled && !!employeeId,
  });
}

/** Manual refresh that keeps the current snapshot on screen (§26):
 *  force-revalidates the given domains without clearing anything. */
export function useRefreshDomains() {
  const qc = useQueryClient();
  return useCallback((domains: readonly MutationDomain[], ctx?: { employeeId?: string }) => {
    invalidateDomains(qc, domains, ctx);
  }, [qc]);
}

/** Employee documents (Employee 360 documents tab) — subject-scoped. */
export function useEmployeeDocuments(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ['employee-documents', employeeId] as const,
    queryFn: () => apiFetch<any[]>(`/api/employee-documents?employeeId=${employeeId}`),
    staleTime: freshnessFor('employee360').staleTime,
    enabled: enabled && !!employeeId,
  });
}
