// ══════════════════════════════════════════════════════════════
//  CANONICAL RISK SCORING — single source of truth
//
//  Every module that displays a risk score (Risk Center, Employee 360,
//  Follow-Ups) MUST call computeRisk(). No module may re-implement the
//  formula. See METRICS.md for the business rule rationale.
//
//  Replaces the previous inline formulas that drifted between:
//    - risk-center/route.ts      (uncapped counts, levels 11/21/36)
//    - employee-360/[id]/route.ts (capped, different bands, broken CAPA literals)
//    - follow-ups/route.ts        (a 4th partial formula)
// ══════════════════════════════════════════════════════════════

/**
 * Per-factor risk weights. Severity-weighted factors (absences, critical
 * follow-ups, complaints) carry higher multipliers and looser caps so they
 * can dominate when they occur. Noise factors (delays, quality count) are
 * capped to prevent one category from drowning out the rest.
 */
export const RISK_WEIGHTS = {
  /** Points per late-attendance day. */
  delay: 1,
  /** Points per absence day. */
  absence: 3,
  /** Points per quality-deduction record (count, not days). */
  quality: 5,
  /** Points per HR-deduction record (count, not days). */
  hr: 5,
  /** Points per open/active follow-up. */
  openFollowUp: 3,
  /** Points per high-priority follow-up. */
  highPriorityFollowUp: 5,
  /** Points per critical-priority follow-up. */
  criticalFollowUp: 10,
  /** Points per open complaint. */
  complaint: 8,
  /** Points per repeated-issue flag (same follow-up type within 30 days). */
  repeatedIssue: 5,
} as const;

/**
 * Per-factor caps. Each category contributes at most this many points,
 * so no single dimension can dominate the total.
 */
export const RISK_CAPS = {
  delay: 15,
  absence: 30,
  quality: 25,
  hr: 15,
  openFollowUp: 15,
  highPriorityFollowUp: 25,
  criticalFollowUp: 30,
  complaint: 20,
  repeatedIssue: 15,
} as const;

/**
 * CAPA risk factor weights. Kept identical to the legacy risk-weights.ts
 * values so existing behaviour is preserved for the CAPA dimension.
 */
export const CAPA_RISK_WEIGHTS = {
  /** Points per open (non-closed) CAPA */
  openCapa: 5,
  /** Points per overdue CAPA */
  overdueCapa: 10,
  /** Points per critical-priority CAPA */
  criticalCapa: 8,
  /** Points per reopened CAPA */
  reopenedCapa: 15,
} as const;

/**
 * Maximum points cap for CAPA factors per employee.
 */
export const CAPA_RISK_CAPS = {
  openCapa: 25,
  overdueCapa: 30,
  criticalCapa: 30,
  reopenedCapa: 30,
} as const;

/** Hard ceiling on the total risk score. */
export const RISK_SCORE_MAX = 100;

/**
 * Risk-level bands. A score falls into the highest band whose lower
 * bound it meets or exceeds.
 */
export const RISK_LEVEL_BANDS = {
  low: 0,
  medium: 11,
  high: 26,
  critical: 51,
} as const;

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Raw counts fed into computeRisk(). Every field is a non-negative count
 * derived directly from database records — never a pre-multiplied score.
 */
export interface RiskInput {
  delayCount: number;
  absenceCount: number;
  qualityCount: number;
  hrCount: number;
  openFollowUpCount: number;
  highPriorityFollowUpCount: number;
  criticalFollowUpCount: number;
  openComplaintCount: number;
  repeatedIssueCount: number;
  openCapaCount: number;
  overdueCapaCount: number;
  criticalCapaCount: number;
  reopenedCapaCount: number;
}

/**
 * One entry in the canonical breakdown. `count` is the raw input,
 * `points` is the weighted-and-capped contribution to the total.
 */
export interface RiskBreakdownEntry {
  count: number;
  points: number;
}

export interface RiskBreakdown {
  delay: RiskBreakdownEntry;
  absence: RiskBreakdownEntry;
  quality: RiskBreakdownEntry;
  hr: RiskBreakdownEntry;
  openFollowUp: RiskBreakdownEntry;
  highPriorityFollowUp: RiskBreakdownEntry;
  criticalFollowUp: RiskBreakdownEntry;
  complaint: RiskBreakdownEntry;
  repeatedIssue: RiskBreakdownEntry;
  openCapa: RiskBreakdownEntry;
  overdueCapa: RiskBreakdownEntry;
  criticalCapa: RiskBreakdownEntry;
  reopenedCapa: RiskBreakdownEntry;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  breakdown: RiskBreakdown;
}

/** Apply weight and cap to a single factor. */
function factor(count: number, weight: number, cap: number): RiskBreakdownEntry {
  const n = Math.max(0, count | 0); // tolerate floats, coerce negatives to 0
  return { count: n, points: Math.min(n * weight, cap) };
}

/** Map a raw score (already capped at RISK_SCORE_MAX) to a risk level. */
export function levelForScore(score: number): RiskLevel {
  if (score >= RISK_LEVEL_BANDS.critical) return 'critical';
  if (score >= RISK_LEVEL_BANDS.high) return 'high';
  if (score >= RISK_LEVEL_BANDS.medium) return 'medium';
  return 'low';
}

/**
 * Compute the canonical risk score from raw counts.
 *
 * This is the ONLY risk calculation in the system. All consumers
 * (Risk Center, Employee 360, Follow-Ups risk map) MUST call this.
 */
export function computeRisk(input: RiskInput): RiskResult {
  const breakdown: RiskBreakdown = {
    delay: factor(input.delayCount, RISK_WEIGHTS.delay, RISK_CAPS.delay),
    absence: factor(input.absenceCount, RISK_WEIGHTS.absence, RISK_CAPS.absence),
    quality: factor(input.qualityCount, RISK_WEIGHTS.quality, RISK_CAPS.quality),
    hr: factor(input.hrCount, RISK_WEIGHTS.hr, RISK_CAPS.hr),
    openFollowUp: factor(input.openFollowUpCount, RISK_WEIGHTS.openFollowUp, RISK_CAPS.openFollowUp),
    highPriorityFollowUp: factor(input.highPriorityFollowUpCount, RISK_WEIGHTS.highPriorityFollowUp, RISK_CAPS.highPriorityFollowUp),
    criticalFollowUp: factor(input.criticalFollowUpCount, RISK_WEIGHTS.criticalFollowUp, RISK_CAPS.criticalFollowUp),
    complaint: factor(input.openComplaintCount, RISK_WEIGHTS.complaint, RISK_CAPS.complaint),
    repeatedIssue: factor(input.repeatedIssueCount, RISK_WEIGHTS.repeatedIssue, RISK_CAPS.repeatedIssue),
    openCapa: factor(input.openCapaCount, CAPA_RISK_WEIGHTS.openCapa, CAPA_RISK_CAPS.openCapa),
    overdueCapa: factor(input.overdueCapaCount, CAPA_RISK_WEIGHTS.overdueCapa, CAPA_RISK_CAPS.overdueCapa),
    criticalCapa: factor(input.criticalCapaCount, CAPA_RISK_WEIGHTS.criticalCapa, CAPA_RISK_CAPS.criticalCapa),
    reopenedCapa: factor(input.reopenedCapaCount, CAPA_RISK_WEIGHTS.reopenedCapa, CAPA_RISK_CAPS.reopenedCapa),
  };

  const raw = (Object.values(breakdown) as RiskBreakdownEntry[]).reduce(
    (sum, e) => sum + e.points,
    0,
  );
  const score = Math.min(raw, RISK_SCORE_MAX);

  return { score, level: levelForScore(score), breakdown };
}
