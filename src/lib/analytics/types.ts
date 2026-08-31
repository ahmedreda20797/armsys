// ══════════════════════════════════════════════════════════════
//  Python Analytics — Output Contract (Phase 5)
//
//  TypeScript mirror of the JSON produced by
//  python-analytics/employee_analytics.py. This is the ANALYTICS
//  OUTPUT contract only — the domain models stay owned by the
//  Performance Intelligence layer (spec §3: do not duplicate
//  domain models). Python is an analytics layer, never a KPI
//  source of truth (spec §1/§5).
//
//  FACT / ANALYSIS / INTERPRETATION layers (spec §21): every value
//  below is FACT (verbatim engine output) or ANALYSIS
//  (deterministic statistics). No interpretation exists anywhere
//  in this contract — that belongs to a future AI layer.
// ══════════════════════════════════════════════════════════════

export const ANALYTICS_SCHEMA_VERSION = 1;
export const ANALYTICS_KIND = 'EMPLOYEE_PERFORMANCE_ANALYTICS';

export type AnalyticsConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';

export interface AnalyticsEvidenceRef {
  collection: string;
  recordIds: string[];
  completeRecordList: boolean;
}

// ── §7 Trend analysis ─────────────────────────────────────────
export interface AnalyticsTrendStats {
  metric: string;
  count: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  stdDev: number | null;
  stdDevBasis: string | null;
  slopePerMonth: number | null;
  slopeUnit: string | null;
  direction: 'UP' | 'DOWN' | 'STABLE' | null;
  coefficientOfVariationPct: number | null;
  firstMonth: string | null;
  lastMonth: string | null;
}

export interface AnalyticsPeriodOverPeriod {
  fromMonth: string;
  toMonth: string;
  deltaPoints: number | null;
}

export interface AnalyticsTrendAnalysis {
  status: 'OK' | 'INSUFFICIENT_DATA';
  availableMonths: number;
  missingMonths: string[];
  stats: AnalyticsTrendStats | null;
  periodOverPeriod: AnalyticsPeriodOverPeriod[];
  momEcho: Record<string, unknown> | null;
  directionEcho: 'UP' | 'DOWN' | 'STABLE' | null;
  confidence: AnalyticsConfidence;
  noteCodes: string[];
  mtdPartial: boolean;
}

// ── §8/§9 Distribution + repeated-issue patterns ──────────────
export interface AnalyticsDistributionItem {
  key: string | null;
  label: string;
  count: number;
  sharePct: number | null;
}

export interface AnalyticsDistribution {
  total: number;
  items: AnalyticsDistributionItem[];
  concentration: AnalyticsDistributionItem[];
}

export interface AnalyticsMonthlySeries {
  window: string[];
  counts: number[];
}

export interface AnalyticsObservationPattern {
  status: 'OK' | 'EMPTY';
  total: number;
  approvalDistribution: { approved: number; pending: number; rejected: number };
  byCategory: AnalyticsDistribution;
  bySeverity: AnalyticsDistribution;
  byResolutionStatus: AnalyticsDistribution;
  monthlySeries: AnalyticsMonthlySeries;
  monthlySlopePerMonth: number | null;
  noteCodes: string[];
}

export interface AnalyticsPeriodGroup {
  issueKey: string | null;
  label: string | null;
  occurrenceCount: number;
  frequencyPctOfObservations: number | null;
  recurrenceIntervalDays: number | null;
  observationIds: string[];
}

export interface AnalyticsWindowGroup {
  issueKey: string | null;
  label: string | null;
  occurrenceCount: number;
  monthsPresent: number;
  monthsPresentPct: number | null;
  windowSpanMonths: number | null;
  observationIds: string[];
}

export interface AnalyticsRepeatedIssuePattern {
  groupBasisEcho: Record<string, unknown> | null;
  minOccurrencesEcho: number | null;
  byCategory: AnalyticsPeriodGroup[];
  byType: AnalyticsPeriodGroup[];
  windowByCategory: AnalyticsWindowGroup[];
  noteCodes: string[];
}

export interface AnalyticsDeductionPattern {
  status: 'OK' | 'EMPTY';
  count: number;
  totalDays: number | null;
  totalAmount: number | null;
  avgDaysPerRecord: number | null;
  byType: AnalyticsDistribution;
  noteCodes: string[];
}

// ── §12-§16 Domain analyses ───────────────────────────────────
export interface AnalyticsComplaintAnalysis {
  relationship: string;
  status: 'OK' | 'EMPTY' | 'NOT_CONFIRMED_ATTRIBUTION';
  total: number;
  byStatus: AnalyticsDistribution;
  byType: AnalyticsDistribution;
  bySeverity: AnalyticsDistribution;
  resolution: {
    resolvedOrClosed: number;
    stillOpen: number;
    avgResolutionDays: number | null;
  };
  monthlySeries: AnalyticsMonthlySeries;
  countTrend: { slopePerMonth: number | null; direction: 'UP' | 'DOWN' | 'STABLE' | null } | null;
  noteCodes: string[];
}

export interface AnalyticsCapaAnalysis {
  relationship: string;
  status: 'OK' | 'EMPTY';
  total: number;
  active: number;
  terminal: number;
  overdueRatePct: number | null;
  byStatus: AnalyticsDistribution;
  byPriority: AnalyticsDistribution;
  bySource: AnalyticsDistribution;
  closure: {
    closedCount: number;
    avgClosureDays: number | null;
    avgOverdueDays: number | null;
  };
  monthlySeries: AnalyticsMonthlySeries;
  monthlySlopePerMonth: number | null;
  noteCodes: string[];
}

export interface AnalyticsFollowUpAnalysis {
  relationship: string;
  status: 'OK' | 'EMPTY';
  total: number;
  overdueRatePct: number | null;
  completionRatePctEcho: number | null;
  byStatus: AnalyticsDistribution;
  byType: AnalyticsDistribution;
  byPriority: AnalyticsDistribution;
  monthlySeries: AnalyticsMonthlySeries;
  monthlySlopePerMonth: number | null;
  noteCodes: string[];
}

export interface AnalyticsDealAnalysis {
  relationship: string;
  status: 'OK' | 'EMPTY';
  total: number;
  byStatus: AnalyticsDistribution;
  cancellationRatePct: number | null;
  completionRatePctEcho: number | null;
  monthlySeries: AnalyticsMonthlySeries;
  monthlySlopePerMonth: number | null;
  noteCodes: string[];
}

export interface AnalyticsAttendanceAnalysis {
  status: string;
  analysisRole: 'CONTEXT_ONLY';
  metrics: Record<string, number | string | null> | null;
  noteCodes: string[];
}

// ── §10 Anomalies ─────────────────────────────────────────────
export interface AnalyticsAnomaly {
  anomalyType: string;
  metric: string;
  month: string | null;
  observedValue: number | null;
  expectedRange: {
    low: number | null;
    high: number | null;
    medianBaseline?: number | null;
    method: string;
  };
  zScore: number | null;
  direction: 'ABOVE_EXPECTED' | 'BELOW_EXPECTED';
  severity: 'HIGH' | 'MEDIUM';
  confidence: AnalyticsConfidence;
  noteCode: string;
  supportingEvidence: AnalyticsEvidenceRef[];
}

// ── §17/§18 Cross-domain + correlation ────────────────────────
export interface AnalyticsCrossDomainPattern {
  patternType: 'TEMPORAL_ASSOCIATION';
  domainA: string;
  domainB: string;
  sharedIncreaseMonthIndices: number[];
  sharedIncreaseMonths: string[];
  monthsAnalyzed: number;
  confidence: AnalyticsConfidence;
  noteCode: string;
}

export interface AnalyticsCorrelation {
  variables: [string, string];
  coefficient: number;
  sampleSize: number;
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NEGLIGIBLE';
  confidence: AnalyticsConfidence;
  noteCode: string;
  limitations: string[];
}

// ── §6 Period comparison ──────────────────────────────────────
export interface AnalyticsPeriodComparison {
  status: 'OK' | 'INSUFFICIENT_DATA';
  current: Record<string, number | string> | null;
  previous: Record<string, number | string> | null;
  deltas: Record<string, number>;
  kpiRawScoreDeltaPoints: number | null;
  noteCode: string | null;
}

// ── §19 Data quality ──────────────────────────────────────────
export interface AnalyticsInsufficientSample {
  area: string;
  reason: string;
  required?: number;
  actual?: number;
  detail?: string;
}

export interface AnalyticsDataQuality {
  windowMonths: string[];
  missingData: Array<{ area: string; detail: string }>;
  ambiguousRelationships: Array<{ domain: string; relationship: string }>;
  unattributedRecords: Array<{ collection: string; count: number }>;
  insufficientSamples: AnalyticsInsufficientSample[];
  unavailableMetrics: string[];
  notes: string[];
  sourceNotesEcho: string[];
}

// ── §5 KPI echo (verbatim, immutability proof) ────────────────
export interface AnalyticsKpiFactsEcho {
  source: string | null;
  rowStatus: string | null;
  overallStatus: string | null;
  componentId: string | null;
  name: string | null;
  status: string | null;
  rawScore: number | null;
  weight: number | null;
  weightedContribution: number | null;
  maxContribution: number | null;
  calculationVersion: string | null;
}

// ── Full result ───────────────────────────────────────────────
export interface EmployeeAnalyticsResult {
  schemaVersion: number;
  analyticsKind: typeof ANALYTICS_KIND;
  /** Engine build identifier (Phase 5.2 spec §26) — diagnostics only. */
  analyticsEngineVersion: string;
  deterministic: true;
  status: 'OK';
  input: {
    employeeId: string | null;
    employeeName: string | null;
    employmentStatus: string | null;
    archivedButEligible: boolean | null;
    monthKey: string | null;
    valueBasis: string | null;
    finalized: boolean | null;
    windowMonths: string[];
    datasetGeneratedAt: string | null;
  };
  kpiFactsEcho: AnalyticsKpiFactsEcho;
  trendAnalysis: AnalyticsTrendAnalysis;
  patternAnalysis: {
    observations: AnalyticsObservationPattern;
    repeatedIssues: AnalyticsRepeatedIssuePattern;
    deductions: AnalyticsDeductionPattern;
  };
  anomalies: AnalyticsAnomaly[];
  distributionAnalysis: {
    complaints: AnalyticsComplaintAnalysis;
    capa: AnalyticsCapaAnalysis;
    followUps: AnalyticsFollowUpAnalysis;
    deals: AnalyticsDealAnalysis;
    attendance: AnalyticsAttendanceAnalysis;
  };
  periodComparison: AnalyticsPeriodComparison;
  crossDomainPatterns: AnalyticsCrossDomainPattern[];
  correlations: AnalyticsCorrelation[];
  dataQuality: AnalyticsDataQuality;
  evidenceReferences: AnalyticsEvidenceRef[];
  overallConfidence: AnalyticsConfidence;
  thresholds: Record<string, number>;
  noteCodes: string[];
  interpretationBoundary: string;
}

// ── API response shape (route → client) ───────────────────────
// Phase 5.2 (spec §10): the four failure states stay DISTINCT —
// UNAVAILABLE (service cannot be reached / disabled), TIMEOUT
// (spec §11 explicit timeout verdict), ERROR (executed but failed)
// and INSUFFICIENT_DATA (an analytical result that lives INSIDE the
// OK analytics payload, never a transport state).
export type AnalyticsApiResponse =
  | { status: 'OK'; analytics: EmployeeAnalyticsResult }
  | { status: 'ANALYTICS_UNAVAILABLE'; reason: string; message: string }
  | { status: 'ANALYTICS_TIMEOUT'; reason: 'TIMEOUT'; message: string }
  | { status: 'ANALYTICS_ERROR'; reason: string; message: string };
