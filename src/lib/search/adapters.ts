// ══════════════════════════════════════════════════════════════
//  Global Search — domain adapters (Phase 6.1, spec §19)
//
//  One adapter per registry domain:
//    • searchableFields — the exact fields this domain matches on
//      (mirrors each domain's own server-side search where one
//      exists, e.g. CAPA title/capaId/problemDescription).
//    • project — the LIGHTWEIGHT Arabic display projection. The raw
//      record NEVER leaves the server; unknown/absent fields degrade
//      gracefully (no invented content).
//
//  Pure functions over raw records + an AdapterContext (employee
//  names resolved once per request by the service).
// ══════════════════════════════════════════════════════════════

import type { MatchableField } from './record-matcher';
import { evidenceRecordMonth } from '@/lib/evidence/record-projection';
import type { SearchDomain } from './types';

type Rec = Record<string, unknown>;

export interface AdapterContext {
  /** employeeId → name (server-side, cached employee map). */
  employeeNameOf: (employeeId: string | null | undefined) => string | null;
}

export interface ProjectedSearchResult {
  title: string;
  subtitle?: string;
  metadata?: string[];
  date?: string;
  status?: string;
  statusValue?: string;
  month?: string;
}

export interface DomainAdapter {
  searchableFields(record: Rec, ctx: AdapterContext): MatchableField[];
  project(record: Rec, ctx: AdapterContext): ProjectedSearchResult;
}

// ── small pure helpers ──────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function compact(parts: Array<string | undefined | null>): string | undefined {
  const joined = parts.filter((p) => typeof p === 'string' && p.length > 0).join(' · ');
  return joined.length > 0 ? joined : undefined;
}

function labelOf(map: Record<string, string>, raw: string): string | undefined {
  if (!raw) return undefined;
  return map[raw] ?? raw;
}

/** ISO timestamp → DD/MM/YYYY (display only; never invents a date). */
function isoToDateDisplay(iso: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ── Arabic status/type label maps (display only) ───────────────

const EMPLOYEE_STATUS: Record<string, string> = { active: 'نشط', inactive: 'غير نشط', archived: 'مؤرشف' };
const OBSERVATION_STATUS: Record<string, string> = { open: 'مفتوحة', in_review: 'قيد المراجعة', resolved: 'تم حلها', closed: 'مغلقة' };
const OBSERVATION_SEVERITY: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' };
const HR_DEDUCTION_STATUS: Record<string, string> = { pending: 'معلقة', approved: 'معتمدة', rejected: 'مرفوضة' };
const COMPLAINT_STATUS: Record<string, string> = { open: 'مفتوحة', under_investigation: 'قيد التحقيق', pending_resolution: 'بانتظار الحل', resolved: 'تم حلها', closed: 'مغلقة' };
const COMPLAINT_TYPE: Record<string, string> = { service_quality: 'جودة الخدمة', pricing_error: 'خطأ في التسعير', communication: 'تواصل', delay: 'تأخير', product_issue: 'مشكلة في المنتج', other: 'أخرى' };
const CAPA_STATUS: Record<string, string> = { open: 'مفتوحة', investigation: 'قيد التحقيق', root_cause_analysis: 'تحليل السبب الجذري', corrective_action: 'إجراء تصحيحي', preventive_action: 'إجراء وقائي', verification: 'قيد التحقق', closed: 'مغلقة', rejected: 'مرفوضة', reopened: 'مفتوحة من جديد' };
const PRIORITY_LABEL: Record<string, string> = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' };
const FOLLOW_UP_STATUS: Record<string, string> = { open: 'مفتوحة', under_review: 'قيد المراجعة', under_follow_up: 'قيد المتابعة', resolved: 'تم حلها', closed: 'مغلقة', cancelled: 'ملغاة' };
const TRAVEL_STATUS: Record<string, string> = { upcoming: 'قادمة', in_progress: 'جارية', completed: 'مكتملة', canceled: 'ملغاة' };
const ATTENDANCE_STATUS: Record<string, string> = { present: 'حاضر', late: 'متأخر', absent: 'غائب', approved: 'إجازة معتمدة' };
const REQUEST_STATUS: Record<string, string> = { pending: 'قيد الانتظار', approved: 'معتمدة', rejected: 'مرفوضة' };
const KB_STATUS: Record<string, string> = { draft: 'مسودة', published: 'منشورة', archived: 'مؤرشفة' };
const MONTH_STATUS: Record<string, string> = { open: 'مفتوح', closed: 'مغلق' };
const ORG_TYPE: Record<string, string> = { company: 'شركة', department: 'قسم', team: 'فريق', subteam: 'قسم فرعي' };
const NODE_STATUS: Record<string, string> = { active: 'نشطة', archived: 'مؤرشفة' };

// ── adapters ────────────────────────────────────────────────────

function employeeNameOf(record: Rec, ctx: AdapterContext): string {
  const employeeId = typeof record.employeeId === 'string' ? record.employeeId : null;
  return str(record.employeeName) || ctx.employeeNameOf(employeeId) || '';
}

export const SEARCH_ADAPTERS: Record<SearchDomain, DomainAdapter> = {
  employees: {
    searchableFields: (r) => [
      { key: 'name', label: 'الاسم', value: str(r.name) },
      { key: 'code', label: 'الرقم الوظيفي', value: str(r.code), idLevel: 'business' },
      { key: 'department', label: 'القسم', value: str(r.department) },
      { key: 'position', label: 'الوظيفة', value: str(r.position) },
    ],
    project: (r) => ({
      title: str(r.name) || 'موظف',
      subtitle: compact([str(r.code), str(r.department)]),
      metadata: [str(r.position)].filter(Boolean),
      status: labelOf(EMPLOYEE_STATUS, str(r.status) || 'active'),
      statusValue: str(r.status) || 'active',
    }),
  },

  qualityObservations: {
    searchableFields: (r, ctx) => [
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
      { key: 'categoryName', label: 'التصنيف', value: str(r.categoryName) },
      { key: 'type', label: 'النوع', value: str(r.type) },
      { key: 'notes', label: 'الملاحظات', value: str(r.notes) },
      { key: 'department', label: 'القسم', value: str(r.department) },
    ],
    project: (r, ctx) => ({
      title: truncate(str(r.categoryName) || str(r.type) || 'ملاحظة جودة'),
      subtitle: employeeNameOf(r, ctx) || undefined,
      metadata: [labelOf(OBSERVATION_SEVERITY, str(r.severity))].filter(
        (v): v is string => Boolean(v),
      ),
      date: str(r.observationDate) || undefined,
      status: labelOf(OBSERVATION_STATUS, str(r.status)),
      month: str(r.month) || evidenceRecordMonth('qualityObservations', r) || undefined,
    }),
  },

  qualityDeductions: {
    searchableFields: (r, ctx) => [
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
      { key: 'description', label: 'الوصف', value: str(r.description) },
      { key: 'type', label: 'النوع', value: str(r.type) },
      { key: 'date', label: 'التاريخ', value: str(r.date) },
      { key: 'month', label: 'الشهر', value: str(r.month) },
    ],
    project: (r, ctx) => ({
      title: truncate(str(r.description) || str(r.type) || 'خصم جودة'),
      subtitle: employeeNameOf(r, ctx) || undefined,
      date: str(r.date) || undefined,
      month: str(r.month) || undefined,
    }),
  },

  hrDeductions: {
    searchableFields: (r, ctx) => [
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
      { key: 'reason', label: 'السبب', value: str(r.reason) },
      { key: 'type', label: 'النوع', value: str(r.type) },
      { key: 'month', label: 'الشهر', value: str(r.month) },
    ],
    project: (r, ctx) => {
      const amount = typeof r.amount === 'number' ? String(r.amount) : str(r.amount);
      return {
        title: truncate(str(r.reason) || str(r.type) || 'خصم موارد بشرية'),
        subtitle: employeeNameOf(r, ctx) || undefined,
        metadata: amount
          ? [compact([amount, str(r.unit)]) ?? amount]
          : undefined,
        date: str(r.deductionDate) || undefined,
        status: labelOf(HR_DEDUCTION_STATUS, str(r.status)),
        month: str(r.month) || undefined,
      };
    },
  },

  complaints: {
    searchableFields: (r, ctx) => [
      { key: 'customerName', label: 'اسم العميل', value: str(r.customerName) },
      { key: 'description', label: 'الوصف', value: str(r.description) },
      { key: 'complaintType', label: 'نوع الشكوى', value: labelOf(COMPLAINT_TYPE, str(r.complaintType)) },
      { key: 'responsiblePerson', label: 'المسؤول', value: str(r.responsiblePerson) },
      { key: 'dealId', label: 'رقم الصفقة', value: str(r.dealId), idLevel: 'business' },
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
    ],
    project: (r, ctx) => ({
      title: str(r.customerName) || 'شكوى عميل',
      subtitle: truncate(str(r.description)) || undefined,
      metadata: [labelOf(COMPLAINT_TYPE, str(r.complaintType))].filter(
        (v): v is string => Boolean(v),
      ),
      status: labelOf(COMPLAINT_STATUS, str(r.status)),
      date: isoToDateDisplay(str(r.createdAt)),
    }),
  },

  capaCases: {
    searchableFields: (r) => [
      { key: 'capaId', label: 'رقم CAPA', value: str(r.capaId), idLevel: 'business' },
      { key: 'title', label: 'العنوان', value: str(r.title) },
      { key: 'problemDescription', label: 'وصف المشكلة', value: str(r.problemDescription) },
      { key: 'department', label: 'القسم', value: str(r.department) },
    ],
    project: (r) => ({
      title: truncate(str(r.title) || 'حالة CAPA'),
      subtitle: str(r.capaId) || undefined,
      metadata: [
        labelOf(PRIORITY_LABEL, str(r.priority)),
        str(r.department),
      ].filter((v): v is string => Boolean(v)),
      status: labelOf(CAPA_STATUS, str(r.status)),
    }),
  },

  followUps: {
    searchableFields: (r, ctx) => [
      { key: 'subject', label: 'الموضوع', value: str(r.subject) },
      { key: 'detailedDescription', label: 'التفاصيل', value: str(r.detailedDescription) },
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
      { key: 'followUpType', label: 'نوع المتابعة', value: str(r.followUpType) },
    ],
    project: (r, ctx) => ({
      title: truncate(str(r.subject) || 'متابعة'),
      subtitle: employeeNameOf(r, ctx) || undefined,
      date: str(r.date) || undefined,
      status: labelOf(FOLLOW_UP_STATUS, str(r.status)),
    }),
  },

  travelDeals: {
    searchableFields: (r, ctx) => [
      { key: 'destination', label: 'الوجهة', value: str(r.destination) },
      { key: 'dealerName', label: 'الوكيل', value: str(r.dealerName) },
      { key: 'customerNames', label: 'العملاء', value: str(r.customerNames) },
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
      { key: 'departureDate', label: 'تاريخ المغادرة', value: str(r.departureDate) },
      { key: 'returnDate', label: 'تاريخ العودة', value: str(r.returnDate) },
      { key: 'notes', label: 'ملاحظات', value: str(r.notes) },
    ],
    project: (r, ctx) => ({
      title: str(r.destination) || 'صفقة سفر',
      subtitle: employeeNameOf(r, ctx) || undefined,
      metadata: [str(r.dealerName), str(r.customerNames)].filter(Boolean),
      date: str(r.departureDate) || undefined,
      status: labelOf(TRAVEL_STATUS, str(r.status)),
      month: evidenceRecordMonth('travelDeals', r) || undefined,
    }),
  },

  attendance: {
    searchableFields: (r, ctx) => [
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
      { key: 'date', label: 'التاريخ', value: str(r.date) },
      { key: 'notes', label: 'ملاحظات', value: str(r.notes) },
    ],
    project: (r, ctx) => ({
      title: employeeNameOf(r, ctx) || 'سجل حضور',
      subtitle: compact([str(r.checkIn), str(r.checkOut)]),
      date: str(r.date) || undefined,
      status: labelOf(ATTENDANCE_STATUS, str(r.status)),
    }),
  },

  requests: {
    searchableFields: (r, ctx) => [
      { key: 'type', label: 'النوع', value: str(r.type) },
      { key: 'reason', label: 'السبب', value: str(r.reason) },
      { key: 'employeeName', label: 'اسم الموظف', value: employeeNameOf(r, ctx) },
    ],
    project: (r, ctx) => ({
      title: str(r.type) || 'طلب',
      subtitle: truncate(str(r.reason)) || undefined,
      date: str(r.date) || undefined,
      status: labelOf(REQUEST_STATUS, str(r.status)),
    }),
  },

  knowledgeBase: {
    searchableFields: (r) => [
      { key: 'title', label: 'العنوان', value: str(r.title) },
      { key: 'problem', label: 'المشكلة', value: str(r.problem) },
      { key: 'rootCause', label: 'السبب الجذري', value: str(r.rootCause) },
      { key: 'solution', label: 'الحل', value: str(r.solution) },
      { key: 'preventionMethod', label: 'الوقاية', value: str(r.preventionMethod) },
      {
        key: 'tags',
        label: 'الوسوم',
        value: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').join(' ') : '',
      },
    ],
    project: (r) => ({
      title: truncate(str(r.title) || 'مقالة معرفة'),
      subtitle: truncate(str(r.problem)) || undefined,
      metadata: [str(r.department)].filter(Boolean),
      status: labelOf(KB_STATUS, str(r.status)),
    }),
  },

  monthSnapshots: {
    searchableFields: (r) => [
      { key: 'monthKey', label: 'الشهر', value: str(r.monthKey), idLevel: 'business' },
    ],
    project: (r) => ({
      title: str(r.monthKey) ? `شهر ${str(r.monthKey)}` : 'شهر KPI',
      status: labelOf(MONTH_STATUS, str(r.status)),
      date: isoToDateDisplay(str(r.closedAt)),
      month: str(r.monthKey) || undefined,
    }),
  },

  orgNodes: {
    searchableFields: (r) => [
      { key: 'name', label: 'الاسم', value: str(r.name) },
      { key: 'description', label: 'الوصف', value: str(r.description) },
    ],
    project: (r) => ({
      title: str(r.name) || 'وحدة تنظيمية',
      metadata: [labelOf(ORG_TYPE, str(r.type))].filter((v): v is string => Boolean(v)),
      status: labelOf(NODE_STATUS, str(r.status)),
    }),
  },

  users: {
    searchableFields: (r) => [
      { key: 'name', label: 'الاسم', value: str(r.name) },
      { key: 'email', label: 'البريد الإلكتروني', value: str(r.email) },
      { key: 'role', label: 'الدور', value: str(r.role) },
    ],
    project: (r) => ({
      title: str(r.name) || 'مستخدم',
      subtitle: str(r.email) || undefined,
      metadata: [str(r.role)].filter(Boolean),
    }),
  },
};
