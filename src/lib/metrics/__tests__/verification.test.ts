// ══════════════════════════════════════════════════════════════
//  Milestone 9 — Phase 1 Final Verification Tests
//
//  Covers: numerical parity, snapshot identity preservation,
//  closed-month immutability, reopen/re-close, approval parity,
//  trend (stored-snapshot rule), timeline ordering, performance
//  factor adapter, and filterSnapshot correctness.
//
//  Run: npx tsx --test src/lib/metrics/__tests__/milestone-9-verification.test.ts
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
  computeTrend,
  aggregateSnapshots,
  qualityToPerformanceFactor,
} from '../kpiMetrics';
import type { ObservationLike, EmployeeLike } from '../kpiMetrics';
import {
  buildClosedSnapshot,
  buildReclosedSnapshot,
  buildReopenedSnapshot,
  buildLivePreview,
} from '@/lib/month-snapshots';
import { buildTimeline } from '@/lib/audit/timeline-builder';
import type {
  KpiSettings,
  MonthSnapshot,
  AuditEvent,
  ApprovalEvent,
  TrendResult,
  PerformanceFactor,
} from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Shared Fixtures
// ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-15T10:00:00.000Z');
const ACTOR = { id: 'admin1', name: 'مدير النظام' };

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
  updatedAt: NOW.toISOString(),
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

const EMPLOYEES = new Map<string, EmployeeLike>([
  ['emp_1', { id: 'emp_1', name: 'أحمد', department: 'المبيعات', position: 'مدير مبيعات' }],
  ['emp_2', { id: 'emp_2', name: 'سارة', department: 'التشغيل', position: 'أخصائي تشغيل' }],
  ['emp_3', { id: 'emp_3', name: 'محمد', department: 'المبيعات', position: 'موظف مبيعات' }],
]);

const SUPERVISOR_MAP = new Map<string, string | null>([
  ['emp_1', null],
  ['emp_2', 'emp_1'],
  ['emp_3', null],
]);

// ══════════════════════════════════════════════════════════════
//  1. Numerical Parity — Canonical Engine vs. Consumers
// ══════════════════════════════════════════════════════════════

describe('M9 — Numerical Parity', () => {
  it('computeEmployeeScore result equals employeeScores entry in computeMonthSnapshot', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 10, categoryId: 'cat_a', approvalStatus: 'approved' }),
      makeObs({ employeeId: 'emp_1', points: 5, categoryId: 'cat_b', approvalStatus: 'approved', isBonus: true }),
      makeObs({ employeeId: 'emp_1', points: 3, categoryId: 'cat_c', approvalStatus: 'pending' }),
    ];

    // Individual engine result
    const empResult = computeEmployeeScore(observations, DEFAULT_SETTINGS, 'emp_1');

    // Snapshot engine result
    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const entry = snapshot.employeeScores['emp_1'];

    assert.ok(entry, 'employee entry must exist in snapshot');

    // ONE numerical truth
    assert.equal(entry.score, empResult.score, 'score parity');
    assert.equal(entry.deductionPoints, empResult.deductionPoints, 'deduction parity');
    assert.equal(entry.bonusPoints, empResult.bonusPoints, 'bonus parity');
    assert.equal(entry.weightedPoints, empResult.weightedPoints, 'weighted parity');
    assert.equal(entry.observationCount, empResult.observationCount, 'observation count parity');
    assert.equal(entry.approvedCount, empResult.approvedCount, 'approved count parity');
    assert.equal(entry.pendingCount, empResult.pendingCount, 'pending count parity');
    assert.equal(entry.rejectedCount, empResult.rejectedCount, 'rejected count parity');
  });

  it('snapshot employeeScores are independent per employee (no cross-contamination)', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 8 }),
      makeObs({ employeeId: 'emp_2', points: 12 }),
    ];
    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    // computeEmployeeScore expects pre-filtered observations (engine contract:
    // "The employee's filtered observations for the month") — mirror computeMonthSnapshot's grouping.
    const emp1Result = computeEmployeeScore(
      observations.filter((o) => o.employeeId === 'emp_1'), DEFAULT_SETTINGS, 'emp_1',
    );
    const emp2Result = computeEmployeeScore(
      observations.filter((o) => o.employeeId === 'emp_2'), DEFAULT_SETTINGS, 'emp_2',
    );

    assert.equal(snapshot.employeeScores['emp_1'].score, emp1Result.score);
    assert.equal(snapshot.employeeScores['emp_1'].deductionPoints, emp1Result.deductionPoints);
    assert.equal(snapshot.employeeScores['emp_2'].score, emp2Result.score);
    assert.equal(snapshot.employeeScores['emp_2'].deductionPoints, emp2Result.deductionPoints);
  });
});

// ══════════════════════════════════════════════════════════════
//  2. Approval Parity
// ══════════════════════════════════════════════════════════════

describe('M9 — Approval Parity', () => {
  it('pending observations do not change score', () => {
    const pending: ObservationLike[] = [
      makeObs({ approvalStatus: 'pending', points: 15 }),
    ];
    const result = computeEmployeeScore(pending, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, DEFAULT_SETTINGS.defaultScore, 'pending deductions → default score');
    assert.equal(result.deductionPoints, 0);
  });

  it('rejected observations do not change score', () => {
    const rejected: ObservationLike[] = [
      makeObs({ approvalStatus: 'rejected', points: 15 }),
    ];
    const result = computeEmployeeScore(rejected, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, DEFAULT_SETTINGS.defaultScore, 'rejected deductions → default score');
    assert.equal(result.deductionPoints, 0);
  });

  it('approved deductions change score', () => {
    const approved: ObservationLike[] = [
      makeObs({ approvalStatus: 'approved', points: 10, isBonus: false }),
    ];
    const result = computeEmployeeScore(approved, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 90, '100 − 10 = 90');
    assert.equal(result.deductionPoints, 10);
  });

  it('approved bonuses change score according to settings', () => {
    const withBonus: ObservationLike[] = [
      makeObs({ approvalStatus: 'approved', points: 8, isBonus: true, categoryId: 'bonus_a' }),
    ];
    const result = computeEmployeeScore(withBonus, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.bonusPoints, 8, 'bonus applied');
    assert.equal(result.score, 108, '100 + 8 = 108');

    // With bonus disabled
    const noBonusSettings = { ...DEFAULT_SETTINGS, allowBonus: false };
    const resultNoBonus = computeEmployeeScore(withBonus, noBonusSettings, 'emp_1');
    assert.equal(resultNoBonus.score, 100, 'bonus disabled → default score');
    assert.equal(resultNoBonus.bonusPoints, 0);

    // With bonus cap
    const capSettings = { ...DEFAULT_SETTINGS, maximumBonus: 5 };
    const resultCapped = computeEmployeeScore(withBonus, capSettings, 'emp_1');
    assert.equal(resultCapped.bonusPoints, 5, 'bonus capped to maximumBonus');
    assert.equal(resultCapped.score, 105, '100 + 5 = 105');
  });

  it('applyPointDeduction=false observations do not change score', () => {
    const noDeduction: ObservationLike[] = [
      makeObs({ applyPointDeduction: false, points: 20, approvalStatus: 'approved' }),
    ];
    const result = computeEmployeeScore(noDeduction, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, DEFAULT_SETTINGS.defaultScore);
    assert.equal(result.deductionPoints, 0);
    assert.equal(result.observationCount, 1, 'observation recorded in count but has zero KPI impact');
  });
});

// ══════════════════════════════════════════════════════════════
//  3. Snapshot Identity Preservation (Frozen Metadata)
// ══════════════════════════════════════════════════════════════

describe('M9 — Snapshot Identity Preservation', () => {
  it('employee metadata is frozen at close time and never mutates', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 5 }),
    ];

    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const closed = buildClosedSnapshot(snapshot, '2026-08', null, ACTOR, NOW);

    // Frozen identity
    assert.equal(closed.employeeScores['emp_1'].employeeSnapshot.employeeName, 'أحمد');
    assert.equal(closed.employeeScores['emp_1'].employeeSnapshot.departmentName, 'المبيعات');
    assert.equal(closed.employeeScores['emp_1'].employeeSnapshot.position, 'مدير مبيعات');

    // Settings frozen
    assert.equal(closed.settingsSnapshot.defaultScore, 100);
    assert.equal(closed.settingsSnapshot.maximumBonus, 20);
  });

  it('historical score is preserved even if employee metadata would change', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 10 }),
    ];

    // Original employee map
    const originalEmployees = new Map<string, EmployeeLike>([
      ['emp_1', { id: 'emp_1', name: 'أحمد', department: 'المبيعات', position: 'مدير' }],
    ]);

    const snapshot = computeMonthSnapshot(observations, '2026-08', originalEmployees, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const closed = buildClosedSnapshot(snapshot, '2026-08', null, ACTOR, NOW);

    const frozenScore = closed.employeeScores['emp_1'].score;
    const frozenName = closed.employeeScores['emp_1'].employeeSnapshot.employeeName;
    const frozenDept = closed.employeeScores['emp_1'].employeeSnapshot.departmentName;

    // Simulate employee metadata change (department transfer, rename)
    // This would affect a FRESH computation but NOT the frozen snapshot
    const changedEmployees = new Map<string, EmployeeLike>([
      ['emp_1', { id: 'emp_1', name: 'أحمد محمد', department: 'التسويق', position: 'مدير تسويق' }],
    ]);

    // Fresh computation with changed metadata
    const newSnapshot = computeMonthSnapshot(observations, '2026-08', changedEmployees, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    // The FRESH computation sees new metadata
    assert.equal(newSnapshot.employeeScores['emp_1'].employeeSnapshot.departmentName, 'التسويق');

    // But the FROZEN snapshot is unchanged
    assert.equal(closed.employeeScores['emp_1'].score, frozenScore, 'frozen score unchanged');
    assert.equal(closed.employeeScores['emp_1'].employeeSnapshot.employeeName, frozenName, 'frozen name unchanged');
    assert.equal(closed.employeeScores['emp_1'].employeeSnapshot.departmentName, frozenDept, 'frozen department unchanged');
  });

  it('settings changes after close do not affect frozen snapshot', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 5 }),
    ];

    const originalSettings = { ...DEFAULT_SETTINGS, defaultScore: 100, maximumBonus: 20 };
    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, originalSettings);
    const closed = buildClosedSnapshot(snapshot, '2026-08', null, ACTOR, NOW);

    // Settings at close time are frozen
    assert.equal(closed.settingsSnapshot.defaultScore, 100);
    assert.equal(closed.settingsSnapshot.maximumBonus, 20);

    // Even if settings change later, frozen snapshot is untouched
    const changedSettings = { ...DEFAULT_SETTINGS, defaultScore: 90, maximumBonus: 10 };
    const newSnapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, changedSettings);

    assert.equal(newSnapshot.employeeScores['emp_1'].score, 85, 'new settings: 90 − 5 = 85');
    assert.equal(closed.employeeScores['emp_1'].score, 95, 'frozen: 100 − 5 = 95');
  });
});

// ══════════════════════════════════════════════════════════════
//  4. Closed-Month Immutability
// ══════════════════════════════════════════════════════════════

describe('M9 — Closed-Month Immutability', () => {
  it('buildClosedSnapshot produces status=closed with audit trail', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 3 }),
    ];
    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const closed = buildClosedSnapshot(snapshot, '2026-08', null, ACTOR, NOW);

    assert.equal(closed.status, 'closed');
    assert.ok(closed.closedAt);
    assert.equal(closed.closedBy, ACTOR.id);
    assert.ok(closed.auditLog.length > 0, 'close audit event recorded');
  });

  it('re-closed snapshot archives previous version in snapshotHistory', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 5 }),
    ];

    // First close
    const snap1 = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const closed1 = buildClosedSnapshot(snap1, '2026-08', null, ACTOR, NOW);

    // Reopen
    const reopened = buildReopenedSnapshot(closed1, 'سبب إعادة الفتح', ACTOR, new Date(NOW.getTime() + 86400000));
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.reopenCount, 1);

    // Add a new observation (simulated via recomputation with extra obs)
    const moreObs = [...observations, makeObs({ id: 'obs_new', employeeId: 'emp_1', points: 3, categoryId: 'cat_extra' })];
    const snap2 = computeMonthSnapshot(moreObs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    // Re-close
    const reclosed = buildReclosedSnapshot(snap2, reopened, ACTOR, new Date(NOW.getTime() + 172800000));
    assert.equal(reclosed.status, 'closed');
    assert.ok(reclosed.snapshotHistory, 'snapshotHistory must exist');
    assert.equal(reclosed.snapshotHistory!.length, 1, 'one archived version');

    // Archived version preserves original frozen state
    const archived = reclosed.snapshotHistory![0];
    assert.equal(archived.closedAt, closed1.closedAt, 'archived closedAt matches original');
    assert.equal(archived.employeeScores['emp_1'].score, 95, 'archived score: 100 − 5 = 95');

    // New snapshot reflects new computation
    assert.equal(reclosed.employeeScores['emp_1'].score, 92, 'new score: 100 − 5 − 3 = 92');
  });
});

// ══════════════════════════════════════════════════════════════
//  5. Trend — Stored-Snapshot Rule
// ══════════════════════════════════════════════════════════════

describe('M9 — Trend (Stored-Snapshot Rule)', () => {
  it('trend uses only stored snapshots, never live recalculation', () => {
    // Create two month snapshots with a large average-score gap
    // (rollingAverage mode needs deviation > 3 vs the rolling mean).
    const obsMonth7: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', month: '2026-07', points: 20 }),
    ];
    const obsMonth8: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', month: '2026-08', points: 5 }),
    ];

    const snap7 = computeMonthSnapshot(obsMonth7, '2026-07', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const snap8 = computeMonthSnapshot(obsMonth8, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    // Mark as closed (frozen)
    const closed7 = buildClosedSnapshot(snap7, '2026-07', null, ACTOR, NOW);
    const closed8 = buildClosedSnapshot(snap8, '2026-08', null, ACTOR, new Date(NOW.getTime() + 86400000));

    // Trend from stored snapshots (most-recent first)
    const trend: TrendResult = computeTrend([closed8, closed7], DEFAULT_SETTINGS);

    // Month 8 avg = 95, Month 7 avg = 80 → rolling mean 87.5, deviation +7.5 → improving
    assert.ok(trend.sampleSize >= 2, 'both months contribute to trend');
    assert.equal(trend.direction, 'improving', 'score improved month-over-month');
    assert.ok(trend.momDelta > 0, 'positive momDelta');
  });

  it('trend with single snapshot returns stable direction', () => {
    const obs: ObservationLike[] = [makeObs({ employeeId: 'emp_1', points: 5 })];
    const snap = computeMonthSnapshot(obs, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const closed = buildClosedSnapshot(snap, '2026-08', null, ACTOR, NOW);

    const trend = computeTrend([closed], DEFAULT_SETTINGS);
    assert.equal(trend.direction, 'stable');
    assert.equal(trend.sampleSize, 1);
  });
});

// ══════════════════════════════════════════════════════════════
//  6. Timeline Ordering
// ══════════════════════════════════════════════════════════════

describe('M9 — Timeline Ordering', () => {
  it('buildTimeline returns points sorted newest-first', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u1', actorName: 'مراقب', timestamp: '2026-08-10T08:00:00Z', details: 'إنشاء الملاحظة' },
      { action: 'update', actorId: 'u1', actorName: 'مراقب', timestamp: '2026-08-12T10:00:00Z', details: 'تعديل النقاط' },
    ];
    const approvalHistory: ApprovalEvent[] = [
      { action: 'submit', actorId: 'u1', actorName: 'مراقب', timestamp: '2026-08-10T08:01:00Z', notes: 'إرسال للاعتماد' },
      { action: 'approve', actorId: 'mgr1', actorName: 'المدير', timestamp: '2026-08-13T09:00:00Z', notes: 'موافقة' },
    ];

    const timeline = buildTimeline(auditLog, approvalHistory);

    assert.equal(timeline.length, 4);

    // Newest first: approve (13th), update (12th), submit (10th 08:01), create (10th 08:00)
    assert.ok(
      new Date(timeline[0].timestamp).getTime() >= new Date(timeline[1].timestamp).getTime(),
      'first point is newest or equal',
    );
    assert.ok(
      new Date(timeline[1].timestamp).getTime() >= new Date(timeline[2].timestamp).getTime(),
      'second point >= third',
    );
  });

  it('timeline labels match expected Arabic labels', () => {
    const auditLog: AuditEvent[] = [
      { action: 'create', actorId: 'u1', actorName: 'مراقب', timestamp: '2026-08-10T08:00:00Z', details: '' },
    ];
    const approvalHistory: ApprovalEvent[] = [
      { action: 'approve', actorId: 'mgr1', actorName: 'المدير', timestamp: '2026-08-11T09:00:00Z', notes: '' },
    ];

    const timeline = buildTimeline(auditLog, approvalHistory);
    assert.equal(timeline[0].label, 'موافقة', 'approve label');
    assert.equal(timeline[1].label, 'إنشاء', 'create label');
  });
});

// ══════════════════════════════════════════════════════════════
//  7. Performance Factor Adapter
// ══════════════════════════════════════════════════════════════

describe('M9 — Performance Factor Adapter', () => {
  it('qualityToPerformanceFactor converts score to PerformanceFactor shape', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 5 }),
    ];
    const empResult = computeEmployeeScore(observations, DEFAULT_SETTINGS, 'emp_1');

    const factor: PerformanceFactor = qualityToPerformanceFactor(empResult, 100);

    assert.equal(factor.factorId, 'quality');
    assert.equal(factor.factorName, 'الجودة');
    assert.equal(factor.score, 95);
    assert.equal(factor.maxScore, 100);
    assert.equal(factor.weight, 1);
    assert.ok(factor.normalized >= 0 && factor.normalized <= 1, 'normalized is 0–1');
  });
});

// ══════════════════════════════════════════════════════════════
//  8. Live Preview vs Frozen Behavior
// ══════════════════════════════════════════════════════════════

describe('M9 — Live Preview vs Frozen', () => {
  it('buildLivePreview returns status=open', () => {
    const observations: ObservationLike[] = [makeObs({ employeeId: 'emp_1' })];
    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const preview = buildLivePreview(snapshot, '2026-08');

    assert.equal(preview.status, 'open');
    assert.equal(preview.monthKey, '2026-08');
    assert.ok(preview.employeeScores['emp_1'], 'live preview has employee data');
  });

  it('buildReopenedSnapshot preserves previous frozen scores', () => {
    const observations: ObservationLike[] = [makeObs({ employeeId: 'emp_1', points: 5 })];
    const snap = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);
    const closed = buildClosedSnapshot(snap, '2026-08', null, ACTOR, NOW);

    const frozenScore = closed.employeeScores['emp_1'].score;

    const reopened = buildReopenedSnapshot(closed, 'تصحيح بيانات', ACTOR, new Date(NOW.getTime() + 86400000));

    // Reopened preserves frozen scores (they remain in the document)
    assert.equal(reopened.employeeScores['emp_1'].score, frozenScore, 'frozen score preserved after reopen');
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.reopenCount, 1);
    assert.equal(reopened.reopenReason, 'تصحيح بيانات');
  });
});

// ══════════════════════════════════════════════════════════════
//  9. Employee Identity — employeeId is the canonical key
// ══════════════════════════════════════════════════════════════

describe('M9 — Employee Identity (employeeId as canonical key)', () => {
  it('computeEmployeeScore uses employeeId to scope observations', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 10 }),
      makeObs({ employeeId: 'emp_2', points: 5 }),
    ];

    // Engine contract: caller pre-filters per employee (mirrors computeMonthSnapshot grouping).
    const result1 = computeEmployeeScore(
      observations.filter((o) => o.employeeId === 'emp_1'), DEFAULT_SETTINGS, 'emp_1',
    );
    const result2 = computeEmployeeScore(
      observations.filter((o) => o.employeeId === 'emp_2'), DEFAULT_SETTINGS, 'emp_2',
    );

    assert.equal(result1.deductionPoints, 10, 'emp_1 sees only own deductions');
    assert.equal(result2.deductionPoints, 5, 'emp_2 sees only own deductions');
    assert.equal(result1.score, 90, 'emp_1 score');
    assert.equal(result2.score, 95, 'emp_2 score');
  });

  it('snapshot employeeScores is keyed by employeeId', () => {
    const observations: ObservationLike[] = [
      makeObs({ employeeId: 'emp_1', points: 3 }),
      makeObs({ employeeId: 'emp_2', points: 7 }),
    ];

    const snapshot = computeMonthSnapshot(observations, '2026-08', EMPLOYEES, SUPERVISOR_MAP, DEFAULT_SETTINGS);

    assert.ok(snapshot.employeeScores['emp_1'], 'emp_1 entry exists');
    assert.ok(snapshot.employeeScores['emp_2'], 'emp_2 entry exists');
    assert.ok(!snapshot.employeeScores['emp_3'], 'emp_3 has no observations → no entry');
  });
});

// ══════════════════════════════════════════════════════════════
//  10. Minimum Score Floor & Edge Cases
// ══════════════════════════════════════════════════════════════

describe('M9 — Minimum Score Floor', () => {
  it('score never goes below minimumScore', () => {
    const heavy: ObservationLike[] = [
      makeObs({ points: 60 }),
      makeObs({ id: 'obs_2', points: 50 }),
    ];

    const result = computeEmployeeScore(heavy, DEFAULT_SETTINGS, 'emp_1');
    assert.equal(result.score, 0, 'clamped to minimumScore = 0');
    assert.equal(result.deductionPoints, 110, 'raw deductions recorded');

    // With a higher floor
    const flooredSettings = { ...DEFAULT_SETTINGS, minimumScore: 30 };
    const resultFloored = computeEmployeeScore(heavy, flooredSettings, 'emp_1');
    assert.equal(resultFloored.score, 30, 'clamped to minimumScore = 30');
  });
});
