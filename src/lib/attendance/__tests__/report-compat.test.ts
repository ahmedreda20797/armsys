// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — legacy response parity tests
//
//  Proves the compatibility layer reproduces the legacy report
//  contracts consumed by ReportsPage / employee-detail / export:
//    • buildReportRow()      → /api/reports/generate row fields
//    • buildDailyBreakdown() → employee-detail dailyBreakdown
//      entries incl. the legacy Arabic source strings
//  Plus the R19 domain-separation matrix (§31).
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportRow, buildDailyBreakdown } from '@/lib/attendance/report-compat';
import { computeMonthlyAttendance } from '@/lib/attendance/monthly-engine';
import { DEFAULT_ATTENDANCE_POLICY } from '@/lib/attendance/rule-config';
import { formatMinutes } from '@/lib/attendance/dates';
import type { MonthlyAttendanceInput, RequestInput } from '@/lib/attendance/types';

const POLICY = DEFAULT_ATTENDANCE_POLICY;

function bio(checkIn: string | null, checkOut: string | null) {
  return { checkIn, checkOut };
}

function att(status: string, minutesLate = 0, approvedRequestId: string | null = null) {
  return { checkIn: null, checkOut: null, status, minutesLate, approvedRequestId };
}

/** Fill every July day with a present biometric except the excluded dates. */
function presentJuly(exclude: string[] = []): Record<string, ReturnType<typeof bio>> {
  const map: Record<string, ReturnType<typeof bio>> = {};
  for (let d = 1; d <= 31; d++) {
    const key = `${String(d).padStart(2, '0')}/07/2026`;
    if (!exclude.includes(key)) map[key] = bio('08:55', '17:00');
  }
  return map;
}

/** Golden month fixture (identical to the monthly-engine golden scenario). */
function goldenMonth(): { result: ReturnType<typeof computeMonthlyAttendance>; ctx: MonthlyAttendanceInput } {
  const biometricByDate: Record<string, ReturnType<typeof bio>> = {};
  for (let d = 1; d <= 5; d++) biometricByDate[`0${d}/07/2026`] = bio('08:55', '17:00');
  biometricByDate['06/07/2026'] = bio('09:20', '17:00');
  biometricByDate['07/07/2026'] = bio('09:45', '17:00');
  biometricByDate['08/07/2026'] = bio('10:30', '17:00');
  biometricByDate['09/07/2026'] = bio('08:55', null);
  biometricByDate['10/07/2026'] = bio(null, '17:30');
  for (let d = 15; d <= 20; d++) biometricByDate[`${d}/07/2026`] = bio('08:58', '17:00');

  const attendanceByDate = {
    '11/07/2026': { checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 0, approvedRequestId: null },
    '12/07/2026': { checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 35, approvedRequestId: null },
    '13/07/2026': att('absent'),
  };
  const requestByDate: Record<string, RequestInput> = {
    '14/07/2026': { id: 'r1', type: 'leave', status: 'approved' },
  };

  const input: MonthlyAttendanceInput = {
    employeeId: 'emp-1',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate,
    attendanceByDate,
    requestByDate,
  };
  return { result: computeMonthlyAttendance(input), ctx: input };
}

// ─── Generate row parity ───────────────────────────────────────

test('golden month → legacy generate row fields with quality + HR composed (R19)', () => {
  const { result } = goldenMonth();
  const row = buildReportRow(result, {
    employeeName: 'أحمد محمد',
    department: 'Operations',
    position: 'Engineer',
    quality: { days: 1.5, amount: 500, count: 2 },
    hr: { days: 2, amount: 600, count: 1 },
  });

  assert.equal(row.employeeId, 'emp-1');
  assert.equal(row.employeeName, 'أحمد محمد');
  assert.equal(row.totalPresent, 14);
  assert.equal(row.totalLate, 4);
  assert.equal(row.totalAbsent, 12);
  assert.equal(row.totalExempt, 1);
  assert.equal(row.totalMinutesLate, 190);
  assert.equal(row.totalMinutesLateFormatted, '3س 10د');
  assert.equal(row.lateDeductionDays, 3.25);
  assert.equal(row.absenceDeductionDays, 8);
  assert.equal(row.totalAttendanceDeductionDays, 11.25);
  assert.equal(row.totalQualityDays, 1.5);
  assert.equal(row.totalQualityAmount, 500);
  assert.equal(row.totalHrDeductionDays, 2);
  assert.equal(row.totalHrDeductionAmount, 600);
  assert.equal(row.hrDeductionCount, 1);
  assert.equal(row.qualityCount, 2);
  // Legacy generate composition: attendance + quality + HR
  assert.equal(row.totalDeductionDays, 14.75);
  assert.equal(row.attendanceCompliance, 61);
  assert.equal(row.workDays, 31);
  assert.equal(row.effectiveWorkingDays, 23);
  assert.equal(row.unaccountedDays, 11);
  assert.equal(row.autoExemptDays, 4);
  assert.equal(row.bonusDays, 0);
});

test('R19 matrix: attendance 1 day ≠ HR 2 days — domains stay separate and explicitly named', () => {
  // 5 plain absent days (rest of month present) → 1 deduction day after allowance
  const absent = ['21/07/2026', '22/07/2026', '23/07/2026', '24/07/2026', '25/07/2026'];
  const focused = computeMonthlyAttendance({
    employeeId: 'emp-2',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate: presentJuly(absent),
    attendanceByDate: Object.fromEntries(absent.map((d) => [d, att('absent')])),
  });
  assert.equal(focused.attendanceDeductionDays, 1);

  const row = buildReportRow(focused, {
    employeeName: 'X',
    department: '—',
    position: null,
    quality: { days: 0, amount: 0, count: 0 },
    hr: { days: 2, amount: 0, count: 2 },
  });
  assert.equal(row.totalAttendanceDeductionDays, 1);
  assert.equal(row.totalHrDeductionDays, 2);
  assert.equal(row.totalDeductionDays, 3);
});

// ─── Detail breakdown parity (legacy Arabic sources) ──────────

test('golden month → legacy dailyBreakdown entries and source strings', () => {
  const { result, ctx } = goldenMonth();
  const breakdown = buildDailyBreakdown(result, ctx);
  assert.equal(breakdown.length, 31);

  const byDate = new Map(breakdown.map((e) => [e.date, e]));

  // P3 late via biometric
  const d06 = byDate.get('06/07/2026')!;
  assert.equal(d06.status, 'late');
  assert.equal(d06.source, 'بصمة (متأخر 20 دقيقة)');
  assert.equal(d06.lateDeduction, 0.25);
  assert.equal(d06.absenceDeduction, 0);
  assert.equal(d06.biometricCheckIn, '09:20');
  assert.equal(d06.minutesLate, 20);
  assert.equal(d06.dayName, 'الإثنين'); // 6 July 2026 is a Monday

  // P3 single fingerprint (missing check-out) displayed in absenceDeduction (legacy)
  const d09 = byDate.get('09/07/2026')!;
  assert.equal(d09.status, 'present');
  assert.equal(d09.source, 'بصمة (بصمة دخول فقط - خصم نصف يوم)');
  assert.equal(d09.absenceDeduction, 0.5);

  // P4 checkout-only
  const d10 = byDate.get('10/07/2026')!;
  assert.equal(d10.source, 'بصمة خروج فقط - خصم نصف يوم');
  assert.equal(d10.absenceDeduction, 0.5);

  // P5 attendance check-in late
  const d12 = byDate.get('12/07/2026')!;
  assert.equal(d12.source, 'تسجيل حضور (متأخر 35 دقيقة)');

  // P2 approved request
  const d14 = byDate.get('14/07/2026')!;
  assert.equal(d14.status, 'exempt');
  assert.equal(d14.source, 'طلب معتمد (إجازة)');
  assert.equal(d14.requestStatus, 'approved');
  assert.equal(d14.requestType, 'leave');

  // autoFree days: first absent days by date get the legacy suffix.
  // Day 13 carries an attendance absent record → legacy source 'تسجيل غياب'.
  const d13 = byDate.get('13/07/2026')!;
  assert.equal(d13.status, 'absent');
  assert.equal(d13.autoFree, true);
  assert.equal(d13.source, 'تسجيل غياب (إعفاء تلقائي من 4 أيام)');
  assert.equal(d13.absenceDeduction, 0);

  // 5th+ absent days stay plain
  const d24 = byDate.get('24/07/2026')!;
  assert.equal(d24.source, 'بدون سجل');
  assert.equal(d24.absenceDeduction, 1);
});

test('waived days keep legacy source suffixes and waivedType passthrough', () => {
  const input: MonthlyAttendanceInput = {
    employeeId: 'emp-3',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate: { ...presentJuly(['01/07/2026', '02/07/2026']), '01/07/2026': bio('09:45', '17:00') },
    attendanceByDate: { '02/07/2026': att('absent') },
    waiversByDate: {
      '01/07/2026': ['late'],
      '02/07/2026': ['absence'],
    },
  };
  const result = computeMonthlyAttendance(input);
  const breakdown = buildDailyBreakdown(result, input);
  const byDate = new Map(breakdown.map((e) => [e.date, e]));

  const waivedLate = byDate.get('01/07/2026')!;
  assert.equal(waivedLate.source, 'بصمة (متأخر 45 دقيقة) (تم إلغاء خصم التأخير)');
  assert.equal(waivedLate.lateDeduction, 0);
  assert.equal(waivedLate.waived, true);
  assert.equal(waivedLate.waivedType, 'late');

  const waivedAbsence = byDate.get('02/07/2026')!;
  assert.equal(waivedAbsence.source, 'تسجيل غياب - تم إلغاء الخصم يدوياً');
  assert.equal(waivedAbsence.absenceDeduction, 0);
});

test('R9 excuse days render the canonical (not legacy-exempt) breakdown entries', () => {
  const excuseDays = ['01/07/2026', '02/07/2026', '03/07/2026', '04/07/2026', '05/07/2026'];
  const input: MonthlyAttendanceInput = {
    employeeId: 'emp-4',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate: presentJuly(excuseDays),
    attendanceByDate: {
      '01/07/2026': att('absent', 0, 'rq-norm'),
      '02/07/2026': att('absent', 0, 'rq-med'),
      '03/07/2026': att('absent', 0, 'rq-rej'),
      '04/07/2026': att('absent', 0, 'rq-pend'),
      '05/07/2026': att('absent', 0, 'rq-norm2'),
    },
    requestByDate: {
      '01/07/2026': { id: 'rq-norm', type: 'excuse', status: 'approved', reason: 'ظرف شخصي' },
      '02/07/2026': { id: 'rq-med', type: 'excuse', status: 'approved', reason: 'تقرير طبي' },
      '03/07/2026': { id: 'rq-rej', type: 'excuse', status: 'rejected', reason: 'ظرف شخصي' },
      '04/07/2026': { id: 'rq-pend', type: 'excuse', status: 'pending', reason: 'ظرف شخصي' },
      '05/07/2026': { id: 'rq-norm2', type: 'excuse', status: 'approved', reason: 'ظرف آخر' },
    },
  };
  const result = computeMonthlyAttendance(input);
  const breakdown = buildDailyBreakdown(result, input);
  const byDate = new Map(breakdown.map((e) => [e.date, e]));

  // First 4 absent days fall inside the allowance → autoFree suffix;
  // the 5th (05/07, normal approved excuse) is charged 1 day.
  assert.equal(byDate.get('01/07/2026')!.source, 'طلب غياب مقبول (إعفاء تلقائي من 4 أيام)');
  assert.equal(byDate.get('02/07/2026')!.source, 'طلب غياب مقبول (إعفاء طبي) (إعفاء تلقائي من 4 أيام)');
  assert.equal(byDate.get('03/07/2026')!.source, 'طلب غياب مرفوض (خصم يومين) (إعفاء تلقائي من 4 أيام)');
  assert.equal(byDate.get('04/07/2026')!.source, 'طلب غياب معلق (غياب) (إعفاء تلقائي من 4 أيام)');
  assert.equal(byDate.get('05/07/2026')!.source, 'طلب غياب مقبول (خصم 1 يوم)');

  assert.equal(result.absentDays, 5);
  assert.equal(result.absenceDeductionDays, 1);
});

// ─── Formatting helper ─────────────────────────────────────────

test('formatMinutes legacy formatting', () => {
  assert.equal(formatMinutes(0), '0د');
  assert.equal(formatMinutes(45), '45د');
  assert.equal(formatMinutes(60), '1س');
  assert.equal(formatMinutes(190), '3س 10د');
});
