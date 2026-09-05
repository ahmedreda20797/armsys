// ══════════════════════════════════════════════════════════════
//  Management Reporting — barrel export (Milestone 7, Phase A)
//
//  Consumers import from '@/lib/management-reporting' only.
//  SCOPE LOCK: this layer AGGREGATES AND PRESENTS. It never
//  recomputes a KPI value — the quality block IS the engine's
//  KpiManagementSummary passed through verbatim.
// ══════════════════════════════════════════════════════════════

export type {
  DepartmentManagementRow,
  DomainPeriodFacts,
  ManagementDomainSource,
  ManagementPeriodBasis,
  ManagementReport,
  ManagementReportLoaders,
} from './types';

export {
  aggregateDomainFacts,
  assembleManagementReport,
  buildManagementReport,
  emptyDomainFacts,
} from './aggregate';

export { defaultManagementReportLoaders } from './service';
