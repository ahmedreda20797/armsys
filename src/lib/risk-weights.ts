// ══════════════════════════════════════════════════════════════
//  Shared Risk Scoring Configuration
//  Single source of truth for all CAPA risk weights.
//  Used by: Risk Center API, Employee 360 API
// ══════════════════════════════════════════════════════════════

/**
 * CAPA risk factor weights used in risk score calculations.
 * Both Risk Center (/api/risk-center) and Employee 360
 * (/api/employee-360/[id]) MUST reference this config.
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
 * Maximum points cap for CAPA factors per employee
 * (prevents a single factor category from dominating)
 */
export const CAPA_RISK_CAPS = {
  openCapa: 25,
  overdueCapa: 30,
  criticalCapa: 30,
  reopenedCapa: 30,
} as const;