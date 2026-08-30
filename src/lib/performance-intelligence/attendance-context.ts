// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Attendance Context (Phase 3)
//
//  CONTEXT ONLY (spec §13): attendance is exposed as a separate
//  analytical dimension and NEVER enters the Quality KPI or its
//  weights. The projection reads the STORED monthly result
//  (attendanceResults, engine attendance-v1) verbatim — raw
//  biometrics/attendance records are never re-evaluated here, and a
//  month without a stored result is NOT_AVAILABLE (never zero).
//  Fields that do not exist in the data model (e.g. overtimeHours)
//  are not invented.
// ══════════════════════════════════════════════════════════════

import type { StoredAttendanceResult } from '@/lib/attendance';
import type { AttendanceContextFacts } from './types';

export function buildAttendanceContext(
  record: StoredAttendanceResult | null,
): AttendanceContextFacts {
  if (!record) return { status: 'NOT_AVAILABLE', source: 'attendanceResults', result: null };
  return {
    status: 'AVAILABLE',
    source: 'attendanceResults',
    result: {
      month: record.month,
      workDays: record.workDays,
      presentDays: record.presentDays,
      lateDays: record.lateDays,
      absentDays: record.absentDays,
      exemptDays: record.exemptDays,
      unaccountedDays: record.unaccountedDays,
      totalMinutesLate: record.totalMinutesLate,
      lateDeductionDays: record.lateDeductionDays,
      absenceDeductionDays: record.absenceDeductionDays,
      attendanceDeductionDays: record.attendanceDeductionDays,
      compliance: record.compliance,
      engineVersion: record.engineVersion,
      generatedAt: record.generatedAt ?? null,
    },
  };
}
