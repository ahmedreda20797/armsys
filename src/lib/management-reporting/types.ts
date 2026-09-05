// ══════════════════════════════════════════════════════════════
//  Management Reporting — Type Contracts (Milestone 7, Phase A)
//
//  A cross-domain MANAGEMENT report for one period: the existing
//  Quality KPI summary (kpi-reporting) consumed VERBATIM, presented
//  beside deterministic operational counts (complaints · CAPA ·
//  follow-ups · HR deductions) grouped per department/team.
//
//  BINDING RULES:
//    • ZERO score/weight/contribution recomputation — the quality
//      block IS the existing KpiManagementSummary (engine output).
//    • Operational domains are COUNT/aggregation only — they never
//      feed a KPI number and never redefine a business rule.
//    • Missing data is explicit (`count: 0` means genuinely zero
//      scoped records; empty groups are omitted, never fabricated).
//    • Every domain section carries its source table for audit.
// ══════════════════════════════════════════════════════════════

import type { KpiManagementSummary } from '@/lib/kpi-reporting';

/** How a domain's rows link to employees (mirrors scope doctrine). */
export type ManagementDomainSource =
  | 'complaints'
  | 'capaCases'
  | 'followUps'
  | 'hrDeductions';

/** One operational domain's period totals (scoped to the viewer). */
export interface DomainPeriodFacts {
  source: ManagementDomainSource;
  /** Human label (Arabic) for the UI. */
  label: string;
  /** Total scoped records whose date/month falls in the period. */
  total: number;
  /** Records with an OPEN operational status (domain-specific set). */
  open: number;
  /** Records with a CLOSED/resolved operational status. */
  closed: number;
  /** Status → count (raw vocabulary, never remapped). */
  byStatus: Record<string, number>;
}

/**
 * One department (or team) row: the employee group with its KPI
 * summary (engine output, when the group exists in the quality
 * summary) plus scoped operational counts for the same period.
 *
 * A group present ONLY in the operational data (e.g. a department
 * whose employees left quality untouched but logged complaints)
 * still appears — quality fields are null, never zero-filled.
 */
export interface DepartmentManagementRow {
  key: string;
  label: string;
  employeeCount: number;
  /** Verbatim engine group breakdown (null = no quality data). */
  quality: {
    avgRawScore: number | null;
    avgContribution: number | null;
  } | null;
  domains: Record<ManagementDomainSource, DomainPeriodFacts>;
}

/** Period attribution basis, surfaced for auditability. */
export type ManagementPeriodBasis = 'month' | 'createdRange';

/** The full cross-domain management report payload. */
export interface ManagementReport {
  reportKind: 'MANAGEMENT';
  monthKey: string;
  /** QUALITY_KPI label carried through from the engine summary. */
  statisticsKind: 'QUALITY_KPI';
  /** The engine's own summary — consumed verbatim, never reshaped. */
  qualitySummary: KpiManagementSummary;
  /** Department rows (engine groups merged with operational counts). */
  departments: DepartmentManagementRow[];
  /** Team rows (same shape; teams resolved from current org nodes). */
  teams: DepartmentManagementRow[];
  /** Company-wide operational totals for the period (scoped). */
  totals: {
    domains: Record<ManagementDomainSource, DomainPeriodFacts>;
  };
  /** Employees contributing operational records in the period. */
  activeEmployeeCount: number;
  /** Arabic explainability line: HOW the numbers were produced. */
  explanation: string;
  generatedAt: string;
}

/** Injectable loaders (project convention — pure tests, no Firebase mocking). */
export interface ManagementReportLoaders {
  /** Employees with department + org assignment (ONE cached read). */
  loadEmployees(): Promise<
    Array<{ id: string; name: string; department: string | null; orgNodeId: string | null }>
  >;
  /** Raw scoped rows for each operational domain (ONE read per table). */
  loadComplaints(): Promise<Array<Record<string, unknown>>>;
  loadCapaCases(): Promise<Array<Record<string, unknown>>>;
  loadFollowUps(): Promise<Array<Record<string, unknown>>>;
  loadHrDeductions(): Promise<Array<Record<string, unknown>>>;
  /** Org nodes for team-name resolution (ONE cached read). */
  loadOrgNodes(): Promise<Array<{ id: string; name: string; type: string }>>;
  /**
   * The existing engine's quality summary (THE authoritative source).
   * `scopeLimit` is the viewer's authorized employee set (null =
   * unrestricted) — the summary MUST be built with the same scope
   * as the operational rows.
   */
  loadQualitySummary(
    monthKey: string,
    scopeLimit: ReadonlyArray<string> | null,
  ): Promise<KpiManagementSummary>;
}
