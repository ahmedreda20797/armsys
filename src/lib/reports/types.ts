// ══════════════════════════════════════════════════════════════
//  Unified Reporting Architecture — Type Layer (Milestone 8)
//
//  Reports are CONSUMERS of canonical domain data/results. They are
//  NOT calculation engines: no KPI formula, weight, score, ranking
//  or deduction may be (re)invented in the reporting layer. Derived
//  metrics are read from the canonical engines/results they declare
//  as their source.
//
//  Reused foundations (NO duplicate mechanisms created here):
//    • TimeScope          — @/lib/time-scope (Milestone 4 contract)
//    • Permissions        — @/config/permissions page/action model
//    • MetricResult       — @/lib/time-scope §F (metric provenance)
//    • API error shape    — @/lib/api-error (routes use apiError())
//
//  Three explicit dimensions every report MUST declare:
//    1. reportType  — operational | performance | comprehensive
//    2. dataMode    — live | snapshot | hybrid  (LIVE vs SNAPSHOT
//                     distinction, spec §5)
//    3. permission  — page + action in the EXISTING permission
//                     system (frontend hiding is NOT the boundary;
//                     the backend enforces report + data scope)
//
//  Admin future-proofing (spec §9): every ReportDefinition field is
//  plain serializable data (no functions) so a stored admin overlay
//  (enable/disable, visibleTo, filters, columns, metrics, scopes,
//  exports) can be merged over the static definitions later without
//  redesign.
// ══════════════════════════════════════════════════════════════

import type { ActionKey } from '@/config/permissions';
import type { MetricSource, TimeScope, TimeScopeKind } from '@/lib/time-scope';

// ─────────────────────────────────────────────────────────────
//  §1  Report classification
// ─────────────────────────────────────────────────────────────

/**
 * The domain a report belongs to. Mirrors the established
 * MetricSource vocabulary (@/lib/time-scope §F) so report metrics
 * attribute to exactly one canonical source; the open `string`
 * union keeps future domains addition-only.
 */
export type ReportDomain =
  | 'quality'
  | 'quality-deductions'
  | 'attendance'
  | 'attendance-reconciliation'
  | 'hr'
  | 'sales'
  | 'comprehensive'
  | (string & {});

/**
 * Spec §3 — the three report classes:
 *
 *  operational   — arbitrary date ranges over live operational data
 *                  (daily attendance, deals, quality deductions, …).
 *  performance   — monthly canonical results/snapshots; NEVER
 *                  recalculates historical KPI values from raw
 *                  records when an official result exists.
 *  comprehensive — combines multiple domain results into one
 *                  employee-level report (future Employee
 *                  Comprehensive Report).
 */
export type ReportType = 'operational' | 'performance' | 'comprehensive';

/**
 * Spec §5 — where a report's data comes from:
 *
 *  live     — current operational data (daily attendance, current
 *             observations/deals/deductions).
 *  snapshot — official historical/canonical monthly results
 *             (monthSnapshots, attendanceResults, …). Prevents
 *             finalized months from changing unexpectedly.
 *  hybrid   — snapshot when a closed/canonical result exists for a
 *             requested month, live otherwise (declared per row via
 *             ReportDataModeInfo so the distinction stays visible).
 */
export type ReportDataMode = 'live' | 'snapshot' | 'hybrid';

/** Which time mechanisms a report accepts (spec §6). */
export type ReportTimeMechanism =
  /** fromDate/toDate day ranges — operational reports. */
  | 'date-range'
  /** monthKey / monthKeys via TimeScope — monthly performance reports. */
  | 'month-scope'
  /** Both (e.g. quality deductions: day-level rows, month-scoped). */
  | 'both';

/** Output channels a report may declare (spec §20). */
export type ReportExportFormat = 'view' | 'print' | 'excel' | 'pdf';

// ─────────────────────────────────────────────────────────────
//  §2  Employee / department scope (spec §7)
// ─────────────────────────────────────────────────────────────

/** The employee-scoping modes a report supports. */
export type EmployeeScopeMode =
  | 'single'      // employeeId
  | 'multiple'    // employeeIds[]
  | 'all';        // employeeScope = 'all'

/** A resolved, validated employee scope for one report execution. */
export type EmployeeScope =
  | { mode: 'single'; employeeId: string }
  | { mode: 'multiple'; employeeIds: string[] }
  | { mode: 'all' };

/** Department scope — orthogonal to employee scope, additive only. */
export interface DepartmentScope {
  /** Filter rows to one department (null/absent = all departments). */
  department?: string | null;
}

// ─────────────────────────────────────────────────────────────
//  §3  Filter contract (spec §21)
// ─────────────────────────────────────────────────────────────

/**
 * The reusable filter vocabulary. Only filters declared in a
 * report's `allowedFilters` may be sent to its endpoint — anything
 * else is rejected server-side (no meaningless filters).
 */
export type ReportFilterKey =
  | 'period'          // TimeScope (month-scope mechanism)
  | 'fromDate'        // YYYY-MM-DD (date-range mechanism)
  | 'toDate'          // YYYY-MM-DD (date-range mechanism)
  | 'monthKey'        // single YYYY-MM
  | 'employeeId'
  | 'employeeIds'
  | 'employeeScope'
  | 'department'
  | 'category'
  | 'status'
  | 'severity'
  | 'actor'
  | 'entityType'
  | (string & {});

/** How a filter value is picked in the UI. */
export type ReportFilterControl =
  | 'month-select'    // monthKey dropdown (generateMonthOptions)
  | 'timescope'       // full TimeScope preset selector
  | 'date'            // single day picker
  | 'date-range'      // fromDate + toDate pair
  | 'employee-single' // EmployeeSearchInput
  | 'employee-multi'
  | 'employee-scope'  // single/multi/all switch
  | 'department'
  | 'select'          // options from filterOptions
  | 'text';

/** Declarative spec of one filter a report exposes. */
export interface ReportFilterSpec {
  key: ReportFilterKey;
  /** Arabic label shown in the filter bar. */
  label: string;
  control: ReportFilterControl;
  required?: boolean;
  /** Static options for `select` control ({value,label} pairs). */
  options?: ReadonlyArray<{ value: string; label: string }>;
}

// ─────────────────────────────────────────────────────────────
//  §4  Column & metric specs (spec §19 — source identification)
// ─────────────────────────────────────────────────────────────

/**
 * Where a report metric/column value comes from:
 *
 *  raw       — straight from a stored domain record (counts, sums).
 *  canonical — produced by a canonical engine/result (qualityScore,
 *              attendanceScore, hrFactor, salesScore, final score).
 *              NEVER recomputed in the reporting layer.
 */
export type ReportMetricOrigin = 'raw' | 'canonical';

/** One visible table column. */
export interface ReportColumnSpec {
  key: string;
  label: string;
  origin: ReportMetricOrigin;
  /** Canonical source domain when origin === 'canonical'. */
  source?: MetricSource;
  /** Column width hint for export/print layouts. */
  width?: number;
}

/** One summary/aggregate metric a report can expose. */
export interface ReportMetricSpec {
  metricId: string;
  label: string;
  origin: ReportMetricOrigin;
  source?: MetricSource;
  /** Unit for display/export (e.g. 'days', 'EGP', 'count', '%'). */
  unit?: 'days' | 'EGP' | 'count' | 'percent' | 'points' | 'minutes' | (string & {});
}

// ─────────────────────────────────────────────────────────────
//  §5  Permission spec (spec §8 — enforced server-side)
// ─────────────────────────────────────────────────────────────

/**
 * Permission requirement in the EXISTING page/action permission
 * system. `pageId` references APP_PAGES permission keys (e.g.
 * 'reports', 'quality'); `action` defaults to 'view'.
 *
 * allowedEmployeeScopeModes / allowedDepartments optionally narrow
 * WHICH data scopes the report may be executed with — the backend
 * rejects executions outside them (data scope enforcement, not UI
 * hiding).
 */
export interface ReportPermissionSpec {
  pageId: string;
  action?: ActionKey | 'view';
  /** Employee scope modes permitted for this report. */
  allowedEmployeeScopeModes?: readonly EmployeeScopeMode[];
  /** Departments permitted (absent = all). Reserved for future org scopes. */
  allowedDepartments?: readonly string[];
}

// ─────────────────────────────────────────────────────────────
//  §6  THE Report Definition contract (spec §4)
// ─────────────────────────────────────────────────────────────

/**
 * A registered report. Pure serializable data — the future Admin
 * Report Builder (spec §9) can overlay stored configuration
 * (enabled, visibleTo, filters, columns, metrics, scopes, exports)
 * onto these static definitions without any redesign.
 */
export interface ReportDefinition {
  /** Stable machine id, e.g. 'quality-deductions'. */
  reportId: string;
  /** Arabic display name. */
  name: string;
  /** Arabic description (what the report answers). */
  description: string;
  domain: ReportDomain;
  reportType: ReportType;
  /** Master switch — disabled reports resolve to invisible/404. */
  enabled: boolean;
  permission: ReportPermissionSpec;
  /** Time mechanisms accepted (spec §6). */
  timeMechanism: ReportTimeMechanism;
  /** TimeScope kinds accepted when timeMechanism includes month-scope. */
  allowedScopes?: readonly TimeScopeKind[];
  allowedFilters: readonly ReportFilterSpec[];
  visibleColumns: readonly ReportColumnSpec[];
  availableMetrics: readonly ReportMetricSpec[];
  exportFormats: readonly ReportExportFormat[];
  dataMode: ReportDataMode;
}

// ─────────────────────────────────────────────────────────────
//  §7  Execution request (client → API)
// ─────────────────────────────────────────────────────────────

/**
 * Payload sent to the unified report execution endpoint. Filters
 * are keyed by the report's allowed ReportFilterKey vocabulary.
 */
export interface ReportRunRequest {
  reportId: string;
  /** TimeScope payload for month-scope reports. */
  period?: TimeScope;
  /** Day-range for date-range reports (YYYY-MM-DD). */
  fromDate?: string;
  toDate?: string;
  /** Single-month shorthand (mutually exclusive with period). */
  monthKey?: string;
  employeeId?: string;
  employeeIds?: string[];
  employeeScope?: 'all';
  department?: string | null;
  /** Additional domain filters (category/status/severity/…). */
  filters?: Record<string, string | number | boolean>;
}

// ─────────────────────────────────────────────────────────────
//  §8  Execution response envelope (spec §22)
// ─────────────────────────────────────────────────────────────

/**
 * Per-row (and top-level) LIVE vs SNAPSHOT marker. A hybrid report
 * answers with the mode actually used per month so a finalized
 * month is never silently presented as live data.
 */
export interface ReportDataModeInfo {
  dataMode: ReportDataMode;
  /** Machine-readable scope label (describeTimeScope). */
  scopeLabel?: string;
  /** Canonical store backing the rows (e.g. 'monthSnapshots'). */
  source?: string;
}

/** Scope/permission context echoed back with every execution. */
export interface ReportScopeInfo {
  employeeScope: EmployeeScope;
  department?: string | null;
  /** Effective permission the execution was authorized under. */
  grantedBy: { pageId: string; action: string };
}

/** Shape returned by every report runner (before the envelope wraps it). */
export interface ReportRunnerResult<TRow = Record<string, unknown>> {
  rows: TRow[];
  summary: Record<string, number>;
  hasData: boolean;
  dataMode: ReportDataModeInfo;
}

/** Predictable per-execution metadata header (spec §22). */
export interface ReportRunMeta {
  reportId: string;
  name: string;
  domain: ReportDomain;
  reportType: ReportType;
  /** Machine-readable period (describeTimeScope or date range). */
  period: string;
  /** Explicit month keys covered, most recent first, when applicable. */
  monthKeys?: string[];
  /** Day range echo for operational reports. */
  range?: { fromDate: string; toDate: string };
  dataMode: ReportDataModeInfo;
  generatedAt: string;
}

/**
 * The unified report response. `rows`/`summary` are typed per report
 * by the report's runner; this envelope is the stable wrapper every
 * report endpoint returns.
 */
export interface ReportRunResponse<TRow = Record<string, unknown>> {
  meta: ReportRunMeta;
  filters: Record<string, unknown>;
  hasData: boolean;
  rows: TRow[];
  /** Aggregate totals keyed by ReportMetricSpec.metricId. */
  summary: Record<string, number>;
  scope: ReportScopeInfo;
}
