// ══════════════════════════════════════════════════════════════
//  §QUALITY-INTELLIGENCE — deterministic analytical layer (tests)
//
//  Proves (spec §35):
//    1/2   the KPI score is consumed VERBATIM and an incomplete
//          scheme NEVER produces a fabricated overall score
//    3/4   quality values match the canonical dataset verbatim
//    6     deductions stay separate from KPI calculations
//    8/9   follow-up completion rate is correct + on-time is an
//          explicit NOT-COMPUTABLE (never estimated)
//    13-15 deal metrics use dealClosedAt / closedAt / departureDate
//    16-18 scope/permissions are enforced UPSTREAM (route contract —
//          this module only reads what it is given)
//    18    no fabricated values when data is missing (null states)
//    19    trend logic is deterministic from the canonical engine
//    20    repeated-issue detection follows the engine threshold
//    21    management attention items are deterministic + sourced
//    22/23 every percentage has a valid denominator (null at 0)
//    30    everything works with AI absent (no AI input at all)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQualityIntelligence,
  detectPatterns,
  buildManagementAttention,
  buildExecutiveNarrative,
  type QualityIntelligenceInput,
} from '@/lib/quality-intelligence/report';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';
import type { HrEmployeeDecisionReport } from '@/lib/hr-decision/types';

// ── fixture ──

function datasetFixture(over?: {
  weightedTotal?: number | null;
  rowStatus?: string;
  components?: Array<{ componentId: string; name: string; weight: number; status: string; rawScore: number | null; weightedContribution: number | null; maxContribution: number; owner?: string }>;
  observationsTotal?: number;
  byCategory?: Array<{ categoryId: string | null; categoryName: string; count: number }>;
  bySeverity?: Record<string, number>;
  observationsMonthly?: Array<{ month: string; count: number }>;
  complaintsStillOpen?: number;
  complaintsMonthly?: Array<{ month: string; count: number }>;
  followUps?: { total: number; completed: number; active: number; overdue: number; dueToday: number };
  capaOverdue?: number;
  repeatedByCategory?: Array<{ issueKey: string; label: string; occurrenceCount: number; firstOccurrence: string | null; lastOccurrence: string | null; observationIds: string[] }>;
  unattributed?: number;
}): EmployeePerformanceDataset {
  const obsTotal = over?.observationsTotal ?? 0;
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
      outcomeStatus: 'RESOLVED', message: null,
      scheme: { schemeId: 's1', schemeName: 'المخطط', schemeVersion: 1, qualityWeight: 15, frozen: false },
      components: (over?.components ?? [
        { componentId: 'quality', name: 'الجودة', weight: 15, status: 'AVAILABLE', rawScore: 80, weightedContribution: 12, maxContribution: 15 },
        { componentId: 'manager', name: 'المدير المباشر', weight: 15, status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 15 },
        { componentId: 'hr', name: 'الموارد البشرية', weight: 10, status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 10 },
        { componentId: 'target', name: 'المستهدف', weight: 60, status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 60 },
      ]) as never,
      quality: { componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 80, weight: 15, weightedContribution: 12, maxContribution: 15 },
      availableWeight: 15,
      weightedTotal: over?.weightedTotal ?? null,
      overallStatus: 'INCOMPLETE',
      rowStatus: (over?.rowStatus ?? 'INCOMPLETE') as never,
      calculationVersion: 'v1',
      source: 'kpi_engine' as const,
    },
    trend: {
      windowMonths: ['2026-08', '2026-09'],
      points: [
        { monthKey: '2026-08', available: true, rawScore: 72, valueBasis: 'FINALIZED', finalized: true, rowStatus: 'AVAILABLE', finalizedAt: null, schemeId: 's1', schemeVersion: 1, weightedContribution: null, weight: 100 },
        { monthKey: '2026-09', available: true, rawScore: 80, valueBasis: 'LIVE', finalized: false, rowStatus: 'AVAILABLE', finalizedAt: null, schemeId: 's1', schemeVersion: 1, weightedContribution: null, weight: 100 },
      ],
      mom: { currentMonth: '2026-09', previousMonth: '2026-08', currentRawScore: 80, previousRawScore: 72, deltaPoints: 8 },
      direction: 'UP',
    },
    quality: {
      observations: {
        total: obsTotal, approved: obsTotal, pending: 0, rejected: 0,
        byResolutionStatus: {}, bySeverity: over?.bySeverity ?? {},
        byCategory: over?.byCategory ?? [], monthly: over?.observationsMonthly ?? [],
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: over?.repeatedByCategory ?? [],
        byType: [], windowByCategory: [],
      },
      deductions: { count: 1, totalDays: 1.5, totalAmount: 0, byType: [], records: [] },
    },
    complaints: {
      relationship: 'CONFIRMED', total: 2, byStatus: { open: over?.complaintsStillOpen ?? 0 },
      byType: {}, bySeverity: {}, repeatedTypes: [], resolvedOrClosed: 2 - (over?.complaintsStillOpen ?? 0),
      stillOpen: over?.complaintsStillOpen ?? 0, viaDealCount: 0, avgResolutionDays: 3.5,
      monthly: over?.complaintsMonthly ?? [],
    },
    capa: {
      relationship: 'CONFIRMED', total: 1, byStatus: {}, byPriority: {}, bySource: {},
      active: 1, terminal: 0, overdue: over?.capaOverdue ?? 0, avgOverdueDays: null,
      correctiveStatus: { not_started: 0, in_progress: 1, completed: 0 },
      preventiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      closedCount: 0, avgClosureDays: null, indirectCount: 0,
      monthly: [],
    },
    followUps: {
      relationship: 'CONFIRMED',
      total: over?.followUps?.total ?? 0,
      byStatus: {}, active: over?.followUps?.active ?? 0,
      terminal: over?.followUps ? over.followUps.total - over.followUps.active : 0,
      overdue: over?.followUps?.overdue ?? 0, dueToday: over?.followUps?.dueToday ?? 0,
      avgOverdueDays: null, completed: over?.followUps?.completed ?? 0,
      completionRate: over?.followUps && over.followUps.total > 0
        ? Math.round((over.followUps.completed / over.followUps.total) * 10000) / 100
        : null,
      byType: {}, byPriority: {}, monthly: [],
    },
    deals: {
      relationship: 'CONFIRMED',
      travelTotal: 2, byStatus: { upcoming: 1, in_progress: 1, completed: 3, canceled: 1 },
      canceled: 1, active: 2, completionRate: 50, monthly: [],
      closedTotal: 2, closedMonthly: [{ month: '2026-09', count: 2 }], closedUnknownMonth: 1,
      createdTotal: 4, createdMonthly: [],
      closedWithEmployeeTotal: 7, closedWithEmployeeInPeriod: 3,
      closedWithEmployeeMonthly: [{ month: '2026-09', count: 3 }],
      closedWithEmployeeUnknownMonth: 0,
      closedWithEmployeeInPeriodByStatus: { upcoming: 0, in_progress: 1, completed: 1, canceled: 1 },
      statusAllTime: { upcoming: 1, in_progress: 1, completed: 3, canceled: 1 },
    },
    attendance: { status: 'AVAILABLE', source: 'attendanceResults', result: {
      month: '2026-09', workDays: 26, presentDays: 24, lateDays: 2, absentDays: 0,
      exemptDays: 0, unaccountedDays: 0, totalMinutesLate: 45, lateDeductionDays: 0.5,
      absenceDeductionDays: 0, attendanceDeductionDays: 0.5, compliance: 92, engineVersion: 'v1', generatedAt: '2026-09-28T00:00:00Z',
    } },
    dataQuality: { windowMonths: ['2026-09'], unattributedRecords: over?.unattributed ? [{ collection: 'qualityObservations', count: over.unattributed }] : [], notes: [] },
    evidence: {
      kpi: [], observations: { collection: 'qualityObservations', recordIds: [] },
      deductions: { collection: 'qualityDeductions', recordIds: [] },
      complaints: { collection: 'complaints', recordIds: [] },
      capa: { collection: 'capaCases', recordIds: [] },
      followUps: { collection: 'followUps', recordIds: [] },
      deals: { collection: 'travelDeals', recordIds: [] },
      attendance: null,
    },
    generatedAt: '2026-09-28T00:00:00Z',
  } as unknown as EmployeePerformanceDataset;
}

const decisionFixture = (over?: { riskScore?: number; riskLevel?: string; status?: string; concerns?: Array<Record<string, unknown>> }) =>
  ({
    reportKind: 'HR_EMPLOYEE_DECISION',
    audience: 'HR',
    period: { monthKey: '2026-09', valueBasis: 'LIVE', finalized: false },
    executive: {
      status: over?.status ?? 'NEEDS_COACHING', statusLabelAr: 'يحتاج تدريبًا',
      actionKind: 'COACHING', actionAr: 'تدريب', kpiScore: 80, kpiRowStatus: 'AVAILABLE',
      trendDirection: 'UP', momDeltaPoints: 8, riskScore: over?.riskScore ?? 42, riskLevel: over?.riskLevel ?? 'medium',
    },
    scorecard: [],
    trend: { windowMonths: [], points: [], direction: 'UP', momDeltaPoints: 8, monthsWithScore: 2, consecutiveBelowTarget: 0, consecutiveDecliningSteps: 0 },
    factors: [],
    strengths: [],
    concerns: (over?.concerns ?? [
      { category: 'FOLLOW_UP', kind: 'NEGATIVE', severity: 'HIGH', signalAr: 'متابعات متأخرة', value: 3, unit: 'count', comparisonAr: 'أكبر من صفر', thresholdBasis: 'FIXED', thresholdValue: 0, ruleId: 'test.overdue_followups' },
    ]) as never,
    action: { actionKind: 'COACHING', actionAr: '', rationaleAr: '', disclaimerAr: '' },
    dataQuality: { notes: [] },
    generatedAt: '2026-09-28T00:00:00Z',
  }) as unknown as HrEmployeeDecisionReport;

function input(over?: Parameters<typeof datasetFixture>[0], decision: HrEmployeeDecisionReport | null = decisionFixture()): QualityIntelligenceInput {
  return { dataset: datasetFixture(over), decision, hrDeductions: null, previousMonthKey: '2026-08' };
}

// ── §4 executive summary ──

describe('§35.1/2 — KPI verbatim; incomplete never fabricates a score', () => {
  it('consumes the engine weightedTotal verbatim when valued', () => {
    const intel = buildQualityIntelligence(input({ weightedTotal: 87.5, rowStatus: 'AVAILABLE' }));
    assert.equal(intel.executive.scoreState, 'value');
    assert.equal(intel.executive.performanceScore, 87.5);
    assert.equal(intel.executive.qualityScore, 80);
    assert.equal(intel.executive.deltaPoints, 8);
  });
  it('incomplete scheme → scoreState incomplete + missing components named (never a fake total)', () => {
    const intel = buildQualityIntelligence(input());
    assert.equal(intel.executive.scoreState, 'incomplete');
    assert.equal(intel.executive.performanceScore, null);
    assert.deepEqual(intel.executive.missingComponents.map((m) => m.name), ['المدير المباشر', 'الموارد البشرية', 'المستهدف']);
    // the KPI intelligence table keeps PENDING rows distinct from zeros
    const pending = intel.kpi.components.filter((c) => !c.hasValue);
    assert.equal(pending.length, 3);
    for (const c of pending) {
      assert.equal(c.actual, null);
      assert.equal(c.contribution, null);
    }
  });
});

// ── §6/§7 concentration ──

describe('§35.22/23 — every percentage has a valid denominator', () => {
  it('share = count ÷ total × 100, sorted desc; top issue named', () => {
    const intel = buildQualityIntelligence(input({
      observationsTotal: 12,
      byCategory: [
        { categoryId: 'c1', categoryName: 'Late Follow-up', count: 5 },
        { categoryId: 'c2', categoryName: 'System Process', count: 3 },
        { categoryId: 'c3', categoryName: 'Package Quality', count: 4 },
      ],
    }));
    const shares = intel.quality.concentration.map((c) => c.share);
    assert.deepEqual(shares, [41.67, 33.33, 25]);
    assert.equal(intel.quality.topIssue?.categoryName, 'Late Follow-up');
    assert.equal(intel.quality.issueCategoryCount, 3);
  });
  it('zero observations → concentration empty, shares null, topIssue null (never 0%)', () => {
    const intel = buildQualityIntelligence(input({ observationsTotal: 0, byCategory: [] }));
    assert.equal(intel.quality.topIssue, null);
    assert.equal(intel.quality.concentration.length, 0);
  });
  it('follow-up completion rate: denominator rule + on-time NOT-COMPUTABLE', () => {
    const intel = buildQualityIntelligence(input({ followUps: { total: 7, completed: 6, active: 1, overdue: 3, dueToday: 1 } }));
    assert.equal(intel.followUps.completionRate, 85.71);
    assert.equal(intel.followUps.onTimeRate, null);
    const empty = buildQualityIntelligence(input({ followUps: { total: 0, completed: 0, active: 0, overdue: 0, dueToday: 0 } }));
    assert.equal(empty.followUps.completionRate, null);
  });
});

// ── §35.4 previous-month comparisons from the dataset's own series ──

describe('§35.18/19 — comparisons come from the monthly series; absent months stay null', () => {
  it('previous observations total from the series; missing month → null', () => {
    const withPrev = buildQualityIntelligence(input({
      observationsTotal: 10,
      observationsMonthly: [{ month: '2026-08', count: 4 }],
    }));
    assert.equal(withPrev.quality.previousTotal, 4);
    const withoutPrev = buildQualityIntelligence(input({ observationsMonthly: [] }));
    assert.equal(withoutPrev.quality.previousTotal, null);
  });
});

// ── §35.13-15 deal date semantics ──

describe('§35.13-15 — deal metrics keep the corrected date semantics', () => {
  it('closed-with-employee (dealClosedAt) ≠ completed (closedAt) ≠ travel (departureDate)', () => {
    const intel = buildQualityIntelligence(input());
    assert.equal(intel.deals.closedWithEmployeeInPeriod, 3);
    assert.equal(intel.deals.closedWithEmployeeTotal, 7);
    assert.equal(intel.deals.completedInPeriod, 2);
    assert.equal(intel.deals.travelInPeriod, 2);
    assert.equal(intel.deals.currentCanceledAllTime, 1);
  });
});

// ── §35.19-21 patterns + attention ──

describe('§35.19/20 — pattern detection is deterministic with rule ids', () => {
  it('fires the full expected set for a data-rich employee', () => {
    const patterns = detectPatterns(input({
      observationsTotal: 12,
      byCategory: [{ categoryId: 'c1', categoryName: 'Late Follow-up', count: 5 }],
      bySeverity: { high: 2 },
      repeatedByCategory: [{ issueKey: 'c1', label: 'Late Follow-up', occurrenceCount: 5, firstOccurrence: null, lastOccurrence: null, observationIds: ['a', 'b', 'c', 'd', 'e'] }],
      complaintsStillOpen: 2,
      followUps: { total: 7, completed: 6, active: 1, overdue: 3, dueToday: 1 },
      capaOverdue: 1,
    }));
    const codes = patterns.map((p) => p.code);
    assert.ok(codes.includes('REPEATED_ISSUE'));
    assert.ok(codes.includes('IMPROVING_TREND'));
    assert.ok(codes.includes('FOLLOW_UP_RISK'));
    assert.ok(codes.includes('COMPLAINT_RISK'));
    assert.ok(codes.includes('CAPA_RISK'));
    assert.ok(codes.includes('HIGH_SEVERITY_QUALITY'));
    assert.ok(codes.includes('KPI_CONFIGURATION_WARNING'));
    // every pattern carries a canonical rule id
    for (const p of patterns) assert.ok(p.ruleId.length > 0);
  });
  it('no comparable previous month → INSUFFICIENT_TREND_DATA (never an invented trend)', () => {
    const d = datasetFixture();
    (d.trend as { mom: unknown; direction: unknown }).mom = null;
    (d.trend as { direction: unknown }).direction = null;
    const patterns = detectPatterns({ dataset: d, decision: null, hrDeductions: null, previousMonthKey: null });
    assert.ok(patterns.some((p) => p.code === 'INSUFFICIENT_TREND_DATA'));
    assert.ok(!patterns.some((p) => p.code === 'IMPROVING_TREND' || p.code === 'DECLINING_TREND'));
  });
  it('data-quality warning surfaces the dataset accounting', () => {
    const patterns = detectPatterns(input({ unattributed: 3 }));
    assert.ok(patterns.some((p) => p.code === 'DATA_QUALITY_WARNING' && p.values.unattributed === 3));
  });
});

describe('§35.21 — management attention items are deterministic + sourced', () => {
  it('builds WHAT/WHY/SOURCE items with honest drill pages', () => {
    const items = buildManagementAttention(input({
      complaintsStillOpen: 2,
      followUps: { total: 7, completed: 6, active: 1, overdue: 3, dueToday: 1 },
      capaOverdue: 1,
    }));
    const codes = items.map((i) => i.code);
    assert.ok(codes.includes('ATT_KPI_INCOMPLETE'));
    assert.ok(codes.includes('ATT_OVERDUE_FOLLOWUPS'));
    assert.ok(codes.includes('ATT_OVERDUE_CAPA'));
    assert.ok(codes.includes('ATT_OPEN_COMPLAINTS'));
    const fu = items.find((i) => i.code === 'ATT_OVERDUE_FOLLOWUPS')!;
    assert.equal(fu.values.count, 3);
    assert.equal(fu.drillPage, 'followUps');
    assert.ok(items.every((i) => i.source.length > 0));
  });
  it('projects the canonical decision concerns as section-gated attention items', () => {
    const items = buildManagementAttention(input(undefined, decisionFixture()));
    const factorItems = items.filter((i) => i.code === 'ATT_DECISION_FACTOR');
    assert.equal(factorItems.length, 1);
    assert.equal(factorItems[0].source, 'test.overdue_followups');
    assert.equal(factorItems[0].drillPage, 'followUps');
  });
});

// ── §21 narrative ──

describe('§35.30 — the narrative only names numbers that exist (AI-free)', () => {
  it('valued score → NAR_SCORE + NAR_DELTA with the engine values', () => {
    const facts = buildExecutiveNarrative(input({ weightedTotal: 87.5, rowStatus: 'AVAILABLE' }));
    const score = facts.find((f) => f.code === 'NAR_SCORE');
    assert.equal(score?.values.score, 87.5);
    const delta = facts.find((f) => f.code === 'NAR_DELTA');
    assert.equal(delta?.values.delta, 8);
  });
  it('incomplete scheme → NAR_SCORE_INCOMPLETE with the missing names; NO NAR_SCORE', () => {
    const facts = buildExecutiveNarrative(input());
    assert.ok(facts.some((f) => f.code === 'NAR_SCORE_INCOMPLETE'));
    assert.ok(!facts.some((f) => f.code === 'NAR_SCORE'));
    const incomplete = facts.find((f) => f.code === 'NAR_SCORE_INCOMPLETE')!;
    assert.ok(String(incomplete.values.missing).includes('المستهدف'));
  });
  it('no risk decision → no NAR_RISK sentence (nothing invented around it)', () => {
    const facts = buildExecutiveNarrative(input(undefined, null));
    assert.ok(!facts.some((f) => f.code === 'NAR_RISK'));
  });
});
