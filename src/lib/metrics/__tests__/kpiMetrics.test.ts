// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/metrics/kpiMetrics.ts
//
//  Run: npx tsx --test src/lib/metrics/__tests__/kpiMetrics.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isApprovedKpiObs,
  isEffectiveDeductionObs,
  isEffectiveBonusObs,
  isPendingApprovalObs,
  isRejectedObs,
  computeEmployeeScore,
  computeMonthSnapshot,
  resolveMonthsInRange,
  computeTrend,
  aggregateSnapshots,
  buildObservationTimeline,
  qualityToPerformanceFactor,
} from '../kpiMetrics';
import type { ObservationLike } from '../kpiMetrics';
import type { KpiSettings, AuditEvent, ApprovalEvent } from '@/types/quality-kpi';

// ── Shared test fixtures ──

const DEFAULT_SETTINGS: KpiSettings = {
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
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function makeObs(overrides: Partial<ObservationLike> = {}): ObservationLike {
  return {
    id: 'obs_1',
    employeeId: 'emp_1',
    month: '2026-08',
    applyPointDeduction: true,
    points: 5,
    isBonus: false,
    approvalStatus: 'approved',
    categoryId: 'cat_late',
    categoryWeight: 1,
    status: 'closed',
    ...overrides,
  };
}

const EMPLOYEES = new Map<string, { id: string; name: string; department: string | null; position: string | null }>([
  ['emp_1', { id: 'emp_1', name: 'أحمد', department: 'المبيعات', position: 'مدير' }],
  ['emp_2', { id: 'emp_2', name: 'محمد', department: 'المبيعات', position: 'موظف' }],
  ['emp_3', { id: 'emp_3', name: 'سارة', department: 'التشغيل', position: 'موظف' }],
]);

const SUPERVISOR_MAP = new Map<string, string | null>([
  ['emp_1', null],
  ['emp_2', 'emp_1'],
  ['emp_3', null],
]);

// ══════════════════════════════════════════════════════════════

describe('isApprovedKpiObs', () => {
  it('approved + applyPointDeduction → true', () => {
    assert.equal(isApprovedKpiObs(makeObs()), true);
  });

  it('approved but no applyPointDeduction → false', () => {
    assert.equal(isApprovedKpiObs(makeObs({ applyPointDeduction: false })), false);
  });

  it('pending → false', () => {
    assert.equal(isApprovedKpiObs(makeObs({ approvalStatus: 'pending' })), false);
  });

  it('rejected → false', () => {
    assert.equal(isApprovedKpiObs(makeObs({ approvalStatus: 'rejected' })), false);
  });
});

describe('isEffectiveDeductionObs', () => {
  it('approved + deduction → true', () => {
    assert.equal(isEffectiveDeductionObs(makeObs({ isBonus: false })), true);
  });

  it('approved + bonus → false', () => {
    assert.equal(isEffectiveDeductionObs(makeObs({ isBonus: true })), false);
  });
});

describe('isEffectiveBonusObs', () => {
  it('approved + bonus → true', () => {
    assert.equal(isEffectiveBonusObs(makeObs({ isBonus: true })), true);
  });

  it('approved + deduction → false', () => {
    assert.equal(isEffectiveBonusObs(makeObs({ isBonus: false })), false);
  });
});

describe('isPendingApprovalObs', () => {
  it('pending + applyPointDeduction → true', () => {
    assert.equal(isPendingApprovalObs(makeObs({ approvalStatus: 'pending' })), true);
  });

  it('approved → false', () => {
    assert.equal(isPendingApprovalObs(makeObs({ approvalStatus: 'approved' })), false);
  });

  it('no applyPointDeduction → false', () => {
    assert.equal(isPendingApprovalObs(makeObs({ applyPointDeduction: false, approvalStatus: 'pending' })), false);
  });
});

describe('isRejectedObs', () => {
  it('rejected + applyPointDeduction → true', () => {
    assert.equal(isRejectedObs(makeObs({ approvalStatus: 'rejected' })), true);
  });

  it('approved → false', () => {
    assert.equal(isRejectedObs(makeObs({ approvalStatus: 'approved' })), false);
  });
});

// ══════════════════════════════════════════════════════════════

describe('computeEmployeeScore', () => {
  it('no observations → score = 100', () => {
    const result = computeEmployeeScore([], DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.deductionPoints, 0);
    assert.equal(result.bonusPoints, 0);
    assert.equal(result.approvedCount, 0);
    assert.equal(result.pendingCount, 0);
  });

  it('single approved deduction → score = 95 (100 - 5)', () => {
    const obs = [makeObs({ points: 5, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 95);
    assert.equal(result.deductionPoints, 5);
  });

  it('single approved bonus → score = 103 (100 + 3)', () => {
    const obs = [makeObs({ points: 3, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 103);
    assert.equal(result.bonusPoints, 3);
  });

  it('deduction + bonus → score = 98 (100 - 5 + 3)', () => {
    const obs = [
      makeObs({ id: 'd1', points: 5, isBonus: false, approvalStatus: 'approved' }),
      makeObs({ id: 'b1', points: 3, isBonus: true, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 98);
    assert.equal(result.deductionPoints, 5);
    assert.equal(result.bonusPoints, 3);
  });

  it('score never goes below minimumScore (0)', () => {
    const obs = [makeObs({ points: 150, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 0);
  });

  it('pending observations do not affect score', () => {
    const obs = [
      makeObs({ id: 'p1', points: 10, isBonus: false, approvalStatus: 'pending' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.pendingCount, 1);
  });

  it('rejected observations do not affect score', () => {
    const obs = [
      makeObs({ id: 'r1', points: 10, isBonus: false, approvalStatus: 'rejected' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.rejectedCount, 1);
  });

  it('no applyPointDeduction → observation counts but score = 100', () => {
    const obs = [makeObs({ applyPointDeduction: false, points: 10 })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
  });

  it('allowBonus=false ignores bonuses', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, allowBonus: false };
    const obs = [makeObs({ points: 10, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 100); // bonus ignored
    assert.equal(result.bonusPoints, 0);
  });

  it('maximumBonus caps bonus at the configured limit', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, maximumBonus: 5 };
    const obs = [makeObs({ points: 20, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 105); // 100 + 5 (capped from 20)
    assert.equal(result.bonusPoints, 5);
  });

  it('minimumScore overrides floor when set to 10', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, minimumScore: 10 };
    const obs = [makeObs({ points: 200, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 10);
  });

  it('custom defaultScore is respected', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, defaultScore: 50 };
    const obs = [makeObs({ points: 10, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 40);
  });

  it('categoryTotals accumulates approved observations per category', () => {
    const obs = [
      makeObs({ id: 'a', categoryId: 'cat_a', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'b', categoryId: 'cat_a', points: 2, approvalStatus: 'approved' }),
      makeObs({ id: 'c', categoryId: 'cat_b', points: 5, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['cat_a'], 5);
    assert.equal(result.categoryTotals['cat_b'], 5);
  });

  it('weightedPoints = Σ(points × categoryWeight)', () => {
    const obs = [
      makeObs({ id: 'w1', points: 2, categoryWeight: 3, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.weightedPoints, 6); // 2 × 3
  });
});

// ══════════════════════════════════════════════════════════════

describe('computeMonthSnapshot', () => {
  it('generates snapshot with frozen employee metadata', () => {
    const obs = [
      makeObs({ id: 'o1', employeeId: 'emp_1', points: 5, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    assert.equal(snapshot.monthKey, '2026-08');
    assert.equal(snapshot.status, 'closed');
    assert.equal(snapshot.settingsSnapshot.defaultScore, 100);

    // Employee snapshot is frozen.
    const entry = snapshot.employeeScores['emp_1'];
    assert.ok(entry);
    assert.equal(entry.employeeSnapshot.employeeName, 'أحمد');
    assert.equal(entry.employeeSnapshot.departmentName, 'المبيعات');
    assert.equal(entry.employeeSnapshot.position, 'مدير');
    assert.equal(entry.employeeSnapshot.supervisorId, null);
  });

  it('snapshot freezes correct supervisor from map', () => {
    const obs = [
      makeObs({ id: 'o2', employeeId: 'emp_2', points: 3, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const entry = snapshot.employeeScores['emp_2'];
    assert.ok(entry);
    assert.equal(entry.employeeSnapshot.supervisorId, 'emp_1');
  });

  it('unknown employee gets placeholder values', () => {
    const obs = [
      makeObs({ id: 'o3', employeeId: 'emp_unknown', points: 2, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const entry = snapshot.employeeScores['emp_unknown'];
    assert.ok(entry);
    assert.equal(entry.employeeSnapshot.employeeName, 'غير معروف');
    assert.equal(entry.employeeSnapshot.departmentName, 'غير محدد');
  });

  it('employees ranked by score descending', () => {
    const obs = [
      makeObs({ id: 'low', employeeId: 'emp_1', points: 10, approvalStatus: 'approved' }),  // score 90
      makeObs({ id: 'high', employeeId: 'emp_2', points: 1, approvalStatus: 'approved' }),   // score 99
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const emp2Entry = snapshot.employeeScores['emp_2'];
    const emp1Entry = snapshot.employeeScores['emp_1'];
    assert.ok(emp2Entry);
    assert.ok(emp1Entry);
    assert.equal(emp2Entry.rank, 1); // Higher score
    assert.equal(emp1Entry.rank, 2);
    assert.equal(snapshot.topEmployees[0].employeeId, 'emp_2');
    assert.equal(snapshot.bottomEmployees[0].employeeId, 'emp_1');
  });

  it('department aggregation is correct', () => {
    const obs = [
      makeObs({ id: 'd1', employeeId: 'emp_1', points: 5, approvalStatus: 'approved' }),
      makeObs({ id: 'd2', employeeId: 'emp_2', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'd3', employeeId: 'emp_3', points: 2, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const sales = snapshot.departmentScores['المبيعات'];
    assert.ok(sales);
    assert.equal(sales.totalEmployees, 2);
    assert.equal(sales.totalDeductionPoints, 8);
    const ops = snapshot.departmentScores['التشغيل'];
    assert.ok(ops);
    assert.equal(ops.totalEmployees, 1);
  });

  it('approval stats count correctly', () => {
    const obs = [
      makeObs({ id: 'a1', approvalStatus: 'approved', applyPointDeduction: true }),
      makeObs({ id: 'p1', approvalStatus: 'pending', applyPointDeduction: true }),
      makeObs({ id: 'r1', approvalStatus: 'rejected', applyPointDeduction: true }),
      makeObs({ id: 'n1', applyPointDeduction: false }), // not relevant
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    assert.equal(snapshot.approvalStats.total, 3);
    assert.equal(snapshot.approvalStats.approved, 1);
    assert.equal(snapshot.approvalStats.pending, 1);
    assert.equal(snapshot.approvalStats.rejected, 1);
  });

  it('categoryTotals accumulates across all approved observations', () => {
    const obs = [
      makeObs({ id: 'c1', categoryId: 'cat_a', points: 3, approvalStatus: 'approved', employeeId: 'emp_1' }),
      makeObs({ id: 'c2', categoryId: 'cat_a', points: 2, approvalStatus: 'approved', employeeId: 'emp_2' }),
      makeObs({ id: 'c3', categoryId: 'cat_b', points: 7, approvalStatus: 'approved', employeeId: 'emp_3' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    assert.equal(snapshot.categoryTotals['cat_a'], 5);
    assert.equal(snapshot.categoryTotals['cat_b'], 7);
  });

  it('settings-driven behavior: minimumScore=10 floors the score', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, minimumScore: 10 };
    const obs = [
      makeObs({ id: 'big', employeeId: 'emp_1', points: 200, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, settings);
    const entry = snapshot.employeeScores['emp_1'];
    assert.ok(entry);
    assert.equal(entry.score, 10);
  });
});

// ══════════════════════════════════════════════════════════════

describe('resolveMonthsInRange', () => {
  it('current_month returns one month', () => {
    const months = resolveMonthsInRange('current_month', new Date('2026-08-15'));
    assert.deepEqual(months, ['2026-08']);
  });

  it('previous_month returns one month before', () => {
    const months = resolveMonthsInRange('previous_month', new Date('2026-01-15'));
    assert.deepEqual(months, ['2025-12']);
  });

  it('last_3_months returns 3 months (Aug, Jul, Jun)', () => {
    const months = resolveMonthsInRange('last_3_months', new Date('2026-08-01'));
    assert.deepEqual(months, ['2026-08', '2026-07', '2026-06']);
  });

  it('last_6_months returns 6 months', () => {
    const months = resolveMonthsInRange('last_6_months', new Date('2026-08-01'));
    assert.equal(months.length, 6);
    assert.deepEqual(months, ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03']);
  });

  it('current_year returns all months up to now', () => {
    const months = resolveMonthsInRange('current_year', new Date('2026-03-15'));
    assert.equal(months.length, 3);
    assert.deepEqual(months, ['2026-03', '2026-02', '2026-01']);
  });

  it('custom returns empty (caller handles)', () => {
    const months = resolveMonthsInRange('custom', new Date('2026-08-01'));
    assert.deepEqual(months, []);
  });

  it('uses provided now parameter (deterministic)', () => {
    const months = resolveMonthsInRange('current_month', new Date('2025-12-01'));
    assert.deepEqual(months, ['2025-12']);
  });
});

// ══════════════════════════════════════════════════════════════

describe('computeTrend', () => {
  function makeSnapshot(avgScore: number, monthKey: string) {
    return {
      id: monthKey,
      schemaVersion: 1 as const,
      monthKey,
      status: 'closed' as const,
      closedAt: null as string | null,
      closedBy: null as string | null,
      closedByName: null as string | null,
      reopenCount: 0,
      reopenReason: '',
      auditLog: [] as AuditEvent[],
      generatedAt: '2026-08-01T00:00:00.000Z',
      settingsSnapshot: DEFAULT_SETTINGS,
      employeeScores: {
        emp_1: {
          employeeSnapshot: { employeeId: 'emp_1', employeeName: 'Test', departmentId: 'X', departmentName: 'X', position: 'Y', supervisorId: null },
          score: avgScore,
          deductionPoints: 100 - avgScore,
          bonusPoints: 0,
          weightedPoints: 100 - avgScore,
          observationCount: 1,
          approvedCount: 1,
          pendingCount: 0,
          rejectedCount: 0,
          categoryTotals: {},
          rank: 1,
          dept: 'X',
        },
      },
      departmentScores: {},
      topEmployees: [],
      bottomEmployees: [],
      categoryTotals: {},
      approvalStats: { total: 1, pending: 0, approved: 1, rejected: 0, avgApprovalHours: 0 },
    };
  }

  it('empty snapshots → stable, zero values', () => {
    const trend = computeTrend([], DEFAULT_SETTINGS);
    assert.equal(trend.direction, 'stable');
    assert.equal(trend.movingScore, 0);
    assert.equal(trend.sampleSize, 0);
  });

  it('single snapshot → no delta, stable', () => {
    const trend = computeTrend([makeSnapshot(85, '2026-08')], DEFAULT_SETTINGS);
    assert.equal(trend.movingScore, 85);
    assert.equal(trend.momDelta, 0);
    assert.equal(trend.direction, 'stable');
  });

  it('improving: score went up significantly', () => {
    const snapshots = [
      makeSnapshot(90, '2026-08'), // latest
      makeSnapshot(80, '2026-07'),
    ];
    const trend = computeTrend(snapshots, DEFAULT_SETTINGS);
    assert.equal(trend.movingScore, 90);
    assert.equal(trend.momDelta, 10);
    assert.equal(trend.direction, 'improving');
  });

  it('declining: score went down significantly', () => {
    const snapshots = [
      makeSnapshot(70, '2026-08'),
      makeSnapshot(85, '2026-07'),
    ];
    const trend = computeTrend(snapshots, DEFAULT_SETTINGS);
    assert.equal(trend.momDelta, -15);
    assert.equal(trend.direction, 'declining');
  });

  it('stable: small change', () => {
    const snapshots = [
      makeSnapshot(82, '2026-08'),
      makeSnapshot(80, '2026-07'),
    ];
    const trend = computeTrend(snapshots, DEFAULT_SETTINGS);
    assert.equal(trend.direction, 'stable');
  });

  it('trend uses rollingAverage mode correctly', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'rollingAverage' };
    // avg = (90+80+70)/3 = 80; deviation = 90-80 = 10 > 3 → improving
    const snapshots = [
      makeSnapshot(90, '2026-08'),
      makeSnapshot(80, '2026-07'),
      makeSnapshot(70, '2026-06'),
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.rollingAverage, 80);
    assert.equal(trend.direction, 'improving');
  });

  it('trend uses simpleAverage mode (threshold=2)', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'simpleAverage' };
    const snapshots = [
      makeSnapshot(85, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=2, not enough for simpleAverage threshold
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.direction, 'stable');
  });

  it('trend uses movingScore mode (threshold=3)', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'movingScore' };
    const snapshots = [
      makeSnapshot(86, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=3, exactly at threshold — not > 3
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.direction, 'stable');

    // delta=4 → improving
    const snapshots2 = [
      makeSnapshot(87, '2026-08'),
      makeSnapshot(83, '2026-07'),
    ];
    const trend2 = computeTrend(snapshots2, settings);
    assert.equal(trend2.direction, 'improving');
  });
});

// ══════════════════════════════════════════════════════════════

describe('aggregateSnapshots', () => {
  function makeAggSnapshot(avgScore: number, monthKey: string) {
    return {
      id: monthKey,
      schemaVersion: 1 as const,
      monthKey,
      status: 'closed' as const,
      closedAt: null,
      closedBy: null,
      closedByName: null,
      reopenCount: 0,
      reopenReason: '',
      auditLog: [] as AuditEvent[],
      generatedAt: '2026-08-01T00:00:00.000Z',
      settingsSnapshot: DEFAULT_SETTINGS,
      employeeScores: {
        emp_1: {
          employeeSnapshot: { employeeId: 'emp_1', employeeName: 'T', departmentId: 'D', departmentName: 'D', position: 'P', supervisorId: null },
          score: avgScore,
          deductionPoints: 100 - avgScore,
          bonusPoints: 0,
          weightedPoints: 100 - avgScore,
          observationCount: 1,
          approvedCount: 1,
          pendingCount: 0,
          rejectedCount: 0,
          categoryTotals: { cat_a: 5 },
          rank: 1,
          dept: 'D',
        },
      },
      departmentScores: {},
      topEmployees: [],
      bottomEmployees: [],
      categoryTotals: { cat_a: 5 },
      approvalStats: { total: 1, pending: 0, approved: 1, rejected: 0, avgApprovalHours: 0 },
    };
  }

  it('empty snapshots → zeros', () => {
    const agg = aggregateSnapshots([]);
    assert.equal(agg.avgScore, 0);
    assert.equal(agg.totalEmployees, 0);
  });

  it('single snapshot → same score', () => {
    const agg = aggregateSnapshots([makeAggSnapshot(85, '2026-08')]);
    assert.equal(agg.avgScore, 85);
    assert.equal(agg.totalEmployees, 1);
  });

  it('multiple snapshots → averaged score', () => {
    const agg = aggregateSnapshots([
      makeAggSnapshot(80, '2026-08'),
      makeAggSnapshot(90, '2026-07'),
    ]);
    assert.equal(agg.avgScore, 85); // (80+90)/2
    assert.equal(agg.totalEmployees, 1); // same employee deduplicated
    assert.equal(agg.categoryTotals['cat_a'], 10); // accumulated across months
  });
});

// ══════════════════════════════════════════════════════════════

describe('buildObservationTimeline', () => {
  it('combines audit and approval events chronologically', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u1', actorName: 'أحمد', timestamp: '2026-08-01T10:00:00Z', details: 'تم الإنشاء' },
      { action: 'update', actorId: 'u1', actorName: 'أحمد', timestamp: '2026-08-01T11:00:00Z', details: 'تم التعديل' },
    ];
    const approvalHistory: ApprovalEvent[] = [
      { action: 'approve', actorId: 'm1', actorName: 'المدير', timestamp: '2026-08-02T09:00:00Z', notes: 'مقبول' },
    ];

    const timeline = buildObservationTimeline(auditLog, approvalHistory);
    assert.equal(timeline.length, 3);

    // Newest first: approve, update, create
    assert.equal(timeline[0].label, 'موافقة');
    assert.equal(timeline[0].tone, 'positive');
    assert.equal(timeline[1].label, 'تعديل');
    assert.equal(timeline[2].label, 'إنشاء');
    assert.equal(timeline[2].tone, 'positive');
  });

  it('empty logs → empty timeline', () => {
    const timeline = buildObservationTimeline([], []);
    assert.equal(timeline.length, 0);
  });
});

// ══════════════════════════════════════════════════════════════

describe('qualityToPerformanceFactor', () => {
  it('converts employee score to PerformanceFactor', () => {
    const obs = [makeObs({ points: 5, approvalStatus: 'approved' })];
    const scoreResult = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    const factor = qualityToPerformanceFactor(scoreResult);

    assert.equal(factor.factorId, 'quality');
    assert.equal(factor.score, 95);
    assert.ok(factor.maxScore >= factor.score);
    assert.equal(factor.weight, 1);
  });
});
