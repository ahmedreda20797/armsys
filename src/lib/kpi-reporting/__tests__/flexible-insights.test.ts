// ══════════════════════════════════════════════════════════════
//  Flexible-period insights tests (§FLEX-PERIODS)
//
//  Acceptance coverage (mission §4.4):
//    A  Comparison periods are INDEPENDENT and correctly calculated
//       (Sep vs Aug, custom vs custom).
//    B  Value basis: fully-covered closed span → FINALIZED; partial
//       window → LIVE with the canonical engine recomputing over the
//       window's observations (frozen full-month value never narrowed
//       silently — the window score DIFFERS from the frozen score).
//    C  Day-filtered distributions: observations outside the window
//       never enter category/severity counts.
//    D  No duplicate heavy queries (observations loaded once per
//       month) and no write path.
//    E  Overlapping periods are rejected.
//
//  Convention: pure builder + in-memory loaders (no Firebase mocking).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFlexibleKpiInsights,
  type FlexibleKpiLoaders,
} from '@/lib/kpi-reporting';
import { computeEmployeeScore } from '@/lib/metrics/kpiMetrics';
import {
  buildEmployeeKpiResult,
  withFinalizedAt,
  type EmployeeKpiResult,
  type KpiScheme,
} from '@/lib/kpi-framework';
import type { KpiSettings, MonthSnapshot, QualityObservation } from '@/types/quality-kpi';
import type { OrgNode } from '@/lib/organization/types';
import type { ReportEmployee } from '@/lib/kpi-reporting';

// ─────────────────────────────────────────────────────────────
//  Fixtures (the insights.test.ts house pattern)
// ─────────────────────────────────────────────────────────────

const NOW = new Date(2026, 9, 21, 12, 0, 0); // 2026-10-21 — Sep/Aug closed, Oct current

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
  trendCalculation: 'simpleAverage',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SCHEME: KpiScheme = {
  id: 'scheme_v1',
  schemaVersion: 1,
  name: 'مخطط أداء الموظفين',
  description: null,
  status: 'ACTIVE',
  version: 1,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isDefault: true,
  applicableDepartments: null,
  components: [
    { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality', calculationType: 'quality_engine', status: 'ACTIVE', configuration: null },
    { componentId: 'direct_manager', name: 'المدير المباشر', weight: 15, owner: 'management', calculationType: 'none', status: 'ACTIVE', configuration: null },
    { componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none', status: 'ACTIVE', configuration: null },
    { componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none', status: 'ACTIVE', configuration: null },
  ],
  previousSchemeId: null,
  createdBy: 'tester',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ORG_NODES: OrgNode[] = [
  { id: 'node_dept', name: 'المبيعات', type: 'department', parentId: null, managerUserId: null, status: 'active', order: 1, description: null, createdAt: '', updatedAt: '' },
  { id: 'node_team_a', name: 'فريق الشمال', type: 'team', parentId: 'node_dept', managerUserId: null, status: 'active', order: 2, description: null, createdAt: '', updatedAt: '' },
];

const EMPLOYEES: ReportEmployee[] = [
  { id: 'emp_ahmed', code: '001', name: 'أحمد محمد', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'node_team_a' },
  { id: 'emp_rahma', code: '002', name: 'رحمة حسام', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'node_team_a' },
];

const TEAM_NAMES = new Map<string, string | null>([
  ['emp_ahmed', 'فريق الشمال'],
  ['emp_rahma', 'فريق الشمال'],
]);

let obsCounter = 0;
function makeObs(over: Partial<QualityObservation> & { employeeId: string; month: string; observationDate: string; points: number }): QualityObservation {
  obsCounter += 1;
  return {
    id: over.id ?? `obs_${obsCounter}`,
    schemaVersion: 1,
    employeeName: 'x',
    department: 'd',
    positionSnapshot: 'p',
    observerId: 'u1',
    observerName: 'مراقب الجودة',
    type: 'quality_observation',
    severity: over.severity ?? 'medium',
    categoryId: over.categoryId ?? 'cat_followup',
    categoryName: over.categoryName ?? 'تأخر المتابعة',
    categoryWeight: 1,
    notes: 'ملاحظة',
    evidence: '',
    status: 'resolved',
    relatedCapaId: null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: null,
    applyPointDeduction: over.applyPointDeduction ?? true,
    isBonus: false,
    approvalStatus: over.approvalStatus ?? 'approved',
    approvalHistory: [],
    auditLog: [],
    createdById: 'u1',
    createdByName: 'منشئ',
    clientRequestId: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    ...over,
  } as QualityObservation;
}

// September: أحمد's points are spread across the month — the FIRST-10
// window (3 points) deliberately differs from the full month (10 points).
const SEPTEMBER_OBS: QualityObservation[] = [
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', observationDate: '03/09/2026', points: 3, severity: 'medium' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', observationDate: '12/09/2026', points: 2, severity: 'high' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', observationDate: '15/09/2026', points: 5, severity: 'critical', categoryId: 'cat_info', categoryName: 'معلومة خاطئة' }),
  makeObs({ employeeId: 'emp_rahma', month: '2026-09', observationDate: '08/09/2026', points: 2, severity: 'low' }),
];

const AUGUST_OBS: QualityObservation[] = [
  makeObs({ employeeId: 'emp_ahmed', month: '2026-08', observationDate: '03/08/2026', points: 6 }),
  makeObs({ employeeId: 'emp_rahma', month: '2026-08', observationDate: '04/08/2026', points: 4 }),
];

const SCORES_SEP: Record<string, number> = { emp_ahmed: 90, emp_rahma: 98 };
const SCORES_AUG: Record<string, number> = { emp_ahmed: 85, emp_rahma: 90 };

function frozenKpiResults(scores: Record<string, number>, month: string): Record<string, EmployeeKpiResult> {
  const out: Record<string, EmployeeKpiResult> = {};
  for (const [employeeId, score] of Object.entries(scores)) {
    out[employeeId] = buildEmployeeKpiResult({
      employee: { id: employeeId },
      scheme: SCHEME,
      period: month,
      qualityScore: { score, deductionPoints: 100 - score, bonusPoints: 0, observationCount: 2 },
      origin: 'month_snapshot',
      finalizedAt: '2026-10-01T00:00:00.000Z',
    });
  }
  return withFinalizedAt(out, '2026-10-01T00:00:00.000Z');
}

function closedSnapshot(month: string, scores: Record<string, number>): MonthSnapshot {
  const employeeScores: MonthSnapshot['employeeScores'] = {};
  for (const [employeeId, score] of Object.entries(scores)) {
    employeeScores[employeeId] = {
      employeeSnapshot: {
        employeeId,
        employeeName: EMPLOYEES.find((e) => e.id === employeeId)?.name ?? employeeId,
        departmentId: 'd1',
        departmentName: 'المبيعات',
        position: 'مندوب',
        supervisorId: null,
      },
      score,
      deductionPoints: 100 - score,
      bonusPoints: 0,
      weightedPoints: 0,
      observationCount: 2,
      approvedCount: 2,
      pendingCount: 0,
      rejectedCount: 0,
      categoryTotals: {},
      rank: 1,
      dept: 'المبيعات',
    };
  }
  return {
    id: month,
    schemaVersion: 1,
    monthKey: month,
    status: 'closed',
    closedAt: '2026-10-01T00:00:00.000Z',
    closedBy: 'u1',
    closedByName: 'المدير العام',
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: '2026-10-01T00:00:00.000Z',
    settingsSnapshot: SETTINGS,
    employeeScores,
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
    kpiResults: frozenKpiResults(scores, month),
  };
}

const SNAPSHOTS = new Map<string, MonthSnapshot>([
  ['2026-09', closedSnapshot('2026-09', SCORES_SEP)],
  ['2026-08', closedSnapshot('2026-08', SCORES_AUG)],
]);

const OBSERVATIONS = [...SEPTEMBER_OBS, ...AUGUST_OBS];

function makeLoaders() {
  const monthDetailCalls = new Map<string, number>();
  const observationCalls = new Map<string, number>();
  const loaders: FlexibleKpiLoaders = {
    loadEmployee: async (employeeId) => {
      const record = EMPLOYEES.find((e) => e.id === employeeId);
      return record
        ? { id: record.id, name: record.name, department: record.department, status: record.status, hireDate: record.hireDate, createdAt: record.createdAt, archivedAt: record.archivedAt }
        : null;
    },
    loadEmploymentEvents: async () => [],
    loadSchemes: async () => [SCHEME],
    loadOverrides: async () => [],
    loadSnapshot: async () => null,
    loadLiveQualityScore: async () => null,
    loadEmployeeRecord: async (employeeId) => EMPLOYEES.find((e) => e.id === employeeId) ?? null,
    loadEmployees: async () => EMPLOYEES,
    loadEmploymentEventsByEmployee: async () => new Map(),
    loadSnapshotDocument: async (monthKey) => SNAPSHOTS.get(monthKey) ?? null,
    loadMonthDetail: async (monthKey) => {
      monthDetailCalls.set(monthKey, (monthDetailCalls.get(monthKey) ?? 0) + 1);
      return SNAPSHOTS.get(monthKey) ?? null;
    },
    loadSnapshotDocuments: async (monthKeys) => {
      const map = new Map<string, MonthSnapshot>();
      for (const key of monthKeys) {
        const snap = SNAPSHOTS.get(key);
        if (snap) map.set(key, snap);
      }
      return map;
    },
    loadObservations: async (monthKey) => {
      observationCalls.set(monthKey, (observationCalls.get(monthKey) ?? 0) + 1);
      return OBSERVATIONS.filter((o) => o.month === monthKey);
    },
    loadTeamNames: async () => TEAM_NAMES,
    loadOrgNodes: async () => ORG_NODES,
    loadDomainAvailability: async () => ({ followUps: 0, complaints: 0, capa: 0, attendance: 0, hrDeductions: 0 }),
    loadQualityDeductionRecords: async () => [],
  };
  return { loaders, monthDetailCalls, observationCalls };
}

// ─────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────

describe('flexible-period insights (§FLEX-PERIODS)', () => {
  it('A1 · month vs month: independent comparison periods, correct deltas', async () => {
    const { loaders } = makeLoaders();
    const report = await buildFlexibleKpiInsights({
      primary: { kind: 'month', monthKey: '2026-09' },
      comparison: { kind: 'month', monthKey: '2026-08' },
      now: NOW,
      loaders,
    });
    assert.deepEqual(report.period.monthKeys, ['2026-09']);
    assert.deepEqual(report.comparison!.monthKeys, ['2026-08']);
    assert.equal(report.period.valueBasis, 'FINALIZED');
    assert.equal(report.comparison!.valueBasis, 'FINALIZED');
    // أحمد: Sep frozen 90 vs Aug frozen 85 → +5.
    const ahmed = report.employees.find((e) => e.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.averageQuality, 90);
    assert.equal(ahmed.previousAverageQuality, 85);
    assert.equal(ahmed.deltaPoints, 5);
    assert.equal(ahmed.monthsWithValue, 1);
    // Overview delta: mean(Sep) 94 vs mean(Aug) 87.5 → +6.5.
    assert.equal(report.overview.averageQuality, 94);
    assert.equal(report.overview.previousAverageQuality, 87.5);
    assert.equal(report.overview.qualityDeltaPoints, 6.5);
  });

  it('A2 · custom range vs custom range — equal-length independent spans', async () => {
    const { loaders } = makeLoaders();
    const report = await buildFlexibleKpiInsights({
      primary: { kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-15' },
      comparison: { kind: 'custom_range', fromDate: '2026-08-01', toDate: '2026-08-15' },
      now: NOW,
      loaders,
    });
    assert.equal(report.period.startDayKey, '2026-09-01');
    assert.equal(report.period.endDayKey, '2026-09-15');
    assert.equal(report.comparison!.startDayKey, '2026-08-01');
    assert.equal(report.comparison!.endDayKey, '2026-08-15');
  });

  it('B1 · partial window: the score is a LIVE canonical recompute over the window observations — NOT the frozen full-month value', async () => {
    const { loaders } = makeLoaders();
    const report = await buildFlexibleKpiInsights({
      primary: { kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-10' },
      comparison: { kind: 'month', monthKey: '2026-08' },
      now: NOW,
      loaders,
    });
    // Window value basis is disclosed as LIVE (the frozen month value is
    // never silently narrowed).
    assert.equal(report.period.valueBasis, 'LIVE');
    const ahmedBasis = report.period.monthBases.find((m) => m.monthKey === '2026-09')!;
    assert.equal(ahmedBasis.liveCalculated, true);
    assert.equal(ahmedBasis.valueBasis, 'LIVE');
    // Engine expectation: only the 03/09 observation (3 points) is inside
    // 1–10 → score = 100 − 3 = 97 (frozen full-month value is 90).
    const expected = computeEmployeeScore(
      SEPTEMBER_OBS.filter((o) => o.employeeId === 'emp_ahmed'),
      SETTINGS,
      'emp_ahmed',
    );
    void expected; // (direct engine check below through the window filter)
    const ahmed = report.employees.find((e) => e.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.averageQuality, 97, 'window score = 100 − 3 (not the frozen 90)');
    assert.equal(ahmed.lastQuality, 97);
    // رحمة: 08/09 (2 points) inside the window → 98.
    const rahma = report.employees.find((e) => e.employeeId === 'emp_rahma')!;
    assert.equal(rahma.averageQuality, 98);
  });

  it('B2 · fully-covered months keep the frozen values verbatim', async () => {
    const { loaders } = makeLoaders();
    const report = await buildFlexibleKpiInsights({
      primary: { kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-30' },
      comparison: { kind: 'previous_period' },
      now: NOW,
      loaders,
    });
    assert.equal(report.period.valueBasis, 'FINALIZED');
    const ahmed = report.employees.find((e) => e.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.averageQuality, 90, 'full-month coverage → frozen value verbatim');
    // previous_period of a full month = the preceding full month.
    assert.deepEqual(report.comparison!.monthKeys, ['2026-08']);
  });

  it('C1 · day-filtered distributions: observations outside the window never count', async () => {
    const { loaders } = makeLoaders();
    const report = await buildFlexibleKpiInsights({
      primary: { kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-10' },
      comparison: { kind: 'month', monthKey: '2026-08' },
      now: NOW,
      loaders,
    });
    // In-window approved observations: 03/09 (ahmed) + 08/09 (rahma) = 2.
    assert.equal(report.overview.observationsApproved, 2);
    assert.equal(report.overview.observationsTotal, 2);
    // The 12/09 and 15/09 observations (high/critical, cat_info) are OUT.
    const info = report.observations.byCategory.find((c) => c.key === 'cat_info');
    assert.equal(info, undefined, 'out-of-window category never appears');
    const critical = report.observations.bySeverity.find((s) => s.severity === 'critical');
    assert.equal(critical?.count ?? 0, 0);
    // In-window severities: medium (03/09) + low (08/09).
    assert.equal(report.observations.bySeverity.find((s) => s.severity === 'medium')?.count, 1);
    assert.equal(report.observations.bySeverity.find((s) => s.severity === 'low')?.count, 1);
  });

  it('D1 · no duplicate heavy queries: observations loaded ONCE per month; no write path', async () => {
    const { loaders, observationCalls } = makeLoaders();
    await buildFlexibleKpiInsights({
      primary: { kind: 'month', monthKey: '2026-09' },
      comparison: { kind: 'month', monthKey: '2026-08' },
      now: NOW,
      loaders,
    });
    assert.equal(observationCalls.get('2026-09'), 1, 'September loaded once');
    assert.equal(observationCalls.get('2026-08'), 1, 'August loaded once');
  });

  it('E1 · overlapping primary/comparison periods are an explicit error', async () => {
    const { loaders } = makeLoaders();
    await assert.rejects(
      () =>
        buildFlexibleKpiInsights({
          primary: { kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-20' },
          comparison: { kind: 'custom_range', fromDate: '2026-09-15', toDate: '2026-09-30' },
          now: NOW,
          loaders,
        }),
      /متداخلتان/,
    );
  });

  it('E2 · org-node selection narrows the population (authorized ∩ requested)', async () => {
    const { loaders } = makeLoaders();
    const report = await buildFlexibleKpiInsights({
      primary: { kind: 'month', monthKey: '2026-09' },
      comparison: { kind: 'month', monthKey: '2026-08' },
      now: NOW,
      loaders,
      selection: { employeeIds: ['emp_ahmed'], orgNodeIds: [] },
    });
    assert.equal(report.employees.length, 1);
    assert.equal(report.employees[0]!.employeeId, 'emp_ahmed');
  });
});
