// ══════════════════════════════════════════════════════════════
//  HR Decision-Support Report — Type Layer
//
//  A deterministic, READ-ONLY decision-support projection OVER the
//  canonical Employee Performance Intelligence dataset
//  (lib/performance-intelligence — Phase 3) plus the stored HR
//  deduction month summary (lib/employee-performance).
//
//  PURPOSE — answer, with evidence:
//    "Is this employee performing normally, needs coaching/training,
//     needs a formal performance-improvement review, or requires a
//     management review?"
//
//  HARD RULES:
//    • SAFETY: this is decision SUPPORT, never an automatic
//      employment-decision engine. The status vocabulary contains
//      NO termination/fire state, and the recommended action is
//      always worded as a review recommendation — the final
//      employment decision stays a HUMAN decision outside the
//      scoring system.
//    • DETERMINISTIC: plain TypeScript rules over canonical facts.
//      No AI, no heuristics, no invented thresholds.
//    • THRESHOLD HONESTY: a signal is only judged against a
//      threshold that ALREADY EXISTS in Qnalys (kpiSettings
//      defaultScore, the canonical risk engine bands). Signals
//      without a configured threshold are REPORTED as measured
//      values with basis CONFIGURATION_REQUIRED — never judged
//      against an invented number.
//    • HR-SAFE BY SHAPE: the view models below have NO fields for
//      observation text/details, deduction reasons, complaint/CAPA
//      detail, deal customer data, evidence ids or technical
//      component math — those never leave the technical reports.
//    • MISSING ≠ ZERO: unavailable data is an explicit state and
//      never contributes to a negative factor.
// ══════════════════════════════════════════════════════════════

import type { RiskLevel } from '@/lib/metrics/riskMetrics';
import type { KpiValueBasis, KpiReportRowStatus } from '@/lib/kpi-reporting';
import type { TrendDirection } from '@/lib/performance-intelligence';

// ─────────────────────────────────────────────────────────────
//  Status vocabulary (safety-bounded — no termination state)
// ─────────────────────────────────────────────────────────────

/**
 * The decision-support status. Deliberately bounded:
 * STABLE / IMPROVING / NEEDS_COACHING / PERFORMANCE_IMPROVEMENT_REVIEW
 * / MANAGEMENT_REVIEW. A termination decision is NEVER produced by
 * this system — it stays a human decision outside the scoring.
 */
export type HrDecisionStatus =
  | 'STABLE'
  | 'IMPROVING'
  | 'NEEDS_COACHING'
  | 'PERFORMANCE_IMPROVEMENT_REVIEW'
  | 'MANAGEMENT_REVIEW';

/** Deterministic severity order used for sorting/filtering ONLY. */
export const HR_DECISION_STATUS_ORDER: Readonly<Record<HrDecisionStatus, number>> = {
  MANAGEMENT_REVIEW: 0,
  PERFORMANCE_IMPROVEMENT_REVIEW: 1,
  NEEDS_COACHING: 2,
  IMPROVING: 3,
  STABLE: 4,
};

/** Arabic labels (the report's display language). */
export const HR_DECISION_STATUS_LABELS_AR: Readonly<Record<HrDecisionStatus, string>> = {
  STABLE: 'مستقر',
  IMPROVING: 'يتحسّن',
  NEEDS_COACHING: 'يحتاج توجيهاً/تدريباً',
  PERFORMANCE_IMPROVEMENT_REVIEW: 'مراجعة خطة تحسين الأداء',
  MANAGEMENT_REVIEW: 'مراجعة من الإدارة والموارد البشرية',
};

/** The kind of management action suggested for a status (never a final employment decision). */
export type HrActionKind =
  | 'CONTINUE_MONITORING'
  | 'RECOGNIZE_IMPROVEMENT'
  | 'COACHING'
  | 'IMPROVEMENT_PLAN'
  | 'MANAGEMENT_HR_REVIEW';

// ─────────────────────────────────────────────────────────────
//  Factors — the structured WHY behind every status
// ─────────────────────────────────────────────────────────────

/** The dimension a factor belongs to. */
export type HrDecisionFactorCategory =
  | 'KPI'
  | 'FOLLOW_UP'
  | 'PRODUCTIVITY'
  | 'QUALITY'
  | 'ATTENDANCE'
  | 'HR_DISCIPLINARY'
  | 'TREND';

export const HR_DECISION_CATEGORY_LABELS_AR: Readonly<Record<HrDecisionFactorCategory, string>> = {
  KPI: 'مؤشر الأداء',
  FOLLOW_UP: 'المتابعات اليومية',
  PRODUCTIVITY: 'الإنتاجية',
  QUALITY: 'إشارة الجودة',
  ATTENDANCE: 'الانضباط والحضور',
  HR_DISCIPLINARY: 'إشارة الموارد البشرية',
  TREND: 'الاتجاه الزمني',
};

/** Presentation-only severity ordering of a factor (not a business verdict). */
export type HrDecisionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

/** Whether the factor is a measurable concern or a measurable strength. */
export type HrDecisionFactorKind = 'NEGATIVE' | 'POSITIVE';

/**
 * The honest basis a factor's judgment rests on:
 *   CONFIGURED            — an existing Qnalys-configured target
 *                           (kpiSettings.defaultScore).
 *   CANONICAL_RISK        — the canonical risk engine's existing
 *                           weights/bands (lib/metrics/riskMetrics).
 *   NONE_REQUIRED         — the factor states a measured fact that
 *                           needs no threshold (e.g. a delta).
 *   CONFIGURATION_REQUIRED— the signal is REPORTED as a measured
 *                           value, but NO threshold is configured in
 *                           Qnalys; the factor explicitly does not
 *                           judge it (never an invented number).
 */
export type HrThresholdBasis = 'CONFIGURED' | 'CANONICAL_RISK' | 'NONE_REQUIRED' | 'CONFIGURATION_REQUIRED';

/** One structured factor: the measurable evidence behind a status. */
export interface HrDecisionFactor {
  category: HrDecisionFactorCategory;
  kind: HrDecisionFactorKind;
  severity: HrDecisionSeverity;
  /** Deterministic Arabic signal sentence (what was measured). */
  signalAr: string;
  /** The measured value (null = not measurable, never 0-filled). */
  value: number | null;
  unit: 'percent' | 'points' | 'days' | 'count' | 'months' | 'minutes';
  /** Arabic comparison context (vs which baseline/rule). */
  comparisonAr: string | null;
  thresholdBasis: HrThresholdBasis;
  /** The configured/canonical value judged against (null when none). */
  thresholdValue: number | null;
  /** Stable rule id — deterministic, test-pinned. */
  ruleId: string;
}

// ─────────────────────────────────────────────────────────────
//  Scorecard dimensions
// ─────────────────────────────────────────────────────────────

export type HrDimensionState = 'OK' | 'WATCH' | 'WEAK' | 'POSITIVE' | 'UNKNOWN';

/**
 * Why a dimension has no measurable value this period. Data absence
 * is NEVER interpreted as poor performance.
 */
export type HrDimensionAvailability = 'AVAILABLE' | 'NOT_AVAILABLE';

/** One scorecard metric (measured value + honest unit). */
export interface HrDimensionMetric {
  labelAr: string;
  value: number | null;
  unit: HrDecisionFactor['unit'];
  /** Arabic hint when the value needs context (e.g. threshold basis). */
  hintAr?: string | null;
}

/** One scorecard dimension (HR-safe aggregates only). */
export interface HrDimensionScorecardEntry {
  category: HrDecisionFactorCategory;
  labelAr: string;
  availability: HrDimensionAvailability;
  /** Present when unavailable — Arabic data-quality sentence. */
  unavailableReasonAr: string | null;
  state: HrDimensionState;
  metrics: HrDimensionMetric[];
}

// ─────────────────────────────────────────────────────────────
//  Status evaluation result (deterministic)
// ─────────────────────────────────────────────────────────────

export interface HrStatusEvaluation {
  status: HrDecisionStatus;
  /** The deterministic rule that fired (test-pinned id). */
  matchedRuleId: string;
  /** Arabic explanation of the matched rule. */
  matchedRuleAr: string;
  factors: HrDecisionFactor[];
  /** Canonical risk engine result (existing weights/bands, reused). */
  riskScore: number;
  riskLevel: RiskLevel;
  /** Repeated below-target KPI months ending at the current period. */
  consecutiveKpiBelowTarget: number;
  /** Declining consecutive KPI steps ending at the current period. */
  consecutiveKpiDecliningSteps: number;
  /** Number of dimensions with at least one MEDIUM+ negative factor. */
  weakDimensionCount: number;
  /** True when the only negative signals live in a single period (not repeated). */
  isolatedWeaknessOnly: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Recommended action
// ─────────────────────────────────────────────────────────────

export interface HrRecommendedAction {
  status: HrDecisionStatus;
  actionKind: HrActionKind;
  /** Arabic recommended-action sentence (a REVIEW recommendation). */
  actionAr: string;
  /** Deterministic rationale assembled from the matched rule. */
  rationaleAr: string;
  /**
   * FIXED safety disclaimer — present on EVERY report. The action is
   * a recommended review only; the final employment decision is a
   * human decision outside the automated scoring system.
   */
  disclaimerAr: string;
}

export const HR_ACTION_DISCLAIMER_AR =
  'توصية مراجعة إجرائية فقط — ليست قراراً نهائياً بشأن التوظيف. ' +
  'أي قرار نهائي يبقى قراراً بشرياً تتخذه الإدارة/الموارد البشرية خارج نظام التقييم الآلي.';

// ─────────────────────────────────────────────────────────────
//  Employee decision report (the HR-safe projection)
// ─────────────────────────────────────────────────────────────

export interface HrDecisionEmployeeHeader {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  team: string | null;
  position: string | null;
  employmentStatus: 'active' | 'inactive' | 'archived' | 'unknown';
  archivedButEligible: boolean;
}

export interface HrDecisionExecutiveSummary {
  status: HrDecisionStatus;
  statusLabelAr: string;
  actionKind: HrActionKind;
  actionAr: string;
  /** Canonical KPI score — verbatim, null = no result this period. */
  kpiScore: number | null;
  kpiRowStatus: KpiReportRowStatus;
  trendDirection: TrendDirection | null;
  /** Month-over-month delta in KPI percentage points (null when not comparable). */
  momDeltaPoints: number | null;
  riskLevel: RiskLevel;
  riskScore: number;
}

export interface HrDecisionTrendSection {
  /** Analysis window (ascending) ending at the reported month. */
  windowMonths: string[];
  /** HR-safe trend points — month + score only (no weights/component math). */
  points: Array<{ monthKey: string; available: boolean; rawScore: number | null }>;
  direction: TrendDirection | null;
  momDeltaPoints: number | null;
  /** Months of the window WITH a comparable score. */
  monthsWithScore: number;
  /** Consecutive below-target months ending at the current period. */
  consecutiveBelowTarget: number;
  /** Consecutive declining steps ending at the current period. */
  consecutiveDecliningSteps: number;
  /** The configured target the comparison uses (kpiSettings.defaultScore). */
  targetScore: number;
}

export type HrDataSufficiency = 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT';

export interface HrDecisionDataQuality {
  sufficiency: HrDataSufficiency;
  /** Arabic notes — every unavailable dimension is named, never guessed. */
  notesAr: string[];
}

/** The per-employee HR decision-support report. */
export interface HrEmployeeDecisionReport {
  reportKind: 'HR_EMPLOYEE_DECISION';
  audience: 'HR';
  employee: HrDecisionEmployeeHeader;
  period: { monthKey: string; valueBasis: KpiValueBasis; finalized: boolean };
  executive: HrDecisionExecutiveSummary;
  scorecard: HrDimensionScorecardEntry[];
  trend: HrDecisionTrendSection;
  /** All factors (negative + positive), deterministic order. */
  factors: HrDecisionFactor[];
  /** Positive subset — measurable strengths only. */
  strengths: HrDecisionFactor[];
  /** Negative subset — measurable concerns only. */
  concerns: HrDecisionFactor[];
  action: HrRecommendedAction;
  dataQuality: HrDecisionDataQuality;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Team / department aggregate (distributions, never a leaderboard)
// ─────────────────────────────────────────────────────────────

export interface HrTeamDecisionRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  team: string | null;
  position: string | null;
  status: HrDecisionStatus;
  actionKind: HrActionKind;
  /** Canonical KPI score — verbatim, null = no result. */
  kpiScore: number | null;
  trendDirection: TrendDirection | null;
  /** Count of MEDIUM+ negative factors (structured evidence weight). */
  concernCount: number;
  /** One-line Arabic summary of the dominant concern (null when none). */
  topConcernAr: string | null;
}

export interface HrTeamDecisionTotals {
  employees: number;
  stable: number;
  improving: number;
  needsCoaching: number;
  performanceImprovementReview: number;
  managementReview: number;
  /** Employees with a comparable KPI score this period. */
  withKpiResult: number;
  /** Mean KPI over comparable scores (null when none). */
  averageKpi: number | null;
}

export interface HrTeamDecisionOperationalTotals {
  followUps: {
    employeesWithData: number;
    /** Mean completion rate over employees WITH follow-ups (null when none). */
    averageCompletionRate: number | null;
    totalOverdue: number;
    /** Mean overdue rate over employees WITH follow-ups (null when none). */
    averageOverdueRate: number | null;
  };
  attendance: {
    employeesWithResult: number;
    /** Mean compliance over stored results (null when none). */
    averageCompliance: number | null;
    totalLateDays: number;
    totalAbsentDays: number;
  };
  productivity: {
    employeesWithDeals: number;
    /** TRAVEL dimension (§DEAL-DATES) — sum of travel volume. */
    travelVolume: number;
    /** CLOSED dimension (§DEAL-DATES) — sum of observed closures. */
    closedDeals: number;
  };
  trend: {
    improving: number;
    stable: number;
    declining: number;
    noData: number;
  };
}

/** The team/department HR decision-support aggregate. */
export interface HrTeamDecisionReport {
  reportKind: 'HR_TEAM_DECISION';
  audience: 'HR';
  monthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  totals: HrTeamDecisionTotals;
  operational: HrTeamDecisionOperationalTotals;
  rows: HrTeamDecisionRow[];
  dataQuality: HrDecisionDataQuality;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Thresholds — reuse what Qnalys already configures
// ─────────────────────────────────────────────────────────────

/**
 * The thresholds the decision engine is allowed to use. Every entry
 * documents its basis; anything not configured in Qnalys is null
 * with basis CONFIGURATION_REQUIRED and is REPORTED, never judged.
 */
export interface HrDecisionThresholds {
  /** Configured KPI baseline (kpiSettings.defaultScore — the same value kpi-dashboard reuses). */
  kpiTargetScore: number;
  kpiTargetBasis: 'CONFIGURED';
  kpiTargetSource: 'kpiSettings.defaultScore';
  /** No configured minimum attendance compliance exists in Qnalys. */
  attendanceMinimumCompliance: null;
  attendanceBasis: 'CONFIGURATION_REQUIRED';
  /** No configured follow-up overdue/completion threshold exists in Qnalys. */
  followUpOverdueMaximum: null;
  followUpBasis: 'CONFIGURATION_REQUIRED';
  /** Canonical risk bands (existing agreed values — lib/metrics/riskMetrics). */
  riskBands: { medium: number; high: number; critical: number };
  riskBasis: 'CANONICAL_RISK';
}
