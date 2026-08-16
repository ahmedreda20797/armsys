// ══════════════════════════════════════════════════════════════
//  KPI Dashboard business semantics — focused correction tests
//
//  Exercises the REAL canonical chain:
//    observations → computeMonthSnapshot (engine) → buildDashboardResponse
//
//  Covers the reported real-usage issues:
//    • "الموظفون المشمولون" = UNIQUE employees with ≥1 observation in
//      the selected scope (never observation count, never the employee
//      collection), filter- and range-aware
//    • "يحتاجون تحسيناً" = employees strictly below the canonical
//      baseline (settings.defaultScore) — a valid 100 score is NEVER
//      "needs improvement"; lists are disjoint from Top
//    • KPI value semantics: pending/rejected zero score impact,
//      normal observations never inflate pending approvals
//    • Scope consistency: filters apply to every widget together
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthSnapshot } from '@/lib/metrics/kpiMetrics';
import type { EmployeeLike, ObservationLike } from '@/lib/metrics/kpiMetrics';
import { buildDashboardResponse } from '@/lib/kpi-dashboard';
import type { CollectedMonth } from '@/lib/kpi-dashboard';
import type { KpiSettings, MonthSnapshot } from '@/types/quality-kpi';

// ─── Fixtures ─────────────────────────────────────────────────

const SETTINGS: KpiSettings = {
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
  updatedAt: new Date('2026-08-01T10:00:00.000Z').toISOString(),
} as unknown as KpiSettings;

let obsSeq = 0;
function obs(
  employeeId: string,
  overrides: Partial<ObservationLike> = {},
): ObservationLike {
  obsSeq++;
  return {
    id: `o${obsSeq}`,
    employeeId,
    month: '2026-08',
    applyPointDeduction: true,
    points: 5,
    isBonus: false,
    approvalStatus: 'approved',
    categoryId: 'cat1',
    categoryWeight: 1,
    status: 'open',
    ...overrides,
  };
}

function employees(...list: Array<[string, string]>): Map<string, EmployeeLike> {
  const m = new Map<string, EmployeeLike>();
  for (const [id, dept] of list) {
    m.set(id, { id, name: `موظف ${id}`, department: dept, position: 'موظف' });
  }
  return m;
}

/** Compute a month snapshot via the canonical engine (live-preview shape). */
function monthSnapshot(
  monthKey: string,
  observations: ObservationLike[],
  emps: Map<string, EmployeeLike>,
): MonthSnapshot {
  const withMonth = observations.map((o) => ({ ...o, month: monthKey }));
  const computed = computeMonthSnapshot(withMonth, monthKey, emps, new Map(), SETTINGS);
  return { ...computed, id: monthKey, status: 'open' } as MonthSnapshot;
}

function dashboard(
  collected: CollectedMonth[],
  filters?: { department?: string | null; employeeId?: string | null },
) {
  return buildDashboardResponse({
    range: 'current_month',
    months: collected.map((c) => c.monthKey),
    collected,
    settings: SETTINGS,
    filters,
  });
}

function liveMonth(snapshot: MonthSnapshot, monthKey: string): CollectedMonth {
  return { monthKey, snapshot, isLive: true };
}

// ══════════════════════════════════════════════════════════════
//  Employees Covered — unique employeeId with ≥1 observation in scope
// ══════════════════════════════════════════════════════════════

test('Employees covered — Example A: 2 observations / 2 employees → 2', () => {
  const snap = monthSnapshot('2026-08', [obs('empA'), obs('empB')], employees(['empA', 'مبيعات'], ['empB', 'عمليات']));
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.totalEmployees, 2);
});

test('Employees covered — Example B: 2 observations / 1 employee → 1', () => {
  const snap = monthSnapshot('2026-08', [obs('empA'), obs('empA')], employees(['empA', 'مبيعات']));
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.totalEmployees, 1, 'multiple observations of one employee count once');
});

test('Employees covered — Example C: 10 observations / 3 employees → 3', () => {
  const obsList = [
    ...Array.from({ length: 4 }, () => obs('empA')),
    ...Array.from({ length: 3 }, () => obs('empB')),
    ...Array.from({ length: 3 }, () => obs('empC')),
  ];
  const snap = monthSnapshot('2026-08', obsList, employees(['empA', 'مبيعات'], ['empB', 'مبيعات'], ['empC', 'عمليات']));
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.totalEmployees, 3, 'never observations.length (10)');
});

test('Employees covered — department filter counts only that department with observations', () => {
  // 20 employees in عمليات but only 4 with observations; مبيعات has 1.
  const opsEmps = Array.from({ length: 20 }, (_, i) => [`ops${i}`, 'عمليات'] as [string, string]);
  const emps = employees(['sale1', 'مبيعات'], ...opsEmps);
  const obsList = [
    obs('sale1'),
    ...['ops0', 'ops5', 'ops10', 'ops15'].map((id) => obs(id)),
  ];
  const snap = monthSnapshot('2026-08', obsList, emps);
  const res = dashboard([liveMonth(snap, '2026-08')], { department: 'عمليات' });
  assert.equal(res.totalEmployees, 4, '4 of 20 department employees actually have observations');
});

test('Employees covered — employee filter → 1 when present, 0 when absent in scope', () => {
  const snap = monthSnapshot('2026-08', [obs('empA'), obs('empB')], employees(['empA', 'مبيعات'], ['empB', 'عمليات']));
  const one = dashboard([liveMonth(snap, '2026-08')], { employeeId: 'empA' });
  assert.equal(one.totalEmployees, 1);
  // empC exists in the company but has no observations in scope.
  const none = dashboard([liveMonth(snap, '2026-08')], { employeeId: 'empC' });
  assert.equal(none.totalEmployees, 0);
});

test('Employees covered — range scope: unique employees across the selected months', () => {
  const emps = employees(['empA', 'مبيعات'], ['empB', 'عمليات'], ['empC', 'عمليات']);
  const jul = monthSnapshot('2026-07', [obs('empA'), obs('empC')], emps); // empA + empC
  const aug = monthSnapshot('2026-08', [obs('empA'), obs('empB')], emps); // empA + empB

  const single = dashboard([liveMonth(aug, '2026-08')]);
  assert.equal(single.totalEmployees, 2, 'current month only → empA + empB (empC out of scope)');

  const twoMonths = dashboard([liveMonth(aug, '2026-08'), { monthKey: '2026-07', snapshot: jul, isLive: false }]);
  assert.equal(twoMonths.totalEmployees, 3, 'range adds empC; empA counted once across months');
});

test('Employees covered — no observations in scope → 0 and canonical empty state', () => {
  const empty = monthSnapshot('2026-08', [], employees(['empA', 'مبيعات']));
  const res = dashboard([liveMonth(empty, '2026-08')]);
  assert.equal(res.totalEmployees, 0);
  assert.equal(res.avgScore, 0, 'no fabricated average');
  assert.equal(res.totalDeductions, 0);
  assert.equal(res.totalBonuses, 0);
  assert.equal(res.pendingApprovals, 0);
  assert.deepEqual(res.topEmployees, []);
  assert.deepEqual(res.needsImprovement, []);
  assert.deepEqual(res.departmentRanking, []);
});

// ══════════════════════════════════════════════════════════════
//  Top / Needs Improvement — canonical baseline rule
// ══════════════════════════════════════════════════════════════

test('Needs improvement — a valid score of 100 is NEVER needs improvement (screenshot bug)', () => {
  // One employee, observations exist, no effective deductions → score 100.
  const snap = monthSnapshot(
    '2026-08',
    [obs('empA', { applyPointDeduction: false, points: 0 })],
    employees(['empA', 'مبيعات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.totalEmployees, 1);
  assert.equal(res.avgScore, 100, 'no deductions → valid score of 100, not an error');
  assert.equal(res.topEmployees.length, 1, 'the 100-score employee IS the top performer');
  assert.equal(res.topEmployees[0].employeeId, 'empA');
  assert.equal(res.topEmployees[0].score, 100);
  assert.deepEqual(res.needsImprovement, [], 'must be EMPTY — perfect score is not needs improvement');
});

test('Needs improvement — employees below the baseline appear, worst first', () => {
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('good'),
      obs('mid', { points: 10 }),
      obs('bad', { points: 40 }),
    ],
    employees(['good', 'مبيعات'], ['mid', 'مبيعات'], ['bad', 'عمليات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.deepEqual(res.needsImprovement.map((e) => e.employeeId), ['bad', 'mid', 'good']);
  assert.equal(res.needsImprovement[0].score, 60);
  assert.equal(res.needsImprovement[1].score, 90);
  assert.equal(res.needsImprovement[2].score, 95);
});

test('Needs improvement — threshold is the canonical defaultScore, not an invented number', () => {
  // An approved bonus offsets a deduction back to the baseline → NOT
  // needs improvement (score 100 = defaultScore).
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('empA', { points: 10, isBonus: false }),
      obs('empA', { points: 10, isBonus: true }),
    ],
    employees(['empA', 'مبيعات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.topEmployees[0]?.employeeId, 'empA');
  assert.deepEqual(res.needsImprovement, [], 'score back at baseline → not flagged');
});

test('Top / Needs improvement — same employee never appears in both lists', () => {
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('a100', { applyPointDeduction: false, points: 0 }),
      obs('b95', { points: 5 }),
      obs('c70', { points: 30 }),
    ],
    employees(['a100', 'مبيعات'], ['b95', 'مبيعات'], ['c70', 'عمليات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  const topIds = new Set(res.topEmployees.map((e) => e.employeeId));
  assert.equal(res.needsImprovement.some((e) => topIds.has(e.employeeId)), false);
  assert.deepEqual(topIds, new Set(['a100']));
});

test('Top / Needs improvement — pending and rejected observations do not demote a score', () => {
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('empA', { applyPointDeduction: false, points: 0 }),
      obs('empA', { approvalStatus: 'pending', points: 30 }),
      obs('empA', { approvalStatus: 'rejected', points: 50 }),
    ],
    employees(['empA', 'مبيعات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.topEmployees[0]?.score, 100, 'pending/rejected have zero score impact');
  assert.deepEqual(res.needsImprovement, []);
});

// ══════════════════════════════════════════════════════════════
//  KPI value semantics
// ══════════════════════════════════════════════════════════════

test('Pending approvals — normal observations (applyPointDeduction=false) never count', () => {
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('empA', { applyPointDeduction: false, points: 0, approvalStatus: 'pending' }),
      obs('empA', { applyPointDeduction: false, points: 0, approvalStatus: 'pending' }),
      obs('empA', { approvalStatus: 'pending', points: 5 }),
    ],
    employees(['empA', 'مبيعات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.pendingApprovals, 1, 'only the point-applying pending observation');
  assert.equal(res.approvalStats.pending, 1);
});

test('Total deductions — approved points only', () => {
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('empA', { points: 10 }),
      obs('empA', { approvalStatus: 'pending', points: 20 }),
      obs('empA', { approvalStatus: 'rejected', points: 30 }),
      obs('empA', { points: 5, isBonus: true }),
    ],
    employees(['empA', 'مبيعات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.totalDeductions, 10, 'pending/rejected/bonus excluded');
});

test('Total bonuses — approved effective bonus points (cap respected by engine)', () => {
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('empA', { points: 15, isBonus: true }),
      obs('empA', { points: 20, isBonus: true, approvalStatus: 'pending' }),
    ],
    employees(['empA', 'مبيعات']),
  );
  const res = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(res.totalBonuses, 15, 'pending bonus excluded');
  // Cap: two approved bonuses of 15 + 15 = 30 raw → engine caps at 20.
  // Score = 100 − 0 + 20 = 120 → still at/above the baseline, never flagged.
  const capped = monthSnapshot(
    '2026-08',
    [obs('empA', { points: 15, isBonus: true }), obs('empA', { points: 15, isBonus: true })],
    employees(['empA', 'مبيعات']),
  );
  const res2 = dashboard([liveMonth(capped, '2026-08')]);
  assert.equal(res2.avgScore, 120, 'capped bonus lifts above the baseline');
  assert.equal(res2.needsImprovement.length, 0, 'score ≥ baseline → not flagged');
});

// ══════════════════════════════════════════════════════════════
//  Scope consistency — one scope for every widget
// ══════════════════════════════════════════════════════════════

test('Scope consistency — department filter changes every widget together', () => {
  const emps = employees(['sale1', 'مبيعات'], ['sale2', 'مبيعات'], ['ops1', 'عمليات']);
  const snap = monthSnapshot(
    '2026-08',
    [
      obs('sale1', { applyPointDeduction: false, points: 0 }),
      obs('sale2', { points: 10 }),
      obs('ops1', { points: 25 }),
    ],
    emps,
  );
  const all = dashboard([liveMonth(snap, '2026-08')]);
  assert.equal(all.totalEmployees, 3);
  assert.equal(all.totalDeductions, 35);
  assert.equal(all.departmentRanking.length, 2);

  const opsOnly = dashboard([liveMonth(snap, '2026-08')], { department: 'عمليات' });
  assert.equal(opsOnly.totalEmployees, 1, 'covered employees scoped');
  assert.equal(opsOnly.totalDeductions, 25, 'deductions scoped');
  assert.equal(opsOnly.pendingApprovals, 0, 'approvals scoped');
  assert.equal(opsOnly.departmentRanking.length, 1, 'department ranking scoped');
  assert.equal(opsOnly.departmentRanking[0].department, 'عمليات');
  assert.equal(opsOnly.topEmployees.length + opsOnly.needsImprovement.length, 1,
    'leaderboard scoped');
});

test('Scope consistency — range filter changes every widget together', () => {
  const emps = employees(['empA', 'مبيعات'], ['empB', 'عمليات']);
  const jul = monthSnapshot('2026-07', [obs('empA', { points: 10 })], emps);
  const aug = monthSnapshot(
    '2026-08',
    [
      obs('empA', { applyPointDeduction: false, points: 0 }), // score 100, no deduction
      obs('empB', { points: 20 }), // score 80
    ],
    emps,
  );

  const augOnly = dashboard([liveMonth(aug, '2026-08')]);
  assert.equal(augOnly.totalEmployees, 2);
  assert.equal(augOnly.totalDeductions, 20);
  assert.equal(augOnly.months.length, 1);

  const both = dashboard([liveMonth(aug, '2026-08'), { monthKey: '2026-07', snapshot: jul, isLive: false }]);
  assert.equal(both.months.length, 2, 'range scope includes both months');
  assert.equal(both.totalEmployees, 2, 'empA in both months counted once');
  assert.equal(both.totalDeductions, 30, '10 (Jul) + 20 (Aug)');
  // Employee-month entries of the SAME scope: Jul empA = 90, Aug empA = 100,
  // Aug empB = 80 → avg = round(270 / 3) = 90.
  assert.equal(both.avgScore, 90, 'avg over employee-month entries of the same scope');
});
