// ══════════════════════════════════════════════════════════════
//  Persisted Monthly Attendance Results — Milestone 3 tests
//
//  Covers (spec §28/§29), against the PURE primitives the routes
//  delegate to (project convention: no Firebase mocking):
//    • Persistence + numerical parity — the persisted record is the
//      DIRECT serialized output of computeMonthlyAttendance() for the
//      Milestone 2 golden fixtures (expectations derived from the
//      engine output, with golden anchors tying back to M2).
//    • Adapter parity — buildMonthlyInputIndex reproduces the report
//      adapters' raw-record mapping (latest request wins, malformed
//      dates dropped, waiver default 'all').
//    • Idempotency — deterministic identity, duplicate-free write
//      planning, deterministic regeneration content.
//    • Policy traceability — snapshot matches the resolved policy,
//      survives later policy mutation, fingerprint is deterministic.
//    • Multi-employee isolation.
//    • Audit entry structure for generation/regeneration.
//
//  Run: npx tsx --test src/lib/attendance/__tests__/monthly-results.test.ts
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthlyAttendance } from '@/lib/attendance/monthly-engine';
import { DEFAULT_ATTENDANCE_POLICY, resolveAttendancePolicy } from '@/lib/attendance/rule-config';
import type { MonthlyAttendanceResult } from '@/lib/attendance/types';
import {
  ATTENDANCE_ENGINE_VERSION,
  ATTENDANCE_RESULT_SCHEMA_VERSION,
  attendanceResultId,
  buildGenerationAuditEntries,
  buildMonthlyInputIndex,
  buildPolicyFingerprint,
  buildResultAuditMetadata,
  buildStoredAttendanceResult,
  planResultWrites,
} from '@/lib/attendance/monthly-results';
import type {
  AttendanceResultActor,
  EmployeeResultSnapshot,
  MonthlyRawInputs,
  StoredAttendanceResult,
} from '@/lib/attendance/monthly-results';

const POLICY = DEFAULT_ATTENDANCE_POLICY;
const NOW = new Date('2026-08-16T10:00:00.000Z');
const LATER = new Date('2026-08-20T09:30:00.000Z');
const ACTOR: AttendanceResultActor = { id: 'mgr1', name: 'مدير الحضور' };
const EMPLOYEE_SNAPSHOT: EmployeeResultSnapshot = {
  employeeId: 'emp-1',
  employeeName: 'أحمد',
  department: 'مبيعات',
  position: 'موظف مبيعات',
};

function store(result: MonthlyAttendanceResult, overrides: Partial<Parameters<typeof buildStoredAttendanceResult>[0]> = {}): StoredAttendanceResult {
  return buildStoredAttendanceResult({
    result,
    employeeSnapshot: EMPLOYEE_SNAPSHOT,
    policy: POLICY,
    actor: ACTOR,
    now: NOW,
    ...overrides,
  });
}

// ─── Golden fixture (Milestone 2 monthly-engine golden month) ──
// July 2026 mixed biometric/attendance/request month; the canonical
// expectations are the engine's own output (§29 — derived, not
// duplicated), anchored to the hand-computed M2 totals.

function goldenRawInputs(): MonthlyRawInputs {
  const biometrics: MonthlyRawInputs['biometrics'] = [];
  const bio = (date: string, checkIn: string | null, checkOut: string | null) =>
    biometrics.push({ employeeId: 'emp-1', date, checkIn, checkOut });

  for (let d = 1; d <= 5; d++) bio(`0${d}/07/2026`, '08:55', '17:00');
  bio('06/07/2026', '09:20', '17:00');
  bio('07/07/2026', '09:45', '17:00');
  bio('08/07/2026', '10:30', '17:00');
  bio('09/07/2026', '08:55', null);
  bio('10/07/2026', null, '17:30');
  for (let d = 15; d <= 20; d++) bio(`${d}/07/2026`, '08:58', '17:00');

  return {
    employees: [{ id: 'emp-1', name: 'أحمد', department: 'مبيعات', position: 'موظف مبيعات', shiftStart: '09:00' }],
    biometrics,
    attendanceRecords: [
      { employeeId: 'emp-1', date: '11/07/2026', checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 0, approvedRequestId: null },
      { employeeId: 'emp-1', date: '12/07/2026', checkIn: '09:00', checkOut: '17:00', status: 'present', minutesLate: 35, approvedRequestId: null },
      { employeeId: 'emp-1', date: '13/07/2026', checkIn: null, checkOut: null, status: 'absent', minutesLate: 0, approvedRequestId: null },
    ],
    requests: [
      { id: 'r1', employeeId: 'emp-1', date: '14/07/2026', type: 'leave', status: 'approved', reason: null, createdAt: '2026-07-10T08:00:00.000Z' },
    ],
    waivers: [],
  };
}

function computeFromRaw(raw: MonthlyRawInputs, employeeId = 'emp-1', asOf: Date | null = null): MonthlyAttendanceResult {
  const input = buildMonthlyInputIndex(raw).get(employeeId)!;
  return computeMonthlyAttendance({
    employeeId,
    month: '2026-07',
    shiftStart: input.shiftStart,
    asOf,
    policy: POLICY,
    biometricByDate: input.biometricByDate,
    attendanceByDate: input.attendanceByDate,
    requestByDate: input.requestByDate,
    waiversByDate: input.waiversByDate,
  });
}

// ═══════════════════════════════════════════════════════════════
//  Persistence + numerical parity (golden fixtures)
// ═══════════════════════════════════════════════════════════════

test('golden parity: persisted record equals the canonical engine output field-for-field', () => {
  const engineResult = computeFromRaw(goldenRawInputs());
  const stored = store(engineResult);

  // Every engine field is preserved verbatim — derived from the
  // engine output itself (§29), never re-asserted by hand.
  for (const key of Object.keys(engineResult) as (keyof MonthlyAttendanceResult)[]) {
    assert.deepEqual(stored[key], engineResult[key], `field ${String(key)} diverged`);
  }
  assert.deepEqual(stored.daily, engineResult.daily);
  assert.equal(stored.daily.length, 31);

  // Golden anchors tying this fixture to the Milestone 2 golden month.
  assert.equal(engineResult.attendanceDeductionDays, 11.25);
  assert.equal(stored.attendanceDeductionDays, 11.25);
  assert.equal(stored.compliance, 61);
  assert.equal(stored.lateDeductionDays, 3.25);
  assert.equal(stored.absenceDeductionDays, 8);
});

test('persistence metadata: canonical id, month key, employee snapshot, policy snapshot, engineVersion', () => {
  const stored = store(computeFromRaw(goldenRawInputs()));

  assert.equal(stored.id, '2026-07_emp-1');
  assert.equal(stored.employeeId, 'emp-1');
  assert.equal(stored.month, '2026-07');
  assert.equal(stored.schemaVersion, ATTENDANCE_RESULT_SCHEMA_VERSION);
  assert.equal(stored.engineVersion, ATTENDANCE_ENGINE_VERSION);
  assert.equal(stored.engineVersion, 'attendance-v1');
  assert.deepEqual(stored.employeeSnapshot, EMPLOYEE_SNAPSHOT);
  assert.deepEqual(stored.policySnapshot, POLICY);
  assert.equal(stored.generatedAt, NOW.toISOString());
  assert.deepEqual(stored.generatedBy, ACTOR);
  assert.match(stored.policyFingerprint, /^[0-9a-f]{8}$/);
});

test('identity: deterministic composite id — employee is canonical, never name/email', () => {
  assert.equal(attendanceResultId('2026-08', 'ck8x1'), attendanceResultId('2026-08', 'ck8x1'));
  assert.notEqual(attendanceResultId('2026-08', 'ck8x1'), attendanceResultId('2026-08', 'ck8x2'));
  assert.notEqual(attendanceResultId('2026-08', 'ck8x1'), attendanceResultId('2026-09', 'ck8x1'));
  assert.equal(attendanceResultId('2026-08', 'ck8x1'), '2026-08_ck8x1');
});

// ═══════════════════════════════════════════════════════════════
//  Adapter parity (raw collections → engine inputs)
// ═══════════════════════════════════════════════════════════════

test('adapter: latest request per date wins by createdAt (report-adapter semantics)', () => {
  const raw = goldenRawInputs();
  raw.requests = [
    { id: 'r-old', employeeId: 'emp-1', date: '14/07/2026', type: 'excuse', status: 'rejected', reason: 'قديم', createdAt: '2026-07-09T08:00:00.000Z' },
    { id: 'r-new', employeeId: 'emp-1', date: '14/07/2026', type: 'leave', status: 'approved', reason: null, createdAt: '2026-07-10T08:00:00.000Z' },
  ];
  const input = buildMonthlyInputIndex(raw).get('emp-1')!;
  assert.equal(input.requestByDate?.['14/07/2026'].id, 'r-new');

  // The engine outcome follows the winning request (exempt day).
  const result = computeFromRaw(raw);
  assert.equal(result.exemptDays, 1);
});

test('adapter: malformed legacy dates are dropped and never reach the engine', () => {
  const raw = goldenRawInputs();
  raw.biometrics.push({ employeeId: 'emp-1', date: '2026-07-01', checkIn: '09:00', checkOut: '17:00' });
  raw.attendanceRecords.push({ employeeId: 'emp-1', date: '5/8/2026', checkIn: null, checkOut: null, status: 'absent', minutesLate: 0, approvedRequestId: null });
  raw.waivers.push({ employeeId: 'emp-1', date: '31/02/2026', deductionType: 'all' });

  const input = buildMonthlyInputIndex(raw).get('emp-1')!;
  assert.equal(input.biometricByDate?.['2026-07-01'], undefined);
  assert.equal(input.attendanceByDate?.['5/8/2026'], undefined);
  assert.equal(input.waiversByDate?.['31/02/2026'], undefined);

  // The engine itself would THROW on a malformed key — the adapter's
  // pre-filter is what keeps generation safe on legacy data.
  assert.doesNotThrow(() => computeFromRaw(raw));
});

test('adapter: waiver without deductionType defaults to all; missing employee fields normalized', () => {
  const raw = goldenRawInputs();
  raw.waivers.push({ employeeId: 'emp-1', date: '13/07/2026', deductionType: null as unknown as string });
  const input = buildMonthlyInputIndex(raw).get('emp-1')!;
  assert.deepEqual(input.waiversByDate?.['13/07/2026'], ['all']);
});

test('adapter: records for unknown employees are ignored (reports loop over employees only)', () => {
  const raw = goldenRawInputs();
  raw.biometrics.push({ employeeId: 'ghost', date: '01/07/2026', checkIn: '08:00', checkOut: '17:00' });
  const index = buildMonthlyInputIndex(raw);
  assert.equal(index.get('ghost'), undefined);
  assert.equal(index.size, 1);
});

// ═══════════════════════════════════════════════════════════════
//  Idempotency
// ═══════════════════════════════════════════════════════════════

test('idempotency: identical inputs produce identical persisted records', () => {
  const result = computeFromRaw(goldenRawInputs());
  assert.deepEqual(store(result), store(result));
});

test('idempotency: regenerating the same employee/month plans ONE replacement, never a duplicate', () => {
  const first = store(computeFromRaw(goldenRawInputs()));

  // Later regeneration with changed inputs (a new biometric pair on a
  // previously empty day) and a later timestamp.
  const raw = goldenRawInputs();
  raw.biometrics.push({ employeeId: 'emp-1', date: '25/07/2026', checkIn: '08:59', checkOut: '17:00' });
  const second = store(computeFromRaw(raw), { now: LATER });

  const plan = planResultWrites([first], [second]);
  assert.equal(plan.created.length, 0);
  assert.equal(plan.updated.length, 1);
  assert.equal(plan.updated[0].next.id, first.id);
  assert.equal(plan.updated[0].previous, first);

  // Deterministic replace: same id, changed content, new stamp.
  assert.equal(second.id, first.id);
  assert.equal(second.generatedAt, LATER.toISOString());
  assert.notEqual(second.presentDays, first.presentDays);
});

test('idempotency: write plan counts created vs updated across a mixed month', () => {
  const raw = goldenRawInputs();
  raw.employees.push({ id: 'emp-2', name: 'سارة', department: 'تقنية', position: null, shiftStart: '09:00' });
  const firstEmp1 = store(computeFromRaw(raw));

  const nextEmp1 = store(computeFromRaw(goldenRawInputs()), { now: LATER });
  const emp2Result = computeMonthlyAttendance({
    employeeId: 'emp-2', month: '2026-07', shiftStart: '09:00', asOf: null, policy: POLICY,
    biometricByDate: { '01/07/2026': { checkIn: '08:55', checkOut: '17:00' } },
  });
  const newEmp2 = store(emp2Result, {
    employeeSnapshot: { employeeId: 'emp-2', employeeName: 'سارة', department: 'تقنية', position: null },
    now: LATER,
  });

  const plan = planResultWrites([firstEmp1], [nextEmp1, newEmp2]);
  assert.deepEqual(plan.created.map((r) => r.employeeId), ['emp-2']);
  assert.deepEqual(plan.updated.map((u) => u.next.employeeId), ['emp-1']);
});

// ═══════════════════════════════════════════════════════════════
//  Policy traceability (§6/§17)
// ═══════════════════════════════════════════════════════════════

test('policy snapshot: stored snapshot matches the RESOLVED policy (deductionRules overlay included)', () => {
  const resolved = resolveAttendancePolicy([
    { key: 'late15', amount: 0.5 },
    { key: 'absence', amount: 2 },
  ]);
  assert.equal(resolved.late15DeductionDays, 0.5);
  assert.equal(resolved.absenceDeductionDays, 2);

  const stored = store(computeFromRaw(goldenRawInputs()), { policy: resolved });
  assert.deepEqual(stored.policySnapshot, resolved);
});

test('policy snapshot: later changes to the policy object never mutate a stored result', () => {
  const policy = { ...DEFAULT_ATTENDANCE_POLICY, excuse: { ...DEFAULT_ATTENDANCE_POLICY.excuse } };
  const stored = store(computeFromRaw(goldenRawInputs()), { policy });

  // Mutate the CURRENT configuration afterwards...
  policy.freeAbsenceAllowance = 99;
  policy.excuse.rejectedDeductionDays = 7;
  policy.weekendPolicy.mode = 'all-days-count';

  // ...the stored historical snapshot is untouched.
  assert.equal(stored.policySnapshot.freeAbsenceAllowance, 4);
  assert.equal(stored.policySnapshot.excuse.rejectedDeductionDays, 2);
});

test('policy fingerprint: deterministic, distinguishes configurations', () => {
  const p1 = DEFAULT_ATTENDANCE_POLICY;
  const p2 = { ...DEFAULT_ATTENDANCE_POLICY, late15DeductionDays: 0.5 };
  const p3 = { ...DEFAULT_ATTENDANCE_POLICY, excuse: { ...DEFAULT_ATTENDANCE_POLICY.excuse, pendingDeductionDays: 2 } };

  assert.equal(buildPolicyFingerprint(p1), buildPolicyFingerprint({ ...p1 }));
  assert.equal(buildPolicyFingerprint(p1), buildPolicyFingerprint(p1));
  assert.notEqual(buildPolicyFingerprint(p1), buildPolicyFingerprint(p2));
  assert.notEqual(buildPolicyFingerprint(p1), buildPolicyFingerprint(p3));

  // Key order does not matter (stable serialization).
  const reordered = { ...p3, graceMinutes: p3.graceMinutes };
  assert.equal(buildPolicyFingerprint(p3), buildPolicyFingerprint(reordered));
});

// ═══════════════════════════════════════════════════════════════
//  Multi-employee isolation
// ═══════════════════════════════════════════════════════════════

test('multi-employee: same month produces two isolated results keyed by canonical employeeId', () => {
  const raw = goldenRawInputs();
  raw.employees.push({ id: 'emp-2', name: 'سارة', department: 'تقنية', position: 'مهندس', shiftStart: '09:00' });
  for (let d = 1; d <= 31; d++) {
    raw.biometrics.push({ employeeId: 'emp-2', date: `${String(d).padStart(2, '0')}/07/2026`, checkIn: '08:55', checkOut: '17:00' });
  }

  const index = buildMonthlyInputIndex(raw);
  const result1 = computeFromRaw(raw, 'emp-1');
  const input2 = index.get('emp-2')!;
  const result2 = computeMonthlyAttendance({
    employeeId: 'emp-2', month: '2026-07', shiftStart: input2.shiftStart, asOf: null, policy: POLICY,
    biometricByDate: input2.biometricByDate,
  });

  const stored1 = store(result1);
  const stored2 = store(result2, {
    employeeSnapshot: { employeeId: 'emp-2', employeeName: 'سارة', department: 'تقنية', position: 'مهندس' },
  });

  assert.equal(index.size, 2);
  assert.notEqual(stored1.id, stored2.id);
  // emp-2: perfect month → compliance capped at 100 with 4 bonus days.
  assert.equal(stored2.compliance, 100);
  assert.equal(stored2.bonusDays, 4);
  assert.equal(stored2.absentDays, 0);
  // emp-1 result is unaffected by emp-2's data (golden anchors).
  assert.equal(stored1.compliance, 61);
  assert.equal(stored1.attendanceDeductionDays, 11.25);
  assert.deepEqual(stored1.employeeSnapshot, EMPLOYEE_SNAPSHOT);
});

// ═══════════════════════════════════════════════════════════════
//  Audit (§18)
// ═══════════════════════════════════════════════════════════════

test('audit: generation run produces a month anchor + per-employee create/replace entries', () => {
  const first = store(computeFromRaw(goldenRawInputs()));

  const raw = goldenRawInputs();
  raw.employees.push({ id: 'emp-2', name: 'سارة', department: 'تقنية', position: null, shiftStart: '09:00' });
  const emp1Next = store(computeFromRaw(goldenRawInputs()), { now: LATER });
  const emp2New = store(
    computeMonthlyAttendance({ employeeId: 'emp-2', month: '2026-07', shiftStart: '09:00', asOf: null, policy: POLICY }),
    { employeeSnapshot: { employeeId: 'emp-2', employeeName: 'سارة', department: 'تقنية', position: null }, now: LATER },
  );

  const plan = planResultWrites([first], [emp1Next, emp2New]);
  const entries = buildGenerationAuditEntries({
    monthKey: '2026-07', actor: ACTOR, plan, failed: 0,
    policyFingerprint: emp1Next.policyFingerprint, generatedAt: LATER.toISOString(),
  });

  // 1 month anchor + 1 regenerate + 1 generate.
  assert.equal(entries.length, 3);

  const [monthEntry, createdEntry, updatedEntry] = entries;
  assert.equal(monthEntry.entityType, 'attendanceMonth');
  assert.equal(monthEntry.action, 'generate_month');
  assert.equal(monthEntry.entityId, '2026-07');
  assert.equal(monthEntry.monthKey, '2026-07');
  assert.equal(monthEntry.collection, 'attendanceAuditLog');
  assert.equal(monthEntry.actorId, ACTOR.id);
  assert.equal(monthEntry.actorName, ACTOR.name);
  assert.deepEqual(monthEntry.after, {
    month: '2026-07', employeesProcessed: 2, resultsCreated: 1, resultsUpdated: 1, failed: 0,
    engineVersion: ATTENDANCE_ENGINE_VERSION,
    policyFingerprint: emp1Next.policyFingerprint,
    generatedAt: LATER.toISOString(),
  });

  assert.equal(createdEntry.action, 'generate');
  assert.equal(createdEntry.entityType, 'attendanceResult');
  assert.equal(createdEntry.entityId, emp2New.id);
  assert.equal(createdEntry.before, null);
  assert.equal((createdEntry.after as Record<string, unknown>).employeeId, 'emp-2');

  assert.equal(updatedEntry.action, 'regenerate');
  assert.equal(updatedEntry.entityId, first.id);
  assert.notEqual(updatedEntry.before, null);
  assert.equal((updatedEntry.before as Record<string, unknown>).generatedAt, NOW.toISOString());
  assert.equal((updatedEntry.after as Record<string, unknown>).generatedAt, LATER.toISOString());
  // engineVersion + policy reference ride on every result entry (§18).
  assert.equal((updatedEntry.after as Record<string, unknown>).engineVersion, ATTENDANCE_ENGINE_VERSION);
  assert.equal((updatedEntry.after as Record<string, unknown>).policyFingerprint, first.policyFingerprint);
});

test('audit metadata: compact summary carries the deduction/compliance numbers, never the daily array', () => {
  const stored = store(computeFromRaw(goldenRawInputs()));
  const meta = buildResultAuditMetadata(stored);
  assert.equal(meta.attendanceDeductionDays, 11.25);
  assert.equal(meta.compliance, 61);
  assert.equal(meta.engineVersion, ATTENDANCE_ENGINE_VERSION);
  assert.equal('daily' in meta, false);
});
