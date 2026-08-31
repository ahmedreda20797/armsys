// ══════════════════════════════════════════════════════════════
//  Shared analytics test fixtures (Phase 5 / Phase 5.2)
//
//  A contract-realistic EmployeeAnalyticsResult mirroring the
//  §42 partial-MTD scenario (2 obs, 0 complaints/capa, 3 follow-ups,
//  3 deals, MTD). Used by view-mapping tests AND remote-bridge
//  tests (as the mocked service response body).
// ══════════════════════════════════════════════════════════════

import {
  ANALYTICS_KIND,
  ANALYTICS_SCHEMA_VERSION,
  type EmployeeAnalyticsResult,
} from '@/lib/analytics/types';

const emptyDist = () => ({ total: 0, items: [], concentration: [] });

/** Minimal OK result carrying per-method INSUFFICIENT_DATA (spec §5/§42). */
export function makeOkResult(): EmployeeAnalyticsResult {
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
        total: 3,
        byStatus: emptyDist(),
        cancellationRatePct: null,
        completionRatePctEcho: null,
        monthlySeries: { window: ['2026-08'], counts: [3] },
        monthlySlopePerMonth: null,
        noteCodes: [],
      },
      attendance: {
        status: 'UNAVAILABLE',
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
        {
          area: 'mtdPartialMonth',
          reason: 'MTD_PARTIAL_MONTH',
          detail: 'Reported month is MTD; partial-month analyses are excluded by design.',
        },
      ],
      unavailableMetrics: ['attendance'],
      notes: [],
      sourceNotesEcho: [],
    },
    evidenceReferences: [
      { collection: 'qualityObservations', recordIds: ['obs-1', 'obs-2'], completeRecordList: true },
      { collection: 'followUps', recordIds: ['f1', 'f2', 'f3'], completeRecordList: true },
    ],
    overallConfidence: 'INSUFFICIENT_DATA',
    thresholds: {},
    noteCodes: [],
    interpretationBoundary: 'FACT_AND_ANALYSIS_ONLY',
  };
}
