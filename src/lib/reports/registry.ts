// ══════════════════════════════════════════════════════════════
//  Report Registry & Catalog (Milestone 8)
//
//  ONE registry for every report in ARM ERP. Adding a report =
//  registering a ReportDefinition (+ a runner that consumes
//  canonical domain data). No new reporting foundation per report.
//
//  Admin future-proofing (spec §9): definitions are plain
//  serializable data. A stored admin overlay (enabled flags,
//  visibility, filters, columns, metrics, scopes, export formats)
//  can be merged over REPORT_REGISTRY at resolution time later —
//  the resolution functions below are the ONLY access paths, so
//  that switch changes no consumer.
//
//  Runners are the ONLY place a report touches data, and they are
//  forbidden from computing KPI values (see quality-deductions.ts).
// ══════════════════════════════════════════════════════════════

import type { ResolvedReportRequest } from './scope';
import type {
  ReportDefinition,
  ReportRunRequest,
  ReportRunnerResult,
} from './types';
import { runQualityDeductionsReport } from './runners/quality-deductions';

// ─────────────────────────────────────────────────────────────
//  Runner contract
// ─────────────────────────────────────────────────────────────

/** Context handed to a runner by the unified execution route. */
export interface ReportRunnerContext {
  request: ReportRunRequest;
  resolved: ResolvedReportRequest;
  /** Authenticated actor (from verifyPermission on the route). */
  actor: { userId: string; role: string };
}

/** A report's data executor. Generic in its row type. */
export type ReportRunner<TRow = Record<string, unknown>> = (
  ctx: ReportRunnerContext,
) => Promise<ReportRunnerResult<TRow>>;

/** A registered report: definition + runner. */
export interface RegisteredReport<TRow = Record<string, unknown>> {
  definition: ReportDefinition;
  run: ReportRunner<TRow>;
}

// ─────────────────────────────────────────────────────────────
//  Registered reports
// ─────────────────────────────────────────────────────────────

/**
 * Quality Deductions Report — the Milestone 8 REFERENCE report
 * (spec §10/§31 STEP 8). Day-first deductions, optional monetary
 * amount, operational date ranges + month scoping, full employee
 * scope, department filter, category filter. LIVE data mode.
 */
export const QUALITY_DEDUCTIONS_REPORT: RegisteredReport<Record<string, unknown>> = {
  definition: {
    reportId: 'quality-deductions',
    name: 'تقرير خصومات الجودة',
    description: 'خصومات الجودة المسجلة على الموظفين — أيام الخصم أساساً والمبلغ المالي اختياري (أثر مالي وأثر أداء منفصلان)',
    domain: 'quality-deductions',
    reportType: 'operational',
    enabled: true,
    permission: {
      // Existing page/action permission key — same grant the legacy
      // reports page uses; backend enforcement happens in the route.
      pageId: 'reports',
      action: 'view',
      allowedEmployeeScopeModes: ['single', 'multiple', 'all'],
    },
    timeMechanism: 'both',
    allowedScopes: ['selected_month', 'current_month', 'previous_month', 'last_3_months', 'last_6_months', 'current_year', 'custom_range'],
    allowedFilters: [
      { key: 'fromDate', label: 'من تاريخ', control: 'date', },
      { key: 'toDate', label: 'إلى تاريخ', control: 'date', },
      { key: 'monthKey', label: 'الشهر', control: 'month-select' },
      { key: 'employeeId', label: 'الموظف', control: 'employee-single' },
      { key: 'employeeIds', label: 'الموظفون', control: 'employee-multi' },
      { key: 'employeeScope', label: 'نطاق الموظفين', control: 'employee-scope' },
      { key: 'department', label: 'القسم', control: 'department' },
      { key: 'category', label: 'نوع الخصم', control: 'text' },
    ],
    visibleColumns: [
      { key: 'employeeName', label: 'الموظف', origin: 'raw' },
      { key: 'department', label: 'القسم', origin: 'raw' },
      { key: 'category', label: 'نوع الخصم', origin: 'raw' },
      { key: 'description', label: 'الوصف', origin: 'raw', width: 36 },
      { key: 'date', label: 'التاريخ', origin: 'raw' },
      { key: 'month', label: 'الفترة', origin: 'raw' },
      { key: 'deductionDays', label: 'أيام الخصم', origin: 'raw', source: 'quality-deductions' },
      { key: 'monetaryAmount', label: 'المبلغ المالي (اختياري)', origin: 'raw', source: 'quality-deductions' },
      { key: 'relatedCapaId', label: 'كابا مرتبطة', origin: 'raw' },
    ],
    availableMetrics: [
      { metricId: 'deductionCount', label: 'عدد الخصومات', origin: 'raw', unit: 'count' },
      { metricId: 'totalDeductionDays', label: 'إجمالي أيام الخصم', origin: 'raw', source: 'quality-deductions', unit: 'days' },
      { metricId: 'totalMonetaryAmount', label: 'إجمالي المبلغ المالي', origin: 'raw', source: 'quality-deductions', unit: 'EGP' },
    ],
    exportFormats: ['view', 'print', 'excel'],
    dataMode: 'live',
  },
  run: async (ctx) => {
    const result = await runQualityDeductionsReport(ctx.resolved);
    return result as unknown as ReportRunnerResult<Record<string, unknown>>;
  },
};

/** The registry. Future reports append here — nothing else changes. */
const REGISTRY: RegisteredReport[] = [QUALITY_DEDUCTIONS_REPORT as RegisteredReport];

// ─────────────────────────────────────────────────────────────
//  Resolution
// ─────────────────────────────────────────────────────────────

/** All registered definitions (catalog listing; runners stripped). */
export function listReportDefinitions(): ReportDefinition[] {
  return REGISTRY.map((r) => r.definition);
}

/** Look up a registered report. Disabled/unknown → null. */
export function getRegisteredReport(reportId: string): RegisteredReport | null {
  const found = REGISTRY.find((r) => r.definition.reportId === reportId);
  if (!found || !found.definition.enabled) return null;
  return found;
}

/** Definition-only lookup (catalog consumers). */
export function getReportDefinition(reportId: string): ReportDefinition | null {
  return getRegisteredReport(reportId)?.definition ?? null;
}

// ─────────────────────────────────────────────────────────────
//  Structural validation (focused-test target)
// ─────────────────────────────────────────────────────────────

/**
 * Validate a report definition against the contract invariants.
 * Returns the first violation as an Arabic-free machine message, or
 * null when valid. Used by tests to pin the contract and by the
 * registry to fail fast on developer mistakes.
 */
export function validateReportDefinition(def: ReportDefinition): string | null {
  if (!def.reportId || typeof def.reportId !== 'string') return 'reportId required';
  if (!def.name) return 'name required';
  if (!def.permission?.pageId) return 'permission.pageId required';
  if (!['operational', 'performance', 'comprehensive'].includes(def.reportType)) {
    return `invalid reportType: ${String(def.reportType)}`;
  }
  if (!['live', 'snapshot', 'hybrid'].includes(def.dataMode)) {
    return `invalid dataMode: ${String(def.dataMode)}`;
  }
  if (!['date-range', 'month-scope', 'both'].includes(def.timeMechanism)) {
    return `invalid timeMechanism: ${String(def.timeMechanism)}`;
  }
  if (def.timeMechanism !== 'date-range' && (!def.allowedScopes || def.allowedScopes.length === 0)) {
    return 'month-capable reports must declare allowedScopes';
  }
  if (!def.exportFormats.includes('view')) return 'view must be an export format';
  const filterKeys = new Set(def.allowedFilters.map((f) => f.key as string));
  if (def.timeMechanism === 'date-range' && (!filterKeys.has('fromDate') || !filterKeys.has('toDate'))) {
    return 'date-range reports must expose fromDate/toDate filters';
  }
  if (def.timeMechanism === 'both' && !filterKeys.has('monthKey')) {
    return 'both-mechanism reports must expose monthKey';
  }
  for (const col of def.visibleColumns) {
    if (col.origin === 'canonical' && !col.source) {
      return `canonical column missing source: ${col.key}`;
    }
  }
  for (const metric of def.availableMetrics) {
    if (metric.origin === 'canonical' && !metric.source) {
      return `canonical metric missing source: ${metric.metricId}`;
    }
  }
  return null;
}

/** Validate every registered definition (used by the test suite). */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of REGISTRY) {
    const err = validateReportDefinition(r.definition);
    if (err) errors.push(`${r.definition.reportId}: ${err}`);
    if (seen.has(r.definition.reportId)) errors.push(`duplicate reportId: ${r.definition.reportId}`);
    seen.add(r.definition.reportId);
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────
//  Permission-aware visibility (spec §8)
// ─────────────────────────────────────────────────────────────

/**
 * Permission checker shape — matches what both the client
 * (usePermissions.getPermission) and server (PermissionsMap) can
 * supply without importing React or Next here.
 */
export interface ReportPermissionChecker {
  isAdmin: boolean;
  /** Effective PagePermission for a page permission key. */
  getPermission: (pageId: string) => { level: string; actions?: Record<string, boolean> };
}

/**
 * Whether a user may SEE a report in a catalog. Mirrors the
 * server-side action semantics of verifyPermission: 'view'/no-action
 * → level !== 'none'. Frontend visibility is a UX concern ONLY —
 * the API route independently enforces the same rule server-side.
 */
export function canSeeReport(def: ReportDefinition, checker: ReportPermissionChecker): boolean {
  if (!def.enabled) return false;
  if (checker.isAdmin) return true;
  const perm = checker.getPermission(def.permission.pageId);
  return perm.level !== 'none';
}

/**
 * Whether a user may EXPORT a report (excel action gated by the
 * existing 'export' ActionKey on the report's page).
 */
export function canExportReport(def: ReportDefinition, checker: ReportPermissionChecker): boolean {
  if (!def.exportFormats.includes('excel')) return false;
  if (!canSeeReport(def, checker)) return false;
  if (checker.isAdmin) return true;
  const perm = checker.getPermission(def.permission.pageId);
  if (perm.level !== 'edit') return false;
  return perm.actions?.export === true;
}

/** Definitions visible to a user (permission-filtered catalog). */
export function listVisibleReports(checker: ReportPermissionChecker): ReportDefinition[] {
  return listReportDefinitions().filter((d) => canSeeReport(d, checker));
}
