// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — KPI Aggregator (Phase 1)
//
//  Aggregates available component results into the employee's
//  company-KPI result for one period under ONE exact scheme version.
//
//  DATA-INTEGRITY RULES (binding):
//    1. Missing components are PENDING placeholders — NEVER treated
//       as zero, NEVER redistributed, NEVER silently dropped from
//       the component list.
//    2. weightedTotal = Σ(weightedContribution of AVAILABLE
//       components only). With Quality 13.2/15 available and the
//       rest pending, weightedTotal is 13.2 — NOT 13.2/100, and NOT
//       rescaled to a fake "/100".
//    3. overallStatus = COMPLETE only when EVERY ACTIVE component
//       carries a value; otherwise INCOMPLETE. Scheme VALIDITY
//       (weights = 100%) and component AVAILABILITY are different
//       concerns — a valid scheme still yields INCOMPLETE results
//       while future components have no adapter.
// ══════════════════════════════════════════════════════════════

import type {
  EmployeeKpiResult,
  KpiComponentResult,
  KpiScheme,
} from './types';
import { KPI_FRAMEWORK_CALCULATION_VERSION } from './types';
import { roundTo2 } from './validation';

/** Component statuses that carry a real value (count toward the total). */
export function isValueBearingStatus(status: KpiComponentResult['status']): boolean {
  return (
    status === 'AVAILABLE' ||
    status === 'ZERO' ||
    status === 'FINALIZED'
  );
}

export interface AggregateEmployeeKpiInput {
  scheme: Pick<KpiScheme, 'id' | 'version' | 'name' | 'components'>;
  employeeId: string;
  /** `YYYY-MM` period. */
  period: string;
  /**
   * Provided component results (e.g. from the quality adapter).
   * Components of the scheme with no provided result become explicit
   * PENDING placeholders.
   */
  componentResults: ReadonlyArray<KpiComponentResult>;
  /** Snapshot close timestamp when the result is being frozen. */
  finalizedAt?: string | null;
}

/**
 * Aggregate component results into the employee's KPI result.
 * Pure — no DB, deterministic, rounding to 2 decimals.
 */
export function aggregateEmployeeKpi(input: AggregateEmployeeKpiInput): EmployeeKpiResult {
  const { scheme, employeeId, period, componentResults, finalizedAt } = input;

  const provided = new Map(componentResults.map((r) => [r.componentId, r]));

  // Every ACTIVE scheme component appears exactly once — either with
  // its provided result or as an explicit PENDING placeholder.
  const components: KpiComponentResult[] = scheme.components
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => {
      const result = provided.get(c.componentId);
      if (result) return result;
      return {
        componentId: c.componentId,
        name: c.name,
        owner: c.owner,
        weight: c.weight,
        status: 'PENDING',
        rawScore: null,
        weightedContribution: null,
        maxContribution: c.weight,
        evidence: null,
      } satisfies KpiComponentResult;
    });

  let availableWeight = 0;
  let weightedTotal = 0;
  let allAvailable = components.length > 0;

  for (const component of components) {
    if (isValueBearingStatus(component.status)) {
      availableWeight += component.weight;
      weightedTotal += component.weightedContribution ?? 0;
    } else {
      allAvailable = false;
    }
  }

  return {
    employeeId,
    period,
    schemeId: scheme.id,
    schemeVersion: scheme.version,
    schemeName: scheme.name,
    components,
    availableWeight: roundTo2(availableWeight),
    weightedTotal: roundTo2(weightedTotal),
    overallStatus: allAvailable ? 'COMPLETE' : 'INCOMPLETE',
    calculationVersion: KPI_FRAMEWORK_CALCULATION_VERSION,
    finalizedAt: finalizedAt ?? null,
  };
}
