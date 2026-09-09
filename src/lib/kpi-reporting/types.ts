// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Type Contracts (Phase 2)
//
//  REPORTING ONLY. This module is a presentation/aggregation layer
//  on top of the existing configurable KPI Framework (Phase 1) and
//  the existing Quality KPI engine. HARD RULES (spec §33):
//
//    • The KPI engine (lib/kpi-framework + lib/metrics/kpiMetrics)
//      remains the SINGLE source of truth. Nothing here recomputes
//      a raw score, a weight product, or a contribution. Values are
//      consumed verbatim from engine results / frozen snapshots or
//      built through the engine's own builders.
//    • Weights come from `component.weight` of the resolved scheme —
//      NO hardcoded 15% anywhere in reporting code (spec §27).
//    • Missing data is NEVER presented as 0 — explicit statuses
//      only (spec §12).
//    • Closed months are reported from their FROZEN snapshot
//      verbatim — current scheme changes can never alter history
//      (spec §9/§26).
// ══════════════════════════════════════════════════════════════

import type {
  EmployeeKpiOutcomeStatus,
} from '@/lib/kpi-framework/employee-result';
import type {
  KpiComponentResult,
  KpiComponentResultStatus,
  KpiOverallStatus,
} from '@/lib/kpi-framework/types';

// Re-exported so reporting consumers can import the framework status
// vocabularies from this barrel without reaching into the engine.
export type { KpiComponentResultStatus, KpiOverallStatus };
import type { QualityObservation } from '@/types/quality-kpi';
import type { ClassifiedEvidence } from '@/lib/quality-observations/evidence';

// ─────────────────────────────────────────────────────────────
//  §8  Value basis — MTD / LIVE / FINALIZED
// ─────────────────────────────────────────────────────────────

/**
 * Where a reported value came from (spec §7/§8):
 *
 *  - `FINALIZED` — the month snapshot is CLOSED; values are the
 *    frozen snapshot values (immutable, reproducible).
 *  - `MTD`       — Month-To-Date: the live computation of the
 *    CURRENT calendar month through "now". Never labeled FINAL
 *    unless the existing Month Close process has run.
 *  - `LIVE`      — a live computation of a month that is neither
 *    closed nor the current month (a past month that was never
 *    closed). Usable, but must always surface "NOT FINALIZED".
 */
export type KpiValueBasis = 'MTD' | 'LIVE' | 'FINALIZED';

/** The five logically separated reports (spec §3). */
export type KpiReportKind = 'EMPLOYEE' | 'MONTHLY' | 'MTD' | 'HISTORICAL' | 'SUMMARY';

// ─────────────────────────────────────────────────────────────
//  §12  Display status vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * Row/employee-level KPI display status. Reuses the framework's
 * component-status vocabulary plus the explicit scheme-resolution
 * failure outcomes (never collapsed into a fake value):
 *
 *  - FINALIZED   — frozen result from a closed month.
 *  - AVAILABLE   — live result with every ACTIVE component valued
 *                  (future: full 100% KPI).
 *  - INCOMPLETE  — result exists but not every ACTIVE component has
 *                  a value (current config: Quality only → exactly
 *                  this state, spec §14).
 *  - PENDING     — employee eligible for the period but the KPI has
 *                  not been calculated yet (no quality data / no
 *                  result row). NEVER rendered as 0%.
 *  - ZERO        — quality engine produced a real score of exactly 0.
 *                  (A computed value — not missing.)
 *  - NOT_ELIGIBLE— employee was not employed in the period
 *                  (post-archive exclusion, spec §11).
 *  - NO_SCHEME / AMBIGUOUS / OVERRIDE_NOT_RESOLVABLE — explicit
 *                  scheme-resolution failures (no fabricated result).
 */
export type KpiReportRowStatus =
  | 'AVAILABLE'
  | 'PENDING'
  | 'INCOMPLETE'
  | 'NOT_ELIGIBLE'
  | 'ZERO'
  | 'FINALIZED'
  | 'NO_SCHEME'
  | 'AMBIGUOUS'
  | 'OVERRIDE_NOT_RESOLVABLE';

/** Deterministic sort rank for the status column (lowest first). */
export const KPI_REPORT_STATUS_RANK: Readonly<Record<KpiReportRowStatus, number>> = {
  NOT_ELIGIBLE: 0,
  NO_SCHEME: 1,
  AMBIGUOUS: 2,
  OVERRIDE_NOT_RESOLVABLE: 3,
  PENDING: 4,
  ZERO: 5,
  INCOMPLETE: 6,
  AVAILABLE: 7,
  FINALIZED: 8,
};

// ─────────────────────────────────────────────────────────────
//  Employee identity (spec §4)
// ─────────────────────────────────────────────────────────────

export type KpiReportEmploymentStatus = 'active' | 'inactive' | 'archived' | 'unknown';

export interface KpiReportEmployeeInfo {
  employeeId: string;
  employeeName: string;
  /** Employee number ("001", "EMP-01") — null when unset. */
  employeeCode: string | null;
  department: string | null;
  /**
   * Team label resolved from the employee's CURRENT org node when
   * that node is a team/subteam; null otherwise. Deliberately NOT
   * dependent on the Organization Tree redesign (spec §19).
   */
  team: string | null;
  position: string | null;
  employmentStatus: KpiReportEmploymentStatus;
  /**
   * True when the employee is currently archived yet ELIGIBLE for
   * the reported period (historical visibility, spec §11).
   */
  archivedButEligible: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Quality slice (spec §4/§13) — raw score shown WITH its weight
// ─────────────────────────────────────────────────────────────

/**
 * The Quality component's reported slice, extracted from a full
 * engine result. `rawScore` and `weightedContribution` are ALWAYS
 * displayed together — never only the contribution (spec §13).
 * `weight` is the scheme component's configured weight verbatim.
 */
export interface KpiReportQualitySlice {
  componentId: string;
  name: string;
  status: KpiComponentResultStatus;
  /** 0–100 raw quality score; null = no value (PENDING/NOT_ELIGIBLE). */
  rawScore: number | null;
  /** Percent weight from the scheme component (never hardcoded). */
  weight: number;
  /** rawScore × weight / 100 — produced by the engine, verbatim. */
  weightedContribution: number | null;
  /** Maximum possible contribution (= weight). */
  maxContribution: number;
  observationCount: number;
  deductionPoints: number;
  bonusPoints: number;
}

// ─────────────────────────────────────────────────────────────
//  §10  Scheme version display (auditability)
// ─────────────────────────────────────────────────────────────

export interface KpiReportSchemeDisplay {
  schemeId: string;
  schemeName: string;
  schemeVersion: number;
  /** The quality component's configured weight (percent). */
  qualityWeight: number | null;
  /** True when taken from a FROZEN result (immutable). */
  frozen: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Monthly / MTD / Historical rows (spec §6)
// ─────────────────────────────────────────────────────────────

/** How the row's KPI values were sourced (auditability). */
export type KpiRowResultSource =
  | 'FROZEN_RESULT'  // frozen kpiResults entry — verbatim
  | 'DERIVED'        // legacy closed snapshot → engine's documented derived view
  | 'LIVE'           // live engine result (open month)
  | 'PENDING'        // eligible, no result yet
  | 'NOT_ELIGIBLE'   // excluded from the period
  | 'NO_SCHEME'      // eligible but scheme unresolvable (row carries no values)
  | 'AMBIGUOUS'
  | 'OVERRIDE_NOT_RESOLVABLE';

export interface KpiReportRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  team: string | null;
  position: string | null;
  employmentStatus: KpiReportEmploymentStatus;
  /** Currently archived but eligible for the reported period. */
  archivedButEligible: boolean;
  /** Quality slice — null when no quality component result exists. */
  quality: KpiReportQualitySlice | null;
  /** Σ weights of value-bearing components (engine output). */
  availableWeight: number | null;
  /** Σ contributions of the available set — NO zero-fill (engine output). */
  weightedTotal: number | null;
  /** Company-KPI overall status from the engine result (null = no result). */
  overallStatus: KpiOverallStatus | null;
  /** Single display badge (spec §12 vocabulary). */
  rowStatus: KpiReportRowStatus;
  /** Frozen when the source month is closed. */
  finalized: boolean;
  valueBasis: KpiValueBasis;
  resultSource: KpiRowResultSource;
  /** Scheme identity behind THIS row's result. */
  schemeId: string | null;
  schemeName: string | null;
  schemeVersion: number | null;
  /** Frozen timestamp when finalized. */
  finalizedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Filters & sorting (spec §19/§20)
// ─────────────────────────────────────────────────────────────

export type KpiMonthlySortKey = 'employeeName' | 'department' | 'team' | 'score' | 'status';

export interface KpiMonthlySort {
  key: KpiMonthlySortKey;
  direction: 'asc' | 'desc';
}

export interface KpiMonthlyFilters {
  /** Employee search: name / code / id substring (spec §20). */
  employeeQuery?: string;
  department?: string;
  team?: string;
  /** Display-status filter (spec §12 vocabulary). */
  status?: KpiReportRowStatus;
  /** Quality RAW score range (nulls never match a range filter). */
  minScore?: number;
  maxScore?: number;
  /**
   * §10 ARCHIVED EMPLOYEES: excluded from reports BY DEFAULT. When
   * true, currently-archived-yet-eligible employees get rows again
   * (always labelled "مؤرشف" in the UI/Excel). Default: excluded.
   */
  includeArchived?: boolean;
  /**
   * Server-side AUTHORIZED employee scope (M0.5): when present,
   * rows are narrowed to these ids BEFORE any other filter/sort —
   * authorization is never a client-side concern.
   */
  scopeLimit?: ReadonlyArray<string> | null;
}

// ─────────────────────────────────────────────────────────────
//  Monthly / MTD / Historical report payloads
// ─────────────────────────────────────────────────────────────

export interface KpiMonthlyTotals {
  /** Rows in the report (eligible employees after scope). */
  eligibleCount: number;
  withResult: number;
  available: number;
  zero: number;
  pending: number;
  incomplete: number;
  finalized: number;
  noScheme: number;
  /** Evaluated but excluded (not employed in the period). */
  notEligibleCount: number;
}

export interface KpiMonthlyReport {
  reportKind: 'MONTHLY' | 'MTD' | 'HISTORICAL';
  monthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  closedAt: string | null;
  closedByName: string | null;
  /**
   * True when a CLOSED snapshot had no frozen framework results
   * (pre-Phase-1 month) and rows were built through the engine's
   * documented DERIVED view.
   */
  derivedLegacy: boolean;
  /** Dominant scheme among the rows (null when none resolved). */
  scheme: KpiReportSchemeDisplay | null;
  /** "As of" day key for MTD reports (spec §7). */
  asOfDate: string | null;
  rows: KpiReportRow[];
  totals: KpiMonthlyTotals;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  §16/§17  Trend & comparative metrics
// ─────────────────────────────────────────────────────────────

export interface KpiTrendPoint {
  monthKey: string;
  valueBasis: KpiValueBasis;
  /** True when a valid result exists for this month. */
  available: boolean;
  /** Quality RAW score (0–100) — null when unavailable (never 0). */
  rawScore: number | null;
  /** Weighted quality contribution — null when unavailable. */
  weightedContribution: number | null;
  weight: number | null;
  rowStatus: KpiReportRowStatus;
  finalized: boolean;
  schemeId: string | null;
  schemeVersion: number | null;
}

/**
 * Month-over-month comparison in PERCENTAGE POINTS (spec §17) —
 * explicitly distinct from percentage growth, which is also provided
 * for completeness and must never be conflated with the delta.
 */
export interface KpiMomComparison {
  currentMonth: string;
  previousMonth: string;
  currentRawScore: number;
  previousRawScore: number;
  /** current − previous, in percentage points. */
  deltaPoints: number;
  /** Growth relative to the previous month (percent) — may be null. */
  growthPercent: number | null;
}

// ─────────────────────────────────────────────────────────────
//  §18/§32  Evidence traceability
// ─────────────────────────────────────────────────────────────

/** The per-observation KPI effect (existing quality data, reused). */
export interface KpiReportObservationEffect {
  /** The observation participates in KPI scoring at all. */
  applies: boolean;
  isBonus: boolean;
  points: number;
  /** Signed effect on the raw score (+bonus / −deduction), 0 when not counted. */
  signedPoints: number;
  /** True only when APPROVED (pending/rejected never affect the score). */
  counted: boolean;
}

export interface KpiReportObservation {
  id: string;
  observationDate: string;
  month: string;
  type: string;
  categoryName: string;
  severity: QualityObservation['severity'];
  /** Observation resolution status (open/in_review/resolved/closed). */
  status: QualityObservation['status'];
  approvalStatus: QualityObservation['approvalStatus'];
  notes: string;
  /** Safe classified evidence (empty | url | text). */
  evidence: ClassifiedEvidence;
  /** Related record reference (existing CAPA link — never duplicated). */
  relatedCapaId: string | null;
  effect: KpiReportObservationEffect;
}

/** Frozen engine evidence block (KpiComponentEvidence) when available. */
export interface KpiReportTraceability {
  source: string;
  origin: 'month_snapshot' | 'live_engine' | null;
  observationCount: number;
  deductionPoints: number;
  bonusPoints: number;
  /** True when the numbers above are the FROZEN close-time values. */
  frozen: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Employee KPI report payload (spec §4/§5/§31)
// ─────────────────────────────────────────────────────────────

export interface EmployeeKpiReport {
  reportKind: 'EMPLOYEE';
  employee: KpiReportEmployeeInfo;
  period: {
    monthKey: string;
    valueBasis: KpiValueBasis;
    /** Snapshot close timestamp when the month is finalized. */
    finalizedAt: string | null;
    /** Day key the report was generated for (MTD "through" date). */
    asOfDate: string;
  };
  /**
   * Explicit engine outcome — every business outcome is data, never
   * an exception: FROZEN_RESULT / RESOLVED / EMPLOYEE_NOT_FOUND /
   * NOT_ELIGIBLE_PERIOD / NO_SCHEME / AMBIGUOUS / OVERRIDE_NOT_RESOLVABLE.
   */
  outcomeStatus: EmployeeKpiOutcomeStatus;
  /** Arabic, human-readable explanation for non-RESOLVED outcomes. */
  message: string | null;
  scheme: KpiReportSchemeDisplay | null;
  /** Verbatim engine components (quality + explicit PENDING placeholders). */
  components: KpiComponentResult[];
  quality: KpiReportQualitySlice | null;
  availableWeight: number | null;
  weightedTotal: number | null;
  /** Company-KPI status — INCOMPLETE while future components are missing. */
  overallStatus: KpiOverallStatus | null;
  rowStatus: KpiReportRowStatus;
  traceability: KpiReportTraceability | null;
  evidence: {
    observations: KpiReportObservation[];
    counts: {
      total: number;
      approved: number;
      pending: number;
      rejected: number;
      /** Observations that actually affect the score (approved + applies). */
      scoring: number;
    };
  };
  trend: {
    months: KpiTrendPoint[];
    mom: KpiMomComparison | null;
  };
  /** §28 structured contract for the future Python/AI layer. */
  dataContract: KpiReportDataContract | null;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  §28  Data contract for the future Python/AI layer
// ─────────────────────────────────────────────────────────────

export interface KpiDataContractComponent {
  componentId: string;
  name: string;
  owner: string;
  rawScore: number | null;
  weight: number;
  weightedContribution: number | null;
  maxContribution: number;
  status: KpiComponentResultStatus;
  evidenceReferences: string[];
}

/**
 * Deterministic, evidence-referenced, fully serializable projection
 * of one employee/period KPI result. Structured exactly so a future
 * Python/AI consumer (and the future smart-analysis layer, §29) can
 * consume verified reporting data WITHOUT any AI being implemented
 * in this phase.
 */
export interface KpiReportDataContract {
  employeeId: string;
  period: string;
  schemeId: string;
  schemeVersion: number;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  finalizedAt: string | null;
  calculationVersion: string;
  components: KpiDataContractComponent[];
  availableWeight: number | null;
  weightedTotal: number | null;
  overallStatus: KpiOverallStatus | null;
  overallRowStatus: KpiReportRowStatus;
}

// ─────────────────────────────────────────────────────────────
//  §15  Management summary
// ─────────────────────────────────────────────────────────────

export interface KpiSummaryGroupBreakdown {
  key: string;
  label: string;
  employeeCount: number;
  avgRawScore: number | null;
  avgContribution: number | null;
}

export interface KpiManagementSummary {
  reportKind: 'SUMMARY';
  monthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  closedAt: string | null;
  /**
   * §15 — these are QUALITY KPI statistics. They must never be
   * presented as company-wide KPI statistics while only Quality is
   * available.
   */
  statisticsKind: 'QUALITY_KPI';
  label: string;
  counts: {
    eligible: number;
    available: number;
    zero: number;
    pending: number;
    incomplete: number;
    finalized: number;
    noScheme: number;
    archivedButEligible: number;
  };
  qualityAverages: {
    avgRawScore: number | null;
    avgContribution: number | null;
    highest: { employeeId: string; employeeName: string; rawScore: number } | null;
    lowest: { employeeId: string; employeeName: string; rawScore: number } | null;
  };
  departments: KpiSummaryGroupBreakdown[];
  teams: KpiSummaryGroupBreakdown[];
  generatedAt: string;
}
