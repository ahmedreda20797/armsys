// ══════════════════════════════════════════════════════════════
//  §QUALITY-INTELLIGENCE — the deterministic analytical layer of
//  the Smart Quality Report (Employee Quality & Performance
//  Intelligence Report).
//
//  POSITION IN THE PIPELINE (spec §32):
//    canonical data → permission+scope (route) → canonical domain
//    calculations (performance-intelligence + hr-decision) →
//    THIS MODULE (structured intelligence facts) → view-model
//    localization → report UI → optional AI narrative.
//
//  HARD RULES:
//    • NO new metric sources. Every number is read VERBATIM from the
//      canonical EmployeePerformanceDataset and the canonical
//      HR-decision report (the risk engine's own result).
//    • Every derived ratio carries an explicit denominator rule and
//      is null when the denominator is 0 — never a fabricated %.
//    • Period comparison (previous month) comes ONLY from the
//      dataset's own monthly series (months without data stay
//      null — never zero-filled).
//    • Patterns/attention are FACTS with rule ids, not judgments.
//      Thresholds are canonical (the engine's repetition threshold,
//      the shared overdue predicates, severity vocabulary) — no
//      arbitrary business numbers are invented here.
//    • LOCALE-FREE: everything textual is a stable code + typed
//      values; the view-model renders AR/EN sentences from codes.
//      A number can only enter a sentence through its typed slot,
//      so no narrative can contain a value absent from the data.
//    • PURE and CLIENT-SAFE: dataset/decision types are imported
//      TYPE-ONLY — directly unit-testable under node:test.
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset, MonthlyCount } from '@/lib/performance-intelligence/types';
import type { HrEmployeeDecisionReport } from '@/lib/hr-decision/types';

// ─────────────────────────────────────────────────────────────
//  Input
// ─────────────────────────────────────────────────────────────

/** Permission-gated HR-deductions block (null = section withheld). */
export interface HrDeductionsIntelInput {
  month: string;
  count: number;
  deductionDays: number;
  deductionAmount: number;
  statusCounts: Record<string, number>;
}

export interface QualityIntelligenceInput {
  dataset: EmployeePerformanceDataset;
  /** Canonical risk-engine result (null = decision section withheld). */
  decision: HrEmployeeDecisionReport | null;
  /** HR-deductions facts (null = viewer lacks the hrDeductions section). */
  hrDeductions: HrDeductionsIntelInput | null;
  /** The month BEFORE the reported period (for series comparisons). */
  previousMonthKey: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Executive summary (§4)
// ─────────────────────────────────────────────────────────────

export type ExecutiveScoreState =
  | 'value'              // overall KPI carries a real weighted total
  | 'incomplete'         // scheme exists; configured components lack values
  | 'pending'            // period not scored yet (no evidence either way)
  | 'configuration_required' // NO_SCHEME / AMBIGUOUS / OVERRIDE_NOT_RESOLVABLE
  | 'not_eligible';      // engine says the employee is not eligible

export interface ExecutiveSummaryFacts {
  scoreState: ExecutiveScoreState;
  /** Overall KPI weighted total (engine output, verbatim). */
  performanceScore: number | null;
  /** Raw quality component score (engine output, verbatim). */
  qualityScore: number | null;
  /** MoM delta in percentage points (engine output, verbatim). */
  deltaPoints: number | null;
  previousScore: number | null;
  trendDirection: 'UP' | 'DOWN' | 'STABLE' | null;
  /** Components of the configured scheme with NO value this period. */
  missingComponents: Array<{ componentId: string; name: string; weight: number }>;
  availableWeight: number | null;
  rowStatus: string;
  /** Canonical risk-engine result (null when the section is withheld). */
  riskScore: number | null;
  riskLevel: string | null;
  decisionStatus: string | null;
  /** §3 EXECUTIVE HEADER — Closed During Period (DEAL_CLOSED dimension,
   *  dealClosedAt, ANY current status — historical closures survive
   *  cancellation). */
  closedDuringPeriod: number;
  /** §3 EXECUTIVE HEADER — Current Deals (upcoming + in_progress,
   *  current-status snapshot — NEVER a date-dimension count). */
  currentDeals: number;
  period: string;
  valueBasis: string;
  finalized: boolean;
}

function executiveScoreState(dataset: EmployeePerformanceDataset): ExecutiveScoreState {
  const { kpi } = dataset;
  // Engine verdict first: an INCOMPLETE row status means configured
  // components lack values — the partial available-weight total is
  // shown (labeled) in the KPI table but is NEVER presented as the
  // overall performance score (spec §4: no fabricated headline).
  if (kpi.rowStatus === 'NOT_ELIGIBLE') return 'not_eligible';
  if (kpi.rowStatus === 'NO_SCHEME' || kpi.rowStatus === 'AMBIGUOUS' || kpi.rowStatus === 'OVERRIDE_NOT_RESOLVABLE') {
    return 'configuration_required';
  }
  if (kpi.rowStatus === 'INCOMPLETE') return 'incomplete';
  if (kpi.rowStatus === 'AVAILABLE' || kpi.rowStatus === 'FINALIZED') {
    return kpi.weightedTotal !== null ? 'value' : 'pending';
  }
  return 'pending';
}

// ─────────────────────────────────────────────────────────────
//  KPI intelligence (§5) — the FULL engine component breakdown
// ─────────────────────────────────────────────────────────────

export interface KpiComponentIntel {
  componentId: string;
  name: string;
  weight: number;
  status: string;
  /** Raw 0–100 component score (null = no value — never 0-filled). */
  actual: number | null;
  contribution: number | null;
  maxContribution: number;
  hasValue: boolean;
}

export interface KpiIntel {
  components: KpiComponentIntel[];
  /** Names of configured components without a value this period. */
  missingComponentNames: string[];
  configurationComplete: boolean;
  rowStatus: string;
  overallStatus: string | null;
  weightedTotal: number | null;
  availableWeight: number | null;
  schemeLabel: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Quality intelligence (§6/§7/§8) — concentration + comparison
// ─────────────────────────────────────────────────────────────

export interface IssueConcentrationRow {
  categoryId: string | null;
  categoryName: string;
  count: number;
  /** count ÷ period observations × 100 — null when total = 0. */
  share: number | null;
}

export interface QualityIntel {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  /** Distinct issue categories actually recorded this period. */
  issueCategoryCount: number;
  /** Category table sorted by count desc, each with its share. */
  concentration: IssueConcentrationRow[];
  /** The most frequent category (null when no observations). */
  topIssue: IssueConcentrationRow | null;
  /** The most severe category present (critical > high > …, by count). */
  highImpactCount: number;
  repeatedGroupCount: number;
  /** Previous-month observation total from the dataset's own monthly
   *  series (null when that month has no data — never zero-filled). */
  previousTotal: number | null;
  monthly: MonthlyCount[];
}

// ─────────────────────────────────────────────────────────────
//  Domain intelligences (§9-§15/§17/§18)
// ─────────────────────────────────────────────────────────────

export interface DeductionsIntel {
  count: number;
  totalDays: number;
  totalAmount: number;
  typeCount: number;
  /** Most frequent deduction type (null when none). */
  topType: { name: string; count: number } | null;
  /** Highest single deduction by days then amount (null when none). */
  highest: { days: number; amount: number; date: string | null } | null;
}

export interface FollowUpsIntel {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  dueToday: number;
  /** completed ÷ total × 100 — null when total = 0. */
  completionRate: number | null;
  /**
   * On-time completion is NOT COMPUTABLE from the canonical model:
   * follow-ups carry no completion timestamp (§35 honesty rule).
   * Always null — the report renders the explicit unavailable state.
   */
  onTimeRate: null;
}

export interface ComplaintsIntel {
  total: number;
  stillOpen: number;
  resolvedOrClosed: number;
  avgResolutionDays: number | null;
  previousTotal: number | null;
}

export interface CapaIntel {
  total: number;
  active: number;
  terminal: number;
  overdue: number;
  closedCount: number;
  previousTotal: number | null;
}

export interface DealsIntel {
  /** DEAL_CLOSED dimension (dealClosedAt) — closed WITH the employee in the period, any status. */
  closedWithEmployeeInPeriod: number;
  closedWithEmployeeTotal: number;
  /**
   * §CLOSURE-BREAKDOWN — the period closure population split by
   * CURRENT status. confirmed + cancelled + stillActive reconciles
   * exactly with closedWithEmployeeInPeriod (a September closure that
   * was later cancelled remains a September closure AND a cancelled
   * closure — both numbers, one deal).
   */
  confirmedClosures: number;
  cancelledClosures: number;
  stillActiveClosures: number;
  /** CLOSED dimension (closedAt) — completions in the period. */
  completedInPeriod: number;
  /** TRAVEL dimension (departureDate) — departures in the period. */
  travelInPeriod: number;
  canceledInPeriod: number;
  currentCanceledAllTime: number;
  /**
   * §27 CURRENT DEALS — deals that currently exist and are not in a
   * terminal state (upcoming + in_progress, all-time snapshot). A
   * status-snapshot metric: NEVER derived from closedAt/dealClosedAt.
   */
  currentDeals: number;
  /** Current-deals breakdown by the live status vocabulary. */
  currentDealsByStatus: { upcoming: number; in_progress: number };
}

export interface AttendanceIntel {
  available: boolean;
  compliance: number | null;
  lateDays: number | null;
  absentDays: number | null;
}

// ─────────────────────────────────────────────────────────────
//  Patterns (§20) — deterministic, rule-id'd, canonical thresholds
// ─────────────────────────────────────────────────────────────

export type PatternCode =
  | 'REPEATED_ISSUE'
  | 'IMPROVING_TREND'
  | 'DECLINING_TREND'
  | 'STABLE_TREND'
  | 'INSUFFICIENT_TREND_DATA'
  | 'FOLLOW_UP_RISK'
  | 'COMPLAINT_RISK'
  | 'CAPA_RISK'
  | 'HIGH_SEVERITY_QUALITY'
  | 'KPI_CONFIGURATION_WARNING'
  | 'DATA_QUALITY_WARNING';

export type PatternSeverity = 'info' | 'warning' | 'critical';

export interface PatternFact {
  code: PatternCode;
  severity: PatternSeverity;
  /** Canonical rule/threshold basis (test-pinned, never arbitrary). */
  ruleId: string;
  /** Typed values for the localized sentence slots. */
  values: Record<string, number | string | null>;
}

/**
 * THE deterministic pattern rules. Threshold provenance:
 *   • REPEATED_ISSUE      — the engine's own repetition grouping
 *                           (repeatedIssues.minOccurrences, configured).
 *   • IMPROVING/DECLINING — the canonical KPI engine's own MoM delta
 *                           direction (trend.direction).
 *   • FOLLOW_UP_RISK      — the shared isOverdueFollowUp predicate
 *                           already used by Risk Center / Employee360.
 *   • COMPLAINT_RISK      — the canonical open-complaint predicate.
 *   • CAPA_RISK           — the canonical isOverdueCAPA predicate count.
 *   • HIGH_SEVERITY       — the stored severity vocabulary (high/critical).
 *   • KPI_CONFIGURATION_WARNING — the engine's own row status.
 *   • DATA_QUALITY_WARNING — the dataset's own unattributed/notes.
 */
export function detectPatterns(input: QualityIntelligenceInput): PatternFact[] {
  const { dataset, decision } = input;
  const patterns: PatternFact[] = [];

  // Repeated issues — the engine's configured threshold.
  const topRepeated = dataset.quality.repeatedIssues.byCategory[0]
    ?? dataset.quality.repeatedIssues.byType[0]
    ?? null;
  if (topRepeated) {
    patterns.push({
      code: 'REPEATED_ISSUE',
      severity: 'warning',
      ruleId: `repeated_issues.min_occurrences_${dataset.quality.repeatedIssues.minOccurrences}`,
      values: {
        label: topRepeated.label,
        count: topRepeated.occurrenceCount,
        threshold: dataset.quality.repeatedIssues.minOccurrences,
      },
    });
  }

  // Trend — the canonical engine's own direction/delta.
  const mom = dataset.trend.mom;
  if (dataset.trend.direction && mom) {
    const code: PatternCode =
      dataset.trend.direction === 'UP' ? 'IMPROVING_TREND'
        : dataset.trend.direction === 'DOWN' ? 'DECLINING_TREND'
          : 'STABLE_TREND';
    patterns.push({
      code,
      severity: code === 'DECLINING_TREND' ? 'warning' : 'info',
      ruleId: 'kpi_engine.mom_delta_direction',
      values: { delta: mom.deltaPoints, previousMonth: mom.previousMonth },
    });
  } else {
    patterns.push({
      code: 'INSUFFICIENT_TREND_DATA',
      severity: 'info',
      ruleId: 'trend.mom_null',
      values: {},
    });
  }

  // Open operational risks — shared canonical predicates.
  if (dataset.followUps.overdue > 0) {
    patterns.push({
      code: 'FOLLOW_UP_RISK',
      severity: 'warning',
      ruleId: 'followUps.overdue_gt_0',
      values: { count: dataset.followUps.overdue },
    });
  }
  const openComplaints = dataset.complaints.stillOpen;
  if (openComplaints > 0) {
    patterns.push({
      code: 'COMPLAINT_RISK',
      severity: 'warning',
      ruleId: 'complaints.open_gt_0',
      values: { count: openComplaints },
    });
  }
  if (dataset.capa.overdue > 0) {
    patterns.push({
      code: 'CAPA_RISK',
      severity: 'warning',
      ruleId: 'capa.overdue_gt_0',
      values: { count: dataset.capa.overdue },
    });
  }

  // High-severity quality evidence (stored severity vocabulary).
  const bySeverity = dataset.quality.observations.bySeverity;
  const highSeverity = (bySeverity.high ?? 0) + (bySeverity.critical ?? 0);
  if (highSeverity > 0) {
    patterns.push({
      code: 'HIGH_SEVERITY_QUALITY',
      severity: highSeverity >= 3 ? 'critical' : 'warning',
      ruleId: 'quality.severity_high_critical_gt_0',
      values: { count: highSeverity },
    });
  }

  // KPI configuration — the engine's own verdict.
  const state = executiveScoreState(dataset);
  if (state === 'incomplete' || state === 'configuration_required') {
    patterns.push({
      code: 'KPI_CONFIGURATION_WARNING',
      severity: 'warning',
      ruleId: `kpi.row_status_${dataset.kpi.rowStatus}`,
      values: {
        missingCount: missingComponentsOf(dataset).length,
        rowStatus: dataset.kpi.rowStatus,
      },
    });
  }

  // Data quality — the dataset's own accounting.
  const unattributed = dataset.dataQuality.unattributedRecords.reduce((s, u) => s + u.count, 0);
  if (unattributed > 0 || dataset.dataQuality.notes.length > 0) {
    patterns.push({
      code: 'DATA_QUALITY_WARNING',
      severity: 'info',
      ruleId: 'dataset.data_quality',
      values: { unattributed, notes: dataset.dataQuality.notes.length },
    });
  }

  void decision;
  return patterns;
}

// ─────────────────────────────────────────────────────────────
//  Management attention (§16) — WHAT/WHY/COUNT/SOURCE per item
// ─────────────────────────────────────────────────────────────

export type AttentionCode =
  | 'ATT_KPI_INCOMPLETE'
  | 'ATT_OVERDUE_FOLLOWUPS'
  | 'ATT_OVERDUE_CAPA'
  | 'ATT_OPEN_COMPLAINTS'
  | 'ATT_REPEATED_ISSUES'
  | 'ATT_DECLINING_TREND'
  | 'ATT_HIGH_SEVERITY'
  | 'ATT_DATA_QUALITY'
  | 'ATT_DECISION_FACTOR';

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export interface AttentionItemFact {
  id: string;
  code: AttentionCode;
  severity: AttentionSeverity;
  /** Canonical rule/domain that produced the item. */
  source: string;
  /** Typed sentence slots (numbers + labels only — localized later). */
  values: Record<string, number | string | null>;
  /** Honest drill target: an existing page, never a fake record link. */
  drillPage: string | null;
}

// Decision-factor categories -> the existing page that owns the
// underlying records (canonical category union: KPI | FOLLOW_UP |
// PRODUCTIVITY | QUALITY | ATTENDANCE | HR_DISCIPLINARY | TREND).
// Section enforcement is the canonical HR_FACTOR_SECTION_BY_CATEGORY
// (permissions/employee360-access), applied server-side upstream;
// this map only names the navigation target page for the drill.
const CATEGORY_DRAIN_PAGE: Record<string, string> = {
  KPI: 'kpiReports',
  TREND: 'kpiReports',
  FOLLOW_UP: 'followUps',
  PRODUCTIVITY: 'travel',
  QUALITY: 'observations',
  ATTENDANCE: 'attendance',
  HR_DISCIPLINARY: 'hrDeductions',
};

/**
 * THE attention rules. Signals (a)-(d) mirror the Employee360
 * attention builder and Risk Center predicates 1:1; (e)-(f) are the
 * dataset's own configuration/data-quality verdicts; (g) projects the
 * canonical HR-decision engine's negative factors (rule-pinned,
 * threshold-basis documented per factor, section-gated upstream).
 */
export function buildManagementAttention(input: QualityIntelligenceInput): AttentionItemFact[] {
  const { dataset, decision } = input;
  const items: AttentionItemFact[] = [];

  // (a) KPI configuration
  const state = executiveScoreState(dataset);
  if (state === 'incomplete' || state === 'configuration_required') {
    const missing = missingComponentsOf(dataset);
    items.push({
      id: 'att-kpi-incomplete',
      code: 'ATT_KPI_INCOMPLETE',
      severity: 'warning',
      source: `kpi.row_status_${dataset.kpi.rowStatus}`,
      values: { rowStatus: dataset.kpi.rowStatus, missing: missing.map((m) => m.name).join(', ') },
      drillPage: null,
    });
  }

  // (b) Overdue follow-ups (canonical isOverdueFollowUp — server-counted).
  if (dataset.followUps.overdue > 0) {
    items.push({
      id: 'att-overdue-followups',
      code: 'ATT_OVERDUE_FOLLOWUPS',
      severity: dataset.followUps.overdue >= 3 ? 'critical' : 'warning',
      source: 'followUpMetrics.isOverdueFollowUp',
      values: { count: dataset.followUps.overdue, dueToday: dataset.followUps.dueToday },
      drillPage: 'followUps',
    });
  }

  // (c) Overdue CAPA (canonical isOverdueCAPA count).
  if (dataset.capa.overdue > 0) {
    items.push({
      id: 'att-overdue-capa',
      code: 'ATT_OVERDUE_CAPA',
      severity: 'warning',
      source: 'capaMetrics.isOverdueCAPA',
      values: { count: dataset.capa.overdue, avgOverdueDays: dataset.capa.avgOverdueDays },
      drillPage: 'capa',
    });
  }

  // (d) Open complaints (canonical open predicate).
  if (dataset.complaints.stillOpen > 0) {
    items.push({
      id: 'att-open-complaints',
      code: 'ATT_OPEN_COMPLAINTS',
      severity: 'warning',
      source: 'complaint-status.isOpenComplaintStatus',
      values: { count: dataset.complaints.stillOpen },
      drillPage: 'complaints',
    });
  }

  // (e) Repeated quality issues (engine threshold).
  const repeated = dataset.quality.repeatedIssues.byCategory;
  if (repeated.length > 0) {
    items.push({
      id: 'att-repeated-issues',
      code: 'ATT_REPEATED_ISSUES',
      severity: 'warning',
      source: `repeated_issues.min_occurrences_${dataset.quality.repeatedIssues.minOccurrences}`,
      values: { groups: repeated.length, topLabel: repeated[0].label, topCount: repeated[0].occurrenceCount },
      drillPage: 'observations',
    });
  }

  // (f) Declining trend (canonical engine direction).
  if (dataset.trend.direction === 'DOWN' && dataset.trend.mom) {
    items.push({
      id: 'att-declining-trend',
      code: 'ATT_DECLINING_TREND',
      severity: 'warning',
      source: 'kpi_engine.mom_delta_direction',
      values: { delta: dataset.trend.mom.deltaPoints },
      drillPage: null,
    });
  }

  // (g) Canonical decision-engine concerns (negative factors), already
  //     section-gated by the route. Each factor carries its own rule id.
  if (decision) {
    for (const factor of decision.concerns) {
      items.push({
        id: `att-factor-${factor.ruleId}`,
        code: 'ATT_DECISION_FACTOR',
        severity: factor.severity === 'HIGH' ? 'warning' : 'info',
        source: factor.ruleId,
        values: {
          signal: factor.signalAr,
          value: factor.value,
          unit: factor.unit,
          comparison: factor.comparisonAr,
          // The factor's canonical domain (KPI | FOLLOW_UP | PRODUCTIVITY |
          // QUALITY | ATTENDANCE | HR_DISCIPLINARY | TREND) — the view-model
          // localizes it into a HUMAN-READABLE source label; the raw ruleId
          // stays diagnostics-only.
          category: factor.category,
        },
        drillPage: CATEGORY_DRAIN_PAGE[factor.category] ?? null,
      });
    }
  }

  // (h) Data-quality warning.
  const unattributed = dataset.dataQuality.unattributedRecords.reduce((s, u) => s + u.count, 0);
  if (unattributed > 0 || dataset.dataQuality.notes.length > 0) {
    items.push({
      id: 'att-data-quality',
      code: 'ATT_DATA_QUALITY',
      severity: 'info',
      source: 'dataset.data_quality',
      values: { unattributed, notes: dataset.dataQuality.notes.length },
      drillPage: null,
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────
//  Executive narrative (§21) — ordered sentence facts
// ─────────────────────────────────────────────────────────────

export type NarrativeCode =
  | 'NAR_SCORE'
  | 'NAR_SCORE_INCOMPLETE'
  | 'NAR_NO_SCORE'
  | 'NAR_DELTA'
  | 'NAR_TOP_ISSUE'
  | 'NAR_FOLLOWUP'
  | 'NAR_OPEN_ITEMS'
  | 'NAR_RISK'
  | 'NAR_ATTENDANCE'
  | 'NAR_DEALS';

export interface NarrativeFact {
  code: NarrativeCode;
  values: Record<string, number | string | null>;
}

/**
 * THE narrative composition: 3-7 sentences, each backed by the
 * values it names. A sentence is INCLUDED only when its numbers
 * exist — nothing is ever written around a missing value.
 */
export function buildExecutiveNarrative(input: QualityIntelligenceInput): NarrativeFact[] {
  const { dataset, decision } = input;
  const facts: NarrativeFact[] = [];
  const kpi = dataset.kpi;
  const state = executiveScoreState(dataset);

  if (state === 'value' && kpi.weightedTotal !== null) {
    facts.push({ code: 'NAR_SCORE', values: { score: kpi.weightedTotal } });
    const mom = dataset.trend.mom;
    if (mom) {
      facts.push({ code: 'NAR_DELTA', values: { delta: mom.deltaPoints, previousMonth: mom.previousMonth } });
    }
  } else if (state === 'incomplete') {
    const missing = missingComponentsOf(dataset).map((m) => m.name).join(', ');
    facts.push({ code: 'NAR_SCORE_INCOMPLETE', values: { missing } });
  } else {
    facts.push({ code: 'NAR_NO_SCORE', values: { rowStatus: kpi.rowStatus } });
  }

  // Issue concentration.
  const quality = buildQualityIntel(input);
  if (quality.topIssue) {
    facts.push({
      code: 'NAR_TOP_ISSUE',
      values: {
        label: quality.topIssue.categoryName,
        share: quality.topIssue.share,
        count: quality.topIssue.count,
      },
    });
  }

  // Follow-up discipline.
  const fu = buildFollowUpsIntel(input);
  if (fu.total > 0) {
    facts.push({ code: 'NAR_FOLLOWUP', values: { rate: fu.completionRate, overdue: fu.overdue } });
  }

  // Open operational items.
  const openItems: Array<{ labelKey: string; count: number }> = [];
  if (dataset.complaints.stillOpen > 0) openItems.push({ labelKey: 'complaints', count: dataset.complaints.stillOpen });
  if (dataset.capa.overdue > 0) openItems.push({ labelKey: 'capaOverdue', count: dataset.capa.overdue });
  if (fu.overdue > 0) openItems.push({ labelKey: 'followUpsOverdue', count: fu.overdue });
  if (openItems.length > 0) {
    facts.push({
      code: 'NAR_OPEN_ITEMS',
      values: {
        items: openItems.map((o) => `${o.labelKey}:${o.count}`).join(','),
        complaints: dataset.complaints.stillOpen,
        capaOverdue: dataset.capa.overdue,
        followUpsOverdue: fu.overdue,
      },
    });
  }

  // Risk.
  if (decision) {
    facts.push({
      code: 'NAR_RISK',
      values: { level: decision.executive.riskLevel, score: decision.executive.riskScore },
    });
  }

  // Attendance context.
  const attendance = buildAttendanceIntel(input);
  if (attendance.available && attendance.compliance !== null) {
    facts.push({ code: 'NAR_ATTENDANCE', values: { compliance: attendance.compliance } });
  }

  // Deal context (corrected date semantics). The "confirmed" part is
  // the CURRENT-STATUS split of the SAME closure population — not the
  // separate CLOSED-dimension completion count (§32: the breakdown
  // must reconcile with the headline, one population, no mixing).
  const deals = buildDealsIntel(input);
  if (deals.closedWithEmployeeInPeriod > 0) {
    facts.push({
      code: 'NAR_DEALS',
      values: {
        closedWithEmployee: deals.closedWithEmployeeInPeriod,
        confirmed: deals.confirmedClosures,
        cancelled: deals.cancelledClosures,
      },
    });
  }

  return facts;
}

// ─────────────────────────────────────────────────────────────
//  Data quality (§23) — availability of every source
// ─────────────────────────────────────────────────────────────

export type SourceAvailability = 'available' | 'no_data' | 'configuration_required' | 'withheld';

export interface DataSourceStatus {
  source: string;
  availability: SourceAvailability;
  /** Records attributed to the reported period (when meaningful). */
  periodCount: number | null;
}

export interface DataQualityIntel {
  sources: DataSourceStatus[];
  kpiConfigured: boolean;
  unattributed: number;
  notes: number;
}

function monthCountOf(monthly: MonthlyCount[] | undefined, monthKey: string | null): number | null {
  if (!monthly || !monthKey) return null;
  const hit = monthly.find((m) => m.month === monthKey);
  return hit ? hit.count : null;
}

function missingComponentsOf(dataset: EmployeePerformanceDataset): Array<{ componentId: string; name: string; weight: number }> {
  // KpiComponentFact.rawScore === null means the engine produced NO
  // value for the component this period (PENDING/NOT_ELIGIBLE) —
  // a missing configuration/value, never a zero.
  return dataset.kpi.components
    .filter((c) => c.rawScore === null)
    .map((c) => ({ componentId: c.componentId, name: c.name, weight: c.weight }));
}

// ─────────────────────────────────────────────────────────────
//  §4 TOP 3 SIGNALS — the compact management headline
// ─────────────────────────────────────────────────────────────

export type SignalCode =
  | 'SIG_TREND_DOWN'
  | 'SIG_TREND_UP'
  | 'SIG_TOP_ISSUE'
  | 'SIG_FOLLOWUP_COMPLETION'
  | 'SIG_OVERDUE_FOLLOWUPS'
  | 'SIG_OVERDUE_CAPA'
  | 'SIG_OPEN_COMPLAINTS'
  | 'SIG_HIGH_SEVERITY'
  | 'SIG_REPEATED_ISSUE'
  | 'SIG_KPI_INCOMPLETE'
  | 'SIG_CLOSURES';

export interface SignalFact {
  code: SignalCode;
  severity: AttentionSeverity;
  /** Typed sentence slots (localized later — numbers only via slots). */
  values: Record<string, number | string | null>;
  /** Honest drill target page (same navigation model as attention). */
  drillPage: string | null;
}

const SIGNAL_PRIORITY: Record<SignalCode, number> = {
  SIG_TREND_DOWN: 1,
  SIG_HIGH_SEVERITY: 2,
  SIG_KPI_INCOMPLETE: 3,
  SIG_TOP_ISSUE: 4,
  SIG_REPEATED_ISSUE: 5,
  SIG_OVERDUE_FOLLOWUPS: 6,
  SIG_OVERDUE_CAPA: 7,
  SIG_OPEN_COMPLAINTS: 8,
  SIG_TREND_UP: 9,
  SIG_FOLLOWUP_COMPLETION: 10,
  SIG_CLOSURES: 11,
};

const SEVERITY_WEIGHT: Record<AttentionSeverity, number> = { critical: 3, warning: 2, info: 1 };

/**
 * THE top-signal rules (§4): up to THREE most meaningful facts, each
 * backed by real canonical values — negative signals first (by
 * severity, then a fixed priority order), meaningful positive signals
 * after. A signal exists ONLY when its numbers exist; nothing generic
 * is invented to fill the row.
 */
export function buildTopSignals(input: QualityIntelligenceInput): SignalFact[] {
  const { dataset } = input;
  const candidates: SignalFact[] = [];

  // Trend — the canonical engine's own MoM verdict.
  const mom = dataset.trend.mom;
  if (dataset.trend.direction === 'DOWN' && mom) {
    candidates.push({
      code: 'SIG_TREND_DOWN', severity: 'warning',
      values: { delta: mom.deltaPoints },
      drillPage: null,
    });
  } else if (dataset.trend.direction === 'UP' && mom) {
    candidates.push({
      code: 'SIG_TREND_UP', severity: 'info',
      values: { delta: mom.deltaPoints },
      drillPage: null,
    });
  }

  // Issue concentration — the top category's real share.
  const quality = buildQualityIntel(input);
  if (quality.topIssue && quality.topIssue.share !== null && quality.topIssue.share >= 50) {
    candidates.push({
      code: 'SIG_TOP_ISSUE', severity: 'warning',
      values: { share: quality.topIssue.share, count: quality.topIssue.count, label: quality.topIssue.categoryName },
      drillPage: 'observations',
    });
  }

  // Follow-up discipline — overdue (risk) or full completion (positive).
  const fu = buildFollowUpsIntel(input);
  if (dataset.followUps.overdue > 0) {
    candidates.push({
      code: 'SIG_OVERDUE_FOLLOWUPS', severity: dataset.followUps.overdue >= 3 ? 'critical' : 'warning',
      values: { count: dataset.followUps.overdue },
      drillPage: 'followUps',
    });
  } else if (fu.total > 0 && fu.completed === fu.total) {
    candidates.push({
      code: 'SIG_FOLLOWUP_COMPLETION', severity: 'info',
      values: { completed: fu.completed, total: fu.total, rate: fu.completionRate },
      drillPage: 'followUps',
    });
  }

  if (dataset.capa.overdue > 0) {
    candidates.push({
      code: 'SIG_OVERDUE_CAPA', severity: 'warning',
      values: { count: dataset.capa.overdue },
      drillPage: 'capa',
    });
  }
  if (dataset.complaints.stillOpen > 0) {
    candidates.push({
      code: 'SIG_OPEN_COMPLAINTS', severity: 'warning',
      values: { count: dataset.complaints.stillOpen },
      drillPage: 'complaints',
    });
  }

  // High-severity quality evidence.
  const bySeverity = dataset.quality.observations.bySeverity;
  const highSeverity = (bySeverity.high ?? 0) + (bySeverity.critical ?? 0);
  if (highSeverity > 0) {
    candidates.push({
      code: 'SIG_HIGH_SEVERITY', severity: highSeverity >= 3 ? 'critical' : 'warning',
      values: { count: highSeverity },
      drillPage: 'observations',
    });
  }

  // Repeated issues (engine threshold).
  const topRepeated = dataset.quality.repeatedIssues.byCategory[0] ?? dataset.quality.repeatedIssues.byType[0] ?? null;
  if (topRepeated) {
    candidates.push({
      code: 'SIG_REPEATED_ISSUE', severity: 'warning',
      values: { label: topRepeated.label, count: topRepeated.occurrenceCount },
      drillPage: 'observations',
    });
  }

  // KPI configuration (compact — no engine codes).
  const state = executiveScoreState(dataset);
  if (state === 'incomplete' || state === 'configuration_required') {
    candidates.push({
      code: 'SIG_KPI_INCOMPLETE', severity: 'warning',
      values: { missingCount: missingComponentsOf(dataset).length },
      drillPage: null,
    });
  }

  // Deal closures — a volume fact only when the period actually has closures.
  const deals = buildDealsIntel(input);
  if (deals.closedWithEmployeeInPeriod > 0) {
    candidates.push({
      code: 'SIG_CLOSURES', severity: 'info',
      values: { count: deals.closedWithEmployeeInPeriod },
      drillPage: 'travel',
    });
  }

  return [...candidates]
    .sort((a, b) =>
      SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
      || SIGNAL_PRIORITY[a.code] - SIGNAL_PRIORITY[b.code])
    .slice(0, 3);
}

// ─────────────────────────────────────────────────────────────
//  §15 WHAT CHANGED — current vs previous comparable period
// ─────────────────────────────────────────────────────────────

export type WhatChangedMetric =
  | 'quality_score'
  | 'quality_observations'
  | 'follow_ups'
  | 'complaints'
  | 'capa'
  | 'closures'
  | 'travel';

export interface WhatChangedFact {
  metric: WhatChangedMetric;
  /** Current period value (null = no data — the row is omitted). */
  current: number | null;
  /** Previous comparable period value (null = no data — row omitted). */
  previous: number | null;
  /** current − previous (null when either side is missing). */
  delta: number | null;
}

/**
 * §15 — period-over-period comparison rows. A row is INCLUDED only
 * when BOTH periods carry data (months without data stay null — never
 * zero-filled), except the quality SCORE which uses the canonical
 * engine's own MoM pair. All values come from the dataset's own
 * monthly series — no second aggregation.
 */
export function buildWhatChanged(input: QualityIntelligenceInput): WhatChangedFact[] {
  const { dataset, previousMonthKey: prev } = input;
  if (!prev) return [];
  const rows: WhatChangedFact[] = [];

  // Quality score — the engine's own MoM pair (both scores exist).
  const mom = dataset.trend.mom;
  if (mom) {
    rows.push({
      metric: 'quality_score',
      current: mom.currentRawScore,
      previous: mom.previousRawScore,
      delta: mom.deltaPoints,
    });
  }

  const seriesRow = (
    metric: WhatChangedMetric,
    monthly: MonthlyCount[] | undefined,
  ): void => {
    const current = monthCountOf(monthly, dataset.period.monthKey);
    const previous = monthCountOf(monthly, prev);
    if (current === null || previous === null) return;
    rows.push({ metric, current, previous, delta: current - previous });
  };

  seriesRow('quality_observations', dataset.quality.observations.monthly);
  seriesRow('follow_ups', dataset.followUps.monthly);
  seriesRow('complaints', dataset.complaints.monthly);
  seriesRow('capa', dataset.capa.monthly);
  seriesRow('closures', dataset.deals.closedWithEmployeeMonthly);
  seriesRow('travel', dataset.deals.monthly);

  return rows;
}



function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildExecutiveSummaryFacts(input: QualityIntelligenceInput): ExecutiveSummaryFacts {
  const { dataset, decision } = input;
  const kpi = dataset.kpi;
  const mom = dataset.trend.mom;
  return {
    scoreState: executiveScoreState(dataset),
    performanceScore: kpi.weightedTotal,
    qualityScore: kpi.quality?.rawScore ?? null,
    deltaPoints: mom?.deltaPoints ?? null,
    previousScore: mom?.previousRawScore ?? null,
    trendDirection: dataset.trend.direction,
    missingComponents: missingComponentsOf(dataset),
    availableWeight: kpi.availableWeight,
    rowStatus: kpi.rowStatus,
    riskScore: decision?.executive.riskScore ?? null,
    riskLevel: decision?.executive.riskLevel ?? null,
    decisionStatus: decision?.executive.status ?? null,
    closedDuringPeriod: dataset.deals.closedWithEmployeeInPeriod,
    currentDeals: dataset.deals.statusAllTime.upcoming + dataset.deals.statusAllTime.in_progress,
    period: dataset.period.monthKey,
    valueBasis: dataset.period.valueBasis,
    finalized: dataset.period.finalized,
  };
}

export function buildKpiIntel(input: QualityIntelligenceInput): KpiIntel {
  const { dataset } = input;
  const kpi = dataset.kpi;
  const components: KpiComponentIntel[] = kpi.components.map((c) => ({
    componentId: c.componentId,
    name: c.name,
    weight: c.weight,
    status: c.status,
    actual: c.rawScore,
    contribution: c.weightedContribution,
    maxContribution: c.maxContribution,
    hasValue: c.rawScore !== null,
  }));
  const missing = components.filter((c) => !c.hasValue);
  return {
    components,
    missingComponentNames: missing.map((c) => c.name),
    configurationComplete: missing.length === 0,
    rowStatus: kpi.rowStatus,
    overallStatus: kpi.overallStatus,
    weightedTotal: kpi.weightedTotal,
    availableWeight: kpi.availableWeight,
    schemeLabel: kpi.scheme
      ? `${kpi.scheme.schemeName} — v${kpi.scheme.schemeVersion}`
      : null,
  };
}

export function buildQualityIntel(input: QualityIntelligenceInput): QualityIntel {
  const { dataset, previousMonthKey: prev } = input;
  const obs = dataset.quality.observations;
  const total = obs.total;
  const concentration: IssueConcentrationRow[] = obs.byCategory
    .map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      count: c.count,
      share: total > 0 ? round2((c.count / total) * 100) : null,
    }))
    .sort((a, b) => b.count - a.count || a.categoryName.localeCompare(b.categoryName));

  const bySeverity = obs.bySeverity;
  return {
    total,
    approved: obs.approved,
    rejected: obs.rejected,
    pending: obs.pending,
    issueCategoryCount: obs.byCategory.length,
    concentration,
    topIssue: concentration[0] ?? null,
    highImpactCount: (bySeverity.high ?? 0) + (bySeverity.critical ?? 0),
    repeatedGroupCount:
      dataset.quality.repeatedIssues.byCategory.length + dataset.quality.repeatedIssues.byType.length,
    previousTotal: monthCountOf(obs.monthly, prev),
    monthly: obs.monthly,
  };
}

export function buildDeductionsIntel(input: QualityIntelligenceInput): DeductionsIntel {
  const d = input.dataset.quality.deductions;
  const topType = [...d.byType].sort((a, b) => b.count - a.count)[0] ?? null;
  const highest = d.records.length > 0
    ? d.records.reduce((acc, r) => (r.deductionDays > acc.deductionDays ? r : acc), d.records[0])
    : null;
  return {
    count: d.count,
    totalDays: d.totalDays,
    totalAmount: d.totalAmount,
    typeCount: d.byType.length,
    topType: topType ? { name: topType.categoryName, count: topType.count } : null,
    highest: highest
      ? { days: highest.deductionDays, amount: highest.deductionAmount, date: highest.date }
      : null,
  };
}

export function buildFollowUpsIntel(input: QualityIntelligenceInput): FollowUpsIntel {
  const f = input.dataset.followUps;
  return {
    total: f.total,
    completed: f.completed,
    active: f.active,
    overdue: f.overdue,
    dueToday: f.dueToday,
    completionRate: f.total > 0 ? round2((f.completed / f.total) * 100) : null,
    onTimeRate: null, // not computable — no completion timestamp in the model
  };
}

export function buildComplaintsIntel(input: QualityIntelligenceInput): ComplaintsIntel {
  const { dataset, previousMonthKey: prev } = input;
  const c = dataset.complaints;
  return {
    total: c.total,
    stillOpen: c.stillOpen,
    resolvedOrClosed: c.resolvedOrClosed,
    avgResolutionDays: c.avgResolutionDays,
    previousTotal: monthCountOf(c.monthly, prev),
  };
}

export function buildCapaIntel(input: QualityIntelligenceInput): CapaIntel {
  const { dataset, previousMonthKey: prev } = input;
  const c = dataset.capa;
  return {
    total: c.total,
    active: c.active,
    terminal: c.terminal,
    overdue: c.overdue,
    closedCount: c.closedCount,
    previousTotal: monthCountOf(c.monthly, prev),
  };
}

export function buildDealsIntel(input: QualityIntelligenceInput): DealsIntel {
  const d = input.dataset.deals;
  const byClosureStatus = d.closedWithEmployeeInPeriodByStatus;
  return {
    closedWithEmployeeInPeriod: d.closedWithEmployeeInPeriod,
    closedWithEmployeeTotal: d.closedWithEmployeeTotal,
    confirmedClosures: byClosureStatus.completed,
    cancelledClosures: byClosureStatus.canceled,
    stillActiveClosures: byClosureStatus.upcoming + byClosureStatus.in_progress,
    completedInPeriod: d.closedTotal,
    travelInPeriod: d.travelTotal,
    canceledInPeriod: d.canceled,
    currentCanceledAllTime: d.statusAllTime.canceled,
    // §27 — the CURRENT-STATUS snapshot only (upcoming + in_progress):
    // no date dimension participates in this number.
    currentDeals: d.statusAllTime.upcoming + d.statusAllTime.in_progress,
    currentDealsByStatus: { upcoming: d.statusAllTime.upcoming, in_progress: d.statusAllTime.in_progress },
  };
}

export function buildAttendanceIntel(input: QualityIntelligenceInput): AttendanceIntel {
  const a = input.dataset.attendance;
  if (a.status !== 'AVAILABLE' || !a.result) {
    return { available: false, compliance: null, lateDays: null, absentDays: null };
  }
  return {
    available: true,
    compliance: a.result.compliance,
    lateDays: a.result.lateDays,
    absentDays: a.result.absentDays,
  };
}

export function buildDataQualityIntel(input: QualityIntelligenceInput): DataQualityIntel {
  const { dataset, decision, hrDeductions } = input;
  const kpiConfigured =
    dataset.kpi.rowStatus !== 'NO_SCHEME'
    && dataset.kpi.rowStatus !== 'AMBIGUOUS'
    && dataset.kpi.rowStatus !== 'OVERRIDE_NOT_RESOLVABLE';

  const sources: DataSourceStatus[] = [
    {
      source: 'kpi',
      availability: kpiConfigured
        ? (dataset.kpi.weightedTotal !== null ? 'available' : 'no_data')
        : 'configuration_required',
      periodCount: dataset.kpi.weightedTotal,
    },
    {
      source: 'quality',
      availability: dataset.quality.observations.total > 0 || dataset.quality.deductions.count > 0 ? 'available' : 'no_data',
      periodCount: dataset.quality.observations.total,
    },
    {
      source: 'followUps',
      availability: dataset.followUps.total > 0 ? 'available' : 'no_data',
      periodCount: dataset.followUps.total,
    },
    {
      source: 'complaints',
      availability: dataset.complaints.total > 0 ? 'available' : 'no_data',
      periodCount: dataset.complaints.total,
    },
    {
      source: 'capa',
      availability: dataset.capa.total > 0 ? 'available' : 'no_data',
      periodCount: dataset.capa.total,
    },
    {
      source: 'deals',
      availability: dataset.deals.closedWithEmployeeTotal > 0 ? 'available' : 'no_data',
      periodCount: dataset.deals.closedWithEmployeeInPeriod,
    },
    {
      source: 'attendance',
      availability: dataset.attendance.status === 'AVAILABLE' && dataset.attendance.result ? 'available' : 'no_data',
      periodCount: null,
    },
    {
      source: 'hrDeductions',
      availability: hrDeductions ? (hrDeductions.count > 0 ? 'available' : 'no_data') : 'withheld',
      periodCount: hrDeductions?.count ?? null,
    },
    {
      source: 'risk',
      availability: decision ? 'available' : 'withheld',
      periodCount: decision?.executive.riskScore ?? null,
    },
  ];

  return {
    sources,
    kpiConfigured,
    unattributed: dataset.dataQuality.unattributedRecords.reduce((s, u) => s + u.count, 0),
    notes: dataset.dataQuality.notes.length,
  };
}

/** The whole intelligence bundle — ONE pure call over ONE dataset. */
export interface QualityIntelligence {
  executive: ExecutiveSummaryFacts;
  /** §4 — up to three management headline signals (deterministic). */
  signals: SignalFact[];
  kpi: KpiIntel;
  quality: QualityIntel;
  deductions: DeductionsIntel;
  followUps: FollowUpsIntel;
  complaints: ComplaintsIntel;
  capa: CapaIntel;
  deals: DealsIntel;
  attendance: AttendanceIntel;
  patterns: PatternFact[];
  attention: AttentionItemFact[];
  /** §15 — current vs previous comparable period rows. */
  whatChanged: WhatChangedFact[];
  narrative: NarrativeFact[];
  dataQuality: DataQualityIntel;
}

export function buildQualityIntelligence(input: QualityIntelligenceInput): QualityIntelligence {
  return {
    executive: buildExecutiveSummaryFacts(input),
    signals: buildTopSignals(input),
    kpi: buildKpiIntel(input),
    quality: buildQualityIntel(input),
    deductions: buildDeductionsIntel(input),
    followUps: buildFollowUpsIntel(input),
    complaints: buildComplaintsIntel(input),
    capa: buildCapaIntel(input),
    deals: buildDealsIntel(input),
    attendance: buildAttendanceIntel(input),
    patterns: detectPatterns(input),
    attention: buildManagementAttention(input),
    whatChanged: buildWhatChanged(input),
    narrative: buildExecutiveNarrative(input),
    dataQuality: buildDataQualityIntel(input),
  };
}
