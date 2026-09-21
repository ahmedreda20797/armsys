// ══════════════════════════════════════════════════════════════
//  HR Monthly Employee Performance Report — sanitized projection
//
//  PURE projection of the CANONICAL monthly KPI report
//  (buildMonthlyKpiReport — the existing engine-only assembly).
//  Nothing is recalculated, rescored, merged or invented:
//    • scores are copied verbatim (null stays null — never 0)
//    • status vocabulary is copied verbatim (PENDING / INCOMPLETE /
//      NOT_ELIGIBLE / NO_SCHEME / … stay semantically distinct)
//    • the projection STRUCTURALLY EXCLUDES technical fields —
//      observation counts, deduction/bonus points, component ids,
//      weights, contributions, available weight, evidence refs —
//      they are never copied, so they cannot leak to an HR client.
//
//  HR keeps: identity + organizational context, employment status,
//  the final performance result, the result status, the period
//  basis, and aggregated period totals (counts only).
// ══════════════════════════════════════════════════════════════

import type {
  KpiMonthlyReport,
  KpiReportRow,
  KpiReportRowStatus,
  KpiValueBasis,
} from '@/lib/kpi-reporting/types';

/** One HR-visible employee performance row (sanitized by shape). */
export interface HrPerformanceRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  team: string | null;
  position: string | null;
  employmentStatus: 'active' | 'inactive' | 'archived' | 'unknown';
  /** Currently archived yet employed during the period. */
  archivedButEligible: boolean;
  /** Reporting period (YYYY-MM). */
  period: string;
  /** The canonical KPI final result — verbatim, null = no result. */
  performanceScore: number | null;
  /** Canonical display status — verbatim (§12 vocabulary). */
  performanceStatus: KpiReportRowStatus;
  /** Frozen (closed month) vs LIVE/MTD (open month). */
  finalized: boolean;
  valueBasis: KpiValueBasis;
  /** Scheme NAME for context only (no weights/component math). */
  schemeName: string | null;
}

/** Aggregated period totals (counts only — no technical math). */
export interface HrPerformanceTotals {
  employees: number;
  withResult: number;
  pending: number;
  incomplete: number;
  finalized: number;
  noScheme: number;
}

/** The HR Monthly Employee Performance Report view model. */
export interface HrPerformanceReport {
  reportKind: 'HR_MONTHLY_PERFORMANCE';
  audience: 'HR';
  monthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  closedAt: string | null;
  asOfDate: string | null;
  rows: HrPerformanceRow[];
  totals: HrPerformanceTotals;
  generatedAt: string;
}

/**
 * Project one canonical row into the HR row. Verbatim on every kept
 * field; technical fields have no destination here by design.
 */
export function toHrPerformanceRow(row: KpiReportRow): HrPerformanceRow {
  return {
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeCode: row.employeeCode,
    department: row.department,
    team: row.team,
    position: row.position,
    employmentStatus: row.employmentStatus,
    archivedButEligible: row.archivedButEligible,
    period: '', // stamped by the report builder below
    // The final performance RESULT: the canonical quality raw score.
    // Verbatim — null (no result) is preserved, never zero-filled.
    performanceScore: row.quality?.rawScore ?? null,
    performanceStatus: row.rowStatus,
    finalized: row.finalized,
    valueBasis: row.valueBasis,
    schemeName: row.schemeName,
  };
}

/** Aggregate HR-safe totals from the sanitized rows (counts only). */
export function toHrPerformanceTotals(rows: ReadonlyArray<HrPerformanceRow>): HrPerformanceTotals {
  const totals: HrPerformanceTotals = {
    employees: rows.length,
    withResult: 0,
    pending: 0,
    incomplete: 0,
    finalized: 0,
    noScheme: 0,
  };
  for (const row of rows) {
    if (row.performanceScore !== null) totals.withResult += 1;
    switch (row.performanceStatus) {
      case 'PENDING': totals.pending += 1; break;
      case 'INCOMPLETE': totals.incomplete += 1; break;
      case 'FINALIZED': totals.finalized += 1; break;
      case 'NO_SCHEME':
      case 'AMBIGUOUS':
      case 'OVERRIDE_NOT_RESOLVABLE':
        totals.noScheme += 1; break;
      default: break;
    }
  }
  return totals;
}

/**
 * Build the HR report from the CANONICAL monthly report. The input
 * must already be scope-narrowed and presentation-filtered (the
 * route does both through the existing monthly pipeline) — this
 * function only sanitizes the projection.
 */
export function buildHrPerformanceReport(monthly: KpiMonthlyReport): HrPerformanceReport {
  const rows = monthly.rows.map((row) => ({ ...toHrPerformanceRow(row), period: monthly.monthKey }));
  return {
    reportKind: 'HR_MONTHLY_PERFORMANCE',
    audience: 'HR',
    monthKey: monthly.monthKey,
    valueBasis: monthly.valueBasis,
    finalized: monthly.finalized,
    closedAt: monthly.closedAt,
    asOfDate: monthly.asOfDate,
    rows,
    totals: toHrPerformanceTotals(rows),
    generatedAt: new Date().toISOString(),
  };
}
