// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — deterministic analysis rules (§10-§22)
//
//  Run: npx tsx --test src/lib/performance-hub/__tests__/analysis.test.ts
//
//  Covers the Hub spec's mandatory scenarios:
//    1  Missing data ≠ zero (quality/attendance/follow-up INSUFFICIENT_DATA)
//    2  Dimension status rules (quality delta, repeated escalation)
//    3  Follow-up statuses (overdue attention, strong completion)
//    4  Attendance rules (canonical compliance bands + delta)
//    5  Business output (DEAL_CLOSED dimension; domain-inactive → unavailable)
//    6  Risk/HR dimensions withheld when their blocks are restricted
//    7  Overview escalation (risk critical → MANAGEMENT_REVIEW, 2 declining → PIR)
//    8  Changes (both-null metric excluded, main change, sign semantics)
//    9  Patterns (REPEATED/PERSISTENT/EMERGING/IMPROVING/ISOLATED)
//   10  Strengths/areas/recommendations (evidence-backed, capped, none without evidence)
//   11  Observations ≠ quality deductions ≠ HR deductions separation
//   12  Association-only cross-signals (never causal)
//
//  Convention: pure builders + synthetic datasets (no db, no mocking).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildHubAnalysis } from '@/lib/performance-hub/analysis';
import type { RiskResult } from '@/lib/metrics';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';

// ─────────────────────────────────────────────────────────────
//  Synthetic dataset factory — an EMPTY-but-valid dataset (every
//  domain at its natural "no data" state); tests override slices.
// ─────────────────────────────────────────────────────────────

function emptyDataset(employeeId: string, monthKey: string): EmployeePerformanceDataset {
  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId,
      employeeName: 'موظف',
      employeeCode: '001',
      department: null,
      team: null,
      manager: null,
      position: null,
      employmentStatus: 'active',
      eligibleForPeriod: true,
      archivedButEligible: false,
      archivedAt: null,
      restoredAt: null,
      relationship: 'CONFIRMED',
    },
    period: { monthKey, valueBasis: 'MTD', finalized: false, finalizedAt: null },
    kpi: {
      outcomeStatus: 'RESOLVED',
      message: null,
      scheme: null,
      components: [],
      quality: null,
      availableWeight: null,
      weightedTotal: null,
      overallStatus: null,
      rowStatus: 'PENDING',
      calculationVersion: null,
      source: 'kpi_engine',
    },
    trend: { windowMonths: [monthKey], points: [], mom: null, direction: null },
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
    },
    complaints: {
      relationship: 'CONFIRMED',
      total: 0, byStatus: {}, byType: {}, bySeverity: {}, repeatedTypes: [],
      resolvedOrClosed: 0, stillOpen: 0, viaDealCount: 0, avgResolutionDays: null, monthly: [],
    },
    capa: {
      relationship: 'CONFIRMED',
      total: 0, byStatus: {}, byPriority: {}, bySource: {},
      active: 0, terminal: 0, overdue: 0, avgOverdueDays: null,
      correctiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      preventiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      closedCount: 0, avgClosureDays: null, indirectCount: 0, monthly: [],
    },
    followUps: {
      relationship: 'CONFIRMED',
      total: 0, byStatus: {}, active: 0, terminal: 0, overdue: 0, dueToday: 0,
      avgOverdueDays: null, completed: 0, completionRate: null, byType: {}, byPriority: {}, monthly: [],
    },
    deals: {
      relationship: 'CONFIRMED',
      travelTotal: 0,
      byStatus: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
      canceled: 0, active: 0, completionRate: null, monthly: [],
      closedTotal: 0, closedMonthly: [], closedUnknownMonth: 0,
      createdTotal: 0, createdMonthly: [],
      closedWithEmployeeTotal: 0, closedWithEmployeeInPeriod: 0, closedWithEmployeeMonthly: [],
      closedWithEmployeeUnknownMonth: 0,
      closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
      statusAllTime: { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 },
    },
    attendance: { status: 'NOT_AVAILABLE', source: 'attendanceResults', result: null },
    dataQuality: { windowMonths: [monthKey], unattributedRecords: [], notes: [] },
    evidence: {
      kpi: [{ collection: 'monthSnapshots', recordIds: [monthKey] }],
      observations: { collection: 'qualityObservations', recordIds: [] },
      deductions: { collection: 'qualityDeductions', recordIds: [] },
      complaints: { collection: 'complaints', recordIds: [] },
      capa: { collection: 'capaCases', recordIds: [] },
      followUps: { collection: 'followUps', recordIds: [] },
      deals: { collection: 'travelDeals', recordIds: [] },
      attendance: null,
    },
    generatedAt: '2026-08-21T12:00:00.000Z',
  };
}

const ZERO_RISK: RiskResult = {
  score: 0,
  level: 'low',
  breakdown: {
    delay: { count: 0, points: 0 }, absence: { count: 0, points: 0 },
    quality: { count: 0, points: 0 }, hr: { count: 0, points: 0 },
    openFollowUp: { count: 0, points: 0 }, highPriorityFollowUp: { count: 0, points: 0 },
    criticalFollowUp: { count: 0, points: 0 }, complaint: { count: 0, points: 0 },
    repeatedIssue: { count: 0, points: 0 }, openCapa: { count: 0, points: 0 },
    overdueCapa: { count: 0, points: 0 }, criticalCapa: { count: 0, points: 0 },
    reopenedCapa: { count: 0, points: 0 },
  },
};

const HR_MONTH: EmployeeHrMonthSummary = {
  month: '2026-08', deductionCount: 1, deductionDays: 0, deductionAmount: 500, statusCounts: { approved: 1 },
};

describe('missing data is never zero (Hub spec §10)', () => {
  it('1a · quality with no engine value is INSUFFICIENT_DATA with value null', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    const quality = analysis.dimensions.find((d) => d.key === 'quality')!;
    assert.equal(quality.status, 'INSUFFICIENT_DATA');
    assert.equal(quality.value, null);
    assert.equal(quality.delta, null);
  });

  it('1b · attendance without a stored result is INSUFFICIENT_DATA — compliance is never fabricated', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    const attendance = analysis.dimensions.find((d) => d.key === 'attendance')!;
    assert.equal(attendance.status, 'INSUFFICIENT_DATA');
    assert.equal(attendance.value, null);
    assert.equal(attendance.details.attendance?.status, 'NOT_AVAILABLE');
    assert.equal(attendance.details.attendance?.compliance, null);
  });

  it('1c · follow-ups with no records are INSUFFICIENT_DATA (completionRate null, not 0)', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    const followUp = analysis.dimensions.find((d) => d.key === 'followUp')!;
    assert.equal(followUp.status, 'INSUFFICIENT_DATA');
    assert.equal(followUp.value, null);
  });

  it('1d · a deals-inactive employee is INSUFFICIENT_DATA on business output', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    const output = analysis.dimensions.find((d) => d.key === 'businessOutput')!;
    assert.equal(output.status, 'INSUFFICIENT_DATA');
  });

  it('1e · an all-empty employee yields an INSUFFICIENT_DATA overview', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.equal(analysis.overview.status, 'INSUFFICIENT_DATA');
    assert.ok(analysis.overview.reasons.includes('rule.noMeasurableDimensions'));
  });
});

describe('restricted blocks are withheld server-side (dimensions absent)', () => {
  it('6a · risk restricted → no risk dimension at all', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.equal(analysis.dimensions.find((d) => d.key === 'risk'), undefined);
  });

  it('6b · HR restricted → no HR dimension at all (never a zero count)', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: ZERO_RISK, previous: null }, hr: null });
    assert.equal(analysis.dimensions.find((d) => d.key === 'hr'), undefined);
  });

  it('6c · HR present with 1 deduction → NEEDS_ATTENTION (not merged anywhere else)', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: ZERO_RISK, previous: null }, hr: { current: HR_MONTH, previous: null } });
    const hr = analysis.dimensions.find((d) => d.key === 'hr')!;
    assert.equal(hr.status, 'NEEDS_ATTENTION');
    assert.equal(hr.value, 1);
  });
});

describe('dimension status rules (§9/§10)', () => {
  it('2a · quality +6 pts vs previous IMPROVING; -6 DECLINING; ±2 STABLE', () => {
    const mk = (current: number | null, previous: number | null) => {
      const cur = emptyDataset('e1', '2026-08');
      cur.kpi.quality = current === null ? null : {
        componentId: 'quality', name: 'الجودة', status: 'AVAILABLE',
        rawScore: current, weight: 15, weightedContribution: current * 0.15,
        maxContribution: 15, observationCount: 2, deductionPoints: 0, bonusPoints: 0,
      };
      cur.kpi.rowStatus = current === null ? 'PENDING' : 'AVAILABLE';
      const prev = previous === null ? null : emptyDataset('e1', '2026-07');
      if (prev && previous !== null) {
        prev.kpi.quality = {
          componentId: 'quality', name: 'الجودة', status: 'AVAILABLE',
          rawScore: previous, weight: 15, weightedContribution: previous * 0.15,
          maxContribution: 15, observationCount: 2, deductionPoints: 0, bonusPoints: 0,
        };
        prev.kpi.rowStatus = 'FINALIZED';
      }
      return buildHubAnalysis({ current: cur, previous: prev, risk: { current: null, previous: null }, hr: null })
        .dimensions.find((d) => d.key === 'quality')!;
    };
    assert.equal(mk(88, 82).status, 'IMPROVING');
    assert.equal(mk(76, 82).status, 'DECLINING');
    assert.equal(mk(84, 82).status, 'STABLE');
    assert.equal(mk(82, null).status, 'STABLE'); // no previous → no fabricated trend
  });

  it('2b · repeated issues escalate a flat quality to NEEDS_ATTENTION', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.kpi.quality = {
      componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 84, weight: 15,
      weightedContribution: 12.6, maxContribution: 15, observationCount: 4, deductionPoints: 16, bonusPoints: 0,
    };
    cur.kpi.rowStatus = 'AVAILABLE';
    cur.quality.repeatedIssues.byCategory.push({
      issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 3,
      firstOccurrence: '03/08/2026', lastOccurrence: '18/08/2026', observationIds: ['o1', 'o2', 'o3'],
    });
    const analysis = buildHubAnalysis({ current: cur, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.equal(analysis.dimensions.find((d) => d.key === 'quality')!.status, 'NEEDS_ATTENTION');
  });

  it('3 · follow-ups: 3+ overdue NEEDS_ATTENTION; 100% with zero overdue STRONG', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.followUps = { ...cur.followUps, total: 10, active: 4, overdue: 4, completed: 6, completionRate: 60 };
    const a = buildHubAnalysis({ current: cur, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.equal(a.dimensions.find((d) => d.key === 'followUp')!.status, 'NEEDS_ATTENTION');

    const good = emptyDataset('e2', '2026-08');
    good.followUps = { ...good.followUps, total: 5, active: 0, overdue: 0, completed: 5, completionRate: 100 };
    const b = buildHubAnalysis({ current: good, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.equal(b.dimensions.find((d) => d.key === 'followUp')!.status, 'STRONG');
  });

  it('4 · attendance compliance bands (canonical engine output): 96 STRONG / 90 STABLE / 80 NEEDS_ATTENTION', () => {
    const mk = (compliance: number) => {
      const cur = emptyDataset('e1', '2026-08');
      cur.attendance = {
        status: 'AVAILABLE', source: 'attendanceResults',
        result: {
          month: '2026-08', workDays: 26, presentDays: 24, lateDays: 1, absentDays: 1,
          exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 30, lateDeductionDays: 0,
          absenceDeductionDays: 0, attendanceDeductionDays: 0, compliance,
          engineVersion: 'v1', generatedAt: '2026-09-01T00:00:00.000Z',
        },
      };
      return buildHubAnalysis({ current: cur, previous: null, risk: { current: null, previous: null }, hr: null })
        .dimensions.find((d) => d.key === 'attendance')!.status;
    };
    assert.equal(mk(96), 'STRONG');
    assert.equal(mk(90), 'STABLE');
    assert.equal(mk(80), 'NEEDS_ATTENTION');
  });

  it('5 · business output: 1 more closure than previous IMPROVING, 1 fewer DECLINING', () => {
    const mk = (current: number, previous: number | null) => {
      const cur = emptyDataset('e1', '2026-08');
      cur.deals = {
        ...cur.deals,
        closedWithEmployeeTotal: current,
        closedWithEmployeeInPeriod: current,
        closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 0, completed: current, canceled: 0 },
        statusAllTime: { upcoming: 0, in_progress: 0, completed: current, canceled: 0 },
      };
      let prev: EmployeePerformanceDataset | null = null;
      if (previous !== null) {
        prev = emptyDataset('e1', '2026-07');
        prev.deals = {
          ...prev.deals,
          closedWithEmployeeTotal: previous,
          closedWithEmployeeInPeriod: previous,
          closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 0, completed: previous, canceled: 0 },
          statusAllTime: { upcoming: 0, in_progress: 0, completed: previous, canceled: 0 },
        };
      }
      return buildHubAnalysis({ current: cur, previous: prev, risk: { current: null, previous: null }, hr: null })
        .dimensions.find((d) => d.key === 'businessOutput')!;
    };
    assert.equal(mk(3, 2).status, 'IMPROVING');
    assert.equal(mk(1, 2).status, 'DECLINING');
    assert.equal(mk(2, 2).status, 'STABLE');
  });
});

describe('overview escalation (§8)', () => {
  it('7a · critical risk escalates to MANAGEMENT_REVIEW', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.attendance = {
      status: 'AVAILABLE', source: 'attendanceResults',
      result: {
        month: '2026-08', workDays: 26, presentDays: 20, lateDays: 2, absentDays: 4,
        exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 60, lateDeductionDays: 1,
        absenceDeductionDays: 2, attendanceDeductionDays: 3, compliance: 84,
        engineVersion: 'v1', generatedAt: '2026-09-01T00:00:00.000Z',
      },
    };
    const risk: RiskResult = { ...ZERO_RISK, score: 60, level: 'critical' };
    const analysis = buildHubAnalysis({ current: cur, previous: null, risk: { current: risk, previous: null }, hr: null });
    assert.equal(analysis.overview.status, 'MANAGEMENT_REVIEW');
  });

  it('7b · two declining dimensions escalate to PERFORMANCE_IMPROVEMENT_REVIEW', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.kpi.quality = {
      componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 70, weight: 15,
      weightedContribution: 10.5, maxContribution: 15, observationCount: 5, deductionPoints: 30, bonusPoints: 0,
    };
    cur.kpi.rowStatus = 'AVAILABLE';
    cur.attendance = {
      status: 'AVAILABLE', source: 'attendanceResults',
      result: {
        month: '2026-08', workDays: 26, presentDays: 22, lateDays: 2, absentDays: 2,
        exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 40, lateDeductionDays: 0,
        absenceDeductionDays: 1, attendanceDeductionDays: 1, compliance: 88,
        engineVersion: 'v1', generatedAt: '2026-09-01T00:00:00.000Z',
      },
    };
    const prev = emptyDataset('e1', '2026-07');
    prev.kpi.quality = {
      componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 85, weight: 15,
      weightedContribution: 12.75, maxContribution: 15, observationCount: 2, deductionPoints: 15, bonusPoints: 0,
    };
    prev.kpi.rowStatus = 'FINALIZED';
    prev.attendance = {
      status: 'AVAILABLE', source: 'attendanceResults',
      result: {
        month: '2026-07', workDays: 27, presentDays: 26, lateDays: 0, absentDays: 1,
        exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 0, lateDeductionDays: 0,
        absenceDeductionDays: 0, attendanceDeductionDays: 0, compliance: 96,
        engineVersion: 'v1', generatedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    const analysis = buildHubAnalysis({ current: cur, previous: prev, risk: { current: ZERO_RISK, previous: null }, hr: null });
    assert.equal(analysis.overview.status, 'PERFORMANCE_IMPROVEMENT_REVIEW');
  });
});

describe('changes (§17 — why performance changed)', () => {
  it('8a · a metric absent on BOTH sides is not a change', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.equal(analysis.changes.length, 0);
    assert.equal(analysis.overview.mainChange, null);
  });

  it('8b · quality drop produces a DOWN change and becomes the main change', () => {
    const current = emptyDataset('e1', '2026-08');
    current.kpi.quality = {
      componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 74, weight: 15,
      weightedContribution: 11.1, maxContribution: 15, observationCount: 6, deductionPoints: 26, bonusPoints: 0,
    };
    current.kpi.rowStatus = 'AVAILABLE';
    const previous = emptyDataset('e1', '2026-07');
    previous.kpi.quality = {
      componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 86, weight: 15,
      weightedContribution: 12.9, maxContribution: 15, observationCount: 1, deductionPoints: 14, bonusPoints: 0,
    };
    previous.kpi.rowStatus = 'FINALIZED';
    const analysis = buildHubAnalysis({ current, previous, risk: { current: null, previous: null }, hr: null });
    const qualityChange = analysis.changes.find((c) => c.key === 'qualityPercent')!;
    assert.equal(qualityChange.direction, 'DOWN');
    assert.equal(qualityChange.delta, -12);
    assert.equal(analysis.overview.mainChange?.key, 'qualityPercent');
    // Evidence traceability: sources point at the observations page.
    assert.equal(qualityChange.sources[0].page, 'observations');
  });
});

describe('patterns (§15 — deterministic labels)', () => {
  it('9 · REPEATED across months / PERSISTENT / EMERGING / IMPROVING / ISOLATED', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.quality.repeatedIssues.byCategory.push(
      { issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 3, firstOccurrence: '03/08/2026', lastOccurrence: '18/08/2026', observationIds: ['o1'] },
      { issueKey: 'cat_offer', label: 'اكتمال العرض', occurrenceCount: 2, firstOccurrence: '04/08/2026', lastOccurrence: '19/08/2026', observationIds: ['o2'] },
      { issueKey: 'cat_docs', label: 'أخطاء مستندات', occurrenceCount: 1, firstOccurrence: '10/08/2026', lastOccurrence: '10/08/2026', observationIds: ['o3'] },
    );
    cur.quality.repeatedIssues.windowByCategory.push(
      { issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 5, monthsPresent: 2, firstMonth: '2026-07', lastMonth: '2026-08', observationIds: ['o1'] },
    );
    const prev = emptyDataset('e1', '2026-07');
    prev.quality.repeatedIssues.byCategory.push(
      { issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 2, firstOccurrence: '05/07/2026', lastOccurrence: '20/07/2026', observationIds: ['p1'] },
      { issueKey: 'cat_old', label: 'مشكلة قديمة', occurrenceCount: 2, firstOccurrence: '06/07/2026', lastOccurrence: '21/07/2026', observationIds: ['p2'] },
    );

    const analysis = buildHubAnalysis({ current: cur, previous: prev, risk: { current: null, previous: null }, hr: null });
    const kinds = (kind: string) => analysis.patterns.filter((p) => p.kind === kind);

    assert.ok(kinds('REPEATED').some((p) => p.label === 'تأخر المتابعة'));
    assert.ok(kinds('PERSISTENT').some((p) => p.label === 'تأخر المتابعة'));
    assert.ok(kinds('EMERGING').some((p) => p.label === 'اكتمال العرض'));
    assert.ok(kinds('IMPROVING').some((p) => p.label === 'مشكلة قديمة'));
    assert.ok(kinds('ISOLATED').some((p) => p.label === 'أخطاء مستندات'));
    // The isolated label points at its own observation record.
    const isolated = kinds('ISOLATED').find((p) => p.label === 'أخطاء مستندات')!;
    assert.deepEqual(isolated.sources[0].recordIds, ['o3']);
  });
});

describe('strengths / areas / recommendations (§19-§21)', () => {
  it('10a · an empty employee earns NO strengths, NO areas, NO recommendations', () => {
    const current = emptyDataset('e1', '2026-08');
    const analysis = buildHubAnalysis({ current, previous: null, risk: { current: null, previous: null }, hr: null });
    assert.deepEqual(analysis.strengths, []);
    assert.deepEqual(analysis.developmentAreas, []);
    assert.deepEqual(analysis.recommendations, []);
  });

  it('10b · repeated issues → coaching recommendation citing the affected category', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.quality.repeatedIssues.byCategory.push({
      issueKey: 'cat_late', label: 'تأخر المتابعة', occurrenceCount: 3,
      firstOccurrence: '03/08/2026', lastOccurrence: '18/08/2026', observationIds: ['o1', 'o2', 'o3'],
    });
    const analysis = buildHubAnalysis({ current: cur, previous: null, risk: { current: null, previous: null }, hr: null });
    const coaching = analysis.recommendations.find((r) => r.key === 'rec.coaching');
    assert.ok(coaching, 'coaching recommended for repeated quality issues');
    assert.equal(coaching.rationale[0].labels?.[0], 'تأخر المتابعة');
  });

  it('10c · recommendation count is capped at 5', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.kpi.quality = {
      componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 55, weight: 15,
      weightedContribution: 8.25, maxContribution: 15, observationCount: 8, deductionPoints: 45, bonusPoints: 0,
    };
    cur.kpi.rowStatus = 'AVAILABLE';
    cur.quality.repeatedIssues.byCategory.push(
      { issueKey: 'cat_a', label: 'أ', occurrenceCount: 3, firstOccurrence: '03/08/2026', lastOccurrence: '18/08/2026', observationIds: ['o1'] },
      { issueKey: 'cat_b', label: 'ب', occurrenceCount: 3, firstOccurrence: '04/08/2026', lastOccurrence: '19/08/2026', observationIds: ['o2'] },
    );
    cur.followUps = { ...cur.followUps, total: 10, active: 6, overdue: 5, completed: 4, completionRate: 40 };
    cur.complaints = { ...cur.complaints, total: 2, stillOpen: 2, resolvedOrClosed: 0 };
    cur.capa = { ...cur.capa, total: 2, active: 2, overdue: 2, closedCount: 0 };
    cur.attendance = {
      status: 'AVAILABLE', source: 'attendanceResults',
      result: {
        month: '2026-08', workDays: 26, presentDays: 20, lateDays: 3, absentDays: 3,
        exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 90, lateDeductionDays: 1,
        absenceDeductionDays: 2, attendanceDeductionDays: 3, compliance: 80,
        engineVersion: 'v1', generatedAt: '2026-09-01T00:00:00.000Z',
      },
    };
    const analysis = buildHubAnalysis({ current: cur, previous: null, risk: { current: { ...ZERO_RISK, score: 55, level: 'critical' }, previous: null }, hr: { current: HR_MONTH, previous: null } });
    assert.ok(analysis.recommendations.length <= 5, `got ${analysis.recommendations.length}`);
    assert.ok(analysis.recommendations.length >= 4);
  });

  it('11 · observations, quality deductions and HR deductions stay separate facts', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.quality.observations = {
      ...cur.quality.observations, total: 5, approved: 3, pending: 1, rejected: 1,
    };
    cur.quality.deductions = {
      count: 2, totalDays: 1.5, totalAmount: 200, byType: [], records: [],
    };
    const analysis = buildHubAnalysis({ current: cur, previous: null, risk: { current: null, previous: null }, hr: { current: HR_MONTH, previous: null } });
    const quality = analysis.dimensions.find((d) => d.key === 'quality')!;
    assert.equal(quality.details.quality?.observationsTotal, 5);
    assert.equal(quality.details.quality?.qualityDeductions, 2);
    const hr = analysis.dimensions.find((d) => d.key === 'hr')!;
    assert.equal(hr.details.hr?.deductionCount, 1);
    // The HR count never leaks into the quality dimension facts.
    assert.notEqual(quality.details.quality?.qualityDeductions, hr.details.hr?.deductionCount);
  });

  it('12 · cross-signals use association rules only (never causal keys)', () => {
    const cur = emptyDataset('e1', '2026-08');
    cur.followUps = { ...cur.followUps, total: 10, active: 6, overdue: 4, completed: 4, completionRate: 40 };
    cur.quality.observations = { ...cur.quality.observations, total: 6, approved: 4, pending: 1, rejected: 1 };
    const prev = emptyDataset('e1', '2026-07');
    prev.followUps = { ...prev.followUps, total: 10, active: 2, overdue: 0, completed: 8, completionRate: 80 };
    prev.quality.observations = { ...prev.quality.observations, total: 1, approved: 1, pending: 0, rejected: 0 };
    const analysis = buildHubAnalysis({ current: cur, previous: prev, risk: { current: null, previous: null }, hr: null });
    const overlap = analysis.crossSignals.find((s) => s.key === 'overlap.followUpDelaysQuality');
    assert.ok(overlap, 'overdue follow-ups ↑ alongside observations ↑ is reported as an overlap');
    for (const signal of analysis.crossSignals) {
      assert.match(signal.key, /^overlap\./, 'every cross-signal is an association rule');
    }
  });
});
