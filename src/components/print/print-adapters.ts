// ══════════════════════════════════════════════════════════════
//  Print adapters — map EXISTING report payloads into the generic
//  PrintReportModel. §PRINT (Requirement 7): printing targets exactly
//  these three sections:
//      1. ملخص الجودة            (KpiManagementSummary)
//      2. التقرير الإداري الشامل  (ManagementReport)
//      3. تحليل الأداء            (EmployeePerformanceDataset)
//
//  Adapters are pure projections of data the tabs ALREADY hold —
//  opening the print view never refetches. Missing data is rendered
//  as '—', never fabricated.
// ══════════════════════════════════════════════════════════════

import type { PrintReportModel, PrintSection } from './print-report-store';
import { formatNumber, formatPercentage, formatMonthKey, displayLocale } from '@/lib/i18n/format';

const dash = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : String(v);

const num = (v: unknown): string =>
  v === null || v === undefined ? '—' : formatNumber(Number(v));

const pct = (v: unknown): string =>
  v === null || v === undefined ? '—' : formatPercentage(Number(v));

const monthLabel = (monthKey?: string | null): string => formatMonthKey(monthKey);

// ─────────────────────────────────────────────────────────────
//  §I18N-BOUNDARY — system-generated STATUS labels only.
//  These helpers localize APPLICATION-OWNED enum vocabulary (status /
//  severity / employment / decision SYSTEM labels) at model-build time.
//  They must never be fed user data — names, notes and descriptions
//  bypass them entirely and are rendered exactly as stored.
// ─────────────────────────────────────────────────────────────
const ui = (ar: string, en: string): string => (displayLocale() === 'en' ? en : ar);

/** [ar, en] label for a system enum code; unknown codes pass through raw. */
const uiMap = (map: Record<string, [string, string]>, code: string | null | undefined, fallback = '—'): string => {
  if (!code) return fallback;
  const entry = map[code];
  return entry ? (displayLocale() === 'en' ? entry[1] : entry[0]) : fallback;
};

const SEVERITY_LABELS: Record<string, [string, string]> = {
  low: ['منخفضة', 'Low'], medium: ['متوسطة', 'Medium'], high: ['مرتفعة', 'High'], critical: ['حرجة', 'Critical'],
  HIGH: ['مرتفعة', 'High'], MEDIUM: ['متوسطة', 'Medium'], LOW: ['منخفضة', 'Low'],
};

// ─────────────────────────────────────────────────────────────
//  1) ملخص الجودة — KpiManagementSummary
// ─────────────────────────────────────────────────────────────

interface KpiSummaryGroupLike {
  key: string;
  label: string;
  employeeCount: number;
  avgRawScore: number | null;
  avgContribution: number | null;
}

interface KpiManagementSummaryLike {
  reportKind?: 'SUMMARY';
  monthKey?: string;
  label?: string;
  statisticsKind?: string;
  counts?: Record<string, number | null>;
  qualityAverages?: {
    avgRawScore?: number | null;
    avgContribution?: number | null;
    highest?: { employeeName?: string; rawScore?: number } | null;
    lowest?: { employeeName?: string; rawScore?: number } | null;
  } | null;
  departments?: KpiSummaryGroupLike[];
  teams?: KpiSummaryGroupLike[];
  generatedAt?: string;
}

function groupSection(heading: string, groups?: KpiSummaryGroupLike[]): PrintSection {
  const rows = (groups ?? []).map((g) => [
    g.label ?? g.key,
    num(g.employeeCount),
    pct(g.avgRawScore),
    num(g.avgContribution),
  ]);
  return {
    heading,
    table: {
      columns: ['المجموعة', 'عدد الموظفين', 'متوسط درجة الجودة', 'متوسط المساهمة'],
      rows,
    },
  };
}

export function qualitySummaryToPrintModel(summary: KpiManagementSummaryLike): PrintReportModel {
  const c = summary.counts ?? {};
  const avg = summary.qualityAverages;
  return {
    title: 'ملخص الجودة',
    subject: summary.label || 'إحصائيات جودة KPI',
    period: monthLabel(summary.monthKey),
    generatedAt: summary.generatedAt,
    stats: [
      { label: 'الموظفون المؤهلون', value: num(c.eligible) },
      { label: 'KPI متاح', value: num(c.available) },
      { label: 'معلق', value: num(c.pending) },
      { label: 'غير مكتمل', value: num(c.incomplete) },
      { label: 'صفر', value: num(c.zero) },
      { label: 'مجمّد', value: num(c.finalized) },
      { label: 'متوسط درجة الجودة', value: pct(avg?.avgRawScore) },
      { label: 'متوسط المساهمة', value: num(avg?.avgContribution) },
      { label: 'أعلى درجة', value: avg?.highest ? `${avg.highest.employeeName ?? '—'} (${num(avg.highest.rawScore)}%)` : '—' },
      { label: 'أدنى درجة', value: avg?.lowest ? `${avg.lowest.employeeName ?? '—'} (${num(avg.lowest.rawScore)}%)` : '—' },
    ],
    sections: [
      groupSection('الأداء حسب القسم', summary.departments),
      groupSection('الأداء حسب الفريق', summary.teams),
    ],
    footerNote: ui(
      'إحصائيات جودة KPI (ليست إحصائيات KPI على مستوى الشركة) — مصدر البيانات: محرك الجودة.',
      'Quality KPI statistics (never company-level KPI statistics) — data source: the quality engine.',
    ),
  };
}

// ─────────────────────────────────────────────────────────────
//  2) التقرير الإداري الشامل — ManagementReport
// ─────────────────────────────────────────────────────────────

interface DomainFactsLike {
  label?: string;
  total?: number;
  open?: number;
  closed?: number;
}

interface DepartmentRowLike {
  key?: string;
  label?: string;
  employeeCount?: number;
  quality?: { avgRawScore?: number | null; avgContribution?: number | null } | null;
  domains?: Record<string, DomainFactsLike>;
}

interface ManagementReportLike {
  monthKey?: string;
  explanation?: string;
  generatedAt?: string;
  qualitySummary?: KpiManagementSummaryLike | null;
  departments?: DepartmentRowLike[];
  teams?: DepartmentRowLike[];
  totals?: { domains?: Record<string, DomainFactsLike> };
  activeEmployeeCount?: number;
}

const DOMAIN_ORDER = ['complaints', 'capaCases', 'followUps', 'hrDeductions'] as const;
const DOMAIN_LABELS: Record<string, [string, string]> = {
  complaints: ['الشكاوى', 'Complaints'],
  capaCases: ['كابا', 'CAPA'],
  followUps: ['المتابعات', 'Follow-ups'],
  hrDeductions: ['خصومات الموارد البشرية', 'HR Deductions'],
};
const domainLabel = (k: string): string => (DOMAIN_LABELS[k] ? (displayLocale() === 'en' ? DOMAIN_LABELS[k][1] : DOMAIN_LABELS[k][0]) : k);

function deptTable(rows?: DepartmentRowLike[]): PrintSection {
  const tableRows = (rows ?? []).map((r) => {
    const domains = r.domains ?? {};
    return [
      r.label ?? '—',
      num(r.employeeCount),
      pct(r.quality?.avgRawScore),
      num(r.quality?.avgContribution),
      ...DOMAIN_ORDER.map((k) => num(domains[k]?.total ?? 0)),
      ...DOMAIN_ORDER.map((k) => num(domains[k]?.open ?? 0)),
    ];
  });
  return {
    heading: 'الإدارات والفرق',
    table: {
      columns: [
        'المجموعة', 'الموظفون', 'متوسط درجة الجودة', 'متوسط المساهمة',
        ...DOMAIN_ORDER.map((k) => `${domainLabel(k)} ${ui('(إجمالي)', '(total)')}`),
        ...DOMAIN_ORDER.map((k) => `${domainLabel(k)} ${ui('(مفتوح)', '(open)')}`),
      ],
      rows: tableRows,
      ltrColumns: [],
    },
  };
}

export function managementReportToPrintModel(report: ManagementReportLike): PrintReportModel {
  const totals = report.totals?.domains ?? {};
  return {
    title: 'التقرير الإداري الشامل',
    subject: 'ملخص إداري مركزي — الجودة والعمليات',
    period: monthLabel(report.monthKey),
    generatedAt: report.generatedAt,
    stats: [
      { label: 'الشهر', value: monthLabel(report.monthKey) || '—' },
      { label: 'موظفون بنشاط مسجل', value: num(report.activeEmployeeCount) },
      ...DOMAIN_ORDER.map((k) => ({
        label: `${domainLabel(k)} ${ui('— إجمالي', '— total')}`,
        value: num(totals[k]?.total ?? 0),
        hint: totals[k] ? `${ui('مفتوح', 'Open')}: ${num(totals[k]?.open ?? 0)}` : undefined,
      })),
    ],
    sections: [
      deptTable(report.departments),
      deptTable(report.teams),
      ...(report.explanation
        ? [{ heading: 'منهجية التقرير', paragraphs: [report.explanation] } satisfies PrintSection]
        : []),
    ],
    footerNote: ui(
      'الكتل الكمية: كتل إدارية بحتة — لا تغيّر أي قاعدة عمل أو نتيجة KPI.',
      'Quantity blocks: purely administrative — no business rule or KPI result changes.',
    ),
  };
}

// ─────────────────────────────────────────────────────────────
//  3) تحليل الأداء — EmployeePerformanceDataset
// ─────────────────────────────────────────────────────────────

interface DeductionRecordLike {
  id?: string;
  date?: string;
  type?: string;
  description?: string;
  deductionDays?: number;
  deductionAmount?: number;
}

interface ObservationRecordLike {
  id?: string;
  observationDate?: string;
  categoryName?: string;
  points?: number;
  isBonus?: boolean;
  approvalStatus?: string;
  notes?: string;
}

interface DatasetLike {
  employee?: { name?: string; department?: string | null; position?: string | null; code?: string | null; team?: string | null };
  period?: { label?: string; months?: string[]; monthKey?: string };
  kpi?: {
    weightedTotal?: number | null;
    quality?: { rawScore?: number | null; weight?: number | null; contribution?: number | null; status?: string | null } | null;
    overallStatus?: string | null;
    message?: string | null;
  };
  quality?: {
    observations?: {
      total?: number; approved?: number; pending?: number; rejected?: number;
      records?: ObservationRecordLike[];
      /** Deterministic distributions (EmployeePerformanceDataset) — printed as stats when present. */
      bySeverity?: Record<string, number>;
      byResolutionStatus?: Record<string, number>;
      byCategory?: Array<{ categoryId: string | null; categoryName: string; count: number }>;
    };
    deductions?: { count?: number; totalDays?: number; totalAmount?: number; records?: DeductionRecordLike[] };
  };
  complaints?: { total?: number; stillOpen?: number; resolvedOrClosed?: number; avgResolutionDays?: number | null };
  capa?: { total?: number; active?: number; overdue?: number; closedCount?: number };
  followUps?: { total?: number; active?: number; overdue?: number; completionRate?: number | null };
  generatedAt?: string;
}

const OBS_STATUS_LABELS: Record<string, [string, string]> = {
  pending: ['قيد الاعتماد', 'Pending'],
  approved: ['معتمدة', 'Approved'],
  rejected: ['مرفوضة', 'Rejected'],
};

export function performanceDatasetToPrintModel(
  dataset: DatasetLike,
  options?: { title?: string },
): PrintReportModel {
  const sections: PrintSection[] = [];

  const observations = dataset.quality?.observations;
  if (observations?.records && observations.records.length > 0) {
    // Deterministic distributions first — the printed report must carry
    // the same analysis the screen shows, not only the raw record list.
    const distroRows: Array<Array<string | number>> = [
      ...Object.entries(observations.bySeverity ?? {}).map(([k, v]) => [ui('الخطورة', 'Severity'), uiMap(SEVERITY_LABELS, k, k), v] as Array<string | number>),
      ...Object.entries(observations.byResolutionStatus ?? {}).map(([k, v]) => [ui('حالة المعالجة', 'Resolution status'), uiMap(SEVERITY_LABELS, k, k), v] as Array<string | number>),
      ...(observations.byCategory ?? []).map((c) => [ui('التصنيف', 'Category'), c.categoryId === '_unclassified' ? ui('غير مصنّف', 'Uncategorized') : c.categoryName, c.count] as Array<string | number>),
    ];
    sections.push({
      heading: 'إحصائيات ملاحظات الجودة',
      stats: [
        { label: 'إجمالي الملاحظات', value: num(observations.total) },
        { label: 'معتمدة', value: num(observations.approved) },
        { label: 'قيد الاعتماد', value: num(observations.pending) },
        { label: 'مرفوضة', value: num(observations.rejected) },
      ],
      table: distroRows.length > 0
        ? { columns: ['البعد', 'القيمة', 'العدد'], rows: distroRows }
        : undefined,
    });
    sections.push({
      heading: 'ملاحظات الجودة',
      table: {
        columns: ['التاريخ', 'التصنيف', 'النقاط', 'الحالة', 'التفاصيل'],
        rows: observations.records.map((o) => [
          dash(o.observationDate),
          dash(o.categoryName),
          o.isBonus ? `+${num(o.points)}` : (o.points ? `−${num(o.points)}` : '—'),
          uiMap(OBS_STATUS_LABELS, o.approvalStatus, dash(o.approvalStatus)),
          dash(o.notes),
        ]),
      },
    });
  }

  const deductions = dataset.quality?.deductions;
  if (deductions?.records && deductions.records.length > 0) {
    sections.push({
      heading: 'خصومات الجودة',
      table: {
        columns: ['التاريخ', 'النوع', 'الأيام', 'المبلغ (ج.م)', 'التفاصيل'],
        rows: deductions.records.map((d) => [
          dash(d.date),
          dash(d.type),
          num(d.deductionDays),
          num(d.deductionAmount),
          dash(d.description),
        ]),
      },
    });
  }

  const capa = dataset.capa;
  if (capa) {
    sections.push({
      heading: 'خطأ وتصحيح (كابا)',
      stats: [
        { label: 'إجمالي الحالات', value: num(capa.total) },
        { label: 'حالات نشطة', value: num(capa.active) },
        { label: 'متأخرة', value: num(capa.overdue) },
        { label: 'مغلقة', value: num(capa.closedCount) },
      ],
    });
  }

  const followUps = dataset.followUps;
  if (followUps) {
    sections.push({
      heading: 'المتابعات اليومية',
      stats: [
        { label: 'الإجمالي', value: num(followUps.total) },
        { label: 'نشطة', value: num(followUps.active) },
        { label: 'متأخرة', value: num(followUps.overdue) },
        { label: 'نسبة الإنجاز', value: followUps.completionRate == null ? '—' : `${num(followUps.completionRate)}%` },
      ],
    });
  }

  const complaints = dataset.complaints;
  if (complaints) {
    sections.push({
      heading: 'شكاوى العملاء',
      stats: [
        { label: 'الإجمالي', value: num(complaints.total) },
        { label: 'مفتوحة', value: num(complaints.stillOpen) },
        { label: 'محلولة/مغلقة', value: num(complaints.resolvedOrClosed) },
        { label: 'متوسط زمن الحل (يوم)', value: num(complaints.avgResolutionDays) },
      ],
    });
  }

  const quality = dataset.kpi?.quality;
  return {
    title: options?.title ?? 'تحليل الأداء',
    subject: [
      dataset.employee?.name,
      (dataset.employee as { code?: string | null } | undefined)?.code,
      dataset.employee?.department,
      dataset.period?.label,
    ].filter(Boolean).join(' — '),
    // §PRINT-HEADER — structured employee identity from authoritative
    // sources (employee record + org tree), never a generic label.
    identity: {
      name: dataset.employee?.name,
      code: (dataset.employee as { code?: string | null } | undefined)?.code,
      position: dataset.employee?.position ?? null,
      team: dataset.employee?.team ?? null,
      department: dataset.employee?.department ?? null,
    },
    period: dataset.period?.label || monthLabel(dataset.period?.monthKey),
    generatedAt: dataset.generatedAt,
    stats: [
      { label: 'درجة الجودة (خام)', value: pct(quality?.rawScore) },
      { label: 'وزن الجودة', value: pct(quality?.weight) },
      { label: 'مساهمة الجودة', value: num(quality?.contribution) },
      { label: 'الإجمالي الموزون', value: num(dataset.kpi?.weightedTotal) },
      { label: 'ملاحظات الجودة', value: num(observations?.total) },
      { label: 'خصومات الجودة (يوم)', value: num(deductions?.totalDays) },
    ],
    sections,
    footerNote: dataset.kpi?.message || 'المصدر: بيانات الأداء الكنسية — نفس مجموعة البيانات المعروضة على الشاشة.',
  };
}

// ─────────────────────────────────────────────────────────────
//  4) تقرير KPI للموظف — EmployeeKpiReport (§23)
//     Projection of the SAME typed report the tab renders — no
//     refetch, no fabrication (missing = '—').
// ─────────────────────────────────────────────────────────────

interface EmployeeKpiReportLike {
  employee?: {
    employeeName?: string | null;
    employeeCode?: string | null;
    department?: string | null;
    team?: string | null;
    position?: string | null;
  };
  period?: { valueBasis?: string; asOfDate?: string | null };
  scheme?: {
    schemeName?: string;
    schemeVersion?: string | number;
    qualityWeight?: number | null;
    frozen?: boolean;
  } | null;
  quality?: {
    rawScore?: number | null;
    weight?: number | null;
    weightedContribution?: number | null;
    maxContribution?: number | null;
    status?: string | null;
  } | null;
  overallStatus?: string | null;
  message?: string | null;
  weightedTotal?: number | null;
  availableWeight?: number | null;
  components?: Array<{
    componentId?: string;
    name?: string;
    weight?: number | null;
    rawScore?: number | null;
    weightedContribution?: number | null;
    maxContribution?: number | null;
    status?: string | null;
  }>;
  trend?: {
    months?: Array<{
      monthKey?: string;
      available?: boolean;
      rawScore?: number | null;
      weightedContribution?: number | null;
      weight?: number | null;
      valueBasis?: string;
      finalized?: boolean;
      rowStatus?: string | null;
    }>;
    mom?: { previousMonth?: string; deltaPoints?: number } | null;
  };
  evidence?: {
    counts?: { total?: number; approved?: number; pending?: number; rejected?: number; scoring?: number };
    observations?: Array<{
      observationDate?: string;
      categoryName?: string;
      severity?: string;
      notes?: string | null;
      status?: string;
      approvalStatus?: string;
      effect?: { applies?: boolean; counted?: boolean; signedPoints?: number };
      evidence?: { kind?: string; text?: string | null; url?: string | null };
      relatedCapaId?: string | null;
    }>;
  };
  traceability?: {
    origin?: string | null;
    deductionPoints?: number | null;
    bonusPoints?: number | null;
  } | null;
}

const COMPONENT_STATUS: Record<string, [string, string]> = {
  AVAILABLE: ['متاح', 'Available'], ZERO: ['صفر', 'Zero'], PENDING: ['غير متاح', 'N/A'], NOT_ELIGIBLE: ['غير مؤهل', 'Not eligible'],
  INCOMPLETE: ['جزئي', 'Partial'], FINALIZED: ['مجمّد', 'Frozen'],
};

export function employeeKpiReportToPrintModel(
  report: EmployeeKpiReportLike,
  monthKey: string,
): PrintReportModel {
  const sections: PrintSection[] = [];

  const components = report.components ?? [];
  if (components.length > 0) {
    sections.push({
      heading: 'مكونات KPI',
      table: {
        columns: ['المكون', 'الوزن', 'الدرجة الخام', 'المساهمة', 'الحالة'],
        rows: components.map((c) => [
          c.name ?? '—',
          c.weight == null ? '—' : `${c.weight}%`,
          c.rawScore === null || c.rawScore === undefined ? ui('غير متاح', 'N/A') : pct(c.rawScore),
          c.weightedContribution === null || c.weightedContribution === undefined
            ? ui('غير متاح', 'N/A')
            : `${num(c.weightedContribution)} / ${c.maxContribution ?? '—'}`,
          uiMap(COMPONENT_STATUS, c.status, dash(c.status)),
        ]),
      },
    });
  }

  const points = report.trend?.months ?? [];
  if (points.length > 0) {
    sections.push({
      heading: 'الاتجاه الشهري — درجة الجودة',
      table: {
        columns: ['الشهر', 'الدرجة الخام', 'المساهمة', 'الأساس', 'الحالة'],
        rows: points.map((p) => [
          monthLabel(p.monthKey) ?? dash(p.monthKey),
          p.available ? pct(p.rawScore) : ui('غير متاح', 'N/A'),
          p.available && p.weightedContribution !== null && p.weightedContribution !== undefined
            ? `${num(p.weightedContribution)} / ${p.weight ?? '—'}`
            : '—',
          dash(p.valueBasis),
          p.available ? (p.finalized ? ui('مجمّدة', 'Frozen') : ui('مفتوحة', 'Open')) : dash(p.rowStatus),
        ]),
      },
    });
  }

  const evidence = report.evidence;
  if (evidence?.observations && evidence.observations.length > 0) {
    sections.push({
      heading: 'أدلة الجودة (الملاحظات)',
      table: {
        columns: ['التاريخ', 'التصنيف', 'الخطورة', 'الوصف', 'الحالة', 'الأثر'],
        rows: evidence.observations.map((o) => [
          dash(o.observationDate),
          dash(o.categoryName),
          dash(o.severity),
          dash(o.notes),
          dash(o.approvalStatus ?? o.status),
          o.effect?.counted
            ? (o.effect.signedPoints ?? 0 >= 0 ? `+${num(o.effect.signedPoints)}` : num(o.effect.signedPoints))
            : o.effect?.applies ? ui('بانتظار الاعتماد', 'Pending approval') : ui('لا يؤثر', 'No effect'),
        ]),
      },
    });
  }

  const scheme = report.scheme;
  return {
    title: 'تقرير KPI للموظف',
    subject: [
      report.employee?.employeeName,
      (report.employee as { employeeCode?: string | null } | undefined)?.employeeCode,
      report.employee?.department,
      report.employee?.position,
    ].filter(Boolean).join(' — '),
    identity: {
      name: report.employee?.employeeName,
      code: (report.employee as { employeeCode?: string | null } | undefined)?.employeeCode,
      position: report.employee?.position ?? null,
      team: (report.employee as { team?: string | null } | undefined)?.team ?? null,
      department: report.employee?.department ?? null,
    },
    period: monthLabel(monthKey) || monthKey,
    generatedAt: undefined,
    stats: [
      { label: 'درجة الجودة (خام)', value: pct(report.quality?.rawScore) },
      { label: 'مساهمة الجودة', value: num(report.quality?.weightedContribution) },
      { label: 'وزن الجودة', value: pct(report.quality?.weight) },
      { label: 'KPI الشركة', value: report.overallStatus === 'COMPLETE' ? ui('مكتمل', 'Complete') : dash(report.overallStatus) },
      { label: 'ملاحظات (أدلة)', value: num(evidence?.counts?.total) },
      { label: 'معتمدة', value: num(evidence?.counts?.approved) },
    ],
    sections,
    footerNote: scheme
      ? `مخطط KPI: ${scheme.schemeName ?? '—'} (v${scheme.schemeVersion ?? '—'})${scheme.qualityWeight != null ? ` — وزن الجودة: ${scheme.qualityWeight}%` : ''}${scheme.frozen ? ' — قيم مجمّدة من إغلاق الشهر' : ''}`
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
//  5) Generic TABLE report — ReportView (definition-driven pages)
//     Projects any columns/rows matrix into the clean A4 document.
// ─────────────────────────────────────────────────────────────

export function tableToPrintModel(input: {
  title: string;
  subject?: string;
  identity?: PrintReportModel['identity'];
  period?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  stats?: PrintReportModel['stats'];
  footerNote?: string;
  /** Column indexes that must render LTR (numbers/ids). */
  ltrColumns?: number[];
}): PrintReportModel {
  return {
    title: input.title,
    subject: input.subject,
    identity: input.identity,
    period: input.period,
    generatedAt: new Date().toISOString(),
    stats: input.stats,
    sections: [
      {
        table: {
          columns: input.columns,
          rows: input.rows,
          ltrColumns: input.ltrColumns,
        },
      },
    ],
    footerNote: input.footerNote ?? ui('تقرير رسمي — مصدر البيانات: قاعدة بيانات النظام للفترة المحددة.', 'Official report — data source: the system database for the selected period.'),
  };
}

// ─────────────────────────────────────────────────────────────
//  4) تقرير الموارد البشرية — HR Monthly Employee Performance
//
//     Pure projection of the ALREADY-SANITIZED HR view model
//     (/api/reports/hr-performance). The server structurally
//     excludes technical evidence from that payload, so printing
//     this model can never leak technical detail. Missing values
//     render '—', never fabricated.
// ─────────────────────────────────────────────────────────────

interface HrPerformanceRowLike {
  employeeName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  team?: string | null;
  position?: string | null;
  employmentStatus?: string | null;
  performanceScore?: number | null;
  performanceStatus?: string | null;
  schemeName?: string | null;
}

interface HrPerformanceReportLike {
  monthKey?: string;
  finalized?: boolean;
  rows?: HrPerformanceRowLike[];
  totals?: Partial<Record<'employees' | 'withResult' | 'pending' | 'incomplete' | 'finalized' | 'noScheme', number>>;
  generatedAt?: string;
}

const HR_EMPLOYMENT: Record<string, [string, string]> = {
  active: ['نشط', 'Active'], inactive: ['غير نشط', 'Inactive'], archived: ['مؤرشف', 'Archived'], unknown: ['—', '—'],
};

export function hrPerformanceToPrintModel(report: HrPerformanceReportLike): PrintReportModel {
  const rows = (report.rows ?? []).map((r) => [
    r.employeeName ?? '—',
    r.employeeCode ?? '—',
    r.department ?? '—',
    r.team ?? '—',
    r.position ?? '—',
    uiMap(HR_EMPLOYMENT, r.employmentStatus, '—'),
    r.performanceScore === null || r.performanceScore === undefined ? '—' : pct(r.performanceScore),
    r.performanceStatus ?? '—',
  ]);
  const t = report.totals ?? {};
  return {
    title: 'تقرير أداء الموظفين الشهري — الموارد البشرية',
    period: monthLabel(report.monthKey),
    generatedAt: report.generatedAt,
    stats: [
      { label: 'الموظفون', value: num(t.employees ?? 0) },
      { label: 'بنتيجة أداء', value: num(t.withResult ?? 0) },
      { label: 'معلّق', value: num(t.pending ?? 0) },
      { label: 'غير مكتمل', value: num(t.incomplete ?? 0) },
      { label: 'مجمّد', value: num(t.finalized ?? 0) },
    ],
    sections: [
      {
        table: {
          columns: ['الموظف', 'الكود', 'القسم', 'الفريق', 'الوظيفة', 'حالة العمل', 'نتيجة الأداء', 'الحالة'],
          rows,
          ltrColumns: [1, 6],
        },
      },
    ],
    footerNote: ui(
      'تقرير الموارد البشرية — نتيجة الأداء النهائية والسياق التنظيمي فقط. مصدر النتائج: خط مؤشرات الأداء القانوني للنظام (قيم حرفية بلا إعادة حساب).',
      'HR report — final performance results and organizational context only. Source: the system canonical KPI line (literal values, never recomputed).',
    ),
  };
}

// ─────────────────────────────────────────────────────────────
//  7) قرار دعم الموارد البشرية — HR Decision-Support
//
//     Pure projections of the ALREADY-SANITIZED decision view
//     models (/api/reports/hr-performance/decision[/employee]).
//     The server structurally excludes technical evidence from
//     those payloads, so printing these models can never leak
//     technical detail. Missing values render '—', never
//     fabricated; the safety disclaimer is ALWAYS present.
// ─────────────────────────────────────────────────────────────

const HR_DECISION_STATUS: Record<string, [string, string]> = {
  STABLE: ['مستقر', 'Stable'],
  IMPROVING: ['يتحسّن', 'Improving'],
  NEEDS_COACHING: ['يحتاج توجيهاً/تدريباً', 'Needs coaching/training'],
  PERFORMANCE_IMPROVEMENT_REVIEW: ['مراجعة خطة تحسين الأداء', 'Performance improvement plan review'],
  MANAGEMENT_REVIEW: ['مراجعة من الإدارة والموارد البشرية', 'Management & HR review'],
};

const HR_ACTION: Record<string, [string, string]> = {
  CONTINUE_MONITORING: ['متابعة دورية اعتيادية', 'Routine periodic follow-up'],
  RECOGNIZE_IMPROVEMENT: ['متابعة مع تشجيع التحسّن', 'Follow-up with encouragement'],
  COACHING: ['توجيه/تدريب موجّه', 'Targeted coaching/training'],
  IMPROVEMENT_PLAN: ['مراجعة أداء رسمية / خطة تحسين', 'Formal performance review / improvement plan'],
  MANAGEMENT_HR_REVIEW: ['مراجعة الإدارة والموارد البشرية', 'Management & HR review'],
};

const HR_TREND: Record<string, [string, string]> = {
  UP: ['تحسّن', 'Improving'], DOWN: ['تراجع', 'Declining'], STABLE: ['مستقر', 'Stable'],
};

const HR_SEVERITY: Record<string, [string, string]> = {
  HIGH: ['مرتفعة', 'High'], MEDIUM: ['متوسطة', 'Medium'], LOW: ['منخفضة', 'Low'],
};

/** System-generated review disclaimer — system UI vocabulary, locale-aware. */
export const hrDecisionDisclaimer = (): string =>
  ui(
    'توصية مراجعة إجرائية فقط — ليست قراراً نهائياً بشأن التوظيف. ' +
    'أي قرار نهائي يبقى قراراً بشرياً تتخذه الإدارة/الموارد البشرية خارج نظام التقييم الآلي.',
    'Procedural review recommendation only — not a final employment decision. ' +
    'Any final decision remains a human one made by management/HR outside the automated evaluation system.',
  );

interface HrDecisionRowLike {
  employeeName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  team?: string | null;
  status?: string | null;
  actionKind?: string | null;
  kpiScore?: number | null;
  trendDirection?: string | null;
}

interface HrDecisionReportLike {
  monthKey?: string;
  rows?: HrDecisionRowLike[];
  totals?: Partial<Record<
    'employees' | 'stable' | 'improving' | 'needsCoaching'
    | 'performanceImprovementReview' | 'managementReview' | 'withKpiResult' | 'averageKpi',
    number | null
  >>;
  operational?: {
    followUps?: { averageCompletionRate?: number | null; totalOverdue?: number | null };
    attendance?: { averageCompliance?: number | null; totalLateDays?: number | null; totalAbsentDays?: number | null };
    productivity?: { employeesWithDeals?: number | null; travelVolume?: number | null; closedDeals?: number | null };
    trend?: { improving?: number; stable?: number; declining?: number; noData?: number };
  };
  generatedAt?: string;
}

/** Team/department decision report → print (distributions, never a leaderboard). */
export function hrDecisionToPrintModel(report: HrDecisionReportLike): PrintReportModel {
  const t = report.totals ?? {};
  const o = report.operational ?? {};
  const rows = (report.rows ?? []).map((r) => [
    r.employeeName ?? '—',
    r.employeeCode ?? '—',
    r.department ?? '—',
    r.team ?? '—',
    uiMap(HR_DECISION_STATUS, r.status, r.status ?? '—'),
    uiMap(HR_ACTION, r.actionKind, '—'),
    r.kpiScore === null || r.kpiScore === undefined ? '—' : pct(r.kpiScore),
    r.trendDirection ? uiMap(HR_TREND, r.trendDirection, '—') : '—',
  ]);
  const trend = o.trend ?? {};
  return {
    title: 'تقرير دعم قرارات الأداء — الموارد البشرية',
    period: monthLabel(report.monthKey),
    generatedAt: report.generatedAt,
    stats: [
      { label: 'الموظفون', value: num(t.employees ?? 0) },
      { label: 'مستقر', value: num(t.stable ?? 0) },
      { label: 'يتحسّن', value: num(t.improving ?? 0) },
      { label: 'يحتاج توجيهاً', value: num(t.needsCoaching ?? 0) },
      { label: 'مراجعة تحسين أداء', value: num(t.performanceImprovementReview ?? 0) },
      { label: 'مراجعة إدارة', value: num(t.managementReview ?? 0) },
      { label: 'متوسط الأداء', value: t.averageKpi === null || t.averageKpi === undefined ? '—' : pct(t.averageKpi) },
    ],
    sections: [
      {
        table: {
          columns: ['الموظف', 'الكود', 'القسم', 'الفريق', 'الحالة', 'الإجراء المقترح', 'نتيجة الأداء', 'الاتجاه'],
          rows,
          ltrColumns: [1, 6],
        },
      },
      {
        heading: 'مؤشرات تشغيلية مجمّعة',
        stats: [
          { label: 'متوسط إنجاز المتابعات', value: o.followUps?.averageCompletionRate == null ? '—' : pct(o.followUps.averageCompletionRate) },
          { label: 'إجمالي المتابعات المتأخرة', value: num(o.followUps?.totalOverdue ?? 0) },
          { label: 'متوسط الالتزام بالحضور', value: o.attendance?.averageCompliance == null ? '—' : pct(o.attendance.averageCompliance) },
          // §DEAL-DATES — the two canonical deal dimensions, same
          // numbers the UI card shows (never recomputed here).
          { label: 'صفقات مكتملة (تاريخ الإغلاق)', value: num(o.productivity?.closedDeals ?? 0) },
          { label: 'حجم السفر (تاريخ المغادرة)', value: num(o.productivity?.travelVolume ?? 0) },
          { label: 'اتجاه التحسّن/التراجع', value: `${num(trend.improving ?? 0)} / ${num(trend.declining ?? 0)}` },
        ],
      },
    ],
    footerNote: hrDecisionDisclaimer(),
  };
}

interface HrDecisionFactorLike {
  category?: string | null;
  kind?: string | null;
  severity?: string | null;
  signalAr?: string | null;
  value?: number | null;
  comparisonAr?: string | null;
}

const HR_FACTOR_CATEGORY: Record<string, [string, string]> = {
  KPI: ['مؤشر الأداء', 'Performance KPI'],
  FOLLOW_UP: ['المتابعات اليومية', 'Daily follow-ups'],
  PRODUCTIVITY: ['الإنتاجية', 'Productivity'],
  QUALITY: ['إشارة الجودة', 'Quality signal'],
  ATTENDANCE: ['الانضباط والحضور', 'Attendance discipline'],
  HR_DISCIPLINARY: ['إشارة الموارد البشرية', 'HR signal'],
  TREND: ['الاتجاه الزمني', 'Time trend'],
};

interface HrDecisionEmployeeReportLike {
  monthKey?: string;
  employee?: {
    employeeName?: string | null;
    employeeCode?: string | null;
    department?: string | null;
    team?: string | null;
    position?: string | null;
  };
  executive?: {
    status?: string | null;
    kpiScore?: number | null;
    trendDirection?: string | null;
    riskLevel?: string | null;
  };
  scorecard?: Array<{
    labelAr?: string | null;
    availability?: string | null;
    unavailableReasonAr?: string | null;
    state?: string | null;
    metrics?: Array<{ labelAr?: string | null; value?: number | null; unit?: string | null; hintAr?: string | null }>;
  }>;
  trend?: {
    points?: Array<{ monthKey?: string; available?: boolean; rawScore?: number | null }>;
    direction?: string | null;
    consecutiveBelowTarget?: number;
    targetScore?: number;
  };
  strengths?: HrDecisionFactorLike[];
  concerns?: HrDecisionFactorLike[];
  action?: { actionAr?: string | null; rationaleAr?: string | null; disclaimerAr?: string | null };
  dataQuality?: { notesAr?: string[] };
  generatedAt?: string;
}

function factorRows(factors?: HrDecisionFactorLike[]): string[][] {
  return (factors ?? []).map((f) => [
    uiMap(HR_FACTOR_CATEGORY, f.category, f.category ?? '—'),
    f.kind === 'POSITIVE' ? ui('إيجابية', 'Positive') : ui('سلبية', 'Negative'),
    uiMap(HR_SEVERITY, f.severity, f.severity ?? '—'),
    f.signalAr ?? '—',
    f.value === null || f.value === undefined ? '—' : String(f.value),
    f.comparisonAr ?? '—',
  ]);
}

function formatMetricValue(value: number | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (unit === 'percent') return pct(value);
  if (unit === 'days') return `${num(value)} ${ui('يوم', 'day(s)')}`;
  if (unit === 'minutes') return `${num(value)} ${ui('دقيقة', 'minute(s)')}`;
  return num(value);
}

function scorecardStateAr(entry: NonNullable<HrDecisionEmployeeReportLike['scorecard']>[number]): string {
  if (entry.availability === 'NOT_AVAILABLE') return ui('غير متاح', 'N/A');
  switch (entry.state) {
    case 'WEAK': return ui('ضعيف', 'Weak');
    case 'WATCH': return ui('للمراقبة', 'Watch');
    case 'POSITIVE': return ui('إيجابي', 'Positive');
    case 'OK': return ui('سليم', 'Sound');
    default: return ui('بلا حكم', 'No verdict');
  }
}

/** Per-employee decision report → print (the full HR-safe evidence). */
export function hrDecisionEmployeeToPrintModel(report: HrDecisionEmployeeReportLike): PrintReportModel {
  const e = report.employee ?? {};
  const x = report.executive ?? {};
  const sections: PrintSection[] = [];

  sections.push({
    heading: 'بطاقة الأداء',
    table: {
      columns: ['البُعد', 'الحالة', 'المؤشرات'],
      rows: (report.scorecard ?? []).map((entry) => [
        entry.labelAr ?? '—',
        scorecardStateAr(entry),
        (entry.metrics ?? [])
          .map((m) => `${m.labelAr ?? ''}: ${formatMetricValue(m.value, m.unit)}${m.hintAr ? ` (${m.hintAr})` : ''}`)
          .join(' — ') || (entry.unavailableReasonAr ?? '—'),
      ]),
    },
  });

  const trendPoints = (report.trend?.points ?? [])
    .map((p) => `${p.monthKey ?? '—'}: ${p.available && p.rawScore !== null && p.rawScore !== undefined ? pct(p.rawScore) : ui('غير متاح', 'N/A')}`)
    .join(' | ');
  sections.push({
    heading: 'الاتجاه الزمني',
    paragraphs: [
      trendPoints || '—',
      `${ui('الاتجاه', 'Trend')}: ${report.trend?.direction ? uiMap(HR_TREND, report.trend.direction, '—') : '—'}`
        + ` ${ui('— أشهر متتالية تحت الهدف:', '— consecutive months below target:')} ${num(report.trend?.consecutiveBelowTarget ?? 0)}`
        + ` (الهدف المُهيّأ ${report.trend?.targetScore === null || report.trend?.targetScore === undefined ? '—' : pct(report.trend.targetScore)})`,
    ],
  });

  const factorColumns = ['البُعد', 'النوع', 'الشدة', 'الإشارة', 'القيمة', 'المقارنة'];
  sections.push({
    heading: 'نقاط القوة (من إشارات مقاسة)',
    table: { columns: factorColumns, rows: factorRows(report.strengths) },
  });
  sections.push({
    heading: 'مواطن الاهتمام (من إشارات مقاسة)',
    table: { columns: factorColumns, rows: factorRows(report.concerns) },
  });

  if ((report.dataQuality?.notesAr ?? []).length > 0) {
    sections.push({ heading: 'جودة البيانات', paragraphs: report.dataQuality?.notesAr ?? [] });
  }

  return {
    title: 'تقرير دعم قرار أداء موظف — الموارد البشرية',
    identity: {
      name: e.employeeName ?? undefined,
      code: e.employeeCode ?? undefined,
      department: e.department ?? undefined,
      team: e.team ?? undefined,
      position: e.position ?? undefined,
    },
    period: monthLabel(report.monthKey),
    generatedAt: report.generatedAt,
    stats: [
      { label: 'الحالة', value: uiMap(HR_DECISION_STATUS, x.status, x.status ?? '—') },
      { label: 'نتيجة الأداء', value: x.kpiScore === null || x.kpiScore === undefined ? '—' : pct(x.kpiScore) },
      { label: 'الاتجاه', value: x.trendDirection ? uiMap(HR_TREND, x.trendDirection, '—') : '—'},
      { label: 'مستوى المخاطر', value: x.riskLevel ?? '—' },
    ],
    sections,
    footerNote: `${report.action?.actionAr ?? '—'} — ${report.action?.rationaleAr ?? ''} · ${report.action?.disclaimerAr ?? hrDecisionDisclaimer()}`,
  };
}
