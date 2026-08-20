// ══════════════════════════════════════════════════════════════
//  Report Response Envelope Builder (Milestone 8 — spec §22)
//
//  Pure assembly of the predictable ReportRunResponse structure:
//    metadata / period / filters / rows / summary / metrics /
//    generatedAt / dataMode / source / scope+permission echo.
//
//  One builder = one contract. Every registered report returns
//  through this function so consumers (UI, export, tests) can rely
//  on the shape without per-report glue.
// ══════════════════════════════════════════════════════════════

import type { ResolvedReportRequest } from './scope';
import type {
  ReportDataModeInfo,
  ReportDefinition,
  ReportRunRequest,
  ReportRunResponse,
  ReportScopeInfo,
  ReportRunnerResult,
} from './types';

/**
 * Build the unified response envelope from a runner result.
 *
 * `summary` is intersected with the definition's declared
 * availableMetrics: a runner may never smuggle undeclared (or KPI-
 * valued) metrics into a report payload — the definition is the
 * contract.
 */
export function buildReportRunResponse<TRow>(
  definition: ReportDefinition,
  request: ReportRunRequest,
  resolved: ResolvedReportRequest,
  runnerResult: ReportRunnerResult<TRow>,
  actor: { userId: string; role: string },
): ReportRunResponse<TRow> {
  const declaredMetrics = new Set(definition.availableMetrics.map((m) => m.metricId));
  const summary: Record<string, number> = {};
  for (const [metricId, value] of Object.entries(runnerResult.summary ?? {})) {
    if (declaredMetrics.has(metricId) && typeof value === 'number' && Number.isFinite(value)) {
      summary[metricId] = value;
    }
  }

  const scope: ReportScopeInfo = {
    employeeScope: resolved.employeeScope,
    department: resolved.department,
    grantedBy: {
      pageId: definition.permission.pageId,
      action: definition.permission.action ?? 'view',
    },
  };

  return {
    meta: {
      reportId: definition.reportId,
      name: definition.name,
      domain: definition.domain,
      reportType: definition.reportType,
      period: runnerResult.dataMode.scopeLabel ?? resolved.period.label,
      monthKeys: resolved.period.monthKeys ?? undefined,
      range: resolved.period.range,
      dataMode: runnerResult.dataMode,
      generatedAt: new Date().toISOString(),
    },
    filters: {
      ...(request.filters ?? {}),
      ...(resolved.period.range ? { fromDate: resolved.period.range.fromDate, toDate: resolved.period.range.toDate } : {}),
      ...(request.monthKey ? { monthKey: request.monthKey } : {}),
    },
    hasData: runnerResult.hasData === true && runnerResult.rows.length > 0,
    rows: runnerResult.rows,
    summary,
    scope,
  };
}

/** Empty-result helper: guarantees hasData=false flows (spec §23). */
export function buildEmptyReportResponse<TRow>(
  definition: ReportDefinition,
  request: ReportRunRequest,
  resolved: ResolvedReportRequest,
  dataMode: ReportDataModeInfo,
  actor: { userId: string; role: string },
): ReportRunResponse<TRow> {
  return buildReportRunResponse<TRow>(
    definition,
    request,
    resolved,
    { rows: [], summary: {}, hasData: false, dataMode },
    actor,
  );
}
