// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — day-level policy tests
//
//  Golden matrix for the precedence ladder (audit §11), late tiers,
//  single fingerprint, waivers, and the Decision D excuse rules.
//  Expected values are hand-derived from the verified legacy engine
//  unless a Milestone 2 locked decision changes them (R9).
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDay, classifyExcuse, minutesLateVsShift } from '@/lib/attendance/policy';
import { DEFAULT_ATTENDANCE_POLICY } from '@/lib/attendance/rule-config';
import type { AttendanceDayInput, AttendancePolicyConfig, RequestInput } from '@/lib/attendance/types';

const POLICY = DEFAULT_ATTENDANCE_POLICY;

function day(overrides: Partial<AttendanceDayInput> = {}): AttendanceDayInput {
  return {
    employeeId: 'emp-1',
    date: '10/08/2026',
    shiftStart: '09:00',
    biometric: null,
    attendance: null,
    request: null,
    waivers: [],
    ...overrides,
  };
}

function bio(checkIn: string | null, checkOut: string | null) {
  return { checkIn, checkOut };
}

// ─── Late tiers (R1–R4) ───────────────────────────────────────

test('grace boundary: 15 minutes late is free (present, no deduction)', () => {
  const result = evaluateDay(day({ biometric: bio('09:15', '17:00') }), POLICY);
  assert.equal(result.status, 'present');
  assert.equal(result.lateDeductionDays, 0);
  assert.equal(result.minutesLate, 15);
});

test('late tier boundaries: 16/30 → late15 (0.25), 31/60 → late30 (0.5), 61+ → late60 (1)', () => {
  const cases: [string, number, string][] = [
    ['09:16', 0.25, 'late15'],
    ['09:30', 0.25, 'late15'],
    ['09:31', 0.5, 'late30'],
    ['09:60', 0.5, 'late30'],
    ['09:61', 1, 'late60'],
    ['11:00', 1, 'late60'],
  ];
  for (const [checkIn, deduction, tier] of cases) {
    const result = evaluateDay(day({ biometric: bio(checkIn, '17:00') }), POLICY);
    assert.equal(result.status, 'late', `${checkIn} should be late`);
    assert.equal(result.lateTier, tier, `${checkIn} tier`);
    assert.equal(result.lateDeductionDays, deduction, `${checkIn} deduction`);
  }
});

test('lateness values come from policy config, not hardcoded constants', () => {
  const config: AttendancePolicyConfig = {
    ...POLICY,
    graceMinutes: 5,
    late15Threshold: 20,
    late30Threshold: 40,
    late15DeductionDays: 0.1,
    late30DeductionDays: 0.2,
    late60DeductionDays: 0.3,
  };
  // 6 minutes: beyond grace 5, within tier 1 (≤20)
  assert.equal(evaluateDay(day({ biometric: bio('09:06', '17:00') }), config).lateDeductionDays, 0.1);
  // 21 minutes: tier 2
  assert.equal(evaluateDay(day({ biometric: bio('09:21', '17:00') }), config).lateDeductionDays, 0.2);
  // 41 minutes: tier 3
  assert.equal(evaluateDay(day({ biometric: bio('09:41', '17:00') }), config).lateDeductionDays, 0.3);
});

test('no shift start configured → never late, present', () => {
  const result = evaluateDay(day({ shiftStart: null, biometric: bio('13:00', null) }), POLICY);
  assert.equal(result.status, 'present');
  assert.equal(result.lateDeductionDays, 0);
});

test('legacy time tolerance: unpadded hours parse; malformed times yield 0 minutes', () => {
  assert.equal(minutesLateVsShift('9:20', '09:00'), 20);
  assert.equal(minutesLateVsShift('09:20:05', '09:00'), 20);
  assert.equal(minutesLateVsShift('abc', '09:00'), 0);
  assert.equal(minutesLateVsShift('09:20', null), 0);
});

// ─── Single fingerprint (R6) ──────────────────────────────────

test('check-in without check-out → present + 0.5 single fingerprint', () => {
  const result = evaluateDay(day({ biometric: bio('08:55', null) }), POLICY);
  assert.equal(result.status, 'present');
  assert.equal(result.singleFingerprintDeductionDays, 0.5);
});

test('check-out without check-in → present + 0.5 single fingerprint (P4)', () => {
  const result = evaluateDay(day({ biometric: bio(null, '17:30') }), POLICY);
  assert.equal(result.status, 'present');
  assert.equal(result.ruleApplied, 'biometric-checkout-only');
  assert.equal(result.singleFingerprintDeductionDays, 0.5);
});

// ─── Waivers (R12) ────────────────────────────────────────────

test('late waiver zeroes the tier deduction but keeps the late status and minutes', () => {
  const result = evaluateDay(day({ biometric: bio('09:45', '17:00'), waivers: ['late'] }), POLICY);
  assert.equal(result.status, 'late');
  assert.equal(result.minutesLate, 45);
  assert.equal(result.lateDeductionDays, 0);
  assert.equal(result.waived, true);
});

test('absence waiver zeroes the single-fingerprint deduction', () => {
  const result = evaluateDay(day({ biometric: bio('08:55', null), waivers: ['absence'] }), POLICY);
  assert.equal(result.singleFingerprintDeductionDays, 0);
});

test("'all' waiver covers both deduction types", () => {
  const result = evaluateDay(day({ biometric: bio('09:45', null), waivers: ['all'] }), POLICY);
  assert.equal(result.lateDeductionDays, 0);
  assert.equal(result.singleFingerprintDeductionDays, 0);
});

test('waived absent day (no records) → absent with 0 deduction', () => {
  const result = evaluateDay(day({ waivers: ['absence'] }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.absenceDeductionDays, 0);
});

// ─── Precedence ladder ────────────────────────────────────────

test('P1b: attendance status approved → exempt', () => {
  const result = evaluateDay(day({ attendance: { checkIn: null, checkOut: null, status: 'approved', minutesLate: 0, approvedRequestId: null } }), POLICY);
  assert.equal(result.status, 'exempt');
  assert.equal(result.ruleApplied, 'attendance-approved');
});

test('P2: approved request exempts the day even when a late biometric exists', () => {
  const result = evaluateDay(day({
    biometric: bio('10:30', '17:00'),
    request: { id: 'r1', type: 'leave', status: 'approved' },
  }), POLICY);
  assert.equal(result.status, 'exempt');
  assert.equal(result.ruleApplied, 'request-approved');
  assert.equal(result.deductionDays, 0);
});

test('P5: attendance check-in merges stored client minutesLate with recomputed value (max)', () => {
  // recomputed 0 vs stored 35 → 35 (tier late30)
  const stored = evaluateDay(day({
    attendance: { checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 35, approvedRequestId: null },
  }), POLICY);
  assert.equal(stored.status, 'late');
  assert.equal(stored.lateDeductionDays, 0.5);
  // recomputed 40 vs stored 0 → 40
  const recomputed = evaluateDay(day({
    attendance: { checkIn: '09:40', checkOut: '17:00', status: 'present', minutesLate: 0, approvedRequestId: null },
  }), POLICY);
  assert.equal(recomputed.status, 'late');
  assert.equal(recomputed.lateDeductionDays, 0.5);
});

test('P5: attendance absent record → absence deduction from config', () => {
  const result = evaluateDay(day({
    attendance: { checkIn: null, checkOut: null, status: 'absent', minutesLate: 0, approvedRequestId: null },
  }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.absenceDeductionDays, 1);
});

test('P5: attendance absent + rejected request → 2 days (rejected unauthorized absence)', () => {
  const result = evaluateDay(day({
    attendance: { checkIn: null, checkOut: null, status: 'absent', minutesLate: 0, approvedRequestId: null },
    request: { id: 'r2', type: 'excuse', status: 'rejected' },
  }), POLICY);
  assert.equal(result.absenceDeductionDays, 2);
});

test('P5: attendance late status without check-in uses stored minutesLate', () => {
  const result = evaluateDay(day({
    attendance: { checkIn: null, checkOut: null, status: 'late', minutesLate: 70, approvedRequestId: null },
  }), POLICY);
  assert.equal(result.status, 'late');
  assert.equal(result.lateDeductionDays, 1);
});

test('P6: rejected request only → absent + 2 days', () => {
  const result = evaluateDay(day({ request: { id: 'r3', type: 'leave', status: 'rejected' } }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.ruleApplied, 'request-rejected');
  assert.equal(result.absenceDeductionDays, 2);
});

test('P6: pending request only → provisional 1 day, unaccounted + pendingFinalization', () => {
  const result = evaluateDay(day({ request: { id: 'r4', type: 'leave', status: 'pending' } }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.ruleApplied, 'request-pending');
  assert.equal(result.absenceDeductionDays, 1);
  assert.equal(result.unaccounted, true);
  assert.equal(result.pendingFinalization, true);
});

test('P7: no records at all → absent + 1 day, unaccounted', () => {
  const result = evaluateDay(day(), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.ruleApplied, 'no-record');
  assert.equal(result.absenceDeductionDays, 1);
  assert.equal(result.unaccounted, true);
});

// ─── Excuse rules — Decision D / R9 (§30 matrix) ──────────────

function excuseDay(request: AttendanceDayInput['request']) {
  return day({
    attendance: { checkIn: null, checkOut: null, status: 'absent', minutesLate: 0, approvedRequestId: 'rq-1' },
    request,
  });
}

test('excuse approved + normal category → 1 day deduction', () => {
  const result = evaluateDay(excuseDay({ id: 'rq-1', type: 'excuse', status: 'approved', reason: 'ظرف شخصي' }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.ruleApplied, 'excuse-approved');
  assert.equal(result.excuseCategory, 'normal');
  assert.equal(result.absenceDeductionDays, 1);
});

test('excuse approved + medical reason → 0 deduction (exempt category)', () => {
  const result = evaluateDay(excuseDay({ id: 'rq-1', type: 'excuse', status: 'approved', reason: 'تقرير طبي من مستشفى' }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.ruleApplied, 'excuse-approved-exempt');
  assert.equal(result.excuseCategory, 'medical');
  assert.equal(result.absenceDeductionDays, 0);
});

test('excuse approved + accident/emergency reason → 0 deduction', () => {
  const result = evaluateDay(excuseDay({ id: 'rq-1', type: 'excuse', status: 'approved', reason: 'حادث طارئ' }), POLICY);
  assert.equal(result.excuseCategory, 'accident');
  assert.equal(result.absenceDeductionDays, 0);
});

test('excuse rejected → 2 days deduction (any category)', () => {
  for (const reason of ['ظرف شخصي', 'تقرير طبي', 'حادث']) {
    const result = evaluateDay(excuseDay({ id: 'rq-1', type: 'excuse', status: 'rejected', reason }), POLICY);
    assert.equal(result.ruleApplied, 'excuse-rejected', reason);
    assert.equal(result.absenceDeductionDays, 2, reason);
  }
});

test('excuse pending → provisional 1 day, unfinalized (never silently approved/rejected)', () => {
  const result = evaluateDay(excuseDay({ id: 'rq-1', type: 'excuse', status: 'pending', reason: 'ظرف شخصي' }), POLICY);
  assert.equal(result.status, 'absent');
  assert.equal(result.ruleApplied, 'excuse-pending');
  assert.equal(result.absenceDeductionDays, 1);
  assert.equal(result.unaccounted, true);
  assert.equal(result.pendingFinalization, true);
});

test('excuse attendance whose request record is missing (deleted) → provisional 1 day, unaccounted', () => {
  const result = evaluateDay(excuseDay(null), POLICY);
  assert.equal(result.ruleApplied, 'excuse-unknown');
  assert.equal(result.absenceDeductionDays, 1);
  assert.equal(result.unaccounted, true);
  assert.equal(result.pendingFinalization, false);
});

test('P1 excuse evaluation overrides a present biometric on the same day', () => {
  const result = evaluateDay(day({
    biometric: bio('08:50', '17:00'),
    attendance: { checkIn: null, checkOut: null, status: 'absent', minutesLate: 0, approvedRequestId: 'rq-1' },
    request: { id: 'rq-1', type: 'excuse', status: 'approved', reason: 'ظرف شخصي' },
  }), POLICY);
  assert.equal(result.ruleApplied, 'excuse-approved');
  assert.equal(result.absenceDeductionDays, 1);
});

// ─── Excuse classification abstraction (§6) ───────────────────

test('structured category field (when present) wins over the free-text mapping', () => {
  const request: RequestInput = { id: 'rq-1', type: 'excuse', status: 'approved', reason: 'ظرف شخصي عادي', category: 'medical' };
  assert.equal(classifyExcuse(request, POLICY), 'medical');
  const emergency: RequestInput = { id: 'rq-2', type: 'excuse', status: 'approved', reason: 'x', category: 'emergency' };
  assert.equal(classifyExcuse(emergency, POLICY), 'accident');
});

test('unknown structured category values fall back to reason mapping, then normal', () => {
  const unknown: RequestInput = { id: 'rq-1', type: 'excuse', status: 'approved', reason: 'مستشفى', category: 'whatever' };
  assert.equal(classifyExcuse(unknown, POLICY), 'medical');
  const plain: RequestInput = { id: 'rq-2', type: 'excuse', status: 'approved', reason: 'ظرف شخصي', category: 'normal' };
  assert.equal(classifyExcuse(plain, POLICY), 'normal');
});

test('category patterns are configuration-driven (custom patterns override defaults)', () => {
  const config: AttendancePolicyConfig = {
    ...POLICY,
    excuse: {
      ...POLICY.excuse,
      medicalPatterns: ['zzz-custom-medical'],
      accidentPatterns: [],
    },
  };
  const custom: RequestInput = { id: 'r', type: 'excuse', status: 'approved', reason: 'zzz-custom-medical visit' };
  assert.equal(classifyExcuse(custom, config), 'medical');
  // default Arabic medical word no longer matches under the custom config
  const defaultWord: RequestInput = { id: 'r2', type: 'excuse', status: 'approved', reason: 'تقرير طبي' };
  assert.equal(classifyExcuse(defaultWord, config), 'normal');
});
