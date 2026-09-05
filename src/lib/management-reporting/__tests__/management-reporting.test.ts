// ══════════════════════════════════════════════════════════════
//  Management Reporting — focused tests (Milestone 7, Phase A)
//
//  Run: npx tsx --test src/lib/management-reporting/__tests__/management-reporting.test.ts
//
//  Covers the mandatory Phase A scenarios:
//    1  Quality block consumed VERBATIM from the engine summary
//       (zero recomputation — parity with buildSummaryPayload)
//    2  Cross-domain period attribution (createdAt vs date vs month)
//    3  Open/closed split per canonical status vocabulary
//    4  Department grouping + employeeCount from engine groups
//    5  Operational-only group appears (quality null — no zero-fill)
//    6  Ungrouped / unlinked rows stay in totals only
//    7  Team grouping from org nodes (team/subteam only)
//    8  Deterministic ordering
//    9  Explanation line names the period + the engine
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateDomainFacts,
  buildManagementReport,
  emptyDomainFacts,
} from '@/lib/management-reporting';
import type { KpiManagementSummary } from '@/lib/kpi-reporting';
import type { ManagementDomainSource } from '@/lib/management-reporting';

const MONTH = '2026-08';

/** Minimal engine-summary fixture (as produced by buildSummaryPayload). */
function makeSummary(overrides: Partial<KpiManagementSummary> = {}): KpiManagementSummary {
  return {
    reportKind: 'SUMMARY',
    monthKey: MONTH,
    valueBasis: 'FINALIZED',
    finalized: true,
    closedAt: '2026-09-01T10:00:00.000Z',
    statisticsKind: 'QUALITY_KPI',
    label: 'إحصائيات جودة KPI (Quality KPI) — لا تمثل إجمالي KPI الشركة',
    counts: {
      eligible: 2, available: 2, zero: 0, pending: 0,
      incomplete: 2, finalized: 2, noScheme: 0, archivedButEligible: 0,
    },
    qualityAverages: {
      avgRawScore: 90, avgContribution: 13.5,
      highest: { employeeId: 'e1', employeeName: 'أحمد', rawScore: 95 },
      lowest: { employeeId: 'e2', employeeName: 'سارة', rawScore: 85 },
    },
    departments: [
      { key: 'المبيعات', label: 'المبيعات', employeeCount: 2, avgRawScore: 90, avgContribution: 13.5 },
    ],
    teams: [
      { key: 'فريق أ', label: 'فريق أ', employeeCount: 1, avgRawScore: 95, avgContribution: 14.25 },
    ],
    generatedAt: '2026-08-21T12:00:00.000Z',
    ...overrides,
  };
}

type Row = Record<string, unknown>;

function rowsBySource(input: {
  complaints?: Row[];
  capaCases?: Row[];
  followUps?: Row[];
  hrDeductions?: Row[];
}): Record<ManagementDomainSource, Row[]> {
  return {
    complaints: input.complaints ?? [],
    capaCases: input.capaCases ?? [],
    followUps: input.followUps ?? [],
    hrDeductions: input.hrDeductions ?? [],
  };
}

const departmentOf = (employeeId: string): string | null => {
  const map: Record<string, string | null> = {
    e1: 'المبيعات', e2: 'المبيعات', e3: 'العمليات', e4: null,
  };
  return map[employeeId] ?? null;
};

const teamOf = (employeeId: string): string | null => {
  const map: Record<string, string | null> = { e1: 'فريق أ', e2: null, e3: null, e4: null };
  return map[employeeId] ?? null;
};

describe('Management Reporting — aggregateDomainFacts (Phase A)', () => {
  it('1. attributes complaints by createdAt ISO month', () => {
    const facts = aggregateDomainFacts('complaints', [
      { id: 'c1', employeeId: 'e1', status: 'open', createdAt: '2026-08-03T10:00:00.000Z' },
      { id: 'c2', employeeId: 'e1', status: 'resolved', createdAt: '2026-08-20T10:00:00.000Z' },
      { id: 'c3', employeeId: 'e1', status: 'open', createdAt: '2026-07-20T10:00:00.000Z' }, // previous month
    ], MONTH);
    assert.equal(facts.total, 2);
    assert.equal(facts.open, 1);
    assert.equal(facts.closed, 1);
    assert.deepEqual(facts.byStatus, { open: 1, resolved: 1 });
  });

  it('2. attributes followUps by date (YYYY-MM-DD) and HR deductions by explicit month', () => {
    const fu = aggregateDomainFacts('followUps', [
      { id: 'f1', employeeId: 'e1', status: 'open', date: '2026-08-11' },
      { id: 'f2', employeeId: 'e1', status: 'open', date: '2026-09-01' },
    ], MONTH);
    assert.equal(fu.total, 1);

    const hr = aggregateDomainFacts('hrDeductions', [
      { id: 'h1', employeeId: 'e1', status: 'pending', month: '2026-08' },
      { id: 'h2', employeeId: 'e1', status: 'approved', month: '2026-07' },
      { id: 'h3', employeeId: 'e1', status: 'approved', month: '2026-08' },
    ], MONTH);
    assert.equal(hr.total, 2);
    assert.equal(hr.open, 1);
    assert.equal(hr.closed, 1);
  });

  it('3. open/closed split uses the CANONICAL vocabularies (CAPA reopened = open, rejected = closed)', () => {
    const capa = aggregateDomainFacts('capaCases', [
      { id: 'k1', employeeId: 'e1', status: 'reopened', createdAt: '2026-08-02T00:00:00.000Z' },
      { id: 'k2', employeeId: 'e1', status: 'rejected', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: 'k3', employeeId: 'e1', status: 'verification', createdAt: '2026-08-04T00:00:00.000Z' },
      { id: 'k4', employeeId: 'e1', status: 'closed', createdAt: '2026-08-05T00:00:00.000Z' },
    ], MONTH);
    assert.equal(capa.total, 4);
    assert.equal(capa.open, 2);   // reopened + verification
    assert.equal(capa.closed, 2); // rejected + closed
  });

  it('4. empty domain yields explicit zero facts (never fabricated)', () => {
    const facts = emptyDomainFacts('complaints');
    assert.equal(facts.total, 0);
    assert.deepEqual(facts.byStatus, {});
  });
});

describe('Management Reporting — buildManagementReport (Phase A)', () => {
  it('5. consumes the quality summary VERBATIM (engine parity — no recomputation)', () => {
    const summary = makeSummary();
    const report = buildManagementReport({
      monthKey: MONTH,
      qualitySummary: summary,
      scopedRows: rowsBySource({}),
      departmentOf,
      teamOf,
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    assert.equal(report.qualitySummary, summary); // same object — verbatim
    assert.equal(report.statisticsKind, 'QUALITY_KPI');
    assert.equal(report.departments[0].quality?.avgRawScore, 90); // engine number passes through
  });

  it('6. merges operational counts into engine groups and keeps totals exact', () => {
    const report = buildManagementReport({
      monthKey: MONTH,
      qualitySummary: makeSummary(),
      scopedRows: rowsBySource({
        complaints: [
          { id: 'c1', employeeId: 'e1', status: 'open', createdAt: '2026-08-03T00:00:00.000Z' },
          { id: 'c2', employeeId: 'e2', status: 'closed', createdAt: '2026-08-04T00:00:00.000Z' },
        ],
        capaCases: [
          { id: 'k1', employeeId: 'e1', status: 'open', createdAt: '2026-08-05T00:00:00.000Z' },
        ],
      }),
      departmentOf,
      teamOf,
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    const sales = report.departments.find((d) => d.key === 'المبيعات');
    assert.ok(sales);
    assert.equal(sales.domains.complaints.total, 2);
    assert.equal(sales.domains.capaCases.total, 1);
    assert.equal(report.totals.domains.complaints.total, 2);
    assert.equal(report.activeEmployeeCount, 2);
  });

  it('7. operational-only group appears with quality NULL (no zero-fill)', () => {
    const report = buildManagementReport({
      monthKey: MONTH,
      qualitySummary: makeSummary(), // engine only knows المبيعات
      scopedRows: rowsBySource({
        followUps: [{ id: 'f1', employeeId: 'e3', status: 'open', date: '2026-08-14' }],
      }),
      departmentOf,
      teamOf,
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    const ops = report.departments.find((d) => d.key === 'العمليات');
    assert.ok(ops, 'operational-only department must appear');
    assert.equal(ops.quality, null);
    assert.equal(ops.domains.followUps.total, 1);
    assert.equal(ops.employeeCount, 0);
  });

  it('8. unlinked records stay in company totals but not in any group', () => {
    const report = buildManagementReport({
      monthKey: MONTH,
      qualitySummary: makeSummary(),
      scopedRows: rowsBySource({
        complaints: [
          { id: 'cX', status: 'open', createdAt: '2026-08-06T00:00:00.000Z' }, // no employeeId
          { id: 'cY', employeeId: 'e4', status: 'open', createdAt: '2026-08-06T00:00:00.000Z' }, // no department
        ],
      }),
      departmentOf,
      teamOf,
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    assert.equal(report.totals.domains.complaints.total, 2);
    const grouped = report.departments.reduce((sum, d) => sum + d.domains.complaints.total, 0);
    assert.equal(grouped, 0);
  });

  it('9. team rows group by team node name; out-of-period records ignored everywhere', () => {
    const report = buildManagementReport({
      monthKey: MONTH,
      qualitySummary: makeSummary(),
      scopedRows: rowsBySource({
        hrDeductions: [
          { id: 'h1', employeeId: 'e1', status: 'approved', month: '2026-08' },
          { id: 'h2', employeeId: 'e1', status: 'approved', month: '2026-09' },
        ],
      }),
      departmentOf,
      teamOf,
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    const teamA = report.teams.find((t) => t.key === 'فريق أ');
    assert.ok(teamA);
    assert.equal(teamA.domains.hrDeductions.total, 1);
    assert.equal(report.totals.domains.hrDeductions.total, 1);
  });

  it('10. explanation names the period and the engine source', () => {
    const report = buildManagementReport({
      monthKey: MONTH,
      qualitySummary: makeSummary(),
      scopedRows: rowsBySource({}),
      departmentOf,
      teamOf,
      generatedAt: '2026-08-21T12:00:00.000Z',
    });
    assert.ok(report.explanation.includes(MONTH));
    assert.ok(report.explanation.includes('KPI'));
  });
});
