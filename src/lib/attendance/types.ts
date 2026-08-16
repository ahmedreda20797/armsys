// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — domain types
//
//  Pure type definitions for the attendance policy domain extracted
//  from the duplicated logic that previously lived inside
//  /api/reports/generate and /api/reports/employee-detail
//  (Phase 2 Milestone 1 audit §4, §7).
//
//  This module imports nothing. It is the root of the attendance
//  domain dependency tree. No Firebase, no React, no HTTP.
// ══════════════════════════════════════════════════════════════

/** Waiver types carried by the legacy `waivedDeductions` collection. */
export type DeductionWaiverType = 'late' | 'absence' | 'all';

/** Request workflow states the engine accepts as read-only inputs. */
export type RequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * Request types produced by the Requests page (the official request
 * source — Milestone 2 Decision A). The literal union is the known
 * set; `string` keeps the engine tolerant to future types without a
 * domain change.
 */
export type RequestType = 'leave' | 'permission' | 'excuse' | 'tardiness' | 'remote' | (string & {});

/**
 * Excuse categories per Milestone 2 Decision D.
 * `medical` and `accident` are exempt from attendance deduction when
 * the excuse request is approved; `normal` deducts one day.
 */
export type ExcuseCategory = 'normal' | 'medical' | 'accident';

/**
 * Configuration for the approved/rejected/pending excuse rules
 * (Decision D / R9 resolution).
 */
export interface ExcuseRulesConfig {
  /** Approved ordinary excuse → deduction in days (Decision D: 1). */
  normalApprovedDeductionDays: number;
  /** Approved medical / accident / emergency excuse → deduction (Decision D: 0). */
  exemptApprovedDeductionDays: number;
  /** Rejected excuse (unauthorized absence) → deduction (Decision D: 2). */
  rejectedDeductionDays: number;
  /**
   * Pending excuse → provisional deduction while the request is not
   * finalized. Legacy-compatible value: 1 (the day is counted absent,
   * flagged unaccounted/pendingFinalization, and the day participates
   * in the free-absence allowance exactly like the legacy engine).
   */
  pendingDeductionDays: number;
  /**
   * Structured field name on request records that carries the excuse
   * category when present (e.g. `category`). The current Request model
   * has no such field; when a record later carries one it wins over
   * the free-text mapping. `null` disables structured lookup.
   */
  structuredCategoryField: string | null;
  /**
   * Interim free-text mapping: substrings that classify a medical
   * excuse from `request.reason` (config-driven, not hardcoded in
   * routes). Limitation documented in the Milestone 2 report.
   */
  medicalPatterns: string[];
  /** Interim free-text mapping: accident / emergency excuse patterns. */
  accidentPatterns: string[];
}

/**
 * Weekend / working-day behavior.
 *
 * `all-days-count` is the verified legacy behavior: EVERY calendar day
 * of the month is evaluated; a day with no records becomes an absence
 * (offset only by the free-absence allowance). The legacy code comment
 * claimed weekends are "not penalized", but no weekend exclusion was
 * implemented. This default preserves legacy behavior exactly; a real
 * weekend policy is a future business decision (audit §6 item 15).
 */
export type WeekendPolicyMode = 'all-days-count';

export interface WeekendPolicy {
  mode: WeekendPolicyMode;
}

/**
 * Complete configuration for the attendance policy. All verified rule
 * values (audit §4) live here — calculation functions hardcode nothing.
 */
export interface AttendancePolicyConfig {
  /** Grace minutes — first N minutes are free; late starts at N+1 (legacy: 15). */
  graceMinutes: number;
  /** Inclusive upper bound of the first late tier: grace+1..late15Threshold (legacy: 30). */
  late15Threshold: number;
  /** Inclusive upper bound of the second late tier (legacy: 60); above → late60. */
  late30Threshold: number;
  /** Deduction (days) for lateness in the first tier (legacy: 0.25). */
  late15DeductionDays: number;
  /** Deduction (days) for lateness in the second tier (legacy: 0.5). */
  late30DeductionDays: number;
  /** Deduction (days) for lateness beyond late30Threshold (legacy: 1). */
  late60DeductionDays: number;
  /** Deduction (days) for a normal absent day before the free allowance (legacy: 1). */
  absenceDeductionDays: number;
  /** Deduction (days) for a single fingerprint — check-in w/o check-out or vice versa (legacy: 0.5). */
  singleFingerprintDeductionDays: number;
  /** Free absence days per month; unused allowance becomes bonus days (legacy: 4). */
  freeAbsenceAllowance: number;
  /** Excuse request rules (Decision D). */
  excuse: ExcuseRulesConfig;
  /** Weekend / working-day behavior (legacy default: all-days-count). */
  weekendPolicy: WeekendPolicy;
}

/** Raw fingerprint pair for one employee-day (from the `biometrics` collection). */
export interface BiometricPairInput {
  checkIn: string | null;
  checkOut: string | null;
}

/** Operational attendance record for one employee-day (from `attendance`). */
export interface AttendanceRecordInput {
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  minutesLate: number;
  approvedRequestId: string | null;
}

/**
 * Request workflow input for one employee-day. The engine treats
 * requests as READ-ONLY inputs (Decision A) — it never creates,
 * mutates, or approves them.
 */
export interface RequestInput {
  id: string;
  type: RequestType;
  status: RequestStatus;
  reason?: string | null;
  /** Optional structured category field (not present in current data). */
  category?: string | null;
  createdAt?: string | null;
}

/**
 * Canonical per-employee / per-day input consumed by the policy
 * engine. The adapter layer resolves which biometric / attendance /
 * request / waiver records apply to the date (legacy semantics:
 * request = latest by createdAt for the date).
 */
export interface AttendanceDayInput {
  employeeId: string;
  /** Legacy canonical date format DD/MM/YYYY (validated). */
  date: string;
  shiftStart: string | null;
  shiftEnd?: string | null;
  biometric: BiometricPairInput | null;
  attendance: AttendanceRecordInput | null;
  request: RequestInput | null;
  waivers: DeductionWaiverType[];
}

/** Day outcome buckets (legacy counters present/late/absent/exempt). */
export type DayStatus = 'present' | 'late' | 'absent' | 'exempt';

/**
 * Which canonical rule produced a DayEvaluation. Stable identifiers —
 * adapters map them to legacy Arabic display strings.
 */
export type DayRule =
  | 'excuse-approved'            // P1: approved excuse, normal category → config deduction
  | 'excuse-approved-exempt'     // P1: approved excuse, medical/accident → 0
  | 'excuse-rejected'            // P1/P6: rejected request-backed absence → 2
  | 'excuse-pending'             // P1: pending excuse → provisional, unaccounted
  | 'excuse-unknown'             // P1: approvedRequestId present but request record missing
  | 'attendance-approved'        // P1b: attendance.status === 'approved'
  | 'request-approved'           // P2: approved request (leave/permission/...)
  | 'biometric-checkin'          // P3
  | 'biometric-checkout-only'    // P4
  | 'attendance-checkin'         // P5: manual record with check-in
  | 'attendance-absent'          // P5: manual absent record
  | 'attendance-present'         // P5: manual present record (no check-in)
  | 'attendance-late'            // P5: manual late record
  | 'request-rejected'           // P6: rejected request, no other records
  | 'request-pending'            // P6: pending request, no other records
  | 'no-record';                 // P7: nothing at all

/** Late tier applied on a late day (mirrors legacy deductionRules keys). */
export type LateTier = 'late15' | 'late30' | 'late60' | null;

/**
 * Structured result of evaluating one employee-day. Deduction fields
 * are post-waiver; `absenceDeductionDays` is additionally post
 * free-absence allowance once the monthly engine has finalized the
 * evaluation (`autoFree` marks the freed days).
 */
export interface DayEvaluation {
  date: string;
  dayName?: string;
  status: DayStatus;
  ruleApplied: DayRule;
  /** Excuse category when the day was decided by an excuse request. */
  excuseCategory: ExcuseCategory | null;
  /** Late tier applied (null when not a tiered late deduction). */
  lateTier: LateTier;
  /** Raw effective minutes late vs shift (0 when not late / unparseable). */
  minutesLate: number;
  /** Tier-based late deduction for the day (0 when waived / not late). */
  lateDeductionDays: number;
  /** Absence deduction for the day (post-waiver, post-allowance). */
  absenceDeductionDays: number;
  /** Single-fingerprint deduction for the day (0 when waived / complete pair). */
  singleFingerprintDeductionDays: number;
  /** late + absence + singleFingerprint for the day. */
  deductionDays: number;
  /** True when ANY waiver applies to this date. */
  waived: boolean;
  waivedTypes: DeductionWaiverType[];
  /** True when the free-absence allowance zeroed this day's deduction. */
  autoFree: boolean;
  /** True when the day's outcome is not final (pending/missing request, no record). */
  unaccounted: boolean;
  /** True when specifically a pending request holds the day unfinalized. */
  pendingFinalization: boolean;
}

/**
 * Employee + month aggregate — the canonical Monthly Attendance
 * Result. Contains ONLY attendance-policy deductions (Decision E /
 * R19): quality and HR deductions are separate domains composed by
 * the report adapters, never merged here.
 */
export interface MonthlyAttendanceResult {
  employeeId: string;
  /** YYYY-MM */
  month: string;
  /** Evaluated calendar days (legacy: all days of month, cutoff at asOf for current month). */
  workDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  exemptDays: number;
  unaccountedDays: number;
  totalMinutesLate: number;
  /** Tier deductions + single-fingerprint deductions (legacy `lateDeductionDays` semantics). */
  lateDeductionDays: number;
  /** Absence deductions after the free allowance. */
  absenceDeductionDays: number;
  /** Attendance-domain total: late + absence (R19: quality/HR excluded). */
  attendanceDeductionDays: number;
  /** Absent days covered by the free allowance (≤ freeAbsenceAllowance). */
  autoExemptDays: number;
  /** Unused allowance credited as attendance (legacy bonusDays). */
  bonusDays: number;
  /** present + late + exempt + autoExempt + bonus (legacy effectiveWorkingDays). */
  effectiveWorkingDays: number;
  /**
   * Legacy-compatible compliance:
   * round((present + late + exempt + bonus) / workDays × 100), clamped 0..100.
   */
  compliance: number;
  /** Per-day evaluations in calendar order (post-allowance). */
  daily: DayEvaluation[];
}

/**
 * Input to {@link computeMonthlyAttendance}. Day-scoped records are
 * supplied as date-keyed records so the engine can validate every key
 * and walk the evaluated calendar itself.
 */
export interface MonthlyAttendanceInput {
  employeeId: string;
  /** YYYY-MM (validated — invalid keys throw). */
  month: string;
  shiftStart: string | null;
  shiftEnd?: string | null;
  /**
   * Cutoff for the current month (legacy semantics: days after this
   * date are not evaluated). Pass a real `new Date()` from adapters;
   * pass a fixed date or null in tests.
   */
  asOf: Date | null;
  policy: AttendancePolicyConfig;
  biometricByDate?: Record<string, BiometricPairInput>;
  attendanceByDate?: Record<string, AttendanceRecordInput>;
  requestByDate?: Record<string, RequestInput>;
  waiversByDate?: Record<string, DeductionWaiverType[]>;
}
