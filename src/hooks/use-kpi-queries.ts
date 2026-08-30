'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import { parseAuditLogPayload } from '@/app/api/quality-audit-log/payload';
import type { MonthSnapshot } from '@/types/quality-kpi';

// ═══════════════════════════════════════════════════
//  Query Key Factory — Quality KPI (Phase 1)
// ═══════════════════════════════════════════════════

export const kpiQueryKeys = {
  observations: ['kpi', 'observations'] as const,
  observation: (id: string) => ['kpi', 'observations', id] as const,
  categories: ['kpi', 'categories'] as const,
  templates: ['kpi', 'templates'] as const,
  templatesBySort: (sort: string) => ['kpi', 'templates', sort] as const,
  settings: ['kpi', 'settings'] as const,
  snapshots: ['kpi', 'snapshots'] as const,
  snapshot: (monthKey: string) => ['kpi', 'snapshots', monthKey] as const,
  dashboard: (range: string, extra?: string) => ['kpi', 'dashboard', range, extra ?? ''] as const,
  auditLog: (filters?: string) => ['kpi', 'auditLog', filters ?? 'all'] as const,
  schemes: ['kpi', 'schemes'] as const,
  employeeResult: (employeeId: string) => ['kpi', 'employeeResult', employeeId] as const,
};

// ═══════════════════════════════════════════════════
//  Observations
// ═══════════════════════════════════════════════════

export interface ObservationsParams {
  month?: string;
  status?: string;
  approvalStatus?: string;
  department?: string;
  employeeId?: string;
  categoryId?: string;
  isBonus?: string;
}

function buildQueryString(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function useObservations(params: ObservationsParams = {}) {
  const qs = buildQueryString(params as Record<string, string | undefined>);
  return useQuery({
    queryKey: [...kpiQueryKeys.observations, qs],
    queryFn: () => apiFetch(`/api/quality-observations${qs}`),
    staleTime: 15_000,
  });
}

export function useObservation(id: string | null) {
  return useQuery({
    queryKey: id ? kpiQueryKeys.observation(id) : ['kpi', 'observations', 'none'],
    queryFn: () => apiFetch(`/api/quality-observations/${id}`),
    enabled: !!id,
  });
}

export function useCreateObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/quality-observations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.observations });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
    },
  });
}

export function useUpdateObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/quality-observations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.observations });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
      // Open-month snapshot details are live previews — refresh them so
      // Employee 360 monthly rows reflect the mutation.
      qc.invalidateQueries({ queryKey: kpiQueryKeys.snapshots });
    },
  });
}

export function useDeleteObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/quality-observations/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.observations });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
      qc.invalidateQueries({ queryKey: kpiQueryKeys.snapshots });
    },
  });
}

export function useApproveObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { notes?: string; points?: number } }) =>
      apiFetch(`/api/quality-observations/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.observations });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
    },
  });
}

export function useRejectObservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/api/quality-observations/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.observations });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  Categories
// ═══════════════════════════════════════════════════

export function useObservationCategories() {
  return useQuery({
    queryKey: kpiQueryKeys.categories,
    queryFn: () => apiFetch('/api/observation-categories'),
    staleTime: 60_000,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/observation-categories', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.categories }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/observation-categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.categories }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/observation-categories/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.categories }),
  });
}

// ═══════════════════════════════════════════════════
//  Templates
// ═══════════════════════════════════════════════════

export function useObservationTemplates(sort?: string) {
  const qs = sort ? `?sort=${sort}` : '';
  return useQuery({
    queryKey: sort ? kpiQueryKeys.templatesBySort(sort) : kpiQueryKeys.templates,
    queryFn: () => apiFetch(`/api/observation-templates${qs}`),
    staleTime: 30_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/observation-templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.templates }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/observation-templates/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.templates }),
  });
}

export function useToggleTemplateFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/observation-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'toggle_favorite' }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.templates }),
  });
}

// ═══════════════════════════════════════════════════
//  KPI Settings
// ═══════════════════════════════════════════════════

export function useKpiSettings() {
  return useQuery({
    queryKey: kpiQueryKeys.settings,
    queryFn: () => apiFetch('/api/kpi-settings'),
    staleTime: 60_000,
  });
}

export function useUpdateKpiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/kpi-settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kpiQueryKeys.settings }),
  });
}

// ═══════════════════════════════════════════════════
//  Month Snapshots
// ═══════════════════════════════════════════════════

export function useMonthSnapshots(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: [...kpiQueryKeys.snapshots, qs],
    queryFn: () => apiFetch(`/api/month-snapshots${qs}`),
    staleTime: 30_000,
  });
}

export function useMonthSnapshot<T = MonthSnapshot>(monthKey: string | null) {
  return useQuery({
    queryKey: monthKey ? kpiQueryKeys.snapshot(monthKey) : ['kpi', 'snapshots', 'none'],
    queryFn: () => apiFetch<T>(`/api/month-snapshots/${monthKey}`),
    enabled: !!monthKey,
  });
}

export function useCloseMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (monthKey: string) =>
      apiFetch(`/api/month-snapshots/${monthKey}/close`, { method: 'POST' }),
    onSuccess: (_data, monthKey) => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.snapshot(monthKey) });
      qc.invalidateQueries({ queryKey: kpiQueryKeys.snapshots });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
    },
  });
}

export function useReopenMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ monthKey, reason }: { monthKey: string; reason: string }) =>
      apiFetch(`/api/month-snapshots/${monthKey}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_data, { monthKey }) => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.snapshot(monthKey) });
      qc.invalidateQueries({ queryKey: kpiQueryKeys.snapshots });
      qc.invalidateQueries({ queryKey: ['kpi', 'dashboard'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════

export interface DashboardParams {
  range?: string;
  customMonths?: string;
  department?: string;
  employeeId?: string;
}

export function useKpiDashboard(params: DashboardParams = {}) {
  const range = params.range ?? 'current_month';
  const qs = buildQueryString({
    range: params.range,
    customMonths: params.customMonths,
    department: params.department,
    employeeId: params.employeeId,
  });
  return useQuery({
    queryKey: kpiQueryKeys.dashboard(range, qs),
    queryFn: () => apiFetch(`/api/kpi-dashboard${qs}`),
    staleTime: 30_000,
  });
}

// ═══════════════════════════════════════════════════
//  Audit Log
// ═══════════════════════════════════════════════════

export interface AuditLogParams {
  entityType?: string;
  entityId?: string;
  monthKey?: string;
  action?: string;
  actorId?: string;
  limit?: number;
}

export function useQualityAuditLog(params: AuditLogParams = {}) {
  const qs = buildQueryString({
    entityType: params.entityType,
    entityId: params.entityId,
    monthKey: params.monthKey,
    action: params.action,
    actorId: params.actorId,
    limit: params.limit?.toString(),
  });
  return useQuery({
    queryKey: [...kpiQueryKeys.auditLog(), qs],
    // The endpoint answers with the documented envelope
    // { data, total, limit, offset } — normalize it to the entries
    // array here (single contract module, unit-tested). Passing the
    // raw envelope through made the page's Array.isArray(data) guard
    // discard every record and render a permanently empty audit log.
    queryFn: async () => parseAuditLogPayload(await apiFetch<unknown>(`/api/quality-audit-log${qs}`)),
    staleTime: 15_000,
  });
}

// ═══════════════════════════════════════════════════
//  KPI Framework (Phase 1) — schemes & company-KPI results
// ═══════════════════════════════════════════════════

export function useKpiSchemes(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: [...kpiQueryKeys.schemes, qs],
    queryFn: () => apiFetch(`/api/kpi-schemes${qs}`),
    staleTime: 60_000,
  });
}

export function useEmployeeKpiResult(employeeId: string | null, month: string | null) {
  const qs = buildQueryString({ employeeId: employeeId ?? undefined, month: month ?? undefined });
  return useQuery({
    queryKey: [...kpiQueryKeys.employeeResult(employeeId ?? 'none'), month],
    queryFn: () => apiFetch(`/api/kpi-framework/employee-result${qs}`),
    enabled: !!employeeId && !!month,
    staleTime: 30_000,
  });
}

export function useSetEmployeeKpiScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, schemeId }: { employeeId: string; schemeId: string | null }) =>
      apiFetch('/api/kpi-framework/employee-scheme', {
        method: 'PUT',
        body: JSON.stringify({ employeeId, schemeId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: kpiQueryKeys.schemes });
      qc.invalidateQueries({ queryKey: ['kpi', 'employeeResult'] });
    },
  });
}

// ═══════════════════════════════════════════════════
//  KPI Reports (Phase 2) — reporting layer
// ═══════════════════════════════════════════════════

const reportsKey = (kind: string) => ['kpi', 'reports', kind] as const;

export interface KpiReportTableParams {
  employeeQuery?: string;
  department?: string;
  team?: string;
  status?: string;
  minScore?: string;
  maxScore?: string;
  sortBy?: string;
  sortDir?: string;
}

function kpiReportQueryString(params: KpiReportTableParams, month?: string | null): string {
  return buildQueryString({
    ...(params as Record<string, string | undefined>),
    month: month ?? undefined,
  });
}

/** Employee KPI report (spec §4/§5) — summary, components, evidence, trend. */
export function useKpiEmployeeReport(employeeId: string | null, month: string | null) {
  const qs = buildQueryString({ employeeId: employeeId ?? undefined, month: month ?? undefined });
  return useQuery({
    queryKey: [...reportsKey('employee'), employeeId ?? 'none', month ?? 'none'],
    queryFn: () => apiFetch(`/api/kpi-reports/employee${qs}`),
    enabled: !!employeeId && !!month,
    staleTime: 15_000,
  });
}

/**
 * Employee Performance Intelligence dataset (Phase 3) — deterministic
 * facts only (observations, repeated issues, deductions, complaints,
 * CAPA, follow-ups, deals, attendance context, evidence references).
 * Read-only service; no AI narrative is involved.
 */
export function usePerformanceIntelligence(employeeId: string | null, month: string | null) {
  const qs = buildQueryString({ employeeId: employeeId ?? undefined, month: month ?? undefined });
  return useQuery({
    queryKey: [...reportsKey('performance-intelligence'), employeeId ?? 'none', month ?? 'none'],
    queryFn: () => apiFetch(`/api/performance-intelligence${qs}`),
    enabled: !!employeeId && !!month,
    staleTime: 15_000,
  });
}

/** Monthly Quality KPI report (spec §6). */
export function useKpiMonthlyReport(month: string | null, params: KpiReportTableParams = {}) {
  const qs = kpiReportQueryString(params, month);
  return useQuery({
    queryKey: [...reportsKey('monthly'), month ?? 'none', qs],
    queryFn: () => apiFetch(`/api/kpi-reports/monthly?${qs.startsWith('?') ? qs.slice(1) : qs}`),
    enabled: !!month,
    staleTime: 15_000,
  });
}

/** MTD report (spec §7/§8) — month optional (defaults server-side). */
export function useKpiMtdReport(month: string | null, params: KpiReportTableParams = {}) {
  const qs = kpiReportQueryString(params, month);
  return useQuery({
    queryKey: [...reportsKey('mtd'), month ?? 'current', qs],
    queryFn: () => apiFetch(`/api/kpi-reports/mtd${qs ? `?${qs.startsWith('?') ? qs.slice(1) : qs}` : ''}`),
    staleTime: 15_000,
  });
}

/** Historical report (spec §9) — frozen snapshots for closed months. */
export function useKpiHistoricalReport(month: string | null, params: KpiReportTableParams = {}) {
  const qs = kpiReportQueryString(params, month);
  return useQuery({
    queryKey: [...reportsKey('historical'), month ?? 'none', qs],
    queryFn: () => apiFetch(`/api/kpi-reports/historical?${qs.startsWith('?') ? qs.slice(1) : qs}`),
    enabled: !!month,
    staleTime: 30_000,
  });
}

/** Management summary (spec §15) — QUALITY KPI statistics. */
export function useKpiManagementSummary(month: string | null) {
  return useQuery({
    queryKey: [...reportsKey('summary'), month ?? 'none'],
    queryFn: () => apiFetch(`/api/kpi-reports/summary?month=${month}`),
    enabled: !!month,
    staleTime: 15_000,
  });
}

export type KpiReportTableKind = 'monthly' | 'mtd' | 'historical';

/** Kind-switching table report hook (one active query per tab). */
export function useKpiReportTable(
  kind: KpiReportTableKind,
  month: string | null,
  params: KpiReportTableParams = {},
) {
  const qs = kpiReportQueryString(params, month);
  const clean = qs.startsWith('?') ? qs.slice(1) : qs;
  return useQuery({
    queryKey: [...reportsKey(kind), month ?? (kind === 'mtd' ? 'current' : 'none'), clean],
    queryFn: () => {
      if (kind === 'mtd') {
        return apiFetch(`/api/kpi-reports/mtd${clean ? `?${clean}` : ''}`);
      }
      return apiFetch(`/api/kpi-reports/${kind}?${clean}`);
    },
    enabled: !!month || kind === 'mtd',
    staleTime: 15_000,
  });
}
