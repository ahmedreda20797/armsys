// ══════════════════════════════════════════════════════════════
//  Time-Scope & Employee Performance History Contract — M4 tests
//
//  Covers (spec §21), against PURE primitives only (project
//  convention: no Firebase mocking):
//
//    • Time scope — every scope kind resolves to the correct
//      month keys (current/selected/previous month, rolling
//      ranges incl. year rollover, custom range, day, career),
//      plus PARITY with the canonical resolveMonthsInRange for
//      the five shared calendar presets.
//    • Monthly reset — a new month's calculation never includes
//      the previous month's current-period values (engine-level
//      via computeMonthlyAttendance + layer-level).
//    • Historical retention — August remains available and
//      unchanged after September exists (deterministic identity,
//      replacement write plans never touch other months).
//    • Employee 360 semantics — current month = current result,
//      historical month = historical result, career = derived
//      from MULTIPLE historical results (never a single score).
//    • Data isolation — one employee's monthly result never
//      affects another employee's.
//    • Future contracts — MetricResult / MonthlyPerformanceResult
//      are constructible in their documented shape.
//
//  Run: npx tsx --test src/lib/time-scope/__tests__/time-scope.test.ts
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_SCOPE_LABELS_AR,
  buildEmployeePerformanceLayers,
  buildMonthlyHistoryIndex,
  dayKeyToMonthKey,
  deriveCareerSummary,
  describeTimeScope,
  isCalendarScope,
  isHistoricalAggregateScope,
  isValidDayKey,
  kpiPresetToTimeScope,
  resolveTimeScopeMonthKeys,
  selectMonths,
  toMonthKey,
} from '@/lib/time-scope';
import type {
  MetricResult,
  MonthlyPerformanceResult,
  MonthScopedResult,
  TimeScope,
  TimeScopeKind,
} from '@/lib/time-scope';
import { resolveMonthsInRange } from '@/lib/metrics/kpiMetrics';
import { computeMonthlyAttendance } from '@/lib/attendance/monthly-engine';
import { DEFAULT_ATTENDANCE_POLICY } from '@/lib/attendance/rule-config';
import {
  attendanceResultId,
  buildStoredAttendanceResult,
  planResultWrites,
} from '@/lib/attendance/monthly-results';
import type {
  AttendanceResultActor,
  EmployeeResultSnapshot,
  StoredAttendanceResult,
} from '@/lib/attendance/monthly-results';

const NOW = new Date('2026-08-16T10:00:00.000Z');
const ACTOR: AttendanceResultActor = { id: 'mgr1', name: 'مدير الحضور' };
const POLICY = DEFAULT_ATTENDANCE_POLICY;

function employeeSnapshot(employeeId: string, name: string): EmployeeResultSnapshot {
  return { employeeId, employeeName: name, department: 'مبيعات', position: 'موظف' };
}

function store(result: Parameters<typeof buildStoredAttendanceResult>[0]['result'],
              employeeId: string, now: Date): StoredAttendanceResult {
  return buildStoredAttendanceResult({
    result,
    employeeSnapshot: employeeSnapshot(employeeId, 'موظف'),
    policy: POLICY,
    actor: ACTOR,
    now,
  });
}

/** Clean full-attendance month for one employee (zero deductions). */
function cleanMonth(employeeId: string, month: string, days: number) {
  const biometricByDate: Record<string, { checkIn: string; checkOut: string }> = {};
  const [y, m] = month.split('-').map(Number);
  for (let d = 1; d <= days; d++) {
    biometricByDate[`${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`] = {
      checkIn: '08:55',
      checkOut: '17:00',
    };
  }
  return computeMonthlyAttendance({
    employeeId,
    month,
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate,
  });
}

/** Month with lates + absences (non-zero attendance deductions). */
function messyMonth(employeeId: string, month: string) {
  const [y, m] = month.split('-').map(Number);
  const dd = (d: number) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  return computeMonthlyAttendance({
    employeeId,
    month,
    shiftStart: '09:00',
    asOf: null,
    policy: POLICY,
    biometricByDate: {
      [dd(1)]: { checkIn: '08:55', checkOut: '17:00' },
      [dd(2)]: { checkIn: '09:20', checkOut: '17:00' },   // late tier 1
      [dd(3)]: { checkIn: '10:30', checkOut: '17:00' },   // late tier 3
      // days 4..31: no records → absences
    },
  });
}

// ═══════════════════════════════════════════════════════════════
//  1. Time-scope resolution
// ═══════════════════════════════════════════════════════════════

test('current_month resolves to the calendar month of now (local time)', () => {
  const keys = resolveTimeScopeMonthKeys({ kind: 'current_month' }, NOW);
  assert.deepEqual(keys, ['2026-08']);
});

test('previous_month resolves to the month before now', () => {
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'previous_month' }, NOW),
    ['2026-07'],
  );
});

test('selected_month resolves to exactly the chosen month regardless of now', () => {
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'selected_month', monthKey: '2026-03' }, NOW),
    ['2026-03'],
  );
  // Selecting the current month is also valid (current period is a scope).
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'selected_month', monthKey: '2026-08' }, NOW),
    ['2026-08'],
  );
});

test('rolling windows include the current month, most-recent first, across year boundaries', () => {
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'last_3_months' }, NOW),
    ['2026-08', '2026-07', '2026-06'],
  );
  // February must roll back into the previous year.
  const feb = new Date('2026-02-10T10:00:00.000Z');
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'last_3_months' }, feb),
    ['2026-02', '2026-01', '2025-12'],
  );
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'last_6_months' }, feb),
    ['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09'],
  );
});

test('current_year spans January..current month (single month in January)', () => {
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'current_year' }, NOW),
    ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'],
  );
  const jan = new Date('2026-01-05T10:00:00.000Z');
  assert.deepEqual(resolveTimeScopeMonthKeys({ kind: 'current_year' }, jan), ['2026-01']);
});

test('custom_range validates every key, preserves order, rejects empty/invalid', () => {
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'custom_range', monthKeys: ['2026-06', '2026-03'] }, NOW),
    ['2026-06', '2026-03'],
  );
  assert.throws(() => resolveTimeScopeMonthKeys({ kind: 'custom_range', monthKeys: [] }, NOW));
  assert.throws(() =>
    resolveTimeScopeMonthKeys({ kind: 'custom_range', monthKeys: ['2026-06', '2026-13'] }, NOW),
  );
  assert.throws(() =>
    resolveTimeScopeMonthKeys({ kind: 'custom_range', monthKeys: ['2026-6'] }, NOW),
  );
});

test('day scope validates strictly and resolves to its containing month', () => {
  assert.deepEqual(
    resolveTimeScopeMonthKeys({ kind: 'day', date: '2026-08-16' }, NOW),
    ['2026-08'],
  );
  assert.equal(dayKeyToMonthKey('2025-12-31'), '2025-12');
  assert.throws(() => resolveTimeScopeMonthKeys({ kind: 'day', date: '2026-8-16' }, NOW));
  assert.throws(() => resolveTimeScopeMonthKeys({ kind: 'day', date: '2026-08-32' }, NOW));
  assert.throws(() => resolveTimeScopeMonthKeys({ kind: 'day', date: 'not-a-date' }, NOW));
});

test('day keys are validated against the real calendar (leap years included)', () => {
  assert.equal(isValidDayKey('2026-08-16'), true);
  assert.equal(isValidDayKey('2028-02-29'), true);  // 2028 is a leap year
  assert.equal(isValidDayKey('2026-02-29'), false); // 2026 is not
  assert.equal(isValidDayKey('2026-02-30'), false);
  assert.equal(isValidDayKey('2026-13-01'), false);
  assert.equal(isValidDayKey('16/08/2026'), false);
  assert.equal(isValidDayKey(20260816), false);
});

test('career scope is data-bound: it never resolves to calendar month keys', () => {
  // null forces the caller to resolve against the STORED history —
  // a career scope can never be fabricated from the clock.
  assert.equal(resolveTimeScopeMonthKeys({ kind: 'career' }, NOW), null);
  assert.equal(isHistoricalAggregateScope({ kind: 'career' }), true);
  for (const kind of ['day', 'current_month', 'selected_month', 'previous_month',
    'last_3_months', 'last_6_months', 'current_year', 'custom_range'] as TimeScopeKind[]) {
    const scope: TimeScope = kind === 'day'
      ? { kind, date: '2026-08-16' }
      : kind === 'selected_month'
        ? { kind, monthKey: '2026-08' }
        : kind === 'custom_range'
          ? { kind, monthKeys: ['2026-08'] }
          : { kind };
    assert.equal(isCalendarScope(scope), true);
    assert.equal(isHistoricalAggregateScope(scope), false);
  }
});

test('toMonthKey formats local-time YYYY-MM (replaces inline duplication)', () => {
  assert.equal(toMonthKey(new Date(2026, 7, 16)), '2026-08');
  assert.equal(toMonthKey(new Date(2026, 0, 1)), '2026-01');
  assert.equal(toMonthKey(new Date(2025, 11, 31)), '2025-12');
});

test('PARITY: shared calendar presets match the canonical resolveMonthsInRange exactly', () => {
  const dates = [
    new Date(2026, 0, 1),
    new Date(2026, 1, 15),
    NOW,
    new Date(2026, 11, 31),
    new Date(2025, 2, 10),
  ];
  const presets = ['current_month', 'previous_month', 'last_3_months', 'last_6_months', 'current_year'] as const;
  for (const preset of presets) {
    for (const date of dates) {
      assert.deepEqual(
        resolveTimeScopeMonthKeys({ kind: preset }, date),
        resolveMonthsInRange(preset, date),
        `parity broken for ${preset} at ${date.toISOString()}`,
      );
    }
  }
});

test('kpiPresetToTimeScope maps the existing Quality vocabulary into the shared scope', () => {
  assert.deepEqual(kpiPresetToTimeScope('current_month'), { kind: 'current_month' });
  assert.deepEqual(kpiPresetToTimeScope('previous_month'), { kind: 'previous_month' });
  assert.deepEqual(kpiPresetToTimeScope('last_3_months'), { kind: 'last_3_months' });
  assert.deepEqual(kpiPresetToTimeScope('last_6_months'), { kind: 'last_6_months' });
  assert.deepEqual(kpiPresetToTimeScope('current_year'), { kind: 'current_year' });
  // Comma-separated query-string convention (established by the dashboard route).
  assert.deepEqual(
    kpiPresetToTimeScope('custom', '2026-06, 2026-05 ,'),
    { kind: 'custom_range', monthKeys: ['2026-06', '2026-05'] },
  );
  assert.deepEqual(
    kpiPresetToTimeScope('custom', ['2026-06', '2026-05']),
    { kind: 'custom_range', monthKeys: ['2026-06', '2026-05'] },
  );
  // Unknown presets defensively fall back to current_month (resolveMonthsInRange default).
  assert.deepEqual(kpiPresetToTimeScope('nonsense'), { kind: 'current_month' });
});

test('every scope kind carries a reporting label; lifelong counters are labeled career', () => {
  const kinds: TimeScopeKind[] = [
    'day', 'current_month', 'selected_month', 'previous_month', 'last_3_months',
    'last_6_months', 'current_year', 'custom_range', 'career',
  ];
  for (const kind of kinds) {
    assert.ok(TIME_SCOPE_LABELS_AR[kind], `missing label for ${kind}`);
    assert.ok(TIME_SCOPE_LABELS_AR[kind].length > 0);
  }
  // §8: an all-time number may only be displayed under the career label.
  assert.ok(TIME_SCOPE_LABELS_AR.career.includes('كل الفترات'));
});

test('describeTimeScope produces unambiguous machine-readable scope identifiers', () => {
  assert.equal(describeTimeScope({ kind: 'day', date: '2026-08-16' }), 'day:2026-08-16');
  assert.equal(describeTimeScope({ kind: 'selected_month', monthKey: '2026-03' }), 'selected_month:2026-03');
  assert.equal(describeTimeScope({ kind: 'current_month' }), 'current_month');
  assert.equal(describeTimeScope({ kind: 'career' }), 'career:all-time');
  assert.equal(
    describeTimeScope({ kind: 'custom_range', monthKeys: ['2026-06', '2026-05'] }),
    'custom_range:2026-06,2026-05',
  );
});

// ═══════════════════════════════════════════════════════════════
//  2. Monthly reset — a new period never inherits current-period values
// ═══════════════════════════════════════════════════════════════

test('MONTHLY RESET (engine): September calculation contains only September values', () => {
  // August carries lates + absences.
  const august = messyMonth('emp-1', '2026-08');
  assert.ok(august.lateDays > 0);
  assert.ok(august.absentDays > 0);
  assert.ok(august.attendanceDeductionDays > 0);

  // September is clean: its result starts a NEW scope — none of
  // August's lates/absences/deductions are carried forward.
  const september = cleanMonth('emp-1', '2026-09', 30);
  assert.equal(september.lateDays, 0);
  assert.equal(september.absentDays, 0);
  assert.equal(september.attendanceDeductionDays, 0);
  assert.equal(september.totalMinutesLate, 0);
  assert.equal(september.month, '2026-09');
});

test('MONTHLY RESET (layers): when the month flips, current is the new month — never the previous value', () => {
  const august = store(messyMonth('emp-1', '2026-08'), 'emp-1', NOW);
  const september = store(cleanMonth('emp-1', '2026-09', 30), 'emp-1', NOW);

  // During August: current is the messy August result.
  const inAugust = buildEmployeePerformanceLayers({
    records: [august],
    currentMonthKey: '2026-08',
    extractValue: (r) => (r as StoredAttendanceResult).attendanceDeductionDays,
  });
  assert.ok(inAugust.current!.result.attendanceDeductionDays > 0);

  // After the flip: BOTH records exist, current is September's own
  // (zero-deduction) result — August's value is NOT carried forward.
  const inSeptember = buildEmployeePerformanceLayers({
    records: [august, september],
    currentMonthKey: '2026-09',
    extractValue: (r) => r.attendanceDeductionDays,
  });
  assert.equal(inSeptember.current!.month, '2026-09');
  assert.equal(inSeptember.current!.result.attendanceDeductionDays, 0);
});

// ═══════════════════════════════════════════════════════════════
//  3. Historical retention — history grows, it is never erased
// ═══════════════════════════════════════════════════════════════

test('RETENTION: August remains available and unchanged after September begins', () => {
  const august = store(messyMonth('emp-1', '2026-08'), 'emp-1', NOW);
  const september = store(cleanMonth('emp-1', '2026-09', 30), 'emp-1', NOW);

  // Deterministic identity: same employee/month → same id, forever.
  assert.equal(attendanceResultId('2026-08', 'emp-1'), august.id);
  assert.notEqual(august.id, september.id);

  // A September regeneration plan never touches the August record.
  const plan = planResultWrites([], [september]);
  assert.deepEqual(plan.created.map((r) => r.id), [september.id]);
  assert.ok(!plan.created.some((r) => r.id === august.id));

  // The history index keeps August retrievable once September exists.
  const index = buildMonthlyHistoryIndex([august, september]);
  const augStillThere = index.get('emp-1')!.get('2026-08')!;
  assert.equal(augStillThere.id, august.id);
  assert.equal(augStillThere.attendanceDeductionDays, august.attendanceDeductionDays);
  assert.equal(augStillThere.compliance, august.compliance);

  // And in the Employee 360 layers, August is historical history.
  const layers = buildEmployeePerformanceLayers({
    records: [august, september],
    currentMonthKey: '2026-09',
    extractValue: (r) => r.compliance,
  });
  assert.deepEqual(layers.history.map((h) => h.month), ['2026-08']);
  assert.equal(layers.history[0].result.compliance, august.compliance);
});

test('RETENTION: a missing current month yields null current — history is NOT promoted into it', () => {
  const august = store(messyMonth('emp-1', '2026-08'), 'emp-1', NOW);
  const layers = buildEmployeePerformanceLayers({
    records: [august],
    currentMonthKey: '2026-09', // September never generated
    extractValue: (r) => r.compliance,
  });
  assert.equal(layers.current, null); // never fabricate September from August
  assert.deepEqual(layers.history.map((h) => h.month), ['2026-08']);
});

// ═══════════════════════════════════════════════════════════════
//  4. Employee 360 semantics — current / history / career layers
// ═══════════════════════════════════════════════════════════════

function employee360Fixture() {
  const compliance = (month: string, value: number): MonthScopedResult & { compliance: number } => ({
    employeeId: 'emp-1',
    month,
    compliance: value,
  });
  return [
    compliance('2026-05', 70),
    compliance('2026-06', 85),
    compliance('2026-07', 92),
    compliance('2026-08', 88),
  ];
}

test('360: current month = the current result; historical month = the historical result', () => {
  const layers = buildEmployeePerformanceLayers({
    records: employee360Fixture(),
    currentMonthKey: '2026-08',
    extractValue: (r) => r.compliance,
  });

  assert.equal(layers.current!.month, '2026-08');
  assert.equal(layers.current!.result.compliance, 88);

  // History is strictly earlier months, most recent first.
  assert.deepEqual(layers.history.map((h) => h.month), ['2026-07', '2026-06', '2026-05']);
  assert.equal(layers.history[0].result.compliance, 92);

  // A selected historical month resolves to exactly that month's result.
  const [june] = selectMonths(layers.history.map((h) => h.result), ['2026-06']);
  assert.equal(june.compliance, 85);
});

test('360: career/trend is derived from MULTIPLE historical results — never a single current score', () => {
  const layers = buildEmployeePerformanceLayers({
    records: employee360Fixture(),
    currentMonthKey: '2026-08',
    extractValue: (r) => r.compliance,
  });
  const career = layers.career;

  assert.equal(career.sampleSize, 4);
  assert.equal(career.firstMonth, '2026-05');
  assert.equal(career.lastMonth, '2026-08');
  assert.equal(career.bestMonth!.month, '2026-07');
  assert.equal(career.bestMonth!.value, 92);
  assert.equal(career.worstMonth!.month, '2026-05');
  assert.equal(career.worstMonth!.value, 70);
  assert.equal(career.averageValue, 84); // (70+85+92+88)/4 = 83.75 → 84

  // Chronological deltas across the available sequence.
  assert.deepEqual(career.monthOverMonthDeltas, [
    { month: '2026-06', delta: 15 },
    { month: '2026-07', delta: 7 },
    { month: '2026-08', delta: -4 },
  ]);

  // No trend direction here by design (§15): direction stays owned by
  // the canonical computeTrend over stored snapshots. The contract
  // only guarantees it can never come from a single score:
  const single = buildEmployeePerformanceLayers({
    records: [{ employeeId: 'emp-1', month: '2026-08', compliance: 88 }],
    currentMonthKey: '2026-08',
    extractValue: (r) => r.compliance,
  });
  assert.equal(single.career.sampleSize, 1);
  assert.deepEqual(single.career.monthOverMonthDeltas, []); // no delta from one value
  assert.equal(single.career.bestMonth!.month, '2026-08');
});

test('360: empty history yields an explicit empty career (no fabricated values)', () => {
  const layers = buildEmployeePerformanceLayers({
    records: [],
    currentMonthKey: '2026-08',
    extractValue: () => 0,
  });
  assert.equal(layers.current, null);
  assert.deepEqual(layers.history, []);
  assert.equal(layers.career.sampleSize, 0);
  assert.equal(layers.career.bestMonth, null);
  assert.equal(layers.career.worstMonth, null);
  assert.equal(layers.career.averageValue, null);
  assert.deepEqual(layers.career.monthOverMonthDeltas, []);
});

test('360: duplicate employee-month records follow regeneration semantics (last wins, no duplicates)', () => {
  const v1 = { employeeId: 'emp-1', month: '2026-08', compliance: 50 };
  const regenerated = { employeeId: 'emp-1', month: '2026-08', compliance: 90 };
  const layers = buildEmployeePerformanceLayers({
    records: [v1, regenerated],
    currentMonthKey: '2026-08',
    extractValue: (r) => r.compliance,
  });
  assert.equal(layers.current!.result.compliance, 90);
  assert.equal(layers.career.sampleSize, 1);
});

test('360: best/worst ties resolve deterministically to the most recent month', () => {
  const career = deriveCareerSummary([
    { month: '2026-05', value: 80, result: { employeeId: 'e', month: '2026-05' } },
    { month: '2026-06', value: 80, result: { employeeId: 'e', month: '2026-06' } },
    { month: '2026-07', value: 80, result: { employeeId: 'e', month: '2026-07' } },
  ]);
  assert.equal(career.bestMonth!.month, '2026-07');
  assert.equal(career.worstMonth!.month, '2026-07');
});

test('360: invalid current month key is a caller bug (throws, strict contract)', () => {
  assert.throws(() =>
    buildEmployeePerformanceLayers({
      records: [],
      currentMonthKey: '2026-8',
      extractValue: () => 0,
    }),
  );
});

// ═══════════════════════════════════════════════════════════════
//  5. Data isolation — employees never share monthly results
// ═══════════════════════════════════════════════════════════════

test('ISOLATION (engine): one employee\'s records never affect another employee\'s month', () => {
  const messy = messyMonth('emp-A', '2026-08');
  const clean = cleanMonth('emp-B', '2026-08', 31);

  assert.equal(messy.employeeId, 'emp-A');
  assert.equal(clean.employeeId, 'emp-B');
  assert.ok(messy.attendanceDeductionDays > 0);
  assert.equal(clean.attendanceDeductionDays, 0);
  // emp-B's clean records did not leak into emp-A's counters and vice versa.
  assert.ok(messy.presentDays < clean.presentDays);

  // Separate deterministic identities per employee.
  assert.notEqual(attendanceResultId('2026-08', 'emp-A'), attendanceResultId('2026-08', 'emp-B'));
});

test('ISOLATION (layers): the history index and 360 layers stay per-employee', () => {
  const aAug = store(messyMonth('emp-A', '2026-08'), 'emp-A', NOW);
  const bAug = store(cleanMonth('emp-B', '2026-08', 31), 'emp-B', NOW);
  const aSep = store(cleanMonth('emp-A', '2026-09', 30), 'emp-A', NOW);

  const index = buildMonthlyHistoryIndex([aAug, bAug, aSep]);
  assert.deepEqual([...index.get('emp-A')!.keys()], ['2026-08', '2026-09']);
  assert.deepEqual([...index.get('emp-B')!.keys()], ['2026-08']);

  // Consumers build layers from ONE employee's records (index lookup).
  const layersA = buildEmployeePerformanceLayers({
    records: [...index.get('emp-A')!.values()],
    currentMonthKey: '2026-09',
    extractValue: (r) => r.compliance,
  });
  assert.equal(layersA.current!.result.employeeId, 'emp-A');
  assert.deepEqual(layersA.history.map((h) => h.result.employeeId), ['emp-A']);
  assert.ok(layersA.career.sampleSize > 0);
  // emp-B's clean August never softened emp-A's career view.
  assert.equal(layersA.history[0].result.compliance, aAug.compliance);
});

test('ISOLATION (write plan): same month, two employees → two independent creates', () => {
  const aAug = store(messyMonth('emp-A', '2026-08'), 'emp-A', NOW);
  const bAug = store(cleanMonth('emp-B', '2026-08', 31), 'emp-B', NOW);
  const plan = planResultWrites([], [aAug, bAug]);
  assert.equal(plan.created.length, 2);
  assert.deepEqual(new Set(plan.created.map((r) => r.employeeId)), new Set(['emp-A', 'emp-B']));
});

// ═══════════════════════════════════════════════════════════════
//  6. Future contracts — constructible in their documented shape
// ═══════════════════════════════════════════════════════════════

test('CONTRACT: MetricResult carries the full interpretation context (§5)', () => {
  const metric: MetricResult = {
    metricId: 'attendance.compliance',
    employeeId: 'emp-1',
    period: '2026-08',
    scope: { kind: 'selected_month', monthKey: '2026-08' },
    value: 89,
    calculationVersion: 'attendance-v1',
    source: 'attendance',
    department: 'مبيعات',
  };
  assert.equal(metric.scope.kind, 'selected_month');
  assert.equal(describeTimeScope(metric.scope), 'selected_month:2026-08');

  // HR stays a distinct, attributable source domain (§18).
  const hrMetric: MetricResult = {
    metricId: 'hr.deductionDays',
    employeeId: 'emp-1',
    period: '2026-08',
    scope: { kind: 'current_month' },
    value: 2,
    calculationVersion: 'hr-v1',
    source: 'hr',
  };
  assert.equal(hrMetric.source, 'hr');
});

test('CONTRACT: MonthlyPerformanceResult reserves the future monthly snapshot shape (§13)', () => {
  const snapshot: MonthlyPerformanceResult = {
    employeeId: 'emp-1',
    month: '2026-08',
    qualityFactor: 92,
    attendanceFactor: 89,
    salesFactor: null,   // future domain
    hrFactor: null,      // separate domain (§18)
    finalScore: null,    // future engine
    weightsSnapshot: { quality: 0.4, attendance: 0.3, sales: 0.2, hr: 0.1 },
    calculationVersion: 'performance-v1',
    generatedAt: '2026-08-31T23:59:59.000Z',
  };
  assert.equal(snapshot.month, '2026-08');
  assert.equal(snapshot.finalScore, null);
});

test('CONTRACT: StoredAttendanceResult structurally satisfies MonthScopedResult (no migration)', () => {
  const stored = store(cleanMonth('emp-1', '2026-09', 30), 'emp-1', NOW);
  const scoped: MonthScopedResult = stored; // structural — no adapter needed
  assert.equal(scoped.month, stored.month);
  assert.equal(scoped.employeeId, stored.employeeId);
});
