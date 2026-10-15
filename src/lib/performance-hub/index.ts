// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — barrel export (مركز أداء الموظف)
//
//  Single public entry point (project barrel convention): consumers
//  import from '@/lib/performance-hub' and never reach into
//  sub-modules.
//
//  SCOPE LOCK (Hub spec): this module is a CONSUMER/ANALYSIS layer
//  over the canonical engines. It never recalculates KPI/quality/
//  risk/attendance/deal/follow-up/HR metrics, never writes, never
//  introduces AI or a second scoring model.
// ══════════════════════════════════════════════════════════════

export type {
  // dataset + vocabularies
  EmployeePerformanceHubDataset,
  HubDimensionKey,
  HubDimensionStatus,
  HubOverviewStatus,
  HubPatternKind,
  HubDataQualityState,
  HubChangeUnit,
  HubDomain,
  // evidence primitives
  HubSourceRef,
  HubEvidenceItem,
  HubRecommendation,
  // dimensions / overview
  HubDimension,
  HubDimensionDetails,
  HubDimensionMetric,
  HubOverview,
  // analysis sections
  HubChangeItem,
  HubCrossSignal,
  HubPattern,
  HubTimelineEvent,
  HubRiskBlock,
  HubHrBlock,
  TeamBenchmarkBlock,
  TeamBenchmarkMetric,
  HubDataQualityItem,
  GetEmployeePerformanceHubDatasetInput,
} from './types';

export {
  // thresholds (documented tunables)
  QUALITY_DELTA_POINTS,
  FOLLOWUP_COMPLETION_DELTA,
  ATTENDANCE_COMPLIANCE_DELTA,
  ATTENDANCE_SOLID_COMPLIANCE,
  ATTENDANCE_LOW_COMPLIANCE,
  FOLLOWUP_STRONG_COMPLETION,
  FOLLOWUP_OVERDUE_ATTENTION,
  FOLLOWUP_OVERDUE_AREA,
  QUALITY_DEDUCTIONS_ATTENTION,
  QUALITY_DEDUCTIONS_AREA,
  HR_DEDUCTIONS_DECLINING,
  DECLINING_FOR_PIR,
  DECLINING_FOR_MANAGEMENT_REVIEW,
  MAX_SIGNALS,
  MAX_RECOMMENDATIONS,
  MAX_ISOLATED_LABELS,
  buildHubAnalysis,
} from './analysis';
export type { HubAnalysisInput, HubAnalysis } from './analysis';

export { computePeriodRisk, riskSignalsOf } from './risk-block';
export type { HubPeriodRiskRecords } from './risk-block';

export { buildHubTimeline, MAX_TIMELINE_EVENTS } from './timeline';

export { buildTeamBenchmark } from './team-benchmark';
export type { BuildTeamBenchmarkInput, TeamMemberBenchmarkValues } from './team-benchmark';

export { getEmployeePerformanceHubDataset } from './service';
export type { GetPerformanceHubServiceInput } from './service';
