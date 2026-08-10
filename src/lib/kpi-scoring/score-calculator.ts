// ══════════════════════════════════════════════════════════════
//  Generic score calculator — pure-function scoring component
//
//  A domain-agnostic, pure-function scoring component that Quality
//  KPI consumes as its FIRST user. Future scoring components
//  (Attendance, Response Time, Productivity, Customer Satisfaction,
//  Training, Compliance) expose the same {@link PerformanceFactor}
//  interface, and a unified Performance Engine will combine them
//  without coupling.
//
//  All functions are pure — no I/O, no side effects, no database
//  access, no module-specific vocabulary. This library hardcodes
//  nothing.
// ══════════════════════════════════════════════════════════════

import type { PerformanceFactor, ScoreAdjustment, ScoreInput, ScoreResult } from './types';

/**
 * Compute a score from explicit deduction and bonus sums.
 *
 * Formula:
 *   effectiveBonus = allowBonus ? min(bonuses, maximumBonus) : 0
 *   score = max(minimumScore, startScore - deductions + effectiveBonus)
 *
 * This is the ONLY scoring formula in the system. All consumers
 * (Quality KPI, future factors) MUST call this or
 * {@link computeScoreFromAdjustments}.
 *
 * @param input - The scoring parameters (see {@link ScoreInput}).
 * @returns A {@link ScoreResult} with the final score and a full
 *          breakdown of deductions/bonuses/capping.
 *
 * @remarks
 * Side effects: none. This is a pure function.
 */
export function computeScoreFromAdjustments(input: ScoreInput): ScoreResult {
  const rawBonus = input.bonuses;
  const effectiveBonus = input.allowBonus
    ? Math.min(rawBonus, input.maximumBonus)
    : 0;
  const bonusCapped = input.allowBonus && rawBonus > effectiveBonus;
  const score = Math.max(input.minimumScore, input.startScore - input.deductions + effectiveBonus);

  return {
    score,
    deductions: input.deductions,
    effectiveBonus,
    rawBonus,
    bonusCapped,
  };
}

/**
 * Clamp a value to a minimum bound. Generic utility reused across
 * scoring logic.
 *
 * @param value    - The value to clamp.
 * @param minimum  - The floor value.
 * @returns `value` if it is >= `minimum`, otherwise `minimum`.
 *
 * @remarks
 * Side effects: none. This is a pure function.
 */
export function clampScore(value: number, minimum: number): number {
  return Math.max(minimum, value);
}

/**
 * Aggregate a list of {@link ScoreAdjustment}s into a {@link ScoreResult}
 * for a given configuration. This is a convenience wrapper around
 * {@link computeScoreFromAdjustments} that first sums the adjustments
 * into deduction and bonus totals.
 *
 * @param adjustments  - The list of scored adjustments (deductions and bonuses).
 * @param startScore   - Starting score before adjustments (typically 100).
 * @param allowBonus   - Whether bonuses are allowed (from config).
 * @param maximumBonus - Maximum bonus that may be applied (from config).
 * @param minimumScore - Floor the score can never go below (from config).
 * @returns A {@link ScoreResult} reflecting all adjustments.
 *
 * @remarks
 * Side effects: none. This is a pure function. The adjustments list
 * is not modified.
 */
export function aggregateAdjustments(
  adjustments: ScoreAdjustment[],
  startScore: number,
  allowBonus: boolean,
  maximumBonus: number,
  minimumScore: number,
): ScoreResult {
  let deductions = 0;
  let bonuses = 0;
  for (const adj of adjustments) {
    if (adj.isBonus) {
      bonuses += Math.abs(adj.delta);
    } else {
      deductions += Math.abs(adj.delta);
    }
  }
  return computeScoreFromAdjustments({
    startScore,
    deductions,
    bonuses,
    allowBonus,
    maximumBonus,
    minimumScore,
  });
}

/**
 * Convert a {@link ScoreResult} into a {@link PerformanceFactor} for
 * the unified Performance Engine interface.
 *
 * @param factorId   - Stable identifier, e.g. 'quality' or 'attendance'.
 * @param factorName - Human-readable name, e.g. 'Quality'.
 * @param result     - The computed score.
 * @param weight     - Relative weight (default 1).
 * @param breakdown  - Optional structured breakdown for display.
 * @returns A {@link PerformanceFactor} ready for the unified engine.
 *
 * @remarks
 * Side effects: none. This is a pure function.
 */
export function toPerformanceFactor(
  factorId: string,
  factorName: string,
  result: ScoreResult,
  weight: number = 1,
  breakdown?: Record<string, number>,
): PerformanceFactor {
  const maxScore = result.score + result.deductions; // reconstruct approximate max
  return {
    factorId,
    factorName,
    score: result.score,
    maxScore: Math.max(maxScore, result.score), // ensure ≥ score
    weight,
    normalized: maxScore > 0 ? result.score / Math.max(maxScore, result.score) : result.score > 0 ? 1 : 0,
    breakdown,
  };
}
