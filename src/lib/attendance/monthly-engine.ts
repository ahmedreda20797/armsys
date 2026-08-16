// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — monthly aggregation
//
//  computeMonthlyAttendance(): walks the evaluated calendar days for
//  one employee + month, evaluates each day through policy.ts,
//  applies the free-absence allowance, and produces totals +
//  compliance + the per-day breakdown.
//
//  Pure: no Firebase, no HTTP, no clock reads (the cutoff date is an
//  explicit input). Deterministic for a fixed `asOf`.
// ══════════════════════════════════════════════════════════════

import type {
  AttendancePolicyConfig,
  DayEvaluation,
  MonthlyAttendanceInput,
  MonthlyAttendanceResult,
} from './types';
import { evaluateDay } from './policy';
import { getEvaluatedDates, isValidLegacyDate, round2 } from './dates';

/**
 * Validate that every date key in a per-day record map is a well-formed
 * DD/MM/YYYY calendar date. The engine refuses malformed inputs rather
 * than silently dropping them (adapters pre-filter legacy garbage with
 * the same validator, so clean deployments never hit this).
 */
function assertValidDateKeys(label: string, map: Record<string, unknown> | undefined): void {
  if (!map) return;
  for (const key of Object.keys(map)) {
    if (!isValidLegacyDate(key)) {
      throw new TypeError(`Invalid ${label} date key "${key}" (expected DD/MM/YYYY)`);
    }
  }
}

/**
 * Compute the canonical Monthly Attendance Result for one employee.
 *
 * Semantics preserved from the legacy report engine (audit §3.1, §4):
 *   • evaluated days   — every calendar day, cutoff at `asOf` for the
 *                        current month (weekendPolicy 'all-days-count');
 *   • allowance        — absent days sorted by date; the first
 *                        `freeAbsenceAllowance` entries have their
 *                        deduction zeroed (autoFree), zero-deduction
 *                        entries (waived / exempt-excuse) consume
 *                        slots exactly like legacy;
 *   • bonus days       — max(freeAbsenceAllowance − absentDays, 0),
 *                        credited as attendance in compliance;
 *   • lateDeductionDays — tier deductions + single-fingerprint
 *                        deductions (legacy total semantics);
 *   • compliance       — round((present+late+exempt+bonus)/workDays×100),
 *                        clamped 0..100 (legacy formula, §20).
 */
export function computeMonthlyAttendance(input: MonthlyAttendanceInput): MonthlyAttendanceResult {
  assertValidDateKeys('biometric', input.biometricByDate);
  assertValidDateKeys('attendance', input.attendanceByDate);
  assertValidDateKeys('request', input.requestByDate);
  assertValidDateKeys('waiver', input.waiversByDate);

  // Weekend policy: 'all-days-count' is the only implemented mode —
  // the evaluated calendar already reflects it. A future mode must be
  // an explicit config decision, never a silent change.
  if (input.policy.weekendPolicy.mode !== 'all-days-count') {
    throw new TypeError(`Unsupported weekend policy "${input.policy.weekendPolicy.mode}"`);
  }

  const dates = getEvaluatedDates(input.month, input.asOf);

  const daily: DayEvaluation[] = dates.map((date) =>
    evaluateDay(
      {
        employeeId: input.employeeId,
        date,
        shiftStart: input.shiftStart,
        shiftEnd: input.shiftEnd ?? null,
        biometric: input.biometricByDate?.[date] ?? null,
        attendance: input.attendanceByDate?.[date] ?? null,
        request: input.requestByDate?.[date] ?? null,
        waivers: input.waiversByDate?.[date] ?? [],
      },
      input.policy,
    ),
  );

  // ── Free-absence allowance (legacy post-processing) ──
  const absentEntries = daily
    .filter((day) => day.status === 'absent')
    .map((day) => ({ date: day.date, deduction: day.absenceDeductionDays }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const allowance = input.policy.freeAbsenceAllowance;
  const freeCount = Math.min(absentEntries.length, allowance);
  const autoFreeDates = new Set(
    absentEntries.slice(0, freeCount).map((entry) => entry.date),
  );

  let absenceDeductionDays = 0;
  for (let i = freeCount; i < absentEntries.length; i++) {
    absenceDeductionDays += absentEntries[i].deduction;
  }
  absenceDeductionDays = round2(absenceDeductionDays);

  // Finalize per-day evaluations with the allowance outcome.
  const finalized = daily.map((day) => {
    if (day.status === 'absent' && autoFreeDates.has(day.date)) {
      return { ...day, autoFree: true, absenceDeductionDays: 0, deductionDays: day.lateDeductionDays + day.singleFingerprintDeductionDays };
    }
    return day;
  });

  // ── Totals (legacy counter semantics) ──
  const presentDays = finalized.filter((d) => d.status === 'present').length;
  const lateDays = finalized.filter((d) => d.status === 'late').length;
  const absentDays = finalized.filter((d) => d.status === 'absent').length;
  const exemptDays = finalized.filter((d) => d.status === 'exempt').length;
  const unaccountedDays = finalized.filter((d) => d.unaccounted).length;
  const totalMinutesLate = finalized
    .filter((d) => d.status === 'late')
    .reduce((sum, d) => sum + d.minutesLate, 0);

  const lateDeductionDays = round2(
    finalized.reduce((sum, d) => sum + d.lateDeductionDays + d.singleFingerprintDeductionDays, 0),
  );

  const attendanceDeductionDays = round2(lateDeductionDays + absenceDeductionDays);

  const autoExemptDays = freeCount;
  const bonusDays = Math.max(allowance - absentDays, 0);

  const workDays = dates.length;
  const effectiveAttendance = presentDays + lateDays + exemptDays + bonusDays;
  const compliance = workDays > 0
    ? Math.min(Math.max(Math.min(Math.round((effectiveAttendance / workDays) * 100), 100), 0), 100)
    : 0;

  const effectiveWorkingDays = round2(presentDays + lateDays + exemptDays + autoExemptDays + bonusDays);

  return {
    employeeId: input.employeeId,
    month: input.month,
    workDays,
    presentDays,
    lateDays,
    absentDays,
    exemptDays,
    unaccountedDays,
    totalMinutesLate,
    lateDeductionDays,
    absenceDeductionDays,
    attendanceDeductionDays,
    autoExemptDays,
    bonusDays,
    effectiveWorkingDays,
    compliance,
    daily: finalized,
  };
}
