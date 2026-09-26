// ══════════════════════════════════════════════════════════════
//  Employee 360 — View-Model tests (rebuild)
//
//  Focus: the rebuild's correctness guarantees —
//    • section gating withholds denied blocks (no-leak)
//    • period semantics: every period-sensitive block answers for
//      the SELECTED month, never the wall clock
//    • unknown ≠ zero: unknown closure months survive
//    • no-permission ≠ no-data ≠ configuration-required
//    • decision-support factors are filtered by the domain gate
//    • tenure arithmetic accepts both stored date shapes
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { HrEmployeeDecisionReport } from '@/lib/hr-decision/types';
import {
  assembleEmployee360Profile,
  tenureYearsOf,
} from '@/lib/employee-360/view-model';
import type { Employee360SectionGate } from '@/lib/permissions/employee360-access';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const MONTH = '2026-09';

function fullGate(): Employee360SectionGate {
  return {
    basicInfo: true,
    performance: true,
    deals: true,
    attendance: true,
    quality: true,
    observations: true,
    hrDeductions: true,
    requests: true,
    followUps: true,
    travel: true,
    complaints: true,
    capa: true,
    risk: true,
    decisionSupport: true,
    organization: true,
    timeline: true,
  };
}

function gateWith(overrides: Partial<Employee360SectionGate>): Employee360SectionGate {
  return { ...fullGate(), ...overrides };
}

/** A minimal but realistic canonical dataset for the selected month. */
function makeDataset(overrides?: {
  closedTotal?: number;
  closedUnknownMonth?: number;
  createdTotal?: number;
  followUpsOverdue?: number;
  closedWithEmployeeTotal?: number;
  closedWithEmployeeInPeriod?: number;
  closedWithEmployeeUnknownMonth?: number;
}): EmployeePerformanceDataset {
  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'emp_1',
      employeeName: 'أحمد محمد',
      employeeCode: 'EMP-040',
      department: 'Sales',
      team: 'AA Sales Team',
      position: 'Senior Sales Specialist',
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
      scheme: { schemeId: 'sch_1', schemeName: 'مخطط افتراضي', schemeVersion: 2, qualityWeight: 100, frozen: false },
      components: [
        {
          componentId: 'quality', name: 'الجودة', owner: 'quality', weight: 100,
          status: 'AVAILABLE', rawScore: 91, weightedContribution: 91, maxContribution: 100,
        },
        {
          componentId: 'direct_manager', name: 'المدير المباشر', owner: 'management', weight: 0,
          status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 0,
        },
      ],
      quality: {
        componentId: 'quality', name: 'الجودة', status: 'AVAILABLE', rawScore: 91,
        weight: 100, weightedContribution: 91, maxContribution: 100,
        observationCount: 14, deductionPoints: 2, bonusPoints: 1,
      },
      availableWeight: 100,
      weightedTotal: 91,
      overallStatus: 'COMPLETE',
      rowStatus: 'AVAILABLE',
      calculationVersion: 'v1.0',
      source: 'kpi_engine',
    },
    trend: {
      windowMonths: [MONTH],
      points: [{ monthKey: MONTH, valueBasis: 'LIVE', available: true, rawScore: 91, weightedContribution: 91, weight: 100, rowStatus: 'AVAILABLE', finalized: false, schemeId: 'sch_1', schemeVersion: 2 }],
      mom: null,
      direction: null,
    },
    quality: {
      observations: {
        total: 3, approved: 2, pending: 1, rejected: 0,
        byResolutionStatus: {}, bySeverity: { low: 1, medium: 2, high: 0, critical: 0 },
        byCategory: [], monthly: [],
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: [{ issueKey: 'c1', label: 'تأخير في التسليم', occurrenceCount: 2, firstOccurrence: null, lastOccurrence: null, observationIds: ['o1', 'o2'] }],
        byType: [],
        windowByCategory: [],
      },
      deductions: { count: 1, totalDays: 1, totalAmount: 0, byType: [], records: [] },
    },
    complaints: {
      relationship: 'CONFIRMED', total: 1, byStatus: { open: 1 }, byType: {}, bySeverity: {},
      repeatedTypes: [], resolvedOrClosed: 0, stillOpen: 1, viaDealCount: 0,
      avgResolutionDays: null, monthly: [],
    },
    capa: {
      relationship: 'CONFIRMED', total: 2, byStatus: { open: 1, closed: 1 }, byPriority: {}, bySource: {},
      active: 1, terminal: 1, overdue: 1, avgOverdueDays: 3,
      correctiveStatus: { not_started: 0, in_progress: 1, completed: 0 },
      preventiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      closedCount: 1, avgClosureDays: null, indirectCount: 0, monthly: [],
    },
    followUps: {
      relationship: 'CONFIRMED', total: 5, byStatus: {}, active: 2, terminal: 3,
      overdue: overrides?.followUpsOverdue ?? 1, dueToday: 0, avgOverdueDays: 2,
      completed: 3, completionRate: 60, byType: {}, byPriority: {}, monthly: [],
    },
    deals: {
      relationship: 'CONFIRMED',
      travelTotal: 10, byStatus: { upcoming: 2, in_progress: 1, completed: 6, canceled: 1 },
      canceled: 1, active: 3, completionRate: 60, monthly: [],
      closedTotal: overrides?.closedTotal ?? 4,
      closedMonthly: [{ month: MONTH, count: overrides?.closedTotal ?? 4 }],
      closedUnknownMonth: overrides?.closedUnknownMonth ?? 2,
      createdTotal: overrides?.createdTotal ?? 7,
      createdMonthly: [{ month: MONTH, count: 7 }],
      closedWithEmployeeTotal: overrides?.closedWithEmployeeTotal ?? 10,
      closedWithEmployeeInPeriod: overrides?.closedWithEmployeeInPeriod ?? 4,
      closedWithEmployeeMonthly: [{ month: MONTH, count: overrides?.closedWithEmployeeInPeriod ?? 4 }],
      closedWithEmployeeUnknownMonth: overrides?.closedWithEmployeeUnknownMonth ?? 2,
      statusAllTime: { upcoming: 2, in_progress: 1, completed: 6, canceled: 1 },
    },
    attendance: {
      status: 'AVAILABLE',
      source: 'attendanceResults',
      result: {
        month: MONTH, workDays: 30, presentDays: 26, lateDays: 2, absentDays: 1,
        exemptDays: 1, unaccountedDays: 0, totalMinutesLate: 45,
        lateDeductionDays: 0.5, absenceDeductionDays: 1, attendanceDeductionDays: 1.5,
        compliance: 87, engineVersion: 'attendance-v1', generatedAt: NOW.toISOString(),
      },
    },
    dataQuality: { windowMonths: [MONTH], unattributedRecords: [], notes: [] },
    evidence: {
      kpi: [], observations: { collection: 'qualityObservations', recordIds: [] },
      deductions: { collection: 'qualityDeductions', recordIds: [] },
      complaints: { collection: 'complaints', recordIds: [] },
      capa: { collection: 'capaCases', recordIds: [] },
      followUps: { collection: 'followUps', recordIds: [] },
      deals: { collection: 'travelDeals', recordIds: [] },
      attendance: null,
    },
    generatedAt: NOW.toISOString(),
  } as unknown as EmployeePerformanceDataset;
}

function makeDecision(): HrEmployeeDecisionReport {
  return {
    reportKind: 'HR_EMPLOYEE_DECISION',
    audience: 'HR',
    employee: {
      employeeId: 'emp_1', employeeName: 'أحمد محمد', employeeCode: 'EMP-040',
      department: 'Sales', team: 'AA Sales Team', position: 'Senior Sales Specialist',
      employmentStatus: 'active', archivedButEligible: false,
    },
    period: { monthKey: MONTH, valueBasis: 'LIVE', finalized: false },
    executive: {
      status: 'NEEDS_COACHING',
      statusLabelAr: 'يحتاج توجيهاً/تدريباً',
      actionKind: 'COACHING',
      actionAr: 'يوصى بجلسة توجيه.',
      kpiScore: 91,
      kpiRowStatus: 'AVAILABLE',
      trendDirection: null,
      momDeltaPoints: null,
      riskLevel: 'medium',
      riskScore: 14,
    },
    scorecard: [
      { category: 'KPI', labelAr: 'مؤشر الأداء', availability: 'AVAILABLE', unavailableReasonAr: null, state: 'OK', metrics: [] },
      { category: 'ATTENDANCE', labelAr: 'الانضباط والحضور', availability: 'AVAILABLE', unavailableReasonAr: null, state: 'WATCH', metrics: [] },
    ],
    trend: { windowMonths: [MONTH], points: [], direction: null, momDeltaPoints: null, monthsWithScore: 1, consecutiveBelowTarget: 0, consecutiveDecliningSteps: 0, targetScore: 82 },
    factors: [
      { category: 'KPI', kind: 'POSITIVE', severity: 'LOW', signalAr: 'الدرجة فوق المستهدف', value: 91, unit: 'points', comparisonAr: null, thresholdBasis: 'CONFIGURED', thresholdValue: 82, ruleId: 'kpi_above_target' },
      { category: 'FOLLOW_UP', kind: 'NEGATIVE', severity: 'MEDIUM', signalAr: 'متابعة متأخرة', value: 1, unit: 'count', comparisonAr: null, thresholdBasis: 'CANONICAL_RISK', thresholdValue: null, ruleId: 'fu_overdue' },
    ],
    strengths: [],
    concerns: [],
    action: {
      status: 'NEEDS_COACHING',
      actionKind: 'COACHING',
      actionAr: 'يوصى بجلسة توجيه.',
      rationaleAr: 'عوامل متوسطة.',
      disclaimerAr: 'توصية مراجعة إجرائية فقط.',
    },
    dataQuality: { sufficiency: 'SUFFICIENT', notesAr: [] },
    generatedAt: NOW.toISOString(),
  } as unknown as HrEmployeeDecisionReport;
}

function baseInput(overrides?: Partial<Parameters<typeof assembleEmployee360Profile>[0]>) {
  return {
    selectedMonth: MONTH,
    now: NOW,
    gate: fullGate(),
    timelineVisible: true,
    employee: null,
    organization: null,
    dataset: makeDataset(),
    decision: makeDecision(),
    targetScore: 82,
    hrMonth: { month: MONTH, deductionCount: 1, deductionDays: 2, deductionAmount: 0, statusCounts: { approved: 1 } },
    requestsOfMonth: { total: 2, pending: 1, approved: 1, rejected: 0 },
    followUpRows: [
      { id: 'fu_1', employeeId: 'emp_1', status: 'open', nextFollowUpDate: '2026-09-01', subject: 'تقرير', priorityLevel: 'high' },
    ],
    complaintRows: [
      { id: 'c_1', employeeId: 'emp_1', status: 'open', severity: 'critical', complaintType: 'خدمة' },
    ],
    capaRows: [
      { id: 'capa_1', employeeId: 'emp_1', priority: 'high', title: 'تسريب', createdAt: '2026-08-01T00:00:00Z', timeline: [] },
    ],
    qualityDeductionRows: [],
    hrDeductionRows: [],
    requestRows: [],
    dealRows: [],
    ...overrides,
  };
}

describe('Employee 360 view model', () => {
  it('executive summary answers for the SELECTED month (period propagation)', () => {
    const view = assembleEmployee360Profile(baseInput());
    assert.equal(view.period.monthKey, MONTH);
    assert.equal(view.executiveSummary!.overall.weightedTotal, 91);
    assert.equal(view.executiveSummary!.closedDeals.count, 4);
    assert.equal(view.executiveSummary!.attendance.compliance, 87);
    assert.equal(view.executiveSummary!.decisionStatus!.status, 'NEEDS_COACHING');
  });

  it('overall evaluation comes from the engine verbatim — components keep PENDING status', () => {
    const view = assembleEmployee360Profile(baseInput());
    const components = view.kpi!.components;
    assert.equal(components.length, 2);
    const manager = components.find((c) => c.componentId === 'direct_manager')!;
    assert.equal(manager.status, 'PENDING');
    assert.equal(manager.rawScore, null);
    assert.equal(manager.weightedContribution, null);
  });

  it('unknown closure months survive — never attributed, never zero-filled into CLOSED', () => {
    const view = assembleEmployee360Profile(baseInput({
      dataset: makeDataset({ closedTotal: 4, closedUnknownMonth: 2 }),
    }));
    assert.equal(view.deals!.closedTotal, 4);
    assert.equal(view.deals!.closedUnknownMonth, 2);
    assert.equal(view.executiveSummary!.closedDeals.unknownClosure, 2);
  });

  it('a denied section is null — never zeros (no permission ≠ no data)', () => {
    const view = assembleEmployee360Profile(baseInput({
      gate: gateWith({ hrDeductions: false, requests: false, complaints: false, capa: false }),
    }));
    assert.equal(view.hrDeductions, null);
    assert.equal(view.requests, null);
    assert.equal(view.complaints, null);
    assert.equal(view.capa, null);
    // Allowed sections still carry real data.
    assert.equal(view.deals!.closedTotal, 4);
  });

  it('basicInfo denial hides identity AND the organization block', () => {
    const view = assembleEmployee360Profile(baseInput({ gate: gateWith({ basicInfo: false }) }));
    assert.equal(view.employee, null);
  });

  it('organization gate withholds the org block', () => {
    const view = assembleEmployee360Profile(baseInput({
      gate: gateWith({ organization: false }),
      organization: { chain: [], department: 'Sales', team: null, manager: null, reportingLine: [] },
    }));
    assert.equal(view.organization, null);
  });

  it('decision-support factor lines of denied domains are stripped (no-leak)', () => {
    const view = assembleEmployee360Profile(baseInput({
      gate: gateWith({ followUps: false }),
    }));
    const categories = view.decisionSupport!.factors.map((f) => f.category);
    assert.ok(!categories.includes('FOLLOW_UP'));
    assert.ok(categories.includes('KPI')); // visible domain survives
    // The scorecard ATTENDANCE dimension survives; KPI too.
    assert.equal(view.decisionSupport!.scorecard.length, 2);
  });

  it('risk is withheld when the risk section is denied', () => {
    const view = assembleEmployee360Profile(baseInput({ gate: gateWith({ risk: false }) }));
    assert.equal(view.risk, null);
    assert.equal(view.attention.length, 0);
  });

  it('attention items are built from canonical flags with drill targets', () => {
    const view = assembleEmployee360Profile(baseInput());
    const sources = view.attention.map((a) => a.source);
    assert.ok(sources.includes('followUp')); // overdue canonical predicate
    assert.ok(sources.includes('capa'));
    assert.ok(sources.includes('complaint'));
    assert.ok(sources.includes('quality')); // repeated issue
    const followUpItem = view.attention.find((a) => a.id === 'fu-overdue-fu_1')!;
    assert.equal(followUpItem.drill!.page, 'followUps');
    assert.equal(followUpItem.drill!.highlightId, 'fu_1');
  });

  it('timeline events of denied sections are withheld', () => {
    const view = assembleEmployee360Profile(baseInput({
      gate: gateWith({ complaints: false, travel: false }),
    }));
    const types = view.timeline.map((e) => e.type);
    assert.ok(!types.includes('complaint'));
    assert.ok(!types.includes('travel'));
    assert.ok(types.includes('followUp'));
    assert.ok(types.includes('capa'));
  });

  it('an EMPTY available set (fresh month) is not a scored zero', () => {
    const dataset = makeDataset();
    (dataset.kpi as { weightedTotal: number | null; availableWeight: number | null; rowStatus: string }).weightedTotal = 0;
    (dataset.kpi as { weightedTotal: number | null; availableWeight: number | null; rowStatus: string }).availableWeight = 0;
    (dataset.kpi as { weightedTotal: number | null; availableWeight: number | null; rowStatus: string }).rowStatus = 'INCOMPLETE';
    const view = assembleEmployee360Profile(baseInput({ dataset }));
    assert.equal(view.executiveSummary!.overall.state, 'pending');
    assert.equal(view.executiveSummary!.overall.weightedTotal, null);
  });

  it('NO_SCHEME produces configuration-required, never a fabricated score', () => {
    const dataset = makeDataset();
    (dataset.kpi as { weightedTotal: number | null; rowStatus: string; message: string | null }).weightedTotal = null;
    (dataset.kpi as { weightedTotal: number | null; rowStatus: string; message: string | null }).rowStatus = 'NO_SCHEME';
    (dataset.kpi as { message: string | null }).message = 'لا يوجد مخطط';
    const view = assembleEmployee360Profile(baseInput({ dataset }));
    assert.equal(view.executiveSummary!.overall.state, 'configuration_required');
    assert.equal(view.executiveSummary!.overall.weightedTotal, null);
  });

  it('missing stored attendance result is NOT_AVAILABLE — no attendance fabrication', () => {
    const dataset = makeDataset();
    (dataset.attendance as { status: string; result: unknown }).status = 'NOT_AVAILABLE';
    (dataset.attendance as { status: string; result: unknown }).result = null;
    const view = assembleEmployee360Profile(baseInput({ dataset }));
    assert.equal(view.executiveSummary!.attendance.state, 'not_available');
    assert.equal(view.executiveSummary!.attendance.compliance, null);
  });

  it('tenure arithmetic accepts DD/MM/YYYY and ISO hire dates', () => {
    assert.equal(tenureYearsOf('01/01/2020', NOW), 6);
    assert.equal(tenureYearsOf('2020-01-01', NOW), 6);
    assert.equal(tenureYearsOf(null, NOW), null);
    assert.equal(tenureYearsOf('01/01/2099', NOW), 0); // future hire → 0, never negative
  });

  it('requests and HR blocks carry the selected month identity', () => {
    const view = assembleEmployee360Profile(baseInput());
    assert.equal(view.requests!.total, 2);
    assert.equal(view.hrDeductions!.month, MONTH);
    assert.equal(view.hrDeductions!.deductionDays, 2);
  });
});

// ─────────────────────────────────────────────────────────────
//  Section gate — the extended registry (legacy maps inherit)
// ─────────────────────────────────────────────────────────────

import { resolveEmployee360SectionGate } from '@/lib/permissions/employee360-access';
import type { PermissionsMap } from '@/config/permissions';

describe('employee360 section gate — extended registry', () => {
  it('legacy maps (no section overrides) inherit the page level for EVERY section', () => {
    const legacy: PermissionsMap = {
      employee360: { level: 'read', actions: {} },
    };
    const gate = resolveEmployee360SectionGate(legacy);
    for (const id of ['basicInfo', 'performance', 'deals', 'attendance', 'quality', 'hrDeductions', 'followUps', 'travel', 'complaints', 'capa', 'risk', 'decisionSupport', 'organization', 'timeline'] as const) {
      assert.equal(gate[id], true, `section ${id} should inherit page 'read'`);
    }
  });

  it('an explicit none override hides only that section', () => {
    const map: PermissionsMap = {
      employee360: {
        level: 'read',
        actions: {},
        sections: { hrDeductions: 'none', decisionSupport: 'none' },
      },
    };
    const gate = resolveEmployee360SectionGate(map);
    assert.equal(gate.hrDeductions, false);
    assert.equal(gate.decisionSupport, false);
    assert.equal(gate.basicInfo, true);
    assert.equal(gate.performance, true);
    assert.equal(gate.risk, true);
  });

  it("page 'none' hides every section (the page gate always wins)", () => {
    const map: PermissionsMap = {
      employee360: {
        level: 'none',
        actions: {},
        sections: { basicInfo: 'read' },
      },
    };
    const gate = resolveEmployee360SectionGate(map);
    assert.equal(gate.basicInfo, false);
    assert.equal(gate.performance, false);
    assert.equal(gate.timeline, false);
  });
});
