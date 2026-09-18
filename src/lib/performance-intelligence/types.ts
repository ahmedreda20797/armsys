// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Type Layer (Phase 3)
//
//  A deterministic, READ-ONLY analytical dataset answering:
//  "What actually happened to this employee during the period?"
//
//  HARD RULES (Phase-3 spec):
//    • FACTS ONLY. Every value is a structured fact derived from
//      existing canonical records. NO narrative text, NO
//      interpretation ("performed well", "needs improvement"…),
//      NO business-conclusion inference. The future AI layer will
//      interpret these facts — this layer never does.
//    • NO duplication of source records and NO shadow copies:
//      every analytical fact references the existing record IDs
//      (EvidenceGraph) over the canonical collections.
//    • KPI numbers are consumed VERBATIM from the canonical engine
//      pipeline (lib/kpi-framework via lib/kpi-reporting) — never
//      recomputed here.
//    • Missing data is an explicit status, never a fabricated zero
//      (PENDING / NOT_AVAILABLE / null month points).
//    • Deterministic only: no AI, no heuristics, no psychological
//      inference — grouping keys come from actual stored fields.
//    • Fully serializable (stable contract for a future Python
//      analytics layer; Python never becomes the KPI source of
//      truth).
// ══════════════════════════════════════════════════════════════

import type { QualityObservation } from '@/types/quality-kpi';
import type {
  EmployeeKpiOutcomeStatus,
} from '@/lib/kpi-framework';
import type {
  KpiComponentResultStatus,
  KpiMomComparison,
  KpiOverallStatus,
  KpiReportRowStatus,
  KpiReportSchemeDisplay,
  KpiTrendPoint,
  KpiValueBasis,
} from '@/lib/kpi-reporting';

// ─────────────────────────────────────────────────────────────
//  §19  Relationship / data-quality vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * How reliably a domain's records are linked to the employee.
 * Uses ONLY relationships that actually exist in the data model:
 *   CONFIRMED     — the record carries a direct employee field
 *                   (qualityObservations.employeeId, complaints.employeeId,
 *                   capaCases.employeeId, followUps.employeeId,
 *                   travelDeals.employeeId, stored attendance results).
 *   INDIRECT      — linked only through a secondary reference
 *                   (capaCases.relatedEmployeeIds).
 *   NOT_AVAILABLE — no stored data for the dimension (e.g. no stored
 *                   attendance result for the month). Never a zero.
 */
export type RelationshipConfidence = 'CONFIRMED' | 'INDIRECT' | 'NOT_AVAILABLE';

/** A traceable pointer from analytical facts to source records. */
export interface EvidenceReference {
  /** The RTDB collection that OWNS the referenced records. */
  collection: string;
  recordIds: string[];
}

// ─────────────────────────────────────────────────────────────
//  §16  Employee identity & lifecycle facts
// ─────────────────────────────────────────────────────────────

export interface EmployeeIdentityFacts {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  /**
   * The employee's TEAM resolved from the ORGANIZATION TREE (nearest
   * team-type ancestor; subteams roll up). Null when the employee is
   * unassigned or no team node exists — callers render an explicit
   * unavailable state, never an invented label.
   */
  team: string | null;
  position: string | null;
  /** Existing lifecycle vocabulary (normalizeEmployeeStatus). */
  employmentStatus: 'active' | 'inactive' | 'archived' | 'unknown';
  /**
   * The canonical engine's eligibility verdict for the requested
   * period (no second lifecycle implementation).
   */
  eligibleForPeriod: boolean;
  /** Archived currently, yet eligible for the reported period. */
  archivedButEligible: boolean;
  /** Lifecycle timestamps exactly as stored (null when absent). */
  archivedAt: string | null;
  restoredAt: string | null;
  relationship: RelationshipConfidence;
}

export interface PerformancePeriod {
  monthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  finalizedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
//  §5  KPI facts — canonical engine values, verbatim
// ─────────────────────────────────────────────────────────────

/** The Quality component's facts (raw score shown WITH its weight). */
export interface KpiQualityFacts {
  componentId: string;
  name: string;
  status: KpiComponentResultStatus;
  /** 0–100 raw quality score; null = no value (never 0-filled). */
  rawScore: number | null;
  /** Percent weight from the CONFIGURED scheme component. */
  weight: number;
  /** rawScore × weight / 100 — engine output, verbatim. */
  weightedContribution: number | null;
  maxContribution: number;
  observationCount: number;
  deductionPoints: number;
  bonusPoints: number;
}

export interface KpiFacts {
  outcomeStatus: EmployeeKpiOutcomeStatus;
  /** Arabic engine explanation for non-value outcomes (verbatim). */
  message: string | null;
  scheme: KpiReportSchemeDisplay | null;
  quality: KpiQualityFacts | null;
  availableWeight: number | null;
  weightedTotal: number | null;
  overallStatus: KpiOverallStatus | null;
  rowStatus: KpiReportRowStatus;
  /** Framework calculation version stamped on the engine result. */
  calculationVersion: string | null;
  /** Provenance: the canonical KPI engine pipeline, consumed verbatim. */
  source: 'kpi_engine';
}

// ─────────────────────────────────────────────────────────────
//  §14/§15  Trend & period-comparison facts
// ─────────────────────────────────────────────────────────────

/**
 * Deterministic direction derived from the percentage-point MoM
 * delta (a labeled fact, not an interpretation): UP / DOWN / STABLE.
 */
export type TrendDirection = 'UP' | 'DOWN' | 'STABLE';

export interface ScoreTrendFacts {
  /** Calendar window (ascending) ending at the reported month. */
  windowMonths: string[];
  /** Canonical trend points — months without results stay unavailable. */
  points: KpiTrendPoint[];
  /** Current vs previous comparable month (null when either is unavailable). */
  mom: KpiMomComparison | null;
  direction: TrendDirection | null;
}

// ─────────────────────────────────────────────────────────────
//  §6  Quality observation analysis
// ─────────────────────────────────────────────────────────────

export interface CategoryCount {
  /** Stored categoryId (null when the record carries none). */
  categoryId: string | null;
  categoryName: string;
  count: number;
}

export interface MonthlyCount {
  month: string;
  count: number;
}

export interface ObservationAnalysisFacts {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  /** By the observation resolution status (open/in_review/resolved/closed). */
  byResolutionStatus: Record<string, number>;
  /** Fixed severity vocabulary — zeros mean "none observed", never fabricated records. */
  bySeverity: Record<QualityObservation['severity'], number>;
  /** By stored category (categoryId + categoryName as stored). */
  byCategory: CategoryCount[];
  /**
   * Months WITH data inside the analysis window, ascending.
   * Missing months are NOT manufactured (spec §14).
   */
  monthly: MonthlyCount[];
}

// ─────────────────────────────────────────────────────────────
//  §7  Repeated issue detection (deterministic grouping only)
// ─────────────────────────────────────────────────────────────

/**
 * One deterministic issue group. Grouping keys are EXISTING stored
 * fields: the observation category (categoryId — the same key the
 * canonical engine's categoryTotals uses, '_unclassified' fallback)
 * and the observation `type` string. No AI, no inferred taxonomy.
 */
export interface RepeatedIssueGroup {
  /** The stored grouping value verbatim ('_unclassified' when absent). */
  issueKey: string;
  /** Display label as stored (categoryName / type). */
  label: string;
  occurrenceCount: number;
  /** Earliest/latest stored observationDate (DD/MM/YYYY as stored). */
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  /** Traceable source records (qualityObservations ids). */
  observationIds: string[];
}

/**
 * Cross-month recurrence of the same issue key across the analysis
 * window (first/last are month keys here, not display dates).
 */
export interface WindowRepeatedIssueGroup {
  issueKey: string;
  label: string;
  occurrenceCount: number;
  /** How many DISTINCT months of the window contain the issue. */
  monthsPresent: number;
  firstMonth: string | null;
  lastMonth: string | null;
  observationIds: string[];
}

export interface RepeatedIssuesFacts {
  /** Documented grouping basis (data-model fields, not invented ones). */
  groupBasis: {
    category: 'categoryId';
    type: 'type';
  };
  /** Minimum occurrence count to qualify as repeated (default 2). */
  minOccurrences: number;
  /** Repeated groups WITHIN the reported period. */
  byCategory: RepeatedIssueGroup[];
  byType: RepeatedIssueGroup[];
  /** Same keys evaluated across the whole analysis window. */
  windowByCategory: WindowRepeatedIssueGroup[];
}

// ─────────────────────────────────────────────────────────────
//  §8  Quality deductions (payroll domain — separate from KPI points)
// ─────────────────────────────────────────────────────────────

export interface QualityDeductionRecordFacts {
  id: string;
  /** Stored date as-is. */
  date: string;
  month: string | null;
  type: string;
  description: string;
  deductionDays: number;
  deductionAmount: number;
  relatedCapaId: string | null;
}

export interface QualityDeductionFacts {
  count: number;
  /** Σ deductionDays (unit: days) — kept SEPARATE from amounts. */
  totalDays: number;
  /** Σ deductionAmount (monetary) — kept SEPARATE from days. */
  totalAmount: number;
  byType: CategoryCount[];
  /** Source records preserved verbatim (traceability). */
  records: QualityDeductionRecordFacts[];
}

// ─────────────────────────────────────────────────────────────
//  §9  Complaints  (Complaint → Employee direct field; Deal via dealId)
// ─────────────────────────────────────────────────────────────

export interface ComplaintFacts {
  /** Complaints carry a direct (optional) employeeId — CONFIRMED model. */
  relationship: RelationshipConfidence;
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  /** complaintType groups with count ≥ minOccurrences. */
  repeatedTypes: RepeatedIssueGroup[];
  resolvedOrClosed: number;
  stillOpen: number;
  /** Subset that also references a deal (dealId non-null). */
  viaDealCount: number;
  /**
   * Average days from createdAt to resolvedAt over resolved complaints
   * carrying both timestamps; null when none are measurable.
   */
  avgResolutionDays: number | null;
  /** Months WITH complaints inside the analysis window (no fabricated months). */
  monthly: MonthlyCount[];
}

// ─────────────────────────────────────────────────────────────
//  §10  CAPA  (direct employeeId + relatedEmployeeIds)
// ─────────────────────────────────────────────────────────────

export interface CapaFacts {
  /** CONFIRMED via capaCases.employeeId; secondary via relatedEmployeeIds. */
  relationship: RelationshipConfidence;
  /** Cases whose employeeId IS the employee (primary link). */
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  bySource: Record<string, number>;
  /** Canonical ACTIVE_CAPA_STATUSES count (lib/metrics/capaMetrics). */
  active: number;
  /** Canonical TERMINAL_CAPA_STATUSES count (closed/rejected). */
  terminal: number;
  /** Canonical isOverdueCAPA at generation time — never the stale stored field. */
  overdue: number;
  /** Mean canonical capaOverdueDays over the overdue set. */
  avgOverdueDays: number | null;
  correctiveStatus: Record<'not_started' | 'in_progress' | 'completed', number>;
  preventiveStatus: Record<'not_started' | 'in_progress' | 'completed', number>;
  closedCount: number;
  /** Mean days createdAt → closedAt over closed cases with both timestamps. */
  avgClosureDays: number | null;
  /** Cases linked ONLY through relatedEmployeeIds (INDIRECT). */
  indirectCount: number;
  /** Months WITH primary-link CAPA cases inside the analysis window. */
  monthly: MonthlyCount[];
}

// ─────────────────────────────────────────────────────────────
//  §11  Follow-ups  (canonical timing logic reused — no new "late")
// ─────────────────────────────────────────────────────────────

export interface FollowUpFacts {
  /** followUps.employeeId is mandatory — CONFIRMED model. */
  relationship: RelationshipConfidence;
  total: number;
  byStatus: Record<string, number>;
  /** Canonical ACTIVE_FOLLOWUP_STATUSES count. */
  active: number;
  /** Canonical TERMINAL_FOLLOWUP_STATUSES count. */
  terminal: number;
  /** Canonical isOverdueFollowUp(now) — computed on read. */
  overdue: number;
  /** Canonical isDueToday(now). */
  dueToday: number;
  /** Mean canonical followUpOverdueDays over the overdue set. */
  avgOverdueDays: number | null;
  /** resolved + closed. */
  completed: number;
  /** completed / total × 100 (null when total is 0). */
  completionRate: number | null;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  /** Months WITH follow-ups inside the analysis window (no fabricated months). */
  monthly: MonthlyCount[];
}

// ─────────────────────────────────────────────────────────────
//  §12  Travel deals  (operational facts only — no invented sales KPIs)
// ─────────────────────────────────────────────────────────────

export interface TravelDealFacts {
  /** travelDeals.employeeId is mandatory — CONFIRMED model. */
  relationship: RelationshipConfidence;
  total: number;
  /** The exact stored status vocabulary (note: 'canceled' spelling). */
  byStatus: Record<'upcoming' | 'in_progress' | 'completed' | 'canceled', number>;
  completed: number;
  canceled: number;
  /** upcoming + in_progress. */
  active: number;
  /** completed / total × 100 (null when total is 0). */
  completionRate: number | null;
  /** Months WITH departures inside the analysis window (no fabricated months). */
  monthly: MonthlyCount[];
}

// ─────────────────────────────────────────────────────────────
//  §13  Attendance — CONTEXT ONLY (never part of Quality KPI)
// ─────────────────────────────────────────────────────────────

export interface AttendanceContextFacts {
  /**
   * AVAILABLE only when a STORED monthly result exists
   * (attendanceResults — never recomputed from raw records).
   */
  status: 'AVAILABLE' | 'NOT_AVAILABLE';
  source: 'attendanceResults';
  result: {
    month: string;
    workDays: number;
    presentDays: number;
    lateDays: number;
    absentDays: number;
    exemptDays: number;
    unaccountedDays: number;
    totalMinutesLate: number;
    lateDeductionDays: number;
    absenceDeductionDays: number;
    attendanceDeductionDays: number;
    compliance: number;
    engineVersion: string;
    generatedAt: string | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────
//  §19  Dataset-level data quality
// ─────────────────────────────────────────────────────────────

export interface PerformanceDataQuality {
  /** The analysis window (trend + cross-month recurrence scope). */
  windowMonths: string[];
  /**
   * Records excluded because their period could not be attributed
   * deterministically (unparseable/absent month field). Surfaced,
   * never silently dropped and never guessed.
   */
  unattributedRecords: Array<{ collection: string; count: number }>;
  notes: string[];
}

// ─────────────────────────────────────────────────────────────
//  §17  Evidence graph
// ─────────────────────────────────────────────────────────────

export interface EvidenceGraph {
  /** monthSnapshots (source document) + kpiSchemes (resolved scheme). */
  kpi: EvidenceReference[];
  observations: EvidenceReference;
  deductions: EvidenceReference;
  complaints: EvidenceReference;
  capa: EvidenceReference;
  followUps: EvidenceReference;
  deals: EvidenceReference;
  /** Null when no stored attendance result exists. */
  attendance: EvidenceReference | null;
}

// ─────────────────────────────────────────────────────────────
//  §20  The employee-period analytical dataset
// ─────────────────────────────────────────────────────────────

export interface EmployeePerformanceDataset {
  datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE';
  employee: EmployeeIdentityFacts;
  period: PerformancePeriod;
  /** Canonical engine KPI facts for the period (always present with explicit outcomeStatus). */
  kpi: KpiFacts;
  trend: ScoreTrendFacts;
  quality: {
    observations: ObservationAnalysisFacts;
    repeatedIssues: RepeatedIssuesFacts;
    deductions: QualityDeductionFacts;
  };
  complaints: ComplaintFacts;
  capa: CapaFacts;
  followUps: FollowUpFacts;
  deals: TravelDealFacts;
  attendance: AttendanceContextFacts;
  dataQuality: PerformanceDataQuality;
  evidence: EvidenceGraph;
  generatedAt: string;
}
