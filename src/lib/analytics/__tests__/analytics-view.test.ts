// ══════════════════════════════════════════════════════════════
//  Phase 5.1A — AnalyticsSection status mapping tests (spec §12/§17.10)
//
//  The UI must accurately represent every API state:
//    AVAILABLE → READY   (per-method INSUFFICIENT_DATA stays visible
//                         inside — never collapsed into UNAVAILABLE)
//    ANALYTICS_UNAVAILABLE → UNAVAILABLE
//    ANALYTICS_ERROR → ERROR
//    (loading/network handled by the component itself)
//
//  Pure mapping tests — no React, no Python, no network.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalyticsView } from '@/components/pages/quality-kpi/smart-report/analytics-view';
import {
  ANALYTICS_KIND,
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsApiResponse,
  type EmployeeAnalyticsResult,
} from '@/lib/analytics/types';

const emptyDist = () => ({ total: 0, items: [], concentration: [] });

/** Minimal OK result carrying per-method INSUFFICIENT_DATA (spec §5). */
function makeOkResult(): EmployeeAnalyticsResult {
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    analyticsKind: ANALYTICS_KIND,
    analyticsEngineVersion: '1.0.0',
    deterministic: true,
    status: 'OK',
    input: {
      employeeId: 'e1',
      employeeName: null,
      employmentStatus: null,
      archivedButEligible: null,
      monthKey: '2026-08',
      valueBasis: 'MTD',
      finalized: null,
      windowMonths: ['2026-08'],
      datasetGeneratedAt: null,
    },
    kpiFactsEcho: {
      source: null, rowStatus: null, overallStatus: null, componentId: null,
      name: null, status: null, rawScore: null, weight: null,
      weightedContribution: null, maxContribution: null, calculationVersion: null,
    },
    trendAnalysis: {
      status: 'INSUFFICIENT_DATA',
      availableMonths: 1,
      missingMonths: ['2026-06', '2026-07'],
      stats: null,
      periodOverPeriod: [],
      momEcho: null,
      directionEcho: null,
      confidence: 'INSUFFICIENT_DATA',
      noteCodes: [],
      mtdPartial: true,
    },
    patternAnalysis: {
      observations: {
        status: 'OK',
        total: 2,
        approvalDistribution: { approved: 1, pending: 1, rejected: 0 },
        byCategory: emptyDist(),
        bySeverity: emptyDist(),
        byResolutionStatus: emptyDist(),
        monthlySeries: { window: ['2026-08'], counts: [2] },
        monthlySlopePerMonth: null,
        noteCodes: [],
      },
      repeatedIssues: {
        groupBasisEcho: null,
        minOccurrencesEcho: null,
        byCategory: [],
        byType: [],
        windowByCategory: [],
        noteCodes: [],
      },
      deductions: {
        status: 'OK',
        count: 0,
        totalDays: null,
        totalAmount: null,
        avgDaysPerRecord: null,
        byType: emptyDist(),
        noteCodes: [],
      },
    },
    anomalies: [],
    distributionAnalysis: {
      complaints: {
        relationship: 'CONFIRMED',
        status: 'EMPTY',
        total: 0,
        byStatus: emptyDist(),
        byType: emptyDist(),
        bySeverity: emptyDist(),
        resolution: { resolvedOrClosed: 0, stillOpen: 0, avgResolutionDays: null },
        monthlySeries: { window: ['2026-08'], counts: [0] },
        countTrend: null,
        noteCodes: [],
      },
      capa: {
        relationship: 'CONFIRMED',
        status: 'EMPTY',
        total: 0,
        active: 0,
        terminal: 0,
        overdueRatePct: null,
        byStatus: emptyDist(),
        byPriority: emptyDist(),
        bySource: emptyDist(),
        closure: { closedCount: 0, avgClosureDays: null, avgOverdueDays: null },
        monthlySeries: { window: ['2026-08'], counts: [0] },
        monthlySlopePerMonth: null,
        noteCodes: [],
      },
      followUps: {
        relationship: 'CONFIRMED',
        status: 'OK',
        total: 3,
        overdueRatePct: null,
        completionRatePctEcho: null,
        byStatus: emptyDist(),
        byType: emptyDist(),
        byPriority: emptyDist(),
        monthlySeries: { window: ['2026-08'], counts: [3] },
        monthlySlopePerMonth: null,
        noteCodes: [],
      },
      deals: {
        relationship: 'CONFIRMED',
        status: 'OK',
        travelTotal: 3,
        closedTotal: null,
        byStatus: emptyDist(),
        cancellationRatePct: null,
        completionRatePctEcho: null,
        monthlySeries: { window: ['2026-08'], counts: [3] },
        monthlySlopePerMonth: null,
        noteCodes: [],
      },
      attendance: {
        status: 'NOT_AVAILABLE',
        analysisRole: 'CONTEXT_ONLY',
        metrics: null,
        noteCodes: ['ATTENDANCE_NOT_AVAILABLE'],
      },
    },
    periodComparison: {
      status: 'INSUFFICIENT_DATA',
      current: null,
      previous: null,
      deltas: {},
      kpiRawScoreDeltaPoints: null,
      noteCode: null,
    },
    crossDomainPatterns: [],
    correlations: [],
    dataQuality: {
      windowMonths: ['2026-08'],
      missingData: [],
      ambiguousRelationships: [],
      unattributedRecords: [],
      insufficientSamples: [
        { area: 'trend', reason: 'INSUFFICIENT_SAMPLE', required: 3, actual: 1 },
      ],
      unavailableMetrics: [],
      notes: [],
      sourceNotesEcho: [],
    },
    evidenceReferences: [],
    overallConfidence: 'INSUFFICIENT_DATA',
    thresholds: {},
    noteCodes: [],
    interpretationBoundary: 'FACT_AND_ANALYSIS_ONLY',
  };
}

describe('Phase 5.1A — AnalyticsSection status mapping (spec §17.10)', () => {
  it('undefined api → IDLE (no premature status)', () => {
    const view = buildAnalyticsView(undefined);
    assert.equal(view.kind, 'IDLE');
  });

  it('ANALYTICS_UNAVAILABLE → UNAVAILABLE with reason + message passthrough', () => {
    const api: AnalyticsApiResponse = {
      status: 'ANALYTICS_UNAVAILABLE',
      reason: 'PYTHON_UNAVAILABLE',
      message: 'مفسّر بايثون (Python 3) غير متاح على هذا الخادم — باقي التقرير يعمل بشكل طبيعي',
    };
    const view = buildAnalyticsView(api);
    assert.equal(view.kind, 'UNAVAILABLE');
    if (view.kind === 'UNAVAILABLE') {
      assert.equal(view.reason, 'PYTHON_UNAVAILABLE');
      assert.match(view.message, /باقي التقرير يعمل بشكل طبيعي/);
    }
  });

  it('ANALYTICS_ERROR → ERROR (distinct from UNAVAILABLE)', () => {
    const api: AnalyticsApiResponse = {
      status: 'ANALYTICS_ERROR',
      reason: 'DATA_CONTRACT_ERROR',
      message: 'بيانات الفترة لم تطابق عقد التحليل الإحصائي',
    };
    const view = buildAnalyticsView(api);
    assert.equal(view.kind, 'ERROR');
    if (view.kind === 'ERROR') {
      assert.equal(view.reason, 'DATA_CONTRACT_ERROR');
    }
  });

  it('5.2 — ANALYTICS_TIMEOUT → TIMEOUT view (distinct from ERROR and UNAVAILABLE, spec §10/§11)', () => {
    const api: AnalyticsApiResponse = {
      status: 'ANALYTICS_TIMEOUT',
      reason: 'TIMEOUT',
      message: 'انتهت مهلة تنفيذ التحليل الإحصائي',
    };
    const view = buildAnalyticsView(api);
    assert.equal(view.kind, 'TIMEOUT');
    if (view.kind === 'TIMEOUT') {
      assert.equal(view.reason, 'TIMEOUT');
      assert.match(view.message, /مهلة/);
    }
  });

  it('OK with per-method INSUFFICIENT_DATA → READY — never collapsed into UNAVAILABLE (spec §6/§13)', () => {
    const view = buildAnalyticsView({ status: 'OK', analytics: makeOkResult() });
    assert.equal(view.kind, 'READY');
    if (view.kind !== 'READY') return;
    // Trend status is INSUFFICIENT_DATA and is labeled as such — the
    // section itself stays READY and visible.
    assert.match(view.trend.statusLabel, /بيانات الاتجاه غير كافية/);
    assert.equal(view.overallConfidence.label, 'بيانات غير كافية');
    // Current data stays visible: period facts render MTD basis.
    assert.match(view.periodLabel, /2026-08/);
    assert.match(view.periodLabel, /حتى تاريخه/);
    // Data-quality gaps are surfaced, not hidden (spec §13).
    assert.equal(view.gaps.length, 1);
    assert.match(view.gaps[0].detailLabel, /المطلوب 3 — المتاح 1/);
    // Trend facts show explicit unavailable values (stats === null).
    const mean = view.trend.facts.find((f) => f.label === 'المتوسط');
    assert.ok(mean);
    assert.equal(mean.unavailable, true);
    // Missing months are displayed verbatim (never zero-filled).
    assert.match(view.trend.missingLabel ?? '', /2026-06/);
    assert.match(view.trend.missingLabel ?? '', /لا تُعدّ صفراً/);
  });

  it('READY view keeps every domain block renderable from minimal data', () => {
    const view = buildAnalyticsView({ status: 'OK', analytics: makeOkResult() });
    if (view.kind !== 'READY') return assert.fail('expected READY');
    assert.deepEqual(view.anomalies, []);
    assert.deepEqual(view.patterns, []);
    assert.deepEqual(view.correlations, []);
    assert.deepEqual(view.deltas, []);
    assert.deepEqual(view.concentration, []);
    assert.equal(view.noteLabels.length >= 1, true, 'attendance note surfaces');
  });
});
