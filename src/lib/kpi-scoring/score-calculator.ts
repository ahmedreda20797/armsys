// ══════════════════════════════════════════════════════════════
//  Generic score calculator (Improvement #8 — Performance Engine)
//
//  A pure-function scoring component that Quality KPI consumes as
//  its FIRST user. Future performance factors (Attendance, Response
//  Time, Productivity, Customer Satisfaction, Training, Compliance)
//  can expose the same PerformanceFactor interface, and a unified
//  Performance Engine will combine them without coupling.
//
//  All functions are pure — no I/O, no side effects.
// ══════════════════════════════════════════════════════════════

import type { PerformanceFactor } from '@/types/quality-kpi';

/** Input to the score calculator. */
export interface ScoreInput {
  /** Starting score before adjustments (typically 100). */
  startScore: number;
  /** Sum of approved deduction points. */
  deductions: number;
  /** Sum of approved bonus points. */
  bonuses: number;
  /** Whether bonuses are allowed (from config). */
  allowBonus: boolean;
  /** Maximum bonus that can be applied (from config). */
  maximumBonus: number;
  /** Floor score can never go below (from config). */
  minimumScore: number;
}

/** Output of the score calculator. */
export interface ScoreResult {
  /** Final score after deductions and (possibly capped) bonuses. */
  score: number;
  /** Effective deduction points applied (same as input deductions). */
  deductions: number;
  /** Effective bonus points applied (may be capped). */
  effectiveBonus: number;
  /** Original bonus sum before capping. */
  rawBonus: number;
  /** Whether the bonus was capped. */
  bonusCapped: boolean;
}

/**
 * Compute a score from adjustments.
 *
 * Formula:
 *   effectiveBonus = allowBonus ? min(bonuses, maximumBonus) : 0
 *   score = max(minimumScore, startScore − deductions + effectiveBonus)
 *
 * This is the ONLY scoring formula in the system. All consumers
 * (Quality KPI, future factors) MUST call this.
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
 * Clamp a value to a minimum bound.
 * Generic utility reused across scoring logic.
 */
export function clampScore(value: number, minimum: number): number {
  return Math.max(minimum, value);
}

/**
 * Convert a ScoreResult into a PerformanceFactor for the
 * unified Performance Engine interface.
 *
 * @param factorId   - Stable identifier, e.g. 'quality'.
 * @param factorName - Human-readable name, e.g. 'Quality'.
 * @param result     - The computed score.
 * @param weight     - Relative weight (default 1).
 * @param breakdown  - Optional structured breakdown for display.
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
