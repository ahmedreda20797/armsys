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
