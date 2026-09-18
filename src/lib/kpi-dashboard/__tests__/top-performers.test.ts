// ══════════════════════════════════════════════════════════════
//  §TOP-PERFORMERS — deterministic eligibility (milestone §12)
//
//  Business rule under test: an employee with ZERO quality
//  observations has NO scored evidence — their default score is the
//  ABSENCE of data, not excellence — so they are NEVER ranked as a
//  top performer. Ranking requires score ≥ baseline AND
//  observationCount ≥ 1. Ties break by employeeId (deterministic).
//  Employees with insufficient evidence must not appear; when no one
//  qualifies the top list is honestly empty.
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardResponse } from '@/lib/kpi-dashboard';
import type { CollectedMonth } from '@/lib/kpi-dashboard';
import type { KpiSettings, MonthSnapshot, EmployeeScoreEntry } from '@/types/quality-kpi';

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

function entry(employeeId: string, overrides: Partial<EmployeeScoreEntry> = {}): EmployeeScoreEntry {
  return {
    employeeSnapshot: {
      employeeId,
      employeeName: `موظف ${employeeId}`,
      departmentId: 'مبيعات',
      departmentName: 'مبيعات',
      position: 'موظف',
      supervisorId: null,
    },
    score: 100,
    deductionPoints: 0,
    bonusPoints: 0,
    weightedPoints: 0,
    observationCount: 0,
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    categoryTotals: {},
    rank: 0,
    dept: 'مبيعات',
    ...overrides,
  };
}

function snapshot(entries: EmployeeScoreEntry[], monthKey = '2026-08'): MonthSnapshot {
  return {
    id: monthKey,
    monthKey,
    status: 'open',
    employeeScores: Object.fromEntries(entries.map((e) => [e.employeeSnapshot.employeeId, e])),
    departmentScores: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
    categoryTotals: {},
    generatedAt: new Date('2026-08-01T00:00:00Z').toISOString(),
  } as unknown as MonthSnapshot;
}

function dashboard(entries: EmployeeScoreEntry[]) {
  const snap = snapshot(entries);
  const collected: CollectedMonth[] = [{ monthKey: '2026-08', snapshot: snap, isLive: true }];
  return buildDashboardResponse({
    range: 'current_month',
    months: ['2026-08'],
    collected,
    settings: SETTINGS,
  });
}

test('zero observations does NOT equal automatic 100% — no-evidence entries never rank as top performers', () => {
  const res = dashboard([
    // Two no-evidence employees at the default score (the misleading
    // "zero observations = 100%" case) and one WITH evidence at the
    // same score (bonus-only observations keep a 100).
    entry('empNoData1'),
    entry('empNoData2'),
    entry('empWithEvidence', { observationCount: 2, score: 100, bonusPoints: 0 }),
  ]);
  const topIds = res.topEmployees.map((e) => e.employeeId);
  assert.ok(!topIds.includes('empNoData1'), 'no-evidence employee excluded from top ranking');
  assert.ok(!topIds.includes('empNoData2'), 'no-evidence employee excluded from top ranking');
  assert.deepEqual(topIds, ['empWithEvidence'], 'only evidenced employees rank');
});

test('evidenced employees rank deterministically — score first, employeeId breaks ties', () => {
  const res = dashboard([
    entry('empB', { observationCount: 2, score: 100, deductionPoints: 10, bonusPoints: 10 }),
    entry('empA', { observationCount: 1, score: 105, deductionPoints: 5, bonusPoints: 10 }),
    entry('empC', { observationCount: 1, score: 100, deductionPoints: 10, bonusPoints: 10 }),
  ]);
  assert.deepEqual(
    res.topEmployees.map((e) => e.employeeId),
    ['empA', 'empB', 'empC'], // 105 first, then the 100-tie broken by id asc
  );
});

test('no eligible employees → honest empty top list (no manufactured ranking)', () => {
  const res = dashboard([entry('empNoData1'), entry('empNoData2')]);
  assert.deepEqual(res.topEmployees, []);
});

test('needs-improvement classification is unchanged — deductions ARE evidence', () => {
  const res = dashboard([
    entry('empLow', { observationCount: 4, score: 80, deductionPoints: 20 }),
  ]);
  assert.deepEqual(res.topEmployees, [], 'below-baseline employee is not a top performer');
  assert.equal(res.needsImprovement.length, 1);
  assert.equal(res.needsImprovement[0].employeeId, 'empLow');
});
