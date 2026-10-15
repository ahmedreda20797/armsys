// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — Type Contract (مركز أداء الموظف)
//
//  A CONSUMER/ANALYSIS layer over the canonical domain engines. The
//  Hub NEVER recalculates business metrics:
//    • KPI / Quality  → lib/kpi-framework via lib/kpi-reporting
//                       (through lib/performance-intelligence)
//    • Attendance     → stored attendanceResults (canonical result)
//    • Risk           → lib/metrics computeRisk (THE one formula)
//    • HR deductions  → lib/employee-performance aggregateHrMonth
//    • Deals          → §DEAL-DATES canonical date dimensions
//    • Follow-ups     → lib/metrics followUpMetrics predicates
//    • Complaints     → lib/complaints canonical status layer
//    • CAPA           → lib/metrics capaMetrics predicates
//
//  HARD RULES (Hub spec):
//    • Missing data is an explicit status (INSUFFICIENT_DATA /
//      UNAVAILABLE), never a fabricated zero.
//    • Quality Observations ≠ Quality Deductions ≠ HR Deductions —
//      separate domains, never merged.
//    • Every insight carries evidence source pointers (page +
//      record ids) traceable through navigateTo/highlightId.
//    • Deterministic rules only — no AI, no opaque scoring, no
//      unsupported causal language (association wording only).
//    • Fully serializable (React Query / print safe).
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { RiskLevel, RiskResult } from '@/lib/metrics';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';

// ─────────────────────────────────────────────────────────────
//  Vocabularies
// ─────────────────────────────────────────────────────────────

/** The performance dimensions the Hub presents (data availability gated). */
export type HubDimensionKey =
  | 'quality'
  | 'followUp'
  | 'risk'
  | 'attendance'
  | 'businessOutput'
  | 'hr'
  | 'complaints'
  | 'capa';

/** Source domains for timeline events / evidence pointers. */
export type HubDomain =
  | 'quality'
  | 'followUp'
  | 'risk'
  | 'attendance'
  | 'deals'
  | 'hr'
  | 'complaints'
  | 'capa'
  | 'kpi';

/**
 §10 — dimension status. Missing data stays INSUFFICIENT_DATA —
 never 0%, never "bad".
 */
export type HubDimensionStatus =
  | 'STRONG'
  | 'STABLE'
  | 'IMPROVING'
  | 'NEEDS_ATTENTION'
  | 'DECLINING'
  | 'INSUFFICIENT_DATA';

/**
 §8 — current status. Describes the situation through dimensions;
 never a composite "employee score" (spec §30).
 */
export type HubOverviewStatus =
  | 'IMPROVING'
  | 'STABLE'
  | 'NEEDS_COACHING'
  | 'PERFORMANCE_IMPROVEMENT_REVIEW'
  | 'MANAGEMENT_REVIEW'
  | 'INSUFFICIENT_DATA';

/** §15 — deterministic, explainable pattern labels. */
export type HubPatternKind =
  | 'REPEATED'
  | 'PERSISTENT'
  | 'EMERGING'
  | 'IMPROVING'
  | 'DETERIORATING'
  | 'ISOLATED';

/** §24 — data-quality states. */
export type HubDataQualityState =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'MISSING'
  | 'RESTRICTED'
  | 'UNAVAILABLE';

/** Unit of a change metric (drives client formatting). */
export type HubChangeUnit = 'points' | 'count' | 'percent' | 'days' | 'score';

// ─────────────────────────────────────────────────────────────
//  Evidence primitives
// ─────────────────────────────────────────────────────────────

/**
 §33 — source traceability. Points at the CANONICAL owning page +
 record ids; the UI navigates through navigateTo(page, highlightId).
 Internal collections are never rendered — only the page pointers.
 */
export interface HubSourceRef {
  /** Canonical source domain (hub vocabulary, not a collection name). */
  domain: HubDomain;
  /** The Qnalys page that owns the record (navigateTo target). */
  page: string;
  /** The exact record ids on that page (highlightId targets). */
  recordIds: string[];
}

/** One evidence-backed analytical statement (strength / concern / area). */
export interface HubEvidenceItem {
  /** Deterministic rule id — the client renders the localized text. */
  key: string;
  /**
   * Stored business labels the sentence names (category/type labels as
   * stored) — data, never translated.
   */
  labels?: string[];
  /** Raw values for display (client formats through locale formatters). */
  values?: Record<string, number | null>;
  sources: HubSourceRef[];
}

/** §21 — one deterministic recommendation (max 5, evidence-based). */
export interface HubRecommendation {
  /** Recommendation rule id — localized client-side. */
  key: string;
  /** The evidence that triggered the recommendation. */
  rationale: HubEvidenceItem[];
}

// ─────────────────────────────────────────────────────────────
//  Dimensions / overview
// ─────────────────────────────────────────────────────────────

/** Headline metric of one dimension (client picks the label by key). */
export type HubDimensionMetric =
  | 'qualityPercent'
  | 'calculatedPoints'
  | 'followUpCompletion'
  | 'overdueFollowUps'
  | 'riskScore'
  | 'attendanceCompliance'
  | 'closedDeals'
  | 'hrDeductions'
  | 'openItems'
  | null;

/** Per-dimension typed display facts (the UI reads exactly its own key). */
export interface HubDimensionDetails {
  quality?: {
    /** Canonical engine quality raw score (null = no value, never 0). */
    qualityPercent: number | null;
    /** Engine weightedContribution (النقاط المحتسبة) — partial, never final KPI. */
    calculatedPoints: number | null;
    /** Engine evaluation status verbatim (null when no component). */
    kpiStatus: string | null;
    /** KPI incomplete — the calculated points are NOT the final KPI. */
    kpiIncomplete: boolean;
    observationsTotal: number;
    observationsApproved: number;
    qualityDeductions: number;
    repeatedIssues: number;
  };
  followUp?: {
    total: number;
    completed: number;
    overdue: number;
    active: number;
    completionRate: number | null;
  };
  risk?: {
    level: RiskLevel;
    score: number;
    /** Canonical breakdown factors with count > 0 (the "why" list). */
    signals: Array<{ factor: string; count: number; points: number }>;
  };
  attendance?: {
    status: 'AVAILABLE' | 'NOT_AVAILABLE';
    compliance: number | null;
    presentDays: number | null;
    lateDays: number | null;
    absentDays: number | null;
    attendanceDeductionDays: number | null;
  };
  businessOutput?: {
    /** DEAL_CLOSED dimension — closures with the employee in the period. */
    closedInPeriod: number;
    confirmedClosures: number;
    canceledClosures: number;
    /** Completed-status closures with unknown dealClosedAt (never attributed). */
    closuresUnknownMonth: number;
    /** Current operational deals (all-time status snapshot). */
    currentDeals: number;
  };
  hr?: {
    deductionCount: number;
    deductionDays: number;
    deductionAmount: number;
  };
  complaints?: {
    total: number;
    stillOpen: number;
    resolvedOrClosed: number;
  };
  capa?: {
    total: number;
    active: number;
    overdue: number;
    closedCount: number;
  };
}

/** One presented dimension row (status + headline metric + typed facts). */
export interface HubDimension {
  key: HubDimensionKey;
  status: HubDimensionStatus;
  metric: HubDimensionMetric;
  /** Headline value (null = not measurable — INSUFFICIENT_DATA, never 0). */
  value: number | null;
  previousValue: number | null;
  delta: number | null;
  details: HubDimensionDetails;
}

/** §8 performance overview. */
export interface HubOverview {
  status: HubOverviewStatus;
  /** Deterministic rule ids explaining the status (explainable, no opacity). */
  reasons: string[];
  positiveSignals: HubEvidenceItem[];
  concerns: HubEvidenceItem[];
  /** The strongest evidence-backed change vs the previous period. */
  mainChange: HubChangeItem | null;
}

// ─────────────────────────────────────────────────────────────
//  Changes / cross-signals / patterns
// ─────────────────────────────────────────────────────────────

/** §17 — one evidence-backed change (current vs previous period). */
export interface HubChangeItem {
  /** Metric rule id — client renders the localized metric label. */
  key: string;
  domain: HubDomain;
  direction: 'UP' | 'DOWN' | 'FLAT';
  current: number | null;
  previous: number | null;
  delta: number | null;
  unit: HubChangeUnit;
  /** True when higher is better (drives the semantic color client-side). */
  higherIsBetter: boolean;
  sources: HubSourceRef[];
}

/** §16 — deterministic co-movement between two dimensions. */
export interface HubCrossSignal {
  /** Cross-signal rule id — association wording localized client-side. */
  key: string;
  signals: [string, string];
  sources: HubSourceRef[];
}

/** §15 — one detected pattern (rule-based, explainable). */
export interface HubPattern {
  kind: HubPatternKind;
  domain: HubDomain;
  /** Stored business label (category/type name) when the pattern is issue-level. */
  label: string | null;
  occurrences: number | null;
  sources: HubSourceRef[];
}

// ─────────────────────────────────────────────────────────────
//  Timeline
// ─────────────────────────────────────────────────────────────

/** §11 — one unified timeline event (an analytical INDEX, not a copy). */
export interface HubTimelineEvent {
  /** Deterministic id: `${domain}:${recordId}`. */
  id: string;
  /** Sort key (YYYY-MM-DD where derivable, else ISO timestamp). */
  sortKey: string;
  /** Stored business date for display (verbatim as stored). */
  displayDate: string;
  domain: HubDomain;
  /** Event-type rule id (client renders the localized type label). */
  eventType: string;
  /** Stored business text (subject/type/category label) — never translated. */
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | null;
  /** Canonical status vocabulary key for i18n (raw stored value). */
  status: string | null;
  source: {
    page: string;
    highlightId: string | null;
    navParams: Record<string, string>;
  };
}

// ─────────────────────────────────────────────────────────────
//  Risk / HR blocks (server-gated)
// ─────────────────────────────────────────────────────────────

/**
 §18 — canonical Risk Engine projection. Null block = the viewer is
 not authorized for the risk section (server-withheld, never UI-hidden).
 */
export interface HubRiskBlock {
  status: 'AVAILABLE';
  level: RiskLevel;
  score: number;
  /** Canonical computeRisk breakdown factors with points > 0. */
  signals: Array<{ factor: string; count: number; points: number }>;
  previousScore: number | null;
  previousLevel: RiskLevel | null;
  source: 'risk_engine';
}

/** HR discipline block. Null block = HR section restricted server-side. */
export interface HubHrBlock {
  current: EmployeeHrMonthSummary | null;
  previous: EmployeeHrMonthSummary | null;
}

// ─────────────────────────────────────────────────────────────
//  Team benchmark
// ─────────────────────────────────────────────────────────────

/** One benchmark metric (aggregate team statistics only — §14). */
export interface TeamBenchmarkMetric {
  key: 'quality' | 'attendance' | 'deals' | 'followUpCompletion';
  employeeValue: number | null;
  teamAverage: number | null;
  difference: number | null;
  /** Employee's rank among team members with data (1 = best), null when n < 2. */
  rank: number | null;
  membersWithData: number;
}

export interface TeamBenchmarkBlock {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  unavailableReason: 'no_team' | 'insufficient_members' | null;
  teamName: string | null;
  /** Members evaluated (already scope-filtered by the caller). */
  memberCount: number;
  metrics: TeamBenchmarkMetric[];
}

// ─────────────────────────────────────────────────────────────
//  Data quality
// ─────────────────────────────────────────────────────────────

/** §24 — one data-quality entry (material limitations only). */
export interface HubDataQualityItem {
  domain: HubDomain | 'teamBenchmark';
  state: HubDataQualityState;
  /** Limitation rule id (client renders the localized note). */
  note: string | null;
}

// ─────────────────────────────────────────────────────────────
//  The dataset
// ─────────────────────────────────────────────────────────────

export interface EmployeePerformanceHubDataset {
  datasetKind: 'EMPLOYEE_PERFORMANCE_HUB';
  employee: EmployeePerformanceDataset['employee'];
  /** The canonical org-tree context (verbatim from the identity facts). */
  organizationContext: {
    department: string | null;
    team: string | null;
    manager: string | null;
    company: string | null;
  };
  period: {
    /** Selected period (YYYY-MM). */
    monthKey: string;
    /** The comparison period (strictly the previous calendar month). */
    previousMonthKey: string;
    valueBasis: EmployeePerformanceDataset['period']['valueBasis'];
    finalized: boolean;
  };
  /** Canonical facts — current period (verbatim dataset). */
  current: EmployeePerformanceDataset;
  /** Canonical facts — previous calendar month (null when the dataset could not be built). */
  previous: EmployeePerformanceDataset | null;
  overview: HubOverview;
  dimensions: HubDimension[];
  changes: HubChangeItem[];
  crossSignals: HubCrossSignal[];
  patterns: HubPattern[];
  strengths: HubEvidenceItem[];
  developmentAreas: HubEvidenceItem[];
  recommendations: HubRecommendation[];
  timeline: HubTimelineEvent[];
  teamBenchmark: TeamBenchmarkBlock | null;
  /** Server-gated: null when the viewer lacks the risk section. */
  risk: HubRiskBlock | null;
  /** Server-gated: null when the viewer lacks the HR deductions section. */
  hr: HubHrBlock | null;
  dataQuality: HubDataQualityItem[];
  generatedAt: string;
}

/** Service input (route or tests). */
export interface GetEmployeePerformanceHubDatasetInput {
  employeeId: string;
  /** YYYY-MM selected period. */
  monthKey: string;
  now?: Date;
  /** Minimum occurrences for a repeated issue (default 2 — canonical). */
  minOccurrences?: number;
  /**
   * Team-benchmark employee authorization (from the caller's resolved
   * employee scope). Absent = the benchmark is skipped (unavailable).
   */
  scopeIncludes?: (employeeId: string) => boolean;
  /** Risk block produced by the caller (route) after section gating. */
  risk?: HubRiskBlock | null;
  /** HR block produced by the caller (route) after section gating. */
  hr?: HubHrBlock | null;
}
