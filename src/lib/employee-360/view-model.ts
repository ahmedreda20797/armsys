// ══════════════════════════════════════════════════════════════
//  Employee 360 — View-Model Assembler (rebuild)
//
//  PURE presentation-layer composition over CANONICAL services.
//  The page never calculates business truth; this module never
//  duplicates it either — every metric below is a projection of:
//
//    • getEmployeePerformanceDataset  (lib/performance-intelligence)
//      — KPI facts + components + trend, quality, complaints, CAPA,
//        follow-ups, deals (§DEAL-DATES dimensions), stored attendance.
//    • getHrEmployeeDecisionReport    (lib/hr-decision)
//      — deterministic decision support + the canonical risk engine
//        result, built over the SAME dataset instance.
//    • the organization tree          (lib/organization + employee-org)
//    • stored employee record         (field-level redaction by the caller)
//    • raw operational rows           (timeline + attention records only)
//
//  GATING RULES (unchanged from the original route):
//    • a denied section's block is null — data is withheld before
//      serialization, never merely hidden in React.
//    • decision-support factor lines and scorecard metrics whose
//      owning section is denied are dropped (the status itself stays).
//    • unknown ≠ zero: an unknown closure month, a missing stored
//      attendance result or a PENDING KPI component keeps its
//      explicit state.
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type {
  KpiComponentFact,
  KpiFacts,
  ScoreTrendFacts,
  ObservationAnalysisFacts,
  RepeatedIssuesFacts,
  QualityDeductionFacts,
  ComplaintFacts,
  CapaFacts,
  FollowUpFacts,
  TravelDealFacts,
  AttendanceContextFacts,
} from '@/lib/performance-intelligence/types';
import type {
  HrEmployeeDecisionReport,
  HrDecisionFactor,
  HrDimensionScorecardEntry,
} from '@/lib/hr-decision/types';
import { HR_FACTOR_SECTION_BY_CATEGORY } from '@/lib/permissions/employee360-access';
import type { Employee360SectionGate } from '@/lib/permissions/employee360-access';

// ─────────────────────────────────────────────────────────────
//  Shapes (fully serializable — the API response contract)
// ─────────────────────────────────────────────────────────────

/** The explicit reporting period every period-sensitive section shares. */
export interface Employee360Period {
  monthKey: string;
  /** How the KPI values are sourced for this month (MTD/LIVE/FINALIZED). */
  valueBasis: string;
  finalized: boolean;
  /** Dataset generation timestamp (freshness indicator). */
  generatedAt: string;
}

export interface Employee360Identity {
  id: string;
  name: string;
  code: string | null;
  /** Free-text display fields (never rewritten by org moves). */
  department: string | null;
  position: string | null;
  /** Canonical lifecycle vocabulary. */
  status: 'active' | 'inactive' | 'archived' | 'unknown';
  /** True when the engine deems the employee eligible for the period. */
  eligibleForPeriod: boolean;
  archivedButEligible: boolean;
  archivedAt: string | null;
  restoredAt: string | null;
  hireDate: string | null;
  /** Whole years since hireDate — display arithmetic, null when unknown. */
  tenureYears: number | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  /** Field-permission redaction is applied by the CALLER (route). */
  mobile: string | null;
  residence: string | null;
  orgNodeId: string | null;
}

/** One node on the root→employee chain of the canonical org tree. */
export interface Employee360OrgNodeRef {
  id: string;
  name: string;
  type: string;
}

export interface Employee360Organization {
  /** Root→self chain (company → … → the employee's node). */
  chain: Employee360OrgNodeRef[];
  department: string | null;
  team: string | null;
  /** Nearest manager from the canonical reporting line. */
  manager: { id: string; name: string } | null;
  /** Full reporting line (nearest first, capped by the caller). */
  reportingLine: Array<{ id: string; name: string }>;
}

/**
 * The executive summary's primary signals — each carries its own
 * explicit state so the UI never conflates no-data with zero or with
 * no-permission (the block itself is null when its section is denied).
 */
export interface Employee360ExecutiveSummary {
  overall: {
    state: 'value' | 'pending' | 'configuration_required' | 'not_eligible';
    /** Engine weighted total of the available set (null unless value). */
    weightedTotal: number | null;
    /** Σ weights of value-bearing components (100 when complete). */
    availableWeight: number | null;
    overallStatus: 'COMPLETE' | 'INCOMPLETE' | null;
    rowStatus: string;
    schemeName: string | null;
    /** Configured KPI baseline (kpiSettings.defaultScore). */
    targetScore: number | null;
  };
  qualityScore: {
    state: 'value' | 'pending';
    rawScore: number | null;
    weight: number | null;
  };
  closedDeals: {
    /** DEAL_CLOSED dimension (dealClosedAt) — deals CLOSED WITH THE
     *  EMPLOYEE during the period, ANY current status ("الصفقات
     *  المغلقة" — never the completion count). */
    count: number;
    /** Deals with an UNKNOWN deal-closure date (legacy) — never a zero. */
    unknownClosure: number;
    /** CLOSED dimension (closedAt) — deals COMPLETED during the
     *  period. A DIFFERENT metric, surfaced separately (§12). */
    completedInPeriod: number;
  };
  attendance: {
    state: 'available' | 'not_available';
    compliance: number | null;
  };
  followUps: {
    active: number;
    overdue: number;
    completionRate: number | null;
  };
  decisionStatus: {
    status: string;
    label: string;
  } | null;
}

/** One actionable attention row (drill-down target included). */
export interface Employee360AttentionItem {
  id: string;
  severity: 'critical' | 'urgent' | 'warning' | 'info';
  source: 'followUp' | 'capa' | 'complaint' | 'quality' | 'deals';
  title: string;
  detail: string | null;
  /** Server-resolved drill target (existing navigateTo contract). */
  drill: { page: string; highlightId?: string | null; params?: Record<string, string> } | null;
}

/** The full API payload. Every top block is null when its section is denied. */
export interface Employee360ViewModel {
  period: Employee360Period;
  /** Echo of the server-resolved section gate (client UX only —
   *  enforcement already happened; this hides nothing server-side). */
  sections: Employee360SectionGate;
  employee: Employee360Identity | null;
  organization: Employee360Organization | null;
  executiveSummary: Employee360ExecutiveSummary | null;
  /** Canonical KPI facts incl. the FULL component breakdown. */
  kpi: KpiFacts | null;
  trend: ScoreTrendFacts | null;
  deals: TravelDealFacts | null;
  quality: {
    score: Employee360ExecutiveSummary['qualityScore'];
    observations: ObservationAnalysisFacts;
    repeatedIssues: RepeatedIssuesFacts;
    deductions: QualityDeductionFacts;
  } | null;
  attendance: AttendanceContextFacts | null;
  followUps: FollowUpFacts | null;
  complaints: ComplaintFacts | null;
  capa: CapaFacts | null;
  hrDeductions: Employee360HrBlock | null;
  requests: Employee360RequestsBlock | null;
  /** Decision support — factor/scorecard lines filtered by domain gates. */
  decisionSupport: Employee360DecisionBlock | null;
  risk: {
    score: number;
    level: string;
  } | null;
  attention: Employee360AttentionItem[];
  timeline: Employee360TimelineEvent[];
  /** Last-90-day write activity per domain (no invented metrics). */
  activity: Record<string, { last90Days: number; lastEventAt: string | null }>;
}

export interface Employee360HrBlock {
  month: string;
  deductionCount: number;
  deductionDays: number;
  deductionAmount: number;
  statusCounts: Record<string, number>;
}

export interface Employee360RequestsBlock {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface Employee360DecisionBlock {
  status: HrEmployeeDecisionReport['executive']['status'];
  statusLabelAr: string;
  action: { actionKind: string; actionAr: string; rationaleAr: string; disclaimerAr: string };
  riskScore: number;
  riskLevel: string;
  momDeltaPoints: number | null;
  trendDirection: string | null;
  consecutiveKpiBelowTarget: number;
  factors: HrDecisionFactor[];
  scorecard: HrDimensionScorecardEntry[];
}

export interface Employee360TimelineEvent {
  type: string;
  date: string;
  title: string;
  description: string;
  status: string;
  priority?: string;
  user?: string;
  timestamp: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Inputs (raw shapes the route loads)
// ─────────────────────────────────────────────────────────────

export interface Employee360RawRecord {
  id: string;
  employeeId?: string | null;
  [key: string]: unknown;
}

export interface AssembleEmployee360Input {
  selectedMonth: string;
  now: Date;
  gate: Employee360SectionGate;
  /** Pre-redacted identity (field permissions applied by the caller). */
  employee: Employee360Identity | null;
  organization: Employee360Organization | null;
  dataset: EmployeePerformanceDataset | null;
  decision: HrEmployeeDecisionReport | null;
  /** The CONFIGURED KPI baseline (kpiSettings.defaultScore). */
  targetScore: number | null;
  /** The stored HR month summary for the selected period. */
  hrMonth: Employee360HrBlock | null;
  /** Requests dated inside the selected month (caller pre-filtered). */
  requestsOfMonth: Employee360RequestsBlock | null;
  /** The 'timeline' journal gate (resolveSectionAccess — route-computed). */
  timelineVisible: boolean;
  /** Raw rows for attention + timeline (already employee-scoped). */
  followUpRows: Employee360RawRecord[];
  complaintRows: Employee360RawRecord[];
  capaRows: Employee360RawRecord[];
  qualityDeductionRows: Employee360RawRecord[];
  hrDeductionRows: Employee360RawRecord[];
  requestRows: Employee360RawRecord[];
  dealRows: Employee360RawRecord[];
}

// ─────────────────────────────────────────────────────────────
//  Canonical predicates re-imported for attention composition.
//  These are the SAME helpers the risk center uses — no new rules.
// ─────────────────────────────────────────────────────────────
import { isOverdueFollowUp, isDueToday } from '@/lib/metrics/followUpMetrics';
import { isOverdueCAPA, isTerminalCAPA } from '@/lib/metrics';

function asDate(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Whole years between a stored hire date and `now` (display arithmetic only). */
export function tenureYearsOf(hireDate: string | null, now: Date): number | null {
  if (!hireDate) return null;
  let year: number, month: number, day: number;
  if (hireDate.includes('/')) {
    // The app's display date contract: DD/MM/YYYY.
    const [d, m, y] = hireDate.split('/').map((p) => Number(p));
    year = y; month = m; day = d;
  } else {
    // ISO shape: YYYY-MM-DD[THH…].
    year = Number(hireDate.slice(0, 4));
    month = Number(hireDate.slice(5, 7));
    day = Number(hireDate.slice(8, 10));
  }
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const hire = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(hire.getTime())) return null;
  const ms = now.getTime() - hire.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (365.2425 * 24 * 60 * 60 * 1000));
}

// ─────────────────────────────────────────────────────────────
//  Executive summary (period-labeled primary signals)
// ─────────────────────────────────────────────────────────────

function buildOverall(
  kpi: KpiFacts | null,
  targetScore: number | null,
): Employee360ExecutiveSummary['overall'] {
  if (!kpi) {
    return { state: 'configuration_required', weightedTotal: null, availableWeight: null, overallStatus: null, rowStatus: 'NO_SCHEME', schemeName: null, targetScore };
  }
  // §47 no-data ≠ zero: an EMPTY available set (no component carries a
  // value yet — e.g. a fresh month) sums to weightedTotal 0, which is
  // NOT a scored zero. Only a result with at least one value-bearing
  // component renders as a value.
  const hasValue =
    kpi.weightedTotal !== null
    && (kpi.availableWeight ?? 0) > 0
    && kpi.rowStatus !== 'PENDING';
  const configurationProblem =
    kpi.rowStatus === 'NO_SCHEME'
    || kpi.rowStatus === 'AMBIGUOUS'
    || kpi.rowStatus === 'OVERRIDE_NOT_RESOLVABLE';
  return {
    state: hasValue ? 'value'
      : kpi.outcomeStatus === 'NOT_ELIGIBLE_PERIOD' ? 'not_eligible'
      : configurationProblem ? 'configuration_required'
      : 'pending',
    weightedTotal: hasValue ? kpi.weightedTotal : null,
    availableWeight: kpi.availableWeight,
    overallStatus: kpi.overallStatus,
    rowStatus: kpi.rowStatus,
    schemeName: kpi.scheme?.schemeName ?? null,
    targetScore,
  };
}

function buildQualityScore(kpi: KpiFacts | null): Employee360ExecutiveSummary['qualityScore'] {
  const q = kpi?.quality ?? null;
  if (!q || q.rawScore === null) return { state: 'pending', rawScore: null, weight: null };
  return { state: 'value', rawScore: q.rawScore, weight: q.weight };
}

// ─────────────────────────────────────────────────────────────
//  Attention items — canonical flags + drill targets
// ─────────────────────────────────────────────────────────────

const FOLLOW_UP_LABELS: Record<string, string> = {
  open: 'مفتوحة', under_review: 'تحت المراجعة', under_follow_up: 'تحت المتابعة',
  resolved: 'تمت', closed: 'مغلقة', cancelled: 'ملغاة',
};

function followUpLabel(f: Employee360RawRecord): string {
  const s = typeof f.status === 'string' ? f.status : '';
  return FOLLOW_UP_LABELS[s] ?? s;
}

function buildAttention(args: {
  gate: Employee360SectionGate;
  selectedMonth: string;
  dataset: EmployeePerformanceDataset | null;
  followUpRows: Employee360RawRecord[];
  complaintRows: Employee360RawRecord[];
  capaRows: Employee360RawRecord[];
  qualityDeductionRows: Employee360RawRecord[];
  now: Date;
}): Employee360AttentionItem[] {
  const { gate, selectedMonth, dataset, followUpRows, complaintRows, capaRows, qualityDeductionRows, now } = args;
  const items: Employee360AttentionItem[] = [];

  if (gate.followUps) {
    // Overdue = canonical isOverdueFollowUp(now) over the employee's
    // ACTIVE follow-ups (the Risk Center's own predicate).
    const overdue = followUpRows
      .filter((f) => !(['closed', 'cancelled', 'resolved'] as string[]).includes(String(f.status ?? '')))
      .filter((f) => isOverdueFollowUp(f as never, now));
    for (const f of overdue.slice(0, 10)) {
      items.push({
        id: `fu-overdue-${f.id}`,
        severity: String(f.priorityLevel) === 'critical' ? 'critical' : 'urgent',
        source: 'followUp',
        title: `متابعة متأخرة — ${String(f.subject ?? f.followUpType ?? '')}`,
        detail: `الحالة: ${followUpLabel(f)}${f.nextFollowUpDate ? ` · الاستحقاق: ${String(f.nextFollowUpDate)}` : ''}`,
        drill: { page: 'followUps', highlightId: String(f.id), params: { employeeId: String(f.employeeId ?? '') } },
      });
    }
    const dueToday = followUpRows
      .filter((f) => !(['closed', 'cancelled', 'resolved'] as string[]).includes(String(f.status ?? '')))
      .filter((f) => isDueToday(f as never, now));
    for (const f of dueToday.slice(0, 5)) {
      items.push({
        id: `fu-today-${f.id}`,
        severity: 'warning',
        source: 'followUp',
        title: `متابعة مستحقة اليوم — ${String(f.subject ?? f.followUpType ?? '')}`,
        detail: `الحالة: ${followUpLabel(f)}`,
        drill: { page: 'followUps', highlightId: String(f.id), params: { employeeId: String(f.employeeId ?? '') } },
      });
    }
  }

  if (gate.capa) {
    const overdueCapa = capaRows.filter((c) => isOverdueCAPA(c as never, now) && !isTerminalCAPA(c as never));
    for (const c of overdueCapa.slice(0, 10)) {
      items.push({
        id: `capa-overdue-${c.id}`,
        severity: String(c.priority) === 'critical' ? 'critical' : 'urgent',
        source: 'capa',
        title: `CAPA متأخرة — ${String(c.title ?? c.capaId ?? c.id)}`,
        detail: `الأولوية: ${String(c.priority ?? '')}`,
        drill: { page: 'capa', highlightId: String(c.id), params: { employeeId: String(c.employeeId ?? '') } },
      });
    }
  }

  if (gate.complaints) {
    const open = complaintRows.filter((c) =>
      ['open', 'under_investigation', 'pending_resolution'].includes(String(c.status ?? '')));
    for (const c of open.slice(0, 5)) {
      items.push({
        id: `complaint-open-${c.id}`,
        severity: String(c.severity) === 'critical' ? 'critical' : 'warning',
        source: 'complaint',
        title: `شكوى مفتوحة — ${String(c.complaintType ?? '')}`,
        detail: null,
        drill: { page: 'complaints', highlightId: String(c.id), params: { employeeId: String(c.employeeId ?? '') } },
      });
    }
  }

  if (gate.quality && dataset) {
    // Repeated issues within the period (deterministic grouping from
    // the dataset — min occurrences 2).
    for (const g of dataset.quality.repeatedIssues.byCategory.slice(0, 3)) {
      items.push({
        id: `quality-repeat-${g.issueKey}`,
        severity: 'info',
        source: 'quality',
        title: `مشكلة متكررة — ${g.label}`,
        detail: `تكررت ${g.occurrenceCount} مرات خلال الفترة`,
        drill: { page: 'observations', params: { employeeId: dataset.employee.employeeId, month: selectedMonth } },
      });
    }
  }

  if (gate.deals && dataset && dataset.deals.closedUnknownMonth > 0) {
    items.push({
      id: 'deals-unknown-closure',
      severity: 'info',
      source: 'deals',
      title: `${dataset.deals.closedUnknownMonth} صفقة مكتملة بتاريخ إغلاق غير معروف`,
      detail: 'صفقات أرشيفية اكتملت قبل تسجيل تاريخ الإغلاق — لا تُنسب لأي شهر',
      drill: { page: 'travel', params: { employeeId: dataset.employee.employeeId } },
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────
//  Timeline — raw event projection (gated by owning section)
// ─────────────────────────────────────────────────────────────

const TIMELINE_SECTION_BY_TYPE: Record<string, keyof Employee360SectionGate> = {
  quality: 'quality',
  hrDeduction: 'hrDeductions',
  request: 'requests',
  followUp: 'followUps',
  complaint: 'complaints',
  travel: 'travel',
  capa: 'capa',
  dealClosed: 'deals',
};

function buildTimeline(args: {
  gate: Employee360SectionGate;
  /** The 'timeline' journal gate (resolveSectionAccess — route-computed). */
  timelineVisible: boolean;
  followUpRows: Employee360RawRecord[];
  complaintRows: Employee360RawRecord[];
  capaRows: Employee360RawRecord[];
  qualityDeductionRows: Employee360RawRecord[];
  hrDeductionRows: Employee360RawRecord[];
  requestRows: Employee360RawRecord[];
  dealRows: Employee360RawRecord[];
}): Employee360TimelineEvent[] {
  const { gate, timelineVisible } = args;
  const events: Employee360TimelineEvent[] = [];

  const push = (event: Employee360TimelineEvent) => {
    const owner = TIMELINE_SECTION_BY_TYPE[event.type];
    if (owner && !gate[owner]) return;
    if (!owner && !timelineVisible) return;
    events.push(event);
  };

  for (const f of args.followUpRows) {
    push({
      type: 'followUp',
      date: asDate(f.date) ?? '',
      title: `متابعة: ${String(f.followUpType ?? '')}`,
      description: String(f.subject ?? ''),
      status: String(f.status ?? ''),
      priority: typeof f.priorityLevel === 'string' ? f.priorityLevel : undefined,
      timestamp: asDate(f.createdAt),
    });
  }
  for (const q of args.qualityDeductionRows) {
    push({
      type: 'quality',
      date: asDate(q.date) ?? '',
      title: `خصم جودة: ${String(q.type ?? '')}`,
      description: String(q.description ?? ''),
      status: 'deduction',
      timestamp: asDate(q.createdAt),
    });
  }
  for (const h of args.hrDeductionRows) {
    push({
      type: 'hrDeduction',
      date: asDate(h.deductionDate) ?? asDate(h.createdAt) ?? '',
      title: `خصم HR: ${String(h.type ?? '')}`,
      description: String(h.reason ?? ''),
      status: String(h.status ?? ''),
      timestamp: asDate(h.createdAt),
    });
  }
  for (const r of args.requestRows) {
    push({
      type: 'request',
      date: asDate(r.date) ?? '',
      title: `طلب: ${String(r.type ?? '')}`,
      description: String(r.reason ?? ''),
      status: String(r.status ?? ''),
      timestamp: asDate(r.createdAt),
    });
  }
  for (const c of args.complaintRows) {
    push({
      type: 'complaint',
      date: (asDate(c.createdAt) ?? '').split('T')[0],
      title: `شكوى: ${String(c.complaintType ?? '')}`,
      description: String(c.description ?? ''),
      status: String(c.status ?? ''),
      timestamp: asDate(c.createdAt),
    });
  }
  for (const t of args.dealRows) {
    push({
      type: 'travel',
      date: asDate(t.departureDate) ?? '',
      title: `سفر: ${String(t.destination ?? '')}`,
      description: '',
      status: String(t.status ?? ''),
      timestamp: asDate(t.createdAt),
    });
  }
  for (const capa of args.capaRows) {
    push({
      type: 'capa',
      date: (asDate(capa.createdAt) ?? '').split('T')[0],
      title: `CAPA: ${String(capa.capaId ?? capa.title ?? '')}`,
      description: `تم إنشاء حالة ${String(capa.title ?? '')} — الأولوية: ${String(capa.priority ?? '')}`,
      status: 'created',
      priority: typeof capa.priority === 'string' ? capa.priority : undefined,
      timestamp: asDate(capa.createdAt),
    });
    const capaTimeline = Array.isArray(capa.timeline) ? capa.timeline as Employee360RawRecord[] : [];
    for (const evt of capaTimeline) {
      push({
        type: 'capa',
        date: (asDate(evt.timestamp) ?? '').split('T')[0],
        title: `CAPA ${String(capa.capaId ?? '')}: ${String(evt.action ?? '')}`,
        description: String(evt.description ?? ''),
        status: String(evt.action ?? 'updated').toLowerCase(),
        user: String(evt.performedByName ?? evt.performedBy ?? ''),
        timestamp: asDate(evt.timestamp),
      });
    }
  }

  events.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return events;
}

// ─────────────────────────────────────────────────────────────
//  Decision support — domain-gated projection
// ─────────────────────────────────────────────────────────────

function filterFactorsByGate(
  factors: ReadonlyArray<HrDecisionFactor>,
  gate: Employee360SectionGate,
): HrDecisionFactor[] {
  return factors.filter((f) => {
    const owner = HR_FACTOR_SECTION_BY_CATEGORY[f.category];
    return !owner || gate[owner];
  });
}

function filterScorecardByGate(
  entries: ReadonlyArray<HrDimensionScorecardEntry>,
  gate: Employee360SectionGate,
): HrDimensionScorecardEntry[] {
  return entries.filter((e) => {
    const owner = HR_FACTOR_SECTION_BY_CATEGORY[e.category];
    return !owner || gate[owner];
  });
}

// ─────────────────────────────────────────────────────────────
//  The assembler
// ─────────────────────────────────────────────────────────────

export function assembleEmployee360Profile(input: AssembleEmployee360Input): Employee360ViewModel {
  const { gate, dataset, decision, now } = input;
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const activityOf = (rows: Employee360RawRecord[], field = 'createdAt') => {
    const recent = rows.filter((r) => String(r[field] ?? '') >= ninetyDaysAgo);
    const latest = rows.reduce((acc, r) => {
      const v = String(r[field] ?? '');
      return v > acc ? v : acc;
    }, '');
    return { last90Days: recent.length, lastEventAt: latest || null };
  };

  const period: Employee360Period = dataset
    ? {
        monthKey: dataset.period.monthKey,
        valueBasis: dataset.period.valueBasis,
        finalized: dataset.period.finalized,
        generatedAt: dataset.generatedAt,
      }
    : {
        monthKey: input.selectedMonth,
        valueBasis: 'UNKNOWN',
        finalized: false,
        generatedAt: now.toISOString(),
      };

  // ── Executive summary (period signals) ──
  const executiveSummary: Employee360ExecutiveSummary | null = gate.performance
    ? {
        overall: buildOverall(dataset?.kpi ?? null, input.targetScore),
        qualityScore: buildQualityScore(dataset?.kpi ?? null),
        closedDeals: {
          // §DEAL-DATES — "الصفقات المغلقة" = closed WITH the employee
          // (dealClosedAt) during the period, any current status.
          count: dataset?.deals.closedWithEmployeeInPeriod ?? 0,
          unknownClosure: dataset?.deals.closedWithEmployeeUnknownMonth ?? 0,
          // §12 — completion-period count (closedAt) never merges with it.
          completedInPeriod: dataset?.deals.closedTotal ?? 0,
        },
        attendance: dataset?.attendance
          ? {
              state: dataset.attendance.status === 'AVAILABLE' ? ('available' as const) : ('not_available' as const),
              compliance: dataset.attendance.result?.compliance ?? null,
            }
          : { state: 'not_available' as const, compliance: null },
        followUps: dataset
          ? {
              active: dataset.followUps.active,
              overdue: dataset.followUps.overdue,
              completionRate: dataset.followUps.completionRate,
            }
          : { active: 0, overdue: 0, completionRate: null },
        decisionStatus: decision
          ? { status: decision.executive.status, label: decision.executive.statusLabelAr }
          : null,
      }
    : null;

  // ── Decision support (domain-gated factors/scorecard) ──
  const decisionSupport: Employee360DecisionBlock | null =
    gate.decisionSupport && decision
      ? {
          status: decision.executive.status,
          statusLabelAr: decision.executive.statusLabelAr,
          action: {
            actionKind: decision.action.actionKind,
            actionAr: decision.action.actionAr,
            rationaleAr: decision.action.rationaleAr,
            disclaimerAr: decision.action.disclaimerAr,
          },
          riskScore: decision.executive.riskScore,
          riskLevel: decision.executive.riskLevel,
          momDeltaPoints: decision.trend?.momDeltaPoints ?? null,
          trendDirection: decision.trend?.direction ?? null,
          consecutiveKpiBelowTarget: decision.trend?.consecutiveBelowTarget ?? 0,
          factors: filterFactorsByGate(decision.factors, gate),
          scorecard: filterScorecardByGate(decision.scorecard, gate),
        }
      : null;

  // Canonical risk engine result (same numbers the decision report used).
  const risk = gate.risk && decision
    ? { score: decision.executive.riskScore, level: decision.executive.riskLevel }
    : null;

  const attention = gate.risk
    ? buildAttention({
        gate,
        selectedMonth: input.selectedMonth,
        dataset,
        followUpRows: input.followUpRows,
        complaintRows: input.complaintRows,
        capaRows: input.capaRows,
        qualityDeductionRows: input.qualityDeductionRows,
        now,
      })
    : [];

  // ── Quality block: observations obey the OBSERVATIONS gate ──
  const quality = gate.quality && dataset
    ? {
        score: buildQualityScore(dataset.kpi),
        observations: gate.observations
          ? dataset.quality.observations
          : { total: 0, approved: 0, pending: 0, rejected: 0, byResolutionStatus: {}, bySeverity: {} as ObservationAnalysisFacts['bySeverity'], byCategory: [], monthly: [] },
        repeatedIssues: gate.observations
          ? dataset.quality.repeatedIssues
          : { groupBasis: dataset.quality.repeatedIssues.groupBasis, minOccurrences: dataset.quality.repeatedIssues.minOccurrences, byCategory: [], byType: [], windowByCategory: [] },
        deductions: dataset.quality.deductions,
      }
    : null;

  return {
    period,
    sections: gate,
    employee: input.employee,
    organization: gate.organization ? input.organization : null,
    executiveSummary,
    kpi: gate.performance ? dataset?.kpi ?? null : null,
    trend: gate.performance ? dataset?.trend ?? null : null,
    deals: gate.deals ? dataset?.deals ?? null : null,
    quality,
    attendance: gate.attendance ? dataset?.attendance ?? null : null,
    followUps: gate.followUps ? dataset?.followUps ?? null : null,
    complaints: gate.complaints ? dataset?.complaints ?? null : null,
    capa: gate.capa ? dataset?.capa ?? null : null,
    hrDeductions: gate.hrDeductions ? input.hrMonth : null,
    requests: gate.requests ? input.requestsOfMonth : null,
    decisionSupport,
    risk,
    attention,
    timeline: buildTimeline({
      gate,
      timelineVisible: input.timelineVisible,
      followUpRows: input.followUpRows,
      complaintRows: input.complaintRows,
      capaRows: input.capaRows,
      qualityDeductionRows: input.qualityDeductionRows,
      hrDeductionRows: input.hrDeductionRows,
      requestRows: input.requestRows,
      dealRows: input.dealRows,
    }),
    activity: {
      followUps: activityOf(input.followUpRows),
      qualityDeductions: activityOf(input.qualityDeductionRows),
      hrDeductions: activityOf(input.hrDeductionRows),
      complaints: activityOf(input.complaintRows),
      capa: activityOf(input.capaRows),
      requests: activityOf(input.requestRows),
      travel: activityOf(input.dealRows),
    },
  };
}
