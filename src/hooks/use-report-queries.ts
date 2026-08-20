'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import type { ReportDefinition, ReportRunRequest, ReportRunResponse } from '@/lib/reports/types';

// ═══════════════════════════════════════════════════
//  Query Keys — Unified Reporting Architecture (M8)
//
//  Namespaced under ['reports','catalog'] / ['reports','run',…]
//  which cannot collide with the legacy ['reports', month] keys
//  (month keys are always YYYY-MM).
//
//  Invalidation rule (spec §26): reports invalidate ONLY when
//  their underlying domain data changes — e.g. a quality deduction
//  mutation invalidates ['reports','run'] for quality-deductions
//  reports. No global invalidation.
// ═══════════════════════════════════════════════════

export const reportQueryKeys = {
  catalog: ['reports', 'catalog'] as const,
  run: (reportId: string, payloadKey: string) => ['reports', 'run', reportId, payloadKey] as const,
  /** Invalidate all executions of one report (domain-data change). */
  runAll: (reportId: string) => ['reports', 'run', reportId] as const,
};

export interface CatalogReport extends ReportDefinition {
  canExport: boolean;
}

/** Permission-filtered report catalog (server computes visibility). */
export function useReportCatalog() {
  return useQuery({
    queryKey: reportQueryKeys.catalog,
    queryFn: () => apiFetch<{ reports: CatalogReport[] }>('/api/reports/catalog'),
    staleTime: 60_000,
  });
}

/** One definition from the catalog by reportId. */
export function useReportDefinition(reportId: string) {
  const catalog = useReportCatalog();
  const definition = catalog.data?.reports.find((r) => r.reportId === reportId) ?? null;
  return { definition, isLoading: catalog.isLoading, error: catalog.error };
}

/**
 * Execute a report. The payload key serializes the request into the
 * query key so filter changes re-run naturally through React Query.
 */
export function useReportRun<TRow = Record<string, unknown>>(reportId: string, request: ReportRunRequest, enabled = true) {
  const payloadKey = JSON.stringify(request);
  return useQuery({
    queryKey: reportQueryKeys.run(reportId, payloadKey),
    queryFn: () =>
      apiFetch<ReportRunResponse<TRow>>('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadKey,
      }),
    enabled: enabled && reportId.length > 0,
    staleTime: 15_000,
  });
}
