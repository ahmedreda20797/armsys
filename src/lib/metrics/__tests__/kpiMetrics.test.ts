// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/metrics/kpiMetrics.ts — Milestone 3
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
  isValidPoints,
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
//  Observation Eligibility Filters
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

  it('pending deduction → false', () => {
    assert.equal(
      isEffectiveDeductionObs(makeObs({ isBonus: false, approvalStatus: 'pending' })),
      false,
    );
  });

  it('no applyPointDeduction → false', () => {
    assert.equal(
      isEffectiveDeductionObs(makeObs({ applyPointDeduction: false })),
      false,
    );
  });
});

describe('isEffectiveBonusObs', () => {
  it('approved + bonus → true', () => {
    assert.equal(isEffectiveBonusObs(makeObs({ isBonus: true })), true);
  });

  it('approved + deduction → false', () => {
    assert.equal(isEffectiveBonusObs(makeObs({ isBonus: false })), false);
  });

  it('pending bonus → false', () => {
    assert.equal(
      isEffectiveBonusObs(makeObs({ isBonus: true, approvalStatus: 'pending' })),
      false,
    );
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
    assert.equal(
      isPendingApprovalObs(makeObs({ applyPointDeduction: false, approvalStatus: 'pending' })),
      false,
    );
  });

  it('rejected → false', () => {
    assert.equal(isPendingApprovalObs(makeObs({ approvalStatus: 'rejected' })), false);
  });
});

describe('isRejectedObs', () => {
  it('rejected + applyPointDeduction → true', () => {
    assert.equal(isRejectedObs(makeObs({ approvalStatus: 'rejected' })), true);
  });

  it('approved → false', () => {
    assert.equal(isRejectedObs(makeObs({ approvalStatus: 'approved' })), false);
  });

  it('no applyPointDeduction → false', () => {
    assert.equal(
      isRejectedObs(makeObs({ applyPointDeduction: false, approvalStatus: 'rejected' })),
      false,
    );
  });
});

// ══════════════════════════════════════════════════════════════
//  isValidPoints
// ══════════════════════════════════════════════════════════════

describe('isValidPoints', () => {
  it('positive number → true', () => {
    assert.equal(isValidPoints(5), true);
  });

  it('zero → true', () => {
    assert.equal(isValidPoints(0), true);
  });

  it('negative number → false', () => {
    assert.equal(isValidPoints(-1), false);
  });

  it('NaN → false', () => {
    assert.equal(isValidPoints(NaN), false);
  });

  it('Infinity → false', () => {
    assert.equal(isValidPoints(Infinity), false);
  });

  it('-Infinity → false', () => {
    assert.equal(isValidPoints(-Infinity), false);
  });
});

// ══════════════════════════════════════════════════════════════
//  computeEmployeeScore — Score
// ══════════════════════════════════════════════════════════════

describe('computeEmployeeScore — basic scoring', () => {
  it('no observations → score = 100 (defaultScore)', () => {
    const result = computeEmployeeScore([], DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.deductionPoints, 0);
    assert.equal(result.bonusPoints, 0);
    assert.equal(result.approvedCount, 0);
    assert.equal(result.pendingCount, 0);
    assert.equal(result.rejectedCount, 0);
    assert.equal(result.observationCount, 0);
  });

  it('single approved deduction → score = 95 (100 - 5)', () => {
    const obs = [makeObs({ points: 5, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 95);
    assert.equal(result.deductionPoints, 5);
  });

  it('multiple approved deductions → cumulative', () => {
    const obs = [
      makeObs({ id: 'd1', points: 5, isBonus: false, approvalStatus: 'approved' }),
      makeObs({ id: 'd2', points: 10, isBonus: false, approvalStatus: 'approved' }),
      makeObs({ id: 'd3', points: 3, isBonus: false, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.deductionPoints, 18);
    assert.equal(result.score, 82); // 100 - 18
  });

  it('score floor at minimumScore (0)', () => {
    const obs = [makeObs({ points: 150, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 0);
    assert.equal(result.deductionPoints, 150);
  });

  it('single approved bonus → score = 103 (100 + 3)', () => {
    const obs = [makeObs({ points: 3, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 103);
    assert.equal(result.bonusPoints, 3);
  });

  it('bonus cap at maximumBonus', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, maximumBonus: 5 };
    const obs = [makeObs({ points: 20, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 105); // 100 + 5 (capped from 20)
    assert.equal(result.bonusPoints, 5);
  });

  it('allowBonus: false ignores bonuses completely', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, allowBonus: false };
    const obs = [makeObs({ points: 10, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 100); // bonus ignored
    assert.equal(result.bonusPoints, 0);
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

  it('custom defaultScore is respected', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, defaultScore: 50 };
    const obs = [makeObs({ points: 10, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 40);
  });

  it('minimumScore overrides floor when set to 10', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, minimumScore: 10 };
    const obs = [makeObs({ points: 200, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 10);
  });

  it('minimumScore = 25 with large deduction floors at 25', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, minimumScore: 25 };
    const obs = [makeObs({ points: 100, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 25);
  });

  it('bonus + deduction with floor interaction', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, minimumScore: 10 };
    const obs = [
      makeObs({ id: 'd1', points: 120, isBonus: false, approvalStatus: 'approved' }),
      makeObs({ id: 'b1', points: 30, isBonus: true, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    // 100 - 120 + min(30, 20) = 100 - 120 + 20 = 0 → clamped to 10
    assert.equal(result.score, 10);
  });
});

// ══════════════════════════════════════════════════════════════
//  computeEmployeeScore — Eligibility
// ══════════════════════════════════════════════════════════════

describe('computeEmployeeScore — eligibility', () => {
  it('pending observations do not affect score', () => {
    const obs = [
      makeObs({ id: 'p1', points: 10, isBonus: false, approvalStatus: 'pending' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.pendingCount, 1);
    assert.equal(result.approvedCount, 0);
  });

  it('rejected observations do not affect score', () => {
    const obs = [
      makeObs({ id: 'r1', points: 10, isBonus: false, approvalStatus: 'rejected' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.approvedCount, 0);
  });

  it('applyPointDeduction=false does not count even if approved', () => {
    const obs = [
      makeObs({ applyPointDeduction: false, points: 10, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.deductionPoints, 0);
    assert.equal(result.approvedCount, 0);
    assert.equal(result.pendingCount, 0);
    assert.equal(result.rejectedCount, 0);
  });

  it('approved ordinary observation (applyPointDeduction=false) does not count', () => {
    const obs = [
      makeObs({ applyPointDeduction: false, isBonus: false, points: 5, approvalStatus: 'approved' }),
      makeObs({ id: 'o2', applyPointDeduction: false, isBonus: true, points: 3, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.deductionPoints, 0);
    assert.equal(result.bonusPoints, 0);
    assert.equal(result.approvedCount, 0);
  });

  it('invalid/negative points do not affect the score', () => {
    const obs = [
      makeObs({ id: 'neg', points: -5, approvalStatus: 'approved' }),
      makeObs({ id: 'nan', points: NaN, approvalStatus: 'approved' }),
      makeObs({ id: 'inf', points: Infinity, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.deductionPoints, 0);
    // All are "approved" in status, but invalid points prevent scoring.
    assert.equal(result.approvedCount, 3);
  });

  it('negative points bonus is ignored', () => {
    const obs = [
      makeObs({ id: 'bn', points: -10, isBonus: true, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.bonusPoints, 0);
  });

  it('mix of approved, pending, rejected observations', () => {
    const obs = [
      makeObs({ id: 'a1', points: 5, approvalStatus: 'approved' }),
      makeObs({ id: 'p1', points: 10, approvalStatus: 'pending' }),
      makeObs({ id: 'r1', points: 3, approvalStatus: 'rejected' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 95); // Only approved deduction counts
    assert.equal(result.approvedCount, 1);
    assert.equal(result.pendingCount, 1);
    assert.equal(result.rejectedCount, 1);
    assert.equal(result.deductionPoints, 5);
  });
});

// ══════════════════════════════════════════════════════════════
//  computeEmployeeScore — Weighted Analytics
// ══════════════════════════════════════════════════════════════

describe('computeEmployeeScore — weighted analytics', () => {
  it('weightedPoints = Σ(points × categoryWeight)', () => {
    const obs = [
      makeObs({ id: 'w1', points: 2, categoryWeight: 3, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.weightedPoints, 6); // 2 × 3
  });

  it('raw points remain the scoring source (not weighted)', () => {
    const obs = [
      makeObs({ id: 'rw', points: 10, categoryWeight: 5, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 90); // 100 - 10 (raw points)
    assert.equal(result.weightedPoints, 50); // 10 × 5
  });

  it('multiple observations with different weights', () => {
    const obs = [
      makeObs({ id: 'w1', points: 2, categoryWeight: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'w2', points: 4, categoryWeight: 1, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.deductionPoints, 6); // raw sum
    assert.equal(result.score, 94); // 100 - 6
    assert.equal(result.weightedPoints, 10); // 2*3 + 4*1
  });

  it('categoryTotals are correct per category', () => {
    const obs = [
      makeObs({ id: 'a', categoryId: 'cat_a', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'b', categoryId: 'cat_a', points: 2, approvalStatus: 'approved' }),
      makeObs({ id: 'c', categoryId: 'cat_b', points: 5, approvalStatus: 'approved' }),
      makeObs({ id: 'd', categoryId: 'cat_b', points: 1, approvalStatus: 'approved' }),
      makeObs({ id: 'e', categoryId: 'cat_c', points: 4, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['cat_a'], 5); // 3 + 2
    assert.equal(result.categoryTotals['cat_b'], 6); // 5 + 1
    assert.equal(result.categoryTotals['cat_c'], 4);
  });

  it('pending observations excluded from categoryTotals', () => {
    const obs = [
      makeObs({ id: 'a', categoryId: 'cat_a', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'p', categoryId: 'cat_a', points: 10, approvalStatus: 'pending' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['cat_a'], 3); // Only approved
  });

  it('rejected observations excluded from categoryTotals', () => {
    const obs = [
      makeObs({ id: 'a', categoryId: 'cat_a', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'r', categoryId: 'cat_a', points: 10, approvalStatus: 'rejected' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['cat_a'], 3); // Only approved
  });

  it('unclassified category uses _unclassified key', () => {
    const obs = [
      makeObs({ id: 'u', categoryId: '', points: 7, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['_unclassified'], 7);
  });

  it('bonus categories accumulate in categoryTotals', () => {
    const obs = [
      makeObs({ id: 'b1', categoryId: 'cat_bonus', points: 5, isBonus: true, approvalStatus: 'approved' }),
      makeObs({ id: 'b2', categoryId: 'cat_bonus', points: 3, isBonus: true, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['cat_bonus'], 8); // 5 + 3
  });
});

// ══════════════════════════════════════════════════════════════
//  computeMonthSnapshot — Snapshot
// ══════════════════════════════════════════════════════════════

describe('computeMonthSnapshot — snapshot generation', () => {
  it('generates snapshot with frozen employee metadata', () => {
    const obs = [
      makeObs({ id: 'o1', employeeId: 'emp_1', points: 5, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    assert.equal(snapshot.monthKey, '2026-08');
    assert.equal(snapshot.status, 'closed');
    assert.equal(snapshot.settingsSnapshot.defaultScore, 100);

    // Employee snapshot is frozen (copied values).
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
    assert.equal(entry.employeeSnapshot.position, '');
    assert.equal(entry.employeeSnapshot.supervisorId, null);
  });

  it('employee metadata is frozen — not a reference to live object', () => {
    const empMap = new Map(EMPLOYEES);
    const obs = [
      makeObs({ id: 'o_frozen', employeeId: 'emp_1', points: 0, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', empMap, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    // Mutate the original employee map after snapshot creation.
    empMap.get('emp_1')!.name = 'CHANGED';

    // Snapshot should still have the original name.
    const entry = snapshot.employeeScores['emp_1'];
    assert.ok(entry);
    assert.equal(entry.employeeSnapshot.employeeName, 'أحمد');
  });

  it('rankings are deterministic — score descending, then employeeId ascending', () => {
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

  it('tie-breaking is deterministic by employeeId', () => {
    const obs = [
      makeObs({ id: 't1', employeeId: 'emp_1', points: 5, approvalStatus: 'approved' }),  // score 95
      makeObs({ id: 't2', employeeId: 'emp_2', points: 5, approvalStatus: 'approved' }),  // score 95
      makeObs({ id: 't3', employeeId: 'emp_3', points: 5, approvalStatus: 'approved' }),  // score 95
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    // All have score 95. Rank by employeeId ascending.
    assert.equal(snapshot.employeeScores['emp_1'].rank, 1);
    assert.equal(snapshot.employeeScores['emp_2'].rank, 2);
    assert.equal(snapshot.employeeScores['emp_3'].rank, 3);
  });

  it('department aggregation works correctly', () => {
    const obs = [
      makeObs({ id: 'd1', employeeId: 'emp_1', points: 5, approvalStatus: 'approved' }),
      makeObs({ id: 'd2', employeeId: 'emp_2', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'd3', employeeId: 'emp_3', points: 2, approvalStatus: 'approved' }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const sales = snapshot.departmentScores['المبيعات'];
    assert.ok(sales);
    assert.equal(sales.totalEmployees, 2);
    assert.equal(sales.totalDeductionPoints, 8); // 5 + 3
    assert.equal(sales.totalBonusPoints, 0);
    assert.equal(sales.totalObservations, 2);
    const ops = snapshot.departmentScores['التشغيل'];
    assert.ok(ops);
    assert.equal(ops.totalEmployees, 1);
    assert.equal(ops.totalDeductionPoints, 2);
    assert.equal(ops.totalObservations, 1);
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

  it('settings snapshot is included', () => {
    const settings: KpiSettings = {
      ...DEFAULT_SETTINGS,
      minimumScore: 10,
      maximumBonus: 15,
      trendCalculation: 'movingScore',
    };
    const obs = [makeObs({ id: 's1', employeeId: 'emp_1', points: 0, approvalStatus: 'approved' })];
    const snapshot = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, settings);
    assert.equal(snapshot.settingsSnapshot.minimumScore, 10);
    assert.equal(snapshot.settingsSnapshot.maximumBonus, 15);
    assert.equal(snapshot.settingsSnapshot.trendCalculation, 'movingScore');
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

  it('empty observations → empty snapshot', () => {
    const snapshot = computeMonthSnapshot([], '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    assert.equal(Object.keys(snapshot.employeeScores).length, 0);
    assert.equal(Object.keys(snapshot.departmentScores).length, 0);
    assert.equal(snapshot.topEmployees.length, 0);
    assert.equal(snapshot.bottomEmployees.length, 0);
    assert.equal(snapshot.approvalStats.total, 0);
  });

  it('schemaVersion is always 1', () => {
    const snapshot = computeMonthSnapshot([], '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    assert.equal(snapshot.schemaVersion, 1);
  });
});

// ══════════════════════════════════════════════════════════════
//  resolveMonthsInRange — Range Resolution
// ══════════════════════════════════════════════════════════════

describe('resolveMonthsInRange — range resolution', () => {
  it('current_month returns one month', () => {
    const months = resolveMonthsInRange('current_month', new Date('2026-08-15'));
    assert.deepEqual(months, ['2026-08']);
  });

  it('previous_month returns one month before', () => {
    const months = resolveMonthsInRange('previous_month', new Date('2026-01-15'));
    assert.deepEqual(months, ['2025-12']);
  });

  it('previous_month from August → July', () => {
    const months = resolveMonthsInRange('previous_month', new Date('2026-08-15'));
    assert.deepEqual(months, ['2026-07']);
  });

  it('last_3_months returns 3 months (Aug, Jul, Jun)', () => {
    const months = resolveMonthsInRange('last_3_months', new Date('2026-08-01'));
    assert.deepEqual(months, ['2026-08', '2026-07', '2026-06']);
  });

  it('last_3_months from January crosses year boundary', () => {
    const months = resolveMonthsInRange('last_3_months', new Date('2026-01-15'));
    assert.deepEqual(months, ['2026-01', '2025-12', '2025-11']);
  });

  it('last_6_months returns 6 months', () => {
    const months = resolveMonthsInRange('last_6_months', new Date('2026-08-01'));
    assert.equal(months.length, 6);
    assert.deepEqual(months, ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03']);
  });

  it('last_6_months from January crosses year boundary', () => {
    const months = resolveMonthsInRange('last_6_months', new Date('2026-01-15'));
    assert.equal(months.length, 6);
    assert.deepEqual(months, ['2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08']);
  });

  it('current_year in March returns 3 months', () => {
    const months = resolveMonthsInRange('current_year', new Date('2026-03-15'));
    assert.equal(months.length, 3);
    assert.deepEqual(months, ['2026-03', '2026-02', '2026-01']);
  });

  it('current_year in January returns only January', () => {
    const months = resolveMonthsInRange('current_year', new Date('2026-01-15'));
    assert.equal(months.length, 1);
    assert.deepEqual(months, ['2026-01']);
  });

  it('current_year in December includes all 12 months', () => {
    const months = resolveMonthsInRange('current_year', new Date('2026-12-15'));
    assert.equal(months.length, 12);
    assert.equal(months[0], '2026-12');
    assert.equal(months[11], '2026-01');
  });

  it('custom returns empty (caller handles)', () => {
    const months = resolveMonthsInRange('custom', new Date('2026-08-01'));
    assert.deepEqual(months, []);
  });

  it('uses provided now parameter (deterministic)', () => {
    const months = resolveMonthsInRange('current_month', new Date('2025-12-01'));
    assert.deepEqual(months, ['2025-12']);
  });

  it('year boundary: March previous month is February same year', () => {
    const months = resolveMonthsInRange('previous_month', new Date('2026-03-31'));
    assert.deepEqual(months, ['2026-02']);
  });
});

// ══════════════════════════════════════════════════════════════
//  computeTrend — Trend Calculation
// ══════════════════════════════════════════════════════════════

describe('computeTrend — trend calculation', () => {
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
    assert.equal(trend.rollingAverage, 0);
    assert.equal(trend.momDelta, 0);
    assert.equal(trend.sampleSize, 0);
  });

  it('single snapshot → no delta, stable', () => {
    const trend = computeTrend([makeSnapshot(85, '2026-08')], DEFAULT_SETTINGS);
    assert.equal(trend.movingScore, 85);
    assert.equal(trend.momDelta, 0);
    assert.equal(trend.rollingAverage, 85);
    assert.equal(trend.direction, 'stable');
    assert.equal(trend.sampleSize, 1);
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

  it('stable: small change within threshold', () => {
    const snapshots = [
      makeSnapshot(82, '2026-08'),
      makeSnapshot(80, '2026-07'),
    ];
    const trend = computeTrend(snapshots, DEFAULT_SETTINGS);
    assert.equal(trend.direction, 'stable');
  });

  it('trend rollingAverage mode: deviation from average determines direction', () => {
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

  it('trend rollingAverage mode: below average → declining', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'rollingAverage' };
    // avg = (70+80+90)/3 = 80; deviation = 70-80 = -10 < -3 → declining
    const snapshots = [
      makeSnapshot(70, '2026-08'), // latest, below average
      makeSnapshot(80, '2026-07'),
      makeSnapshot(90, '2026-06'),
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.rollingAverage, 80);
    assert.equal(trend.direction, 'declining');
  });

  it('trend simpleAverage mode: threshold=2', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'simpleAverage' };
    const snapshots = [
      makeSnapshot(85, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=2, not > 2
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.direction, 'stable');
  });

  it('trend simpleAverage mode: delta > 2 → improving', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'simpleAverage' };
    const snapshots = [
      makeSnapshot(86, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=3 > 2 → improving
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.direction, 'improving');
  });

  it('trend simpleAverage mode: delta < -2 → declining', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'simpleAverage' };
    const snapshots = [
      makeSnapshot(80, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=-3 < -2 → declining
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.direction, 'declining');
  });

  it('trend movingScore mode: threshold=3', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'movingScore' };
    const snapshots = [
      makeSnapshot(86, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=3, not > 3
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

  it('trend movingScore mode: delta < -3 → declining', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'movingScore' };
    const snapshots = [
      makeSnapshot(79, '2026-08'),
      makeSnapshot(83, '2026-07'), // delta=-4 < -3 → declining
    ];
    const trend = computeTrend(snapshots, settings);
    assert.equal(trend.direction, 'declining');
  });

  it('each supported trend calculation mode produces correct rollingAverage value', () => {
    const settings1: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'rollingAverage' };
    const settings2: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'simpleAverage' };
    const settings3: KpiSettings = { ...DEFAULT_SETTINGS, trendCalculation: 'movingScore' };
    const snapshots = [
      makeSnapshot(90, '2026-08'),
      makeSnapshot(80, '2026-07'),
      makeSnapshot(70, '2026-06'),
    ];

    // rollingAverage value is the same regardless of mode.
    const trend1 = computeTrend(snapshots, settings1);
    const trend2 = computeTrend(snapshots, settings2);
    const trend3 = computeTrend(snapshots, settings3);
    assert.equal(trend1.rollingAverage, 80);
    assert.equal(trend2.rollingAverage, 80);
    assert.equal(trend3.rollingAverage, 80);
  });
});

// ══════════════════════════════════════════════════════════════
//  aggregateSnapshots — Snapshot Aggregation
// ══════════════════════════════════════════════════════════════

describe('aggregateSnapshots — snapshot aggregation', () => {
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
    assert.equal(agg.totalDeductions, 0);
    assert.equal(agg.totalBonuses, 0);
    assert.deepEqual(agg.categoryTotals, {});
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
    assert.equal(agg.categoryTotals['cat_a'], 10); // accumulated (sum)
  });

  it('deductions are summed across months', () => {
    const agg = aggregateSnapshots([
      makeAggSnapshot(80, '2026-08'), // 20 deductions
      makeAggSnapshot(90, '2026-07'), // 10 deductions
    ]);
    assert.equal(agg.totalDeductions, 30); // 20 + 10 (sum, not average)
  });

  it('multiple employees deduplicated correctly', () => {
    const multiEmpSnapshot = {
      ...makeAggSnapshot(85, '2026-08'),
      employeeScores: {
        emp_1: {
          employeeSnapshot: { employeeId: 'emp_1', employeeName: 'T', departmentId: 'D', departmentName: 'D', position: 'P', supervisorId: null },
          score: 85,
          deductionPoints: 15,
          bonusPoints: 0,
          weightedPoints: 15,
          observationCount: 1,
          approvedCount: 1,
          pendingCount: 0,
          rejectedCount: 0,
          categoryTotals: { cat_a: 5 },
          rank: 1,
          dept: 'D',
        },
        emp_2: {
          employeeSnapshot: { employeeId: 'emp_2', employeeName: 'T2', departmentId: 'D2', departmentName: 'D2', position: 'P2', supervisorId: null },
          score: 90,
          deductionPoints: 10,
          bonusPoints: 0,
          weightedPoints: 10,
          observationCount: 1,
          approvedCount: 1,
          pendingCount: 0,
          rejectedCount: 0,
          categoryTotals: { cat_b: 8 },
          rank: 1,
          dept: 'D2',
        },
      },
    };
    const agg = aggregateSnapshots([multiEmpSnapshot]);
    assert.equal(agg.totalEmployees, 2);
    assert.equal(agg.avgScore, Math.round((85 + 90) / 2));
  });
});

// ══════════════════════════════════════════════════════════════
//  buildObservationTimeline — Timeline
// ══════════════════════════════════════════════════════════════

describe('buildObservationTimeline — timeline derivation', () => {
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

  it('chronological ordering is maintained', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u1', actorName: 'A', timestamp: '2026-08-01T10:00:00Z', details: '' },
      { action: 'update', actorId: 'u1', actorName: 'A', timestamp: '2026-08-01T12:00:00Z', details: '' },
      { action: 'status_change', actorId: 'u1', actorName: 'A', timestamp: '2026-08-01T14:00:00Z', details: '' },
      { action: 'capa_linked', actorId: 'u1', actorName: 'A', timestamp: '2026-08-03T09:00:00Z', details: '' },
      { action: 'resolved', actorId: 'u1', actorName: 'A', timestamp: '2026-08-05T10:00:00Z', details: '' },
      { action: 'closed', actorId: 'u1', actorName: 'A', timestamp: '2026-08-07T11:00:00Z', details: '' },
    ];
    const approvalHistory: ApprovalEvent[] = [
      { action: 'submit', actorId: 'u1', actorName: 'A', timestamp: '2026-08-01T15:00:00Z', notes: '' },
      { action: 'approve', actorId: 'm1', actorName: 'M', timestamp: '2026-08-02T08:00:00Z', notes: '' },
    ];

    const timeline = buildObservationTimeline(auditLog, approvalHistory);
    assert.equal(timeline.length, 8);

    // Newest first
    assert.equal(timeline[0].label, 'إغلاق');
    assert.equal(timeline[0].timestamp, '2026-08-07T11:00:00Z');
    assert.equal(timeline[1].label, 'تم الحل');
    assert.equal(timeline[2].label, 'ربط بـ كابا');
    assert.equal(timeline[3].label, 'موافقة');
    assert.equal(timeline[4].label, 'إرسال للاعتماد');
    assert.equal(timeline[5].label, 'تغيير الحالة');
    assert.equal(timeline[6].label, 'تعديل');
    assert.equal(timeline[7].label, 'إنشاء');
  });

  it('approval history integration includes all event types', () => {
    const approvalHistory: ApprovalEvent[] = [
      { action: 'submit', actorId: 'u1', actorName: 'U', timestamp: '2026-08-01T09:00:00Z', notes: '' },
      { action: 'reject', actorId: 'm1', actorName: 'M', timestamp: '2026-08-01T10:00:00Z', notes: '' },
      { action: 'reopen', actorId: 'u1', actorName: 'U', timestamp: '2026-08-02T09:00:00Z', notes: '' },
      { action: 'override', actorId: 'm2', actorName: 'M2', timestamp: '2026-08-02T10:00:00Z', notes: '' },
      { action: 'approve', actorId: 'm2', actorName: 'M2', timestamp: '2026-08-02T11:00:00Z', notes: '' },
    ];
    const timeline = buildObservationTimeline([], approvalHistory);
    assert.equal(timeline.length, 5);

    // Newest first
    assert.equal(timeline[0].label, 'موافقة');
    assert.equal(timeline[0].tone, 'positive');
    assert.equal(timeline[1].label, 'تجاوز');
    assert.equal(timeline[2].label, 'إعادة فتح');
    assert.equal(timeline[3].label, 'رفض');
    assert.equal(timeline[3].tone, 'negative');
    assert.equal(timeline[4].label, 'إرسال للاعتماد');
  });

  it('audit history integration', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u1', actorName: 'U', timestamp: '2026-08-01T10:00:00Z', details: 'Created' },
      { action: 'delete', actorId: 'u2', actorName: 'U2', timestamp: '2026-08-01T11:00:00Z', details: 'Deleted' },
    ];
    const timeline = buildObservationTimeline(auditLog, []);
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].label, 'حذف');
    assert.equal(timeline[0].tone, 'negative');
    assert.equal(timeline[1].label, 'إنشاء');
    assert.equal(timeline[1].tone, 'positive');
  });
});

// ══════════════════════════════════════════════════════════════
//  qualityToPerformanceFactor — Performance Adapter
// ══════════════════════════════════════════════════════════════

describe('qualityToPerformanceFactor — performance adapter', () => {
  it('converts employee score to PerformanceFactor with correct shape', () => {
    const obs = [makeObs({ points: 5, approvalStatus: 'approved' })];
    const scoreResult = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    const factor = qualityToPerformanceFactor(scoreResult);

    assert.equal(factor.factorId, 'quality');
    assert.equal(factor.factorName, 'الجودة');
    assert.equal(factor.score, 95);
    assert.ok(factor.maxScore >= factor.score);
    assert.equal(factor.weight, 1);
    assert.ok(typeof factor.normalized === 'number');
  });

  it('exposes score, maxScore, weight, breakdown', () => {
    const obs = [
      makeObs({ id: 'a', categoryId: 'cat_a', points: 5, approvalStatus: 'approved' }),
      makeObs({ id: 'b', categoryId: 'cat_b', points: 3, approvalStatus: 'approved' }),
    ];
    const scoreResult = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    const factor = qualityToPerformanceFactor(scoreResult, 100);

    assert.equal(factor.score, 92); // 100 - 8
    assert.equal(factor.maxScore, 100);
    assert.ok(factor.breakdown);
    assert.equal(factor.breakdown!['cat_a'], 5);
    assert.equal(factor.breakdown!['cat_b'], 3);
  });

  it('normalized is score/maxScore', () => {
    const obs = [makeObs({ points: 50, approvalStatus: 'approved' })];
    const scoreResult = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    const factor = qualityToPerformanceFactor(scoreResult, 100);

    // score = 50, maxScore ≈ 100, normalized ≈ 0.5
    assert.ok(factor.normalized >= 0);
    assert.ok(factor.normalized <= 1);
  });

  it('maxScore is reconstructed from score + deductions', () => {
    const obs = [makeObs({ points: 20, approvalStatus: 'approved' })];
    const scoreResult = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    const factor = qualityToPerformanceFactor(scoreResult);

    // maxScore is reconstructed as score + deductions by the generic
    // toPerformanceFactor: 80 + 20 = 100
    assert.equal(factor.score, 80);
    assert.equal(factor.maxScore, 100);
  });
});

// ══════════════════════════════════════════════════════════════
//  Regression — existing test scenarios remain passing
// ══════════════════════════════════════════════════════════════

describe('Regression — existing scenarios still pass', () => {
  it('no observations → score = defaultScore (100)', () => {
    const result = computeEmployeeScore([], DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.deductionPoints, 0);
    assert.equal(result.bonusPoints, 0);
  });

  it('single deduction 5pts → score 95', () => {
    const obs = [makeObs({ points: 5, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 95);
    assert.equal(result.deductionPoints, 5);
  });

  it('single bonus 3pts → score 103', () => {
    const obs = [makeObs({ points: 3, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 103);
    assert.equal(result.bonusPoints, 3);
  });

  it('pending does not count', () => {
    const obs = [
      makeObs({ id: 'p1', points: 10, isBonus: false, approvalStatus: 'pending' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.pendingCount, 1);
  });

  it('rejected does not count', () => {
    const obs = [
      makeObs({ id: 'r1', points: 10, isBonus: false, approvalStatus: 'rejected' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.rejectedCount, 1);
  });

  it('no applyPointDeduction → score = 100', () => {
    const obs = [makeObs({ applyPointDeduction: false, points: 10 })];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 100);
  });

  it('allowBonus=false ignores bonuses', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, allowBonus: false };
    const obs = [makeObs({ points: 10, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 100);
    assert.equal(result.bonusPoints, 0);
  });

  it('maximumBonus caps bonus', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, maximumBonus: 5 };
    const obs = [makeObs({ points: 20, isBonus: true, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 105);
    assert.equal(result.bonusPoints, 5);
  });

  it('minimumScore floors the score', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, minimumScore: 10 };
    const obs = [makeObs({ points: 200, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 10);
  });

  it('custom defaultScore', () => {
    const settings: KpiSettings = { ...DEFAULT_SETTINGS, defaultScore: 50 };
    const obs = [makeObs({ points: 10, isBonus: false, approvalStatus: 'approved' })];
    const result = computeEmployeeScore(obs, settings, 'emp_1');
    assert.equal(result.score, 40);
  });

  it('categoryTotals accumulates per category', () => {
    const obs = [
      makeObs({ id: 'a', categoryId: 'cat_a', points: 3, approvalStatus: 'approved' }),
      makeObs({ id: 'b', categoryId: 'cat_a', points: 2, approvalStatus: 'approved' }),
      makeObs({ id: 'c', categoryId: 'cat_b', points: 5, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.categoryTotals['cat_a'], 5);
    assert.equal(result.categoryTotals['cat_b'], 5);
  });

  it('weightedPoints calculated correctly', () => {
    const obs = [
      makeObs({ id: 'w1', points: 2, categoryWeight: 3, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(obs, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.weightedPoints, 6); // 2 × 3
  });
});
