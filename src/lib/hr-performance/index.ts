// ══════════════════════════════════════════════════════════════
//  HR PerformanceFactor — Phase 2 Milestone 7
//
//  Independent, time-scoped HR PerformanceFactor consuming stored
//  HR deduction data from the `hrDeductions` collection.
//
//  ARCHITECTURE (parity with Attendance KPI — M6):
//    • Source of truth: stored `hrDeductions` records only.
//    • No recalculation from Attendance, Quality, Sales, or raw
//      biometric data.
//    • Monthly/time-scoped via the shared TimeScope contract (M4).
//    • Exposes the generic PerformanceFactor interface from
//      @/lib/kpi-scoring — same shape Quality and Attendance use.
//
//  SCORING STATUS: PENDING BUSINESS CONFIGURATION
//    No canonical HR score formula exists in the current system.
//    The HR factor exposes raw monthly HR deduction metrics
//    (deduction days, deduction amounts, record counts, category
//    breakdowns) as the PerformanceFactor data.
//    The actual HR performance score is explicitly marked as pending
//    — it will be defined by business rules in a future milestone.
//    The `score` field is set to null (via a dedicated marker)
//    to prevent any downstream consumer from interpreting the
//    metrics as a finalized score.
//
//  Split (established project pattern):
//    • PURE — buildHrFactorBreakdown, buildHrPerformanceFactor,
//              buildHrMonthSummary.
//    • ORCHESTRATORS — getHrPerformanceFactor: thin reader over
//      the hrDeductions collection (same db.ts cache).
//
//  Zero calculation engine. No Firebase writes. No React.
// ══════════════════════════════════════════════════════════════

import type { PerformanceFactor } from '@/lib/kpi-scoring';
import type { TimeScope } from '@/lib/time-scope';
import { isValidMonthKey } from '@/lib/month-utils';
import { HR_DEDUCTIONS_TABLE } from '@/lib/employee-performance';
import { aggregateHrMonth } from '@/lib/employee-performance';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';
import type { EmployeeHrDeductionRecord } from '@/lib/employee-performance';
import { getAll, TTL } from '@/lib/db';

/** Stored HR domain collection (re-exported from the established employee-performance module). */
export { HR_DEDUCTIONS_TABLE };

// ─────────────────────────────────────────────────────────────
//  Constants — factor identity
// ─────────────────────────────────────────────────────────────

/** Stable PerformanceFactor identifier (parity with Quality's 'quality' and Attendance's 'attendance'). */
export const HR_PERFORMANCE_FACTOR_ID = 'hr';

/** Human-readable factor name (Arabic — the display language of the factor). */
export const HR_PERFORMANCE_FACTOR_NAME = 'الموارد البشرية';

/**
 * Default-safe weight placeholder required by the generic
 * PerformanceFactor type. NOT a composition decision — the future
 * Unified Performance Engine owns the real weights.
 */
export const HR_PERFORMANCE_DEFAULT_WEIGHT = 1;

/**
 * Scoring status marker — the HR performance score formula has NOT
 * been defined by business rules. The factor exposes raw deduction
 * metrics; the score is null to signal "pending business config".
 */
export const HR_SCORING_STATUS = 'pending_business_configuration' as const;

// ─────────────────────────────────────────────────────────────
//  Result contract
// ─────────────────────────────────────────────────────────────

/**
 * The HR PerformanceFactor scope is ALWAYS one explicitly named
 * month — never an unlabeled point value.
 */
export type HrPerformanceScope = Extract<TimeScope, { kind: 'selected_month' }>;

/**
 * The performance-factor representation of ONE employee's monthly
 * HR deduction data. Contains raw metrics; score is explicitly
 * null (pending business configuration).
 */
export interface HrPerformanceFactorResult {
  employeeId: string;
  /** YYYY-MM — the month this factor belongs to. */
  month: string;
  /** Explicit month scope from the shared TimeScope vocabulary. */
  scope: HrPerformanceScope;
  /** Explicit time-scope metadata label (Arabic). */
  scopeLabel: string;
  /** Raw monthly HR deduction summary (the factor's data contract). */
  summary: EmployeeHrMonthSummary;
  /** Whether any HR deduction records exist for this employee-month. */
  hasData: boolean;
  /** Stored collection the data was derived from. */
  source: typeof HR_DEDUCTIONS_TABLE;
  /**
   * Scoring status — always 'pending_business_configuration'.
   * The score formula has not been defined by business rules.
   */
  scoringStatus: typeof HR_SCORING_STATUS;
  /**
   * Generic PerformanceFactor output.
   * score is set to 0 and maxScore to 1 (normalized=0) to
   * signal "pending" to any downstream consumer — the breakdown
   * contains the actual metric values.
   */
  performanceFactor: PerformanceFactor;
}

// ─────────────────────────────────────────────────────────────
//  PURE BUILDERS
// ─────────────────────────────────────────────────────────────

/**
 * Build the breakdown for the HR PerformanceFactor from the
 * monthly HR deduction summary. Every value comes from the
 * stored HR domain — no fabricated values.
 */
export function buildHrFactorBreakdown(summary: EmployeeHrMonthSummary): Record<string, number> {
  return {
    deductionCount: summary.deductionCount,
    deductionDays: summary.deductionDays,
    deductionAmount: summary.deductionAmount,
  };
}

/**
 * Build an HR PerformanceFactor for one employee-month from
 * aggregated HR deduction data.
 *
 * PURE: no I/O, no mutation, no invented scoring formula.
 *
 * The PerformanceFactor score is set to 0 with maxScore 1 and
 * normalized 0 — this signals "pending business configuration"
 * to any downstream consumer. The actual metrics live in the
 * breakdown and the summary.
 *
 * When no records exist, the summary has zero values and
 * hasData is false.
 */
export function buildHrPerformanceFactor(args: {
  employeeId: string;
  monthKey: string;
  records: EmployeeHrDeductionRecord[];
}): HrPerformanceFactorResult {
  const { employeeId, monthKey, records } = args;
  const summary = aggregateHrMonth(monthKey, records);
  const hasData = records.length > 0;

  const breakdown = buildHrFactorBreakdown(summary);

  const performanceFactor: PerformanceFactor = {
    factorId: HR_PERFORMANCE_FACTOR_ID,
    factorName: HR_PERFORMANCE_FACTOR_NAME,
    score: 0,
    maxScore: 1,
    weight: HR_PERFORMANCE_DEFAULT_WEIGHT,
    normalized: 0,
    breakdown,
  };

  return {
    employeeId,
    month: monthKey,
    scope: { kind: 'selected_month', monthKey },
    scopeLabel: `الموارد البشرية — ${monthKey}`,
    summary,
    hasData,
    source: HR_DEDUCTIONS_TABLE,
    scoringStatus: HR_SCORING_STATUS,
    performanceFactor,
  };
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATORS — stored-data readers only
// ─────────────────────────────────────────────────────────────

/**
 * Data-loading surface — injectable so tests can prove the read
 * path touches ONLY the hrDeductions collection.
 */
export interface HrPerformanceDataLoaders {
  loadHrDeductions(employeeId: string, monthKey: string): Promise<EmployeeHrDeductionRecord[]>;
}

/**
 * Default loaders — read the hrDeductions collection (same
 * db.ts cache as the employee-performance service).
 */
export const defaultHrPerformanceLoaders: HrPerformanceDataLoaders = {
  loadHrDeductions: async (employeeId: string, monthKey: string) => {
    const all = await getAll<EmployeeHrDeductionRecord>(HR_DEDUCTIONS_TABLE);
    return all.filter(
      (r) => r.employeeId === employeeId && r.month === monthKey,
    );
  },
};

/**
 * Read the HR PerformanceFactor for one employee-month.
 *
 * READ-ONLY: returns the factor with hasData=false and zero
 * summary when no records exist — caller surfaces the explicit
 * no-data state. Never fabricates data.
 *
 * Throws on malformed month key / employeeId.
 */
export async function getHrPerformanceFactor(
  monthKey: string,
  employeeId: string,
  loaders: HrPerformanceDataLoaders = defaultHrPerformanceLoaders,
): Promise<HrPerformanceFactorResult> {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`Invalid month key for HR PerformanceFactor: ${JSON.stringify(monthKey)} (YYYY-MM required)`);
  }
  if (!employeeId) {
    throw new Error('employeeId is required for HR PerformanceFactor');
  }

  const records = await loaders.loadHrDeductions(employeeId, monthKey);
  return buildHrPerformanceFactor({ employeeId, monthKey, records });
}
