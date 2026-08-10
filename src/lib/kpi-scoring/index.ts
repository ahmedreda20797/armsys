// ══════════════════════════════════════════════════════════════
//  Generic KPI scoring primitive — barrel export
//
//  Single public entry point for the kpi-scoring library. Consumers
//  import from '@/lib/kpi-scoring' and never reach into sub-modules.
//
//  Stable public API — see the JSDoc on each export for its contract.
// ══════════════════════════════════════════════════════════════

export type {
  PerformanceFactor,
  ScoreAdjustment,
  ScoreInput,
  ScoreResult,
} from './types';

export {
  clampScore,
  computeScoreFromAdjustments,
  aggregateAdjustments,
  toPerformanceFactor,
} from './score-calculator';
