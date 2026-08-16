// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — public API
//
//  Pure domain:   types, policy (day evaluation), monthly-engine,
//                 dates (validation/formatting), report-compat
//                 (legacy response mappers).
//  Configuration: rule-config (defaults + DB overlay + seed).
//  Persistence:   monthly-results (Milestone 3 — persisted canonical
//                 monthly results + generation/read orchestration).
//
//  The engine performs zero I/O. Firebase reads happen only in the
//  API adapters that feed it (Milestone 2 §32).
//
//  KPI:          kpi (Milestone 6 — Attendance KPI + PerformanceFactor
//                groundwork over the stored results; a consumer, not
//                a calculator).
// ══════════════════════════════════════════════════════════════

export type {
  AttendanceDayInput,
  AttendancePolicyConfig,
  AttendanceRecordInput,
  BiometricPairInput,
  DayEvaluation,
  DayRule,
  DayStatus,
  DeductionWaiverType,
  ExcuseCategory,
  ExcuseRulesConfig,
  LateTier,
  MonthlyAttendanceInput,
  MonthlyAttendanceResult,
  RequestInput,
  RequestStatus,
  RequestType,
  WeekendPolicy,
  WeekendPolicyMode,
} from './types';

export {
  evaluateDay,
  classifyExcuse,
  minutesLateVsShift,
  resolveLateTier,
} from './policy';

export { computeMonthlyAttendance } from './monthly-engine';

export {
  formatMinutes,
  getEvaluatedDates,
  isValidLegacyDate,
  legacyDateDayName,
  parseLegacyDate,
  round2,
} from './dates';

export {
  buildDailyBreakdown,
  buildReportRow,
} from './report-compat';
export type {
  BreakdownContext,
  DetailBreakdownEntry,
  ExternalDeductionTotals,
  GenerateReportRow,
  ReportRowExtras,
} from './report-compat';

export {
  CANONICAL_DEDUCTION_RULES,
  DEFAULT_ATTENDANCE_POLICY,
  ensureDeductionRulesSeeded,
  resolveAttendancePolicy,
} from './rule-config';
export type { DeductionRuleLike } from './rule-config';

// ── Persisted Monthly Attendance Results (Milestone 3) ──
export {
  ATTENDANCE_RESULTS_TABLE,
  ATTENDANCE_AUDIT_LOG_TABLE,
  ATTENDANCE_ENGINE_VERSION,
  ATTENDANCE_RESULT_SCHEMA_VERSION,
  attendanceResultId,
  buildPolicyFingerprint,
  buildMonthlyInputIndex,
  buildStoredAttendanceResult,
  planResultWrites,
  buildResultAuditMetadata,
  buildGenerationAuditEntries,
  generateMonthlyAttendanceResults,
  loadMonthlyRawInputs,
  getAttendanceResultsForMonth,
  getAttendanceResult,
} from './monthly-results';
export type {
  AttendanceGenerationSummary,
  AttendanceResultActor,
  EmployeeMonthlyInput,
  EmployeeResultSnapshot,
  MonthlyRawInputs,
  PlannedResultWrites,
  StoredAttendanceResult,
} from './monthly-results';

// ── Attendance KPI — PerformanceFactor groundwork (Milestone 6) ──
export {
  ATTENDANCE_KPI_FACTOR_ID,
  ATTENDANCE_KPI_FACTOR_NAME,
  ATTENDANCE_KPI_MAX_SCORE,
  ATTENDANCE_KPI_DEFAULT_WEIGHT,
  buildAttendanceKpi,
  buildAttendanceKpiBreakdown,
  defaultAttendanceKpiLoaders,
  getAttendanceKpi,
  getAttendanceKpisForMonth,
} from './kpi';
export type {
  AttendanceKpiDataLoaders,
  AttendanceKpiResult,
  AttendanceKpiScope,
} from './kpi';
