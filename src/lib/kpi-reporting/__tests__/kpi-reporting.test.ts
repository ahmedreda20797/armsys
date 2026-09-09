// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — focused tests (Phase 2, spec §34)
//
//  Run: npx tsx --test src/lib/kpi-reporting/__tests__/kpi-reporting.test.ts
//
//  Covers the mandatory reporting scenarios:
//    1  Employee Quality report assembly
//    2  Quality RAW score display (raw ≠ contribution)
//    3  Quality weighted contribution (raw × weight / 100)
//    4  Current 15% configuration (weight from scheme)
//    5  Future changed weight configuration (20% flows through)
//    6  MTD report (live, clearly NOT final)
//    7  Finalized monthly report (frozen verbatim)
//    8  Historical report + scheme/version display (§9/§10)
//    9  Scheme version preservation (frozen v1 vs current v2)
//    10 Archived employee historical visibility
//    11 Post-archive exclusion (no manufactured zeros)
//    12 Missing component = NOT AVAILABLE (PENDING placeholders)
//    13 Missing data ≠ zero (PENDING vs real ZERO)
//    14 Quality-only KPI = INCOMPLETE
//    15 Month Close uses the frozen snapshot (live changes ignored)
//    16 Current scheme change does not alter history
//    17 Permission enforcement (route contract, static analysis)
//    18 Employee filtering (name/code/id search)
//    19 Department/team filtering
//    20 No duplicated Quality calculations (engine parity)
//    + trend gaps (§16), MoM percentage points (§17), management
//      summary QUALITY_KPI labeling (§15), export parity (§22),
//      scope fail-closed, legacy derived snapshots.
//
//  Convention: pure builders + in-memory loaders (no Firebase mocking).
//  The canonical engine remains the only calculation path.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildEmployeeKpiReport,
  buildMonthlyKpiReport,
  buildKpiManagementSummary,
  buildSummaryPayload,
  toFrameworkEmployee,
} from '@/lib/kpi-reporting';
import { toKpiMonthlyExportRows } from '@/lib/reports/runners/kpi-monthly';
import { getRegisteredReport, validateRegistry } from '@/lib/reports/registry';
import { buildEmployeeKpiResult, withFinalizedAt } from '@/lib/kpi-framework';
import type { EmployeeKpiResult, KpiScheme } from '@/lib/kpi-framework';
import { computeEmployeeScore, computeMonthSnapshot } from '@/lib/metrics/kpiMetrics';
import type { KpiSettings, MonthSnapshot, QualityObservation } from '@/types/quality-kpi';
import type { KpiReportingLoaders, ReportEmployee } from '@/lib/kpi-reporting';
import { KPI_REPORT_STATUS_RANK } from '@/lib/kpi-reporting';

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

/** Mid-month noon — local/UTC calendar can never disagree. */
const NOW_AUG = new Date(2026, 7, 21, 12, 0, 0); // 2026-08-21
const NOW_SEP = new Date(2026, 8, 5, 12, 0, 0);  // 2026-09-05

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

function makeScheme(overrides: Partial<KpiScheme> = {}): KpiScheme {
  return {
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
    ...overrides,
  };
}

/** The CURRENT configuration after a future weight change (Quality 20%). */
function makeSchemeV2(): KpiScheme {
  const v2 = makeScheme({ id: 'scheme_v2', version: 2, previousSchemeId: 'scheme_v1' });
  v2.components = [
    { ...v2.components[0], weight: 20 },
    { ...v2.components[1] },
    { ...v2.components[2] },
    { ...v2.components[3] },
  ];
  return v2;
}

function makeEmployee(over: Partial<ReportEmployee> & { id: string }): ReportEmployee {
  return {
    code: null,
    name: over.id,
    department: 'المبيعات',
    position: 'مندوب مبيعات',
    status: 'active',
    hireDate: null,
    createdAt: '2026-01-10T00:00:00.000Z',
    archivedAt: null,
    orgNodeId: null,
    ...over,
  };
}

const EMPLOYEES: ReportEmployee[] = [
  makeEmployee({ id: 'emp_ahmed', name: 'أحمد محمد', code: '001' }),
  makeEmployee({
    id: 'emp_sara',
    name: 'سارة علي',
    code: '002',
    status: 'archived',
    archivedAt: '2026-08-20T10:00:00.000Z',
  }),
  makeEmployee({ id: 'emp_gone', name: 'كريم سيد', code: '003', status: 'archived', archivedAt: '2026-06-30T10:00:00.000Z', createdAt: '2026-01-15T00:00:00.000Z' }),
  makeEmployee({ id: 'emp_nodata', name: 'منى حسن', code: '004', department: 'تقنية المعلومات' }),
  makeEmployee({ id: 'emp_zero', name: 'عمر فؤاد', code: '005' }),
];

const EVENTS_BY_EMPLOYEE = new Map<string, Array<{ kind: 'archived' | 'restored'; effectiveAt: string }>>([
  ['emp_sara', [{ kind: 'archived', effectiveAt: '2026-08-20T10:00:00.000Z' }]],
  ['emp_gone', [{ kind: 'archived', effectiveAt: '2026-06-30T10:00:00.000Z' }]],
]);

const TEAM_NAMES = new Map<string, string | null>([
  ['emp_ahmed', 'فريق المبيعات الشمال'],
  ['emp_sara', 'فريق المبيعات الشمال'],
]);

let obsCounter = 0;
function makeObs(over: Partial<QualityObservation> & { employeeId: string; month: string; points: number }): QualityObservation {
  obsCounter += 1;
  return {
    id: over.id ?? `obs_${obsCounter}`,
    schemaVersion: 1,
    employeeName: 'x',
    department: 'd',
    positionSnapshot: 'p',
    observerId: 'u1',
    observerName: 'مراقب الجودة',
    observationDate: over.observationDate ?? '05/08/2026',
    type: over.type ?? 'deduction',
    severity: over.severity ?? 'medium',
    categoryId: over.categoryId ?? 'cat_late',
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
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    ...over,
  } as QualityObservation;
}

/** Live August observations: أحمد 91 (5+4 deductions, 1 pending ignored). */
const AUGUST_OBS: QualityObservation[] = [
  makeObs({ employeeId: 'emp_ahmed', month: '2026-08', points: 5, observationDate: '03/08/2026', evidence: 'https://example.com/evidence/1' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-08', points: 4, observationDate: '12/08/2026' }),
  makeObs({ employeeId: 'emp_ahmed', month: '2026-08', points: 3, approvalStatus: 'pending', observationDate: '15/08/2026' }),
  makeObs({ employeeId: 'emp_sara', month: '2026-08', points: 5, observationDate: '08/08/2026', relatedCapaId: 'capa_1' }),
  makeObs({ employeeId: 'emp_zero', month: '2026-08', points: 100, observationDate: '09/08/2026', severity: 'critical' }),
];

const OBSERVATIONS: QualityObservation[] = [
  ...AUGUST_OBS,
  makeObs({ employeeId: 'emp_ahmed', month: '2026-02', points: 30, observationDate: '10/02/2026' }),
];

// ── Frozen snapshots (May 82 / June 86 / July 88) ──
const V1 = makeScheme();

function frozenResult(employeeId: string, month: string, score: number): EmployeeKpiResult {
  return buildEmployeeKpiResult({
    employee: { id: employeeId },
    scheme: V1,
    period: month,
    qualityScore: { score, deductionPoints: 100 - score, bonusPoints: 0, observationCount: 2 },
    origin: 'month_snapshot',
    finalizedAt: '2026-09-01T00:00:00.000Z',
  });
}

function makeClosedSnapshot(month: string, scores: Record<string, number>, withKpiResults: boolean): MonthSnapshot {
  const kpiResults: Record<string, EmployeeKpiResult> = {};
  const employeeScores: MonthSnapshot['employeeScores'] = {};
  for (const [employeeId, score] of Object.entries(scores)) {
    if (withKpiResults) kpiResults[employeeId] = frozenResult(employeeId, month, score);
    employeeScores[employeeId] = {
      employeeSnapshot: {
        employeeId,
        employeeName: EMPLOYEES.find((e) => e.id === employeeId)?.name ?? employeeId,
        departmentId: 'd1',
        departmentName: 'المبيعات',
        position: 'مندوب مبيعات',
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
    closedAt: '2026-09-01T00:00:00.000Z',
    closedBy: 'u1',
    closedByName: 'المدير العام',
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: '2026-09-01T00:00:00.000Z',
    settingsSnapshot: SETTINGS,
    employeeScores,
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
    ...(withKpiResults ? { kpiResults: withFinalizedAt(kpiResults, '2026-09-01T00:00:00.000Z') } : {}),
  };
}

const SNAPSHOTS = new Map<string, MonthSnapshot>([
  ['2026-05', makeClosedSnapshot('2026-05', { emp_ahmed: 82, emp_gone: 78 }, true)],
  ['2026-06', makeClosedSnapshot('2026-06', { emp_ahmed: 86, emp_gone: 80 }, true)],
  ['2026-07', makeClosedSnapshot('2026-07', { emp_ahmed: 88, emp_sara: 84 }, true)],
  // Legacy closed month: frozen scores but NO framework results.
  ['2026-04', makeClosedSnapshot('2026-04', { emp_ahmed: 85 }, false)],
]);

// ─────────────────────────────────────────────────────────────
//  In-memory loaders
// ─────────────────────────────────────────────────────────────

interface LoaderOverrides {
  schemes?: KpiScheme[];
  snapshots?: Map<string, MonthSnapshot>;
  observations?: QualityObservation[];
}

function makeLoaders(over: LoaderOverrides = {}): KpiReportingLoaders {
  const schemes = over.schemes ?? [V1];
  const snapshots = over.snapshots ?? SNAPSHOTS;
  const observations = over.observations ?? OBSERVATIONS;

  const scoreEntryOf = (entry: MonthSnapshot['employeeScores'][string]) => ({
    score: entry.score,
    deductionPoints: entry.deductionPoints,
    bonusPoints: entry.bonusPoints,
    observationCount: entry.observationCount,
  });

  return {
    // Engine pipeline loaders (canonical semantics, in-memory inputs)
    loadEmployee: async (employeeId) => {
      const record = EMPLOYEES.find((e) => e.id === employeeId);
      return record ? toFrameworkEmployee(record) : null;
    },
    loadEmploymentEvents: async (employeeId) => EVENTS_BY_EMPLOYEE.get(employeeId) ?? [],
    loadSchemes: async () => schemes,
    loadOverrides: async () => [],
    loadSnapshot: async (period) => {
      const snapshot = snapshots.get(period);
      if (!snapshot) return null;
      const employeeScores: NonNullable<
        Awaited<ReturnType<KpiReportingLoaders['loadSnapshot']>>
      >['employeeScores'] = {};
      for (const [, entry] of Object.entries(snapshot.employeeScores ?? {})) {
        employeeScores[entry.employeeSnapshot.employeeId] = scoreEntryOf(entry);
      }
      return {
        status: snapshot.status,
        closedAt: snapshot.closedAt,
        employeeScores,
        kpiResults: snapshot.kpiResults ?? null,
      };
    },
    loadLiveQualityScore: async (employeeId, period) => {
      const snapshot = snapshots.get(period);
      if (snapshot?.status === 'closed') return null;
      const monthObs = observations.filter((o) => o.month === period && o.employeeId === employeeId);
      if (monthObs.length === 0) return null;
      const score = computeEmployeeScore(monthObs as never[], SETTINGS, employeeId);
      return {
        score: score.score,
        deductionPoints: score.deductionPoints,
        bonusPoints: score.bonusPoints,
        observationCount: score.observationCount,
      };
    },

    // Reporting extras
    loadEmployeeRecord: async (employeeId) => EMPLOYEES.find((e) => e.id === employeeId) ?? null,
    loadEmployees: async () => EMPLOYEES,
    loadEmploymentEventsByEmployee: async () => EVENTS_BY_EMPLOYEE,
    loadSnapshotDocument: async (period) => snapshots.get(period) ?? null,
    // Closed → stored document verbatim; open → engine live preview via
    // the canonical computeMonthSnapshot (same as the snapshot service).
    loadMonthDetail: async (period) => {
      const stored = snapshots.get(period);
      if (stored && stored.status === 'closed') return stored;
      const monthObs = observations.filter((o) => o.month === period);
      const empMap = new Map(
        EMPLOYEES.map((e) => [e.id, { id: e.id, name: e.name, department: e.department, position: e.position }]),
      );
      const computed = computeMonthSnapshot(monthObs as never[], period, empMap, new Map(), SETTINGS);
      return { ...computed, id: period, status: 'open' } as MonthSnapshot;
    },
    loadSnapshotDocuments: async (monthKeys) => {
      const map = new Map<string, MonthSnapshot>();
      for (const key of monthKeys) {
        const snapshot = snapshots.get(key);
        if (snapshot) map.set(key, snapshot);
      }
      return map;
    },
    loadObservations: async (monthKey) => observations.filter((o) => o.month === monthKey),
    loadTeamNames: async () => TEAM_NAMES,
  };
}

// ─────────────────────────────────────────────────────────────
//  1–5 · Employee report: assembly, raw score, contribution, weights
// ─────────────────────────────────────────────────────────────

describe('employee quality report (spec §4/§5/§13)', () => {
  it('1 · assembles employee identity, period and quality slice', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );

    assert.equal(report.reportKind, 'EMPLOYEE');
    assert.equal(report.outcomeStatus, 'RESOLVED');
    assert.equal(report.employee.employeeName, 'أحمد محمد');
    assert.equal(report.employee.employeeCode, '001');
    assert.equal(report.employee.department, 'المبيعات');
    assert.equal(report.employee.team, 'فريق المبيعات الشمال');
    assert.equal(report.employee.employmentStatus, 'active');
    assert.equal(report.period.monthKey, '2026-08');
    assert.equal(report.period.valueBasis, 'MTD');
  });

  it('2 · displays the RAW quality score separately (91%, not the contribution)', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    assert.equal(report.quality!.rawScore, 91);
    assert.notEqual(report.quality!.rawScore, 13.65);
    // Raw score is the quality-domain value; contribution is separate.
    assert.equal(report.quality!.weightedContribution, 13.65);
  });

  it('3 · contribution = rawScore × weight / 100 (engine output verbatim)', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    assert.equal(report.quality!.weight, 15);
    assert.equal(report.quality!.weightedContribution, 13.65); // 91 × 15 / 100
    assert.equal(report.quality!.maxContribution, 15);
  });

  it('4 · current configuration: weight comes from the scheme (15%), not a constant', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    // The scheme fixture carries quality weight 15 — the report echoes it.
    assert.equal(report.scheme!.qualityWeight, 15);
    assert.equal(report.scheme!.schemeVersion, 1);
  });

  it('5 · future changed weight (20%) flows through live reporting with NO code change', async () => {
    const loaders = makeLoaders({ schemes: [makeSchemeV2()] });
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders },
    );
    assert.equal(report.quality!.weight, 20);
    assert.equal(report.quality!.weightedContribution, 18.2); // 91 × 20 / 100
    assert.equal(report.scheme!.qualityWeight, 20);
  });
});

// ─────────────────────────────────────────────────────────────
//  6–8 · MTD / Finalized / Historical
// ─────────────────────────────────────────────────────────────

describe('MTD vs FINAL (spec §6/§7/§8/§9)', () => {
  it('6 · MTD report: live values, explicitly NOT final', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-08', reportKind: 'MTD', now: NOW_AUG, loaders: makeLoaders() },
    );
    assert.equal(report.valueBasis, 'MTD');
    assert.equal(report.finalized, false);
    assert.equal(report.asOfDate, '2026-08-21');

    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.ok(ahmed, 'eligible employee present');
    assert.equal(ahmed.valueBasis, 'MTD');
    assert.equal(ahmed.finalized, false);
    assert.equal(ahmed.resultSource, 'LIVE');
    assert.equal(ahmed.quality!.rawScore, 91); // live through Aug 21
  });

  it('7 · finalized monthly report: frozen values verbatim', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-07', reportKind: 'MONTHLY', now: NOW_AUG, loaders: makeLoaders() },
    );
    assert.equal(report.finalized, true);
    assert.equal(report.valueBasis, 'FINALIZED');
    assert.equal(report.closedByName, 'المدير العام');

    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.resultSource, 'FROZEN_RESULT');
    assert.equal(ahmed.quality!.rawScore, 88);
    assert.equal(ahmed.quality!.weightedContribution, 13.2);
    assert.equal(ahmed.finalizedAt, '2026-09-01T00:00:00.000Z');
    assert.equal(ahmed.rowStatus, 'FINALIZED');
  });

  it('8 · historical report: frozen snapshot + scheme/version display (§9/§10)', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-06', reportKind: 'HISTORICAL', now: NOW_AUG, loaders: makeLoaders() },
    );
    assert.equal(report.scheme!.schemeId, 'scheme_v1');
    assert.equal(report.scheme!.schemeName, 'مخطط أداء الموظفين');
    assert.equal(report.scheme!.schemeVersion, 1);
    assert.equal(report.scheme!.qualityWeight, 15);
    assert.equal(report.scheme!.frozen, true);
    assert.equal(report.derivedLegacy, false);
  });

  it('past month that was never closed → LIVE basis, never labeled MTD/FINAL', async () => {
    const snapshots = new Map(SNAPSHOTS);
    snapshots.delete('2026-06');
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-06', reportKind: 'HISTORICAL', now: NOW_AUG, loaders: makeLoaders({ snapshots }) },
    );
    assert.equal(report.valueBasis, 'LIVE');
    assert.equal(report.finalized, false);
    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.valueBasis, 'LIVE');
  });
});

// ─────────────────────────────────────────────────────────────
//  9 / 15 / 16 · Immutability & version preservation
// ─────────────────────────────────────────────────────────────

describe('immutability (spec §9/§15/§16/§26)', () => {
  it('9 · frozen scheme version is preserved while the current scheme is v2', async () => {
    const loaders = makeLoaders({ schemes: [makeSchemeV2()] });
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-07', reportKind: 'HISTORICAL', now: NOW_AUG, loaders,
        filters: { includeArchived: true } },
    );
    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    // Frozen result keeps v1 + weight 15 even though the current scheme is v2/20%.
    assert.equal(ahmed.schemeVersion, 1);
    assert.equal(ahmed.schemeId, 'scheme_v1');
    assert.equal(ahmed.quality!.weight, 15);
    assert.equal(ahmed.quality!.weightedContribution, 13.2);
    assert.equal(report.scheme!.schemeVersion, 1);
    assert.equal(report.scheme!.frozen, true);
  });

  it('15 · closed month ignores later LIVE observation changes (frozen wins)', async () => {
    // Live data now implies a different score than the frozen 88.
    const changedLive = [
      ...OBSERVATIONS.filter((o) => o.month !== '2026-07'),
      makeObs({ employeeId: 'emp_ahmed', month: '2026-07', points: 40 }),
    ];
    const loaders = makeLoaders({ observations: changedLive });
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-07', now: NOW_AUG , loaders },
    );
    assert.equal(report.outcomeStatus, 'FROZEN_RESULT');
    assert.equal(report.quality!.rawScore, 88); // frozen, not 60
    assert.equal(report.period.valueBasis, 'FINALIZED');
  });

  it('16 · current scheme change does NOT alter closed-month history', async () => {
    const loaders = makeLoaders({ schemes: [makeSchemeV2()] });
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-06', reportKind: 'HISTORICAL', now: NOW_AUG, loaders },
    );
    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.quality!.rawScore, 86);
    assert.equal(ahmed.quality!.weightedContribution, 12.9); // 86 × 15% (frozen), NOT 17.2
  });

  it('legacy closed snapshot (no kpiResults) → DERIVED view, flagged', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-04', reportKind: 'HISTORICAL', now: NOW_AUG, loaders: makeLoaders() },
    );
    assert.equal(report.derivedLegacy, true);
    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.equal(ahmed.resultSource, 'DERIVED');
    assert.equal(ahmed.quality!.rawScore, 85);
    assert.equal(ahmed.quality!.weightedContribution, 12.75); // derived via engine builder
    assert.equal(ahmed.finalized, true);
  });
});

// ─────────────────────────────────────────────────────────────
//  10 / 11 · Archive lifecycle (spec §11)
// ─────────────────────────────────────────────────────────────

describe('archive lifecycle (spec §11)', () => {
  it('10 · employee archived mid-month stays VISIBLE in that month with valid results', async () => {
    // §10: archived employees are excluded by default — opt in to keep
    // this archive-lifecycle test asserting the historical visibility.
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-08', reportKind: 'MTD', now: NOW_AUG, loaders: makeLoaders(),
        filters: { includeArchived: true } },
    );
    const sara = report.rows.find((r) => r.employeeId === 'emp_sara')!;
    assert.ok(sara, 'archived employee visible for the month she worked');
    assert.equal(sara.archivedButEligible, true);
    assert.equal(sara.quality!.rawScore, 95);
    assert.equal(sara.employmentStatus, 'archived');

    // Also visible in her frozen July history.
    const july = await buildMonthlyKpiReport(
      { monthKey: '2026-07', reportKind: 'HISTORICAL', now: NOW_AUG, loaders: makeLoaders(),
        filters: { includeArchived: true } },
    );
    assert.ok(july.rows.find((r) => r.employeeId === 'emp_sara'));
  });

  it('11 · post-archive periods exclude the employee entirely (no zero rows)', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-09', reportKind: 'MONTHLY', now: NOW_SEP, loaders: makeLoaders() },
    );
    assert.ok(!report.rows.some((r) => r.employeeId === 'emp_sara'), 'no row at all');
    assert.ok(!report.rows.some((r) => r.employeeId === 'emp_gone'), 'no row at all');
    assert.ok(report.totals.notEligibleCount >= 2, 'exclusions are counted');

    const employeeReport = await buildEmployeeKpiReport(
      { employeeId: 'emp_sara', monthKey: '2026-09', now: NOW_SEP , loaders: makeLoaders() },
    );
    assert.equal(employeeReport.outcomeStatus, 'NOT_ELIGIBLE_PERIOD');
    assert.equal(employeeReport.rowStatus, 'NOT_ELIGIBLE');
    assert.equal(employeeReport.overallStatus, null);
    assert.ok(employeeReport.message);
  });

  it('MID-month archive: eligible through the archive date (day-level, §11)', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_sara', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    assert.equal(report.outcomeStatus, 'RESOLVED');
    assert.equal(report.employee.archivedButEligible, true);
  });
});

// ─────────────────────────────────────────────────────────────
//  12 / 13 / 14 · Status semantics (spec §12/§14)
// ─────────────────────────────────────────────────────────────

describe('status semantics (spec §12/§14)', () => {
  it('12 · missing components are explicit NOT-AVAILABLE placeholders', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    const pending = report.components.filter((c) => c.status === 'PENDING');
    assert.equal(pending.length, 3); // manager / hr / target
    for (const component of pending) {
      assert.equal(component.rawScore, null);
      assert.equal(component.weightedContribution, null);
    }
    assert.equal(report.overallStatus, 'INCOMPLETE');
  });

  it('13 · missing data is PENDING (never 0) while a real zero is ZERO', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-08', reportKind: 'MTD', now: NOW_AUG, loaders: makeLoaders() },
    );

    const nodata = report.rows.find((r) => r.employeeId === 'emp_nodata')!;
    assert.equal(nodata.rowStatus, 'PENDING');
    assert.equal(nodata.quality, null); // no fabricated slice
    assert.equal(nodata.weightedTotal, null);

    const zero = report.rows.find((r) => r.employeeId === 'emp_zero')!;
    assert.equal(zero.rowStatus, 'ZERO');
    assert.equal(zero.quality!.rawScore, 0); // a real computed zero
    assert.equal(zero.quality!.status, 'ZERO');

    assert.equal(report.totals.pending, 1);
    assert.equal(report.totals.zero, 1);
  });

  it('14 · Quality-only configuration yields Company KPI = INCOMPLETE', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    assert.equal(report.quality!.status, 'AVAILABLE');
    assert.equal(report.overallStatus, 'INCOMPLETE'); // quality available, total incomplete
    assert.equal(report.weightedTotal, 13.65);       // available set only — no redistribution
    assert.equal(report.availableWeight, 15);
  });
});

// ─────────────────────────────────────────────────────────────
//  17 · Permission enforcement (route contract, static analysis)
// ─────────────────────────────────────────────────────────────

describe('permission enforcement (spec §24)', () => {
  const SRC_ROOT = join(__dirname, '..', '..', '..');
  const ROUTES = [
    'app/api/kpi-reports/employee/route.ts',
    'app/api/kpi-reports/monthly/route.ts',
    'app/api/kpi-reports/mtd/route.ts',
    'app/api/kpi-reports/historical/route.ts',
    'app/api/kpi-reports/summary/route.ts',
  ];

  it('every KPI reporting route authenticates AND verifies the kpiReports permission', () => {
    for (const rel of ROUTES) {
      const path = join(SRC_ROOT, rel);
      assert.ok(existsSync(path), `route exists: ${rel}`);
      const src = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      assert.match(src, /await\s+requireAuth\(request\)/, `${rel}: awaited requireAuth`);
      assert.match(src, /await\s+verifyPermission\(request,\s*'kpiReports'/, `${rel}: awaited kpiReports gate`);
      assert.match(src, /resolveEmployeeScopeFromDb/, `${rel}: authorized scope resolution`);
    }
  });

  it('registry reports are gated by the SAME kpiReports key (no parallel system)', () => {
    assert.deepEqual(validateRegistry(), []);
    for (const reportId of ['kpi-monthly', 'kpi-mtd', 'kpi-historical']) {
      const registered = getRegisteredReport(reportId);
      assert.ok(registered, `${reportId} registered`);
      assert.equal(registered.definition.permission.pageId, 'kpiReports');
      assert.ok(registered.definition.exportFormats.includes('excel'));
      assert.ok(registered.definition.exportFormats.includes('view'));
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  18 / 19 · Filtering (spec §19/§20)
// ─────────────────────────────────────────────────────────────

describe('filtering & search (spec §19/§20)', () => {
  const AUG = { monthKey: '2026-08', reportKind: 'MONTHLY' as const, now: NOW_AUG };

  it('18 · employee search matches name, code and id substrings', async () => {
    // §10: opt in to archived so the test sees the full fixture.
    const byName = await buildMonthlyKpiReport({ ...AUG, loaders: makeLoaders(), filters: { employeeQuery: 'أحمد', includeArchived: true } });
    assert.deepEqual(byName.rows.map((r) => r.employeeId), ['emp_ahmed']);

    const byCode = await buildMonthlyKpiReport({ ...AUG, loaders: makeLoaders(), filters: { employeeQuery: '002', includeArchived: true } });
    assert.deepEqual(byCode.rows.map((r) => r.employeeId), ['emp_sara']);

    const byId = await buildMonthlyKpiReport({ ...AUG, loaders: makeLoaders(), filters: { employeeQuery: 'emp_zero', includeArchived: true } });
    assert.deepEqual(byId.rows.map((r) => r.employeeId), ['emp_zero']);
  });

  it('19 · department and team filters narrow the report', async () => {
    const byDept = await buildMonthlyKpiReport({ ...AUG, loaders: makeLoaders(), filters: { department: 'تقنية المعلومات', includeArchived: true } });
    assert.deepEqual(byDept.rows.map((r) => r.employeeId), ['emp_nodata']);

    const byTeam = await buildMonthlyKpiReport({ ...AUG, loaders: makeLoaders(), filters: { team: 'فريق المبيعات الشمال', includeArchived: true } });
    assert.deepEqual(byTeam.rows.map((r) => r.employeeId).sort(), ['emp_ahmed', 'emp_sara']);
  });

  it('score range never matches rows without a numeric raw score (§12)', async () => {
    const range = await buildMonthlyKpiReport({ ...AUG, loaders: makeLoaders(), filters: { minScore: 0, maxScore: 100 } });
    // Every row WITH a value matches; the PENDING row does not.
    assert.ok(!range.rows.some((r) => r.employeeId === 'emp_nodata'));
    assert.ok(range.rows.some((r) => r.employeeId === 'emp_zero')); // real zero matches
  });

  it('authorized scope narrows rows BEFORE filters (fail-closed on empty)', async () => {
    const scoped = await buildMonthlyKpiReport({
      ...AUG,
      loaders: makeLoaders(),
      filters: { scopeLimit: ['emp_ahmed'] },
    });
    assert.deepEqual(scoped.rows.map((r) => r.employeeId), ['emp_ahmed']);
    assert.equal(scoped.totals.eligibleCount, 1);

    const failClosed = await buildMonthlyKpiReport({
      ...AUG,
      loaders: makeLoaders(),
      filters: { scopeLimit: [] },
    });
    assert.equal(failClosed.rows.length, 0);
    assert.equal(failClosed.totals.eligibleCount, 0);
  });

  it('sorting: score desc puts nulls last; status sort is rank-deterministic', async () => {
    // §10: archived employees are excluded by default — opt in here so
    // the test sees the same data the previous behavior produced.
    const byScore = await buildMonthlyKpiReport({
      ...AUG, loaders: makeLoaders(),
      sort: { key: 'score', direction: 'desc' },
      filters: { includeArchived: true },
    });
    const scores = byScore.rows.map((r) => r.quality?.rawScore ?? null);
    assert.deepEqual(scores.slice(0, 2), [95, 91]);
    assert.equal(scores[scores.length - 1], null); // pending last

    const byStatus = await buildMonthlyKpiReport({
      ...AUG, loaders: makeLoaders(), sort: { key: 'status', direction: 'asc' },
      filters: { includeArchived: true },
    });
    const ranks = byStatus.rows.map((r) => KPI_REPORT_STATUS_RANK[r.rowStatus]);
    assert.deepEqual([...ranks].sort((a, b) => a - b), ranks);
  });
});

// ─────────────────────────────────────────────────────────────
//  20 · Engine parity — the reporting layer never recomputes
// ─────────────────────────────────────────────────────────────

describe('no duplicated quality calculation (spec §20/§33)', () => {
  it('live rows equal the canonical engine output bit-for-bit', async () => {
    const loaders = makeLoaders();
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-08', reportKind: 'MTD', now: NOW_AUG, loaders },
    );
    const ahmed = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;

    // The engine's own score for the same observations:
    const engineScore = computeEmployeeScore(
      AUGUST_OBS.filter((o) => o.employeeId === 'emp_ahmed') as never[],
      SETTINGS,
      'emp_ahmed',
    );
    assert.equal(ahmed.quality!.rawScore, engineScore.score);

    // The engine's own result shape (frozen-verbatim comparison):
    const frozen = makeClosedSnapshot('2026-07', { emp_ahmed: 88 }, true).kpiResults!['emp_ahmed'];
    const july = await buildMonthlyKpiReport(
      { monthKey: '2026-07', reportKind: 'HISTORICAL', now: NOW_AUG, loaders: makeLoaders() },
    );
    const julyRow = july.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.equal(julyRow.quality!.rawScore, frozen.components.find((c) => c.owner === 'quality')!.rawScore);
    assert.equal(
      julyRow.quality!.weightedContribution,
      frozen.components.find((c) => c.owner === 'quality')!.weightedContribution,
    );
    assert.equal(julyRow.availableWeight, frozen.availableWeight);
    assert.equal(julyRow.weightedTotal, frozen.weightedTotal);
  });

  it('employee report components are the engine result verbatim (deep equal)', async () => {
    const loaders = makeLoaders();
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-07', now: NOW_AUG , loaders },
    );
    const direct = await loaders.loadSnapshot('2026-07');
    const frozen = direct!.kpiResults!['emp_ahmed'];
    assert.deepEqual(report.components, frozen.components);
    assert.equal(report.availableWeight, frozen.availableWeight);
    assert.equal(report.weightedTotal, frozen.weightedTotal);
  });
});

// ─────────────────────────────────────────────────────────────
//  Trend (§16) + MoM percentage points (§17)
// ─────────────────────────────────────────────────────────────

describe('trend & comparative metrics (spec §16/§17)', () => {
  it('trend uses stored results; months without results are unavailable (never 0)', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', trendMonths: 6, now: NOW_AUG , loaders: makeLoaders() },
    );
    const points = report.trend.months;
    assert.equal(points.length, 6);
    assert.deepEqual(points.map((p) => p.monthKey), [
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
    ]);

    const march = points.find((p) => p.monthKey === '2026-03')!;
    assert.equal(march.available, false);
    assert.equal(march.rawScore, null);
    assert.equal(march.rowStatus, 'PENDING');

    assert.equal(points.find((p) => p.monthKey === '2026-05')!.rawScore, 82);
    assert.equal(points.find((p) => p.monthKey === '2026-05')!.finalized, true);
    assert.equal(points.find((p) => p.monthKey === '2026-08')!.rawScore, 91);
    assert.equal(points.find((p) => p.monthKey === '2026-08')!.finalized, false);
  });

  it('MoM delta is expressed in PERCENTAGE POINTS (+3 pp), distinct from growth', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    const mom = report.trend.mom!;
    assert.equal(mom.currentMonth, '2026-08');
    assert.equal(mom.previousMonth, '2026-07');
    assert.equal(mom.currentRawScore, 91);
    assert.equal(mom.previousRawScore, 88);
    assert.equal(mom.deltaPoints, 3);            // percentage points
    assert.ok(Math.abs(mom.growthPercent! - 3.41) < 0.01); // growth ≠ delta
  });

  it('MoM is null when the previous month has no valid result (no invention)', async () => {
    const snapshots = new Map(SNAPSHOTS);
    snapshots.delete('2026-07');
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders({ snapshots }) },
    );
    assert.equal(report.trend.mom, null);
  });
});

// ─────────────────────────────────────────────────────────────
//  Evidence traceability (§18/§32)
// ─────────────────────────────────────────────────────────────

describe('evidence traceability (spec §18/§32)', () => {
  it('observations carry the full chain with per-observation KPI effect', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    assert.equal(report.evidence.counts.total, 3);
    assert.equal(report.evidence.counts.approved, 2);
    assert.equal(report.evidence.counts.pending, 1);
    assert.equal(report.evidence.counts.scoring, 2);

    const urlObs = report.evidence.observations.find((o) => o.evidence.kind === 'url')!;
    assert.equal(urlObs.evidence.kind, 'url');

    const pendingObs = report.evidence.observations.find((o) => o.approvalStatus === 'pending')!;
    assert.equal(pendingObs.effect.counted, false);  // pending never affects the score
    assert.equal(pendingObs.effect.signedPoints, 0);

    const scored = report.evidence.observations.filter((o) => o.effect.counted);
    assert.deepEqual(
      scored.map((o) => o.effect.signedPoints).sort((a, b) => a - b),
      [-5, -4],
    );

    assert.equal(report.traceability!.source, 'quality_engine');
    assert.equal(report.traceability!.origin, 'live_engine');
    assert.equal(report.traceability!.frozen, false);
  });

  it('frozen months keep the FROZEN engine evidence block', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-07', now: NOW_AUG , loaders: makeLoaders() },
    );
    assert.equal(report.traceability!.frozen, true);
    assert.equal(report.traceability!.origin, 'month_snapshot');
    assert.equal(report.traceability!.observationCount, 2);
    assert.equal(report.traceability!.deductionPoints, 12);
  });
});

// ─────────────────────────────────────────────────────────────
//  Data contract (§28) — the future Python/AI seam
// ─────────────────────────────────────────────────────────────

describe('data contract for future AI (spec §28/§29)', () => {
  it('exposes a structured, evidence-referenced, serializable projection', async () => {
    const report = await buildEmployeeKpiReport(
      { employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG , loaders: makeLoaders() },
    );
    const contract = report.dataContract!;
    assert.equal(contract.employeeId, 'emp_ahmed');
    assert.equal(contract.period, '2026-08');
    assert.equal(contract.schemeId, 'scheme_v1');
    assert.equal(contract.schemeVersion, 1);
    assert.equal(contract.valueBasis, 'MTD');
    assert.equal(contract.overallStatus, 'INCOMPLETE');

    const quality = contract.components.find((c) => c.componentId === 'quality')!;
    assert.equal(quality.rawScore, 91);
    assert.equal(quality.weight, 15);
    assert.equal(quality.weightedContribution, 13.65);
    assert.equal(quality.status, 'AVAILABLE');
    assert.ok(quality.evidenceReferences.length === 2); // scoring observation ids

    // No AI narrative is generated (spec §29) — data only.
    assert.equal(JSON.stringify(contract).includes('تحسن'), false);
  });
});

// ─────────────────────────────────────────────────────────────
//  Management summary (§15)
// ─────────────────────────────────────────────────────────────

describe('management summary (spec §15)', () => {
  it('aggregates QUALITY KPI statistics with explicit labeling', async () => {
    // §10: archived employees are excluded by default — opt in here so
    // the test's expectations about emp_sara stay valid.
    const summary = await buildKpiManagementSummary(
      { monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(), filters: { includeArchived: true } },
    );
    assert.equal(summary.statisticsKind, 'QUALITY_KPI');
    assert.ok(summary.label.includes('جودة'));
    assert.equal(summary.reportKind, 'SUMMARY');

    assert.equal(summary.counts.eligible, 4);       // ahmed, sara, nodata, zero
    assert.equal(summary.counts.available, 3);      // ahmed, sara + zero (ZERO is value-bearing, §12)
    assert.equal(summary.counts.pending, 1);        // nodata
    assert.equal(summary.counts.zero, 1);           // zero
    assert.equal(summary.counts.incomplete, 2);     // ahmed, sara (quality-only)
    assert.equal(summary.counts.finalized, 0);
    assert.equal(summary.counts.archivedButEligible, 1); // sara

    assert.equal(summary.qualityAverages.avgRawScore, 62); // (91+95+0)/3 — pending excluded
    assert.equal(summary.qualityAverages.highest!.rawScore, 95);
    assert.equal(summary.qualityAverages.highest!.employeeId, 'emp_sara');
    assert.equal(summary.qualityAverages.lowest!.rawScore, 0);

    const sales = summary.departments.find((d) => d.key === 'المبيعات')!;
    assert.equal(sales.employeeCount, 3);
    assert.equal(sales.avgRawScore, 62);
    const itDept = summary.departments.find((d) => d.key === 'تقنية المعلومات')!;
    assert.equal(itDept.employeeCount, 1);
    assert.equal(itDept.avgRawScore, null); // pending never averaged as 0

    assert.equal(summary.teams.length, 1); // one team label resolves
    assert.equal(summary.teams[0].employeeCount, 2);
  });

  it('summary payload derives from the SAME report rows (one number source)', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-08', reportKind: 'MONTHLY', now: NOW_AUG, loaders: makeLoaders() },
    );
    const summary = buildSummaryPayload(report);
    assert.equal(summary.counts.eligible, report.totals.eligibleCount);
    assert.equal(summary.counts.available, report.totals.available);
  });
});

// ─────────────────────────────────────────────────────────────
//  Export parity (§22) — exported rows = on-screen rows
// ─────────────────────────────────────────────────────────────

describe('export parity (spec §22)', () => {
  it('export rows carry the exact same verified numbers as the report rows', async () => {
    const report = await buildMonthlyKpiReport(
      { monthKey: '2026-07', reportKind: 'HISTORICAL', now: NOW_AUG, loaders: makeLoaders() },
    );
    const exportRows = toKpiMonthlyExportRows(report);
    assert.equal(exportRows.length, report.rows.length);

    const ahmedExport = exportRows.find((r) => r.employeeId === 'emp_ahmed')!;
    const ahmedRow = report.rows.find((r) => r.employeeId === 'emp_ahmed')!;
    assert.equal(ahmedExport.qualityRawScore, ahmedRow.quality!.rawScore);
    assert.equal(ahmedExport.qualityWeight, ahmedRow.quality!.weight);
    assert.equal(ahmedExport.qualityContribution, ahmedRow.quality!.weightedContribution);
    assert.equal(ahmedExport.kpiStatus, ahmedRow.rowStatus);
    assert.equal(ahmedExport.valueBasis, ahmedRow.valueBasis);
    assert.equal(ahmedExport.schemeVersion, ahmedRow.schemeVersion);
    assert.equal(ahmedExport.finalized, true);
  });
});
