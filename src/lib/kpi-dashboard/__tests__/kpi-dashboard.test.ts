// ══════════════════════════════════════════════════════════════
//  Milestone 6A — KPI Dashboard business-logic tests
//
//  Tests the PURE assembly function (buildDashboardResponse) and the
//  range resolver (resolveDashboardMonths). No Firebase mocking required.
//
//  Run: npx tsx --test src/lib/kpi-dashboard/__tests__/kpi-dashboard.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDashboardResponse,
  resolveDashboardMonths,
} from '@/lib/kpi-dashboard';
import type {
  KpiSettings,
  MonthSnapshot,
  KpiRangePreset,
} from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-01T10:00:00.000Z');

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
  updatedAt: NOW.toISOString(),
};

/** Build a minimal closed month snapshot for testing. */
function makeSnapshot(
  monthKey: string,
  overrides: Partial<MonthSnapshot> = {},
): MonthSnapshot {
  return {
    id: monthKey,
    schemaVersion: 1,
    monthKey,
    status: 'closed',
    closedAt: NOW.toISOString(),
    closedBy: 'admin1',
    closedByName: 'المسؤول',
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: NOW.toISOString(),
    settingsSnapshot: SETTINGS,
    employeeScores: {},
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
    ...overrides,
  };
}

/** Build a snapshot with one scored employee. */
function snapshotWithEmployee(
  monthKey: string,
  employeeId: string,
  employeeName: string,
  department: string,
  score: number,
  deductionPoints: number,
  bonusPoints: number,
): MonthSnapshot {
  return makeSnapshot(monthKey, {
    employeeScores: {
      [employeeId]: {
        employeeSnapshot: {
          employeeId,
          employeeName,
          departmentId: department,
          departmentName: department,
          position: 'موظف',
          supervisorId: null,
        },
        score,
        deductionPoints,
        bonusPoints,
        weightedPoints: 0,
        observationCount: 1,
        approvedCount: 1,
        pendingCount: 0,
        rejectedCount: 0,
        categoryTotals: { cat1: deductionPoints },
        rank: 1,
        dept: department,
      },
    },
    departmentScores: {
      [department]: {
        avgScore: score,
        totalEmployees: 1,
        totalDeductionPoints: deductionPoints,
        totalBonusPoints: bonusPoints,
        totalObservations: 1,
      },
    },
    categoryTotals: { cat1: deductionPoints },
    approvalStats: { total: 1, pending: 0, approved: 1, rejected: 0, avgApprovalHours: 0 },
  });
}

// ══════════════════════════════════════════════════════════════
//  Range resolution
// ══════════════════════════════════════════════════════════════

describe('Dashboard — range resolution', () => {
  it('resolves current_month to a single month key', () => {
    const result = resolveDashboardMonths('current_month');
    assert.ok(result.error === null);
    assert.equal(result.monthKeys.length, 1);
    assert.ok(/^\d{4}-\d{2}$/.test(result.monthKeys[0]));
  });

  it('resolves previous_month to a single month key', () => {
    const result = resolveDashboardMonths('previous_month');
    assert.ok(result.error === null);
    assert.equal(result.monthKeys.length, 1);
  });

  it('resolves last_3_months to three month keys', () => {
    const result = resolveDashboardMonths('last_3_months');
    assert.ok(result.error === null);
    assert.equal(result.monthKeys.length, 3);
  });

  it('resolves last_6_months to six month keys', () => {
    const result = resolveDashboardMonths('last_6_months');
    assert.ok(result.error === null);
    assert.equal(result.monthKeys.length, 6);
  });

  it('resolves current_year to the correct number of months', () => {
    const result = resolveDashboardMonths('current_year');
    assert.ok(result.error === null);
    const currentMonth = new Date().getMonth() + 1;
    assert.equal(result.monthKeys.length, currentMonth);
  });

  it('rejects an unsupported range', () => {
    const result = resolveDashboardMonths('all_time');
    assert.ok(result.error !== null);
    assert.equal(result.monthKeys.length, 0);
  });

  it('resolves custom range from comma-separated YYYY-MM', () => {
    const result = resolveDashboardMonths('custom', '2026-07,2026-06');
    assert.ok(result.error === null);
    assert.deepEqual(result.monthKeys, ['2026-07', '2026-06']);
  });

  it('custom range with no customMonths returns error', () => {
    const result = resolveDashboardMonths('custom', null);
    assert.ok(result.error !== null);
  });

  it('custom range filters invalid keys', () => {
    const result = resolveDashboardMonths('custom', '2026-07,invalid,2026-05');
    assert.ok(result.error === null);
    assert.deepEqual(result.monthKeys, ['2026-07', '2026-05']);
  });
});

// ══════════════════════════════════════════════════════════════
//  buildDashboardResponse — core assembly
// ══════════════════════════════════════════════════════════════

describe('Dashboard — buildDashboardResponse assembly', () => {
  it('returns zeros/empty for no collected months', () => {
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [],
      settings: SETTINGS,
    });
    assert.equal(response.avgScore, 0);
    assert.equal(response.totalEmployees, 0);
    assert.equal(response.isLive, false);
    assert.deepEqual(response.topEmployees, []);
    assert.deepEqual(response.bottomEmployees, []);
    assert.deepEqual(response.departmentRanking, []);
    assert.deepEqual(response.monthlyScores, []);
    assert.deepEqual(response.categoryDistribution, {});
    assert.equal(response.approvalStats.total, 0);
    assert.equal(response.approvalStats.pending, 0);
    assert.equal(response.pendingApprovals, 0);
    assert.equal(response.trend.direction, 'stable');
    assert.equal(response.trend.sampleSize, 0);
  });

  it('isLive is true when any collected month is live', () => {
    const snap = snapshotWithEmployee('2026-08', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: true }],
      settings: SETTINGS,
    });
    assert.equal(response.isLive, true);
  });

  it('isLive is false when all months are frozen', () => {
    const snap = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const response = buildDashboardResponse({
      range: 'previous_month',
      months: ['2026-07'],
      collected: [{ monthKey: '2026-07', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.isLive, false);
  });

  it('avgScore is computed from real snapshot employee scores', () => {
    const snap = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const response = buildDashboardResponse({
      range: 'previous_month',
      months: ['2026-07'],
      collected: [{ monthKey: '2026-07', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.avgScore, 90);
    assert.equal(response.totalDeductions, 10);
  });

  it('multiple-month aggregation averages across months', () => {
    const snap1 = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const snap2 = snapshotWithEmployee('2026-08', 'e1', 'أحمد', 'مبيعات', 80, 20, 0);
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-08', '2026-07'],
      collected: [
        { monthKey: '2026-08', snapshot: snap2, isLive: false },
        { monthKey: '2026-07', snapshot: snap1, isLive: false },
      ],
      settings: SETTINGS,
    });
    // Two score samples: 90 + 80 = 170, avg = 85
    assert.equal(response.avgScore, 85);
    assert.equal(response.totalDeductions, 30);
  });

  it('closed month reads frozen snapshot (identity preserved)', () => {
    const snap = snapshotWithEmployee('2026-07', 'e1', 'أحمد القديم', 'مبيعات', 90, 10, 0);
    const response = buildDashboardResponse({
      range: 'previous_month',
      months: ['2026-07'],
      collected: [{ monthKey: '2026-07', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    // Employee identity comes from the frozen snapshot, not current data.
    // (Score 90 is below the defaultScore baseline of 100 → the employee
    // is listed under needsImprovement, not topEmployees.)
    assert.equal(response.needsImprovement[0].employeeName, 'أحمد القديم');
    assert.equal(response.needsImprovement[0].department, 'مبيعات');
  });

  it('current open month uses live data (from the computed snapshot)', () => {
    const liveSnap = snapshotWithEmployee('2026-08', 'e1', 'أحمد', 'مبيعات', 85, 15, 0);
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: liveSnap, isLive: true }],
      settings: SETTINGS,
    });
    assert.equal(response.isLive, true);
    assert.equal(response.avgScore, 85);
    assert.equal(response.totalDeductions, 15);
  });

  it('trend uses stored snapshots only (excludes live)', () => {
    const frozen = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const live = snapshotWithEmployee('2026-08', 'e1', 'أحمد', 'مبيعات', 95, 5, 0);
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-08', '2026-07'],
      collected: [
        { monthKey: '2026-08', snapshot: live, isLive: true },
        { monthKey: '2026-07', snapshot: frozen, isLive: false },
      ],
      settings: SETTINGS,
    });
    // Trend is based on stored only (2026-07 = 90, single sample).
    // With a single stored snapshot, momDelta = 0 and direction = stable.
    assert.equal(response.trend.sampleSize, 1);
    assert.equal(response.trend.direction, 'stable');
  });
});

// ══════════════════════════════════════════════════════════════
//  Department ranking
// ══════════════════════════════════════════════════════════════

describe('Dashboard — department ranking', () => {
  it('department ranking uses actual values from snapshots', () => {
    const snap = makeSnapshot('2026-08', {
      departmentScores: {
        مبيعات: { avgScore: 85, totalEmployees: 10, totalDeductionPoints: 50, totalBonusPoints: 5, totalObservations: 30 },
        عمليات: { avgScore: 92, totalEmployees: 5, totalDeductionPoints: 20, totalBonusPoints: 10, totalObservations: 15 },
      },
    });
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.departmentRanking.length, 2);
    // Ranked by avgScore desc: عمليات (92) > مبيعات (85)
    assert.equal(response.departmentRanking[0].department, 'عمليات');
    assert.equal(response.departmentRanking[0].averageScore, 92);
    assert.equal(response.departmentRanking[0].totalDeductionPoints, 20);
    assert.equal(response.departmentRanking[1].department, 'مبيعات');
    assert.equal(response.departmentRanking[1].averageScore, 85);
    assert.equal(response.departmentRanking[1].totalDeductionPoints, 50);
  });

  it('department ranking is empty when no data', () => {
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [],
      settings: SETTINGS,
    });
    assert.deepEqual(response.departmentRanking, []);
  });

  it('does not hardcode department names', () => {
    const snap = makeSnapshot('2026-08', {
      departmentScores: {
        'قسم خاص': { avgScore: 80, totalEmployees: 1, totalDeductionPoints: 5, totalBonusPoints: 0, totalObservations: 2 },
      },
    });
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.departmentRanking.length, 1);
    assert.equal(response.departmentRanking[0].department, 'قسم خاص');
  });
});

// ══════════════════════════════════════════════════════════════
//  Employee leaderboard
// ══════════════════════════════════════════════════════════════

describe('Dashboard — employee leaderboard', () => {
  it('top / needs-improvement / bottom ranking uses actual scores (disjoint)', () => {
    const snap = makeSnapshot('2026-08', {
      employeeScores: {
        e1: {
          employeeSnapshot: {
            employeeId: 'e1', employeeName: 'أحمد', departmentId: 'مبيعات',
            departmentName: 'مبيعات', position: 'مدير', supervisorId: null,
          },
          score: 95, deductionPoints: 5, bonusPoints: 0, weightedPoints: 0,
          observationCount: 1, approvedCount: 1, pendingCount: 0, rejectedCount: 0,
          categoryTotals: {}, rank: 2, dept: 'مبيعات',
        },
        e2: {
          employeeSnapshot: {
            employeeId: 'e2', employeeName: 'سارة', departmentId: 'عمليات',
            departmentName: 'عمليات', position: 'موظف', supervisorId: null,
          },
          score: 70, deductionPoints: 30, bonusPoints: 0, weightedPoints: 0,
          observationCount: 3, approvedCount: 3, pendingCount: 0, rejectedCount: 0,
          categoryTotals: {}, rank: 3, dept: 'عمليات',
        },
        e3: {
          employeeSnapshot: {
            employeeId: 'e3', employeeName: 'ليلى', departmentId: 'مبيعات',
            departmentName: 'مبيعات', position: 'موظف', supervisorId: null,
          },
          score: 100, deductionPoints: 0, bonusPoints: 0, weightedPoints: 0,
          observationCount: 2, approvedCount: 0, pendingCount: 2, rejectedCount: 0,
          categoryTotals: {}, rank: 1, dept: 'مبيعات',
        },
      },
    });
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });

    // Top = ONLY employees who reached the defaultScore baseline (100).
    assert.equal(response.topEmployees.length, 1);
    assert.equal(response.topEmployees[0].employeeId, 'e3');
    assert.equal(response.topEmployees[0].score, 100);

    // Needs improvement = below the baseline, worst score first.
    assert.equal(response.needsImprovement.length, 2);
    assert.equal(response.needsImprovement[0].employeeId, 'e2');
    assert.equal(response.needsImprovement[0].score, 70);
    assert.equal(response.needsImprovement[1].employeeId, 'e1');
    assert.equal(response.needsImprovement[1].score, 95);

    // The two lists are disjoint — no employee appears in both.
    const topIds = new Set(response.topEmployees.map((e) => e.employeeId));
    assert.equal(response.needsImprovement.some((e) => topIds.has(e.employeeId)), false);

    // Bottom = pure lowest-score ranking (all ≤10 employees, worst first).
    assert.equal(response.bottomEmployees.length, 3);
    assert.equal(response.bottomEmployees[0].employeeId, 'e2');
    assert.equal(response.bottomEmployees[0].score, 70);
  });

  it('leaderboard includes deductionPoints and bonusPoints', () => {
    const snap = makeSnapshot('2026-08', {
      employeeScores: {
        e1: {
          employeeSnapshot: {
            employeeId: 'e1', employeeName: 'أحمد', departmentId: 'مبيعات',
            departmentName: 'مبيعات', position: 'موظف', supervisorId: null,
          },
          score: 110, deductionPoints: 5, bonusPoints: 15, weightedPoints: 0,
          observationCount: 2, approvedCount: 2, pendingCount: 0, rejectedCount: 0,
          categoryTotals: {}, rank: 1, dept: 'مبيعات',
        },
      },
    });
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.topEmployees[0].deductionPoints, 5);
    assert.equal(response.topEmployees[0].bonusPoints, 15);
    assert.equal(response.topEmployees[0].position, 'موظف');
  });

  it('multi-month leaderboard averages scores across months', () => {
    const snap1 = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 80, 20, 0);
    const snap2 = snapshotWithEmployee('2026-08', 'e1', 'أحمد', 'مبيعات', 100, 0, 0);
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-08', '2026-07'],
      collected: [
        { monthKey: '2026-08', snapshot: snap2, isLive: false },
        { monthKey: '2026-07', snapshot: snap1, isLive: false },
      ],
      settings: SETTINGS,
    });
    // Averaged score 90 is below the 100 baseline → the employee is
    // listed under needsImprovement; deductions sum across months.
    assert.equal(response.needsImprovement[0].score, 90, 'avg of 80 + 100 = 90');
    assert.equal(response.needsImprovement[0].deductionPoints, 20, 'sum across months');
  });
});

// ══════════════════════════════════════════════════════════════
//  Pending approvals
// ══════════════════════════════════════════════════════════════

describe('Dashboard — pending approvals', () => {
  it('counts pending from snapshot approvalStats', () => {
    const snap = makeSnapshot('2026-08', {
      approvalStats: { total: 10, pending: 3, approved: 5, rejected: 2, avgApprovalHours: 4 },
    });
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.pendingApprovals, 3);
  });

  it('no pending approvals when approvalStats.pending is 0', () => {
    const snap = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const response = buildDashboardResponse({
      range: 'previous_month',
      months: ['2026-07'],
      collected: [{ monthKey: '2026-07', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.pendingApprovals, 0);
  });
});

// ══════════════════════════════════════════════════════════════
//  Approval statistics
// ══════════════════════════════════════════════════════════════

describe('Dashboard — approval statistics', () => {
  it('aggregates approvalStats across months', () => {
    const snap1 = makeSnapshot('2026-07', {
      approvalStats: { total: 5, pending: 1, approved: 3, rejected: 1, avgApprovalHours: 2 },
    });
    const snap2 = makeSnapshot('2026-08', {
      approvalStats: { total: 8, pending: 2, approved: 4, rejected: 2, avgApprovalHours: 3 },
    });
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-08', '2026-07'],
      collected: [
        { monthKey: '2026-08', snapshot: snap2, isLive: false },
        { monthKey: '2026-07', snapshot: snap1, isLive: false },
      ],
      settings: SETTINGS,
    });
    assert.equal(response.approvalStats.total, 13);
    assert.equal(response.approvalStats.pending, 3);
    assert.equal(response.approvalStats.approved, 7);
    assert.equal(response.approvalStats.rejected, 3);
  });
});

// ══════════════════════════════════════════════════════════════
//  Category distribution
// ══════════════════════════════════════════════════════════════

describe('Dashboard — category distribution', () => {
  it('categoryDistribution uses categoryId as keys (canonical identity)', () => {
    // aggregateSnapshots reads categoryTotals from per-employee entries.
    const snap = makeSnapshot('2026-08', {
      employeeScores: {
        e1: {
          employeeSnapshot: {
            employeeId: 'e1', employeeName: 'أحمد', departmentId: 'مبيعات',
            departmentName: 'مبيعات', position: 'موظف', supervisorId: null,
          },
          score: 70, deductionPoints: 45, bonusPoints: 0, weightedPoints: 0,
          observationCount: 2, approvedCount: 2, pendingCount: 0, rejectedCount: 0,
          categoryTotals: { cat_late: 30, cat_quality: 15 },
          rank: 1, dept: 'مبيعات',
        },
      },
    });
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [{ monthKey: '2026-08', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.categoryDistribution['cat_late'], 30);
    assert.equal(response.categoryDistribution['cat_quality'], 15);
  });

  it('categoryDistribution accumulates across months', () => {
    // Per-employee categoryTotals accumulate across months.
    const snap1 = makeSnapshot('2026-07', {
      employeeScores: {
        e1: {
          employeeSnapshot: {
            employeeId: 'e1', employeeName: 'أحمد', departmentId: 'مبيعات',
            departmentName: 'مبيعات', position: 'موظف', supervisorId: null,
          },
          score: 90, deductionPoints: 10, bonusPoints: 0, weightedPoints: 0,
          observationCount: 1, approvedCount: 1, pendingCount: 0, rejectedCount: 0,
          categoryTotals: { cat_late: 10 },
          rank: 1, dept: 'مبيعات',
        },
      },
    });
    const snap2 = makeSnapshot('2026-08', {
      employeeScores: {
        e1: {
          employeeSnapshot: {
            employeeId: 'e1', employeeName: 'أحمد', departmentId: 'مبيعات',
            departmentName: 'مبيعات', position: 'موظف', supervisorId: null,
          },
          score: 85, deductionPoints: 25, bonusPoints: 0, weightedPoints: 0,
          observationCount: 2, approvedCount: 2, pendingCount: 0, rejectedCount: 0,
          categoryTotals: { cat_late: 20, cat_quality: 5 },
          rank: 1, dept: 'مبيعات',
        },
      },
    });
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-08', '2026-07'],
      collected: [
        { monthKey: '2026-08', snapshot: snap2, isLive: false },
        { monthKey: '2026-07', snapshot: snap1, isLive: false },
      ],
      settings: SETTINGS,
    });
    assert.equal(response.categoryDistribution['cat_late'], 30);
    assert.equal(response.categoryDistribution['cat_quality'], 5);
  });
});

// ══════════════════════════════════════════════════════════════
//  Monthly scores series
// ══════════════════════════════════════════════════════════════

describe('Dashboard — monthly scores', () => {
  it('monthlyScores contains per-month avgScore and isLive', () => {
    const snap1 = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const liveSnap = snapshotWithEmployee('2026-08', 'e1', 'أحمد', 'مبيعات', 85, 15, 0);
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-08', '2026-07'],
      collected: [
        { monthKey: '2026-08', snapshot: liveSnap, isLive: true },
        { monthKey: '2026-07', snapshot: snap1, isLive: false },
      ],
      settings: SETTINGS,
    });
    assert.equal(response.monthlyScores.length, 2);
    assert.equal(response.monthlyScores[0].monthKey, '2026-08');
    assert.equal(response.monthlyScores[0].avgScore, 85);
    assert.equal(response.monthlyScores[0].isLive, true);
    assert.equal(response.monthlyScores[1].monthKey, '2026-07');
    assert.equal(response.monthlyScores[1].avgScore, 90);
    assert.equal(response.monthlyScores[1].isLive, false);
  });
});

// ══════════════════════════════════════════════════════════════
//  Trend delegates to canonical engine
// ══════════════════════════════════════════════════════════════

describe('Dashboard — trend delegates to canonical engine', () => {
  it('insufficient data returns stable neutral state', () => {
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [],
      settings: SETTINGS,
    });
    assert.equal(response.trend.direction, 'stable');
    assert.equal(response.trend.momDelta, 0);
    assert.equal(response.trend.sampleSize, 0);
  });

  it('single stored snapshot returns stable with sampleSize=1', () => {
    const snap = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 90, 10, 0);
    const response = buildDashboardResponse({
      range: 'previous_month',
      months: ['2026-07'],
      collected: [{ monthKey: '2026-07', snapshot: snap, isLive: false }],
      settings: SETTINGS,
    });
    assert.equal(response.trend.direction, 'stable');
    assert.equal(response.trend.momDelta, 0);
    assert.equal(response.trend.sampleSize, 1);
  });

  it('two stored snapshots with improving score', () => {
    const snap1 = snapshotWithEmployee('2026-06', 'e1', 'أحمد', 'مبيعات', 80, 20, 0);
    const snap2 = snapshotWithEmployee('2026-07', 'e1', 'أحمد', 'مبيعات', 95, 5, 0);
    const response = buildDashboardResponse({
      range: 'last_2_months',
      months: ['2026-07', '2026-06'],
      collected: [
        { monthKey: '2026-07', snapshot: snap2, isLive: false },
        { monthKey: '2026-06', snapshot: snap1, isLive: false },
      ],
      settings: SETTINGS,
    });
    // momDelta = 95 - 80 = 15 → rollingAverage mode: compare to rolling avg = 87.5, deviation = 95 - 87.5 = 7.5 > 3 → improving
    assert.equal(response.trend.direction, 'improving');
    assert.equal(response.trend.sampleSize, 2);
  });
});

// ══════════════════════════════════════════════════════════════
//  No fake/default data
// ══════════════════════════════════════════════════════════════

describe('Dashboard — no fake/default employee data', () => {
  it('empty dashboard has no default employee entries', () => {
    const response = buildDashboardResponse({
      range: 'current_month',
      months: ['2026-08'],
      collected: [],
      settings: SETTINGS,
    });
    assert.equal(response.totalEmployees, 0);
    assert.deepEqual(response.topEmployees, []);
    assert.deepEqual(response.bottomEmployees, []);
    assert.deepEqual(response.departmentRanking, []);
  });
});
