// ══════════════════════════════════════════════════════════════
//  KPI Reports 2.0 — client workspace contracts
//
//  Run: npx tsx --test src/components/pages/quality-kpi/kpi-reports/__tests__/workspace.test.ts
//
//  Covers:
//    A  Comparison grid (§18): employee↔employee, employee↔team,
//       team↔department mixing; missing data → null (never 0);
//       entity enumeration; single entity → empty grid.
//    B  Terminology contract (§25): the workspace NEVER surfaces
//       "وزن/Weighted/مساهمة/Contribution" user-facing wording, raw
//       status keys (NOT_ELIGIBLE / row_status_*), NaN or raw
//       internal identifiers — and DOES use the percentage terms.
//    C  Page-state normalization (§30): v3 shape validation +
//       legacy v2 tab mapping + filters/list sanitation.
//    D  Signal narration: structured facts → deterministic bilingual
//       sentences (no causal claims).
//
//  Convention: pure modules + source contracts (no DOM).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildComparisonGrid, comparableEntities, type ComparisonEntity } from '../comparison';
import { normalizeView, DEFAULT_FILTERS } from '../view-state';
import { presentSignal } from '../insights-labels';
import type { KpiInsightsReport } from '@/lib/kpi-reporting';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ─────────────────────────────────────────────────────────────
//  Minimal canonical insights fixture (shape-accurate)
// ─────────────────────────────────────────────────────────────

function makeReport(over: Partial<KpiInsightsReport> = {}): KpiInsightsReport {
  return {
    reportKind: 'INSIGHTS',
    monthKey: '2026-09',
    previousMonthKey: '2026-08',
    valueBasis: 'FINALIZED',
    finalized: true,
    closedAt: null,
    statisticsKind: 'QUALITY_KPI',
    selection: { isCompanyWide: true, employeeCount: 2, teamLabels: ['فريق أ'], departmentLabels: [] },
    scheme: null,
    overview: {
      avgQuality: 85, previousAvgQuality: 80, qualityDeltaPoints: 5,
      observationsTotal: 6, observationsApproved: 4, observationsPending: 1, observationsRejected: 1,
      repeatedIssues: 1, highCritical: 1, needsAttention: 1,
      counts: {
        eligibleCount: 2, withResult: 2, available: 2, zero: 0, pending: 0,
        incomplete: 0, finalized: 2, noScheme: 0, notEligibleCount: 0,
      },
    },
    rows: [
      {
        employeeId: 'e1', employeeName: 'أحمد', employeeCode: '001',
        department: 'المبيعات', team: 'فريق أ', position: null,
        employmentStatus: 'active', archivedButEligible: false,
        quality: {
          componentId: 'quality', name: 'الجودة', status: 'FINALIZED',
          rawScore: 90, weight: 15, weightedContribution: 13.5, maxContribution: 15,
          observationCount: 2, deductionPoints: 10, bonusPoints: 0,
        },
        availableWeight: 15, weightedTotal: 13.5, overallStatus: 'INCOMPLETE',
        rowStatus: 'FINALIZED', finalized: true, valueBasis: 'FINALIZED',
        resultSource: 'FROZEN_RESULT', schemeId: null, schemeName: null,
        schemeVersion: null, finalizedAt: null,
      },
      {
        employeeId: 'e2', employeeName: 'رحمة', employeeCode: '002',
        department: 'المبيعات', team: 'فريق أ', position: null,
        employmentStatus: 'active', archivedButEligible: false,
        quality: null, availableWeight: null, weightedTotal: null,
        overallStatus: null, rowStatus: 'PENDING', finalized: false,
        valueBasis: 'FINALIZED', resultSource: 'PENDING', schemeId: null,
        schemeName: null, schemeVersion: null, finalizedAt: null,
      },
    ],
    employeeFacts: {
      e1: {
        observationsTotal: 3, observationsApproved: 2, observationsPending: 1, observationsRejected: 0,
        highCritical: 1, repeatedIssues: 1, previousRawScore: 85, deltaPoints: 5, needsAttention: true,
      },
      e2: {
        observationsTotal: 0, observationsApproved: 0, observationsPending: 0, observationsRejected: 0,
        highCritical: 0, repeatedIssues: 0, previousRawScore: null, deltaPoints: null, needsAttention: false,
      },
    },
    teamUnits: [
      {
        key: 'فريق أ', label: 'فريق أ', employeeCount: 2, employeeIds: ['e1', 'e2'],
        avgQuality: 90, previousAvgQuality: 80, deltaPoints: 10,
        observationsApproved: 2, highCritical: 1, repeatedIssues: 1, improving: 1, declining: 0,
      },
    ],
    departmentUnits: [
      {
        key: 'المبيعات', label: 'المبيعات', employeeCount: 2, employeeIds: ['e1', 'e2'],
        avgQuality: 90, previousAvgQuality: 80, deltaPoints: 10,
        observationsApproved: 2, highCritical: 1, repeatedIssues: 1, improving: 1, declining: 0,
      },
    ],
    categoryDistribution: [],
    severityDistribution: [],
    repeatedIssues: [],
    windowRecurrence: [],
    signals: [],
    opportunities: [],
    dataQuality: [],
    vocab: { teams: [], departments: [] },
    generatedAt: '2026-10-11T00:00:00.000Z',
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────
//  A. Comparison grid
// ─────────────────────────────────────────────────────────────

describe('Comparison grid (§18)', () => {
  it('A1. employee ↔ employee over the canonical dimensions', () => {
    const report = makeReport();
    const entities: ComparisonEntity[] = [
      { kind: 'employee', id: 'e1', label: 'أحمد' },
      { kind: 'employee', id: 'e2', label: 'رحمة' },
    ];
    const grid = buildComparisonGrid(report, entities);
    assert.equal(grid.length, 6);
    const quality = grid.find((d) => d.key === 'quality')!;
    assert.equal(quality.values[0]?.value, 90); // أحمد's canonical raw score
    assert.equal(quality.values[1], null); // رحمة has no value — NOT 0
    const change = grid.find((d) => d.key === 'change')!;
    assert.equal(change.values[0]?.value, 5);
    assert.equal(change.values[1]?.value, null); // no previous → never a fabricated decline
    const completeness = grid.find((d) => d.key === 'completeness')!;
    assert.equal(completeness.values[0]?.value, 'FINALIZED');
    assert.equal(completeness.values[1]?.value, 'PENDING');
  });

  it('A2. mixed kinds: employee ↔ team ↔ department (units use aggregates)', () => {
    const report = makeReport();
    const entities: ComparisonEntity[] = [
      { kind: 'employee', id: 'e1', label: 'أحمد' },
      { kind: 'team', id: 'فريق أ', label: 'فريق أ' },
      { kind: 'department', id: 'المبيعات', label: 'المبيعات' },
    ];
    const grid = buildComparisonGrid(report, entities);
    const quality = grid.find((d) => d.key === 'quality')!;
    assert.equal(quality.values[0]?.value, 90);
    assert.equal(quality.values[1]?.value, 90); // team avg
    assert.equal(quality.values[2]?.value, 90); // department avg
    const observations = grid.find((d) => d.key === 'observations')!;
    assert.equal(observations.values[1]?.value, 2);
  });

  it('A3. fewer than two entities → no grid; enumeration covers all kinds', () => {
    const report = makeReport();
    assert.deepEqual(buildComparisonGrid(report, [{ kind: 'employee', id: 'e1', label: 'أحمد' }]), []);
    const all = comparableEntities(report);
    assert.equal(all.filter((e) => e.kind === 'employee').length, 2);
    assert.equal(all.filter((e) => e.kind === 'team').length, 1);
    assert.equal(all.filter((e) => e.kind === 'department').length, 1);
  });
});

// ─────────────────────────────────────────────────────────────
//  B. Terminology contract (§25) — source-contract pattern
// ─────────────────────────────────────────────────────────────

describe('Terminology contract (§25) — workspace sources', () => {
  const files = [
    '../../KpiReportsPage.tsx',
    '../KpiReportsControlBar.tsx',
    '../PerformanceOverview.tsx',
    '../QualityIntelligenceSection.tsx',
    '../EmployeePerformanceReport.tsx',
    '../TeamPerformanceReport.tsx',
    '../ComparisonReport.tsx',
    '../InsightsSections.tsx',
    '../KpiEmployeeReportDialog.tsx',
    '../KpiEmployeeReportDetail.tsx',
    '../insights-labels.ts',
  ].map((f) => join(HERE, f));

  const FORBIDDEN = [
    // user-facing weight/contribution wording (spec §9/§25)
    /الوزن/, /المساهمة/, /الوزن المحدد/, /مساهمة الجودة/,
    /"Weight"/, /">Weighted/, /Contribution</,
    // raw internal identifiers / statuses as visible text
    /row_status_/, /dataset\.data_quality/, /repeated_issues\./, /risk_engine\./,
    /QUALITY_REPEATED_ISSUE_RECURRENCE/, /ATTENDANCE_DATA_UNAVAILABLE/,
    // raw NaN rendering
    />NaN</, /"NaN"/,
  ];

  it('B1. no weight/contribution wording, raw internal keys or NaN anywhere user-facing', () => {
    for (const file of files) {
      // §SOURCE-CONTRACT — comments describe the contract; they are
      // not user-facing text. Strip them before matching (house idiom).
      const raw = readFileSync(file, 'utf8');
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const pattern of FORBIDDEN) {
        assert.ok(!pattern.test(src), `${file} must not match ${pattern}`);
      }
    }
  });

  it('B2. percentage terminology IS present (نسبة الجودة · النسبة المحددة · النسبة المحتسبة · حالة التقييم)', () => {
    const labels = readFileSync(join(HERE, '../insights-labels.ts'), 'utf8');
    for (const term of ['نسبة الجودة', 'النسبة المحددة', 'النسبة المحققة', 'النسبة المحتسبة', 'إجمالي النسبة', 'حالة التقييم']) {
      assert.ok(labels.includes(term), `insights-labels must define ${term}`);
    }
    const table = readFileSync(join(HERE, '../EmployeePerformanceReport.tsx'), 'utf8');
    // the employee table headers flow through TERMS (percentage names)
    assert.ok(table.includes('TERMS.qualityPct'));
    assert.ok(table.includes('TERMS.evaluationStatus'));
  });

  it('B3. every status render path resolves labels (no raw engine keys)', () => {
    const table = readFileSync(join(HERE, '../EmployeePerformanceReport.tsx'), 'utf8');
    assert.ok(table.includes('StatusBadge status={row.rowStatus}'));
    const shared = readFileSync(join(HERE, '../../kpi-reports-shared.tsx'), 'utf8');
    // §PRESENTATION-BOUNDARY — unknown keys fall back to presentStatus
    assert.ok(shared.includes('presentStatus(status, locale)'));
  });
});

// ─────────────────────────────────────────────────────────────
//  C. Page-state normalization (§30)
// ─────────────────────────────────────────────────────────────

describe('Page-state normalization (§30)', () => {
  it('C1. rejects shapes without a month; accepts and sanitizes the v3 shape', () => {
    assert.equal(normalizeView(null), null);
    assert.equal(normalizeView({}), null);
    assert.equal(normalizeView({ month: 42 }), null);
    const view = normalizeView({
      month: '2026-09',
      reportType: 'teams',
      scopeMode: 'teams',
      orgNodeIds: ['n1', 42, 'n2'],
      employeeIds: 'not-an-array',
      filters: { search: 'أحمد', status: 'FINALIZED', includeArchived: true },
    });
    assert.ok(view);
    assert.equal(view.reportType, 'teams');
    assert.deepEqual(view.orgNodeIds, ['n1', 'n2']);
    assert.deepEqual(view.employeeIds, []);
    assert.deepEqual(view.filters, { search: 'أحمد', status: 'FINALIZED', includeArchived: true });
  });

  it('C2. unknown enum values fall back safely', () => {
    const view = normalizeView({ month: '2026-09', reportType: 'admin', scopeMode: 'galaxy' });
    assert.equal(view?.reportType, 'employees');
    assert.equal(view?.scopeMode, 'company');
    assert.deepEqual(view?.filters, DEFAULT_FILTERS);
  });

  it('C3. legacy v2 tabs map forward (period tabs die, report types survive)', () => {
    assert.equal(normalizeView({ month: '2026-09', tab: 'table', basis: 'mtd' })?.reportType, 'employees');
    assert.equal(normalizeView({ month: '2026-09', tab: 'monthly' })?.reportType, 'employees');
    assert.equal(normalizeView({ month: '2026-09', tab: 'historical' })?.reportType, 'employees');
    assert.equal(normalizeView({ month: '2026-09', tab: 'summary' })?.reportType, 'employees');
    assert.equal(normalizeView({ month: '2026-09', tab: 'performance' })?.reportType, 'employees');
    assert.equal(normalizeView({ month: '2026-09', tab: 'management' })?.reportType, 'teams');
    assert.equal(normalizeView({ month: '2026-09', tab: 'hr' })?.reportType, 'hr');
  });
});

// ─────────────────────────────────────────────────────────────
//  D. Signal narration
// ─────────────────────────────────────────────────────────────

describe('Signal narration (§10/§19 — facts, never causes)', () => {
  it('D1. team decline renders the delta bilingually; EN never leaks Arabic UI terms', () => {
    const signal = { id: 'x', kind: 'TEAM_DECLINE' as const, level: 'warning' as const, teamLabel: 'الشمال', deltaPoints: -9 };
    const ar = presentSignal(signal, 'ar');
    assert.ok(ar.text.includes('الشمال') && ar.text.includes('9'));
    const en = presentSignal(signal, 'en');
    assert.ok(en.text.includes('dropped 9 points'));
    assert.ok(!en.text.includes('انخفضت'));
  });

  it('D2. high-severity + pending approvals render as facts', () => {
    const high = presentSignal({ id: 'h', kind: 'HIGH_SEVERITY', level: 'critical', count: 2 }, 'en');
    assert.ok(high.text.includes('2 employees'));
    const pending = presentSignal({ id: 'p', kind: 'PENDING_APPROVALS', level: 'info', count: 3 }, 'ar');
    assert.ok(pending.text.includes('3'));
  });
});
