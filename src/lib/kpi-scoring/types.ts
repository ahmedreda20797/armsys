// ══════════════════════════════════════════════════════════════
//  Generic KPI scoring primitive — type definitions
//
//  Domain-agnostic scoring types owned by the kpi-scoring library.
//  Quality KPI is the first consumer; future scoring components
//  (Attendance, Sales, HR Penalties, Travel Performance, Customer
//  Service) expose the same {@link PerformanceFactor} interface so a
//  unified Performance Engine can combine them without coupling.
//
//  This file imports nothing from any domain — it is the root of the
//  scoring dependency tree.
// ══════════════════════════════════════════════════════════════

/**
 * A single point adjustment applied to a starting score. Adjustments
 * are the universal input to {@link computeScoreFromAdjustments}: a
 * deduction is a negative `delta`, a bonus is a positive `delta`.
 *
 * Using a flat list of adjustments (instead of Quality-specific
 * "observation" concepts) is what lets every future scoring component
 * reuse the same calculator.
 *
 * @property id          - Stable identifier of the source record behind this adjustment.
 * @property delta       - Signed magnitude (negative = deduction, positive = bonus).
 * @property weight      - Optional business-impact weight stored for analytics (default 1).
 * @property categoryKey - Optional grouping key for per-category breakdowns.
 * @property isBonus     - True if this is a bonus (award) adjustment, false if a deduction.
 */
export interface ScoreAdjustment {
  id: string;
  /** Signed magnitude: negative reduces the score, positive increases it. */
  delta: number;
  /** Business-impact weight, stored for analytics. Defaults to 1. */
  weight?: number;
  /** Optional grouping key for per-category breakdowns. */
  categoryKey?: string;
  /** True for a bonus (award), false for a deduction. */
  isBonus: boolean;
}

/**
 * Input to {@link computeScoreFromAdjustments}. Every value is a
 * plain primitive supplied by the caller (typically read from a
 * settings document); the calculator hardcodes nothing.
 *
 * @property startScore     - Starting score before adjustments (typically 100).
 * @property deductions     - Sum of approved deduction magnitudes (positive number).
 * @property bonuses        - Sum of approved bonus magnitudes (positive number).
 * @property allowBonus     - Whether bonuses are allowed (from config).
 * @property maximumBonus   - Maximum bonus that may be applied (from config).
 * @property minimumScore   - Floor the score can never go below (from config).
 */
export interface ScoreInput {
  startScore: number;
  deductions: number;
  bonuses: number;
  allowBonus: boolean;
  maximumBonus: number;
  minimumScore: number;
}

/**
 * Output of {@link computeScoreFromAdjustments}. Captures the final
 * score plus enough detail to explain how it was derived (effective
 * vs raw bonus, cap flag, deductions applied).
 *
 * @property score          - Final score after deductions and (possibly capped) bonuses.
 * @property deductions     - Effective deduction points applied (same as input).
 * @property effectiveBonus - Bonus points actually applied (may be capped).
 * @property rawBonus       - Original bonus sum before capping.
 * @property bonusCapped    - Whether the bonus was capped by maximumBonus.
 */
export interface ScoreResult {
  score: number;
  deductions: number;
  effectiveBonus: number;
  rawBonus: number;
  bonusCapped: boolean;
}

/**
 * Performance Engine adapter interface.
 *
 * Every scoring component (Quality today; Attendance, Sales,
 * Productivity, Customer Satisfaction, etc. tomorrow) exposes this
 * same shape so a unified Performance Engine can combine them without
 * coupling to any one factor's internals.
 *
 * @property factorId    - Stable factor identifier, e.g. 'quality' or 'attendance'.
 * @property factorName  - Human-readable factor name.
 * @property score       - Computed score for this factor (already clamped to [0, maxScore]).
 * @property maxScore    - Maximum possible score for this factor (e.g. 100).
 * @property weight      - Relative weight inside the unified engine (default 1).
 * @property normalized  - Normalized 0–1 contribution = score / maxScore.
 * @property breakdown   - Optional structured breakdown for display.
 */
export interface PerformanceFactor {
  factorId: string;
  factorName: string;
  /** Computed score (already clamped to [0, maxScore]). */
  score: number;
  /** Maximum possible score for this factor. */
  maxScore: number;
  /** Relative weight inside the unified engine (default 1). */
  weight: number;
  /** Normalized 0–1 contribution = score / maxScore. */
  normalized: number;
  /** Optional structured breakdown for display. */
  breakdown?: Record<string, number>;
}
