// ══════════════════════════════════════════════════════════════
//  KPI Reports 2.0 — page-state shape & normalization (PURE)
//
//  The persisted work context (usePageState slot 'view', v3) and its
//  validator. Kept pure + client-safe so the page stays thin and the
//  restoration contract is directly testable:
//    • v3 shape: reportType · month · scopeMode · employeeIds ·
//      orgNodeIds · filters
//    • legacy v2 shapes (tab · month · basis) map forward:
//      table/employee/summary/performance (+ the pre-§10 monthly /
//      mtd / historical tabs) → 'employees'; management → 'teams';
//      hr → 'hr'.
// ══════════════════════════════════════════════════════════════

import type { KpiReportType, KpiScopeMode, KpiReportsFilters } from './KpiReportsControlBar';

export type { KpiReportType, KpiScopeMode, KpiReportsFilters };

export interface WorkspaceView {
  reportType: KpiReportType;
  month: string;
  scopeMode: KpiScopeMode;
  employeeIds: string[];
  orgNodeIds: string[];
  filters: KpiReportsFilters;
}

export const DEFAULT_FILTERS: KpiReportsFilters = { search: '', status: '', includeArchived: false };

const REPORT_TYPES: ReadonlyArray<KpiReportType> = ['employees', 'teams', 'comparison', 'hr'];
const SCOPE_MODES: ReadonlyArray<KpiScopeMode> = ['company', 'employees', 'teams', 'departments'];

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Normalize persisted state; legacy v2 shapes (tab · month · basis) map forward. */
export function normalizeView(raw: unknown): WorkspaceView | null {
  if (!raw || typeof raw !== 'object' || typeof (raw as { month?: unknown }).month !== 'string') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  let reportType = r.reportType as KpiReportType | undefined;
  // Legacy v2 tabs: the table/employee/summary/performance views all
  // collapse into the Employee Performance report; management was the
  // cross-unit view → Team Performance; hr keeps its own report type.
  if (reportType === undefined) {
    const legacyTab = r.tab;
    if (legacyTab === 'management') reportType = 'teams';
    else if (legacyTab === 'hr') reportType = 'hr';
    else if (
      legacyTab === 'table' || legacyTab === 'employee' || legacyTab === 'summary'
      || legacyTab === 'performance' || legacyTab === 'monthly' || legacyTab === 'mtd'
      || legacyTab === 'historical'
    ) {
      reportType = 'employees';
    }
  }
  if (!reportType || !REPORT_TYPES.includes(reportType)) {
    reportType = 'employees';
  }
  const scopeMode = SCOPE_MODES.includes(r.scopeMode as KpiScopeMode)
    ? (r.scopeMode as KpiScopeMode)
    : 'company';
  const rawFilters = (r.filters ?? {}) as Record<string, unknown>;
  const filters: KpiReportsFilters = {
    search: typeof rawFilters.search === 'string' ? rawFilters.search : '',
    status: typeof rawFilters.status === 'string' ? rawFilters.status : '',
    includeArchived: rawFilters.includeArchived === true,
  };
  return {
    reportType,
    month: r.month as string,
    scopeMode,
    employeeIds: stringList(r.employeeIds),
    orgNodeIds: stringList(r.orgNodeIds),
    filters,
  };
}
