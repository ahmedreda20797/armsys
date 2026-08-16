// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — monthly aggregation tests
//
//  • Golden month scenario (hand-computed from the verified legacy
//    engine's arithmetic — see the case comments).
//  • Free-absence allowance ladder + slot mechanics.
//  • Decision D excuse outcomes at month scope (R9).
//  • Month boundaries: leap years, year transition, asOf cutoff.
//  • Input-boundary validation (invalid months / dates throw).
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthlyAttendance } from '@/lib/attendance/monthly-engine';
import { DEFAULT_ATTENDANCE_POLICY } from '@/lib/attendance/rule-config';
import type { MonthlyAttendanceInput } from '@/lib/attendance/types';

const POLICY = DEFAULT_ATTENDANCE_POLICY;

function monthInput(overrides: Partial<MonthlyAttendanceInput> = {}): MonthlyAttendanceInput {
  return {
    employeeId: 'emp-1',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    ...overrides,
  };
}

/** Biometric helper. */
function bio(checkIn: string | null, checkOut: string | null) {
  return { checkIn, checkOut };
}

function att(status: string, minutesLate = 0, approvedRequestId: string | null = null) {
  return { checkIn: null, checkOut: null, status, minutesLate, approvedRequestId };
}

// ─── Golden month scenario ─────────────────────────────────────
// July 2026 (31 days), asOf null → all 31 days evaluated.
//   01–05  biometric 08:55/17:00        → present ×5
//   06     biometric 09:20/17:00        → late, 0.25 (late15)
//   07     biometric 09:45/17:00        → late, 0.5 (late30)
//   08     biometric 10:30/17:00        → late, 1.0 (late60)
//   09     biometric 08:55/—            → present + 0.5 single fp
//   10     biometric —/17:30            → present + 0.5 single fp
//   11     attendance check-in 09:00    → present
//   12     attendance late 35 min       → late, 0.5
//   13     attendance absent            → absent 1
//   14     request leave approved       → exempt
//   15–20  biometric 08:58/17:00        → present ×6
//   21–31  nothing                      → absent ×11 (unaccounted)
//
//   present 14, late 4, absent 12, exempt 1, unaccounted 11
//   minutes 20+45+90+35 = 190
//   lateDeduction = 0.25+0.5+1+0.5 (tiers) + 0.5+0.5 (single fp) = 3.25
//   absent entries = 12×1 → first 4 free (13,21,22,23) → 8×1 = 8
//   attendanceDeduction = 11.25
//   compliance = round((14+4+1+0)/31×100) = 61
//   effectiveWorkingDays = 14+4+1+4+0 = 23
test('golden month: mixed biometric/attendance/request month reproduces legacy totals', () => {
  const biometricByDate: Record<string, ReturnType<typeof bio>> = {};
  for (let d = 1; d <= 5; d++) biometricByDate[`0${d}/07/2026`] = bio('08:55', '17:00');
  biometricByDate['06/07/2026'] = bio('09:20', '17:00');
  biometricByDate['07/07/2026'] = bio('09:45', '17:00');
  biometricByDate['08/07/2026'] = bio('10:30', '17:00');
  biometricByDate['09/07/2026'] = bio('08:55', null);
  biometricByDate['10/07/2026'] = bio(null, '17:30');
  for (let d = 15; d <= 20; d++) biometricByDate[`${d}/07/2026`] = bio('08:58', '17:00');

  const result = computeMonthlyAttendance(monthInput({
    biometricByDate,
    attendanceByDate: {
      '11/07/2026': { checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 0, approvedRequestId: null },
      '12/07/2026': { checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 35, approvedRequestId: null },
      '13/07/2026': att('absent'),
    },
    requestByDate: {
      '14/07/2026': { id: 'r1', type: 'leave', status: 'approved' },
    },
  }));

  assert.equal(result.workDays, 31);
  assert.equal(result.presentDays, 14);
  assert.equal(result.lateDays, 4);
  assert.equal(result.absentDays, 12);
  assert.equal(result.exemptDays, 1);
  assert.equal(result.unaccountedDays, 11);
  assert.equal(result.totalMinutesLate, 190);
  assert.equal(result.lateDeductionDays, 3.25);
  assert.equal(result.absenceDeductionDays, 8);
  assert.equal(result.attendanceDeductionDays, 11.25);
  assert.equal(result.autoExemptDays, 4);
  assert.equal(result.bonusDays, 0);
  assert.equal(result.effectiveWorkingDays, 23);
  assert.equal(result.compliance, 61);

  // autoFree lands on the FIRST absent days by date: 13, 21, 22, 23
  const autoFreeDates = result.daily.filter((d) => d.autoFree).map((d) => d.date);
  assert.deepEqual(autoFreeDates, ['13/07/2026', '21/07/2026', '22/07/2026', '23/07/2026']);
  // 24–31 stay deductible
  assert.equal(result.daily.find((d) => d.date === '24/07/2026')?.absenceDeductionDays, 1);
  assert.equal(result.daily.find((d) => d.date === '31/07/2026')?.absenceDeductionDays, 1);
});

// ─── Free-absence allowance ladder (R7) ────────────────────────

function absencesOn(dates: string[]): Record<string, ReturnType<typeof att>> {
  const map: Record<string, ReturnType<typeof att>> = {};
  for (const date of dates) map[date] = att('absent');
  return map;
}

/**
 * Fill every day of the month with a present biometric pair EXCEPT the
 * overlay dates — isolating the days under test (empty days would
 * otherwise be P7 no-record absences, exactly like the legacy engine).
 */
function presentMonth(exclude: string[] = []): Record<string, ReturnType<typeof bio>> {
  const [yy, mm] = ['2026', '07'];
  const total = new Date(Date.UTC(2026, 7, 0)).getUTCDate();
  const map: Record<string, ReturnType<typeof bio>> = {};
  for (let d = 1; d <= total; d++) {
    const key = `${String(d).padStart(2, '0')}/${mm}/${yy}`;
    if (!exclude.includes(key)) map[key] = bio('08:55', '17:00');
  }
  return map;
}

test('allowance ladder: 0/4/5/6 absences → 0/0/1/2 deduction days and bonus 4/0/0/0', () => {
  const expectations: [string[], number, number, number][] = [
    [[], 0, 0, 4],
    [['01/07/2026', '02/07/2026', '03/07/2026', '04/07/2026'], 0, 4, 0],
    [['01/07/2026', '02/07/2026', '03/07/2026', '04/07/2026', '05/07/2026'], 1, 4, 0],
    [['01/07/2026', '02/07/2026', '03/07/2026', '04/07/2026', '05/07/2026', '06/07/2026'], 2, 4, 0],
  ];
  for (const [dates, deduction, autoExempt, bonus] of expectations) {
    const result = computeMonthlyAttendance(monthInput({
      biometricByDate: presentMonth(dates),
      attendanceByDate: absencesOn(dates),
    }));
    assert.equal(result.absenceDeductionDays, deduction, JSON.stringify(dates));
    assert.equal(result.autoExemptDays, autoExempt, JSON.stringify(dates));
    assert.equal(result.bonusDays, bonus, JSON.stringify(dates));
  }
});

test('allowance comes from config (freeAbsenceAllowance = 2 → only first 2 free)', () => {
  const dates = ['01/07/2026', '02/07/2026', '03/07/2026', '04/07/2026'];
  const result = computeMonthlyAttendance(monthInput({
    policy: { ...POLICY, freeAbsenceAllowance: 2 },
    biometricByDate: presentMonth(dates),
    attendanceByDate: absencesOn(dates),
  }));
  assert.equal(result.absenceDeductionDays, 2);
  assert.equal(result.autoExemptDays, 2);
  assert.equal(result.bonusDays, 0);
});

test('waived 0-deduction absent days consume allowance slots (legacy parity)', () => {
  // 5 absent days; waiving the LATEST one leaves entries [1,1,1,1,0]
  // → first 4 free, remainder is the waived 0 → total 0.
  const dates = ['21/07/2026', '22/07/2026', '23/07/2026', '24/07/2026', '25/07/2026'];
  const result = computeMonthlyAttendance(monthInput({
    biometricByDate: presentMonth(dates),
    attendanceByDate: absencesOn(dates),
    waiversByDate: { '25/07/2026': ['absence'] },
  }));
  assert.equal(result.absentDays, 5);
  assert.equal(result.absenceDeductionDays, 0);
});

test('compliance counts bonus days and caps at 100', () => {
  // 30-day month (June 2026), fully present:
  // (30 + 0 + 0 + 4 bonus) / 30 × 100 = 113 → capped at 100
  const biometricByDate: Record<string, ReturnType<typeof bio>> = {};
  for (let d = 1; d <= 30; d++) {
    const key = `${String(d).padStart(2, '0')}/06/2026`;
    biometricByDate[key] = bio('08:55', '17:00');
  }
  const result = computeMonthlyAttendance(monthInput({ month: '2026-06', biometricByDate }));
  assert.equal(result.bonusDays, 4);
  assert.equal(result.compliance, 100);
});

test('totalMinutesLate accumulates only late days (grace minutes excluded)', () => {
  const result = computeMonthlyAttendance(monthInput({
    biometricByDate: {
      '01/07/2026': bio('09:10', '17:00'),  // within grace → present, minutes not counted
      '02/07/2026': bio('09:20', '17:00'),  // late 20
    },
  }));
  assert.equal(result.presentDays, 1);
  assert.equal(result.lateDays, 1);
  assert.equal(result.totalMinutesLate, 20);
});

// ─── Decision D excuse outcomes at month scope (R9) ───────────

test('R9: approved medical excuse beyond 4 plain absences avoids the 5th-day deduction', () => {
  const plain = ['21/07/2026', '22/07/2026', '23/07/2026', '24/07/2026'];
  const medical = computeMonthlyAttendance(monthInput({
    biometricByDate: presentMonth([...plain, '31/07/2026']),
    attendanceByDate: { ...absencesOn(plain), '31/07/2026': att('absent', 0, 'rq-med') },
    requestByDate: { '31/07/2026': { id: 'rq-med', type: 'excuse', status: 'approved', reason: 'تقرير طبي' } },
  }));
  // entries [1,1,1,1,0] → first 4 free → remainder 0
  assert.equal(medical.absenceDeductionDays, 0);
  assert.equal(medical.absentDays, 5);

  const normal = computeMonthlyAttendance(monthInput({
    biometricByDate: presentMonth([...plain, '31/07/2026']),
    attendanceByDate: { ...absencesOn(plain), '31/07/2026': att('absent', 0, 'rq-norm') },
    requestByDate: { '31/07/2026': { id: 'rq-norm', type: 'excuse', status: 'approved', reason: 'ظرف شخصي' } },
  }));
  // entries [1,1,1,1,1] → first 4 free → remainder 1
  assert.equal(normal.absenceDeductionDays, 1);
});

test('R9: rejected excuse beyond allowance deducts 2 days', () => {
  const plain = ['21/07/2026', '22/07/2026', '23/07/2026', '24/07/2026'];
  const result = computeMonthlyAttendance(monthInput({
    biometricByDate: presentMonth([...plain, '31/07/2026']),
    attendanceByDate: { ...absencesOn(plain), '31/07/2026': att('absent', 0, 'rq-rej') },
    requestByDate: { '31/07/2026': { id: 'rq-rej', type: 'excuse', status: 'rejected', reason: 'ظرف شخصي' } },
  }));
  // entries [1,1,1,1,2] → first 4 free → remainder 2
  assert.equal(result.absenceDeductionDays, 2);
});

test('pending excuse stays provisional: absent + unaccounted, participates in allowance like legacy', () => {
  const result = computeMonthlyAttendance(monthInput({
    biometricByDate: presentMonth(['01/07/2026']),
    attendanceByDate: { '01/07/2026': att('absent', 0, 'rq-pend') },
    requestByDate: { '01/07/2026': { id: 'rq-pend', type: 'excuse', status: 'pending', reason: 'ظرف شخصي' } },
  }));
  assert.equal(result.absentDays, 1);
  assert.equal(result.unaccountedDays, 1);
  assert.equal(result.absenceDeductionDays, 0); // covered by allowance
  assert.equal(result.autoExemptDays, 1);
  assert.equal(result.daily[0].pendingFinalization, true);
});

// ─── Month boundaries (§21) ────────────────────────────────────

test('leap year: February 2024 evaluates 29 days, February 2023 evaluates 28', () => {
  assert.equal(computeMonthlyAttendance(monthInput({ month: '2024-02' })).workDays, 29);
  assert.equal(computeMonthlyAttendance(monthInput({ month: '2023-02' })).workDays, 28);
  assert.equal(
    computeMonthlyAttendance(monthInput({ month: '2024-02' })).daily.at(-1)?.date,
    '29/02/2024',
  );
});

test('year transition: December 2025 spans 31/12/2025 and never leaks into January', () => {
  const result = computeMonthlyAttendance(monthInput({ month: '2025-12' }));
  assert.equal(result.workDays, 31);
  assert.equal(result.daily[0].date, '01/12/2025');
  assert.equal(result.daily.at(-1)?.date, '31/12/2025');
  assert.ok(result.daily.every((d) => d.date.endsWith('/12/2025')));
});

test('asOf cutoff: current month evaluates only days up to asOf; other months evaluate fully', () => {
  const cut = computeMonthlyAttendance(monthInput({
    month: '2026-08',
    asOf: new Date(2026, 7, 16, 12, 0, 0),
  }));
  assert.equal(cut.workDays, 16);

  const full = computeMonthlyAttendance(monthInput({
    month: '2026-07',
    asOf: new Date(2026, 7, 16, 12, 0, 0),
  }));
  assert.equal(full.workDays, 31);
});

test('month start: asOf on day 1 evaluates exactly one day', () => {
  const result = computeMonthlyAttendance(monthInput({
    month: '2026-08',
    asOf: new Date(2026, 7, 1, 23, 59, 59),
  }));
  assert.equal(result.workDays, 1);
  assert.equal(result.daily[0].date, '01/08/2026');
});

// ─── Input-boundary validation (§21/§22) ───────────────────────

test('invalid month keys throw (13th month, unpadded, garbage)', () => {
  for (const month of ['2026-13', '2026-1', 'garbage', '']) {
    assert.throws(() => computeMonthlyAttendance(monthInput({ month })), TypeError);
  }
});

test('malformed date keys in input maps throw instead of being silently accepted', () => {
  assert.throws(() => computeMonthlyAttendance(monthInput({
    biometricByDate: { '2026-08-01': bio('09:00', '17:00') },
  })), TypeError);
  assert.throws(() => computeMonthlyAttendance(monthInput({
    attendanceByDate: { '31/02/2026': att('absent') },
  })), TypeError);
  assert.throws(() => computeMonthlyAttendance(monthInput({
    attendanceByDate: { '5/8/2026': att('absent') },
  })), TypeError);
});
