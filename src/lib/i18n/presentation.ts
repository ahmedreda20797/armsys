// src/lib/i18n/presentation.ts
// ══════════════════════════════════════════════════════════════
//  §PRESENTATION-BOUNDARY — THE Qnalys canonical presentation resolver.
//
//  GLOBAL PRESENTATION CONTRACT:
//
//    INTERNAL SYSTEM DATA
//        ↓
//    DOMAIN / VIEW MODEL        (ids & keys stay intact here)
//        ↓
//    CANONICAL PRESENTATION RESOLVER   ← THIS MODULE
//        ↓
//    LOCALIZED HUMAN-READABLE UI
//
//  A raw technical identifier must never accidentally become a
//  user-facing label. Internal IDs remain fully available to
//  navigation, API calls, updates/deletes, highlighting, permissions,
//  scope, caching and audit — this module only governs what TEXT the
//  UI renders.
//
//  WHAT IT RESOLVES (system-owned keys ONLY):
//    • collection/domain names   qualityObservations → ملاحظات الجودة
//    • enum/status/type keys     under_investigation → قيد التحقيق
//    • engine/rule identifiers   KPI_BELOW_CONFIGURED_TARGET →
//                                نتيجة دون المستهدف المُهيّأ
//
//  WHAT IT NEVER TOUCHES (user-generated business data):
//    employee names, customer names, deal names, notes, categories
//    created by admins, stored business text — those render raw at
//    the call site (§I18N-BOUNDARY). Callers must only pass keys the
//    SYSTEM owns; `resolveSystemLabel` returns null for unknown keys
//    so a caller can distinguish "known system key" from "business
//    data" and never auto-translate the latter.
//
//  FALLBACK DOCTRINE (never leak, never invent):
//    Unknown system keys resolve to SAFE GENERIC localized labels
//    ('سجل نظام' / 'Unspecified' …) — NEVER the raw key, NEVER a
//    record id, NEVER a mechanical .replace('_',' ') transformation.
//    Record-ID-shaped strings are detected explicitly and replaced.
//
//  Pure, client-safe, directly unit-testable. No Firebase, no React.
// ══════════════════════════════════════════════════════════════

export type PresentationLocale = 'ar' | 'en';

type LabelPair = readonly [string, string]; // [ar, en]

// ─────────────────────────────────────────────────────────────
//  1) DOMAIN / COLLECTION ENTITY LABELS
//     RTDB collection names and domain nouns as users see them.
// ─────────────────────────────────────────────────────────────

export const DOMAIN_ENTITY_LABELS: Readonly<Record<string, LabelPair>> = {
  qualityObservations: ['ملاحظات الجودة', 'Quality Observations'],
  qualityDeductions: ['خصومات الجودة', 'Quality Deductions'],
  followUps: ['المتابعات', 'Follow-ups'],
  travelDeals: ['صفقات السفر', 'Travel Deals'],
  monthSnapshots: ['لقطات الشهر', 'Monthly Snapshots'],
  yearSnapshots: ['لقطات السنة', 'Yearly Snapshots'],
  kpiSchemes: ['مخططات KPI', 'KPI Schemes'],
  kpiReports: ['تقارير KPI', 'KPI Reports'],
  attendanceResults: ['نتائج الحضور', 'Attendance Results'],
  capaCases: ['حالات CAPA', 'CAPA Cases'],
  complaints: ['شكاوى العملاء', 'Customer Complaints'],
  employees: ['الموظفون', 'Employees'],
  users: ['المستخدمون', 'Users'],
  requests: ['الطلبات', 'Requests'],
  hrDeductions: ['خصومات الموارد البشرية', 'HR Deductions'],
  orgNodes: ['الهيكل التنظيمي', 'Organization Structure'],
  notifications: ['الإشعارات', 'Notifications'],
  // Short source keys used by analytics/intelligence surfaces.
  kpi: ['مخطط KPI', 'KPI scheme'],
  quality: ['الجودة', 'Quality'],
  followUpsShort: ['المتابعات', 'Follow-ups'],
  complaintsShort: ['الشكاوى', 'Complaints'],
  capa: ['حالات CAPA', 'CAPA cases'],
  deals: ['صفقات السفر', 'Travel deals'],
  attendance: ['الحضور', 'Attendance'],
  risk: ['محرك المخاطر', 'Risk engine'],
  travel: ['السفر', 'Travel'],
};

// ─────────────────────────────────────────────────────────────
//  2) SYSTEM ENUM / STATUS VOCABULARY
//     Approval workflow, severity, deal/complaint/follow-up/CAPA/
//     request/attendance statuses, KPI engine row verdicts, risk
//     levels, trend directions. Domain-neutral keys resolve here;
//     a domain may override with a more specific vocabulary via
//     `presentStatus(key, locale, { vocab })`.
// ─────────────────────────────────────────────────────────────

export const STATUS_LABELS: Readonly<Record<string, LabelPair>> = {
  // Approval workflow (quality deductions, observations, HR).
  approved: ['معتمدة', 'Approved'],
  pending: ['معلقة', 'Pending'],
  rejected: ['مرفوضة', 'Rejected'],
  draft: ['مسودة', 'Draft'],
  // Severity / priority ladder (shared shape across domains).
  low: ['منخفضة', 'Low'],
  medium: ['متوسطة', 'Medium'],
  high: ['عالية', 'High'],
  critical: ['حرجة', 'Critical'],
  urgent: ['عاجلة', 'Urgent'],
  // Travel deal lifecycle.
  upcoming: ['قادمة', 'Upcoming'],
  in_progress: ['جارية', 'In progress'],
  completed: ['مكتملة', 'Completed'],
  canceled: ['ملغاة', 'Cancelled'],
  cancelled: ['ملغاة', 'Cancelled'],
  // Complaint lifecycle.
  open: ['مفتوحة', 'Open'],
  under_investigation: ['قيد التحقيق', 'Under investigation'],
  investigating: ['قيد التحقيق', 'Under investigation'],
  pending_resolution: ['بانتظار الحل', 'Pending resolution'],
  resolved: ['تم الحل', 'Resolved'],
  closed: ['مغلقة', 'Closed'],
  // Follow-up lifecycle.
  under_review: ['قيد المراجعة', 'Under review'],
  under_follow_up: ['قيد المتابعة', 'Under follow-up'],
  // CAPA corrective/preventive action status.
  not_started: ['لم تبدأ', 'Not started'],
  // Request lifecycle.
  accepted: ['مقبول', 'Accepted'],
  declined: ['مرفوض', 'Declined'],
  // CAPA case lifecycle.
  reopened: ['أُعيد فتحه', 'Reopened'],
  verified: ['تم التحقق', 'Verified'],
  created: ['إنشاء', 'Created'],
  deduction: ['خصم', 'Deduction'],
  complaint: ['شكوى', 'Complaint'],
  // Attendance day status.
  present: ['حاضر', 'Present'],
  late: ['متأخر', 'Late'],
  absent: ['غائب', 'Absent'],
  // Month snapshot lifecycle.
  active: ['نشط', 'Active'],
  // Risk / decision levels.
  stable: ['مستقر', 'Stable'],
  improving: ['يتحسن', 'Improving'],
  declining: ['متراجع', 'Declining'],
  // KPI engine row/component verdicts (NEVER surfaced raw).
  AVAILABLE: ['متاح', 'Available'],
  PENDING: ['قيد الانتظار', 'Pending'],
  NOT_AVAILABLE: ['غير متاح', 'Not available'],
  NOT_ELIGIBLE: ['غير مؤهل للفترة', 'Not eligible'],
  FINALIZED: ['مجمّد نهائي', 'Finalized'],
  ZERO: ['صفر مسجل', 'Recorded zero'],
  EXCLUDED: ['مستثنى', 'Excluded'],
  NO_CONFIG: ['يتطلب إعدادًا', 'Configuration required'],
  INCOMPLETE: ['غير مكتمل', 'Incomplete'],
  NO_SCHEME: ['لا يوجد مخطط KPI', 'No KPI scheme'],
  AMBIGUOUS: ['مخططات متعددة — تتطلب حلًا', 'Multiple schemes — resolution required'],
  OVERRIDE_NOT_RESOLVABLE: ['تجاوز إعدادات غير قابل للحل', 'Override not resolvable'],
  // Executive decision statuses.
  STABLE: ['مستقر', 'Stable'],
  IMPROVING: ['يتحسن', 'Improving'],
  NEEDS_COACHING: ['يحتاج تدريبًا/متابعة', 'Needs coaching'],
  PERFORMANCE_IMPROVEMENT_REVIEW: ['مراجعة تحسين أداء', 'Performance improvement review'],
  MANAGEMENT_REVIEW: ['مراجعة إدارية', 'Management review'],
  UNKNOWN: ['غير محدد', 'Unknown'],
  // Trend directions (performance-intelligence).
  UP: ['▲ تحسّن', '▲ Improving'],
  DOWN: ['▼ تراجع', '▼ Declining'],
  // Source availability (data-quality matrix).
  no_data: ['لا بيانات في الفترة', 'No data for the period'],
  configuration_required: ['يتطلب إعدادًا', 'Configuration required'],
  withheld: ['محجوب — لا صلاحية', 'Withheld — no permission'],
  available: ['متاح', 'Available'],
  // CAPA case workflow statuses (§23 — canonical business labels).
  investigation: ['تحقيق', 'Investigation'],
  root_cause_analysis: ['تحليل السبب الجذري', 'Root cause analysis'],
  corrective_action: ['إجراء تصحيحي', 'Corrective action'],
  preventive_action: ['إجراء وقائي', 'Preventive action'],
  verification: ['تحقق', 'Verification'],
  in_review: ['قيد المراجعة', 'In review'],
  // Follow-up types (canonical §17 vocabulary).
  quality: ['جودة', 'Quality'],
  behavior: ['سلوك', 'Behavior'],
  productivity: ['إنتاجية', 'Productivity'],
  training: ['تدريب', 'Training'],
  coaching: ['توجيه', 'Coaching'],
  positive: ['إيجابي', 'Positive'],
  improvement: ['تحسين', 'Improvement'],
  other: ['أخرى', 'Other'],
  // Complaint types (§23).
  service_quality: ['جودة الخدمة', 'Service quality'],
  pricing_error: ['خطأ تسعير', 'Pricing error'],
  communication: ['تواصل', 'Communication'],
  delay: ['تأخير', 'Delay'],
  product_issue: ['مشكلة منتج', 'Product issue'],
  // Quality deduction types (§16 — canonical labels already in use).
  quality_issue: ['مشكلة جودة', 'Quality issue'],
  safety: ['سلامة', 'Safety'],
  compliance: ['التزام', 'Compliance'],
  quality_observation: ['ملاحظة جودة', 'Quality observation'],
  // KPI engine outcome statuses (NOT row verdicts — report-level).
  NOT_ELIGIBLE_PERIOD: ['غير مؤهل للفترة', 'Not eligible for the period'],
  EMPLOYEE_NOT_FOUND: ['الموظف غير موجود', 'Employee not found'],
  // KPI value basis (period value provenance).
  MTD: ['حتى تاريخه', 'Month to date'],
  LIVE: ['حية (غير نهائية)', 'Live (non-final)'],
  // Request types (§22).
  leave: ['إجازة', 'Leave'],
  excuse: ['استئذان', 'Excuse'],
  mission: ['مهمة عمل', 'Mission'],
  remote: ['عمل عن بعد', 'Remote work'],
  salary_advance: ['سلفة', 'Salary advance'],
};

// ─────────────────────────────────────────────────────────────
//  3) ENGINE / RULE IDENTIFIERS
//     Decision-rule IDs, intelligence fact codes and diagnostic
//     dotted keys. They stay in the DATA layer (audit, tests,
//     diagnostics) but resolve to human labels if they ever reach
//     a presentation surface.
// ─────────────────────────────────────────────────────────────

export const RULE_LABELS: Readonly<Record<string, LabelPair>> = {
  KPI_BELOW_CONFIGURED_TARGET: ['نتيجة دون المستهدف المُهيّأ', 'Score below configured target'],
  QUALITY_REPEATED_ISSUE_RECURRENCE: ['تكرار مشكلات الجودة', 'Repeated quality issues'],
  ATTENDANCE_DATA_UNAVAILABLE: ['بيانات الحضور غير متاحة', 'Attendance data unavailable'],
  PRODUCTIVITY_REPORTED_NO_TARGET_CONFIGURED: ['إنتاجية مقاسة بلا هدف مُهيّأ', 'Productivity measured without a configured target'],
  'kpi_engine.mom_delta_direction': ['اتجاه التغير الشهري لمؤشر KPI', 'KPI month-over-month direction'],
  'dataset.data_quality': ['جودة البيانات', 'Data quality'],
};

// ─────────────────────────────────────────────────────────────
//  4) SAFE GENERIC FALLBACKS — what an UNKNOWN key becomes.
//     Never the raw key; never a mechanical de-camelized string.
// ─────────────────────────────────────────────────────────────

export const GENERIC_FALLBACKS = {
  entity: { ar: 'سجل نظام', en: 'System record' },
  status: { ar: 'غير محدد', en: 'Unspecified' },
  rule: { ar: 'قاعدة نظام', en: 'System rule' },
  title: { ar: 'سجل بدون اسم', en: 'Unnamed record' },
} as const;

// ─────────────────────────────────────────────────────────────
//  Core resolution helpers
// ─────────────────────────────────────────────────────────────

function pick(pair: LabelPair | undefined, locale: PresentationLocale): string | null {
  if (!pair) return null;
  return locale === 'en' ? pair[1] : pair[0];
}

/**
 * Resolve ONE system-owned key across the full canonical vocabulary
 * (entities → statuses → rules). Returns null when the key is not a
 * known system key — the caller's signal to treat the value as
 * business data and render it as-is.
 */
export function resolveSystemLabel(key: string, locale: PresentationLocale): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (trimmed === '') return null;
  return (
    pick(DOMAIN_ENTITY_LABELS[trimmed], locale) ??
    pick(STATUS_LABELS[trimmed], locale) ??
    pick(RULE_LABELS[trimmed], locale)
  );
}

/**
 * Collection / domain entity key → localized human label.
 * Unknown keys → safe generic 'سجل نظام' — the raw collection name
 * is never rendered.
 */
export function presentEntity(key: string, locale: PresentationLocale): string {
  if (typeof key !== 'string' || key.trim() === '') {
    return locale === 'en' ? GENERIC_FALLBACKS.entity.en : GENERIC_FALLBACKS.entity.ar;
  }
  return (
    pick(DOMAIN_ENTITY_LABELS[key.trim()], locale) ??
    (locale === 'en' ? GENERIC_FALLBACKS.entity.en : GENERIC_FALLBACKS.entity.ar)
  );
}

/**
 * Enum / status / type key → localized human label. A caller may
 * pass a domain-specific vocabulary that OVERRIDES the shared one
 * (e.g. complaint statuses vs approval statuses). Unknown keys →
 * 'غير محدد' / 'Unspecified' — never the raw key.
 */
export function presentStatus(
  key: string,
  locale: PresentationLocale,
  vocab?: Readonly<Record<string, LabelPair>>,
): string {
  if (typeof key !== 'string' || key.trim() === '') {
    return locale === 'en' ? GENERIC_FALLBACKS.status.en : GENERIC_FALLBACKS.status.ar;
  }
  const trimmed = key.trim();
  // Case-resilient: hr-decision emits UPPERCASE severities, storage
  // uses lowercase — exact match first, then the case variant.
  const variants = [trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()]
    .filter((v, i, all) => all.indexOf(v) === i);
  for (const variant of variants) {
    const resolved =
      pick(vocab?.[variant], locale) ??
      pick(STATUS_LABELS[variant], locale) ??
      pick(DOMAIN_ENTITY_LABELS[variant], locale) ??
      pick(RULE_LABELS[variant], locale);
    if (resolved !== null) return resolved;
  }
  return locale === 'en' ? GENERIC_FALLBACKS.status.en : GENERIC_FALLBACKS.status.ar;
}

/**
 * Engine / decision-rule identifier → localized human label.
 * Unknown rule ids → 'قاعدة نظام' / 'System rule' — the technical id
 * is diagnostics-only and never renders in a business surface.
 */
export function presentRule(key: string, locale: PresentationLocale): string {
  if (typeof key !== 'string' || key.trim() === '') {
    return locale === 'en' ? GENERIC_FALLBACKS.rule.en : GENERIC_FALLBACKS.rule.ar;
  }
  return (
    pick(RULE_LABELS[key], locale) ??
    pick(STATUS_LABELS[key], locale) ??
    (locale === 'en' ? GENERIC_FALLBACKS.rule.en : GENERIC_FALLBACKS.rule.ar)
  );
}

/**
 * Resolve-or-verbatim for values that MAY be a system key but may
 * also be legacy/user-entered stored text (§34 — no generic
 * auto-translation): known system keys resolve to their localized
 * label, record-ID-shaped values collapse to the safe fallback, and
 * anything else passes through UNCHANGED as business data.
 */
export function presentSystemOrVerbatim(key: string, locale: PresentationLocale): string {
  if (typeof key !== 'string') return '';
  const t = key.trim();
  if (t === '') return locale === 'en' ? GENERIC_FALLBACKS.status.en : GENERIC_FALLBACKS.status.ar;
  if (isRecordIdLike(t)) {
    return locale === 'en' ? GENERIC_FALLBACKS.title.en : GENERIC_FALLBACKS.title.ar;
  }
  return resolveSystemLabel(t, locale) ?? key;
}

// ─────────────────────────────────────────────────────────────
//  5) RECORD-ID DETECTION & SAFE DISPLAY TEXT
// ─────────────────────────────────────────────────────────────

/**
 * Firebase push IDs are 20 chars from [A-Za-z0-9_-], usually starting
 * with '-'. Longer machine tokens (>= 20 chars, no spaces) are treated
 * as record-id-like too. Business codes (employee numbers, CAPA refs,
 * phone numbers) never match this shape.
 */
export function isRecordIdLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 20 || v.length > 128) return false;
  if (/\s/.test(v)) return false;
  // Firebase push-ID canonical shape.
  if (/^-[A-Za-z0-9]{19}$/.test(v)) return true;
  // Generic machine token: long single token of id charset.
  if (/^[A-Za-z0-9_-]+$/.test(v) && v.length >= 20) return true;
  return false;
}

/**
 * Guard ANY value before it becomes visible display text: empty and
 * record-ID-shaped values collapse into the safe fallback; everything
 * else (names, titles, stored business text) passes through untouched.
 */
export function safeDisplayText(
  value: string | null | undefined,
  fallback: string,
): string {
  if (value === null || value === undefined) return fallback;
  const v = value.trim();
  if (v === '' || isRecordIdLike(v)) return fallback;
  return v;
}

// ─────────────────────────────────────────────────────────────
//  6) RECORD TITLE PROJECTION
//     Record ID → human-readable representation, per entity, from
//     the canonical business fields ALREADY LOADED on the record
//     (no extra reads — §45). Unnamed records get a localized
//     entity-aware fallback — never the raw id.
// ─────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** First present, non-id-like, non-empty value among candidate fields. */
function firstField(r: AnyRecord, fields: readonly string[]): string | null {
  for (const f of fields) {
    const s = str(r[f]);
    if (s !== null && !isRecordIdLike(s)) return s;
  }
  return null;
}

/** Entities whose "title" is a person's name. */
const NAME_ENTITIES = new Set(['employees', 'users']);

/** Localized 'بدون اسم' compound fallback, e.g. 'صفقة سفر بدون اسم'. */
function unnamedFallback(entity: string, locale: PresentationLocale): string {
  const base = presentEntity(entity, locale);
  return locale === 'en' ? `${base} without a name` : `${base} بدون اسم`;
}

/**
 * Human-readable headline for a record of the given entity.
 * Prefers the record's canonical business fields; falls back to a
 * localized unnamed label. NEVER returns a raw record id.
 */
export function presentRecordTitle(
  entity: string,
  record: unknown,
  locale: PresentationLocale,
): string {
  if (typeof record !== 'object' || record === null) return unnamedFallback(entity, locale);
  const r = record as AnyRecord;

  const name = firstField(r, ['name', 'employeeName', 'customerName', 'dealerName', 'title', 'schemeName', 'destination', 'subject', 'capacityName']);
  if (name !== null) {
    // Person entities are titled by the name alone; other entities get
    // the domain prefix («صفقة سفر — القاهرة»).
    if (NAME_ENTITIES.has(entity)) return name;
    const base = presentEntity(entity, locale);
    const singularDone = locale === 'en' ? base : base;
    return `${singularDone} — ${name}`;
  }

  // Secondary descriptors (category / type / month) still beat the id.
  const descriptor =
    firstField(r, ['categoryName', 'monthKey', 'month', 'description']) ??
    (typeof r.type === 'string' && r.type.trim() !== '' ? presentStatus(r.type, locale) : null);
  if (descriptor !== null) return `${presentEntity(entity, locale)} — ${descriptor}`;

  return unnamedFallback(entity, locale);
}
