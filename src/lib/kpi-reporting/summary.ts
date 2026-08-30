// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Management Summary (Phase 2, spec §15)
//
//  A concise management-level aggregation for one period, derived
//  from the SAME verified rows as the monthly report (one source of
//  numbers — screen, export and summary can never disagree).
//
//  §15 BINDING LABEL RULE: while only the Quality component is
//  calculated, these are QUALITY KPI statistics. The payload carries
//  `statisticsKind: 'QUALITY_KPI'` + an explicit Arabic label, and
//  consumers must never present them as company-wide KPI statistics.
//
//  Averages cover value-bearing quality results only (AVAILABLE /
//  ZERO / FINALIZED rows) — pending rows are never averaged as 0
//  (spec §12).
// ══════════════════════════════════════════════════════════════

import type { KpiManagementSummary, KpiMonthlyReport, KpiReportRow, KpiSummaryGroupBreakdown } from './types';
import { buildMonthlyKpiReport } from './monthly-report';
import type { BuildMonthlyKpiReportInput } from './monthly-report';
import { roundTo2 } from '@/lib/kpi-framework/validation';

/** Value-bearing = the row carries a real (possibly zero) quality value. */
function isValueBearing(row: KpiReportRow): boolean {
  return row.quality !== null && row.quality.rawScore !== null;
}

function average(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return roundTo2(sum / values.length);
}

function groupBreakdown(
  rows: ReadonlyArray<KpiReportRow>,
  keyOf: (row: KpiReportRow) => string | null,
  labelOf: (key: string) => string,
): KpiSummaryGroupBreakdown[] {
  const groups = new Map<string, KpiReportRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue; // ungrouped employees are skipped, not fabricated
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const out: KpiSummaryGroupBreakdown[] = [];
  for (const [key, list] of groups) {
    const scores = list.filter(isValueBearing).map((r) => r.quality!.rawScore!);
    const contributions = list.filter(isValueBearing).map((r) => r.quality!.weightedContribution ?? 0);
    out.push({
      key,
      label: labelOf(key),
      employeeCount: list.length,
      avgRawScore: average(scores),
      avgContribution: average(contributions),
    });
  }

  // Deterministic order: employee count desc, then label.
  out.sort((a, b) => b.employeeCount - a.employeeCount || a.label.localeCompare(b.label, 'ar'));
  return out;
}

export const KPI_SUMMARY_LABEL = 'إحصائيات جودة KPI (Quality KPI) — لا تمثل إجمالي KPI الشركة';

/**
 * PURE summary assembly from an ALREADY-built monthly report.
 * Shared by the management summary service AND the registry export
 * runner — one aggregation path, one set of numbers everywhere.
 */
export function buildSummaryPayload(report: KpiMonthlyReport): KpiManagementSummary {
  const rows = report.rows;

  const valueRows = rows.filter(isValueBearing);
  const scores = valueRows.map((r) => r.quality!.rawScore!);
  const contributions = valueRows.map((r) => r.quality!.weightedContribution ?? 0);

  let highest: KpiManagementSummary['qualityAverages']['highest'] = null;
  let lowest: KpiManagementSummary['qualityAverages']['lowest'] = null;
  for (const row of valueRows) {
    const score = row.quality!.rawScore!;
    if (!highest || score > highest.rawScore) {
      highest = { employeeId: row.employeeId, employeeName: row.employeeName, rawScore: score };
    }
    if (!lowest || score < lowest.rawScore) {
      lowest = { employeeId: row.employeeId, employeeName: row.employeeName, rawScore: score };
    }
  }

  return {
    reportKind: 'SUMMARY',
    monthKey: report.monthKey,
    valueBasis: report.valueBasis,
    finalized: report.finalized,
    closedAt: report.closedAt,
    statisticsKind: 'QUALITY_KPI',
    label: KPI_SUMMARY_LABEL,
    counts: {
      eligible: report.totals.eligibleCount,
      available: report.totals.available,
      zero: report.totals.zero,
      pending: report.totals.pending,
      incomplete: report.totals.incomplete,
      finalized: report.totals.finalized,
      noScheme: report.totals.noScheme,
      archivedButEligible: rows.filter((r) => r.archivedButEligible).length,
    },
    qualityAverages: {
      avgRawScore: average(scores),
      avgContribution: average(contributions),
      highest,
      lowest,
    },
    departments: groupBreakdown(
      rows,
      (r) => r.department,
      (key) => key,
    ),
    teams: groupBreakdown(
      rows,
      (r) => r.team,
      (key) => key,
    ),
    generatedAt: report.generatedAt,
  };
}

/**
 * Build the Quality KPI management summary for one month.
 * Reuses `buildMonthlyKpiReport` (same loaders, same basis rules) —
 * no second aggregation path, no duplicated numbers.
 */
export async function buildKpiManagementSummary(
  input: Omit<BuildMonthlyKpiReportInput, 'reportKind' | 'sort'>,
): Promise<KpiManagementSummary> {
  const report = await buildMonthlyKpiReport({ ...input, reportKind: 'MONTHLY' });
  return buildSummaryPayload(report);
}
