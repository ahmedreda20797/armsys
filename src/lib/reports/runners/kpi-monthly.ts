// ══════════════════════════════════════════════════════════════
//  Unified Reporting Architecture — KPI Report Runners (Phase 2)
//
//  Registered runners for the Monthly / MTD / Historical Quality KPI
//  reports. They are CONSUMERS of the kpi-reporting layer (which
//  itself consumes the canonical engine) — NO KPI value is computed
//  here (Milestone 8 runner doctrine). Excel export flows through
//  the existing buildReportExcel (definition-driven, one mechanism).
//
//  The exported rows are the SAME verified rows the on-screen tables
//  show — one data path, so screen and export can never disagree
//  (spec §22).
// ══════════════════════════════════════════════════════════════

import type { ResolvedReportRequest } from '../scope';
import type { ReportRunnerResult } from '../types';
import {
  buildMonthlyKpiReport,
  buildSummaryPayload,
} from '@/lib/kpi-reporting';
import type { KpiMonthlyReport, KpiReportRow } from '@/lib/kpi-reporting';

// ─────────────────────────────────────────────────────────────
//  Flat export row (definition-driven Excel columns)
// ─────────────────────────────────────────────────────────────

export interface KpiMonthlyExportRow {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  department: string | null;
  team: string | null;
  /** Quality RAW score (0–100) — null when unavailable (never 0). */
  qualityRawScore: number | null;
  /** Scheme quality weight (percent) — from component.weight. */
  qualityWeight: number | null;
  /** Weighted contribution (raw × weight/100, engine output). */
  qualityContribution: number | null;
  qualityStatus: string | null;
  overallKpiStatus: string | null;
  kpiStatus: string;
  valueBasis: string;
  finalized: boolean;
  schemeName: string | null;
  schemeVersion: number | null;
  archived: boolean;
}

/** Project a report row into the flat export shape (pure). */
export function toKpiMonthlyExportRow(row: KpiReportRow): KpiMonthlyExportRow {
  return {
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    department: row.department,
    team: row.team,
    qualityRawScore: row.quality?.rawScore ?? null,
    qualityWeight: row.quality?.weight ?? null,
    qualityContribution: row.quality?.weightedContribution ?? null,
    qualityStatus: row.quality?.status ?? null,
    overallKpiStatus: row.overallStatus,
    kpiStatus: row.rowStatus,
    valueBasis: row.valueBasis,
    finalized: row.finalized,
    schemeName: row.schemeName,
    schemeVersion: row.schemeVersion,
    archived: row.archivedButEligible,
  };
}

/** Pure report → export-rows projection (parity-tested). */
export function toKpiMonthlyExportRows(report: KpiMonthlyReport): KpiMonthlyExportRow[] {
  return report.rows.map(toKpiMonthlyExportRow);
}

// ─────────────────────────────────────────────────────────────
//  Shared runner core
// ─────────────────────────────────────────────────────────────

function scopeLimitOf(resolved: ResolvedReportRequest): ReadonlyArray<string> | null {
  switch (resolved.employeeScope.mode) {
    case 'single': return [resolved.employeeScope.employeeId];
    case 'multiple': return resolved.employeeScope.employeeIds;
    default: return null;
  }
}

function parseRangeFilter(
  filters: Record<string, string | number | boolean>,
  key: string,
): number | undefined {
  const raw = filters[key];
  if (raw === undefined) return undefined;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

/** Map the value basis onto the unified report data-mode marker. */
function dataModeOf(report: KpiMonthlyReport): ReportRunnerResult['dataMode'] {
  if (report.valueBasis === 'FINALIZED') {
    return { dataMode: 'snapshot', source: 'monthSnapshots', scopeLabel: `الشهر ${report.monthKey} (مجمّد)` };
  }
  return {
    dataMode: 'live',
    source: 'kpi-engine (live)',
    scopeLabel: report.valueBasis === 'MTD'
      ? `MTD — الشهر ${report.monthKey} حتى ${report.asOfDate ?? ''}`
      : `الشهر ${report.monthKey} (غير نهائي)`,
  };
}

export interface RunKpiReportOptions {
  kind: 'MONTHLY' | 'MTD' | 'HISTORICAL';
}

/**
 * Shared execution core for the three registered KPI reports.
 * Authorized scope + department + declared filters narrow the report;
 * everything else comes from the kpi-reporting layer verbatim.
 */
export async function runKpiReport(
  resolved: ResolvedReportRequest,
  options: RunKpiReportOptions,
): Promise<ReportRunnerResult<KpiMonthlyExportRow>> {
  // Single-month reports: the most-recent key of the resolved scope.
  const monthKey = resolved.period.monthKeys?.[0];
  if (!monthKey) {
    throw new Error('KPI reports require a resolvable month scope');
  }

  const report = await buildMonthlyKpiReport({
    monthKey,
    reportKind: options.kind,
    now: new Date(),
    filters: {
      department: resolved.department ?? undefined,
      scopeLimit: scopeLimitOf(resolved),
      status: typeof resolved.filters.status === 'string'
        ? (resolved.filters.status as KpiReportRow['rowStatus'])
        : undefined,
      minScore: parseRangeFilter(resolved.filters, 'minScore'),
      maxScore: parseRangeFilter(resolved.filters, 'maxScore'),
    },
  });

  const summary = buildSummaryPayload(report);

  return {
    rows: toKpiMonthlyExportRows(report),
    summary: {
      eligibleEmployees: summary.counts.eligible,
      availableKpi: summary.counts.available,
      pendingKpi: summary.counts.pending,
      incompleteKpi: summary.counts.incomplete,
      finalizedKpi: summary.counts.finalized,
      zeroKpi: summary.counts.zero,
      avgQualityScore: summary.qualityAverages.avgRawScore ?? 0,
      avgQualityContribution: summary.qualityAverages.avgContribution ?? 0,
      highestQualityScore: summary.qualityAverages.highest?.rawScore ?? 0,
      lowestQualityScore: summary.qualityAverages.lowest?.rawScore ?? 0,
    },
    hasData: report.rows.length > 0,
    dataMode: dataModeOf(report),
  };
}
