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
  ReportColumnSpec,
  ReportDefinition,
  ReportFilterSpec,
  ReportMetricSpec,
  ReportRunRequest,
  ReportRunnerResult,
} from './types';
import { runQualityDeductionsReport } from './runners/quality-deductions';
import { runKpiReport } from './runners/kpi-monthly';
import { runKpiMasterEmployeeReport } from './runners/kpi-master-employee';
import { groupQualityDeductionsByEmployee } from './grouping/quality-deductions-grouped';

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
      { key: 'status', label: 'حالة الاعتماد', origin: 'raw' },
      { key: 'evidence', label: 'الدليل / الرابط', origin: 'raw', width: 28 },
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

// ─────────────────────────────────────────────────────────────
//  KPI Reporting Layer (Phase 2) — Monthly / MTD / Historical
//
//  Three logically separated reports over ONE shared runner core
//  (runKpiReport) that consumes the kpi-reporting layer verbatim —
//  no KPI value is computed here. Excel export flows through the
//  existing definition-driven buildReportExcel; the exported rows
//  are the SAME verified rows shown on screen (spec §22).
// ─────────────────────────────────────────────────────────────

const KPI_REPORT_COLUMNS: ReportColumnSpec[] = [
  { key: 'employeeName', label: 'الموظف', origin: 'raw' },
  { key: 'employeeCode', label: 'الرقم الوظيفي', origin: 'raw' },
  { key: 'department', label: 'القسم', origin: 'raw' },
  { key: 'team', label: 'الفريق', origin: 'raw' },
  { key: 'qualityRawScore', label: 'درجة الجودة (خام) %', origin: 'canonical', source: 'quality' },
  { key: 'qualityWeight', label: 'وزن الجودة %', origin: 'canonical', source: 'kpi-scheme' },
  { key: 'qualityContribution', label: 'مساهمة الجودة', origin: 'canonical', source: 'final-kpi' },
  { key: 'qualityStatus', label: 'حالة الجودة', origin: 'canonical', source: 'quality' },
  { key: 'overallKpiStatus', label: 'حالة KPI الإجمالية', origin: 'canonical', source: 'final-kpi' },
  { key: 'kpiStatus', label: 'حالة التقرير', origin: 'canonical', source: 'final-kpi' },
  { key: 'valueBasis', label: 'أساس القيمة', origin: 'raw' },
  { key: 'finalized', label: 'مجمّد', origin: 'raw' },
  { key: 'schemeName', label: 'مخطط KPI', origin: 'raw' },
  { key: 'schemeVersion', label: 'إصدار المخطط', origin: 'raw' },
  { key: 'archived', label: 'مؤرشف (أهلية تاريخية)', origin: 'raw' },
];

const KPI_REPORT_METRICS: ReportMetricSpec[] = [
  { metricId: 'eligibleEmployees', label: 'الموظفون المؤهلون', origin: 'canonical', source: 'final-kpi', unit: 'count' },
  { metricId: 'availableKpi', label: 'KPI متاح', origin: 'canonical', source: 'final-kpi', unit: 'count' },
  { metricId: 'pendingKpi', label: 'KPI معلّق', origin: 'canonical', source: 'final-kpi', unit: 'count' },
  { metricId: 'incompleteKpi', label: 'KPI غير مكتمل', origin: 'canonical', source: 'final-kpi', unit: 'count' },
  { metricId: 'finalizedKpi', label: 'KPI مجمّد', origin: 'canonical', source: 'final-kpi', unit: 'count' },
  { metricId: 'zeroKpi', label: 'KPI صفر', origin: 'canonical', source: 'quality', unit: 'count' },
  { metricId: 'avgQualityScore', label: 'متوسط درجة الجودة', origin: 'canonical', source: 'quality', unit: 'percent' },
  { metricId: 'avgQualityContribution', label: 'متوسط مساهمة الجودة', origin: 'canonical', source: 'final-kpi', unit: 'points' },
  { metricId: 'highestQualityScore', label: 'أعلى درجة', origin: 'canonical', source: 'quality', unit: 'percent' },
  { metricId: 'lowestQualityScore', label: 'أدنى درجة', origin: 'canonical', source: 'quality', unit: 'percent' },
];

const KPI_REPORT_FILTERS: ReportFilterSpec[] = [
  { key: 'monthKey', label: 'الشهر', control: 'month-select' },
  { key: 'employeeId', label: 'الموظف', control: 'employee-single' },
  { key: 'employeeIds', label: 'الموظفون', control: 'employee-multi' },
  { key: 'employeeScope', label: 'نطاق الموظفين', control: 'employee-scope' },
  { key: 'department', label: 'القسم', control: 'department' },
  {
    key: 'status',
    label: 'الحالة',
    control: 'select',
    options: [
      { value: 'AVAILABLE', label: 'AVAILABLE' },
      { value: 'PENDING', label: 'PENDING' },
      { value: 'INCOMPLETE', label: 'INCOMPLETE' },
      { value: 'ZERO', label: 'ZERO' },
      { value: 'FINALIZED', label: 'FINALIZED' },
      { value: 'NOT_ELIGIBLE', label: 'NOT_ELIGIBLE' },
      { value: 'NO_SCHEME', label: 'NO_SCHEME' },
    ],
  },
  { key: 'minScore', label: 'أدنى درجة خام', control: 'text' },
  { key: 'maxScore', label: 'أعلى درجة خام', control: 'text' },
];

const KPI_PERMISSION = {
  // The dedicated KPI reporting page key (existing permission system —
  // no parallel permission mechanism, spec §24).
  pageId: 'kpiReports',
  action: 'view' as const,
  allowedEmployeeScopeModes: ['single', 'multiple', 'all'] as const,
};

const KPI_MONTHLY_REPORT: RegisteredReport = {
  definition: {
    reportId: 'kpi-monthly',
    name: 'تقرير KPI الشهري (الجودة)',
    description: 'الدرجة الخام ووزن الجودة ومساهمتها لكل موظف مؤهل خلال شهر محدد — قيم مجمّدة للأشهر المغلقة وحية للشهر الحالي',
    domain: 'quality',
    reportType: 'performance',
    enabled: true,
    permission: KPI_PERMISSION,
    timeMechanism: 'month-scope',
    allowedScopes: ['selected_month', 'current_month', 'previous_month'],
    allowedFilters: KPI_REPORT_FILTERS,
    visibleColumns: KPI_REPORT_COLUMNS,
    availableMetrics: KPI_REPORT_METRICS,
    exportFormats: ['view', 'print', 'excel'],
    dataMode: 'hybrid',
  },
  run: async (ctx) => {
    const result = await runKpiReport(ctx.resolved, { kind: 'MONTHLY' });
    return result as unknown as ReportRunnerResult<Record<string, unknown>>;
  },
};

const KPI_MTD_REPORT: RegisteredReport = {
  definition: {
    reportId: 'kpi-mtd',
    name: 'تقرير KPI حتى تاريخه (MTD)',
    description: 'حساب الجودة حتى تاريخه (Month-To-Date) من بيانات الجودة الحية بقواعد الحساب الحالية — لا يُعرض كنهائي ما لم يُغلق الشهر',
    domain: 'quality',
    reportType: 'performance',
    enabled: true,
    permission: KPI_PERMISSION,
    timeMechanism: 'month-scope',
    allowedScopes: ['current_month', 'selected_month'],
    allowedFilters: KPI_REPORT_FILTERS,
    visibleColumns: KPI_REPORT_COLUMNS,
    availableMetrics: KPI_REPORT_METRICS,
    exportFormats: ['view', 'print', 'excel'],
    dataMode: 'live',
  },
  run: async (ctx) => {
    const result = await runKpiReport(ctx.resolved, { kind: 'MTD' });
    return result as unknown as ReportRunnerResult<Record<string, unknown>>;
  },
};

const KPI_HISTORICAL_REPORT: RegisteredReport = {
  definition: {
    reportId: 'kpi-historical',
    name: 'تقرير KPI التاريخي (الجودة)',
    description: 'نتائج الأشهر المغلقة من اللقطات المجمّدة حرفيًا — مع هوية المخطط والإصدار ووزن الجودة المجمّد لأغراض التدقيق',
    domain: 'quality',
    reportType: 'performance',
    enabled: true,
    permission: KPI_PERMISSION,
    timeMechanism: 'month-scope',
    allowedScopes: ['selected_month', 'previous_month'],
    allowedFilters: KPI_REPORT_FILTERS,
    visibleColumns: KPI_REPORT_COLUMNS,
    availableMetrics: KPI_REPORT_METRICS,
    exportFormats: ['view', 'print', 'excel'],
    dataMode: 'snapshot',
  },
  run: async (ctx) => {
    const result = await runKpiReport(ctx.resolved, { kind: 'HISTORICAL' });
    return result as unknown as ReportRunnerResult<Record<string, unknown>>;
  },
};

/**
 * §11 Quality Deductions — EMPLOYEE-GROUPED variant. ONE row per
 * employee (count · totals · chronological multi-line reasons cell)
 * with the deductions nested for on-screen expansion. Reads the SAME
 * verified flat rows as quality-deductions (one data path).
 */
export const QUALITY_DEDUCTIONS_GROUPED_REPORT: RegisteredReport<Record<string, unknown>> = {
  definition: {
    reportId: 'quality-deductions-grouped',
    name: 'تقرير خصومات الجودة — مجمّع حسب الموظف',
    description: 'صف واحد لكل موظف: عدد الخصومات وإجمالي الأيام والمبلغ مع تفاصيل الخصومات مرتبة زمنياً داخل الصف',
    domain: 'quality-deductions',
    reportType: 'operational',
    enabled: true,
    permission: {
      pageId: 'reports',
      action: 'view',
      allowedEmployeeScopeModes: ['single', 'multiple', 'all'],
    },
    timeMechanism: 'both',
    allowedScopes: ['selected_month', 'current_month', 'previous_month', 'last_3_months', 'last_6_months', 'current_year', 'custom_range'],
    allowedFilters: QUALITY_DEDUCTIONS_REPORT.definition.allowedFilters,
    visibleColumns: [
      { key: 'employeeName', label: 'الموظف', origin: 'raw' },
      { key: 'department', label: 'القسم', origin: 'raw' },
      { key: 'deductionCount', label: 'عدد الخصومات', origin: 'raw' },
      { key: 'totalDeductionDays', label: 'إجمالي أيام الخصم', origin: 'raw' },
      { key: 'totalMonetaryAmount', label: 'إجمالي المبلغ (ج.م)', origin: 'raw' },
      { key: 'reasons', label: 'تفاصيل الخصومات', origin: 'raw', width: 60 },
    ],
    availableMetrics: [
      { metricId: 'employees', label: 'عدد الموظفين', origin: 'raw', unit: 'count' },
      { metricId: 'deductionCount', label: 'عدد الخصومات', origin: 'raw', unit: 'count' },
      { metricId: 'totalDeductionDays', label: 'إجمالي أيام الخصم', origin: 'raw', unit: 'days' },
      { metricId: 'totalMonetaryAmount', label: 'إجمالي المبلغ المالي', origin: 'raw', unit: 'EGP' },
    ],
    exportFormats: ['view', 'print', 'excel'],
    dataMode: 'live',
  },
  run: async (ctx) => {
    const flat = await runQualityDeductionsReport(ctx.resolved);
    const groups = groupQualityDeductionsByEmployee(
      flat.rows as unknown as Parameters<typeof groupQualityDeductionsByEmployee>[0],
    );
    return {
      rows: groups as unknown as Record<string, unknown>[],
      summary: {
        employees: groups.length,
        deductionCount: flat.summary.deductionCount,
        totalDeductionDays: flat.summary.totalDeductionDays,
        totalMonetaryAmount: flat.summary.totalMonetaryAmount,
      },
      hasData: groups.length > 0,
      dataMode: flat.dataMode,
    } as unknown as ReportRunnerResult<Record<string, unknown>>;
  },
};

/**
 * §10 MASTER EMPLOYEE REPORT — one row per employee with quality
 * scores, KPI point-deduction count/reasons (bulleted multi-line cell
 * with the real human-readable reasons) and the ACTUAL evidence
 * (URL/text). §SEPARATION: KPI points only — payroll quality
 * discounts live in the quality-deductions reports, never here.
 */
export const KPI_MASTER_EMPLOYEE_REPORT: RegisteredReport<Record<string, unknown>> = {
  definition: {
    reportId: 'kpi-master-employee',
    name: 'التقرير الشامل لكل الموظفين (KPI)',
    description: 'صف واحد لكل موظف: الدرجات والحالة وخصومات النقاط (KPI) وأسبابها الحقيقية مع الأدلة — خصومات الجودة المالية في تقريرها المستقل',
    domain: 'quality',
    reportType: 'comprehensive',
    enabled: true,
    permission: KPI_PERMISSION,
    timeMechanism: 'month-scope',
    allowedScopes: ['selected_month', 'current_month', 'previous_month'],
    allowedFilters: [
      { key: 'monthKey', label: 'الشهر', control: 'month-select' },
      { key: 'employeeId', label: 'الموظف', control: 'employee-single' },
      { key: 'employeeScope', label: 'نطاق الموظفين', control: 'employee-scope' },
      { key: 'department', label: 'القسم', control: 'department' },
      {
        key: 'includeArchived',
        label: 'تضمين المؤرشفين',
        control: 'select',
        options: [
          { value: 'false', label: 'بدون المؤرشفين (افتراضي)' },
          { value: 'true', label: 'تضمين المؤرشفين' },
        ],
      },
    ],
    visibleColumns: [
      { key: 'employeeName', label: 'الموظف', origin: 'raw' },
      { key: 'employeeCode', label: 'الرقم الوظيفي', origin: 'raw' },
      { key: 'department', label: 'القسم', origin: 'raw' },
      { key: 'period', label: 'الفترة', origin: 'raw' },
      { key: 'qualityScore', label: 'درجة الجودة %', origin: 'canonical', source: 'quality' },
      { key: 'qualityWeight', label: 'وزن الجودة %', origin: 'canonical', source: 'kpi-scheme' },
      { key: 'qualityContribution', label: 'مساهمة الجودة', origin: 'canonical', source: 'final-kpi' },
      { key: 'weightedTotal', label: 'الإجمالي الموزون', origin: 'canonical', source: 'final-kpi' },
      { key: 'qualityStatus', label: 'حالة الجودة', origin: 'canonical', source: 'quality' },
      { key: 'kpiStatus', label: 'حالة التقرير', origin: 'canonical', source: 'final-kpi' },
      { key: 'deductionCount', label: 'عدد خصومات النقاط', origin: 'raw' },
      { key: 'pointsDeducted', label: 'النقاط المستقطعة', origin: 'raw' },
      { key: 'deductionReasons', label: 'أسباب خصم النقاط (KPI)', origin: 'raw', width: 60 },
      { key: 'evidenceRefs', label: 'الأدلة / الروابط', origin: 'raw', width: 28 },
      { key: 'summary', label: 'الملخص', origin: 'raw', width: 44 },
      { key: 'archived', label: 'مؤرشف', origin: 'raw' },
    ],
    availableMetrics: [
      { metricId: 'employees', label: 'عدد الموظفين', origin: 'raw', unit: 'count' },
      { metricId: 'withDeductions', label: 'موظفون بخصومات نقاط', origin: 'raw', unit: 'count' },
      { metricId: 'totalDeductions', label: 'إجمالي خصومات النقاط', origin: 'raw', unit: 'count' },
      { metricId: 'totalPointsDeducted', label: 'إجمالي النقاط المستقطعة', origin: 'raw', unit: 'points' },
      { metricId: 'avgQualityScore', label: 'متوسط درجة الجودة', origin: 'canonical', source: 'quality', unit: 'percent' },
    ],
    exportFormats: ['view', 'print', 'excel'],
    dataMode: 'hybrid',
  },
  run: async (ctx) => {
    const result = await runKpiMasterEmployeeReport(ctx.resolved);
    return result as unknown as ReportRunnerResult<Record<string, unknown>>;
  },
};

/** The registry. Future reports append here — nothing else changes. */
const REGISTRY: RegisteredReport[] = [
  QUALITY_DEDUCTIONS_REPORT as RegisteredReport,
  QUALITY_DEDUCTIONS_GROUPED_REPORT as RegisteredReport,
  KPI_MONTHLY_REPORT as RegisteredReport,
  KPI_MTD_REPORT as RegisteredReport,
  KPI_HISTORICAL_REPORT as RegisteredReport,
  KPI_MASTER_EMPLOYEE_REPORT as RegisteredReport,
];

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
