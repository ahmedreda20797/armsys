// ══════════════════════════════════════════════════════════════
//  Evidence Preview — server-side record projection (Phase 5.2 §31)
//
//  Converts ONE canonical source record into a small, display-ready
//  set of labeled fields. Rules:
//    • ONLY fields that actually exist on the record are shown
//      (spec §31) — missing/empty values are omitted entirely,
//      never invented and never rendered as placeholders.
//    • monthSnapshots are projected to their MONTH METADATA only —
//      employee scores / rankings / settings snapshots are sensitive
//      and are NEVER included, even for monthClose viewers (they get
//      the full data through the Month Close page instead).
//    • The raw record never leaves the server. This projection IS
//      the response body — no shadow copy is stored anywhere (§39).
//
//  Pure functions — directly unit-testable.
// ══════════════════════════════════════════════════════════════

import type { EvidenceCollection } from './evidence-collections';

export interface ProjectedField {
  label: string;
  value: string;
}

export interface ProjectedRecord {
  /** Human-readable headline (spec §32) — Arabic record title. */
  title: string;
  fields: ProjectedField[];
}

type Rec = Record<string, unknown>;

const SEVERITY_LABELS: Record<string, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

const OBSERVATION_SEVERITY: Record<string, string> = {
  ...SEVERITY_LABELS,
};

const APPROVAL_STATUS: Record<string, string> = {
  approved: 'معتمدة',
  pending: 'بانتظار الاعتماد',
  rejected: 'مرفوضة',
};

const COMPLAINT_TYPE: Record<string, string> = {
  service_quality: 'جودة الخدمة',
  pricing_error: 'خطأ تسعير',
  communication: 'تواصل',
  delay: 'تأخير',
  product_issue: 'مشكلة منتج',
  other: 'أخرى',
};

const COMPLAINT_STATUS: Record<string, string> = {
  open: 'مفتوحة',
  under_investigation: 'قيد التحقيق',
  pending_resolution: 'بانتظار الحل',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};

const CAPA_ISSUE_CATEGORY: Record<string, string> = {
  quality_issue: 'مشكلة جودة',
  attendance_issue: 'مشكلة حضور',
  behavior_issue: 'مشكلة سلوك',
  training_issue: 'مشكلة تدريب',
  customer_complaint: 'شكوى عميل',
  process_failure: 'قصور إجراءات',
  system_error: 'خطأ نظام',
  sales_error: 'خطأ مبيعات',
  operations_error: 'خطأ عمليات',
  other: 'أخرى',
};

const CAPA_ACTION_STATUS: Record<string, string> = {
  not_started: 'لم تبدأ',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
};

const FOLLOWUP_TYPE: Record<string, string> = {
  quality: 'جودة',
  behavior: 'سلوك',
  attendance: 'حضور',
  productivity: 'إنتاجية',
  training: 'تدريب',
  coaching: 'توجيه',
  complaint: 'شكوى',
  positive: 'إيجابي',
  improvement: 'تحسين',
  other: 'أخرى',
};

const FOLLOWUP_PRIORITY: Record<string, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

const FOLLOWUP_STATUS: Record<string, string> = {
  open: 'مفتوحة',
  under_review: 'قيد المراجعة',
  under_follow_up: 'قيد المتابعة',
  resolved: 'تمت',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
};

const DEAL_STATUS: Record<string, string> = {
  upcoming: 'قادمة',
  in_progress: 'قائمة',
  completed: 'مكتملة',
  canceled: 'ملغاة',
};

const SNAPSHOT_STATUS: Record<string, string> = {
  open: 'شهر مفتوح',
  closed: 'شهر مقفل',
  reopened: 'أُعيد فتحه',
};

function label(map: Record<string, string>, key: unknown): string | null {
  if (typeof key !== 'string' || key === '') return null;
  return map[key] ?? key;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function builder(title: string) {
  const fields: ProjectedField[] = [];
  const add = (labelText: string, value: unknown, map?: Record<string, string>) => {
    const resolved = map ? label(map, value) : str(value);
    if (resolved !== null) fields.push({ label: labelText, value: resolved });
  };
  return { add, done: (): ProjectedRecord => ({ title, fields }) };
}

// ── Per-collection projections (§31 — only existing fields) ───

function projectQualityObservation(r: Rec): ProjectedRecord {
  const b = builder('ملاحظة جودة');
  b.add('التاريخ', r.observationDate);
  b.add('الموظف', r.employeeName);
  b.add('القسم', r.department);
  b.add('التصنيف', r.categoryName);
  b.add('النوع', r.type);
  b.add('الشدة', r.severity, OBSERVATION_SEVERITY);
  b.add('حالة الاعتماد', r.approvalStatus, APPROVAL_STATUS);
  if (r.applyPointDeduction === true && typeof r.points === 'number') {
    b.add(r.isBonus === true ? 'نقاط مكافأة' : 'نقاط خصم', r.points);
  }
  b.add('الإجراء التصحيحي', r.correctiveAction);
  b.add('تفاصيل الملاحظة', r.notes);
  return b.done();
}

function projectQualityDeduction(r: Rec): ProjectedRecord {
  const b = builder('خصم جودة');
  b.add('التاريخ', r.date ?? r.deductionDate ?? r.createdAt);
  b.add('الموظف', r.employeeName);
  b.add('النوع', r.type ?? r.categoryName);
  b.add('الأيام', r.days);
  b.add('المبلغ', r.amount);
  b.add('السبب', r.reason ?? r.notes);
  return b.done();
}

function projectComplaint(r: Rec): ProjectedRecord {
  const b = builder('شكوى عميل');
  b.add('العميل', r.customerName);
  b.add('النوع', r.complaintType, COMPLAINT_TYPE);
  b.add('الشدة', r.severity, SEVERITY_LABELS);
  b.add('الحالة', r.status, COMPLAINT_STATUS);
  b.add('تاريخ الإنشاء', r.createdAt);
  b.add('تفاصيل الشكوى', r.description);
  b.add('الإجراء/الحل', r.resolution);
  return b.done();
}

function projectCapaCase(r: Rec): ProjectedRecord {
  const b = builder('حالة CAPA');
  b.add('رقم الحالة', r.capaId);
  b.add('العنوان', r.title);
  b.add('القسم', r.department);
  b.add('الموظف', r.employeeName);
  b.add('تصنيف المشكلة', r.issueCategory, CAPA_ISSUE_CATEGORY);
  b.add('شدة الأثر', r.impactLevel, SEVERITY_LABELS);
  b.add('حالة الإجراء التصحيحي', r.correctiveStatus, CAPA_ACTION_STATUS);
  b.add('حالة الإجراء الوقائي', r.preventiveStatus, CAPA_ACTION_STATUS);
  b.add('تاريخ الإنشاء', r.createdAt);
  b.add('وصف المشكلة', r.problemDescription);
  return b.done();
}

function projectFollowUp(r: Rec): ProjectedRecord {
  const b = builder('متابعة');
  b.add('التاريخ', r.date);
  b.add('الموظف', r.employeeName);
  b.add('النوع', r.followUpType, FOLLOWUP_TYPE);
  b.add('الموضوع', r.subject);
  b.add('الأولوية', r.priorityLevel, FOLLOWUP_PRIORITY);
  b.add('الحالة', r.status, FOLLOWUP_STATUS);
  b.add('موعد المتابعة القادم', r.nextFollowUpDate);
  b.add('الوصف التفصيلي', r.detailedDescription);
  b.add('الإجراء المتخذ', r.actionTaken);
  return b.done();
}

function projectTravelDeal(r: Rec): ProjectedRecord {
  const b = builder('صفقة سفر');
  b.add('الوجهة', r.destination);
  b.add('تاريخ المغادرة', r.departureDate);
  b.add('تاريخ العودة', r.returnDate);
  b.add('المتعامل', r.dealerName);
  b.add('الحالة', r.status, DEAL_STATUS);
  b.add('ملاحظات', r.notes);
  return b.done();
}

function projectAttendanceResult(r: Rec): ProjectedRecord {
  const b = builder('نتيجة حضور');
  const result = (r.result ?? r) as Rec;
  b.add('الشهر', result.month ?? r.month);
  b.add('أيام العمل', result.workDays);
  b.add('أيام الحضور', result.presentDays);
  b.add('أيام التأخير', result.lateDays);
  b.add('أيام الغياب', result.absentDays);
  b.add('أيام الإجازة/الاستثناء', result.exemptDays);
  b.add('إجمالي دقائق التأخير', result.totalMinutesLate);
  b.add('أيام خصم الحضور', result.attendanceDeductionDays);
  b.add('نسبة الالتزام', result.compliance);
  return b.done();
}

function projectMonthSnapshot(r: Rec): ProjectedRecord {
  // SENSITIVE: month metadata ONLY — employeeScores, departmentScores,
  // topEmployees, bottomEmployees, categoryTotals, approvalStats and
  // settingsSnapshot are NEVER projected here.
  const b = builder('لقطة شهر (KPI)');
  b.add('الشهر', r.monthKey);
  b.add('الحالة', r.status, SNAPSHOT_STATUS);
  b.add('تاريخ الإقفال', r.closedAt);
  b.add('أُقفل بواسطة', r.closedByName);
  b.add('عدد مرات إعادة الفتح', r.reopenCount);
  return b.done();
}

function projectKpiScheme(r: Rec): ProjectedRecord {
  const b = builder('مخطط KPI');
  b.add('اسم المخطط', r.schemeName ?? r.name);
  b.add('رقم الإصدار', r.schemeVersion);
  b.add('وزن الجودة', r.qualityWeight);
  if (r.frozen !== undefined) b.add('مجمّد', r.frozen === true ? 'نعم' : 'لا');
  return b.done();
}

const PROJECTORS: Record<EvidenceCollection, (r: Rec) => ProjectedRecord> = {
  qualityObservations: projectQualityObservation,
  qualityDeductions: projectQualityDeduction,
  complaints: projectComplaint,
  capaCases: projectCapaCase,
  followUps: projectFollowUp,
  travelDeals: projectTravelDeal,
  attendanceResults: projectAttendanceResult,
  monthSnapshots: projectMonthSnapshot,
  kpiSchemes: projectKpiScheme,
};

/**
 * Project ONE canonical record for evidence display. Returns null
 * when the record is missing/invalid — callers translate that into
 * the structured "not found" state (never an invented record).
 */
export function projectEvidenceRecord(
  collection: EvidenceCollection,
  record: unknown,
): ProjectedRecord | null {
  if (typeof record !== 'object' || record === null) return null;
  try {
    return PROJECTORS[collection](record as Rec);
  } catch {
    // A malformed record must never crash the preview — degrade to
    // a title-only projection rather than leaking or crashing.
    return { title: 'سجل المصدر', fields: [] };
  }
}
