// ══════════════════════════════════════════════════════════════
//  Attendance KPI — Milestone 6 tests
//
//  Covers (spec §23/§24), against the PURE builder + the loader-
//  injected orchestrators (project convention: no Firebase mocking):
//    • KPI score — compliance maps 1:1 to the KPI (100/95/0 and a
//      sweep), values stay within 0–100, source value never altered.
//    • Stored-result source — the KPI is built from
//      StoredAttendanceResult data only; the orchestrator touches
//      ONLY the attendanceResults loader; the module statically
//      imports no engine / biometric / raw-attendance path.
//    • Not generated — a missing stored result is an explicit null
//      (caller surfaces not_generated); never a fabricated 100,
//      never another employee's / month's value.
//    • Time scope — every KPI carries its own selected_month scope;
//      a month never inherits another month's KPI; historical
//      results are never mutated by building a KPI.
//    • PerformanceFactor — factorId/factorName/score/maxScore/
//      normalized/breakdown, engineVersion + policyFingerprint
//      preserved.
//    • Domain separation — the output contains ONLY
//      attendance-domain values (no quality/sales/HR inputs exist).
//    • Engine-derived parity anchors (perfect month → 100, absence
//      month → engine compliance) tying the KPI to the real
//      computeMonthlyAttendance output, not just synthetic records.
//
//  Run: npx tsx --test src/lib/attendance/__tests__/kpi.test.ts
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { computeMonthlyAttendance } from '@/lib/attendance/monthly-engine';
import { DEFAULT_ATTENDANCE_POLICY } from '@/lib/attendance/rule-config';
import type { MonthlyAttendanceResult } from '@/lib/attendance/types';
import { buildStoredAttendanceResult } from '@/lib/attendance/monthly-results';
import type { StoredAttendanceResult } from '@/lib/attendance/monthly-results';
import {
  ATTENDANCE_KPI_DEFAULT_WEIGHT,
  ATTENDANCE_KPI_FACTOR_ID,
  ATTENDANCE_KPI_FACTOR_NAME,
  ATTENDANCE_KPI_MAX_SCORE,
  buildAttendanceKpi,
  buildAttendanceKpiBreakdown,
  getAttendanceKpi,
  getAttendanceKpisForMonth,
} from '@/lib/attendance/kpi';
import type { AttendanceKpiDataLoaders } from '@/lib/attendance/kpi';

const POLICY = DEFAULT_ATTENDANCE_POLICY;
const NOW = new Date('2026-08-16T10:00:00.000Z');
const ACTOR = { id: 'mgr1', name: 'مدير الحضور' };

/** Synthetic stored result with a chosen compliance (KPI layer treats it as opaque stored data). */
function storedWith(
  compliance: number,
  overrides: Partial<MonthlyAttendanceResult> = {},
  employeeId = 'emp-1',
  month = '2026-08',
): StoredAttendanceResult {
  const base: MonthlyAttendanceResult = {
    employeeId,
    month,
    workDays: 31,
    presentDays: 24,
    lateDays: 3,
    absentDays: 4,
    exemptDays: 0,
    unaccountedDays: 0,
    totalMinutesLate: 130,
    lateDeductionDays: 1.25,
    absenceDeductionDays: 0,
    attendanceDeductionDays: 1.25,
    autoExemptDays: 4,
    bonusDays: 0,
    effectiveWorkingDays: 31,
    compliance,
    daily: [],
    ...overrides,
  };
  return buildStoredAttendanceResult({
    result: base,
    employeeSnapshot: { employeeId, employeeName: 'أحمد', department: 'مبيعات', position: null },
    policy: POLICY,
    actor: ACTOR,
    now: NOW,
  });
}

/** Loaders over an in-memory map of stored results, recording every call. */
function loadersOver(records: StoredAttendanceResult[]) {
  const calls: string[] = [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const byMonth = new Map<string, StoredAttendanceResult[]>();
  for (const r of records) {
    const list = byMonth.get(r.month) ?? [];
    list.push(r);
    byMonth.set(r.month, list);
  }
  const loaders: AttendanceKpiDataLoaders = {
    loadAttendanceResult: async (monthKey, employeeId) => {
      calls.push(`result:${monthKey}:${employeeId}`);
      return byId.get(`${monthKey}_${employeeId}`) ?? null;
    },
    loadAttendanceResultsForMonth: async (monthKey) => {
      calls.push(`month:${monthKey}`);
      return byMonth.get(monthKey) ?? [];
    },
  };
  return { loaders, calls };
}

// ═══════════════════════════════════════════════════════════════
//  KPI score (spec §23 — compliance ↔ KPI parity)
// ═══════════════════════════════════════════════════════════════

test('score: compliance 100 → KPI 100', () => {
  const kpi = buildAttendanceKpi(storedWith(100));
  assert.equal(kpi.score, 100);
  assert.equal(kpi.performanceFactor.score, 100);
});

test('score: compliance 95 → KPI 95', () => {
  const kpi = buildAttendanceKpi(storedWith(95));
  assert.equal(kpi.score, 95);
});

test('score: compliance 0 → KPI 0', () => {
  const kpi = buildAttendanceKpi(storedWith(0));
  assert.equal(kpi.score, 0);
  assert.equal(kpi.normalized, 0);
});

test('score: values remain within 0–100 across a compliance sweep', () => {
  for (let compliance = 0; compliance <= 100; compliance++) {
    const kpi = buildAttendanceKpi(storedWith(compliance));
    assert.equal(kpi.score, compliance, `score altered for compliance=${compliance}`);
    assert.ok(kpi.score >= 0 && kpi.score <= 100, `out of range for compliance=${compliance}`);
    assert.ok(kpi.normalized >= 0 && kpi.normalized <= 1, `normalized out of range for compliance=${compliance}`);
  }
});

test('parity: stored compliance = KPI score = PerformanceFactor.score (fractional values unaltered)', () => {
  for (const compliance of [61, 87.5, 33.333333]) {
    const stored = storedWith(compliance);
    const kpi = buildAttendanceKpi(stored);
    assert.equal(kpi.score, stored.compliance);
    assert.equal(kpi.performanceFactor.score, stored.compliance);
    assert.equal(kpi.normalized, compliance / 100);
  }
});

// ═══════════════════════════════════════════════════════════════
//  Stored-result source (spec §23 — no recalculation)
// ═══════════════════════════════════════════════════════════════

test('source: orchestrator reads ONLY the stored attendanceResults loader — no engine path', async () => {
  const { loaders, calls } = loadersOver([storedWith(93)]);
  const kpi = await getAttendanceKpi('2026-08', 'emp-1', loaders);

  assert.ok(kpi, 'builds a KPI from the stored result');
  // Exactly ONE load, against the stored-results surface only.
  assert.deepEqual(calls, ['result:2026-08:emp-1']);
  assert.equal(kpi.score, 93);
});

test('source: KPI derives from StoredAttendanceResult fields only (no raw inputs accepted)', () => {
  const stored = storedWith(88);
  const kpi = buildAttendanceKpi(stored);
  // Every output value traces to a stored field.
  assert.equal(kpi.score, stored.compliance);
  assert.equal(kpi.engineVersion, stored.engineVersion);
  assert.equal(kpi.policyFingerprint, stored.policyFingerprint);
  assert.equal(kpi.generatedAt, stored.generatedAt);
  assert.equal(kpi.source, 'attendanceResults');
  assert.equal(kpi.employeeId, stored.employeeId);
  assert.equal(kpi.month, stored.month);
  // Employee display fields are the stored snapshot, verbatim.
  assert.equal(kpi.employeeName, stored.employeeSnapshot.employeeName);
  assert.equal(kpi.department, stored.employeeSnapshot.department);
});

test('source: kpi module statically imports no engine / biometric / raw-attendance path', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '..', 'kpi.ts'), 'utf8');
  // Inspect the actual dependency surface: import statements only
  // (the module's documentation comments intentionally NAME the
  // engines it must never call).
  const importLines = source.split('\n').filter((line) => line.trimStart().startsWith('import')).join('\n');
  const forbidden = [
    'computeMonthlyAttendance',
    'generateMonthlyAttendanceResults',
    'loadMonthlyRawInputs',
    'buildMonthlyInputIndex',
    "from '@/lib/db'",
    'biometrics',
    'attendanceRecords',
    'findWhere',
    'writeAudit',
    'createRecord',
    'updateRecord',
  ];
  for (const token of forbidden) {
    assert.ok(!importLines.includes(token), `kpi service must not import ${token}`);
  }
});

// ═══════════════════════════════════════════════════════════════
//  Not generated (spec §10/§23)
// ═══════════════════════════════════════════════════════════════

test('not_generated: missing stored result → explicit null (caller surfaces not_generated)', async () => {
  const { loaders } = loadersOver([]); // nothing generated at all
  const kpi = await getAttendanceKpi('2026-08', 'emp-1', loaders);
  assert.equal(kpi, null, 'must be an explicit null — never a fabricated 100 or a live recalculation');
});

test('not_generated: never falls back to another employee\'s or month\'s result', async () => {
  const { loaders } = loadersOver([
    storedWith(93, {}, 'emp-1', '2026-08'),
    storedWith(77, {}, 'emp-2', '2026-08'),
  ]);
  // September was never generated — August's value must not leak in.
  assert.equal(await getAttendanceKpi('2026-09', 'emp-1', loaders), null);
  // emp-3 has no result — emp-1/emp-2 values must not leak in.
  assert.equal(await getAttendanceKpi('2026-08', 'emp-3', loaders), null);
  // The right key still resolves (sanity).
  assert.equal((await getAttendanceKpi('2026-08', 'emp-2', loaders))?.score, 77);
});

test('not_generated: batch read of an ungenerated month returns [] (never fabricated)', async () => {
  const { loaders } = loadersOver([storedWith(93)]);
  assert.deepEqual(await getAttendanceKpisForMonth('2026-09', loaders), []);
});

test('contract: invalid month key throws (strict-contract convention)', async () => {
  const { loaders } = loadersOver([]);
  await assert.rejects(() => getAttendanceKpi('2026-13', 'emp-1', loaders), /Invalid month key/);
  await assert.rejects(() => getAttendanceKpi('august', 'emp-1', loaders), /Invalid month key/);
  await assert.rejects(() => getAttendanceKpisForMonth('2026-1', loaders), /Invalid month key/);
});

test('contract: corrupt stored identity is surfaced, never silently returned', async () => {
  const corrupt = storedWith(90, {}, 'emp-1', '2026-08');
  corrupt.employeeId = 'someone-else';
  const loaders: AttendanceKpiDataLoaders = {
    loadAttendanceResult: async () => corrupt,
    loadAttendanceResultsForMonth: async () => [corrupt],
  };
  await assert.rejects(() => getAttendanceKpi('2026-08', 'emp-1', loaders), /Corrupt attendance result/);
});

// ═══════════════════════════════════════════════════════════════
//  Time scope (spec §8/§9/§23)
// ═══════════════════════════════════════════════════════════════

test('scope: every KPI carries an explicit selected_month scope for its OWN month', () => {
  const kpi = buildAttendanceKpi(storedWith(93, {}, 'emp-1', '2026-07'));
  assert.deepEqual(kpi.scope, { kind: 'selected_month', monthKey: '2026-07' });
  assert.equal(kpi.month, '2026-07');
});

test('scope: August stays August — September begins as its own month (no inheritance)', async () => {
  const { loaders } = loadersOver([
    storedWith(88, {}, 'emp-1', '2026-07'),
    storedWith(93, {}, 'emp-1', '2026-08'),
  ]);
  const july = await getAttendanceKpi('2026-07', 'emp-1', loaders);
  const august = await getAttendanceKpi('2026-08', 'emp-1', loaders);
  const september = await getAttendanceKpi('2026-09', 'emp-1', loaders);

  assert.equal(july?.score, 88);
  assert.equal(july?.scope.monthKey, '2026-07');
  assert.equal(august?.score, 93);
  assert.equal(august?.scope.monthKey, '2026-08');
  assert.equal(september, null, 'September must begin as its own month — not_generated, never August\'s KPI');
});

test('scope: building a KPI never mutates the historical stored record', () => {
  const stored = storedWith(93);
  const snapshot = JSON.parse(JSON.stringify(stored));
  buildAttendanceKpi(stored);
  assert.deepEqual(stored, snapshot);
});

// ═══════════════════════════════════════════════════════════════
//  PerformanceFactor (spec §6/§23)
// ═══════════════════════════════════════════════════════════════

test('factor: correct factorId, factorName, score, maxScore, normalized, default-safe weight', () => {
  const kpi = buildAttendanceKpi(storedWith(93));
  const factor = kpi.performanceFactor;

  assert.equal(factor.factorId, ATTENDANCE_KPI_FACTOR_ID);
  assert.equal(factor.factorId, 'attendance');
  assert.equal(factor.factorName, ATTENDANCE_KPI_FACTOR_NAME);
  assert.equal(factor.factorName, 'الحضور');
  assert.equal(factor.score, 93);
  assert.equal(factor.maxScore, ATTENDANCE_KPI_MAX_SCORE);
  assert.equal(factor.maxScore, 100);
  assert.equal(factor.normalized, 0.93);
  // Type-required placeholder only — the Unified Performance Engine
  // owns composition weights (spec §7).
  assert.equal(factor.weight, ATTENDANCE_KPI_DEFAULT_WEIGHT);
  assert.equal(factor.weight, 1);
});

test('factor: maxScore stays 100 even at compliance 100 (no collapse to the score)', () => {
  const factor = buildAttendanceKpi(storedWith(100)).performanceFactor;
  assert.equal(factor.maxScore, 100);
  assert.equal(factor.normalized, 1);
});

test('factor: breakdown is read verbatim from the stored result', () => {
  const stored = storedWith(61, {
    workDays: 31,
    presentDays: 20,
    lateDays: 6,
    absentDays: 5,
    exemptDays: 1,
    lateDeductionDays: 3.25,
    absenceDeductionDays: 8,
    attendanceDeductionDays: 11.25,
  });
  const breakdown = buildAttendanceKpiBreakdown(stored);

  assert.deepEqual(breakdown, {
    presentDays: 20,
    lateDays: 6,
    absentDays: 5,
    exemptDays: 1,
    lateDeductionDays: 3.25,
    absenceDeductionDays: 8,
    attendanceDeductionDays: 11.25,
    compliance: 61,
  });
  assert.deepEqual(buildAttendanceKpi(stored).performanceFactor.breakdown, breakdown);
});

test('traceability: engineVersion + policyFingerprint preserved from the stored result', () => {
  const stored = storedWith(93);
  const kpi = buildAttendanceKpi(stored);
  assert.equal(kpi.engineVersion, stored.engineVersion);
  assert.equal(kpi.engineVersion, 'attendance-v1');
  assert.equal(kpi.policyFingerprint, stored.policyFingerprint);
  assert.match(kpi.policyFingerprint, /^[0-9a-f]{8}$/);
});

// ═══════════════════════════════════════════════════════════════
//  Domain separation (spec §18/§19/§20/§23)
// ═══════════════════════════════════════════════════════════════

test('separation: output contains ONLY attendance-domain values — no quality/sales/HR inputs', () => {
  const kpi = buildAttendanceKpi(storedWith(93));
  // Set comparison — key order is not part of the contract.
  assert.deepEqual(
    new Set(Object.keys(kpi)),
    new Set([
      'department', 'employeeId', 'employeeName', 'engineVersion', 'generatedAt', 'maxScore', 'month',
      'normalized', 'performanceFactor', 'policyFingerprint', 'score', 'scope', 'source',
    ]),
  );
  assert.deepEqual(
    new Set(Object.keys(kpi.performanceFactor.breakdown ?? {})),
    new Set([
      'absenceDeductionDays', 'absentDays', 'attendanceDeductionDays', 'compliance',
      'exemptDays', 'lateDays', 'lateDeductionDays', 'presentDays',
    ]),
  );
  const serialized = JSON.stringify(kpi);
  for (const foreign of ['quality', 'sales', 'hrDeduction', 'finalKpi']) {
    assert.ok(!serialized.toLowerCase().includes(foreign.toLowerCase()), `KPI must not carry ${foreign}`);
  }
});

test('separation: an HR deduction on the same month does not alter the Attendance KPI', () => {
  const stored = storedWith(93);
  const before = buildAttendanceKpi(stored).score;
  // HR deductions live in a different collection/domain — the KPI
  // input record has no HR field, so nothing can flow in.
  const withHrNoise = { ...stored, hrDeductionDays: 2 } as StoredAttendanceResult;
  assert.equal(buildAttendanceKpi(withHrNoise).score, before);
  assert.equal(buildAttendanceKpi(withHrNoise).score, 93);
});

// ═══════════════════════════════════════════════════════════════
//  Batch read (spec §14)
// ═══════════════════════════════════════════════════════════════

test('batch: every stored result of the month maps to a KPI, one per employee', async () => {
  const { loaders } = loadersOver([
    storedWith(93, {}, 'emp-1', '2026-08'),
    storedWith(77, {}, 'emp-2', '2026-08'),
    storedWith(88, {}, 'emp-1', '2026-07'), // different month — excluded
  ]);
  const kpis = await getAttendanceKpisForMonth('2026-08', loaders);

  assert.equal(kpis.length, 2);
  assert.deepEqual(kpis.map((k) => k.employeeId).sort(), ['emp-1', 'emp-2']);
  for (const kpi of kpis) {
    assert.equal(kpi.scope.monthKey, '2026-08');
    assert.equal(kpi.maxScore, 100);
    assert.equal(kpi.performanceFactor.factorId, 'attendance');
  }
  assert.deepEqual(kpis.map((k) => k.score).sort(), [77, 93]);
});

// ═══════════════════════════════════════════════════════════════
//  Engine-derived parity anchors (real computeMonthlyAttendance)
// ═══════════════════════════════════════════════════════════════

function biometricsForJuly(presentDays: number): Record<string, { checkIn: string; checkOut: string }> {
  const byDate: Record<string, { checkIn: string; checkOut: string }> = {};
  for (let d = 1; d <= presentDays; d++) {
    byDate[`${String(d).padStart(2, '0')}/07/2026`] = { checkIn: '08:55', checkOut: '17:00' };
  }
  return byDate;
}

test('engine anchor: perfect engine month (compliance 100) → KPI 100', () => {
  const engineResult = computeMonthlyAttendance({
    employeeId: 'emp-1',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate: biometricsForJuly(31),
  });
  assert.equal(engineResult.compliance, 100);

  const stored = buildStoredAttendanceResult({
    result: engineResult,
    employeeSnapshot: { employeeId: 'emp-1', employeeName: 'أحمد', department: null, position: null },
    policy: POLICY,
    actor: ACTOR,
    now: NOW,
  });
  const kpi = buildAttendanceKpi(stored);
  assert.equal(kpi.score, engineResult.compliance);
  assert.equal(kpi.score, 100);
  assert.equal(kpi.normalized, 1);
});

test('engine anchor: absence month — KPI equals the engine compliance exactly (no second formula)', () => {
  const engineResult = computeMonthlyAttendance({
    employeeId: 'emp-1',
    month: '2026-07',
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate: biometricsForJuly(21), // 10 absent days → 4 autoExempt, no bonus
  });
  assert.ok(engineResult.compliance > 0 && engineResult.compliance < 100);

  const stored = buildStoredAttendanceResult({
    result: engineResult,
    employeeSnapshot: { employeeId: 'emp-1', employeeName: 'أحمد', department: null, position: null },
    policy: POLICY,
    actor: ACTOR,
    now: NOW,
  });
  const kpi = buildAttendanceKpi(stored);
  assert.equal(kpi.score, engineResult.compliance);
  assert.equal(kpi.score, stored.compliance);
  assert.equal(kpi.performanceFactor.breakdown?.compliance, stored.compliance);
});
