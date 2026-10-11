// ══════════════════════════════════════════════════════════════
//  KPI Insights workspace builder — focused tests (KPI Reports 2.0)
//
//  Run: npx tsx --test src/lib/kpi-reporting/__tests__/insights.test.ts
//
//  Covers the mandatory insights scenarios:
//    1  Overview aggregates from canonical rows (approved-only facts)
//    2  Change vs previous period — both value-bearing, else NULL
//       (missing data is never a zero, never a fake decline)
//    3  Category distribution over APPROVED observations only
//       (pending/rejected never become performance facts)
//    4  Severity distribution + previous-period counts
//    5  Repeated issues — canonical detection (≥2 occurrences) with
//       affected employees/teams; per-employee repeated count
//    6  Team/department units as operating units (avg, delta,
//       improving/declining, repeated issues per unit)
//    7  Employee selection narrows (∩ authorized scope); org-node
//       selection narrows by subtree; out-of-scope ids drop silently
//    8  Team/department scope vocabulary (canonical org nodes)
//    9  Data quality statuses (missing source = no_data, never 0)
//   10  Signals are structured facts (kinds + levels, capped)
//   11  Improvement opportunities with change % vs previous
//   12  No second engine: builder composes buildMonthlyKpiReport
//
//  Convention: pure builder + in-memory loaders (no Firebase mocking).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildKpiInsightsReport,
  type KpiInsightsLoaders,
} from '@/lib/kpi-reporting';
import {
  buildEmployeeKpiResult,
  withFinalizedAt,
  type EmployeeKpiResult,
  type KpiScheme,
} from '@/lib/kpi-framework';
import type { KpiSettings, MonthSnapshot, QualityObservation } from '@/types/quality-kpi';
import type { OrgNode } from '@/lib/organization/types';
import type { ReportEmployee } from '@/lib/kpi-reporting';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, '..');

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

const NOW = new Date(2026, 9, 21, 12, 0, 0); // 2026-10-21 — reported month is CLOSED September

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
  { id: 'node_sub_a', name: 'فريق الشمال الفرعي', type: 'subteam', parentId: 'node_team_a', managerUserId: null, status: 'active', order: 3, description: null, createdAt: '', updatedAt: '' },
  { id: 'node_team_b', name: 'فريق الجنوب', type: 'team', parentId: 'node_dept', managerUserId: null, status: 'active', order: 4, description: null, createdAt: '', updatedAt: '' },
];

const EMPLOYEES: ReportEmployee[] = [
  { id: 'emp_ahmed', code: '001', name: 'أحمد محمد', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'node_sub_a' },
  { id: 'emp_rahma', code: '002', name: 'رحمة حسام', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'node_team_a' },
  { id: 'emp_yaser', code: '003', name: 'ياسر فؤاد', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'node_team_b' },
  { id: 'emp_mona', code: '004', name: 'منى حسن', department: 'تقنية المعلومات', position: 'مهندس', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: null },
];

const TEAM_NAMES = new Map<string, string | null>([
  // Subteam employees report under their OWN subteam label (canonical
  // loadTeamNames semantics — the same source the monthly rows use).
  ['emp_ahmed', 'فريق الشمال الفرعي'],
  ['emp_rahma', 'فريق الشمال'],
  ['emp_yaser', 'فريق الجنوب'],
  ['emp_mona', null],
]);

let obsCounter = 0;
function makeObs(over: Partial<QualityObservation> & { employeeId: string; month: string }): QualityObservation {
  obsCounter += 1;
  const monthNum = over.month.slice(5, 7);
  const year = over.month.slice(0, 4);
  return {
    id: over.id ?? `obs_${obsCounter}`,
    schemaVersion: 1,
    employeeName: 'x',
    department: 'd',
    positionSnapshot: 'p',
    observerId: 'u1',
    observerName: 'مراقب الجودة',
    observationDate: over.observationDate ?? `05/${monthNum}/${year}`,
    type: over.type ?? 'quality_observation',
    severity: over.severity ?? 'medium',
    categoryId: over.categoryId ?? 'cat_followup',
    categoryName: over.categoryName ?? 'تأخر المتابعة',
    categoryWeight: 1,
    notes: over.notes ?? 'ملاحظة جودة',
    evidence: over.evidence ?? '',
    status: over.status ?? 'resolved',
    relatedCapaId: over.relatedCapaId ?? null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: null,
    applyPointDeduction: over.applyPointDeduction ?? true,
    isBonus: over.isBonus ?? false,
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

/** September observations (the reported month). */
const SEPTEMBER_OBS: QualityObservation[] = [
  // أحمد: 2× follow-up (repeated) + 1× info + 1 pending (never a fact)
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', severity: 'high', points: 3, observationDate: '03/09/2026' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', severity: 'medium', points: 2, observationDate: '12/09/2026' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', categoryId: 'cat_info', categoryName: 'معلومة خاطئة', severity: 'critical', points: 5, observationDate: '15/09/2026' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-09', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', approvalStatus: 'pending', points: 4, observationDate: '18/09/2026' }),
  // رحمة: 1 follow-up (repeats أحمد's category cross-employee) + 1 rejected
  makeObs({ employeeId: 'emp_rahma', month: '2026-09', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', severity: 'low', points: 2, observationDate: '08/09/2026' }),
  makeObs({ employeeId: 'emp_rahma', month: '2026-09', categoryId: 'cat_info', categoryName: 'معلومة خاطئة', approvalStatus: 'rejected', points: 2, observationDate: '09/09/2026' }),
  // ياسر: 1 packaging issue
  makeObs({ employeeId: 'emp_yaser', month: '2026-09', categoryId: 'cat_packaging', categoryName: 'تجهيز الطرد', severity: 'medium', points: 2, observationDate: '10/09/2026' }),
];

/** August (previous period): lower scores → September deltas are positive. */
const AUGUST_OBS: QualityObservation[] = [
  makeObs({ employeeId: 'emp_ahmed', month: '2026-08', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', points: 6, observationDate: '03/08/2026' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-08', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', points: 5, observationDate: '13/08/2026' }),
  makeObs({ employeeId: 'emp_rahma', month: '2026-08', categoryId: 'cat_followup', categoryName: 'تأخر المتابعة', points: 4, observationDate: '04/08/2026' }),
  makeObs({ employeeId: 'emp_yaser', month: '2026-08', categoryId: 'cat_packaging', categoryName: 'تجهيز الطرد', points: 3, observationDate: '06/08/2026' }),
];

const SCORES_SEP: Record<string, number> = { emp_ahmed: 90, emp_rahma: 92, emp_yaser: 80 };
const SCORES_AUG: Record<string, number> = { emp_ahmed: 85, emp_rahma: 80, emp_yaser: 84 };

function frozenKpiResults(scores: Record<string, number>, month: string): Record<string, EmployeeKpiResult> {
  const out: Record<string, EmployeeKpiResult> = {};
  for (const [employeeId, score] of Object.entries(scores)) {
    out[employeeId] = buildEmployeeKpiResult({
      employee: { id: employeeId },
      scheme: SCHEME,
      period: month,
      qualityScore: {
        score,
        deductionPoints: 100 - score,
        bonusPoints: 0,
        observationCount: 2,
      },
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

function makeLoaders(over: {
  employees?: ReportEmployee[];
  observations?: QualityObservation[];
  teamNames?: Map<string, string | null>;
} = {}): KpiInsightsLoaders {
  const employees = over.employees ?? EMPLOYEES;
  const observations = [...SEPTEMBER_OBS, ...AUGUST_OBS, ...(over.observations ?? [])];
  const teamNames = over.teamNames ?? TEAM_NAMES;
  return {
    // Engine pipeline loaders (canonical semantics, in-memory inputs)
    loadEmployee: async (employeeId) => {
      const record = employees.find((e) => e.id === employeeId);
      return record
        ? { id: record.id, name: record.name, department: record.department, status: record.status, hireDate: record.hireDate, createdAt: record.createdAt, archivedAt: record.archivedAt }
        : null;
    },
    loadEmploymentEvents: async () => [],
    loadSchemes: async () => [SCHEME],
    loadOverrides: async () => [],
    loadSnapshot: async (period) => {
      const snapshot = SNAPSHOTS.get(period);
      if (!snapshot) return null;
      const employeeScores: NonNullable<Awaited<ReturnType<KpiInsightsLoaders['loadSnapshot']>>>['employeeScores'] = {};
      for (const entry of Object.values(snapshot.employeeScores ?? {})) {
        employeeScores[entry.employeeSnapshot.employeeId] = {
          score: entry.score,
          deductionPoints: entry.deductionPoints,
          bonusPoints: entry.bonusPoints,
          observationCount: entry.observationCount,
        };
      }
      return {
        status: snapshot.status,
        closedAt: snapshot.closedAt,
        employeeScores,
        kpiResults: snapshot.kpiResults ?? null,
      };
    },
    loadLiveQualityScore: async () => null,
    // Reporting extras
    loadEmployeeRecord: async (employeeId) => employees.find((e) => e.id === employeeId) ?? null,
    loadEmployees: async () => employees,
    loadEmploymentEventsByEmployee: async () => new Map(),
    loadSnapshotDocument: async (monthKey) => SNAPSHOTS.get(monthKey) ?? null,
    loadMonthDetail: async (monthKey) => SNAPSHOTS.get(monthKey) ?? null,
    loadSnapshotDocuments: async (monthKeys) => {
      const map = new Map<string, MonthSnapshot>();
      for (const key of monthKeys) {
        const snap = SNAPSHOTS.get(key);
        if (snap) map.set(key, snap);
      }
      return map;
    },
    loadObservations: async (monthKey) => observations.filter((o) => o.month === monthKey),
    loadTeamNames: async () => teamNames,
    // Insights extras
    loadOrgNodes: async () => ORG_NODES,
    loadDomainAvailability: async () => ({
      followUps: 12,
      complaints: 0,
      capa: 3,
      attendance: 0,
      hrDeductions: 2,
    }),
  };
}

// ─────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────

describe('KPI insights builder — canonical composition (KPI Reports 2.0)', () => {
  it('1. composes the canonical monthly assembly: frozen rows verbatim + scheme', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    assert.equal(report.reportKind, 'INSIGHTS');
    assert.equal(report.valueBasis, 'FINALIZED');
    assert.equal(report.finalized, true);
    assert.equal(report.rows.length, 4); // 3 sales + منى (no data → PENDING, never zero)
    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed');
    assert.equal(ahmed?.quality?.rawScore, 90);
    assert.equal(ahmed?.rowStatus, 'FINALIZED');
    assert.equal(report.scheme?.schemeName, 'مخطط أداء الموظفين');
    // منى carries NO quality value — explicit PENDING, never a 0.
    const mona = report.rows.find((r) => r.employeeId === 'emp_mona');
    assert.equal(mona?.rowStatus, 'PENDING');
    assert.equal(mona?.quality, null);
  });

  it('2. change vs previous period: both value-bearing → delta; missing previous → NULL', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const ahmed = report.employeeFacts['emp_ahmed'];
    assert.equal(ahmed.previousRawScore, 85);
    assert.equal(ahmed.deltaPoints, 5);
    // منى has no August result → no fabricated decline.
    assert.equal(report.employeeFacts['emp_mona'].deltaPoints, null);
    assert.equal(report.employeeFacts['emp_mona'].previousRawScore, null);
    // Overview delta over the same set of employees.
    assert.equal(report.overview.previousAvgQuality, (85 + 80 + 84) / 3);
    assert.equal(report.overview.qualityDeltaPoints, 90 + 92 + 80 - (85 + 80 + 84) !== 0 ? Math.round(((90 + 92 + 80) / 3 - (85 + 80 + 84) / 3) * 100) / 100 : 0);
  });

  it('3. category distribution counts APPROVED observations only, with affected employees/teams', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const followup = report.categoryDistribution.find((c) => c.categoryId === 'cat_followup');
    // أحمد 2 approved + رحمة 1 approved = 3 (the pending 4th is NOT a fact)
    assert.equal(followup?.count, 3);
    assert.deepEqual([...followup!.affectedEmployeeIds].sort(), ['emp_ahmed', 'emp_rahma']);
    assert.ok(followup!.affectedTeamLabels.includes('فريق الشمال الفرعي'));
    const info = report.categoryDistribution.find((c) => c.categoryId === 'cat_info');
    assert.equal(info?.count, 1); // رحمة's rejected one is excluded
    assert.ok(!report.categoryDistribution.some((c) => c.categoryId === 'cat_info' && c.count === 2));
  });

  it('4. severity distribution with previous-period comparison', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const critical = report.severityDistribution.find((s) => s.severity === 'critical');
    assert.equal(critical?.count, 1);
    const low = report.severityDistribution.find((s) => s.severity === 'low');
    assert.equal(low?.count, 1);
    // August approved severities: medium(6pts), medium(5), low(4)? — August has medium/medium/medium/medium
    assert.equal(report.severityDistribution.find((s) => s.severity === 'critical')?.previousCount, 0);
  });

  it('5. repeated issues: canonical detection ≥2 occurrences + per-employee counts', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const followup = report.repeatedIssues.find((g) => g.categoryId === 'cat_followup');
    assert.ok(followup, 'follow-up category repeats 3× approved');
    assert.equal(followup!.occurrenceCount, 3);
    assert.equal(followup!.employeeCount, 2);
    assert.deepEqual([...followup!.affectedTeamLabels].sort(), ['فريق الشمال', 'فريق الشمال الفرعي']);
    // أحمد has follow-up ×2 approved → 1 repeated group; رحمة only 1 → none
    assert.equal(report.employeeFacts['emp_ahmed'].repeatedIssues, 1);
    assert.equal(report.employeeFacts['emp_rahma'].repeatedIssues, 0);
  });

  it('6. team/department units aggregate as operating units', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const northSub = report.teamUnits.find((u) => u.key === 'فريق الشمال الفرعي');
    assert.ok(northSub);
    assert.equal(northSub.employeeCount, 1);
    assert.equal(northSub.avgQuality, 90);
    assert.equal(northSub.deltaPoints, 5);
    assert.equal(northSub.observationsApproved, 3);
    assert.equal(northSub.highCritical, 2); // high + critical
    assert.equal(northSub.repeatedIssues, 1);
    const south = report.teamUnits.find((u) => u.key === 'فريق الجنوب');
    assert.equal(south?.improving, 0);
    assert.equal(south?.declining, 1);
    // Departments roll teams up
    const sales = report.departmentUnits.find((u) => u.key === 'المبيعات');
    assert.equal(sales?.employeeCount, 3);
  });

  it('7. selection narrows: employees ∩ authorized; org-node subtree; out-of-scope dropped', async () => {
    const loaders = makeLoaders();
    // Company-wide (authorized = null → everyone).
    const full = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders });
    assert.equal(full.selection.isCompanyWide, true);

    // Requested employees narrowed by an AUTHORIZED set: the effective
    // set is the INTERSECTION — out-of-scope ids drop silently.
    const narrowed = await buildKpiInsightsReport({
      monthKey: '2026-09',
      now: NOW,
      loaders,
      scopeLimit: ['emp_ahmed', 'emp_rahma'],
      selection: { employeeIds: ['emp_ahmed', 'emp_yaser'] }, // yaser is OUT of scope
    });
    assert.equal(narrowed.selection.isCompanyWide, false);
    assert.deepEqual(narrowed.rows.map((r) => r.employeeId).sort(), ['emp_ahmed']);

    // Team-node selection resolves the SUBTREE (subteam employees included).
    const north = await buildKpiInsightsReport({
      monthKey: '2026-09',
      now: NOW,
      loaders,
      selection: { orgNodeIds: ['node_team_a'] },
    });
    assert.deepEqual(north.rows.map((r) => r.employeeId).sort(), ['emp_ahmed', 'emp_rahma']);

    // Out-of-scope org node with a restricted scope → fail-closed empty.
    const empty = await buildKpiInsightsReport({
      monthKey: '2026-09',
      now: NOW,
      loaders,
      scopeLimit: ['emp_mona'],
      selection: { orgNodeIds: ['node_dept'] },
    });
    assert.equal(empty.rows.length, 0);
  });

  it('8. scope vocabulary lists canonical org nodes with in-scope employees', async () => {
    const report = await buildKpiInsightsReport({
      monthKey: '2026-09',
      now: NOW,
      loaders: makeLoaders(),
      scopeLimit: ['emp_ahmed', 'emp_rahma'],
    });
    // The authorized set only covers the northern team/subteam.
    assert.ok(report.vocab.teams.some((t) => t.nodeId === 'node_team_a'));
    assert.ok(report.vocab.teams.some((t) => t.nodeId === 'node_sub_a'));
    assert.ok(!report.vocab.teams.some((t) => t.nodeId === 'node_team_b'));
    assert.ok(report.vocab.departments.some((d) => d.nodeId === 'node_dept'));
  });

  it('9. data quality: populated vs empty sources (missing ≠ zero value)', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const bySource = new Map(report.dataQuality.map((d) => [d.source, d.status]));
    assert.equal(bySource.get('kpi'), 'available');
    assert.equal(bySource.get('quality'), 'available');
    assert.equal(bySource.get('followUps'), 'available');
    assert.equal(bySource.get('complaints'), 'no_data');
    assert.equal(bySource.get('attendance'), 'no_data');
  });

  it('10. signals are structured facts with deterministic levels (capped)', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    assert.ok(report.signals.length <= 8);
    // أحمد's high+critical observations → the high-severity signal exists.
    const high = report.signals.find((s) => s.kind === 'HIGH_SEVERITY');
    assert.ok(high);
    assert.equal(high!.level, 'critical');
    assert.equal(high!.count, 1);
    // Cross-employee repetition pattern: follow-up affects 2 employees.
    const pattern = report.signals.find((s) => s.kind === 'REPEATED_PATTERN');
    assert.ok(pattern);
    assert.equal(pattern!.level, 'warning');
    // ياسر declined 80 − 84 = −4 → below the −3 team signal? team delta
    // for فريق الجنوب is −4 → TEAM_DECLINE signal present.
    assert.ok(report.signals.some((s) => s.kind === 'TEAM_DECLINE' && s.teamLabel === 'فريق الجنوب'));
  });

  it('11. improvement opportunities carry facts + change % vs previous', async () => {
    const report = await buildKpiInsightsReport({ monthKey: '2026-09', now: NOW, loaders: makeLoaders() });
    const followup = report.opportunities.find((o) => o.categoryId === 'cat_followup');
    assert.ok(followup);
    assert.equal(followup.occurrenceCount, 3);
    assert.equal(followup.employeeCount, 2);
    assert.equal(followup.previousCount, 3); // August approved follow-ups
    assert.equal(followup.changePct, 0);
  });

  it('12. no second engine: the builder composes buildMonthlyKpiReport (source contract)', () => {
    const src = readFileSync(join(SRC, 'insights.ts'), 'utf8');
    assert.ok(src.includes("from './monthly-report'"));
    assert.ok(src.includes('buildMonthlyKpiReport'));
    assert.ok(src.includes("from '@/lib/performance-intelligence/quality-analysis'"));
    // No score recomputation exists in the insights layer.
    assert.ok(!src.includes('computeEmployeeScore'));
    assert.ok(!src.includes('defaultScore -'));
    assert.ok(!src.includes('defaultScore −'));
  });
});
