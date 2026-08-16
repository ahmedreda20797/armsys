// ══════════════════════════════════════════════════════════════
//  Attendance KPI — PerformanceFactor Groundwork (Phase 2 M6)
//
//  Establishes the Attendance KPI as an independent, time-scoped
//  performance factor DERIVED from the persisted monthly result:
//
//    raw inputs → canonical engine → attendanceResults → THIS KPI
//
//  BINDING SOURCE RULE (spec §2/§24): the KPI score IS the stored
//  attendanceResults.compliance — verbatim, no rounding, no second
//  attendance formula, no recalculation from biometrics / raw
//  attendance / requests / waivers. The KPI layer is a CONSUMER of
//  the persisted result; it does not replace it.
//
//  PerformanceFactor integration: reuses the generic
//  @/lib/kpi-scoring PerformanceFactor type (the same interface
//  Quality exposes). The factor is constructed through the
//  established direct adapter (kpi-dashboard pattern): compliance is
//  already a 0–100 scale, so toPerformanceFactor()'s
//  score+deductions maxScore reconstruction would be WRONG here
//  (0 deduction days → maxScore would collapse to the score itself).
//
//  WEIGHT SCOPE RULE (spec §7): weight is the type-required
//  default-safe placeholder (1) ONLY — the future Unified
//  Performance Engine owns composition weights. No final employee
//  score is computed, Quality/Sales/HR stay separate domains.
//
//  Split (established project pattern):
//    • PURE — buildAttendanceKpiBreakdown, buildAttendanceKpi.
//    • ORCHESTRATORS — getAttendanceKpi, getAttendanceKpisForMonth:
//      thin readers over the EXISTING monthly-results loaders (same
//      db.ts cache — no second caching system, no N+1), returning
//      null / [] when the month was never generated (explicit
//      not_generated state for the caller — never a silent fallback,
//      never a fabricated 100).
//
//  Zero raw attendance calculations. No Firebase writes. No React.
// ══════════════════════════════════════════════════════════════

import type { PerformanceFactor } from '@/lib/kpi-scoring';
import type { TimeScope } from '@/lib/time-scope';
import { isValidMonthKey } from '@/lib/month-utils';
import { ATTENDANCE_RESULTS_TABLE, getAttendanceResult, getAttendanceResultsForMonth } from './monthly-results';
import type { StoredAttendanceResult } from './monthly-results';

// ─────────────────────────────────────────────────────────────
//  Constants — factor identity + scale
// ─────────────────────────────────────────────────────────────

/** Stable PerformanceFactor identifier (parity with Quality's 'quality'). */
export const ATTENDANCE_KPI_FACTOR_ID = 'attendance';

/** Human-readable factor name (Arabic — the display language of the factor). */
export const ATTENDANCE_KPI_FACTOR_NAME = 'الحضور';

/**
 * Attendance KPI scale: compliance is already produced by the
 * canonical engine as a 0–100 percentage, so 100 is the maximum.
 */
export const ATTENDANCE_KPI_MAX_SCORE = 100;

/**
 * Default-safe weight placeholder required by the generic
 * PerformanceFactor type. NOT a composition decision — the future
 * Unified Performance Engine owns the real weights (spec §7).
 */
export const ATTENDANCE_KPI_DEFAULT_WEIGHT = 1;

// ─────────────────────────────────────────────────────────────
//  Result contract (spec §11)
// ─────────────────────────────────────────────────────────────

/**
 * The Attendance KPI scope is ALWAYS one explicitly named month —
 * never an unlabeled point value ("Attendance KPI — August 2026",
 * not "Attendance KPI = 93"). Extracted from the shared TimeScope
 * vocabulary (M4) so consumers label it with the standard tools.
 */
export type AttendanceKpiScope = Extract<TimeScope, { kind: 'selected_month' }>;

/**
 * The performance-factor representation of ONE stored monthly
 * attendance result (spec §4/§5/§11). Derived from
 * attendanceResults only; carries the full traceability metadata
 * (source, engineVersion, policyFingerprint, generatedAt) so
 * "why did this employee receive this KPI?" stays answerable
 * historically without recalculating anything.
 */
export interface AttendanceKpiResult {
  employeeId: string;
  /** Display name snapshotted on the stored result (verbatim — batch consumers). */
  employeeName: string;
  /** Department snapshotted on the stored result (verbatim — enables department filtering). */
  department: string | null;
  /** YYYY-MM — the month this KPI belongs to (its own scope; never inherited). */
  month: string;
  /** Explicit month scope from the shared TimeScope vocabulary. */
  scope: AttendanceKpiScope;
  /** = stored compliance, verbatim (0–100). */
  score: number;
  maxScore: number;
  /** score / maxScore (0–1), full precision — display formatting is a UI concern. */
  normalized: number;
  /** Generic PerformanceFactor output (kpi-scoring contract). */
  performanceFactor: PerformanceFactor;
  /** Stored collection the value was derived from ('attendanceResults'). */
  source: typeof ATTENDANCE_RESULTS_TABLE;
  /** Preserved from the stored result (traceability, spec §22). */
  engineVersion: string;
  /** Preserved from the stored result (traceability, spec §22). */
  policyFingerprint: string;
  /** Preserved from the stored result — the generation run, not the KPI read. */
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  PURE BUILDERS
// ─────────────────────────────────────────────────────────────

/**
 * Breakdown of the Attendance KPI — every value READ verbatim from
 * the stored result (spec §15: none of these is re-derived).
 * Attendance-domain counters only; HR/Quality/Sales never appear.
 */
export function buildAttendanceKpiBreakdown(
  stored: StoredAttendanceResult,
): Record<string, number> {
  return {
    presentDays: stored.presentDays,
    lateDays: stored.lateDays,
    absentDays: stored.absentDays,
    exemptDays: stored.exemptDays,
    lateDeductionDays: stored.lateDeductionDays,
    absenceDeductionDays: stored.absenceDeductionDays,
    attendanceDeductionDays: stored.attendanceDeductionDays,
    compliance: stored.compliance,
  };
}

/**
 * Transform ONE stored monthly attendance result into its
 * Attendance KPI + PerformanceFactor (pure: no I/O, no mutation of
 * the input record, no alteration of the source value).
 *
 * Parity guarantee (spec §24):
 *   stored.compliance === kpi.score === performanceFactor.score
 */
export function buildAttendanceKpi(stored: StoredAttendanceResult): AttendanceKpiResult {
  // Verbatim copy — no rounding, no clamping, no second formula.
  const score = stored.compliance;
  const normalized = score / ATTENDANCE_KPI_MAX_SCORE;

  const performanceFactor: PerformanceFactor = {
    factorId: ATTENDANCE_KPI_FACTOR_ID,
    factorName: ATTENDANCE_KPI_FACTOR_NAME,
    score,
    maxScore: ATTENDANCE_KPI_MAX_SCORE,
    weight: ATTENDANCE_KPI_DEFAULT_WEIGHT,
    normalized,
    breakdown: buildAttendanceKpiBreakdown(stored),
  };

  return {
    employeeId: stored.employeeId,
    employeeName: stored.employeeSnapshot?.employeeName ?? stored.employeeId,
    department: stored.employeeSnapshot?.department ?? null,
    month: stored.month,
    scope: { kind: 'selected_month', monthKey: stored.month },
    score,
    maxScore: ATTENDANCE_KPI_MAX_SCORE,
    normalized,
    performanceFactor,
    source: ATTENDANCE_RESULTS_TABLE,
    engineVersion: stored.engineVersion,
    policyFingerprint: stored.policyFingerprint,
    generatedAt: stored.generatedAt,
  };
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATORS — stored-results readers only
// ─────────────────────────────────────────────────────────────

/**
 * Data-loading surface — injectable so tests can prove the KPI read
 * path touches ONLY the stored attendanceResults collection (never
 * a calculation engine, never biometrics / raw attendance).
 */
export interface AttendanceKpiDataLoaders {
  loadAttendanceResult(monthKey: string, employeeId: string): Promise<StoredAttendanceResult | null>;
  loadAttendanceResultsForMonth(monthKey: string): Promise<StoredAttendanceResult[]>;
}

/**
 * Default loaders — the EXISTING monthly-results readers (same
 * db.ts cache; TTL semantics unchanged). No new read or caching
 * layer is introduced.
 */
export const defaultAttendanceKpiLoaders: AttendanceKpiDataLoaders = {
  loadAttendanceResult: (monthKey, employeeId) => getAttendanceResult(monthKey, employeeId),
  loadAttendanceResultsForMonth: (monthKey) => getAttendanceResultsForMonth(monthKey),
};

/**
 * Read the Attendance KPI for one employee-month.
 *
 * READ-ONLY: returns null when no stored result exists — the caller
 * surfaces the explicit not_generated state. Never falls back to a
 * raw recalculation, never fabricates a value (spec §10).
 *
 * Throws on malformed month key / employeeId (strict-contract
 * convention) and on a corrupt stored row whose identity does not
 * match the requested employee-month.
 */
export async function getAttendanceKpi(
  monthKey: string,
  employeeId: string,
  loaders: AttendanceKpiDataLoaders = defaultAttendanceKpiLoaders,
): Promise<AttendanceKpiResult | null> {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`Invalid month key for Attendance KPI: ${JSON.stringify(monthKey)} (YYYY-MM required)`);
  }
  if (!employeeId) {
    throw new Error('employeeId is required for Attendance KPI');
  }

  const stored = await loaders.loadAttendanceResult(monthKey, employeeId);
  if (!stored) return null; // explicit not_generated — no fallback, no fabrication

  if (stored.employeeId !== employeeId || stored.month !== monthKey) {
    throw new Error(
      `Corrupt attendance result ${stored.id ?? '(no id)'}: stored identity ` +
      `(${stored.employeeId}/${stored.month}) does not match the request (${employeeId}/${monthKey})`,
    );
  }

  return buildAttendanceKpi(stored);
}

/**
 * Read the Attendance KPIs for every employee of one generated
 * month (batch consumer surface, spec §14). A month that was never
 * generated returns [] — same explicit semantics as the M3 list
 * reader. Filtering/pagination stay consumer concerns.
 */
export async function getAttendanceKpisForMonth(
  monthKey: string,
  loaders: AttendanceKpiDataLoaders = defaultAttendanceKpiLoaders,
): Promise<AttendanceKpiResult[]> {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`Invalid month key for Attendance KPI: ${JSON.stringify(monthKey)} (YYYY-MM required)`);
  }

  const storedResults = await loaders.loadAttendanceResultsForMonth(monthKey);
  return storedResults.map(buildAttendanceKpi);
}
