// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — legacy report compatibility
//
//  Pure mappers from MonthlyAttendanceResult (+ the separate quality
//  and HR deduction domains) onto the EXACT response shapes the
//  existing consumers were built against:
//    • buildReportRow()        → /api/reports/generate rows
//    • buildDailyBreakdown()   → /api/reports/employee-detail
//      dailyBreakdown entries (incl. legacy Arabic source strings)
//
//  R19 (Decision E): the engine result carries attendance deductions
//  only. Quality and HR deductions are composed here, explicitly
//  named — never merged inside the engine.
// ══════════════════════════════════════════════════════════════

import type {
  AttendanceRecordInput,
  BiometricPairInput,
  DayEvaluation,
  DeductionWaiverType,
  MonthlyAttendanceResult,
  RequestInput,
} from './types';
import { formatMinutes, round2 } from './dates';

/** External deduction totals composed into report rows by the adapters. */
export interface ExternalDeductionTotals {
  days: number;
  amount: number;
  count: number;
}

export interface ReportRowExtras {
  employeeName: string;
  department: string;
  position: string | null;
  quality: ExternalDeductionTotals;
  hr: ExternalDeductionTotals;
}

/** Row shape produced by /api/reports/generate (legacy contract). */
export interface GenerateReportRow {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string | null;
  totalPresent: number;
  totalLate: number;
  totalAbsent: number;
  totalExempt: number;
  totalMinutesLate: number;
  totalMinutesLateFormatted: string;
  lateDeductionDays: number;
  absenceDeductionDays: number;
  totalAttendanceDeductionDays: number;
  totalQualityDays: number;
  totalQualityAmount: number;
  totalHrDeductionDays: number;
  totalHrDeductionAmount: number;
  hrDeductionCount: number;
  /**
   * Legacy generate composition: attendance + quality + HR deduction
   * days. The attendance-domain value is always the separately named
   * totalAttendanceDeductionDays (R19).
   */
  totalDeductionDays: number;
  attendanceCompliance: number;
  workDays: number;
  effectiveWorkingDays: number;
  unaccountedDays: number;
  qualityCount: number;
  autoExemptDays: number;
  bonusDays: number;
}

/**
 * Build a legacy generate-report row. Field names and semantics are
 * byte-compatible with the previous /api/reports/generate response;
 * only the calculation source changed (canonical engine).
 */
export function buildReportRow(result: MonthlyAttendanceResult, extras: ReportRowExtras): GenerateReportRow {
  const totalAttendanceDeductionDays = round2(result.lateDeductionDays + result.absenceDeductionDays);
  const totalQualityDays = round2(extras.quality.days);
  const totalHrDeductionDays = round2(extras.hr.days);

  return {
    employeeId: result.employeeId,
    employeeName: extras.employeeName,
    department: extras.department,
    position: extras.position,
    totalPresent: result.presentDays,
    totalLate: result.lateDays,
    totalAbsent: result.absentDays,
    totalExempt: result.exemptDays,
    totalMinutesLate: result.totalMinutesLate,
    totalMinutesLateFormatted: formatMinutes(result.totalMinutesLate),
    lateDeductionDays: round2(result.lateDeductionDays),
    absenceDeductionDays: round2(result.absenceDeductionDays),
    totalAttendanceDeductionDays,
    totalQualityDays,
    totalQualityAmount: round2(extras.quality.amount),
    totalHrDeductionDays,
    totalHrDeductionAmount: round2(extras.hr.amount),
    hrDeductionCount: extras.hr.count,
    totalDeductionDays: round2(totalAttendanceDeductionDays + totalQualityDays + totalHrDeductionDays),
    attendanceCompliance: result.compliance,
    workDays: result.workDays,
    effectiveWorkingDays: result.effectiveWorkingDays,
    unaccountedDays: result.unaccountedDays,
    qualityCount: extras.quality.count,
    autoExemptDays: result.autoExemptDays,
    bonusDays: result.bonusDays,
  };
}

/** dailyBreakdown entry shape from /api/reports/employee-detail (legacy contract). */
export interface DetailBreakdownEntry {
  date: string;
  dayName: string;
  status: 'present' | 'late' | 'absent' | 'exempt';
  biometricCheckIn: string | null;
  biometricCheckOut: string | null;
  attendanceCheckIn: string | null;
  attendanceCheckOut: string | null;
  minutesLate: number;
  requestStatus: string | null;
  requestType: string | null;
  requestReason: string | null;
  absenceDeduction: number;
  lateDeduction: number;
  source: string;
  waived: boolean;
  waivedType: string | null;
  autoFree: boolean;
}

/** Raw per-date records the breakdown displays next to each evaluation. */
export interface BreakdownContext {
  biometricByDate?: Record<string, BiometricPairInput>;
  attendanceByDate?: Record<string, AttendanceRecordInput>;
  requestByDate?: Record<string, RequestInput>;
  waiversByDate?: Record<string, DeductionWaiverType[]>;
}

function requestTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'tardiness': return 'تأخير';
    case 'leave': return 'إجازة';
    case 'permission': return 'استئذان';
    default: return 'طلب';
  }
}

function excuseExemptLabel(category: 'medical' | 'accident'): string {
  return category === 'medical' ? '(إعفاء طبي)' : '(إعفاء حادث/طارئ)';
}

/**
 * Rebuild the legacy Arabic `source` string for one evaluation.
 * Legacy branch strings are preserved verbatim; the excuse branches
 * carry new strings for the canonical R9 rules (documented intentional
 * change — the old detail route rendered these days as exempt).
 */
function buildSource(
  day: DayEvaluation,
  request: RequestInput | undefined,
  biometric: BiometricPairInput | undefined,
): string {
  const waivedLate = day.waivedTypes.includes('late') || day.waivedTypes.includes('all');
  const waivedAbsence = day.waivedTypes.includes('absence') || day.waivedTypes.includes('all');
  const lateWaiveSuffix = ' (تم إلغاء خصم التأخير)';

  switch (day.ruleApplied) {
    case 'excuse-approved':
      // Post-allowance deduction: when the free-absence allowance
      // covered the day, the autoFree suffix explains the 0.
      return day.absenceDeductionDays > 0
        ? `طلب غياب مقبول (خصم ${day.absenceDeductionDays} يوم)`
        : 'طلب غياب مقبول';
    case 'excuse-approved-exempt':
      return `طلب غياب مقبول ${excuseExemptLabel(day.excuseCategory === 'accident' ? 'accident' : 'medical')}`;
    case 'excuse-rejected':
      return 'طلب غياب مرفوض (خصم يومين)';
    case 'excuse-pending':
      return 'طلب غياب معلق (غياب)';
    case 'excuse-unknown':
      return 'طلب غياب غير موجود (غياب)';
    case 'attendance-approved':
      return 'تسجيل حضور معتمد';
    case 'request-approved':
      return `طلب معتمد (${requestTypeLabel(request?.type)})`;
    case 'biometric-checkin': {
      let source = day.status === 'late' ? `بصمة (متأخر ${day.minutesLate} دقيقة)` : 'بصمة';
      if (day.status === 'late' && waivedLate) source += lateWaiveSuffix;
      if (!biometric?.checkOut) {
        source += waivedAbsence
          ? ' (بصمة دخول فقط - تم إلغاء الخصم)'
          : ' (بصمة دخول فقط - خصم نصف يوم)';
      }
      return source;
    }
    case 'biometric-checkout-only':
      return day.singleFingerprintDeductionDays > 0
        ? 'بصمة خروج فقط - خصم نصف يوم'
        : 'بصمة خروج فقط - تم إلغاء الخصم';
    case 'attendance-checkin': {
      let source = day.status === 'late' ? `تسجيل حضور (متأخر ${day.minutesLate} دقيقة)` : 'تسجيل حضور';
      if (day.status === 'late' && waivedLate) source += lateWaiveSuffix;
      return source;
    }
    case 'attendance-absent':
      if (waivedAbsence) return 'تسجيل غياب - تم إلغاء الخصم يدوياً';
      if (day.absenceDeductionDays > 1) return 'تسجيل غياب + طلب مرفوض (خصم يومين)';
      return 'تسجيل غياب';
    case 'attendance-present':
      return 'تسجيل حضور';
    case 'attendance-late':
      return waivedLate ? `تسجيل تأخير${lateWaiveSuffix}` : 'تسجيل تأخير';
    case 'request-rejected':
      return waivedAbsence ? 'طلب مرفوض - تم إلغاء الخصم يدوياً' : 'طلب مرفوض (خصم يومين)';
    case 'request-pending':
      return waivedAbsence ? 'طلب معلق - تم إلغاء الخصم يدوياً' : 'طلب معلق (غياب)';
    case 'no-record':
    default:
      return waivedAbsence ? 'بدون سجل - تم إلغاء الخصم يدوياً' : 'بدون سجل';
  }
}

/**
 * Build the legacy employee-detail dailyBreakdown array from the
 * canonical result plus the raw per-date records.
 */
export function buildDailyBreakdown(
  result: MonthlyAttendanceResult,
  ctx: BreakdownContext,
): DetailBreakdownEntry[] {
  return result.daily.map((day) => {
    const biometric = ctx.biometricByDate?.[day.date];
    const attendance = ctx.attendanceByDate?.[day.date];
    const request = ctx.requestByDate?.[day.date];
    const waivers = ctx.waiversByDate?.[day.date] ?? [];

    const source = buildSource(day, request, biometric);
    const autoFreeSuffix = day.autoFree && !day.waived ? ' (إعفاء تلقائي من 4 أيام)' : '';

    return {
      date: day.date,
      dayName: day.dayName ?? '',
      status: day.status,
      biometricCheckIn: biometric?.checkIn ?? null,
      biometricCheckOut: biometric?.checkOut ?? null,
      attendanceCheckIn: attendance?.checkIn ?? null,
      attendanceCheckOut: attendance?.checkOut ?? null,
      minutesLate: day.minutesLate,
      requestStatus: request?.status ?? null,
      requestType: request?.type ?? null,
      requestReason: request?.reason ?? null,
      // Legacy detail presentation: single-fingerprint deductions were
      // displayed inside absenceDeduction (while totaling with late
      // deductions server-side). Preserved for UI compatibility.
      absenceDeduction: day.absenceDeductionDays + day.singleFingerprintDeductionDays,
      lateDeduction: day.lateDeductionDays,
      source: source + autoFreeSuffix,
      waived: day.waived,
      waivedType: waivers[0] ?? null,
      autoFree: day.autoFree,
    };
  });
}
