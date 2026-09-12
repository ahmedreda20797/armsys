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

const dash = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : String(v);

const num = (v: unknown): string =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('ar-EG');

const pct = (v: unknown): string =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('ar-EG')}%`;

const monthLabel = (monthKey?: string | null): string => {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
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
    footerNote: 'إحصائيات جودة KPI (ليست إحصائيات KPI على مستوى الشركة) — مصدر البيانات: محرك الجودة.',
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
const DOMAIN_LABELS: Record<string, string> = {
  complaints: 'الشكاوى',
  capaCases: 'كابا',
  followUps: 'المتابعات',
  hrDeductions: 'خصومات الموارد البشرية',
};

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
        ...DOMAIN_ORDER.map((k) => `${DOMAIN_LABELS[k]} (إجمالي)`),
        ...DOMAIN_ORDER.map((k) => `${DOMAIN_LABELS[k]} (مفتوح)`),
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
        label: `${DOMAIN_LABELS[k]} — إجمالي`,
        value: num(totals[k]?.total ?? 0),
        hint: totals[k] ? `مفتوح: ${num(totals[k]?.open ?? 0)}` : undefined,
      })),
    ],
    sections: [
      deptTable(report.departments),
      deptTable(report.teams),
      ...(report.explanation
        ? [{ heading: 'منهجية التقرير', paragraphs: [report.explanation] } satisfies PrintSection]
        : []),
    ],
    footerNote: 'الكتل الكمية: كتل إدارية بحتة — لا تغيّر أي قاعدة عمل أو نتيجة KPI.',
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
  employee?: { name?: string; department?: string | null; position?: string | null; code?: string | null };
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
    };
    deductions?: { count?: number; totalDays?: number; totalAmount?: number; records?: DeductionRecordLike[] };
  };
  complaints?: { total?: number; stillOpen?: number; resolvedOrClosed?: number; avgResolutionDays?: number | null };
  capa?: { total?: number; active?: number; overdue?: number; closedCount?: number };
  followUps?: { total?: number; active?: number; overdue?: number; completionRate?: number | null };
  generatedAt?: string;
}

const OBS_STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الاعتماد',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
};

export function performanceDatasetToPrintModel(dataset: DatasetLike): PrintReportModel {
  const sections: PrintSection[] = [];

  const observations = dataset.quality?.observations;
  if (observations?.records && observations.records.length > 0) {
    sections.push({
      heading: 'ملاحظات الجودة',
      table: {
        columns: ['التاريخ', 'التصنيف', 'النقاط', 'الحالة', 'التفاصيل'],
        rows: observations.records.map((o) => [
          dash(o.observationDate),
          dash(o.categoryName),
          o.isBonus ? `+${num(o.points)}` : (o.points ? `−${num(o.points)}` : '—'),
          OBS_STATUS_LABELS[o.approvalStatus ?? ''] ?? dash(o.approvalStatus),
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
    title: 'تحليل الأداء',
    subject: [
      dataset.employee?.name,
      dataset.employee?.department,
      dataset.period?.label,
    ].filter(Boolean).join(' — '),
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
