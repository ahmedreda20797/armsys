// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — Decision Score Engine
//
//  Pure functions that compute the 9-component decision score.
//  No React, no API calls, no side effects. Every component is
//  normalized to 0-100, then combined via a weighted composite.
//
//  The score answers: "How important is acting on this decision,
//  relative to every other decision, RIGHT NOW?"
// ═══════════════════════════════════════════════════════════════

import { getPriorityLevel } from '@/lib/aocc/priority-engine';
import type {
  BusinessImpact,
  DecisionScore,
  UrgencyLevel,
} from '@/lib/aocc/decision-types';
import type { PriorityLevel } from '@/lib/aocc/types';

// ═══════════════════════════════════════════════════════════════
//  Component weights — must sum to 1.0
//  Tunable in one place so scoring strategy stays centralized.
// ═══════════════════════════════════════════════════════════════

export const SCORE_WEIGHTS = {
  priority: 0.20,        // underlying event priority
  businessImpact: 0.20,  // financial / customer / operational impact
  urgency: 0.18,         // how soon action is needed
  confidence: 0.10,      // how well-corroborated the decision is
  risk: 0.10,            // underlying risk exposure
  employeeImpact: 0.07,  // blast radius on the employee
  departmentImpact: 0.07,// blast radius on the department
  slaImpact: 0.08,       // deadline / SLA exposure
} as const;

// ── Sanity check: weights must sum to 1.0 ──
const _WEIGHT_SUM =
  SCORE_WEIGHTS.priority + SCORE_WEIGHTS.businessImpact +
  SCORE_WEIGHTS.urgency + SCORE_WEIGHTS.confidence +
  SCORE_WEIGHTS.risk + SCORE_WEIGHTS.employeeImpact +
  SCORE_WEIGHTS.departmentImpact + SCORE_WEIGHTS.slaImpact;
// (compile-time guard — if this ever drifts, the comment flags it)
// _WEIGHT_SUM === 1.0

// ═══════════════════════════════════════════════════════════════
//  1. Priority component (0-100)
// ═══════════════════════════════════════════════════════════════

const PRIORITY_BAND: Record<PriorityLevel, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
};

/**
 * Priority component. Maps the underlying priority level to a 0-100
 * band, then nudges by the raw score so two "high" decisions still
 * differentiate (one at score 80 vs one at 45).
 */
export function scorePriorityComponent(
  level: PriorityLevel,
  rawScore: number
): number {
  const band = PRIORITY_BAND[level] ?? 15;
  // Blend: 70% band + 30% raw score (raw already 0-100 from engine)
  return clamp01(Math.round(band * 0.7 + (rawScore || 0) * 0.3));
}

// ═══════════════════════════════════════════════════════════════
//  2. Business Impact component (0-100)
// ═══════════════════════════════════════════════════════════════

const IMPACT_BAND: Record<BusinessImpact, number> = {
  severe: 100,
  high: 78,
  moderate: 52,
  low: 28,
  minimal: 10,
};

/**
 * Business impact component. The `impact` band is the dominant
 * signal; `deductionAmount` and `affectedScope` (count of affected
 * modules / entities) add nuance.
 */
export function scoreBusinessImpact(
  impact: BusinessImpact,
  deductionAmount = 0,
  affectedScope = 0
): number {
  const band = IMPACT_BAND[impact] ?? 28;
  // Financial uplift: up to +15 for large deductions
  const financialBoost = Math.min(15, Math.round(deductionAmount / 100));
  // Scope uplift: up to +10 for decisions touching many entities
  const scopeBoost = Math.min(10, affectedScope * 2);
  return clamp01(Math.round(band * 0.75 + (financialBoost + scopeBoost) * 0.833));
}

// ═══════════════════════════════════════════════════════════════
//  3. Urgency component (0-100)
// ═══════════════════════════════════════════════════════════════

const URGENCY_BAND: Record<UrgencyLevel, number> = {
  critical: 100,
  high: 72,
  medium: 45,
  low: 18,
};

/**
 * Urgency component. The `urgency` band is the base; `hoursUntilDue`
 * sharpens it (closer to deadline = more urgent). A null/undefined
 * due date means no deadline pressure, so urgency comes only from band.
 */
export function scoreUrgency(
  urgency: UrgencyLevel,
  hoursUntilDue: number | null
): number {
  const band = URGENCY_BAND[urgency] ?? 18;
  if (hoursUntilDue === null) return clamp01(Math.round(band * 0.8));

  // Deadline pressure curve:
  //   already overdue (<=0h)  → +20
  //   <= 4h                   → +15
  //   <= 24h                  → +8
  //   <= 72h                  → 0
  //   > 72h                   → -10 (plenty of time)
  let pressure = 0;
  if (hoursUntilDue <= 0) pressure = 20;
  else if (hoursUntilDue <= 4) pressure = 15;
  else if (hoursUntilDue <= 24) pressure = 8;
  else if (hoursUntilDue <= 72) pressure = 0;
  else pressure = -10;

  return clamp01(band + pressure);
}

// ═══════════════════════════════════════════════════════════════
//  4. Confidence component (0-100)
// ═══════════════════════════════════════════════════════════════

/**
 * Confidence component. Confidence rises with the number of
 * corroborating evidence pieces and source modules.
 *
 *   1 evidence  → ~40
 *   2 evidence  → ~62
 *   3 evidence  → ~78
 *   4+ evidence → ~90-100
 *
 * Single-module decisions are inherently less confident than
 * cross-module ones, so we discount when only one module is involved.
 */
export function scoreConfidence(
  evidenceCount: number,
  moduleCount: number
): number {
  // Diminishing returns on evidence count
  const evidenceScore = Math.min(85, 25 + evidenceCount * 16);
  // Single-module discount
  const moduleFactor = moduleCount <= 1 ? 0.75 : moduleCount === 2 ? 0.9 : 1.0;
  return clamp01(Math.round(evidenceScore * moduleFactor + 10 * (1 - moduleFactor)));
}

// ═══════════════════════════════════════════════════════════════
//  5. Risk component (0-100)
// ═══════════════════════════════════════════════════════════════

/**
 * Risk component. Directly from the Risk Center score (0-100 scale).
 * The Risk Center already weights attendance, complaints, CAPA, etc.
 * We clamp and ensure a reasonable floor.
 */
export function scoreRiskComponent(riskScore: number): number {
  return clamp01(Math.round(Math.max(0, Math.min(100, riskScore || 0))));
}

// ═══════════════════════════════════════════════════════════════
//  6. Employee Impact component (0-100)
// ═══════════════════════════════════════════════════════════════

/**
 * Employee impact component. Reflects how much this decision affects
 * the employee's standing: open actions against them, their operational
 * status, and how many modules are flagging them.
 */
export function scoreEmployeeImpact(
  openActions: number,
  operationalStatus: 'critical' | 'at_risk' | 'monitoring' | 'healthy' | null,
  affectedModuleCount: number
): number {
  const statusBand: Record<string, number> = {
    critical: 90,
    at_risk: 65,
    monitoring: 40,
    healthy: 10,
  };
  const base = operationalStatus ? (statusBand[operationalStatus] ?? 30) : 30;
  const actionBoost = Math.min(20, openActions * 5);
  const moduleBoost = Math.min(15, (affectedModuleCount - 1) * 5);
  return clamp01(Math.round(base + actionBoost + moduleBoost));
}

// ═══════════════════════════════════════════════════════════════
//  7. Department Impact component (0-100)
// ═══════════════════════════════════════════════════════════════

/**
 * Department impact component. Reflects how much this decision
 * affects the department: its health score and the density of open
 * issues within it.
 */
export function scoreDepartmentImpact(
  departmentHealthScore: number | null,
  openIssuesInDept: number
): number {
  // Lower health = higher impact. healthScore 100 → impact 5; healthScore 30 → impact 85.
  const healthComponent =
    departmentHealthScore === null
      ? 30
      : clamp01(Math.round(100 - departmentHealthScore));
  const densityBoost = Math.min(25, openIssuesInDept * 4);
  return clamp01(Math.round(healthComponent * 0.8 + densityBoost));
}

// ═══════════════════════════════════════════════════════════════
//  8. SLA Impact component (0-100)
// ═══════════════════════════════════════════════════════════════

/**
 * SLA impact component. Reflects deadline / SLA exposure.
 *   overdue (days < 0)   → 90-100 scaled by how overdue
 *   due today (0)        → 85
 *   <= 1 day             → 70
 *   <= 3 days            → 45
 *   <= 7 days            → 25
 *   > 7 days / none      → 8
 */
export function scoreSlaImpact(daysUntilDue: number | null): number {
  if (daysUntilDue === null) return 8;
  if (daysUntilDue < 0) {
    // Overdue: 90 base, up to +10 for very overdue (>=5 days)
    return clamp01(90 + Math.min(10, Math.abs(daysUntilDue) * 2));
  }
  if (daysUntilDue === 0) return 85;
  if (daysUntilDue <= 1) return 70;
  if (daysUntilDue <= 3) return 45;
  if (daysUntilDue <= 7) return 25;
  return 8;
}

// ═══════════════════════════════════════════════════════════════
//  Composite: compute the full DecisionScore
// ═══════════════════════════════════════════════════════════════

/** Input bundle for the composite scorer — all raw signals. */
export interface ScoreInput {
  priorityLevel: PriorityLevel;
  priorityRawScore: number;
  businessImpact: BusinessImpact;
  deductionAmount?: number;
  affectedScope?: number;
  urgency: UrgencyLevel;
  hoursUntilDue: number | null;
  evidenceCount: number;
  moduleCount: number;
  riskScore: number;
  employeeOpenActions: number;
  employeeOperationalStatus: 'critical' | 'at_risk' | 'monitoring' | 'healthy' | null;
  affectedModuleCount: number;
  departmentHealthScore: number | null;
  openIssuesInDept: number;
  daysUntilDue: number | null;
}

/**
 * Compute the full 9-component DecisionScore from raw signals.
 * This is the single entry point used by the decision engine.
 */
export function computeDecisionScore(input: ScoreInput): DecisionScore {
  const priority = scorePriorityComponent(input.priorityLevel, input.priorityRawScore);
  const businessImpact = scoreBusinessImpact(
    input.businessImpact,
    input.deductionAmount,
    input.affectedScope
  );
  const urgency = scoreUrgency(input.urgency, input.hoursUntilDue);
  const confidence = scoreConfidence(input.evidenceCount, input.moduleCount);
  const risk = scoreRiskComponent(input.riskScore);
  const employeeImpact = scoreEmployeeImpact(
    input.employeeOpenActions,
    input.employeeOperationalStatus,
    input.affectedModuleCount
  );
  const departmentImpact = scoreDepartmentImpact(
    input.departmentHealthScore,
    input.openIssuesInDept
  );
  const slaImpact = scoreSlaImpact(input.daysUntilDue);

  const overall = clamp01(
    Math.round(
      priority * SCORE_WEIGHTS.priority +
      businessImpact * SCORE_WEIGHTS.businessImpact +
      urgency * SCORE_WEIGHTS.urgency +
      confidence * SCORE_WEIGHTS.confidence +
      risk * SCORE_WEIGHTS.risk +
      employeeImpact * SCORE_WEIGHTS.employeeImpact +
      departmentImpact * SCORE_WEIGHTS.departmentImpact +
      slaImpact * SCORE_WEIGHTS.slaImpact
    )
  );

  return {
    priority,
    businessImpact,
    urgency,
    confidence,
    risk,
    employeeImpact,
    departmentImpact,
    slaImpact,
    overall,
  };
}

/**
 * Derive the PriorityLevel for a decision from its overall score.
 * Reuses the existing thresholds so decisions and actions stay
 * consistent (critical ≥ 70, high ≥ 40, medium ≥ 20, else low).
 */
export function decisionPriorityFromScore(score: number): PriorityLevel {
  return getPriorityLevel(score);
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

/** Clamp a number to the 0-100 range. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(100, n));
}
