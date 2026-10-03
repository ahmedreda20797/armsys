// ══════════════════════════════════════════════════════════════
//  §52 EXECUTIVE REFINEMENT — deterministic tests for the report
//  refinement layer:
//    §4    Top 3 Signals — real facts only, ranked, capped at 3
//    §15   What Changed — rows only when BOTH periods have data
//    §32   the deal intel breakdown reconciles with the headline
//    §27   Current Deals is a status snapshot, never a date count
//    §12   attention/pattern/narrative views NEVER leak rule IDs
//    §13   attention sources render as human-readable domain labels
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQualityIntelligence,
  type QualityIntelligenceInput,
} from '@/lib/quality-intelligence/report';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';

// ── fixture (minimal typed dataset, same shape as the canonical one) ──

function dealsFixture(over?: Partial<EmployeePerformanceDataset['deals']>): EmployeePerformanceDataset['deals'] {
  return {
    relationship: 'CONFIRMED',
    travelTotal: 0,
    byStatus: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
    canceled: 0,
    active: 0,
    completionRate: null,
    monthly: [],
    closedTotal: 0,
    closedMonthly: [],
    closedUnknownMonth: 0,
    createdTotal: 0,
    createdMonthly: [],
    closedWithEmployeeTotal: 0,
    closedWithEmployeeInPeriod: 0,
    closedWithEmployeeMonthly: [],
    closedWithEmployeeUnknownMonth: 0,
    closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
    statusAllTime: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
    ...over,
  };
}

function datasetFixture(over?: {
  weightedTotal?: number | null;
  rowStatus?: string;
  observationsTotal?: number;
  byCategory?: Array<{ categoryId: string | null; categoryName: string; count: number }>;
  observationsMonthly?: Array<{ month: string; count: number }>;
  followUps?: { total: number; completed: number; active: number; overdue: number; dueToday: number };
  deals?: Partial<EmployeePerformanceDataset['deals']>;
  complaintsMonthly?: Array<{ month: string; count: number }>;
}): EmployeePerformanceDataset {
  const fu = over?.followUps ?? { total: 0, completed: 0, active: 0, overdue: 0, dueToday: 0 };
  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'emp_1', employeeName: 'موظف', employeeCode: 'E1', department: 'QA', team: null,
      manager: null,
      position: null, employmentStatus: 'active', eligibleForPeriod: true, archivedButEligible: false,
      archivedAt: null, restoredAt: null, relationship: 'CONFIRMED',
    },
    period: { monthKey: '2026-09', valueBasis: 'LIVE', finalized: false, finalizedAt: null },
    kpi: {
      outcomeStatus: 'OK',
      employee: { employeeId: 'emp_1', employeeName: 'موظف', employeeCode: 'E1', department: 'QA', position: null },
      scheme: { schemeId: 's1', schemeName: 'المخطط', schemeVersion: 1, qualityWeight: 15, frozen: false },
      components: [
        { componentId: 'quality', name: 'الجودة', weight: 15, status: 'AVAILABLE', rawScore: 80, weightedContribution: 12, maxContribution: 15 },
      ],
      quality: { name: 'الجودة', weight: 15, rawScore: 80, weightedContribution: 12, maxContribution: 15, status: 'AVAILABLE' },
      availableWeight: 15,
      weightedTotal: over?.weightedTotal ?? null,
      overallStatus: null,
      rowStatus: over?.rowStatus ?? 'INCOMPLETE',
      calculationVersion: null,
      source: 'kpi_engine',
      message: null,
    },
    trend: {
      windowMonths: ['2026-08', '2026-09'],
      points: [],
      mom: null,
      direction: null,
    },
    quality: {
      observations: {
        total: over?.observationsTotal ?? 0,
        approved: 0, pending: 0, rejected: 0,
        byResolutionStatus: {},
        bySeverity: {},
        byCategory: over?.byCategory ?? [],
        monthly: over?.observationsMonthly ?? [],
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: [], byType: [], windowByCategory: [],
      },
      deductions: {
        count: 0, totalDays: 0, totalAmount: 0, byType: [], records: [],
      },
    },
    complaints: {
      relationship: 'CONFIRMED', total: 0, byStatus: {}, byType: {}, bySeverity: {},
      repeatedTypes: [], resolvedOrClosed: 0, stillOpen: 0, viaDealCount: 0,
      avgResolutionDays: null, monthly: over?.complaintsMonthly ?? [],
    },
    capa: {
      relationship: 'CONFIRMED', total: 0, byStatus: {}, byPriority: {}, bySource: {},
      active: 0, terminal: 0, overdue: 0, avgOverdueDays: null,
      correctiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      preventiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      closedCount: 0, avgClosureDays: null, indirectCount: 0, monthly: [],
    },
    followUps: {
      relationship: 'CONFIRMED', total: fu.total, byStatus: {},
      active: fu.active, terminal: 0, overdue: fu.overdue, dueToday: fu.dueToday,
      avgOverdueDays: null, completed: fu.completed,
      completionRate: fu.total > 0 ? (fu.completed / fu.total) * 100 : null,
      byType: {}, byPriority: {}, monthly: [],
    },
    deals: dealsFixture(over?.deals),
    attendance: { status: 'NOT_AVAILABLE', source: 'attendanceResults', result: null },
    dataQuality: { windowMonths: ['2026-09'], unattributedRecords: [], notes: [] },
    evidence: {
      kpi: [],
      observations: { collection: 'qualityObservations', recordIds: [] },
      deductions: { collection: 'qualityDeductions', recordIds: [] },
      complaints: { collection: 'complaints', recordIds: [] },
      capa: { collection: 'capaCases', recordIds: [] },
      followUps: { collection: 'followUps', recordIds: [] },
      deals: { collection: 'travelDeals', recordIds: [] },
      attendance: null,
    },
    generatedAt: '2026-09-29T00:00:00.000Z',
  } as unknown as EmployeePerformanceDataset;
}

function inputOf(dataset: EmployeePerformanceDataset): QualityIntelligenceInput {
  return { dataset, decision: null, hrDeductions: null, previousMonthKey: '2026-08' };
}

// ── §4 Top 3 Signals ──

describe('§4 — Top 3 Signals (deterministic, real facts only)', () => {
  it('caps at three and ranks the declining trend first', () => {
    const ds = datasetFixture({
      weightedTotal: 74,
      rowStatus: 'AVAILABLE',
      observationsTotal: 5,
      byCategory: [{ categoryId: 'cat1', categoryName: 'تأخر متابعة', count: 4 }],
      followUps: { total: 19, completed: 19, active: 0, overdue: 0, dueToday: 0 },
    });
    ds.trend = {
      windowMonths: ['2026-08', '2026-09'],
      points: [],
      mom: { currentMonth: '2026-09', previousMonth: '2026-08', currentRawScore: 80, previousRawScore: 86, deltaPoints: -6, growthPercent: null },
      direction: 'DOWN',
    };
    const intel = buildQualityIntelligence(inputOf(ds));
    assert.equal(intel.signals.length, 3);
    assert.equal(intel.signals[0].code, 'SIG_TREND_DOWN');
    // Every signal is a REAL fact: the trend delta matches the engine's own MoM.
    assert.equal(intel.signals[0].values.delta, -6);
  });

  it('a quiet period produces NO invented signals (empty list, never filler)', () => {
    const intel = buildQualityIntelligence(inputOf(datasetFixture({ rowStatus: 'AVAILABLE' })));
    assert.deepEqual(intel.signals, []);
  });

  it('the follow-up completion signal carries the explicit denominator', () => {
    const intel = buildQualityIntelligence(inputOf(datasetFixture({
      followUps: { total: 19, completed: 19, active: 0, overdue: 0, dueToday: 0 },
    })));
    const sig = intel.signals.find((s) => s.code === 'SIG_FOLLOWUP_COMPLETION');
    assert.ok(sig, 'full completion is a real positive signal');
    assert.equal(sig.values.completed, 19);
    assert.equal(sig.values.total, 19);
  });
});

// ── §15 What Changed ──

describe('§15 — What Changed (both periods must exist)', () => {
  it('emits a row only when the previous month has data too (never zero-filled)', () => {
    const intel = buildQualityIntelligence(inputOf(datasetFixture({
      observationsTotal: 5,
      observationsMonthly: [{ month: '2026-09', count: 5 }], // August absent
    })));
    assert.equal(intel.whatChanged.find((r) => r.metric === 'quality_observations'), undefined);
  });

  it('compares quality observations when both months carry data', () => {
    const intel = buildQualityIntelligence(inputOf(datasetFixture({
      observationsTotal: 5,
      observationsMonthly: [{ month: '2026-08', count: 3 }, { month: '2026-09', count: 5 }],
    })));
    const row = intel.whatChanged.find((r) => r.metric === 'quality_observations');
    assert.ok(row);
    assert.equal(row.previous, 3);
    assert.equal(row.current, 5);
    assert.equal(row.delta, 2);
  });

  it('the quality-score row comes from the engine MoM pair', () => {
    const ds = datasetFixture({ rowStatus: 'AVAILABLE', weightedTotal: 80 });
    ds.trend = {
      windowMonths: ['2026-08', '2026-09'],
      points: [],
      mom: { currentMonth: '2026-09', previousMonth: '2026-08', currentRawScore: 80, previousRawScore: 86, deltaPoints: -6, growthPercent: null },
      direction: 'DOWN',
    };
    const intel = buildQualityIntelligence(inputOf(ds));
    const row = intel.whatChanged.find((r) => r.metric === 'quality_score');
    assert.ok(row);
    assert.equal(row.previous, 86);
    assert.equal(row.current, 80);
    assert.equal(row.delta, -6);
  });
});

// ── §32/§27 deals intel ──

describe('§32/§27 — deals intel breakdown and Current Deals', () => {
  it('the breakdown reconciles with the headline; current deals come from the status snapshot', () => {
    const intel = buildQualityIntelligence(inputOf(datasetFixture({
      deals: {
        closedWithEmployeeInPeriod: 5,
        closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 0, completed: 4, canceled: 1 },
        statusAllTime: { upcoming: 2, in_progress: 3, completed: 12, canceled: 5 },
      },
    })));
    const d = intel.deals;
    assert.equal(d.closedWithEmployeeInPeriod, 5);
    assert.equal(d.confirmedClosures, 4);
    assert.equal(d.cancelledClosures, 1);
    assert.equal(d.confirmedClosures + d.cancelledClosures + d.stillActiveClosures, d.closedWithEmployeeInPeriod);
    // §27 — 2 + 3 from the STATUS snapshot only; no date participates.
    assert.equal(d.currentDeals, 5);
    assert.deepEqual(d.currentDealsByStatus, { upcoming: 2, in_progress: 3 });
  });
});

// ── §12/§13 rule-ID hygiene (view layer) ──

describe('§12/§13 — the localized views never leak internal rule IDs', () => {
  it('attention sources render human-readable domain labels in BOTH locales', async () => {
    const { buildAttentionViews } = await import('@/components/pages/quality-kpi/smart-report/intelligence-view');
    const ds = datasetFixture({
      observationsTotal: 4,
      byCategory: [{ categoryId: 'cat1', categoryName: 'تأخر متابعة', count: 4 }],
    });
    ds.quality.repeatedIssues.byCategory = [
      { issueKey: 'cat1', label: 'تأخر متابعة', occurrenceCount: 4, firstOccurrence: null, lastOccurrence: null, observationIds: ['o1', 'o2', 'o3', 'o4'] },
    ];
    const intel = buildQualityIntelligence(inputOf(ds));
    const viewsAr = buildAttentionViews(intel.attention, 'ar');
    const viewsEn = buildAttentionViews(intel.attention, 'en');
    const banned = [
      'kpi.row_status', 'repeated_issues.min_occurrences', 'kpi_engine.mom_delta_direction',
      'dataset.data_quality', 'followUpMetrics', 'capaMetrics', 'complaint-status',
      'KPI_BELOW_CONFIGURED_TARGET', 'QUALITY_REPEATED_ISSUE_RECURRENCE',
      'ATTENDANCE_DATA_UNAVAILABLE', 'PRODUCTIVITY_REPORTED_NO_TARGET_CONFIGURED',
    ];
    for (const v of [...viewsAr, ...viewsEn]) {
      for (const b of banned) {
        assert.ok(!v.source.includes(b), `attention source leaks "${b}"`);
      }
    }
    assert.equal(viewsAr.find((v) => v.id === 'att-repeated-issues')?.source, 'ملاحظات الجودة');
    assert.equal(viewsEn.find((v) => v.id === 'att-repeated-issues')?.source, 'Quality observations');
  });

  it('patterns and narrative never render the raw engine row status', async () => {
    const { buildPatternViews, buildNarrativeViews } = await import('@/components/pages/quality-kpi/smart-report/intelligence-view');
    const intel = buildQualityIntelligence(inputOf(datasetFixture({ rowStatus: 'INCOMPLETE' })));
    for (const p of buildPatternViews(intel.patterns, 'ar')) {
      assert.ok(!p.text.includes('INCOMPLETE'), 'raw engine status leaked into a pattern');
    }
    for (const n of buildNarrativeViews(intel.narrative, 'ar')) {
      assert.ok(!/rowStatus|NO_SCHEME|AMBIGUOUS/.test(n.text), 'engine codes leaked into the narrative');
    }
  });

  it('the deals narrative reconciles confirmed+cancelled with the headline', async () => {
    const { buildNarrativeViews } = await import('@/components/pages/quality-kpi/smart-report/intelligence-view');
    const intel = buildQualityIntelligence(inputOf(datasetFixture({
      deals: {
        closedWithEmployeeInPeriod: 5,
        closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 0, completed: 4, canceled: 1 },
      },
    })));
    const deals = buildNarrativeViews(intel.narrative, 'ar').find((n) => n.code === 'NAR_DEALS');
    assert.ok(deals);
    assert.ok(deals.text.includes('5'), 'the headline appears');
    assert.ok(deals.text.includes('4') && deals.text.includes('1'), 'confirmed 4 + cancelled 1 reconcile');
  });
});
