// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — barrel export (Phase 1)
//
//  Single public entry point. Consumers import from '@/lib/kpi-framework'
//  and never reach into sub-modules (project barrel convention).
// ══════════════════════════════════════════════════════════════

export type {
  KpiScheme,
  KpiSchemeStatus,
  KpiSchemeComponent,
  KpiComponentOwner,
  KpiComponentCalculationType,
  KpiComponentStatus,
  KpiSchemeOverride,
  KpiSchemeResolution,
  KpiSchemeResolutionSource,
  KpiSchemeResolutionStatus,
  KpiComponentResult,
  KpiComponentResultStatus,
  KpiComponentEvidence,
  KpiOverallStatus,
  EmployeeKpiResult,
  KpiFrameworkEmployee,
  QualityScoreLookup,
} from './types';

export {
  KPI_SCHEMES_TABLE,
  KPI_SCHEME_OVERRIDES_TABLE,
  KPI_FRAMEWORK_CALCULATION_VERSION,
  DEFAULT_KPI_SCHEME_ID,
} from './types';

export {
  isValidDateKey,
  validateEffectiveWindow,
  validateSchemeComponents,
  validateSchemeWeightTotal,
  activeComponentsWeightTotal,
  schemeCoversPeriod,
  findConflictingActiveSchemes,
  validateSchemeInput,
  stripUndefinedForRtdb,
  monthDayRange,
  roundTo2,
} from './validation';
export type { SchemeValidationResult } from './validation';

export { resolveSchemeForEmployee } from './resolution';

export { buildQualityComponentResult } from './quality-adapter';
export type {
  QualityScoreInput,
  BuildQualityComponentResultInput,
} from './quality-adapter';

export { aggregateEmployeeKpi, isValueBearingStatus } from './aggregator';

export {
  KpiFrameworkValidationError,
  listKpiSchemes,
  getKpiSchemeById,
  createKpiScheme,
  updateKpiScheme,
  activateKpiScheme,
  getKpiSchemeOverride,
  setKpiSchemeOverride,
  ensureDefaultKpiSchemeSeed,
  DEFAULT_KPI_SCHEME_COMPONENTS,
} from './scheme-service';
export type { KpiFrameworkActor, CreateKpiSchemeInput, UpdateKpiSchemePatch } from './scheme-service';

export {
  buildEmployeeKpiResult,
  computeEmployeeKpiResult,
  computeEmployeeKpiResultWithLoaders,
  buildMonthKpiResults,
  buildMonthKpiResultsWithLoaders,
  isEmployeeEligibleForPeriod,
  withFinalizedAt,
  defaultKpiFrameworkLoaders,
  defaultKpiMonthResultsLoaders,
} from './employee-result';
export type {
  EmployeeResultLoaders,
  KpiMonthResultsLoaders,
  ComputeEmployeeKpiOutcome,
  EmployeeKpiOutcomeStatus,
  SnapshotLookup,
  BuildEmployeeKpiResultInput,
  EmploymentEventLike,
} from './employee-result';
