// ══════════════════════════════════════════════════════════════
//  Employee Performance History Service — Phase 2 Milestone 5
//
//  The FIRST REAL CONSUMER of the shared Time-Scope + Performance
//  History contract (Milestone 4). Employee 360 gets its three
//  explicit, labeled layers:
//
//    CURRENT  — the stored result for the current calendar month
//               only. Null per domain when that month has not been
//               generated yet. History is NEVER promoted into it.
//    HISTORY  — stored monthly results for strictly earlier months,
//               most recent first, exactly as stored (no
//               recalculation, no cross-month overwrites).
//    CAREER   — derived aggregations over the stored monthly
//               results (sampleSize, first/last month, best/worst,
//               average, MoM deltas) — built with the contract's
//               buildEmployeePerformanceLayers(), never from a new
//               counter or trend algorithm.
//
//  DATA-SOURCE RULES (binding — spec §13/§14/§24):
//    • Attendance → stored `attendanceResults` (Milestone 3) only.
//      A missing month is an explicit null — never a silent
//      recalculation from raw biometrics/attendance records.
//    • Quality    → stored `monthSnapshots` (Phase 1) only. The
//      live/open current-month Quality behavior is NOT duplicated
//      here: it stays owned by the existing Quality KPI paths
//      (EmployeeQualityKpiPanel / /api/kpi-dashboard / month
//      snapshot detail). A month without a stored snapshot yields
//      null — a 100 score is never fabricated.
//    • HR         → existing `hrDeductions` records, aggregated per
//      month and kept a SEPARATE, attributable domain (never merged
//      into Attendance or Quality).
//
//  This module is a READER/ASSEMBLER: it imports no calculation
//  engine — computeMonthlyAttendance, computeMonthSnapshot and
//  computeFreshMonthSnapshot are never called here.
//
//  Split (established project pattern):
//    • PURE — summarizeAttendanceResult, summarizeQualityEntry,
//      aggregateHrMonth, assembleEmployeePerformance (no DB).
//    • ORCHESTRATOR — getEmployeePerformance wires the pure
//      assembler to three BATCHED, cached collection reads (no N+1:
//      one read per domain, filtered in memory).
// ══════════════════════════════════════════════════════════════

import { getAll, getById, TTL } from '@/lib/db';
import { ATTENDANCE_RESULTS_TABLE } from '@/lib/attendance';
import type { StoredAttendanceResult } from '@/lib/attendance';
import { MONTH_SNAPSHOTS_TABLE } from '@/lib/month-lock';
import type { EmployeeScoreEntry, MonthSnapshot } from '@/types/quality-kpi';
import {
  buildEmployeePerformanceLayers,
  describeTimeScope,
  resolveTimeScopeMonthKeys,
  TIME_SCOPE_LABELS_AR,
  toMonthKey,
} from '@/lib/time-scope';
import type {
  CareerSummary,
  MetricSource,
  MonthScopedResult,
  TimeScope,
  TimeScopeKind,
} from '@/lib/time-scope';

// ─────────────────────────────────────────────────────────────
//  Constants + source metadata
// ─────────────────────────────────────────────────────────────

/** Existing HR domain collection (read-only consumer). */
export const HR_DEDUCTIONS_TABLE = 'hrDeductions';

/**
 * Source-domain metadata carried on every response (spec §23):
 * every value in the payload is attributable to exactly one stored
 * collection. HR stays its own domain — never merged into the
 * Attendance or Quality columns.
 */
export const EMPLOYEE_PERFORMANCE_SOURCES = {
  attendance: {
    domain: 'attendance' as MetricSource,
    collection: ATTENDANCE_RESULTS_TABLE,
    semantics: 'stored monthly result (attendance-v1) — no recalculation',
  },
  quality: {
    domain: 'quality' as MetricSource,
    collection: MONTH_SNAPSHOTS_TABLE,
    semantics: 'stored frozen/open snapshot entries — no recomputation',
  },
  hr: {
    domain: 'hr' as MetricSource,
    collection: HR_DEDUCTIONS_TABLE,
    semantics: 'HR deductions remain a separate attributable domain',
  },
} as const;

// ─────────────────────────────────────────────────────────────
//  Per-domain monthly summaries (slim API views over stored rows)
// ─────────────────────────────────────────────────────────────

/** Stored attendance result for one employee-month, summarized (spec §20: the stored result — NOT an attendance KPI). */
export interface EmployeeAttendanceMonthSummary {
  month: string;
  compliance: number;
  workDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  exemptDays: number;
  unaccountedDays: number;
  lateDeductionDays: number;
  absenceDeductionDays: number;
  attendanceDeductionDays: number;
  engineVersion: string;
  generatedAt: string;
}

/** One employee's entry inside a stored Quality month snapshot, summarized. */
export interface EmployeeQualityMonthSummary {
  month: string;
  score: number;
  deductionPoints: number;
  bonusPoints: number;
  observationCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  rank: number | null;
  /** Status of the STORED snapshot document the entry was read from. */
  snapshotStatus: MonthSnapshot['status'];
  /** Snapshot generation timestamp (when stored). */
  generatedAt: string | null;
}

/** One employee's HR deductions aggregated for one month (own domain — spec §15). */
export interface EmployeeHrMonthSummary {
  month: string;
  deductionCount: number;
  /** Σ amount over records with unit 'days' (parity with the existing Employee 360 HR stats). */
  deductionDays: number;
  /** Σ amount over records with a monetary unit (e.g. 'EGP'). */
  deductionAmount: number;
  /** Breakdown by HR status (pending/approved/rejected/…) — display stays attributable to HR. */
  statusCounts: Record<string, number>;
}

/** One cross-domain month row: each domain present only where stored data exists. */
export interface EmployeeMonthPerformanceRow {
  month: string;
  attendance: EmployeeAttendanceMonthSummary | null;
  quality: EmployeeQualityMonthSummary | null;
  hr: EmployeeHrMonthSummary | null;
}

/** The current-month layer (spec §5): nulls per domain, never promoted history. */
export type EmployeeCurrentPerformanceLayer = EmployeeMonthPerformanceRow;

// ─────────────────────────────────────────────────────────────
//  Career points (MonthScopedResult wrappers for the contract)
// ─────────────────────────────────────────────────────────────

/**
 * Career layer records: each domain's stored monthly summaries
 * wrapped in the shared MonthScopedResult identity so
 * buildEmployeePerformanceLayers can derive the career view. The
 * `result` kept inside best/worst months is the slim summary —
 * never the full stored document.
 */
export interface AttendanceCareerPoint extends MonthScopedResult {
  compliance: number;
  summary: EmployeeAttendanceMonthSummary;
}

export interface QualityCareerPoint extends MonthScopedResult {
  score: number;
  summary: EmployeeQualityMonthSummary;
}

export interface HrCareerPoint extends MonthScopedResult {
  deductionDays: number;
  summary: EmployeeHrMonthSummary;
}

export interface EmployeePerformanceCareer {
  attendance: CareerSummary<AttendanceCareerPoint>;
  quality: CareerSummary<QualityCareerPoint>;
  hr: CareerSummary<HrCareerPoint>;
}

/** Scope metadata (spec §6/§9/§12): every layer is explicitly labeled. */
export interface EmployeePerformanceScopeMeta {
  kind: TimeScopeKind;
  /** Arabic label from the shared contract vocabulary. */
  label: string;
  /** Machine-readable scope identifier (describeTimeScope). */
  describe: string;
  /** Resolved window months (most recent first) for calendar scopes; null for career. */
  months: string[] | null;
}

/** Response contract (spec §23). */
export interface EmployeePerformanceResponse {
  employeeId: string;
  scope: EmployeePerformanceScopeMeta;
  currentMonthKey: string;
  current: EmployeeCurrentPerformanceLayer;
  /** Prior stored monthly results, most recent first, current month never duplicated. */
  history: EmployeeMonthPerformanceRow[];
  career: EmployeePerformanceCareer;
  sources: typeof EMPLOYEE_PERFORMANCE_SOURCES;
}

/** Minimal raw HR deduction shape the assembler accepts (hrDeductions row projection). */
export interface EmployeeHrDeductionRecord {
  employeeId?: string | null;
  /** YYYY-MM — the canonical monthly identity of an HR deduction. */
  month?: string | null;
  amount?: number | null;
  unit?: string | null;
  status?: string | null;
}

// ─────────────────────────────────────────────────────────────
//  PURE BUILDERS
// ─────────────────────────────────────────────────────────────

/** Project a stored attendance result into its slim summary (verbatim values — no arithmetic). */
export function summarizeAttendanceResult(record: StoredAttendanceResult): EmployeeAttendanceMonthSummary {
  return {
    month: record.month,
    compliance: record.compliance,
    workDays: record.workDays,
    presentDays: record.presentDays,
    lateDays: record.lateDays,
    absentDays: record.absentDays,
    exemptDays: record.exemptDays,
    unaccountedDays: record.unaccountedDays,
    lateDeductionDays: record.lateDeductionDays,
    absenceDeductionDays: record.absenceDeductionDays,
    attendanceDeductionDays: record.attendanceDeductionDays,
    engineVersion: record.engineVersion,
    generatedAt: record.generatedAt,
  };
}

/** Project one employee's entry from a stored snapshot into its slim summary. */
export function summarizeQualityEntry(args: {
  monthKey: string;
  entry: EmployeeScoreEntry;
  snapshotStatus: MonthSnapshot['status'];
  generatedAt: string | null;
}): EmployeeQualityMonthSummary {
  return {
    month: args.monthKey,
    score: args.entry.score,
    deductionPoints: args.entry.deductionPoints,
    bonusPoints: args.entry.bonusPoints,
    observationCount: args.entry.observationCount,
    approvedCount: args.entry.approvedCount,
    pendingCount: args.entry.pendingCount,
    rejectedCount: args.entry.rejectedCount,
    rank: typeof args.entry.rank === 'number' ? args.entry.rank : null,
    snapshotStatus: args.snapshotStatus,
    generatedAt: args.generatedAt,
  };
}

/**
 * Aggregate one employee's HR deduction records for one month.
 * Parity with the existing Employee 360 HR stats: ALL statuses are
 * included in the totals (the existing route counts every record),
 * with the per-status breakdown exposed so the UI keeps HR
 * attributable and transparent.
 */
export function aggregateHrMonth(monthKey: string, records: EmployeeHrDeductionRecord[]): EmployeeHrMonthSummary {
  const statusCounts: Record<string, number> = {};
  let deductionDays = 0;
  let deductionAmount = 0;
  for (const record of records) {
    const amount = Number(record.amount) || 0;
    if (record.unit === 'days') deductionDays += amount;
    else deductionAmount += amount;
    const status = record.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  return {
    month: monthKey,
    deductionCount: records.length,
    deductionDays,
    deductionAmount,
    statusCounts,
  };
}

/** True for scopes that name exactly one month and must therefore always render their row (explicit no-data state). */
function isSingleMonthView(scope: TimeScope): boolean {
  return (
    scope.kind === 'day' ||
    scope.kind === 'current_month' ||
    scope.kind === 'previous_month' ||
    scope.kind === 'selected_month'
  );
}

/**
 * Assemble the three performance layers for ONE employee from
 * ALREADY-LOADED stored data (spec §5/§7/§8/§16).
 *
 * PURE: reads nothing, writes nothing, recalculates nothing. Every
 * value in the output is a projection of an input record.
 *
 * @param args.attendanceRecords Stored attendanceResults (already scoped to one employee — defensive re-filter applied).
 * @param args.qualitySnapshots  ALL stored monthSnapshots; this employee's entries are extracted by employeeId.
 * @param args.hrRecords         hrDeductions rows (defensively re-filtered to the employee).
 */
export function assembleEmployeePerformance(args: {
  employeeId: string;
  currentMonthKey: string;
  now: Date;
  scope: TimeScope;
  attendanceRecords: StoredAttendanceResult[];
  qualitySnapshots: MonthSnapshot[];
  hrRecords: EmployeeHrDeductionRecord[];
}): EmployeePerformanceResponse {
  const { employeeId, currentMonthKey, now, scope } = args;

  // ── Attendance: employee's stored results, last-wins per month (M3 regeneration semantics) ──
  const attendanceByMonth = new Map<string, StoredAttendanceResult>();
  for (const record of args.attendanceRecords) {
    if (record.employeeId !== employeeId || !record.month) continue;
    attendanceByMonth.set(record.month, record);
  }

  // ── Quality: this employee's entry inside each STORED snapshot (open or closed — stored values only) ──
  const qualityByMonth = new Map<string, EmployeeQualityMonthSummary>();
  for (const snapshot of args.qualitySnapshots) {
    const monthKey = snapshot.monthKey || snapshot.id;
    if (!monthKey) continue;
    const entry = snapshot.employeeScores?.[employeeId];
    if (!entry) continue;
    qualityByMonth.set(monthKey, summarizeQualityEntry({
      monthKey,
      entry,
      snapshotStatus: snapshot.status,
      generatedAt: snapshot.generatedAt ?? null,
    }));
  }

  // ── HR: group the employee's deduction records by canonical month ──
  const hrRecordsByMonth = new Map<string, EmployeeHrDeductionRecord[]>();
  for (const record of args.hrRecords) {
    if (record.employeeId !== employeeId || !record.month) continue;
    const list = hrRecordsByMonth.get(record.month) ?? [];
    list.push(record);
    hrRecordsByMonth.set(record.month, list);
  }

  // ── Career per domain: derived from ALL stored monthly results via the contract (spec §8) ──
  const attendanceCareer = buildEmployeePerformanceLayers<AttendanceCareerPoint>({
    records: [...attendanceByMonth.values()].map((record) => ({
      employeeId,
      month: record.month,
      compliance: record.compliance,
      summary: summarizeAttendanceResult(record),
    })),
    currentMonthKey,
    extractValue: (point) => point.compliance,
  }).career;

  const qualityCareer = buildEmployeePerformanceLayers<QualityCareerPoint>({
    records: [...qualityByMonth.values()].map((summary) => ({
      employeeId,
      month: summary.month,
      score: summary.score,
      summary,
    })),
    currentMonthKey,
    extractValue: (point) => point.score,
  }).career;

  const hrCareer = buildEmployeePerformanceLayers<HrCareerPoint>({
    records: [...hrRecordsByMonth.entries()].map(([month, records]) => {
      const summary = aggregateHrMonth(month, records);
      return { employeeId, month, deductionDays: summary.deductionDays, summary };
    }),
    currentMonthKey,
    extractValue: (point) => point.deductionDays,
  }).career;

  // ── Current layer: current month ONLY — null per domain when not generated (spec §5) ──
  const currentAttendance = attendanceByMonth.has(currentMonthKey)
    ? summarizeAttendanceResult(attendanceByMonth.get(currentMonthKey)!)
    : null;
  const currentQuality = qualityByMonth.get(currentMonthKey) ?? null;
  const currentHr = hrRecordsByMonth.has(currentMonthKey)
    ? aggregateHrMonth(currentMonthKey, hrRecordsByMonth.get(currentMonthKey)!)
    : null;
  const current: EmployeeCurrentPerformanceLayer = {
    month: currentMonthKey,
    attendance: currentAttendance,
    quality: currentQuality,
    hr: currentHr,
  };

  // ── History layer: strictly earlier months with ANY stored value, most recent first (spec §7) ──
  const storedMonthsBeforeCurrent = new Set<string>();
  for (const month of attendanceByMonth.keys()) if (month < currentMonthKey) storedMonthsBeforeCurrent.add(month);
  for (const month of qualityByMonth.keys()) if (month < currentMonthKey) storedMonthsBeforeCurrent.add(month);
  for (const month of hrRecordsByMonth.keys()) if (month < currentMonthKey) storedMonthsBeforeCurrent.add(month);

  const windowMonths = resolveTimeScopeMonthKeys(scope, now); // null for career
  let historyMonths = [...storedMonthsBeforeCurrent];
  if (windowMonths !== null) {
    const windowSet = new Set(windowMonths);
    historyMonths = historyMonths.filter((month) => windowSet.has(month));
    // A single explicitly-selected month always renders its row so the
    // user sees the explicit no-data state instead of an empty list.
    if (isSingleMonthView(scope)) {
      for (const month of windowMonths) {
        if (month < currentMonthKey && !storedMonthsBeforeCurrent.has(month)) historyMonths.push(month);
      }
    }
  }
  historyMonths.sort((a, b) => b.localeCompare(a)); // most recent first

  const history: EmployeeMonthPerformanceRow[] = historyMonths.map((month) => ({
    month,
    attendance: attendanceByMonth.has(month) ? summarizeAttendanceResult(attendanceByMonth.get(month)!) : null,
    quality: qualityByMonth.get(month) ?? null,
    hr: hrRecordsByMonth.has(month) ? aggregateHrMonth(month, hrRecordsByMonth.get(month)!) : null,
  }));

  return {
    employeeId,
    scope: {
      kind: scope.kind,
      label: TIME_SCOPE_LABELS_AR[scope.kind],
      describe: describeTimeScope(scope),
      months: windowMonths,
    },
    currentMonthKey,
    current,
    history,
    career: { attendance: attendanceCareer, quality: qualityCareer, hr: hrCareer },
    sources: EMPLOYEE_PERFORMANCE_SOURCES,
  };
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATOR — batched, cached reads + the pure assembler
// ─────────────────────────────────────────────────────────────

/**
 * Data-loading surface of the orchestrator — injectable so tests
 * can prove the reader path touches ONLY these three stored
 * collections (never a calculation engine).
 */
export interface EmployeePerformanceDataLoaders {
  loadEmployee(employeeId: string): Promise<{ id: string } | null>;
  /** One cached collection read, filtered in memory (no per-month N+1). */
  loadAttendanceResults(employeeId: string): Promise<StoredAttendanceResult[]>;
  /** One cached collection read; employee entries extracted in memory. */
  loadQualitySnapshots(): Promise<MonthSnapshot[]>;
  /** One cached collection read, filtered in memory. */
  loadHrDeductions(employeeId: string): Promise<EmployeeHrDeductionRecord[]>;
}

/**
 * Default loaders — READ-ONLY over the stored collections, reusing
 * the db.ts cache (TTL parity with the established readers:
 * attendanceResults TTL.STATIC like getAttendanceResultsForMonth,
 * monthSnapshots TTL.MEDIUM like the Quality observation reads).
 * No new caching system is introduced.
 */
export const defaultEmployeePerformanceLoaders: EmployeePerformanceDataLoaders = {
  loadEmployee: (employeeId) => getById<{ id: string }>('employees', employeeId),
  loadAttendanceResults: async (employeeId) => {
    const all = await getAll<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE, TTL.STATIC);
    return all.filter((record) => record.employeeId === employeeId);
  },
  loadQualitySnapshots: () => getAll<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, TTL.MEDIUM),
  loadHrDeductions: async (employeeId) => {
    const all = await getAll<EmployeeHrDeductionRecord>(HR_DEDUCTIONS_TABLE);
    return all.filter((record) => record.employeeId === employeeId);
  },
};

/**
 * Build the Employee 360 performance layers for one employee.
 *
 * Reader/assembler ONLY (spec §24): three batched collection reads
 * (Promise.all — no N+1), then the pure assembler. Returns null
 * when the employee id does not exist (caller surfaces 404).
 *
 * @param args.scope Time scope for the history window (defaults to
 *                   `career` — every stored month). The current
 *                   layer is ALWAYS the current calendar month.
 */
export async function getEmployeePerformance(
  args: {
    employeeId: string;
    scope?: TimeScope;
    now?: Date;
  },
  loaders: EmployeePerformanceDataLoaders = defaultEmployeePerformanceLoaders,
): Promise<EmployeePerformanceResponse | null> {
  const { employeeId, scope = { kind: 'career' } } = args;
  const now = args.now ?? new Date();

  const employee = await loaders.loadEmployee(employeeId);
  if (!employee) return null;

  const [attendanceRecords, qualitySnapshots, hrRecords] = await Promise.all([
    loaders.loadAttendanceResults(employeeId),
    loaders.loadQualitySnapshots(),
    loaders.loadHrDeductions(employeeId),
  ]);

  return assembleEmployeePerformance({
    employeeId,
    currentMonthKey: toMonthKey(now),
    now,
    scope,
    attendanceRecords,
    qualitySnapshots,
    hrRecords,
  });
}
