// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — barrel export (Phase 3)
//
//  Single public entry point (project barrel convention): consumers
//  import from '@/lib/performance-intelligence' and never reach into
//  sub-modules.
//
//  SCOPE LOCK (Phase-3 spec §35): this layer produces DETERMINISTIC
//  FACTS ONLY — no AI, no narratives, no Python, no new KPI
//  components, no source-record writes. The future AI layer will
//  interpret these facts.
// ══════════════════════════════════════════════════════════════

export type {
  // dataset + shared vocabularies
  EmployeePerformanceDataset,
  RelationshipConfidence,
  EvidenceReference,
  // identity / period / kpi / trend
  EmployeeIdentityFacts,
  PerformancePeriod,
  KpiFacts,
  KpiQualityFacts,
  ScoreTrendFacts,
  TrendDirection,
  // quality analysis
  ObservationAnalysisFacts,
  CategoryCount,
  MonthlyCount,
  RepeatedIssueGroup,
  WindowRepeatedIssueGroup,
  RepeatedIssuesFacts,
  QualityDeductionFacts,
  QualityDeductionRecordFacts,
  // operations
  ComplaintFacts,
  CapaFacts,
  FollowUpFacts,
  TravelDealFacts,
  AttendanceContextFacts,
  // dataset-level metadata
  PerformanceDataQuality,
  EvidenceGraph,
} from './types';

export {
  UNCLASSIFIED_KEY,
  DEFAULT_MIN_OCCURRENCES,
  aggregateObservations,
  detectRepeatedIssues,
  detectWindowRecurrence,
  aggregateQualityDeductions,
  countByMonth,
} from './quality-analysis';

export {
  aggregateComplaints,
  aggregateCapaCases,
  aggregateFollowUps,
  aggregateTravelDeals,
} from './operations-analysis';

export { buildAttendanceContext } from './attendance-context';

export { buildKpiFacts, buildScoreTrendFacts, deriveTrendDirection } from './kpi-facts';

export {
  PERFORMANCE_INTELLIGENCE_SOURCES,
  defaultPerformanceIntelligenceLoaders,
  attributeRecords,
  monthOfObservation,
  monthOfQualityDeduction,
  monthOfComplaint,
  monthOfCapa,
  monthOfFollowUp,
  monthOfDealTravel,
  monthOfDealClosed,
  monthOfDealCreated,
} from './loaders';
export type {
  PerformanceIntelligenceLoaders,
  EmployeeIdentityRecord,
  CapaRelationshipSplit,
  AttributedRecords,
} from './loaders';

export {
  monthKeyOfStoredMonth,
  monthKeyOfDisplayDate,
  monthKeyOfIso,
  attributeMonth,
  displayDateOrderKey,
} from './month-attribution';

export { assembleEmployeePerformanceDataset } from './assemble';
export type { AssembleEmployeePerformanceDatasetInput } from './assemble';

export {
  getEmployeePerformanceDataset,
  DEFAULT_WINDOW_MONTHS,
  MIN_WINDOW_MONTHS,
  MAX_WINDOW_MONTHS,
} from './service';
export type { GetEmployeePerformanceDatasetInput } from './service';
