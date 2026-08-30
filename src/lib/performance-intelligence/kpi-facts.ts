// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — KPI Facts (Phase 3)
//
//  PURE projection of the canonical Employee KPI Report (Phase 2,
//  which itself consumes the Phase-1 engine pipeline verbatim) into
//  the intelligence dataset's fact shapes.
//
//  ZERO recalculation: raw scores, weights, contributions, statuses,
//  scheme identity, trend points and the MoM percentage-point delta
//  are all consumed verbatim from the canonical report. The only new
//  derived value is the deterministic `direction` label (UP/DOWN/
//  STABLE) computed from the report's own deltaPoints.
// ══════════════════════════════════════════════════════════════

import type { EmployeeKpiReport } from '@/lib/kpi-reporting';
import type {
  KpiFacts,
  KpiQualityFacts,
  ScoreTrendFacts,
  TrendDirection,
} from './types';

/** Project the canonical report's quality slice verbatim. */
function toKpiQualityFacts(report: EmployeeKpiReport): KpiQualityFacts | null {
  const quality = report.quality;
  if (!quality) return null;
  return {
    componentId: quality.componentId,
    name: quality.name,
    status: quality.status,
    rawScore: quality.rawScore,
    weight: quality.weight,
    weightedContribution: quality.weightedContribution,
    maxContribution: quality.maxContribution,
    observationCount: quality.observationCount,
    deductionPoints: quality.deductionPoints,
    bonusPoints: quality.bonusPoints,
  };
}

/**
 * Build the dataset's KPI facts from the canonical employee report.
 * The engine's outcome vocabulary is preserved in full — a missing
 * result (NOT_ELIGIBLE / NO_SCHEME / …) stays an explicit outcome,
 * never a fabricated number.
 */
export function buildKpiFacts(report: EmployeeKpiReport): KpiFacts {
  return {
    outcomeStatus: report.outcomeStatus,
    message: report.message,
    scheme: report.scheme,
    quality: toKpiQualityFacts(report),
    availableWeight: report.availableWeight,
    weightedTotal: report.weightedTotal,
    overallStatus: report.overallStatus,
    rowStatus: report.rowStatus,
    calculationVersion: report.dataContract?.calculationVersion ?? null,
    source: 'kpi_engine',
  };
}

/** Deterministic trend direction from the report's MoM delta (percentage points). */
export function deriveTrendDirection(deltaPoints: number | null): TrendDirection | null {
  if (deltaPoints === null) return null;
  if (deltaPoints > 0) return 'UP';
  if (deltaPoints < 0) return 'DOWN';
  return 'STABLE';
}

/**
 * Build the score-trend facts from the canonical report's trend
 * block (frozen snapshots first, engine fallback — months without
 * results stay unavailable, never zero-filled).
 */
export function buildScoreTrendFacts(report: EmployeeKpiReport): ScoreTrendFacts {
  const windowMonths = report.trend.months.map((p) => p.monthKey);
  const mom = report.trend.mom;
  return {
    windowMonths,
    points: report.trend.months,
    mom,
    direction: deriveTrendDirection(mom ? mom.deltaPoints : null),
  };
}
