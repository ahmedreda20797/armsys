// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — Deterministic Analysis Rules
//
//  PURE: turns the two canonical datasets (current + previous period)
//  plus the gated risk/HR blocks into the Hub's analytical sections:
//  dimensions, overview, changes, cross-signals, patterns, strengths,
//  development areas and recommendations.
//
//  RULE DOCTRINE (Hub spec §10/§15/§16/§17/§19-§22):
//    • Every status/label comes from an explicit, documented rule —
//      no opaque scoring, no invented composite "employee score".
//    • Missing data is INSUFFICIENT_DATA — never 0, never "bad".
//    • Cross-dimension wording is ASSOCIATIVE only ("observed
//      overlap"), never causal.
//    • Recommendations are managerial actions only — never
//      termination, accusation, or restricted-HR exposure.
//    • Thresholds live in the constants block below (no magic
//      numbers inside the rules).
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { RiskResult } from '@/lib/metrics';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';
import { riskSignalsOf } from './risk-block';
import type {
  HubChangeItem,
  HubCrossSignal,
  HubDimension,
  HubDimensionKey,
  HubDimensionStatus,
  HubDomain,
  HubEvidenceItem,
  HubOverview,
  HubOverviewStatus,
  HubPattern,
  HubPatternKind,
  HubRecommendation,
  HubSourceRef,
} from './types';

// ─────────────────────────────────────────────────────────────
//  Rule thresholds (the ONLY tunables — documented, testable)
// ─────────────────────────────────────────────────────────────

/** Quality percentage-point change that reads as improving/declining. */
export const QUALITY_DELTA_POINTS = 5;
/** Completion-rate change (percent) that reads as improving/declining. */
export const FOLLOWUP_COMPLETION_DELTA = 10;
/** Attendance compliance change (percent) that reads as improving/declining. */
export const ATTENDANCE_COMPLIANCE_DELTA = 5;
/** Attendance compliance at/above this is solid (canonical engine output). */
export const ATTENDANCE_SOLID_COMPLIANCE = 95;
/** Attendance compliance below this needs attention. */
export const ATTENDANCE_LOW_COMPLIANCE = 85;
/** Follow-up completion at/above this (with zero overdue) is strong. */
export const FOLLOWUP_STRONG_COMPLETION = 80;
/** Overdue follow-ups at/above this count need attention. */
export const FOLLOWUP_OVERDUE_ATTENTION = 3;
/** Overdue follow-ups at/above this count are a development area. */
export const FOLLOWUP_OVERDUE_AREA = 2;
/** Quality deductions at/above this count need attention / are an area. */
export const QUALITY_DEDUCTIONS_ATTENTION = 3;
export const QUALITY_DEDUCTIONS_AREA = 2;
/** HR deduction count at/above this reads as declining discipline. */
export const HR_DEDUCTIONS_DECLINING = 2;
/** Declining dimensions that escalate to a structured review. */
export const DECLINING_FOR_PIR = 2;
export const DECLINING_FOR_MANAGEMENT_REVIEW = 3;
/** Max signals per list (spec: compact, not a wall). */
export const MAX_SIGNALS = 4;
/** Max recommendations (spec §21). */
export const MAX_RECOMMENDATIONS = 5;
/** Max isolated-pattern labels surfaced. */
export const MAX_ISOLATED_LABELS = 3;

// ─────────────────────────────────────────────────────────────
//  Canonical page pointers (navigateTo targets)
// ─────────────────────────────────────────────────────────────

const DOMAIN_PAGE: Record<HubDomain, string> = {
  quality: 'observations',
  followUp: 'followUps',
  risk: 'riskCenter',
  attendance: 'attendance',
  deals: 'travel',
  hr: 'hrDeductions',
  complaints: 'complaints',
  capa: 'capa',
  kpi: 'kpiReports',
};

function sourceOf(domain: HubDomain, recordIds: ReadonlyArray<string>): HubSourceRef {
  return { domain, page: DOMAIN_PAGE[domain], recordIds: [...recordIds] };
}

function deltaOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 100) / 100;
}

function directionOf(delta: number | null): 'UP' | 'DOWN' | 'FLAT' {
  if (delta === null || delta === 0) return 'FLAT';
  return delta > 0 ? 'UP' : 'DOWN';
}

// ─────────────────────────────────────────────────────────────
//  Analysis input / output
// ─────────────────────────────────────────────────────────────

export interface HubAnalysisInput {
  current: EmployeePerformanceDataset;
  previous: EmployeePerformanceDataset | null;
  /** Canonical risk results (null entry = restricted / unavailable). */
  risk: { current: RiskResult | null; previous: RiskResult | null };
  /** HR summaries (null block = section restricted server-side). */
  hr: { current: EmployeeHrMonthSummary | null; previous: EmployeeHrMonthSummary | null } | null;
}

export interface HubAnalysis {
  dimensions: HubDimension[];
  overview: HubOverview;
  changes: HubChangeItem[];
  crossSignals: HubCrossSignal[];
  patterns: HubPattern[];
  strengths: HubEvidenceItem[];
  developmentAreas: HubEvidenceItem[];
  recommendations: HubRecommendation[];
}

// ─────────────────────────────────────────────────────────────
//  Dimensions
// ─────────────────────────────────────────────────────────────

function qualityDimension(current: EmployeePerformanceDataset, previous: EmployeePerformanceDataset | null): HubDimension {
  const q = current.kpi.quality;
  const prevQ = previous?.kpi.quality ?? null;
  const value = q?.rawScore ?? null;
  const previousValue = prevQ?.rawScore ?? null;
  const delta = deltaOf(value, previousValue);
  const repeatedGroups = current.quality.repeatedIssues.byCategory.length;

  let status: HubDimensionStatus;
  if (value === null) status = 'INSUFFICIENT_DATA';
  else if (delta !== null && delta <= -QUALITY_DELTA_POINTS) status = 'DECLINING';
  else if (delta !== null && delta >= QUALITY_DELTA_POINTS) status = 'IMPROVING';
  else if (repeatedGroups >= 1 || current.quality.deductions.count >= QUALITY_DEDUCTIONS_ATTENTION) status = 'NEEDS_ATTENTION';
  else status = 'STABLE';

  return {
    key: 'quality',
    status,
    metric: value !== null ? 'qualityPercent' : 'calculatedPoints',
    value,
    previousValue,
    delta,
    details: {
      quality: {
        qualityPercent: value,
        calculatedPoints: q?.weightedContribution ?? null,
        kpiStatus: current.kpi.overallStatus ?? null,
        kpiIncomplete: current.kpi.rowStatus === 'INCOMPLETE' || current.kpi.rowStatus === 'PENDING',
        observationsTotal: current.quality.observations.total,
        observationsApproved: current.quality.observations.approved,
        qualityDeductions: current.quality.deductions.count,
        repeatedIssues: repeatedGroups,
      },
    },
  };
}

function followUpDimension(current: EmployeePerformanceDataset, previous: EmployeePerformanceDataset | null): HubDimension {
  const f = current.followUps;
  const prev = previous?.followUps ?? null;
  const value = f.completionRate;
  const previousValue = prev?.completionRate ?? null;
  const delta = deltaOf(value, previousValue);

  let status: HubDimensionStatus;
  if (f.total === 0) status = 'INSUFFICIENT_DATA';
  else if (f.overdue >= FOLLOWUP_OVERDUE_ATTENTION) status = 'NEEDS_ATTENTION';
  else if (delta !== null && delta <= -FOLLOWUP_COMPLETION_DELTA) status = 'DECLINING';
  else if (delta !== null && delta >= FOLLOWUP_COMPLETION_DELTA) status = 'IMPROVING';
  else if (value !== null && value >= FOLLOWUP_STRONG_COMPLETION && f.overdue === 0) status = 'STRONG';
  else status = 'STABLE';

  return {
    key: 'followUp',
    status,
    metric: 'followUpCompletion',
    value,
    previousValue,
    delta,
    details: {
      followUp: {
        total: f.total,
        completed: f.completed,
        overdue: f.overdue,
        active: f.active,
        completionRate: f.completionRate,
      },
    },
  };
}

function riskDimension(risk: { current: RiskResult | null; previous: RiskResult | null }): HubDimension | null {
  const r = risk.current;
  if (!r) return null;
  const previousValue = risk.previous?.score ?? null;
  let status: HubDimensionStatus;
  switch (r.level) {
    case 'low': status = 'STRONG'; break;
    case 'medium': status = 'STABLE'; break;
    default: status = 'NEEDS_ATTENTION'; break; // high + critical
  }
  return {
    key: 'risk',
    status,
    metric: 'riskScore',
    value: r.score,
    previousValue,
    delta: deltaOf(r.score, previousValue),
    details: {
      risk: {
        level: r.level,
        score: r.score,
        signals: riskSignalsOf(r.breakdown),
      },
    },
  };
}

function attendanceDimension(current: EmployeePerformanceDataset, previous: EmployeePerformanceDataset | null): HubDimension {
  const result = current.attendance.status === 'AVAILABLE' ? current.attendance.result : null;
  const prevResult = previous?.attendance.status === 'AVAILABLE' ? previous.attendance.result : null;
  const value = result?.compliance ?? null;
  const previousValue = prevResult?.compliance ?? null;
  const delta = deltaOf(value, previousValue);

  let status: HubDimensionStatus;
  if (value === null) status = 'INSUFFICIENT_DATA';
  else if (delta !== null && delta <= -ATTENDANCE_COMPLIANCE_DELTA) status = 'DECLINING';
  else if (delta !== null && delta >= ATTENDANCE_COMPLIANCE_DELTA) status = 'IMPROVING';
  else if (value >= ATTENDANCE_SOLID_COMPLIANCE) status = 'STRONG';
  else if (value < ATTENDANCE_LOW_COMPLIANCE) status = 'NEEDS_ATTENTION';
  else status = 'STABLE';

  return {
    key: 'attendance',
    status,
    metric: 'attendanceCompliance',
    value,
    previousValue,
    delta,
    details: {
      attendance: {
        status: current.attendance.status,
        compliance: value,
        presentDays: result?.presentDays ?? null,
        lateDays: result?.lateDays ?? null,
        absentDays: result?.absentDays ?? null,
        attendanceDeductionDays: result?.attendanceDeductionDays ?? null,
      },
    },
  };
}

function businessOutputDimension(current: EmployeePerformanceDataset, previous: EmployeePerformanceDataset | null): HubDimension {
  const d = current.deals;
  const prevClosed = previous?.deals.closedWithEmployeeInPeriod ?? null;
  const value = d.closedWithEmployeeInPeriod;
  const delta = deltaOf(value, prevClosed);
  const domainInactive =
    d.closedWithEmployeeTotal === 0 && d.travelTotal === 0 && d.createdTotal === 0 &&
    Object.values(d.statusAllTime).every((n) => n === 0);

  let status: HubDimensionStatus;
  if (domainInactive) status = 'INSUFFICIENT_DATA';
  else if (delta !== null && delta <= -1) status = 'DECLINING';
  else if (delta !== null && delta >= 1) status = 'IMPROVING';
  else status = 'STABLE';

  return {
    key: 'businessOutput',
    status,
    metric: 'closedDeals',
    value,
    previousValue: prevClosed,
    delta,
    details: {
      businessOutput: {
        closedInPeriod: value,
        confirmedClosures: d.closedWithEmployeeInPeriodByStatus.completed,
        canceledClosures: d.closedWithEmployeeInPeriodByStatus.canceled,
        closuresUnknownMonth: d.closedWithEmployeeUnknownMonth,
        currentDeals: d.statusAllTime.upcoming + d.statusAllTime.in_progress,
      },
    },
  };
}

function hrDimension(hr: { current: EmployeeHrMonthSummary | null; previous: EmployeeHrMonthSummary | null } | null): HubDimension | null {
  if (!hr) return null; // section restricted server-side — dimension withheld
  const value = hr.current?.deductionCount ?? null;
  let status: HubDimensionStatus;
  if (value === null) status = 'INSUFFICIENT_DATA';
  else if (value >= HR_DEDUCTIONS_DECLINING) status = 'DECLINING';
  else if (value >= 1) status = 'NEEDS_ATTENTION';
  else status = 'STABLE';
  return {
    key: 'hr',
    status,
    metric: 'hrDeductions',
    value,
    previousValue: hr.previous?.deductionCount ?? null,
    delta: deltaOf(value, hr.previous?.deductionCount ?? null),
    details: {
      hr: {
        deductionCount: hr.current?.deductionCount ?? 0,
        deductionDays: hr.current?.deductionDays ?? 0,
        deductionAmount: hr.current?.deductionAmount ?? 0,
      },
    },
  };
}

function complaintsDimension(current: EmployeePerformanceDataset, previous: EmployeePerformanceDataset | null): HubDimension {
  const c = current.complaints;
  const prevOpen = previous?.complaints.stillOpen ?? null;
  const value = c.stillOpen;
  let status: HubDimensionStatus;
  if (c.total === 0 && value === 0) status = 'STABLE'; // a real zero — the domain returned no complaints
  else if (value > 0) status = 'NEEDS_ATTENTION';
  else status = 'STABLE';
  return {
    key: 'complaints',
    status,
    metric: 'openItems',
    value,
    previousValue: prevOpen,
    delta: deltaOf(value, prevOpen),
    details: {
      complaints: {
        total: c.total,
        stillOpen: c.stillOpen,
        resolvedOrClosed: c.resolvedOrClosed,
      },
    },
  };
}

function capaDimension(current: EmployeePerformanceDataset, previous: EmployeePerformanceDataset | null): HubDimension {
  const c = current.capa;
  const prevActive = previous?.capa.active ?? null;
  const value = c.active;
  let status: HubDimensionStatus;
  if (c.overdue > 0 || value > 0) status = 'NEEDS_ATTENTION';
  else status = 'STABLE';
  return {
    key: 'capa',
    status,
    metric: 'openItems',
    value,
    previousValue: prevActive,
    delta: deltaOf(value, prevActive),
    details: {
      capa: {
        total: c.total,
        active: c.active,
        overdue: c.overdue,
        closedCount: c.closedCount,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  Changes (§17 — why performance changed)
// ─────────────────────────────────────────────────────────────

/** Fixed, explainable presentation order for change items. */
const CHANGE_ORDER: Array<{ key: string; domain: HubDomain; unit: HubChangeItem['unit']; higherIsBetter: boolean }> = [
  { key: 'qualityPercent', domain: 'quality', unit: 'points', higherIsBetter: true },
  { key: 'calculatedPoints', domain: 'kpi', unit: 'points', higherIsBetter: true },
  { key: 'followUpCompletion', domain: 'followUp', unit: 'percent', higherIsBetter: true },
  { key: 'followUpsOverdue', domain: 'followUp', unit: 'count', higherIsBetter: false },
  { key: 'attendanceCompliance', domain: 'attendance', unit: 'percent', higherIsBetter: true },
  { key: 'dealsClosed', domain: 'deals', unit: 'count', higherIsBetter: true },
  { key: 'observationsCount', domain: 'quality', unit: 'count', higherIsBetter: false },
  { key: 'qualityDeductions', domain: 'quality', unit: 'count', higherIsBetter: false },
  { key: 'riskScore', domain: 'risk', unit: 'score', higherIsBetter: false },
  { key: 'hrDeductions', domain: 'hr', unit: 'count', higherIsBetter: false },
];

function buildChanges(input: HubAnalysisInput): HubChangeItem[] {
  const { current, previous, risk, hr } = input;
  const out: HubChangeItem[] = [];

  const push = (
    def: (typeof CHANGE_ORDER)[number],
    values: { current: number | null; previous: number | null; source: HubSourceRef },
  ) => {
    const delta = deltaOf(values.current, values.previous);
    // A change needs data on at least ONE side — a metric missing on
    // both sides is not a change, it is absent data.
    if (values.current === null && values.previous === null) return;
    out.push({
      key: def.key,
      domain: def.domain,
      direction: directionOf(delta),
      current: values.current,
      previous: values.previous,
      delta,
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
      sources: [values.source],
    });
  };

  const q = current.kpi.quality;
  const pq = previous?.kpi.quality ?? null;
  push(CHANGE_ORDER[0], {
    current: q?.rawScore ?? null,
    previous: pq?.rawScore ?? null,
    source: sourceOf('quality', current.evidence.observations.recordIds),
  });
  push(CHANGE_ORDER[1], {
    current: q?.weightedContribution ?? null,
    previous: pq?.weightedContribution ?? null,
    source: { domain: 'kpi', page: DOMAIN_PAGE.kpi, recordIds: [current.period.monthKey] },
  });
  push(CHANGE_ORDER[2], {
    current: current.followUps.completionRate,
    previous: previous?.followUps.completionRate ?? null,
    source: sourceOf('followUp', current.evidence.followUps.recordIds),
  });
  push(CHANGE_ORDER[3], {
    current: current.followUps.overdue,
    previous: previous?.followUps.overdue ?? null,
    source: sourceOf('followUp', current.evidence.followUps.recordIds),
  });
  push(CHANGE_ORDER[4], {
    current: current.attendance.result?.compliance ?? null,
    previous: previous?.attendance.result?.compliance ?? null,
    source: sourceOf('attendance', current.evidence.attendance?.recordIds ?? []),
  });
  push(CHANGE_ORDER[5], {
    current: current.deals.closedWithEmployeeInPeriod,
    previous: previous?.deals.closedWithEmployeeInPeriod ?? null,
    source: sourceOf('deals', current.evidence.deals.recordIds),
  });
  push(CHANGE_ORDER[6], {
    current: current.quality.observations.total,
    previous: previous?.quality.observations.total ?? null,
    source: sourceOf('quality', current.evidence.observations.recordIds),
  });
  push(CHANGE_ORDER[7], {
    current: current.quality.deductions.count,
    previous: previous?.quality.deductions.count ?? null,
    source: sourceOf('quality', current.evidence.deductions.recordIds),
  });
  if (risk.current) {
    push(CHANGE_ORDER[8], {
      current: risk.current.score,
      previous: risk.previous?.score ?? null,
      source: sourceOf('risk', [current.employee.employeeId]),
    });
  }
  if (hr) {
    push(CHANGE_ORDER[9], {
      current: hr.current?.deductionCount ?? null,
      previous: hr.previous?.deductionCount ?? null,
      source: sourceOf('hr', []),
    });
  }

  // Strongest first (|delta|), stable tie-break by the fixed order.
  const fixedIndex = new Map(CHANGE_ORDER.map((d, i) => [d.key, i]));
  out.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || (fixedIndex.get(a.key) ?? 0) - (fixedIndex.get(b.key) ?? 0));
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Cross-signals (§16 — association, never causation)
// ─────────────────────────────────────────────────────────────

function buildCrossSignals(input: HubAnalysisInput, changes: HubChangeItem[]): HubCrossSignal[] {
  const byKey = new Map(changes.map((c) => [c.key, c]));
  const up = (key: string) => byKey.get(key)?.direction === 'UP';
  const down = (key: string) => byKey.get(key)?.direction === 'DOWN';
  const sourcesOf = (keys: string[]): HubSourceRef[] =>
    keys.map((k) => byKey.get(k)?.sources[0]).filter((s): s is HubSourceRef => Boolean(s));

  const rules: Array<{ key: string; when: () => boolean; signals: [string, string]; sourceKeys: string[] }> = [
    {
      key: 'overlap.followUpDelaysQuality',
      when: () => up('followUpsOverdue') && up('observationsCount'),
      signals: ['followUpsOverdue', 'observationsCount'],
      sourceKeys: ['followUpsOverdue', 'observationsCount'],
    },
    {
      key: 'overlap.deductionsComplaints',
      when: () => up('qualityDeductions') && up('observationsCount') && (byKey.get('qualityDeductions')?.current ?? 0) > 0,
      signals: ['qualityDeductions', 'observationsCount'],
      sourceKeys: ['qualityDeductions', 'observationsCount'],
    },
    {
      key: 'overlap.attendanceFollowUps',
      when: () => down('attendanceCompliance') && up('followUpsOverdue'),
      signals: ['attendanceCompliance', 'followUpsOverdue'],
      sourceKeys: ['attendanceCompliance', 'followUpsOverdue'],
    },
    {
      key: 'overlap.dealsFollowUps',
      when: () => down('dealsClosed') && down('followUpCompletion'),
      signals: ['dealsClosed', 'followUpCompletion'],
      sourceKeys: ['dealsClosed', 'followUpCompletion'],
    },
    {
      key: 'overlap.qualityDeclineObservations',
      when: () => down('qualityPercent') && up('observationsCount'),
      signals: ['qualityPercent', 'observationsCount'],
      sourceKeys: ['qualityPercent', 'observationsCount'],
    },
  ];

  const out: HubCrossSignal[] = [];
  for (const rule of rules) {
    if (rule.when()) {
      out.push({ key: rule.key, signals: rule.signals, sources: sourcesOf(rule.sourceKeys) });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Patterns (§15 — deterministic, explainable)
// ─────────────────────────────────────────────────────────────

function buildPatterns(input: HubAnalysisInput, dimensions: HubDimension[]): HubPattern[] {
  const { current, previous } = input;
  const out: HubPattern[] = [];
  const obsIds = (label: string | null): string[] => {
    if (!label) return current.evidence.observations.recordIds;
    const group = current.quality.repeatedIssues.byCategory.find((g) => g.label === label)
      ?? current.quality.repeatedIssues.byType.find((g) => g.label === label);
    return group?.observationIds ?? current.evidence.observations.recordIds;
  };

  // REPEATED — the same issue key recurs across ≥2 window months.
  for (const group of current.quality.repeatedIssues.windowByCategory) {
    if (group.monthsPresent >= 2) {
      out.push({
        kind: 'REPEATED',
        domain: 'quality',
        label: group.label,
        occurrences: group.occurrenceCount,
        sources: [sourceOf('quality', group.observationIds)],
      });
    }
  }

  const currentKeys = new Set(current.quality.repeatedIssues.byCategory.map((g) => g.issueKey));
  const previousKeys = new Set(previous?.quality.repeatedIssues.byCategory.map((g) => g.issueKey) ?? []);

  // PERSISTENT — present in the current AND the previous period.
  for (const group of current.quality.repeatedIssues.byCategory) {
    if (previousKeys.has(group.issueKey)) {
      out.push({
        kind: 'PERSISTENT',
        domain: 'quality',
        label: group.label,
        occurrences: group.occurrenceCount,
        sources: [sourceOf('quality', group.observationIds)],
      });
    }
  }

  // EMERGING — present in the current period, absent from the previous one.
  if (previous) {
    for (const group of current.quality.repeatedIssues.byCategory) {
      if (!previousKeys.has(group.issueKey)) {
        out.push({
          kind: 'EMERGING',
          domain: 'quality',
          label: group.label,
          occurrences: group.occurrenceCount,
          sources: [sourceOf('quality', group.observationIds)],
        });
      }
    }
  }

  // IMPROVING — a previously recurring issue absent from the current period.
  for (const group of previous?.quality.repeatedIssues.byCategory ?? []) {
    if (!currentKeys.has(group.issueKey)) {
      out.push({
        kind: 'IMPROVING',
        domain: 'quality',
        label: group.label,
        occurrences: group.occurrenceCount,
        sources: [sourceOf('quality', previous?.evidence.observations.recordIds ?? [])],
      });
    }
  }

  // DETERIORATING — a previously stable dimension declined.
  const windowRecurrenceKeys = new Set(current.quality.repeatedIssues.windowByCategory.map((g) => g.issueKey));
  for (const dim of dimensions) {
    if (dim.status === 'DECLINING') {
      out.push({
        kind: 'DETERIORATING',
        domain: dim.key === 'businessOutput' ? 'deals' : dim.key === 'followUp' ? 'followUp' : dim.key === 'hr' ? 'hr' : (dim.key as HubDomain),
        label: null,
        occurrences: null,
        sources: [sourceOf(dim.key === 'businessOutput' ? 'deals' : (dim.key as HubDomain), [])],
      });
    }
  }

  // ISOLATED — a single occurrence with no window recurrence (capped).
  let isolated = 0;
  for (const group of current.quality.repeatedIssues.byCategory) {
    if (group.occurrenceCount === 1 && !windowRecurrenceKeys.has(group.issueKey) && isolated < MAX_ISOLATED_LABELS) {
      out.push({
        kind: 'ISOLATED',
        domain: 'quality',
        label: group.label,
        occurrences: 1,
        sources: [sourceOf('quality', obsIds(group.label))],
      });
      isolated += 1;
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
//  Strengths / development areas / recommendations
// ─────────────────────────────────────────────────────────────

function buildStrengths(input: HubAnalysisInput, dims: Map<HubDimensionKey, HubDimension>): HubEvidenceItem[] {
  const { current, previous } = input;
  const out: HubEvidenceItem[] = [];
  const quality = dims.get('quality');
  const followUp = dims.get('followUp');
  const attendance = dims.get('attendance');
  const output = dims.get('businessOutput');
  const capa = dims.get('capa');
  const hr = dims.get('hr');

  if (quality?.delta !== null && quality?.delta !== undefined && quality.delta >= QUALITY_DELTA_POINTS) {
    out.push({
      key: 'strength.qualityImproved',
      values: { delta: quality.delta, current: quality.value, previous: quality.previousValue },
      sources: [sourceOf('quality', current.evidence.observations.recordIds)],
    });
  }
  if (
    (current.quality.observations.total > 0 || current.kpi.quality !== null)
    && current.quality.deductions.count === 0
    && (hr?.value ?? 0) === 0
  ) {
    out.push({
      key: 'strength.noDeductions',
      values: { observations: current.quality.observations.total },
      sources: [sourceOf('quality', current.evidence.deductions.recordIds)],
    });
  }
  if (followUp && followUp.details.followUp && followUp.details.followUp.completed >= 3 && followUp.details.followUp.overdue === 0) {
    out.push({
      key: 'strength.followUpsOnTrack',
      values: { completed: followUp.details.followUp.completed, completionRate: followUp.details.followUp.completionRate },
      sources: [sourceOf('followUp', current.evidence.followUps.recordIds)],
    });
  }
  if (attendance?.value !== null && attendance?.value !== undefined && attendance.value >= ATTENDANCE_SOLID_COMPLIANCE) {
    out.push({
      key: 'strength.attendanceSolid',
      values: { compliance: attendance.value },
      sources: [sourceOf('attendance', current.evidence.attendance?.recordIds ?? [])],
    });
  }
  if (output?.delta !== null && output?.delta !== undefined && output.delta >= 1) {
    out.push({
      key: 'strength.dealsIncreased',
      values: { current: output.value, previous: output.previousValue },
      sources: [sourceOf('deals', current.evidence.deals.recordIds)],
    });
  }
  if (capa && capa.details.capa && capa.details.capa.total > 0 && capa.details.capa.active === 0 && capa.details.capa.overdue === 0) {
    out.push({
      key: 'strength.capaClear',
      values: { closedCount: capa.details.capa.closedCount },
      sources: [sourceOf('capa', current.evidence.capa.recordIds)],
    });
  }
  if (
    current.quality.observations.total > 0
    && current.quality.repeatedIssues.byCategory.length === 0
    && (previous?.quality.repeatedIssues.byCategory.length ?? 0) > 0
  ) {
    out.push({
      key: 'strength.noRepeatedIssues',
      sources: [sourceOf('quality', current.evidence.observations.recordIds)],
    });
  }
  return out.slice(0, MAX_SIGNALS);
}

function buildDevelopmentAreas(input: HubAnalysisInput, dims: Map<HubDimensionKey, HubDimension>): HubEvidenceItem[] {
  const { current } = input;
  const hr = dims.get('hr');
  const out: HubEvidenceItem[] = [];
  const quality = dims.get('quality');
  const followUp = dims.get('followUp');
  const attendance = dims.get('attendance');
  const capa = dims.get('capa');
  const complaints = dims.get('complaints');

  for (const group of current.quality.repeatedIssues.byCategory) {
    out.push({
      key: 'area.repeatedQualityIssues',
      labels: [group.label],
      values: { occurrences: group.occurrenceCount },
      sources: [sourceOf('quality', group.observationIds)],
    });
  }
  if (followUp && followUp.details.followUp && followUp.details.followUp.overdue >= FOLLOWUP_OVERDUE_AREA) {
    out.push({
      key: 'area.overdueFollowUps',
      values: { overdue: followUp.details.followUp.overdue, active: followUp.details.followUp.active },
      sources: [sourceOf('followUp', current.evidence.followUps.recordIds)],
    });
  }
  if (current.quality.deductions.count >= QUALITY_DEDUCTIONS_AREA) {
    out.push({
      key: 'area.qualityDeductions',
      values: { count: current.quality.deductions.count, days: current.quality.deductions.totalDays },
      sources: [sourceOf('quality', current.evidence.deductions.recordIds)],
    });
  }
  if (attendance?.value !== null && attendance?.value !== undefined && attendance.value < ATTENDANCE_LOW_COMPLIANCE) {
    out.push({
      key: 'area.attendanceConsistency',
      values: { compliance: attendance.value, absentDays: attendance.details.attendance?.absentDays ?? null, lateDays: attendance.details.attendance?.lateDays ?? null },
      sources: [sourceOf('attendance', current.evidence.attendance?.recordIds ?? [])],
    });
  }
  if (complaints && (complaints.value ?? 0) > 0) {
    out.push({
      key: 'area.complaintHandling',
      values: { open: complaints.value },
      sources: [sourceOf('complaints', current.evidence.complaints.recordIds)],
    });
  }
  if (capa && (capa.details.capa?.overdue ?? 0) > 0) {
    out.push({
      key: 'area.capaFollowThrough',
      values: { overdue: capa.details.capa?.overdue ?? 0, active: capa.details.capa?.active ?? 0 },
      sources: [sourceOf('capa', current.evidence.capa.recordIds)],
    });
  }
  if ((hr?.value ?? 0) >= 1) {
    out.push({
      key: 'area.hrDiscipline',
      values: { count: hr?.value ?? 0 },
      sources: [sourceOf('hr', [])],
    });
  }
  if (quality?.status === 'DECLINING') {
    out.push({
      key: 'area.qualityAdherence',
      values: { delta: quality.delta, current: quality.value, previous: quality.previousValue },
      sources: [sourceOf('quality', current.evidence.observations.recordIds)],
    });
  }
  return out.slice(0, MAX_SIGNALS);
}

function buildRecommendations(
  input: HubAnalysisInput,
  dims: Map<HubDimensionKey, HubDimension>,
  areas: HubEvidenceItem[],
): HubRecommendation[] {
  const { current, risk } = input;
  const out: HubRecommendation[] = [];
  const has = (key: string) => areas.some((a) => a.key === key);
  const followUp = dims.get('followUp');
  const attendance = dims.get('attendance');
  const capa = dims.get('capa');
  const complaints = dims.get('complaints');

  // Coaching on the affected procedure — repeated quality issues exist.
  const repeatedAreas = areas.filter((a) => a.key === 'area.repeatedQualityIssues');
  if (repeatedAreas.length > 0) {
    out.push({ key: 'rec.coaching', rationale: repeatedAreas.slice(0, 2) });
  }
  // Follow-up workload / SLA review.
  if ((followUp?.details.followUp?.overdue ?? 0) >= FOLLOWUP_OVERDUE_ATTENTION) {
    out.push({
      key: 'rec.followUpReview',
      rationale: [{
        key: 'evidence.overdueFollowUps',
        values: { overdue: followUp?.details.followUp?.overdue ?? 0 },
        sources: [sourceOf('followUp', current.evidence.followUps.recordIds)],
      }],
    });
  }
  // Attendance pattern review with HR.
  if (
    (attendance?.value !== null && attendance?.value !== undefined && attendance.value < ATTENDANCE_LOW_COMPLIANCE)
    || (attendance?.details.attendance?.absentDays ?? 0) >= 2
  ) {
    out.push({
      key: 'rec.attendanceReview',
      rationale: [{
        key: 'evidence.attendance',
        values: { compliance: attendance?.value ?? null, absentDays: attendance?.details.attendance?.absentDays ?? null },
        sources: [sourceOf('attendance', current.evidence.attendance?.recordIds ?? [])],
      }],
    });
  }
  // Corrective-action review.
  if ((capa?.details.capa?.overdue ?? 0) > 0) {
    out.push({
      key: 'rec.capaReview',
      rationale: [{
        key: 'evidence.overdueCapa',
        values: { overdue: capa?.details.capa?.overdue ?? 0 },
        sources: [sourceOf('capa', current.evidence.capa.recordIds)],
      }],
    });
  }
  // Customer-complaint handling review.
  if ((complaints?.value ?? 0) > 0) {
    out.push({
      key: 'rec.complaintReview',
      rationale: [{
        key: 'evidence.openComplaints',
        values: { open: complaints?.value ?? 0 },
        sources: [sourceOf('complaints', current.evidence.complaints.recordIds)],
      }],
    });
  }
  // Escalation: multiple dimensions deteriorating or high risk.
  const decliningCount = [...dims.values()].filter((d) => d.status === 'DECLINING').length;
  const riskLevel = risk.current?.level ?? null;
  if (decliningCount >= DECLINING_FOR_PIR || riskLevel === 'high' || riskLevel === 'critical') {
    out.push({
      key: 'rec.performanceReview',
      rationale: [{
        key: 'evidence.reviewBasis',
        values: { decliningDimensions: decliningCount, riskScore: risk.current?.score ?? null },
        sources: [sourceOf('risk', [current.employee.employeeId])],
      }],
    });
  }

  return out.slice(0, MAX_RECOMMENDATIONS);
}

// ─────────────────────────────────────────────────────────────
//  Overview (§8)
// ─────────────────────────────────────────────────────────────

function buildOverview(
  dims: HubDimension[],
  changes: HubChangeItem[],
  strengths: HubEvidenceItem[],
  concerns: HubEvidenceItem[],
  riskLevel: string | null,
): HubOverview {
  const measurable = dims.filter((d) => d.status !== 'INSUFFICIENT_DATA');
  const declining = dims.filter((d) => d.status === 'DECLINING');
  const attention = dims.filter((d) => d.status === 'NEEDS_ATTENTION');
  const improving = dims.filter((d) => d.status === 'IMPROVING');

  const reasons: string[] = [];
  let status: HubOverviewStatus;
  if (measurable.length === 0) {
    status = 'INSUFFICIENT_DATA';
    reasons.push('rule.noMeasurableDimensions');
  } else if (riskLevel === 'critical' || declining.length >= DECLINING_FOR_MANAGEMENT_REVIEW) {
    status = 'MANAGEMENT_REVIEW';
    if (riskLevel === 'critical') reasons.push('rule.riskCritical');
    if (declining.length >= DECLINING_FOR_MANAGEMENT_REVIEW) reasons.push('rule.multipleDecliningDimensions');
  } else if (riskLevel === 'high' || declining.length >= DECLINING_FOR_PIR) {
    status = 'PERFORMANCE_IMPROVEMENT_REVIEW';
    if (riskLevel === 'high') reasons.push('rule.riskHigh');
    if (declining.length >= DECLINING_FOR_PIR) reasons.push('rule.decliningDimensions');
  } else if (attention.length > 0 || declining.length > 0) {
    status = 'NEEDS_COACHING';
    reasons.push('rule.needsAttentionDimensions');
  } else if (improving.length > 0 && concerns.length === 0) {
    status = 'IMPROVING';
    reasons.push('rule.improvingWithoutConcerns');
  } else {
    status = 'STABLE';
    reasons.push('rule.stable');
  }

  // Main change — the strongest evidence-backed delta in fixed order.
  const mainChange = changes.find((c) => c.delta !== null && c.delta !== 0) ?? null;

  return { status, reasons, positiveSignals: strengths, concerns, mainChange };
}

/** Concern candidates — deterministic, strongest first, capped. */
function buildConcerns(input: HubAnalysisInput, dims: Map<HubDimensionKey, HubDimension>): HubEvidenceItem[] {
  const { current, risk } = input;
  const hr = dims.get('hr');
  const out: HubEvidenceItem[] = [];

  const riskLevel = risk.current?.level ?? null;
  if (riskLevel === 'high' || riskLevel === 'critical') {
    const signals = riskSignalsOf(risk.current!.breakdown);
    out.push({
      key: riskLevel === 'critical' ? 'concern.riskCritical' : 'concern.riskHigh',
      values: { score: risk.current!.score },
      sources: [sourceOf('risk', [current.employee.employeeId])],
      labels: signals.slice(0, 3).map((s) => s.factor),
    });
  }
  for (const group of current.quality.repeatedIssues.byCategory) {
    out.push({
      key: 'concern.repeatedIssues',
      labels: [group.label],
      values: { occurrences: group.occurrenceCount },
      sources: [sourceOf('quality', group.observationIds)],
    });
  }
  const followUp = dims.get('followUp');
  if ((followUp?.details.followUp?.overdue ?? 0) >= FOLLOWUP_OVERDUE_ATTENTION) {
    out.push({
      key: 'concern.overdueFollowUps',
      values: { overdue: followUp?.details.followUp?.overdue ?? 0 },
      sources: [sourceOf('followUp', current.evidence.followUps.recordIds)],
    });
  }
  const quality = dims.get('quality');
  if (quality?.status === 'DECLINING') {
    out.push({
      key: 'concern.qualityDeclining',
      values: { delta: quality.delta, current: quality.value, previous: quality.previousValue },
      sources: [sourceOf('quality', current.evidence.observations.recordIds)],
    });
  }
  const attendance = dims.get('attendance');
  if (attendance?.status === 'DECLINING' || attendance?.status === 'NEEDS_ATTENTION') {
    out.push({
      key: 'concern.attendance',
      values: { compliance: attendance.value ?? null, delta: attendance.delta },
      sources: [sourceOf('attendance', current.evidence.attendance?.recordIds ?? [])],
    });
  }
  if ((hr?.value ?? 0) >= 1) {
    out.push({
      key: 'concern.hrDeductions',
      values: { count: hr?.value ?? 0 },
      sources: [sourceOf('hr', [])],
    });
  }
  const output = dims.get('businessOutput');
  if (output?.status === 'DECLINING') {
    out.push({
      key: 'concern.dealsDeclining',
      values: { current: output.value, previous: output.previousValue },
      sources: [sourceOf('deals', current.evidence.deals.recordIds)],
    });
  }
  return out.slice(0, MAX_SIGNALS);
}

// ─────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────

export function buildHubAnalysis(input: HubAnalysisInput): HubAnalysis {
  const dims: HubDimension[] = [];
  const quality = qualityDimension(input.current, input.previous);
  const followUp = followUpDimension(input.current, input.previous);
  const risk = riskDimension(input.risk);
  const attendance = attendanceDimension(input.current, input.previous);
  const output = businessOutputDimension(input.current, input.previous);
  const hr = hrDimension(input.hr);
  const complaints = complaintsDimension(input.current, input.previous);
  const capa = capaDimension(input.current, input.previous);
  dims.push(quality, followUp);
  if (risk) dims.push(risk);
  dims.push(attendance, output);
  if (hr) dims.push(hr);
  dims.push(complaints, capa);

  const byKey = new Map(dims.map((d) => [d.key, d]));
  const changes = buildChanges(input);
  const crossSignals = buildCrossSignals(input, changes);
  const patterns = buildPatterns(input, dims);
  const concerns = buildConcerns(input, byKey);
  const strengths = buildStrengths(input, byKey);
  const areas = buildDevelopmentAreas(input, byKey);
  const recommendations = buildRecommendations(input, byKey, areas);
  const overview = buildOverview(dims, changes, strengths, concerns, input.risk.current?.level ?? null);

  return {
    dimensions: dims,
    overview,
    changes,
    crossSignals,
    patterns,
    strengths,
    developmentAreas: areas,
    recommendations,
  };
}
