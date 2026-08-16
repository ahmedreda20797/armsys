// ══════════════════════════════════════════════════════════════
//  Employee Performance History Service — Milestone 5 tests
//
//  Covers (spec §28), against PURE primitives + the injectable
//  orchestrator (project convention: no Firebase mocking):
//
//    • Current layer  — current-month result only; null per domain
//      when not generated; history is never promoted into current.
//    • History layer  — strictly earlier months, most recent
//      first, no current-month duplication, duplicate
//      employee/month resolves last-wins, values exactly as stored.
//    • Career layer   — derived from stored monthly results via the
//      M4 contract (sampleSize/first/last/best/worst/average/deltas;
//      single record → no delta; empty → explicit empty state).
//    • Cross-domain   — attendance from attendanceResults, quality
//      from monthSnapshots, HR kept separate; no cross-employee
//      leakage; no fabricated values.
//    • Scope          — career / current / selected / previous /
//      rolling window filtering with the shared TimeScope.
//    • No recalculation — the orchestrator touches ONLY the three
//      stored collections through its injected loaders, and the
//      service module statically imports no calculation engine.
//
//  Run: npx tsx --test src/lib/employee-performance/__tests__/employee-performance.test.ts
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  aggregateHrMonth,
  assembleEmployeePerformance,
  getEmployeePerformance,
} from '@/lib/employee-performance';
import type {
  EmployeeHrDeductionRecord,
  EmployeePerformanceDataLoaders,
} from '@/lib/employee-performance';
import type { StoredAttendanceResult } from '@/lib/attendance';
import type { EmployeeScoreEntry, MonthSnapshot } from '@/types/quality-kpi';
import type { TimeScope } from '@/lib/time-scope';

// ═══════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════

const NOW = new Date(2026, 7, 16); // 2026-08-16, local time → current month 2026-08
const CURRENT_MONTH = '2026-08';

/** Literal stored attendance result — values chosen explicitly so career math is hand-checkable. */
function att(employeeId: string, month: string, compliance: number, overrides: Partial<StoredAttendanceResult> = {}): StoredAttendanceResult {
  return {
    employeeId,
    month,
    workDays: 26,
    presentDays: 24,
    lateDays: 1,
    absentDays: 1,
    exemptDays: 0,
    unaccountedDays: 0,
    totalMinutesLate: 45,
    lateDeductionDays: 0.25,
    absenceDeductionDays: 1,
    attendanceDeductionDays: 1.25,
    autoExemptDays: 0,
    bonusDays: 0,
    effectiveWorkingDays: 25,
    compliance,
    daily: [],
    id: `${month}_${employeeId}`,
    schemaVersion: 1,
    employeeSnapshot: { employeeId, employeeName: 'موظف تجريبي', department: 'مبيعات', position: 'موظف' },
    policySnapshot: {} as StoredAttendanceResult['policySnapshot'],
    policyFingerprint: 'deadbeef',
    engineVersion: 'attendance-v1',
    generatedAt: '2026-08-01T10:00:00.000Z',
    generatedBy: { id: 'mgr1', name: 'مدير' },
    ...overrides,
  };
}

function scoreEntry(score: number, rank = 1): EmployeeScoreEntry {
  return {
    employeeSnapshot: {
      employeeId: 'emp1',
      employeeName: 'موظف تجريبي',
      departmentId: 'd1',
      departmentName: 'مبيعات',
      position: 'موظف',
      supervisorId: null,
    },
    score,
    deductionPoints: Math.max(100 - score, 0),
    bonusPoints: 0,
    weightedPoints: 0,
    observationCount: 3,
    approvedCount: 3,
    pendingCount: 0,
    rejectedCount: 0,
    categoryTotals: {},
    rank,
    dept: 'مبيعات',
  };
}

function snapshot(month: string, entries: Record<string, EmployeeScoreEntry>, status: MonthSnapshot['status'] = 'closed'): MonthSnapshot {
  return {
    id: month,
    schemaVersion: 1,
    monthKey: month,
    status,
    closedAt: status === 'closed' ? '2026-07-05T10:00:00.000Z' : null,
    closedBy: status === 'closed' ? 'mgr1' : null,
    closedByName: status === 'closed' ? 'مدير' : null,
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: '2026-07-05T10:00:00.000Z',
    settingsSnapshot: {
      id: 'singleton',
      schemaVersion: 1,
      defaultScore: 100,
      minimumScore: 0,
      allowBonus: true,
      maximumBonus: 20,
      approvalRequired: true,
      leaderboardEnabled: true,
      closeMonthLock: true,
      trendCalculation: 'rollingAverage',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    employeeScores: entries,
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
  };
}

function hr(month: string, amount: number, unit: 'days' | 'EGP' = 'days', status = 'approved'): EmployeeHrDeductionRecord {
  return { employeeId: 'emp1', month, amount, unit, status };
}

function assemble(args: Partial<Parameters<typeof assembleEmployeePerformance>[0]> = {}) {
  return assembleEmployeePerformance({
    employeeId: 'emp1',
    currentMonthKey: CURRENT_MONTH,
    now: NOW,
    scope: { kind: 'career' },
    attendanceRecords: [],
    qualitySnapshots: [],
    hrRecords: [],
    ...args,
  });
}

// ═══════════════════════════════════════════════════════════════
//  Current layer (spec §5/§16)
// ═══════════════════════════════════════════════════════════════

test('current layer returns the stored current-month result per domain', () => {
  const res = assemble({
    attendanceRecords: [att('emp1', CURRENT_MONTH, 91)],
    qualitySnapshots: [snapshot(CURRENT_MONTH, { emp1: scoreEntry(94) }, 'open')],
    hrRecords: [hr(CURRENT_MONTH, 1)],
  });

  assert.equal(res.current.month, CURRENT_MONTH);
  assert.equal(res.current.attendance?.compliance, 91);
  assert.equal(res.current.quality?.score, 94);
  assert.equal(res.current.hr?.deductionDays, 1);
  assert.equal(res.currentMonthKey, CURRENT_MONTH);
});

test('missing current-month data returns null per domain — never a fabricated value', () => {
  const res = assemble({
    attendanceRecords: [att('emp1', '2026-07', 88)],
    qualitySnapshots: [snapshot('2026-07', { emp1: scoreEntry(89) })],
    hrRecords: [hr('2026-07', 2)],
  });

  assert.equal(res.current.attendance, null);
  assert.equal(res.current.quality, null, 'no snapshot for the current month → null, never a fabricated 100');
  assert.equal(res.current.hr, null);
});

test('history is never promoted into the current layer (September reset semantics)', () => {
  const res = assemble({
    attendanceRecords: [att('emp1', '2026-07', 88)],
    qualitySnapshots: [snapshot('2026-07', { emp1: scoreEntry(89) })],
    hrRecords: [hr('2026-07', 2)],
  });

  // August (current) has no stored results — current stays null even
  // though July exists, and July lives ONLY in history.
  assert.equal(res.current.attendance, null);
  assert.ok(res.history.some((row) => row.month === '2026-07' && row.attendance?.compliance === 88));
});

// ═══════════════════════════════════════════════════════════════
//  History layer (spec §7/§11)
// ═══════════════════════════════════════════════════════════════

test('history returns strictly earlier months, most recent first, without the current month', () => {
  const res = assemble({
    attendanceRecords: [
      att('emp1', '2026-08', 91),
      att('emp1', '2026-05', 77),
      att('emp1', '2026-07', 88),
      att('emp1', '2026-06', 84),
    ],
  });

  assert.deepEqual(
    res.history.map((row) => row.month),
    ['2026-07', '2026-06', '2026-05'],
  );
  assert.ok(!res.history.some((row) => row.month === CURRENT_MONTH), 'current month is never duplicated into history');
});

test('duplicate employee/month records resolve deterministically (last wins, never duplicated)', () => {
  const res = assemble({
    attendanceRecords: [
      att('emp1', '2026-07', 80),
      att('emp1', '2026-07', 88), // regenerated replacement
    ],
  });

  assert.equal(res.history.length, 1);
  assert.equal(res.history[0].attendance?.compliance, 88);
});

test('historical values remain exactly what was stored — later months never overwrite earlier ones', () => {
  const res = assemble({
    attendanceRecords: [att('emp1', '2026-05', 77), att('emp1', '2026-07', 88)],
    qualitySnapshots: [snapshot('2026-05', { emp1: scoreEntry(82) }), snapshot('2026-07', { emp1: scoreEntry(90) })],
  });

  const may = res.history.find((row) => row.month === '2026-05');
  const july = res.history.find((row) => row.month === '2026-07');
  assert.equal(may?.attendance?.compliance, 77);
  assert.equal(may?.quality?.score, 82);
  assert.equal(july?.attendance?.compliance, 88);
  assert.equal(july?.quality?.score, 90);
});

test('history rows show per-domain nulls where a domain has no stored data', () => {
  const res = assemble({
    attendanceRecords: [att('emp1', '2026-07', 88)],
  });

  const july = res.history[0];
  assert.equal(july.attendance?.compliance, 88);
  assert.equal(july.quality, null);
  assert.equal(july.hr, null);
});

// ═══════════════════════════════════════════════════════════════
//  Career layer (spec §8/§18) — derived from stored results
// ═══════════════════════════════════════════════════════════════

test('career derives from stored monthly results with correct average, best, worst and deltas', () => {
  // Attendance compliance series: Apr 77, May 80, Jun 84, Jul 88, Aug(current) 91.
  const res = assemble({
    attendanceRecords: [
      att('emp1', '2026-04', 77),
      att('emp1', '2026-05', 80),
      att('emp1', '2026-06', 84),
      att('emp1', '2026-07', 88),
      att('emp1', CURRENT_MONTH, 91),
    ],
  });

  const career = res.career.attendance;
  assert.equal(career.sampleSize, 5);
  assert.equal(career.firstMonth, '2026-04');
  assert.equal(career.lastMonth, CURRENT_MONTH);
  assert.equal(career.bestMonth?.month, CURRENT_MONTH);
  assert.equal(career.bestMonth?.value, 91);
  assert.equal(career.worstMonth?.month, '2026-04');
  assert.equal(career.worstMonth?.value, 77);
  assert.equal(career.averageValue, Math.round((77 + 80 + 84 + 88 + 91) / 5)); // 84
  assert.deepEqual(
    career.monthOverMonthDeltas,
    [
      { month: '2026-05', delta: 3 },
      { month: '2026-06', delta: 4 },
      { month: '2026-07', delta: 4 },
      { month: '2026-08', delta: 3 },
    ],
  );
});

test('quality career derives from stored snapshot entries', () => {
  const res = assemble({
    qualitySnapshots: [
      snapshot('2026-06', { emp1: scoreEntry(84) }),
      snapshot('2026-07', { emp1: scoreEntry(90) }),
      snapshot(CURRENT_MONTH, { emp1: scoreEntry(94) }),
    ],
  });

  const career = res.career.quality;
  assert.equal(career.sampleSize, 3);
  assert.equal(career.bestMonth?.month, CURRENT_MONTH);
  assert.equal(career.worstMonth?.month, '2026-06');
  assert.equal(career.averageValue, Math.round((84 + 90 + 94) / 3)); // 89
});

test('one stored result produces no month-over-month delta', () => {
  const res = assemble({ attendanceRecords: [att('emp1', '2026-07', 88)] });
  assert.equal(res.career.attendance.sampleSize, 1);
  assert.deepEqual(res.career.attendance.monthOverMonthDeltas, []);
});

test('empty history produces an explicit empty career state (nulls, sampleSize 0)', () => {
  const res = assemble();
  for (const domain of ['attendance', 'quality', 'hr'] as const) {
    const career = res.career[domain];
    assert.equal(career.sampleSize, 0);
    assert.equal(career.firstMonth, null);
    assert.equal(career.lastMonth, null);
    assert.equal(career.bestMonth, null);
    assert.equal(career.worstMonth, null);
    assert.equal(career.averageValue, null);
    assert.deepEqual(career.monthOverMonthDeltas, []);
  }
});

test('career includes the current month only when its own result exists', () => {
  const withCurrent = assemble({ attendanceRecords: [att('emp1', CURRENT_MONTH, 91)] });
  assert.equal(withCurrent.career.attendance.sampleSize, 1);

  const withoutCurrent = assemble({ attendanceRecords: [att('emp1', '2026-07', 88)] });
  assert.equal(withoutCurrent.career.attendance.sampleSize, 1);
  assert.equal(withoutCurrent.career.attendance.lastMonth, '2026-07');
});

// ═══════════════════════════════════════════════════════════════
//  Cross-domain sources + isolation (spec §13/§14/§15/§28)
// ═══════════════════════════════════════════════════════════════

test('attendance values come from the stored attendanceResults records only', () => {
  const record = att('emp1', '2026-07', 88, {
    lateDeductionDays: 0.5,
    absenceDeductionDays: 1,
    attendanceDeductionDays: 1.5,
    workDays: 26,
    presentDays: 23,
    engineVersion: 'attendance-v1',
  });
  const res = assemble({ attendanceRecords: [record] });

  const summary = res.history[0].attendance;
  assert.equal(summary?.compliance, record.compliance);
  assert.equal(summary?.attendanceDeductionDays, 1.5);
  assert.equal(summary?.engineVersion, 'attendance-v1');
  assert.equal(summary?.workDays, 26);
});

test('quality values come from stored monthSnapshots entries (status + rank preserved)', () => {
  const res = assemble({
    qualitySnapshots: [snapshot('2026-07', { emp1: scoreEntry(90, 4) }, 'closed')],
  });

  const summary = res.history[0].quality;
  assert.equal(summary?.score, 90);
  assert.equal(summary?.snapshotStatus, 'closed');
  assert.equal(summary?.rank, 4);
});

test('a snapshot month without this employee yields quality null — no fabricated score', () => {
  // emp1 has an attendance result for July, but July's snapshot only
  // contains someone else: the row exists, quality stays null.
  const res = assemble({
    attendanceRecords: [att('emp1', '2026-07', 88)],
    qualitySnapshots: [snapshot('2026-07', { someoneElse: scoreEntry(95) })],
  });

  assert.equal(res.history.length, 1);
  assert.equal(res.history[0].quality, null);

  // A snapshot with ONLY another employee's entry contributes no
  // month to this employee's history at all.
  const alone = assemble({
    qualitySnapshots: [snapshot('2026-06', { someoneElse: scoreEntry(95) })],
  });
  assert.deepEqual(alone.history, []);
  assert.equal(alone.career.quality.sampleSize, 0);
});

test('HR stays a separate domain — days and amounts aggregated per month, never merged', () => {
  const summary = aggregateHrMonth('2026-07', [
    hr('2026-07', 1, 'days', 'approved'),
    hr('2026-07', 0.5, 'days', 'pending'),
    hr('2026-07', 200, 'EGP', 'approved'),
  ]);
  assert.equal(summary.deductionCount, 3);
  assert.equal(summary.deductionDays, 1.5);
  assert.equal(summary.deductionAmount, 200);
  assert.deepEqual(summary.statusCounts, { approved: 2, pending: 1 });

  const res = assemble({
    attendanceRecords: [att('emp1', '2026-07', 88)],
    hrRecords: [hr('2026-07', 1)],
  });
  const july = res.history[0];
  assert.equal(july.hr?.deductionDays, 1);
  assert.equal(july.attendance?.attendanceDeductionDays, 1.25, 'HR days are NOT added to attendance deductions');
});

test("one employee's data never leaks into another employee's layers", () => {
  const res = assemble({
    employeeId: 'emp1',
    attendanceRecords: [att('emp1', '2026-07', 88), att('emp2', '2026-07', 42)],
    qualitySnapshots: [snapshot('2026-07', { emp1: scoreEntry(90), emp2: scoreEntry(10) })],
    hrRecords: [
      { employeeId: 'emp2', month: '2026-07', amount: 5, unit: 'days', status: 'approved' },
    ],
  });

  const july = res.history[0];
  assert.equal(july.attendance?.compliance, 88);
  assert.equal(july.quality?.score, 90);
  assert.equal(july.hr, null, "emp2's HR deductions must not appear in emp1's row");
});

// ═══════════════════════════════════════════════════════════════
//  Scope filtering (spec §12) — shared TimeScope vocabulary
// ═══════════════════════════════════════════════════════════════

function historyFor(scope: TimeScope, data: Partial<Parameters<typeof assembleEmployeePerformance>[0]> = {}) {
  return assemble({
    attendanceRecords: [
      att('emp1', CURRENT_MONTH, 91),
      att('emp1', '2026-07', 88),
      att('emp1', '2026-06', 84),
      att('emp1', '2026-05', 77),
    ],
    ...data,
    scope,
  });
}

test('career scope (default) returns every stored historical month', () => {
  const res = historyFor({ kind: 'career' });
  assert.deepEqual(res.history.map((r) => r.month), ['2026-07', '2026-06', '2026-05']);
  assert.equal(res.scope.months, null);
  assert.equal(res.scope.label, 'المسار الوظيفي (كل الفترات)');
});

test('current_month scope keeps history empty — the current month lives in the current layer', () => {
  const res = historyFor({ kind: 'current_month' });
  assert.deepEqual(res.history, []);
  assert.equal(res.current.attendance?.compliance, 91);
});

test('previous_month scope returns only the previous month', () => {
  const res = historyFor({ kind: 'previous_month' });
  assert.deepEqual(res.history.map((r) => r.month), ['2026-07']);
});

test('selected_month scope returns the chosen month — with an explicit empty row when it has no data', () => {
  const withData = historyFor({ kind: 'selected_month', monthKey: '2026-06' });
  assert.deepEqual(withData.history.map((r) => r.month), ['2026-06']);

  const noData = historyFor({ kind: 'selected_month', monthKey: '2026-02' });
  assert.deepEqual(noData.history.map((r) => r.month), ['2026-02'], 'explicit no-data state, not a silent empty list');
  assert.equal(noData.history[0].attendance, null);
});

test('last_3_months scope filters the history window (current month excluded from history)', () => {
  const res = historyFor({ kind: 'last_3_months' });
  assert.deepEqual(res.scope.months, ['2026-08', '2026-07', '2026-06']);
  assert.deepEqual(res.history.map((r) => r.month), ['2026-07', '2026-06']);
});

test('custom_range scope respects the supplied months', () => {
  const res = historyFor({ kind: 'custom_range', monthKeys: ['2026-05', '2026-06'] });
  assert.deepEqual(res.history.map((r) => r.month), ['2026-06', '2026-05']);
});

// ═══════════════════════════════════════════════════════════════
//  No recalculation (spec §24/§28)
// ═══════════════════════════════════════════════════════════════

test('orchestrator reads ONLY the three stored collections through its loaders — no engine path', async () => {
  const calls: string[] = [];
  const spyLoaders: EmployeePerformanceDataLoaders = {
    loadEmployee: async (id) => {
      calls.push(`employee:${id}`);
      return { id };
    },
    loadAttendanceResults: async (id) => {
      calls.push(`attendance:${id}`);
      return [att(id, '2026-07', 88)];
    },
    loadQualitySnapshots: async () => {
      calls.push('quality:*');
      return [snapshot('2026-07', { emp1: scoreEntry(90) })];
    },
    loadHrDeductions: async (id) => {
      calls.push(`hr:${id}`);
      return [hr('2026-07', 1)];
    },
  };

  const res = await getEmployeePerformance({ employeeId: 'emp1', scope: { kind: 'career' }, now: NOW }, spyLoaders);

  assert.ok(res, 'assembles a response');
  assert.deepEqual(calls, ['employee:emp1', 'attendance:emp1', 'quality:*', 'hr:emp1']);
  assert.equal(res.history[0].attendance?.compliance, 88);
  assert.equal(res.history[0].quality?.score, 90);
  assert.equal(res.history[0].hr?.deductionDays, 1);
});

test('orchestrator returns null for an unknown employee (caller surfaces 404)', async () => {
  const emptyLoaders: EmployeePerformanceDataLoaders = {
    loadEmployee: async () => null,
    loadAttendanceResults: async () => [],
    loadQualitySnapshots: async () => [],
    loadHrDeductions: async () => [],
  };
  const res = await getEmployeePerformance({ employeeId: 'ghost', now: NOW }, emptyLoaders);
  assert.equal(res, null);
});

test('service module statically imports no calculation engine (reader/assembler only)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(here, '..', 'index.ts'), 'utf8');
  // Inspect the actual dependency surface: import statements only
  // (the module's documentation comments intentionally NAME the
  // engines it must never call).
  const importLines = source.split('\n').filter((line) => line.trimStart().startsWith('import')).join('\n');
  const forbidden = [
    'computeMonthlyAttendance',
    'computeFreshMonthSnapshot',
    'computeMonthSnapshot',
    'generateMonthlyAttendanceResults',
    'closeMonth',
    'reopenMonth',
  ];
  for (const name of forbidden) {
    assert.ok(
      !importLines.includes(name),
      `employee-performance service must not import ${name} — it is a stored-results reader`,
    );
  }
});
