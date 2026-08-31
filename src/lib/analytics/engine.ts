// ══════════════════════════════════════════════════════════════
//  TypeScript Analytics Engine (Phase 5.3)
//
//  CANONICAL production analytics implementation — an exact
//  behavioral port of the verified reference engine
//  (python-analytics/employee_analytics.py, kept ONLY for parity
//  testing; the production system no longer depends on Python).
//
//  ARCHITECTURAL BOUNDARY (unchanged from Phase 5):
//    Firebase → KPI Engine → Performance Intelligence dataset
//      → THIS ENGINE (analysis only) → EmployeeAnalyticsResult
//    • NEVER recalculates KPI values — kpiFactsEcho is verbatim.
//    • FACT + ANALYSIS only. No AI, no narratives, no judgment.
//    • Deterministic: same input → same output, always.
//    • Pure: no I/O, no clock, no randomness, no React, no Firebase.
// ══════════════════════════════════════════════════════════════

import type {
  AnalyticsAnomaly,
  AnalyticsAttendanceAnalysis,
  AnalyticsConfidence,
  AnalyticsCrossDomainPattern,
  AnalyticsCorrelation,
  AnalyticsDataQuality,
  AnalyticsEvidenceRef,
  AnalyticsInsufficientSample,
  AnalyticsKpiFactsEcho,
  AnalyticsMonthlySeries,
  AnalyticsObservationPattern,
  AnalyticsPeriodComparison,
  AnalyticsPeriodGroup,
  AnalyticsRepeatedIssuePattern,
  AnalyticsTrendAnalysis,
  AnalyticsWindowGroup,
  EmployeeAnalyticsResult,
} from './types';
import {
  categoryDistribution,
  monthlySeries,
  recordDistribution,
  type AnalyticsDistribution,
} from './distributions';
import {
  directionFromSlope,
  leastSquaresSlope,
  mean,
  median,
  monthIndexOf,
  parseStoredDateToDayNumber,
  pearson,
  pct,
  r,
  robustBaseline,
  sampleStddev,
  seriesIncreases,
} from './numeric';

// ── Engine identity ───────────────────────────────────────────
export const ANALYTICS_ENGINE_VERSION = '2.0.0'; // Phase 5.3 — TypeScript engine build

const SCHEMA_VERSION = 1;
const DATASET_KIND = 'EMPLOYEE_PERFORMANCE_INTELLIGENCE';
const ANALYTICS_KIND = 'EMPLOYEE_PERFORMANCE_ANALYTICS';

// ── Documented deterministic thresholds (reference §11) ───────
const TREND_MIN_MONTHS = 3;
const ANOMALY_BASELINE_MIN_MONTHS = 5;
const ANOMALY_Z_THRESHOLD = 3.0;
const ANOMALY_Z_HIGH_SEVERITY = 5.0;
const SCORE_DROP_THRESHOLD_POINTS = 10.0;
const SCORE_DROP_HIGH_SEVERITY_POINTS = 20.0;
const CORRELATION_MIN_MONTHS = 8;
const CROSS_DOMAIN_MIN_MONTHS = 4;
const CROSS_DOMAIN_MIN_SHARED_INCREASES = 2;
const DIRECTION_SLOPE_THRESHOLD_PP = 0.5;

export const ANALYTICS_THRESHOLDS: Record<string, number> = {
  trendMinMonths: TREND_MIN_MONTHS,
  anomalyBaselineMinMonths: ANOMALY_BASELINE_MIN_MONTHS,
  anomalyZThreshold: ANOMALY_Z_THRESHOLD,
  scoreDropThresholdPoints: SCORE_DROP_THRESHOLD_POINTS,
  correlationMinMonths: CORRELATION_MIN_MONTHS,
  crossDomainMinMonths: CROSS_DOMAIN_MIN_MONTHS,
  crossDomainMinSharedIncreases: CROSS_DOMAIN_MIN_SHARED_INCREASES,
  concentrationMinCount: 3,
  concentrationMinSharePct: 40.0,
  directionSlopeThresholdPpPerMonth: DIRECTION_SLOPE_THRESHOLD_PP,
};

const ANALYSIS_DOMAINS = ['observations', 'complaints', 'capa', 'followUps', 'deals'] as const;
type AnalysisDomain = (typeof ANALYSIS_DOMAINS)[number];

const NOTE_CODES: Record<string, string> = {
  ANOMALY_NOT_WRONGDOING:
    'An anomaly is a statistical deviation, not a judgment about the employee.',
  ASSOCIATION_NOT_CAUSATION:
    'Temporal association only — no causal claim is made or implied.',
  CORRELATION_NOT_CAUSATION: 'Correlation is not causation.',
  MTD_PARTIAL_MONTH:
    'The reported month is MTD (partial); partial counts bias month-level statistics, so those analyses are skipped.',
  ABSENT_MONTH_IS_ZERO_RECORDS:
    'Within the analysis window, a month with no stored records counts as 0 records (a stored fact). KPI score months without results are never zero-filled.',
};

const NOTE_CODE_KEYS = Object.keys(NOTE_CODES).sort();

const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INSUFFICIENT_DATA: 0,
};

// ══════════════════════════════════════════════════════════════
//  Defensive dataset readers (JSON-shaped input, fail-closed)
// ══════════════════════════════════════════════════════════════

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : {};
}

function intOr(value: unknown, fallback = 0): number {
  const n = numOf(value);
  return n === null ? fallback : Math.trunc(n);
}

function numOf(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function windowOf(dataset: Rec): string[] {
  const dq = asRec(dataset.dataQuality);
  const fromDq = strList(dq.windowMonths).filter((m) => m.length > 0);
  if (fromDq.length > 0) return fromDq;
  const trend = asRec(dataset.trend);
  return strList(trend.windowMonths).filter((m) => m.length > 0);
}

// ══════════════════════════════════════════════════════════════
//  Input validation (exact port of _validate_envelope)
// ══════════════════════════════════════════════════════════════

export type AnalyticsEnvelopeError = {
  code:
    | 'INVALID_ENVELOPE'
    | 'UNSUPPORTED_SCHEMA_VERSION'
    | 'MISSING_DATASET'
    | 'UNSUPPORTED_DATASET_KIND'
    | 'MISSING_DATASET_FIELDS';
  message: string;
};

const REQUIRED_DATASET_FIELDS = [
  'employee', 'period', 'kpi', 'trend', 'quality',
  'complaints', 'capa', 'followUps', 'deals', 'attendance',
  'dataQuality', 'evidence',
] as const;

/** Fail-closed envelope validation — identical codes/messages to the reference engine. */
export function validateAnalyticsEnvelope(envelope: unknown):
  { ok: true; dataset: Rec } | { ok: false; error: AnalyticsEnvelopeError } {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return { ok: false, error: { code: 'INVALID_ENVELOPE', message: 'Input must be a JSON object.' } };
  }
  const env = envelope as Rec;
  if (env.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_SCHEMA_VERSION', message: `schemaVersion must be ${SCHEMA_VERSION}.` },
    };
  }
  const dataset = env.dataset;
  if (typeof dataset !== 'object' || dataset === null || Array.isArray(dataset)) {
    return { ok: false, error: { code: 'MISSING_DATASET', message: 'dataset object is required.' } };
  }
  const ds = dataset as Rec;
  if (ds.datasetKind !== DATASET_KIND) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_DATASET_KIND',
        message: `datasetKind must be ${DATASET_KIND}.`,
      },
    };
  }
  const missing = REQUIRED_DATASET_FIELDS.filter((k) => !(k in ds));
  if (missing.length > 0) {
    return {
      ok: false,
      error: { code: 'MISSING_DATASET_FIELDS', message: `Missing dataset fields: ${missing.join(', ')}` },
    };
  }
  return { ok: true, dataset: ds };
}

// ══════════════════════════════════════════════════════════════
//  §7 Trend analysis
// ══════════════════════════════════════════════════════════════

export function analyzeTrend(dataset: Rec, window: string[]): AnalyticsTrendAnalysis {
  const trend = asRec(dataset.trend);
  const points = Array.isArray(trend.points) ? trend.points : [];

  const available = new Map<string, number>();
  for (const p of points) {
    if (typeof p !== 'object' || p === null) continue;
    const point = p as Rec;
    if (!point.available) continue;
    const score = numOf(point.rawScore);
    if (score === null) continue;
    if (typeof point.monthKey === 'string') {
      available.set(point.monthKey, score);
    }
  }

  const missingMonths = window.filter((m) => !available.has(m));
  const ordered: Array<[string, number]> = window
    .filter((m) => available.has(m))
    .map((m) => [m, available.get(m) as number]);
  const scores = ordered.map(([, v]) => v);
  const n = scores.length;

  const result: AnalyticsTrendAnalysis = {
    status: n >= TREND_MIN_MONTHS ? 'OK' : 'INSUFFICIENT_DATA',
    availableMonths: n,
    missingMonths,
    stats: null,
    periodOverPeriod: [],
    momEcho: typeof trend.mom === 'object' && trend.mom !== null && !Array.isArray(trend.mom)
      ? (trend.mom as Record<string, unknown>)
      : null,
    directionEcho: (trend.direction as AnalyticsTrendAnalysis['directionEcho']) ?? null,
    confidence: 'INSUFFICIENT_DATA',
    noteCodes: [],
    mtdPartial: false,
  };

  // Period-over-period deltas over consecutive AVAILABLE months only —
  // gaps never produce a delta and never produce a zero-filled score.
  for (let i = 1; i < ordered.length; i++) {
    const [prevM, prevV] = ordered[i - 1];
    const [curM, curV] = ordered[i];
    result.periodOverPeriod.push({
      fromMonth: prevM,
      toMonth: curM,
      deltaPoints: r(curV - prevV, 2),
    });
  }

  if (n < TREND_MIN_MONTHS) {
    result.noteCodes.push('INSUFFICIENT_TREND_DATA');
    return result;
  }

  const meanV = mean(scores) as number;
  const medianV = median(scores) as number;
  const minV = Math.min(...scores);
  const maxV = Math.max(...scores);
  const stdV = sampleStddev(scores);
  const pairs = ordered.map(([m, v]) => [monthIndexOf(window, m) as number, v] as [number, number]);
  const slope = leastSquaresSlope(pairs);
  const cv = stdV !== null && meanV !== 0 ? r((stdV / meanV) * 100, 1) : null;

  result.stats = {
    metric: 'kpi.quality.rawScore',
    count: n,
    mean: r(meanV),
    median: r(medianV),
    min: r(minV),
    max: r(maxV),
    range: r(maxV - minV),
    stdDev: r(stdV),
    stdDevBasis: 'SAMPLE',
    slopePerMonth: r(slope, 3),
    slopeUnit: 'ppPerMonth',
    direction: directionFromSlope(slope),
    coefficientOfVariationPct: cv,
    firstMonth: ordered[0][0],
    lastMonth: ordered[ordered.length - 1][0],
  };
  result.confidence = n >= 6 ? 'HIGH' : 'MEDIUM';
  return result;
}

// ══════════════════════════════════════════════════════════════
//  §8 Observation patterns / §12-§16 domain analyses
// ══════════════════════════════════════════════════════════════

export function analyzeObservations(
  dataset: Rec,
  window: string[],
  outsideMonths: Set<string>,
): AnalyticsObservationPattern {
  const quality = asRec(dataset.quality);
  const obs = asRec(quality.observations);

  const byCategory = categoryDistribution(obs.byCategory);
  const bySeverity = recordDistribution(obs.bySeverity);
  const byResolution = recordDistribution(obs.byResolutionStatus);

  const { series, outside } = monthlySeries(window, obs.monthly);
  for (const m of outside) outsideMonths.add(m);

  let slope: number | null = null;
  if (series.length >= TREND_MIN_MONTHS) {
    slope = leastSquaresSlope(series.map((v, i) => [i, v] as [number, number]));
  }

  const total = intOr(obs.total);
  return {
    status: total > 0 ? 'OK' : 'EMPTY',
    total,
    approvalDistribution: {
      approved: intOr(obs.approved),
      pending: intOr(obs.pending),
      rejected: intOr(obs.rejected),
    },
    byCategory,
    bySeverity,
    byResolutionStatus: byResolution,
    monthlySeries: { window: [...window], counts: series },
    monthlySlopePerMonth: r(slope, 3),
    noteCodes: [],
  };
}

export interface DeductionAnalysis {
  status: 'OK' | 'EMPTY';
  count: number;
  totalDays: number | null;
  totalAmount: number | null;
  avgDaysPerRecord: number | null;
  byType: AnalyticsDistribution;
  noteCodes: string[];
}

export function analyzeDeductions(dataset: Rec): DeductionAnalysis {
  const quality = asRec(dataset.quality);
  const ded = asRec(quality.deductions);
  const count = intOr(ded.count);
  const totalDays = numOf(ded.totalDays);
  const totalAmount = numOf(ded.totalAmount);
  const byType = categoryDistribution(ded.byType);

  // Days and amounts stay SEPARATE — never merged, never converted.
  return {
    status: count > 0 ? 'OK' : 'EMPTY',
    count,
    totalDays: r(totalDays, 2),
    totalAmount: r(totalAmount, 2),
    avgDaysPerRecord: count > 0 && totalDays !== null ? r(totalDays / count, 2) : null,
    byType,
    noteCodes: [],
  };
}

function relationshipOf(facts: unknown): string {
  if (typeof facts !== 'object' || facts === null) return 'NOT_AVAILABLE';
  const rel = (facts as Rec).relationship;
  return typeof rel === 'string' ? rel : 'NOT_AVAILABLE';
}

export interface DomainAnalysisBase {
  relationship: string;
  status: 'OK' | 'EMPTY' | 'NOT_CONFIRMED_ATTRIBUTION';
  total: number;
  monthlySeries: AnalyticsMonthlySeries;
  noteCodes: string[];
}

export function analyzeComplaints(
  dataset: Rec,
  window: string[],
  outsideMonths: Set<string>,
): AnalyticsComplaintResult {
  const comp = asRec(dataset.complaints);
  const relationship = relationshipOf(comp);
  const total = intOr(comp.total);

  const { series, outside } = monthlySeries(window, comp.monthly);
  for (const m of outside) outsideMonths.add(m);

  const result: AnalyticsComplaintResult = {
    relationship,
    status: total > 0 && relationship === 'CONFIRMED'
      ? 'OK'
      : total === 0 ? 'EMPTY' : 'NOT_CONFIRMED_ATTRIBUTION',
    total,
    byStatus: recordDistribution(comp.byStatus),
    byType: recordDistribution(comp.byType),
    bySeverity: recordDistribution(comp.bySeverity),
    resolution: {
      resolvedOrClosed: intOr(comp.resolvedOrClosed),
      stillOpen: intOr(comp.stillOpen),
      avgResolutionDays: r(numOf(comp.avgResolutionDays), 2),
    },
    monthlySeries: { window: [...window], counts: series },
    countTrend: null,
    noteCodes: [],
  };

  if (relationship !== 'CONFIRMED') {
    // Reference §12: trend analysis only where attribution is confirmed.
    result.noteCodes.push('ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION');
    return result;
  }

  if (series.length >= TREND_MIN_MONTHS) {
    const slope = leastSquaresSlope(series.map((v, i) => [i, v] as [number, number]));
    result.countTrend = { slopePerMonth: r(slope, 3), direction: directionFromSlope(slope) };
  } else {
    result.noteCodes.push('INSUFFICIENT_TREND_DATA');
  }
  return result;
}

export interface AnalyticsComplaintResult extends DomainAnalysisBase {
  status: 'OK' | 'EMPTY' | 'NOT_CONFIRMED_ATTRIBUTION';
  byStatus: AnalyticsDistribution;
  byType: AnalyticsDistribution;
  bySeverity: AnalyticsDistribution;
  resolution: {
    resolvedOrClosed: number;
    stillOpen: number;
    avgResolutionDays: number | null;
  };
  countTrend: { slopePerMonth: number | null; direction: 'UP' | 'DOWN' | 'STABLE' | null } | null;
}

export interface AnalyticsCapaResult extends DomainAnalysisBase {
  status: 'OK' | 'EMPTY';
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
  monthlySlopePerMonth: number | null;
}

export function analyzeCapa(
  dataset: Rec,
  window: string[],
  outsideMonths: Set<string>,
): AnalyticsCapaResult {
  const capa = asRec(dataset.capa);
  const total = intOr(capa.total);
  const { series, outside } = monthlySeries(window, capa.monthly);
  for (const m of outside) outsideMonths.add(m);

  const overdue = intOr(capa.overdue);
  let slope: number | null = null;
  if (series.length >= TREND_MIN_MONTHS) {
    slope = leastSquaresSlope(series.map((v, i) => [i, v] as [number, number]));
  }

  return {
    relationship: relationshipOf(capa),
    status: total > 0 ? 'OK' : 'EMPTY',
    total,
    active: intOr(capa.active),
    terminal: intOr(capa.terminal),
    overdueRatePct: pct(overdue, total),
    byStatus: recordDistribution(capa.byStatus),
    byPriority: recordDistribution(capa.byPriority),
    bySource: recordDistribution(capa.bySource),
    closure: {
      closedCount: intOr(capa.closedCount),
      avgClosureDays: r(numOf(capa.avgClosureDays), 2),
      avgOverdueDays: r(numOf(capa.avgOverdueDays), 2),
    },
    monthlySeries: { window: [...window], counts: series },
    monthlySlopePerMonth: r(slope, 3),
    noteCodes: [],
  };
}

export interface AnalyticsFollowUpResult extends DomainAnalysisBase {
  status: 'OK' | 'EMPTY';
  overdueRatePct: number | null;
  completionRatePctEcho: number | null;
  byStatus: AnalyticsDistribution;
  byType: AnalyticsDistribution;
  byPriority: AnalyticsDistribution;
  monthlySlopePerMonth: number | null;
}

export function analyzeFollowUps(
  dataset: Rec,
  window: string[],
  outsideMonths: Set<string>,
): AnalyticsFollowUpResult {
  const fu = asRec(dataset.followUps);
  const total = intOr(fu.total);
  const overdue = intOr(fu.overdue);
  const { series, outside } = monthlySeries(window, fu.monthly);
  for (const m of outside) outsideMonths.add(m);

  let slope: number | null = null;
  if (series.length >= TREND_MIN_MONTHS) {
    slope = leastSquaresSlope(series.map((v, i) => [i, v] as [number, number]));
  }

  return {
    relationship: relationshipOf(fu),
    status: total > 0 ? 'OK' : 'EMPTY',
    total,
    // Ratio of two CANONICAL counts — no new overdue definition.
    overdueRatePct: pct(overdue, total),
    completionRatePctEcho: r(numOf(fu.completionRate), 1),
    byStatus: recordDistribution(fu.byStatus),
    byType: recordDistribution(fu.byType),
    byPriority: recordDistribution(fu.byPriority),
    monthlySeries: { window: [...window], counts: series },
    monthlySlopePerMonth: r(slope, 3),
    noteCodes: [],
  };
}

export interface AnalyticsDealResult extends DomainAnalysisBase {
  status: 'OK' | 'EMPTY';
  byStatus: AnalyticsDistribution;
  cancellationRatePct: number | null;
  completionRatePctEcho: number | null;
  monthlySlopePerMonth: number | null;
}

export function analyzeDeals(
  dataset: Rec,
  window: string[],
  outsideMonths: Set<string>,
): AnalyticsDealResult {
  const deals = asRec(dataset.deals);
  const total = intOr(deals.total);
  const canceled = intOr(deals.canceled);
  const { series, outside } = monthlySeries(window, deals.monthly);
  for (const m of outside) outsideMonths.add(m);

  let slope: number | null = null;
  if (series.length >= TREND_MIN_MONTHS) {
    slope = leastSquaresSlope(series.map((v, i) => [i, v] as [number, number]));
  }

  return {
    relationship: relationshipOf(deals),
    status: total > 0 ? 'OK' : 'EMPTY',
    total,
    byStatus: recordDistribution(deals.byStatus),
    cancellationRatePct: pct(canceled, total),
    completionRatePctEcho: r(numOf(deals.completionRate), 1),
    monthlySeries: { window: [...window], counts: series },
    monthlySlopePerMonth: r(slope, 3),
    // Reference §15: volume/status/cancellation analysis only —
    // NO sales-target calculations anywhere.
    noteCodes: [],
  };
}

export function analyzeAttendance(dataset: Rec): AnalyticsAttendanceAnalysis {
  // Reference §16 — attendance stays CONTEXT-ONLY, never feeds KPI analysis.
  const att = asRec(dataset.attendance);
  const status = typeof att.status === 'string' ? att.status : 'NOT_AVAILABLE';
  const result = asRec(att.result);
  const out: AnalyticsAttendanceAnalysis = {
    status,
    analysisRole: 'CONTEXT_ONLY',
    metrics: null,
    noteCodes: [],
  };
  if (status === 'AVAILABLE') {
    out.metrics = {
      month: (result.month as string) ?? null,
      workDays: r(numOf(result.workDays), 2),
      presentDays: r(numOf(result.presentDays), 2),
      lateDays: r(numOf(result.lateDays), 2),
      absentDays: r(numOf(result.absentDays), 2),
      totalMinutesLate: r(numOf(result.totalMinutesLate), 2),
      compliancePct: r(numOf(result.compliance), 1),
    };
  } else {
    out.noteCodes.push('ATTENDANCE_NOT_AVAILABLE');
  }
  return out;
}

// ══════════════════════════════════════════════════════════════
//  §9 Repeated issue analysis (over the deterministic groups)
// ══════════════════════════════════════════════════════════════

function analyzePeriodGroup(group: Rec, obsTotal: number): AnalyticsPeriodGroup {
  const occ = intOr(group.occurrenceCount);
  const first = parseStoredDateToDayNumber(group.firstOccurrence);
  const last = parseStoredDateToDayNumber(group.lastOccurrence);
  const interval =
    first !== null && last !== null && occ > 1 && last >= first
      ? r((last - first) / (occ - 1), 1)
      : null;
  return {
    issueKey: (group.issueKey as string) ?? null,
    label: (group.label as string) ?? null,
    occurrenceCount: occ,
    frequencyPctOfObservations: pct(occ, obsTotal),
    recurrenceIntervalDays: interval,
    observationIds: Array.isArray(group.observationIds)
      ? group.observationIds.map((i) => String(i))
      : [],
  };
}

function analyzeWindowGroup(group: Rec, window: string[]): AnalyticsWindowGroup {
  const occ = intOr(group.occurrenceCount);
  const monthsPresent = intOr(group.monthsPresent);
  const firstM = typeof group.firstMonth === 'string' ? group.firstMonth : null;
  const lastM = typeof group.lastMonth === 'string' ? group.lastMonth : null;
  let span: number | null = null;
  const i1 = firstM ? monthIndexOf(window, firstM) : null;
  const i2 = lastM ? monthIndexOf(window, lastM) : null;
  if (i1 !== null && i2 !== null && i2 >= i1) span = i2 - i1 + 1;
  return {
    issueKey: (group.issueKey as string) ?? null,
    label: (group.label as string) ?? null,
    occurrenceCount: occ,
    monthsPresent,
    monthsPresentPct: pct(monthsPresent, window.length),
    windowSpanMonths: span,
    observationIds: Array.isArray(group.observationIds)
      ? group.observationIds.map((i) => String(i))
      : [],
  };
}

export function analyzeRepeatedIssues(dataset: Rec, window: string[]): AnalyticsRepeatedIssuePattern {
  const quality = asRec(dataset.quality);
  const rep = asRec(quality.repeatedIssues);
  const obs = asRec(asRec(quality.observations));
  const obsTotal = intOr(obs.total);

  const groups = (value: unknown): Rec[] =>
    Array.isArray(value)
      ? value.filter((g): g is Rec => typeof g === 'object' && g !== null && !Array.isArray(g))
      : [];

  return {
    groupBasisEcho: (rep.groupBasis as Record<string, unknown>) ?? null,
    minOccurrencesEcho: numOf(rep.minOccurrences),
    byCategory: groups(rep.byCategory).map((g) => analyzePeriodGroup(g, obsTotal)),
    byType: groups(rep.byType).map((g) => analyzePeriodGroup(g, obsTotal)),
    windowByCategory: groups(rep.windowByCategory).map((g) => analyzeWindowGroup(g, window)),
    noteCodes: [],
  };
}

// ══════════════════════════════════════════════════════════════
//  §10 Anomaly detection (conservative, robust z-score)
// ══════════════════════════════════════════════════════════════

export function detectAnomalies(
  dataset: Rec,
  window: string[],
  seriesByDomain: Record<AnalysisDomain, number[]>,
  mtdPartial: boolean,
  insufficient: AnalyticsInsufficientSample[],
  trendResult: AnalyticsTrendAnalysis,
): AnalyticsAnomaly[] {
  const anomalies: AnalyticsAnomaly[] = [];
  const evidence = asRec(dataset.evidence);
  const reportedMonth = window.length > 0 ? window[window.length - 1] : null;

  if (mtdPartial) {
    insufficient.push({
      area: 'anomalyDetection',
      reason: 'MTD_PARTIAL_MONTH',
      detail: 'Count-spike and score-drop detection skipped for the MTD reported month.',
    });
    return anomalies;
  }

  for (const domain of ANALYSIS_DOMAINS) {
    const series = seriesByDomain[domain];
    if (series === undefined || reportedMonth === null || series.length < window.length) continue;
    const target = series[series.length - 1];
    const baseline = series.slice(0, -1);
    if (baseline.length < ANOMALY_BASELINE_MIN_MONTHS) {
      insufficient.push({
        area: 'anomalyDetection',
        reason: 'INSUFFICIENT_BASELINE',
        detail: `${domain}: baseline has ${baseline.length} months, needs ${ANOMALY_BASELINE_MIN_MONTHS}.`,
      });
      continue;
    }
    const { med, sigma } = robustBaseline(baseline);
    if (med === null || sigma === null || sigma === 0) {
      insufficient.push({
        area: 'anomalyDetection',
        reason: 'FLAT_BASELINE',
        detail: `${domain}: baseline has no spread; z-score undefined.`,
      });
      continue;
    }
    const z = (target - med) / sigma;
    if (z < ANOMALY_Z_THRESHOLD) continue;
    const collectionRef = evidence[domain] ?? evidence.observations;
    anomalies.push({
      anomalyType: `${domain.toUpperCase()}_COUNT_SPIKE`,
      metric: `${domain}.monthlyCount`,
      month: reportedMonth,
      observedValue: target,
      expectedRange: {
        low: r(med - 3 * sigma, 2),
        high: r(med + 3 * sigma, 2),
        medianBaseline: r(med, 2),
        method: 'ROBUST_Z_MEDIAN_MAD',
      },
      zScore: r(z, 2),
      direction: 'ABOVE_EXPECTED',
      severity: z >= ANOMALY_Z_HIGH_SEVERITY ? 'HIGH' : 'MEDIUM',
      confidence: baseline.length >= 12 ? 'HIGH' : 'MEDIUM',
      noteCode: 'ANOMALY_NOT_WRONGDOING',
      supportingEvidence: evidenceList(collectionRef),
    });
  }

  // Sudden score drop — most recent period-over-period delta only.
  const pops = trendResult.periodOverPeriod;
  if (pops.length > 0) {
    const last = pops[pops.length - 1];
    const delta = numOf(last.deltaPoints);
    if (delta !== null && delta <= -SCORE_DROP_THRESHOLD_POINTS) {
      anomalies.push({
        anomalyType: 'SCORE_DROP',
        metric: 'kpi.quality.rawScore.deltaPoints',
        month: last.toMonth,
        observedValue: r(delta, 2),
        expectedRange: {
          low: null,
          high: -SCORE_DROP_THRESHOLD_POINTS,
          method: 'FIXED_THRESHOLD',
        },
        zScore: null,
        direction: 'BELOW_EXPECTED',
        severity: delta <= -SCORE_DROP_HIGH_SEVERITY_POINTS ? 'HIGH' : 'MEDIUM',
        confidence: trendResult.confidence,
        noteCode: 'ANOMALY_NOT_WRONGDOING',
        supportingEvidence: evidenceList(evidence.kpi),
      });
    }
  }
  return anomalies;
}

// ══════════════════════════════════════════════════════════════
//  §17 Cross-domain temporal patterns + §18 correlation
// ══════════════════════════════════════════════════════════════

function eligibleDomains(
  seriesByDomain: Record<AnalysisDomain, number[]>,
  complaintsConfirmed: boolean,
): Array<[AnalysisDomain, number[]]> {
  const eligible: Array<[AnalysisDomain, number[]]> = [];
  for (const domain of ANALYSIS_DOMAINS) {
    if (domain === 'complaints' && !complaintsConfirmed) continue;
    const series = seriesByDomain[domain];
    if (series !== undefined) eligible.push([domain, series]);
  }
  return eligible;
}

export function analyzeCrossDomain(
  seriesByDomain: Record<AnalysisDomain, number[]>,
  window: string[],
  complaintsConfirmed: boolean,
  insufficient: AnalyticsInsufficientSample[],
): AnalyticsCrossDomainPattern[] {
  const patterns: AnalyticsCrossDomainPattern[] = [];
  const eligible = eligibleDomains(seriesByDomain, complaintsConfirmed);
  const domains = eligible.map(([d]) => d).sort();
  if (window.length < CROSS_DOMAIN_MIN_MONTHS) {
    insufficient.push({
      area: 'crossDomainPatterns',
      reason: 'INSUFFICIENT_SAMPLE',
      required: CROSS_DOMAIN_MIN_MONTHS,
      actual: window.length,
    });
    return patterns;
  }
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domains[i];
      const b = domains[j];
      const sa = eligible.find(([d]) => d === a)![1];
      const sb = eligible.find(([d]) => d === b)![1];
      const incA = new Set(seriesIncreases(sa));
      const incB = new Set(seriesIncreases(sb));
      const shared = Array.from(incA).filter((x) => incB.has(x)).sort((p, q) => p - q);
      if (shared.length < CROSS_DOMAIN_MIN_SHARED_INCREASES) continue;
      patterns.push({
        patternType: 'TEMPORAL_ASSOCIATION',
        domainA: a,
        domainB: b,
        sharedIncreaseMonthIndices: shared,
        sharedIncreaseMonths: shared
          .filter((k) => k >= 0 && k < window.length)
          .map((k) => window[k]),
        monthsAnalyzed: window.length,
        confidence: window.length >= 12 && shared.length >= 3 ? 'HIGH' : 'MEDIUM',
        noteCode: 'ASSOCIATION_NOT_CAUSATION',
      });
    }
  }
  return patterns;
}

export function analyzeCorrelations(
  seriesByDomain: Record<AnalysisDomain, number[]>,
  window: string[],
  complaintsConfirmed: boolean,
  insufficient: AnalyticsInsufficientSample[],
): AnalyticsCorrelation[] {
  const correlations: AnalyticsCorrelation[] = [];
  const eligible = eligibleDomains(seriesByDomain, complaintsConfirmed);
  const domains = eligible.map(([d]) => d).sort();
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domains[i];
      const b = domains[j];
      const sa = eligible.find(([d]) => d === a)![1];
      const sb = eligible.find(([d]) => d === b)![1];
      const n = Math.min(sa.length, sb.length);
      if (n < CORRELATION_MIN_MONTHS) {
        insufficient.push({
          area: 'correlation',
          reason: 'INSUFFICIENT_SAMPLE',
          required: CORRELATION_MIN_MONTHS,
          actual: n,
          detail: `${a} vs ${b}`,
        });
        continue;
      }
      const pairs: Array<[number, number]> = sa.slice(0, n).map((x, idx) => [x, sb[idx]]);
      const corr = pearson(pairs);
      if (corr === null) {
        insufficient.push({
          area: 'correlation',
          reason: 'NO_VARIANCE',
          detail: `${a} vs ${b}: zero variance in at least one series.`,
        });
        continue;
      }
      const absR = Math.abs(corr);
      const strength = absR >= 0.7 ? 'STRONG'
        : absR >= 0.4 ? 'MODERATE'
          : absR >= 0.2 ? 'WEAK' : 'NEGLIGIBLE';
      correlations.push({
        variables: [a, b],
        coefficient: r(corr, 4),
        sampleSize: n,
        strength,
        confidence: n >= 12 ? 'HIGH' : 'MEDIUM',
        noteCode: 'CORRELATION_NOT_CAUSATION',
        limitations: ['CORRELATION_NOT_CAUSATION', 'SMALL_SAMPLE', 'COUNT_DATA_ONLY'],
      });
    }
  }
  return correlations;
}

// ══════════════════════════════════════════════════════════════
//  §6 Period comparison (facts only)
// ══════════════════════════════════════════════════════════════

export function buildPeriodComparison(
  seriesByDomain: Record<AnalysisDomain, number[]>,
  window: string[],
  trendResult: AnalyticsTrendAnalysis,
): AnalyticsPeriodComparison {
  if (window.length < 2) {
    return {
      status: 'INSUFFICIENT_DATA',
      current: null,
      previous: null,
      deltas: {},
      kpiRawScoreDeltaPoints: null,
      noteCode: null,
    };
  }
  const currentM = window[window.length - 1];
  const previousM = window[window.length - 2];
  const deltas: Record<string, number> = {};
  const current: Record<string, number | string> = { month: currentM };
  const previous: Record<string, number | string> = { month: previousM };
  for (const domain of ANALYSIS_DOMAINS) {
    const series = seriesByDomain[domain];
    if (series === undefined || series.length < window.length) continue;
    current[domain] = series[series.length - 1];
    previous[domain] = series[series.length - 2];
    deltas[domain] = series[series.length - 1] - series[series.length - 2];
  }
  let scoreDelta: number | null = null;
  const pops = trendResult.periodOverPeriod;
  if (pops.length > 0) {
    const last = pops[pops.length - 1];
    if (last.toMonth === currentM && last.fromMonth === previousM) {
      scoreDelta = last.deltaPoints;
    }
  }
  const note = trendResult.mtdPartial ? 'MTD_PARTIAL_MONTH' : null;
  return {
    status: 'OK',
    current,
    previous,
    deltas,
    kpiRawScoreDeltaPoints: scoreDelta,
    noteCode: note,
  };
}

// ══════════════════════════════════════════════════════════════
//  §19 Data quality + §20 evidence
// ══════════════════════════════════════════════════════════════

export function buildDataQuality(
  dataset: Rec,
  window: string[],
  trendResult: AnalyticsTrendAnalysis,
  outsideMonths: Set<string>,
  insufficient: AnalyticsInsufficientSample[],
): AnalyticsDataQuality {
  const dq = asRec(dataset.dataQuality);
  const employee = asRec(dataset.employee);
  const attendance = asRec(dataset.attendance);

  const missing: Array<{ area: string; detail: string }> = [];
  if (trendResult.missingMonths.length > 0) {
    missing.push({
      area: 'trend',
      detail: `KPI months without results (never zero-filled): ${trendResult.missingMonths.join(', ')}`,
    });
  }
  if (attendance.status !== 'AVAILABLE') {
    missing.push({ area: 'attendance', detail: 'attendanceResult not available' });
  }

  const ambiguous: Array<{ domain: string; relationship: string }> = [];
  for (const domain of ['complaints', 'capa', 'followUps', 'deals']) {
    const rel = relationshipOf(asRec(dataset[domain]));
    if (rel !== 'CONFIRMED') ambiguous.push({ domain, relationship: rel });
  }

  const unavailable: string[] = [];
  if (trendResult.stats === null) {
    unavailable.push('trend.stats (insufficient available months)');
  }
  const fu = asRec(dataset.followUps);
  if (numOf(fu.avgOverdueDays) === null) {
    unavailable.push('followUps.avgOverdueDays (not available in dataset)');
  }

  const notes: string[] = [];
  if (employee.archivedButEligible === true) {
    notes.push(
      'ARCHIVED_BUT_ELIGIBLE: employee is archived now; the reported period remains valid historical data. ' +
      'Only stored records inside the window are analyzed — no post-archive activity is fabricated.',
    );
  }
  notes.push(
    'ABSENT_MONTH_IS_ZERO_RECORDS window convention applies to record-count series only; ' +
    'KPI score gaps are never zero-filled.',
  );
  if (outsideMonths.size > 0) {
    notes.push(`Monthly records outside the analysis window were excluded: ${Array.from(outsideMonths).sort().join(', ')}`);
  }
  if (trendResult.mtdPartial) {
    notes.push('MTD_PARTIAL_MONTH: partial-month analyses skipped (count-spike anomalies, cross-domain, correlation).');
  }

  return {
    windowMonths: [...window],
    missingData: missing,
    ambiguousRelationships: ambiguous,
    unattributedRecords: Array.isArray(dq.unattributedRecords)
      ? (dq.unattributedRecords as AnalyticsDataQuality['unattributedRecords'])
      : [],
    insufficientSamples: insufficient,
    unavailableMetrics: unavailable,
    notes,
    sourceNotesEcho: Array.isArray(dq.notes) ? (dq.notes as string[]) : [],
  };
}

/** Normalize an evidence reference — never invents record ids. */
export function evidenceRef(ref: unknown, complete = true): AnalyticsEvidenceRef | null {
  if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) return null;
  const rec = ref as Rec;
  const collection = rec.collection;
  const ids = rec.recordIds;
  if (!collection || !Array.isArray(ids)) return null;
  return {
    collection: String(collection),
    recordIds: ids.map((i) => String(i)),
    completeRecordList: Boolean(complete),
  };
}

function evidenceList(ref: unknown): AnalyticsEvidenceRef[] {
  const normalized = evidenceRef(ref);
  return normalized ? [normalized] : [];
}

export function buildEvidenceReferences(dataset: Rec): AnalyticsEvidenceRef[] {
  const evidence = asRec(dataset.evidence);
  const refs: AnalyticsEvidenceRef[] = [];
  const add = (ref: unknown) => {
    const normalized = evidenceRef(ref);
    if (normalized) refs.push(normalized);
  };
  if (Array.isArray(evidence.kpi)) {
    for (const ref of evidence.kpi) add(ref);
  }
  for (const key of ['observations', 'deductions', 'complaints', 'capa', 'followUps', 'deals']) {
    add(evidence[key]);
  }
  add(evidence.attendance);
  return refs;
}

// ══════════════════════════════════════════════════════════════
//  Result assembly
// ══════════════════════════════════════════════════════════════

function worstConfidence(values: AnalyticsConfidence[]): AnalyticsConfidence {
  if (values.length === 0) return 'INSUFFICIENT_DATA';
  let worst = values[0];
  let worstRank = CONFIDENCE_RANK[worst] ?? -1;
  for (const v of values) {
    const rank = CONFIDENCE_RANK[v] ?? -1;
    if (rank < worstRank) {
      worst = v;
      worstRank = rank;
    }
  }
  return worst;
}

/** Build the full EmployeeAnalyticsResult from a verified dataset (pure). */
export function buildEmployeeAnalyticsResult(dataset: Rec): EmployeeAnalyticsResult {
  const employee = asRec(dataset.employee);
  const period = asRec(dataset.period);
  const kpi = asRec(dataset.kpi);
  const kpiQuality = asRec(kpi.quality);
  const dq = asRec(dataset.dataQuality);

  const window = windowOf(dataset);

  const valueBasis = typeof period.valueBasis === 'string' ? period.valueBasis : null;
  const mtdPartial = valueBasis === 'MTD';
  const outsideMonths = new Set<string>();
  const insufficient: AnalyticsInsufficientSample[] = [];

  // ── Domain series (record counts; 0 = no stored records in month) ──
  const obsResult = analyzeObservations(dataset, window, outsideMonths);
  const compResult = analyzeComplaints(dataset, window, outsideMonths);
  const capaResult = analyzeCapa(dataset, window, outsideMonths);
  const fuResult = analyzeFollowUps(dataset, window, outsideMonths);
  const dealsResult = analyzeDeals(dataset, window, outsideMonths);
  const seriesByDomain: Record<AnalysisDomain, number[]> = {
    observations: obsResult.monthlySeries.counts,
    complaints: compResult.monthlySeries.counts,
    capa: capaResult.monthlySeries.counts,
    followUps: fuResult.monthlySeries.counts,
    deals: dealsResult.monthlySeries.counts,
  };

  const complaintsConfirmed = relationshipOf(asRec(dataset.complaints)) === 'CONFIRMED';

  const trendResult = analyzeTrend(dataset, window);
  trendResult.mtdPartial = mtdPartial;

  const anomalies = detectAnomalies(dataset, window, seriesByDomain, mtdPartial, insufficient, trendResult);
  const patterns = analyzeRepeatedIssues(dataset, window);
  const crossDomain = analyzeCrossDomain(seriesByDomain, window, complaintsConfirmed, insufficient);
  const correlations = analyzeCorrelations(seriesByDomain, window, complaintsConfirmed, insufficient);
  const periodComparison = buildPeriodComparison(seriesByDomain, window, trendResult);
  const attendance = analyzeAttendance(dataset);

  // Confidence: deterministic worst-of over analyses that ran.
  const confidences: AnalyticsConfidence[] = [trendResult.confidence ?? 'INSUFFICIENT_DATA'];
  for (const a of anomalies) confidences.push(a.confidence ?? 'MEDIUM');
  for (const c of correlations) confidences.push(c.confidence ?? 'MEDIUM');
  for (const p of crossDomain) confidences.push(p.confidence ?? 'MEDIUM');
  const overall = worstConfidence(confidences);

  // kpiFactsEcho — VERBATIM pass-through of engine outputs (proof this
  // layer never recalculates KPI values).
  const kpiEcho: AnalyticsKpiFactsEcho = {
    source: (kpi.source as string) ?? null,
    rowStatus: (kpi.rowStatus as string) ?? null,
    overallStatus: (kpi.overallStatus as string) ?? null,
    componentId: (kpiQuality.componentId as string) ?? null,
    name: (kpiQuality.name as string) ?? null,
    status: (kpiQuality.status as string) ?? null,
    rawScore: numOf(kpiQuality.rawScore),
    weight: numOf(kpiQuality.weight),
    weightedContribution: numOf(kpiQuality.weightedContribution),
    maxContribution: numOf(kpiQuality.maxContribution),
    calculationVersion: (kpi.calculationVersion as string) ?? null,
  };

  if (mtdPartial) {
    insufficient.unshift({
      area: 'mtdPartialMonth',
      reason: 'MTD_PARTIAL_MONTH',
      detail: 'Reported month is MTD; partial-month analyses are excluded by design.',
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    analyticsKind: ANALYTICS_KIND,
    analyticsEngineVersion: ANALYTICS_ENGINE_VERSION,
    deterministic: true,
    status: 'OK',
    input: {
      employeeId: (employee.employeeId as string) ?? null,
      employeeName: (employee.employeeName as string) ?? null,
      employmentStatus: (employee.employmentStatus as string) ?? null,
      archivedButEligible:
        employee.archivedButEligible === true
          ? true
          : employee.archivedButEligible === false
            ? false
            : null,
      monthKey: (period.monthKey as string) ?? null,
      valueBasis,
      finalized: period.finalized === true ? true : period.finalized === false ? false : null,
      windowMonths: window,
      datasetGeneratedAt: (dataset.generatedAt as string) ?? null,
    },
    kpiFactsEcho: kpiEcho,
    trendAnalysis: trendResult,
    patternAnalysis: {
      observations: obsResult,
      repeatedIssues: patterns,
      deductions: analyzeDeductions(dataset),
    },
    anomalies,
    distributionAnalysis: {
      complaints: compResult,
      capa: capaResult,
      followUps: fuResult,
      deals: dealsResult,
      attendance,
    },
    periodComparison,
    crossDomainPatterns: crossDomain,
    correlations,
    dataQuality: buildDataQuality(dataset, window, trendResult, outsideMonths, insufficient),
    evidenceReferences: buildEvidenceReferences(dataset),
    overallConfidence: overall,
    thresholds: { ...ANALYTICS_THRESHOLDS },
    noteCodes: [...NOTE_CODE_KEYS],
    interpretationBoundary: 'FACT_AND_ANALYSIS_ONLY',
  };
}
