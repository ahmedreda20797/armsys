// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — Quality Component Adapter (Phase 1)
//
//  The BRIDGE between the existing canonical Quality KPI engine
//  (src/lib/metrics/kpiMetrics.ts) and the configurable framework.
//
//  HARD RULES:
//    • NO Quality calculation logic lives here. The adapter CONSUMES
//      an existing Quality result (a stored snapshot
//      `EmployeeScoreEntry` or the engine's `EmployeeScoreResult`)
//      and only PROJECTS it into the framework's component-result
//      shape.
//    • The Quality RAW score (0–100) is preserved verbatim — it is
//      NEVER replaced by its weighted contribution.
//    • weightedContribution = rawScore × weight / 100, where the
//      weight comes from the CONFIGURED scheme component (never
//      hardcoded "Quality = 15%").
//    • A missing Quality result is PENDING — never zero.
// ══════════════════════════════════════════════════════════════

import type {
  KpiComponentResult,
  KpiComponentEvidence,
} from './types';
import { roundTo2 } from './validation';

/** The slice of the existing Quality result the adapter consumes. */
export interface QualityScoreInput {
  score: number;
  deductionPoints?: number;
  bonusPoints?: number;
  observationCount?: number;
}

/** Options for projecting a Quality result into the framework. */
export interface BuildQualityComponentResultInput {
  /** The configured scheme component (source of componentId/name/weight/owner). */
  component: {
    componentId: string;
    name: string;
    weight: number;
    owner: KpiComponentResult['owner'];
  };
  /** The EXISTING Quality result, or null when none exists for the period. */
  qualityScore: QualityScoreInput | null;
  /** Where the consumed result came from. */
  origin: 'month_snapshot' | 'live_engine';
}

/**
 * Project the existing Quality KPI result into a framework component
 * result. Pure projection — no recalculation of any Quality metric.
 */
export function buildQualityComponentResult(
  input: BuildQualityComponentResultInput,
): KpiComponentResult {
  const { component, qualityScore, origin } = input;
  const weight = component.weight;

  // Missing Quality data for the period is an explicit PENDING —
  // never zero, never fabricated.
  if (!qualityScore || typeof qualityScore.score !== 'number' || !Number.isFinite(qualityScore.score)) {
    return {
      componentId: component.componentId,
      name: component.name,
      owner: component.owner,
      weight,
      status: 'PENDING',
      rawScore: null,
      weightedContribution: null,
      maxContribution: weight,
      evidence: null,
    };
  }

  const rawScore = qualityScore.score;
  const evidence: KpiComponentEvidence = {
    source: 'quality_engine',
    origin,
    observationCount: qualityScore.observationCount ?? 0,
    deductionPoints: qualityScore.deductionPoints ?? 0,
    bonusPoints: qualityScore.bonusPoints ?? 0,
  };

  // A computed score of exactly 0 is REAL data — the explicit ZERO
  // status keeps it distinct from "missing" while still counting as
  // available for aggregation.
  const status = rawScore === 0 ? 'ZERO' : 'AVAILABLE';

  return {
    componentId: component.componentId,
    name: component.name,
    owner: component.owner,
    weight,
    status,
    rawScore,
    weightedContribution: roundTo2((rawScore * weight) / 100),
    maxContribution: weight,
    evidence,
  };
}
