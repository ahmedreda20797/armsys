// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — barrel export (Phase 2)
//
//  Single public entry point (project barrel convention): consumers
//  import from '@/lib/kpi-reporting' and never reach into
//  sub-modules.
//
//  SCOPE LOCK (spec §40): this layer REPORTS. It never implements
//  Manager/HR/Target KPI, never redesigns the engine, and never
//  recalculates a closed month.
// ══════════════════════════════════════════════════════════════

export type {
  // basis & kinds
  KpiValueBasis,
  KpiReportKind,
  // statuses
  KpiReportRowStatus,
  KpiRowResultSource,
  KpiComponentResultStatus,
  KpiOverallStatus,
  // employee report
  KpiReportEmployeeInfo,
  KpiReportEmploymentStatus,
  KpiReportQualitySlice,
  KpiReportSchemeDisplay,
  KpiReportObservation,
  KpiReportObservationEffect,
  KpiReportTraceability,
  EmployeeKpiReport,
  KpiTrendPoint,
  KpiMomComparison,
  // monthly family
  KpiMonthlyFilters,
  KpiMonthlySort,
  KpiMonthlySortKey,
  KpiMonthlyReport,
  KpiMonthlyTotals,
  KpiReportRow,
  // summary
  KpiManagementSummary,
  KpiSummaryGroupBreakdown,
  // data contract (§28)
  KpiReportDataContract,
  KpiDataContractComponent,
} from './types';

export { KPI_REPORT_STATUS_RANK } from './types';

export {
  monthKeyOf,
  dayKeyOf,
  resolveValueBasis,
  previousMonthKey,
  trendWindow,
  KPI_OUTCOME_MESSAGES,
} from './period-basis';

export type { KpiReportingLoaders, ReportEmployee } from './loaders';
export {
  defaultKpiReportingLoaders,
  toFrameworkEmployee,
  resolveSchemeFromLoaded,
  employmentStatusOf,
} from './loaders';

export {
  findQualityComponent,
  toQualitySlice,
  deriveRowStatus,
  applyMonthlyFilters,
  sortMonthlyRows,
  computeMonthlyTotals,
} from './rows';
export type { RowIdentity } from './rows';

export { buildMonthlyKpiReport } from './monthly-report';
export type { BuildMonthlyKpiReportInput, MonthlyReportKind } from './monthly-report';

export { buildEmployeeKpiReport, buildMomComparison } from './employee-report';
export type { BuildEmployeeKpiReportInput } from './employee-report';

export { buildKpiManagementSummary, buildSummaryPayload, KPI_SUMMARY_LABEL } from './summary';

// KPI Reports 2.0 — insights workspace (composes the engines above)
export {
  buildKpiInsightsReport,
  defaultKpiInsightsLoaders,
  employeeIdsInOrgSubtrees,
  INSIGHTS_ATTENTION_DELTA_POINTS,
  INSIGHTS_TEAM_SIGNAL_DELTA_POINTS,
  INSIGHTS_PATTERN_EMPLOYEE_COUNT,
} from './insights';
export type {
  KpiInsightsReport,
  KpiInsightsSelection,
  KpiInsightsFilters,
  KpiInsightsLoaders,
  BuildKpiInsightsInput,
  EmployeeInsightFacts,
  UnitInsights,
  CategoryInsight,
  SeverityInsight,
  RepeatedIssueInsight,
  WindowRecurrenceInsight,
  InsightSignal,
  InsightSignalKind,
  InsightSignalLevel,
  ImprovementOpportunity,
  DataQualityEntry,
  InsightDataSource,
  InsightDataStatus,
  InsightSeverity,
} from './insights';

// §FLEX-PERIODS — flexible reporting periods + independent comparison
export { buildFlexibleKpiInsights, defaultFlexibleKpiLoaders } from './flexible-insights';
export type {
  BuildFlexibleKpiInsightsInput,
  FlexibleKpiLoaders,
  FlexibleKpiInsightsReport,
  FlexibleSpanMeta,
  FlexibleSpanBasis,
  FlexibleMonthBasis,
  FlexibleEmployeeKpi,
  FlexibleUnitRollup,
} from './flexible-insights';
export {
  resolveFlexiblePeriod,
  resolvePeriodWithComparison,
  previousPeriodSpecOf,
  periodsOverlap,
  weekStartOf,
  previousWeekStartOf,
  deriveComparisonSpec,
  FLEXIBLE_PERIOD_MAX_DAYS,
  FlexiblePeriodValidationError,
  isFlexiblePeriodValidationError,
} from './flexible-period';
export type {
  FlexiblePeriodKind,
  FlexiblePeriodSpec,
  FlexibleComparisonSpec,
  ResolvedFlexiblePeriod,
  FlexiblePeriodErrorCode,
} from './flexible-period';
