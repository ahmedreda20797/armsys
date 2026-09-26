// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — deterministic engine contract
//
//  Pins (over PURE builders + in-memory fixtures — no Firebase):
//    1. KPI + follow-up combination        (multi-dimension → PIR)
//    2. KPI + attendance combination       (reported-only never escalates)
//    3. improving trend                    (→ IMPROVING)
//    4. declining trend                    (sustained → PIR)
//    5. repeated weak signals              (3 months below target → PIR)
//    6. isolated bad metric                (never a severe status)
//    7. missing data does not become zero  (explicit unavailable states)
//    8. HR projection excludes technical fields (structural, JSON-level)
//    10. stable employee                   (→ STABLE / monitoring)
//    11. coaching signal                   (single dim → NEEDS_COACHING)
//    12. performance-improvement review    (action wording)
//    13. management-review signal          (canonical critical risk)
//    + threshold honesty (CONFIGURED vs CONFIGURATION_REQUIRED)
//    + safety disclaimer always present
//    + team aggregate distributions (never a leaderboard)
//  (Group 9 — authorization/scope — lives in hr-decision-routes.test.ts)
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHrEmployeeDecisionReport,
  buildHrTeamDecisionReport,
  buildKpiTrendCounters,
  buildProductivityFactors,
} from '@/lib/hr-decision';
import type {
  EmployeePerformanceDataset,
  TrendDirection,
} from '@/lib/performance-intelligence';
import type { KpiTrendPoint } from '@/lib/kpi-reporting';
import type { FollowUp } from '@/types';

const NOW = new Date(2026, 8, 21, 12, 0, 0); // 2026-09-21 noon
const MONTH = '2026-09';
const WINDOW = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const TARGET = 100; // kpiSettings.defaultScore

// ─────────────────────────────────────────────────────────────
//  Dataset fixture — explicit empty defaults (missing ≠ zero)
// ─────────────────────────────────────────────────────────────

function trendPoint(month: string, rawScore: number | null): KpiTrendPoint {
  return {
    monthKey: month,
    valueBasis: rawScore === null ? 'LIVE' : 'LIVE',
    available: rawScore !== null,
    rawScore,
    weightedContribution: null,
    weight: null,
    rowStatus: rawScore === null ? 'PENDING' : 'AVAILABLE',
    finalized: false,
    schemeId: rawScore === null ? null : 'scheme_v1',
    schemeVersion: rawScore === null ? null : 1,
  };
}

function baseDataset(over: {
  scores?: Array<number | null>;
  direction?: TrendDirection | null;
  momDeltaPoints?: number | null;
  followUps?: Partial<EmployeePerformanceDataset['followUps']>;
  deals?: Partial<EmployeePerformanceDataset['deals']>;
  quality?: Partial<EmployeePerformanceDataset['quality']>;
  complaints?: Partial<EmployeePerformanceDataset['complaints']>;
  capa?: Partial<EmployeePerformanceDataset['capa']>;
  attendance?: EmployeePerformanceDataset['attendance'];
}): EmployeePerformanceDataset {
  const scores = over.scores ?? [null, null, null, null, null, null];
  const points = WINDOW.map((m, i) => trendPoint(m, scores[i] ?? null));
  const momDelta = over.momDeltaPoints ?? null;
  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'emp_1',
      employeeName: 'أحمد محمد',
      employeeCode: '001',
      department: 'المبيعات',
      team: 'فريق المبيعات',
      position: 'مندوب مبيعات',
      employmentStatus: 'active',
      eligibleForPeriod: true,
      archivedButEligible: false,
      archivedAt: null,
      restoredAt: null,
      relationship: 'CONFIRMED',
    },
    period: { monthKey: MONTH, valueBasis: 'LIVE', finalized: false, finalizedAt: null },
    kpi: {
      outcomeStatus: 'RESOLVED',
      message: null,
      scheme: null,
      components: [],
      quality: null,
      availableWeight: null,
      weightedTotal: null,
      overallStatus: null,
      rowStatus: scores[scores.length - 1] === null || scores[scores.length - 1] === undefined ? 'PENDING' : 'AVAILABLE',
      calculationVersion: null,
      source: 'kpi_engine',
    },
    trend: {
      windowMonths: WINDOW,
      points,
      mom: momDelta === null ? null : {
        currentMonth: MONTH,
        previousMonth: '2026-08',
        currentRawScore: scores[scores.length - 1] ?? 0,
        previousRawScore: (scores[scores.length - 2] ?? 0),
        deltaPoints: momDelta,
        growthPercent: null,
      },
      direction: over.direction ?? null,
    },
    quality: {
      observations: {
        total: 0, approved: 0, pending: 0, rejected: 0,
        byResolutionStatus: {},
        bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        byCategory: [],
        monthly: [],
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: [],
        byType: [],
        windowByCategory: [],
      },
      deductions: { count: 0, totalDays: 0, totalAmount: 0, byType: [], records: [] },
      ...over.quality,
    },
    complaints: {
      relationship: 'NOT_AVAILABLE',
      total: 0,
      byStatus: {}, byType: {}, bySeverity: {},
      repeatedTypes: [],
      resolvedOrClosed: 0,
      stillOpen: 0,
      viaDealCount: 0,
      avgResolutionDays: null,
      monthly: [],
      ...over.complaints,
    },
    capa: {
      relationship: 'NOT_AVAILABLE',
      total: 0, byStatus: {}, byPriority: {}, bySource: {},
      active: 0, terminal: 0, overdue: 0, avgOverdueDays: null,
      correctiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      preventiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      closedCount: 0, avgClosureDays: null, indirectCount: 0, monthly: [],
      ...over.capa,
    },
    followUps: {
      relationship: 'NOT_AVAILABLE',
      total: 0,
      byStatus: {},
      active: 0,
      terminal: 0,
      overdue: 0,
      dueToday: 0,
      avgOverdueDays: null,
      completed: 0,
      completionRate: null,
      byType: {},
      byPriority: {},
      monthly: [],
      ...over.followUps,
    },
    deals: {
      relationship: 'NOT_AVAILABLE',
      travelTotal: 0,
      byStatus: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
      canceled: 0, active: 0, completionRate: null, monthly: [],
      closedTotal: 0, closedMonthly: [], closedUnknownMonth: 0,
      createdTotal: 0, createdMonthly: [],
      closedWithEmployeeTotal: 0, closedWithEmployeeInPeriod: 0,
      closedWithEmployeeMonthly: [], closedWithEmployeeUnknownMonth: 0,
      statusAllTime: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
      ...over.deals,
    },
    attendance: over.attendance ?? { status: 'NOT_AVAILABLE', source: 'attendanceResults', result: null },
    dataQuality: {
      windowMonths: WINDOW,
      unattributedRecords: [],
      notes: [],
    },
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
    generatedAt: NOW.toISOString(),
  };
}

function followUpFixture(over: Partial<FollowUp> & { id: string }): FollowUp {
  return {
    employeeId: 'emp_1',
    date: '01/09/2026',
    followUpType: 'productivity',
    subject: 'متابعة',
    detailedDescription: '',
    positiveNotes: '',
    negativeNotes: '',
    rootCause: '',
    actionTaken: '',
    department: 'المبيعات',
    position: 'مندوب',
    priorityLevel: 'medium',
    responsiblePerson: 'u1',
    nextFollowUpDate: null,
    followUpRequired: false,
    status: 'open',
    score: 0,
    attachments: [],
    createdById: 'u1',
    createdByName: 'مدير',
    relatedDeductionId: null,
    relatedCapaId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function build(
  dataset: EmployeePerformanceDataset,
  followUps: FollowUp[] = [],
  hrMonth: Parameters<typeof buildHrEmployeeDecisionReport>[0]['hrMonth'] = null,
) {
  return buildHrEmployeeDecisionReport({
    monthKey: MONTH,
    targetScore: TARGET,
    dataset,
    followUps,
    capaCases: [],
    hrMonth,
    now: NOW,
  });
}

// ─────────────────────────────────────────────────────────────
//  10) Stable employee — clean on-target record
// ─────────────────────────────────────────────────────────────

describe('stable employee', () => {
  it('on-target KPI + no negative signals → STABLE with monitoring action', () => {
    const report = build(baseDataset({
      scores: [100, 100, 100, 100, 100, 100],
      direction: 'STABLE',
      momDeltaPoints: 0,
      deals: { travelTotal: 4, closedTotal: 4, closedUnknownMonth: 0, canceled: 0, active: 0 },
    }));
    assert.equal(report.executive.status, 'STABLE');
    assert.equal(report.action.actionKind, 'CONTINUE_MONITORING');
    assert.equal(report.action.actionAr, 'متابعة دورية اعتيادية');
    // KPI on-target is recorded as a POSITIVE factor (measurable strength).
    assert.ok(report.strengths.some((f) => f.category === 'KPI' && f.ruleId === 'KPI_AT_OR_ABOVE_CONFIGURED_TARGET'));
    assert.equal(report.executive.kpiScore, 100);
  });

  it('the safety disclaimer is ALWAYS attached to the action', () => {
    const report = build(baseDataset({ scores: [100, 100, 100, 100, 100, 100] }));
    assert.ok(report.action.disclaimerAr.includes('ليست قراراً نهائياً'));
    assert.ok(report.action.disclaimerAr.includes('قراراً بشرياً'));
  });
});

// ─────────────────────────────────────────────────────────────
//  3) Improving trend
// ─────────────────────────────────────────────────────────────

describe('improving trend', () => {
  it('rising scores with no judged negatives → IMPROVING + recognize action', () => {
    const report = build(baseDataset({
      scores: [90, 95, 100, 100, 95, 100],
      direction: 'UP',
      momDeltaPoints: 5,
    }));
    assert.equal(report.executive.status, 'IMPROVING');
    assert.equal(report.action.actionKind, 'RECOGNIZE_IMPROVEMENT');
    assert.ok(report.strengths.some((f) => f.category === 'TREND' && f.ruleId === 'TREND_CONSECUTIVE_IMPROVEMENT'));
  });
});

// ─────────────────────────────────────────────────────────────
//  11) Coaching signal — single weak dimension
// ─────────────────────────────────────────────────────────────

describe('coaching signal', () => {
  it('single month below the configured target → NEEDS_COACHING (isolated, never severe)', () => {
    const report = build(baseDataset({
      scores: [100, 100, 100, 100, 100, 90],
      direction: 'DOWN',
      momDeltaPoints: -10,
    }));
    assert.equal(report.executive.status, 'NEEDS_COACHING');
    assert.equal(report.action.actionKind, 'COACHING');
    assert.equal(report.action.status, 'NEEDS_COACHING');
    assert.equal(report.factors.length > 0, true);
    const kpi = report.factors.find((f) => f.category === 'KPI');
    assert.equal(kpi?.thresholdBasis, 'CONFIGURED');
    assert.equal(kpi?.thresholdValue, TARGET);
  });
});

// ─────────────────────────────────────────────────────────────
//  6) Isolated bad metric never triggers a severe status
// ─────────────────────────────────────────────────────────────

describe('isolated bad metric', () => {
  it('one overdue follow-up month (LOW) + on-target KPI → STABLE; concern still recorded', () => {
    const dataset = baseDataset({
      scores: [100, 100, 100, 100, 100, 100],
      followUps: { total: 3, completed: 2, overdue: 1, completionRate: 66.7, relationship: 'CONFIRMED' },
    });
    const followUps = [
      followUpFixture({ id: 'f1', nextFollowUpDate: '2026-09-10T00:00:00.000Z' }), // overdue, month 2026-09
    ];
    const report = build(dataset, followUps);
    assert.equal(report.executive.status, 'STABLE');
    // The LOW concern is recorded (not hidden) but never escalates.
    assert.ok(report.concerns.some((f) => f.category === 'FOLLOW_UP' && f.severity === 'LOW'));
  });

  it('two consecutive declining steps (still above target) → NEEDS_COACHING at most', () => {
    const report = build(baseDataset({
      // Exactly 2 consecutive declining steps ENDING at the current month.
      scores: [120, 115, 113, 113, 110, 108],
      direction: 'DOWN',
      momDeltaPoints: -2,
    }));
    assert.equal(report.executive.status, 'NEEDS_COACHING');
    assert.notEqual(report.executive.status, 'PERFORMANCE_IMPROVEMENT_REVIEW');
  });
});

// ─────────────────────────────────────────────────────────────
//  1) KPI + follow-up combination → multi-dimension weakness
// ─────────────────────────────────────────────────────────────

describe('KPI + follow-up combination', () => {
  it('below-target KPI + repeated overdue follow-up months → PERFORMANCE_IMPROVEMENT_REVIEW', () => {
    const dataset = baseDataset({
      scores: [100, 100, 100, 100, 92, 90],
      direction: 'DOWN',
      momDeltaPoints: -2,
      followUps: { total: 5, completed: 2, overdue: 2, completionRate: 40, relationship: 'CONFIRMED' },
    });
    const followUps = [
      followUpFixture({ id: 'f1', date: '01/08/2026', nextFollowUpDate: '2026-08-05T00:00:00.000Z' }),
      followUpFixture({ id: 'f2', date: '02/09/2026', nextFollowUpDate: '2026-09-05T00:00:00.000Z' }),
    ];
    const report = build(dataset, followUps);
    assert.equal(report.executive.status, 'PERFORMANCE_IMPROVEMENT_REVIEW');
    assert.equal(report.action.actionKind, 'IMPROVEMENT_PLAN');
    const dims = new Set(report.factors.filter((f) => f.kind === 'NEGATIVE' && f.severity !== 'LOW').map((f) => f.category));
    assert.ok(dims.has('KPI'));
    assert.ok(dims.has('FOLLOW_UP'));
  });
});

// ─────────────────────────────────────────────────────────────
//  2) KPI + attendance combination — reported-only never escalates
// ─────────────────────────────────────────────────────────────

describe('KPI + attendance combination', () => {
  it('below-target KPI with measured attendance → NEEDS_COACHING only; attendance REPORTED (no configured threshold)', () => {
    const dataset = baseDataset({
      scores: [100, 100, 100, 100, 100, 85],
      direction: 'DOWN',
      momDeltaPoints: -15,
      attendance: {
        status: 'AVAILABLE',
        source: 'attendanceResults',
        result: {
          month: MONTH,
          workDays: 22, presentDays: 18, lateDays: 3, absentDays: 2,
          exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 95,
          lateDeductionDays: 0.75, absenceDeductionDays: 2, attendanceDeductionDays: 2.75,
          compliance: 81, engineVersion: 'attendance-v1', generatedAt: null,
        },
      },
    });
    const report = build(dataset);
    assert.equal(report.executive.status, 'NEEDS_COACHING');
    const attendance = report.factors.find((f) => f.category === 'ATTENDANCE');
    assert.equal(attendance?.severity, 'LOW');
    assert.equal(attendance?.thresholdBasis, 'CONFIGURATION_REQUIRED');
    assert.equal(attendance?.thresholdValue, null);
    assert.equal(attendance?.value, 81);
    // The compliance value appears ONLY as a measurement, never as a judgment.
    assert.ok(attendance?.comparisonAr?.includes('لا يوجد حد أدنى مُهيّأ') ?? false);
  });
});

// ─────────────────────────────────────────────────────────────
//  4) Declining trend (sustained)
// ─────────────────────────────────────────────────────────────

describe('declining trend', () => {
  it('3 consecutive declining steps ABOVE target → PERFORMANCE_IMPROVEMENT_REVIEW (sustained decline)', () => {
    const report = build(baseDataset({
      scores: [115, 115, 115, 110, 108, 105],
      direction: 'DOWN',
      momDeltaPoints: -3,
    }));
    assert.equal(report.executive.status, 'PERFORMANCE_IMPROVEMENT_REVIEW');
    assert.ok(report.action.rationaleAr.length > 0);
    assert.equal(report.trend.consecutiveDecliningSteps, 3);
  });
});

// ─────────────────────────────────────────────────────────────
//  5) Repeated weak signals
// ─────────────────────────────────────────────────────────────

describe('repeated weak signals', () => {
  it('3 consecutive months below the configured target → PERFORMANCE_IMPROVEMENT_REVIEW (repeated, not isolated)', () => {
    const report = build(baseDataset({
      scores: [100, 100, 100, 95, 90, 85],
      direction: 'DOWN',
      momDeltaPoints: -3,
    }));
    assert.equal(report.executive.status, 'PERFORMANCE_IMPROVEMENT_REVIEW');
    assert.equal(report.trend.consecutiveBelowTarget, 3);
    const kpi = report.factors.find((f) => f.category === 'KPI');
    assert.equal(kpi?.severity, 'HIGH');
  });

  it('2 months below target stay at coaching (the escalation ladder is respected)', () => {
    const report = build(baseDataset({
      scores: [100, 100, 100, 100, 95, 92],
      direction: 'DOWN',
      momDeltaPoints: -3,
    }));
    assert.equal(report.executive.status, 'NEEDS_COACHING');
    assert.equal(report.trend.consecutiveBelowTarget, 2);
  });
});

// ─────────────────────────────────────────────────────────────
//  13) Management-review signal — canonical critical risk
// ─────────────────────────────────────────────────────────────

describe('management-review signal', () => {
  it('canonical risk level critical (≥51) → MANAGEMENT_REVIEW with HR+management action', () => {
    // 10 absences (capped 30) + 6 open critical follow-ups (capped 30) = 60 → critical.
    const criticalFollowUps = Array.from({ length: 6 }, (_, i) =>
      followUpFixture({ id: `fc${i}`, priorityLevel: 'critical', status: 'open' }));
    const dataset = baseDataset({
      scores: [100, 100, 100, 100, 100, 90],
      followUps: { total: 6, completed: 0, overdue: 6, completionRate: 0, relationship: 'CONFIRMED' },
      attendance: {
        status: 'AVAILABLE',
        source: 'attendanceResults',
        result: {
          month: MONTH,
          workDays: 22, presentDays: 12, lateDays: 0, absentDays: 10,
          exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 0,
          lateDeductionDays: 0, absenceDeductionDays: 10, attendanceDeductionDays: 10,
          compliance: 55, engineVersion: 'attendance-v1', generatedAt: null,
        },
      },
    });
    const report = build(dataset, criticalFollowUps);
    assert.equal(report.executive.status, 'MANAGEMENT_REVIEW');
    assert.equal(report.action.actionKind, 'MANAGEMENT_HR_REVIEW');
    assert.equal(report.executive.riskLevel, 'critical');
    assert.ok(report.executive.riskScore >= 51);
  });
});

// ─────────────────────────────────────────────────────────────
//  7) Missing data does not become zero
// ─────────────────────────────────────────────────────────────

describe('missing data does not become zero', () => {
  it('empty dataset → explicit unavailable states, STABLE status, null values preserved', () => {
    const report = build(baseDataset({}));
    assert.equal(report.executive.kpiScore, null);
    assert.equal(report.executive.status, 'STABLE');
    const kpiEntry = report.scorecard.find((e) => e.category === 'KPI');
    assert.equal(kpiEntry?.availability, 'NOT_AVAILABLE');
    assert.ok(kpiEntry?.unavailableReasonAr);
    const followUpEntry = report.scorecard.find((e) => e.category === 'FOLLOW_UP');
    assert.equal(followUpEntry?.availability, 'NOT_AVAILABLE');
    const attendanceEntry = report.scorecard.find((e) => e.category === 'ATTENDANCE');
    assert.equal(attendanceEntry?.availability, 'NOT_AVAILABLE');
    assert.ok(report.dataQuality.notesAr.some((n) => n.includes('الحضور')));
    assert.ok(report.dataQuality.notesAr.some((n) => n.includes('لا يوجد حد أدنى مُهيّأ')));
    // No zero-filling anywhere in the serialized report.
    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('"kpiScore":0'));
    assert.ok(!serialized.includes('"value":0,"unit":"percent"'));
  });

  it('KPI counters never treat a missing score as 0', () => {
    const counters = buildKpiTrendCounters(baseDataset({}), TARGET);
    assert.equal(counters.currentScore, null);
    assert.equal(counters.belowTarget, false);
    assert.equal(counters.monthsWithScore, 0);
    assert.equal(counters.consecutiveBelowTarget, 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  8) HR projection excludes technical fields (structural)
// ─────────────────────────────────────────────────────────────

describe('HR projection excludes technical fields', () => {
  it('a data-rich employee produces a report whose JSON carries NO technical evidence', () => {
    const dataset = baseDataset({
      scores: [88, 90, 92, 94, 96, 98],
      direction: 'UP',
      momDeltaPoints: 2,
      quality: {
        observations: {
          total: 3, approved: 2, pending: 1, rejected: 0,
          byResolutionStatus: { resolved: 2, open: 1 },
          bySeverity: { low: 1, medium: 1, high: 1, critical: 0 },
          byCategory: [{ categoryId: 'cat_late', categoryName: 'تأخر المتابعة', count: 3 }],
          monthly: [{ month: MONTH, count: 3 }],
        },
        repeatedIssues: {
          groupBasis: { category: 'categoryId', type: 'type' },
          minOccurrences: 2,
          byCategory: [{
            issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 3,
            firstOccurrence: '05/09/2026', lastOccurrence: '15/09/2026',
            observationIds: ['obs_1', 'obs_2', 'obs_3'],
          }],
          byType: [],
          windowByCategory: [{
            issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 5,
            monthsPresent: 3, firstMonth: '2026-07', lastMonth: '2026-09',
            observationIds: ['obs_1', 'obs_2', 'obs_3', 'obs_4', 'obs_5'],
          }],
        },
        deductions: {
          count: 1, totalDays: 0.5, totalAmount: 0,
          byType: [{ categoryId: 'late', categoryName: 'تأخير', count: 1 }],
          records: [{
            id: 'ded_1', date: '10/09/2026', month: MONTH, type: 'late',
            description: 'وصف تقني داخلي', deductionDays: 0.5, deductionAmount: 0, relatedCapaId: null,
          }],
        },
      },
      complaints: { total: 1, stillOpen: 1, relationship: 'CONFIRMED' },
    });
    const report = build(dataset, [
      followUpFixture({ id: 'f1', negativeNotes: 'نص فني داخلي' }),
    ]);
    const serialized = JSON.stringify(report);
    for (const technical of [
      'observationIds', 'recordIds', 'collection', 'evidence',
      'deductionPoints', 'bonusPoints', 'weightedContribution',
      'componentId', 'availableWeight', 'problemDescription',
      'detailedDescription', 'rootCause', 'issueCategory',
      'customerName', 'dealCustomer', '"notes"',
      'وصف تقني داخلي', 'نص فني داخلي',
    ]) {
      assert.ok(!serialized.includes(technical), `technical field leaked into HR report: ${technical}`);
    }
    // HR-safe aggregates ARE present.
    assert.ok(serialized.includes('عدد ملاحظات الجودة'));
  });
});

// ─────────────────────────────────────────────────────────────
//  12) Performance-improvement review action wording
// ─────────────────────────────────────────────────────────────

describe('performance-improvement review wording', () => {
  it('PIR action is a FORMAL REVIEW recommendation — never an employment decision', () => {
    const report = build(baseDataset({
      scores: [100, 100, 95, 90, 88, 85],
      direction: 'DOWN',
      momDeltaPoints: -3,
    }));
    assert.equal(report.executive.status, 'PERFORMANCE_IMPROVEMENT_REVIEW');
    assert.equal(report.action.actionAr, 'مراجعة أداء رسمية وربما خطة تحسين أداء موثّقة');
    assert.ok(!JSON.stringify(report).includes('فصل'));
    assert.ok(!JSON.stringify(report).includes('إنهاء خدمة'));
    assert.ok(!JSON.stringify(report).includes('terminate'));
  });
});

// ─────────────────────────────────────────────────────────────
//  Team aggregate — distributions, never a leaderboard
// ─────────────────────────────────────────────────────────────

describe('team/department aggregate', () => {
  it('distributes statuses, averages KPI over comparable scores only, and keeps rows leaderboard-free', () => {
    const withId = (r: ReturnType<typeof build>, id: string) => ({
      ...r,
      employee: { ...r.employee, employeeId: id },
    });
    const stable = withId(build(baseDataset({ scores: [100, 100, 100, 100, 100, 100] })), 'emp_stable');
    const coaching = withId(
      build(baseDataset({ scores: [100, 100, 100, 100, 100, 90], direction: 'DOWN', momDeltaPoints: -10 })),
      'emp_coach',
    );
    const noData = withId(build(baseDataset({})), 'emp_nodata');
    const team = buildHrTeamDecisionReport({
      monthKey: MONTH,
      valueBasis: 'LIVE',
      finalized: false,
      reports: [coaching, noData, stable],
      opsFacts: new Map([
        ['emp_stable', {
          followUpTotal: 4, followUpOverdue: 1, followUpCompletionRate: 75,
          attendanceCompliance: 90, attendanceLateDays: 2, attendanceAbsentDays: 0,
          dealsTravelVolume: 5, dealsClosed: 4,
        }],
      ]),
      now: NOW,
    });
    assert.equal(team.totals.employees, 3);
    assert.equal(team.totals.stable, 2); // the no-data employee is STABLE (never penalized)
    assert.equal(team.totals.needsCoaching, 1);
    assert.equal(team.totals.withKpiResult, 2);
    assert.equal(team.totals.averageKpi, 95); // (100 + 90) / 2 — null never averaged as 0
    assert.equal(team.rows.length, 3);
    // Status-severity distribution order (a category grouping).
    assert.equal(team.rows[0]?.status, 'NEEDS_COACHING');
    assert.equal(team.rows[team.rows.length - 1]?.status, 'STABLE');
    // No evaluative leaderboard fields on rows.
    const serialized = JSON.stringify(team.rows);
    assert.ok(!serialized.includes('"rank"'));
    assert.ok(!serialized.includes('"score"'));
    assert.ok(!serialized.includes('"percentile"'));
    // Concern count counts MEDIUM+ only.
    const coachingRow = team.rows.find((r) => r.status === 'NEEDS_COACHING');
    assert.equal((coachingRow?.concernCount ?? 0) >= 1, true);
    const noDataRow = team.rows.find((r) => r.kpiScore === null);
    assert.equal(noDataRow?.topConcernAr, null);
    // Operational totals — only employees WITH data enter each average.
    assert.equal(team.operational.followUps.employeesWithData, 1);
    assert.equal(team.operational.attendance.employeesWithResult, 1);
    assert.equal(team.operational.attendance.averageCompliance, 90);
    // §DEAL-DATES — the team snapshot carries both canonical dimensions.
    assert.equal(team.operational.productivity.travelVolume, 5);
    assert.equal(team.operational.productivity.closedDeals, 4);
  });
});

// ─────────────────────────────────────────────────────────────
//  §DEAL-DATES — HR productivity reads the CLOSED dimension
// ─────────────────────────────────────────────────────────────

describe('§DEAL-DATES — HR productivity uses closedAt, not departureDate', () => {
  it('§17.6 — the productivity scorecard + factor value come from closedTotal (closedAt)', () => {
    const report = build(baseDataset({
      scores: [100, 100, 100, 100, 100, 100],
      direction: 'STABLE',
      momDeltaPoints: 0,
      // 3 deals departing in the period (travel volume) but only 1
      // observed closure (closedAt) + 2 completed deals whose closure
      // month is unknown (legacy, never attributed).
      deals: { travelTotal: 3, closedTotal: 1, closedUnknownMonth: 2, canceled: 0, active: 2 },
    }));
    const entry = report.scorecard.find((e) => e.category === 'PRODUCTIVITY');
    assert.ok(entry, 'PRODUCTIVITY entry present');
    const closed = entry.metrics.find((m) => m.labelAr === 'صفقات مكتملة (تاريخ الإغلاق)');
    const travel = entry.metrics.find((m) => m.labelAr === 'حجم السفر (تاريخ المغادرة)');
    const unknown = entry.metrics.find((m) => m.labelAr === 'مكتملة بتاريخ إغلاق غير محدد');
    assert.equal(closed?.value, 1);
    assert.equal(travel?.value, 3);
    assert.equal(unknown?.value, 2);
  });

  it('§17.6 — the productivity factor reports the closed count as its value', () => {
    const dataset = baseDataset({
      scores: [100, 100, 100, 100, 100, 100],
      direction: 'STABLE',
      deals: { travelTotal: 3, closedTotal: 1, closedUnknownMonth: 2, canceled: 0, active: 2 },
    });
    const factors = buildProductivityFactors({
      dataset,
      hrMonth: null,
      followUps: { activeByPriority: { low: 0, medium: 0, high: 0, critical: 0 }, activeTotal: 0, overdueMonths: [], repeatedIssueAlertCount: 0 },
      capaStats: { openCapaCount: 0, overdueCapaCount: 0, criticalCapaCount: 0, reopenedCapaCount: 0 },
      kpi: { currentScore: 100, belowTarget: false, monthsWithScore: 1, consecutiveBelowTarget: 0, consecutiveDecliningSteps: 0, direction: 'STABLE' as const, momDeltaPoints: 0 },
      targetScore: TARGET,
    });
    assert.equal(factors.length, 1);
    assert.equal(factors[0]?.value, 1);
    assert.ok(factors[0]?.signalAr.includes('بتاريخ الإغلاق'));
    assert.ok(factors[0]?.signalAr.includes('بتاريخ المغادرة'));
    assert.ok(factors[0]?.signalAr.includes('غير محدد: ٢'), 'unknown-closure deals are surfaced in the signal');
  });

  it('§17.15 — NOT_AVAILABLE stays NOT_AVAILABLE only when BOTH dimensions are empty', () => {
    const report = build(baseDataset({ scores: [100, 100, 100, 100, 100, 100] }));
    const entry = report.scorecard.find((e) => e.category === 'PRODUCTIVITY');
    assert.equal(entry?.availability, 'NOT_AVAILABLE');
  });
});
