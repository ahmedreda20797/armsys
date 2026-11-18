'use client';

// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — bilingual presentation layer
//  (مركز أداء الموظف)
//
//  EVERY user-facing label of the Hub lives here as [ar, en]
//  tuples (the insights-labels house pattern). The dataset carries
//  RULE IDS / canonical enum keys; this module is the ONLY place
//  they become human text — engine keys never render raw.
//
//  Terminology contracts honored here:
//    • §25 approved quality vocabulary — never "weight/contribution".
//    • §16 cross-signal wording is ASSOCIATIVE (تزامن/ترافق), never
//      causal.
//    • Missing data reads "بيانات غير كافية" — never 0% / ضعيف.
//    • Internal ids (rule keys, collections, Firebase paths) are
//      never user-facing.
//  Business data (stored category labels, subjects) renders
//  verbatim — never translated.
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import { resolveStoredLabelOrVerbatim } from '@/lib/i18n/dynamic-labels';

export function pick(locale: Locale, pair: readonly [string, string]): string {
  return locale === 'en' ? pair[1] : pair[0];
}

function labeled(map: Record<string, readonly [string, string]>, key: string | null | undefined): readonly [string, string] | null {
  if (!key) return null;
  return map[key] ?? null; // unknown keys stay invisible — never render raw ids
}

// ─────────────────────────────────────────────────────────────
//  Dimensions + statuses
// ─────────────────────────────────────────────────────────────

export const HUB_DIMENSIONS: Record<string, readonly [string, string]> = {
  quality: ['الجودة', 'Quality'],
  // §METRIC-VALIDATION — customer & deal follow-up is surfaced with an
  // explicit NOT_MEASURABLE verdict (no data source exists); booking
  // execution is its own business-output dimension. Never merged.
  customerDealFollowUp: ['متابعة العملاء والصفقات', 'Customer & Deal Follow-up'],
  bookingExecution: ['تنفيذ الحجوزات', 'Booking Execution'],
  employeeActionFollowUp: ['متابعة إجراءات الموظف', 'Employee Action Follow-up'],
  risk: ['المخاطر التشغيلية', 'Operational Risk'],
  attendance: ['الحضور والانصراف', 'Attendance'],
  businessOutput: ['الناتج العملي (الصفقات)', 'Business Output'],
  hr: ['انتظام الموارد البشرية', 'HR Discipline'],
  complaints: ['شكاوى العملاء', 'Complaints'],
  capa: ['إجراءات كابا', 'CAPA'],
};

export const HUB_DIMENSION_STATUS: Record<string, readonly [string, string]> = {
  STRONG: ['قوي', 'Strong'],
  STABLE: ['مستقر', 'Stable'],
  IMPROVING: ['يتحسن', 'Improving'],
  NEEDS_ATTENTION: ['يحتاج انتباهًا', 'Needs Attention'],
  DECLINING: ['متراجع', 'Declining'],
  INSUFFICIENT_DATA: ['بيانات غير كافية', 'Insufficient Data'],
  NOT_MEASURABLE: ['غير قابل للقياس', 'Not Measurable'],
};

export const HUB_DIMENSION_METRICS: Record<string, readonly [string, string]> = {
  qualityPercent: ['نسبة الجودة', 'Quality Percentage'],
  calculatedPoints: ['النقاط المحتسبة', 'Calculated Points'],
  bookingCompletion: ['نسبة إتمام الحجوزات', 'Booking Completion Rate'],
  employeeActionFollowUpCompletion: ['نسبة إكمال متابعات إجراءات الموظف', 'Employee Action Follow-up Completion'],
  overdueEmployeeActionFollowUps: ['متابعات إجراءات متأخرة', 'Overdue Employee Action Follow-ups'],
  openBookingItems: ['بنود حجز مفتوحة', 'Open Booking Items'],
  riskScore: ['درجة المخاطر', 'Risk Score'],
  attendanceCompliance: ['نسبة الالتزام بالحضور', 'Attendance Compliance'],
  closedDeals: ['تقفيلات الفترة', 'Closures This Period'],
  hrDeductions: ['خصومات موارد بشرية', 'HR Deductions'],
  openItems: ['بنود مفتوحة', 'Open Items'],
};

export const HUB_OVERVIEW_STATUS: Record<string, readonly [string, string]> = {
  IMPROVING: ['يتحسن', 'Improving'],
  STABLE: ['مستقر', 'Stable'],
  NEEDS_COACHING: ['يحتاج توجيهًا', 'Needs Coaching'],
  PERFORMANCE_IMPROVEMENT_REVIEW: ['مراجعة تحسين الأداء', 'Performance Improvement Review'],
  MANAGEMENT_REVIEW: ['مراجعة إدارية', 'Management Review'],
  INSUFFICIENT_DATA: ['بيانات غير كافية', 'Insufficient Data'],
};

/** §25 terminology — the approved vocabulary, exactly. */
export const HUB_TERMS = {
  qualityPct: ['نسبة الجودة', 'Quality Percentage'] as const,
  definedPct: ['النسبة المحددة للجودة', 'Configured Quality Percentage'] as const,
  calculatedPct: ['النسبة المحتسبة للجودة', 'Calculated Quality Percentage'] as const,
  observations: ['ملاحظات الجودة', 'Quality Observations'] as const,
  qualityDeductions: ['خصومات الجودة', 'Quality Deductions'] as const,
  hrDeductions: ['خصومات الموارد البشرية', 'HR Deductions'] as const,
  unavailable: ['غير متاح', 'Unavailable'] as const,
};

// ─────────────────────────────────────────────────────────────
//  Overview reasons / signals / areas / recommendations
// ─────────────────────────────────────────────────────────────

export const HUB_OVERVIEW_REASONS: Record<string, readonly [string, string]> = {
  'rule.noMeasurableDimensions': ['لا توجد أبعاد قابلة للقياس في هذه الفترة', 'No measurable dimensions in this period'],
  'rule.riskCritical': ['درجة المخاطر حرجة وفق محرك المخاطر المعتمد', 'Risk level is critical per the canonical Risk Engine'],
  'rule.riskHigh': ['درجة المخاطر مرتفعة وفق محرك المخاطر المعتمد', 'Risk level is high per the canonical Risk Engine'],
  'rule.multipleDecliningDimensions': ['ثلاثة أبعاد أو أكثر في تراجع', 'Three or more dimensions are declining'],
  'rule.decliningDimensions': ['بُعدان في تراجع', 'Two dimensions are declining'],
  'rule.needsAttentionDimensions': ['توجد أبعاد تحتاج انتباهًا', 'Some dimensions need attention'],
  'rule.improvingWithoutConcerns': ['توجد مؤشرات تحسن دون إشارات قلق', 'Improvement signals with no concerns'],
  'rule.stable': ['الأبعاد القابلة للقياس مستقرة', 'Measurable dimensions are stable'],
};

export const HUB_EVIDENCE: Record<string, readonly [string, string]> = {
  // strengths
  'strength.qualityImproved': ['تحسن نسبة الجودة عن الفترة السابقة', 'Quality percentage improved vs the previous period'],
  'strength.noDeductions': ['لا توجد خصومات جودة ولا خصومات موارد بشرية خلال الفترة', 'No quality deductions and no HR deductions this period'],
  'strength.actionFollowUpsOnTrack': ['متابعات إجراءات الموظف منجزة دون تأخيرات', 'Employee action follow-ups completed with no delays'],
  'strength.bookingExecutionComplete': ['بنود الحجوزات مكتملة للفترة', 'Booking items fully booked this period'],
  'strength.attendanceSolid': ['الالتزام بالحضور مرتفع', 'Attendance compliance is high'],
  'strength.dealsIncreased': ['زاد عدد التقفيلات عن الفترة السابقة', 'Closures increased vs the previous period'],
  'strength.capaClear': ['لا توجد حالات كابا مفتوحة أو متأخرة', 'No open or overdue CAPA cases'],
  'strength.noRepeatedIssues': ['اختفت المشكلات المتكررة التي كانت في الفترة السابقة', 'Previously repeated issues no longer recur'],
  // concerns
  'concern.riskCritical': ['درجة المخاطر حرجة', 'Risk level is critical'],
  'concern.riskHigh': ['درجة المخاطر مرتفعة', 'Risk level is high'],
  'concern.repeatedIssues': ['مشكلات جودة متكررة', 'Repeated quality issues'],
  'concern.overdueActionFollowUps': ['متابعات إجراءات الموظف متأخرة', 'Overdue employee action follow-ups'],
  'concern.openBookingItems': ['بنود حجز مفتوحة لدى الموردين', 'Open booking items at suppliers'],
  'concern.qualityDeclining': ['نسبة الجودة في تراجع', 'Quality percentage is declining'],
  'concern.attendance': ['الالتزام بالحضور يحتاج مراجعة', 'Attendance compliance needs review'],
  'concern.hrDeductions': ['توجد خصومات موارد بشرية', 'HR deductions exist this period'],
  'concern.dealsDeclining': ['عدد التقفيلات في تراجع', 'Closures are declining'],
  // development areas
  'area.repeatedQualityIssues': ['الالتزام بإجراءات الجودة (مشكلات متكررة)', 'Quality procedure adherence (repeated issues)'],
  'area.overdueActionFollowUps': ['انتظام إنجاز متابعات إجراءات الموظف', 'Employee action follow-up completion discipline'],
  'area.openBookingItems': ['استكمال حجوزات الخدمات المفتوحة', 'Completing open service bookings'],
  'area.qualityDeductions': ['دقة العمليات (خصومات جودة)', 'Operational accuracy (quality deductions)'],
  'area.attendanceConsistency': ['انتظام الحضور', 'Attendance consistency'],
  'area.complaintHandling': ['معالجة شكاوى العملاء', 'Customer complaint handling'],
  'area.capaFollowThrough': ['استكمال إجراءات كابا', 'CAPA follow-through'],
  'area.hrDiscipline': ['الالتزام والسلوك (خصومات موارد بشرية)', 'Commitment and behavior (HR deductions)'],
  'area.qualityAdherence': ['مستوى الجودة العام', 'Overall quality level'],
  // recommendation rationales
  'evidence.overdueActionFollowUps': ['متابعات إجراءات الموظف المتأخرة خلال الفترة', 'Overdue employee action follow-ups this period'],
  'evidence.openBookingItems': ['بنود حجز مفتوحة خلال الفترة', 'Open booking items this period'],
  'evidence.attendance': ['مؤشرات الحضور للفترة', 'Attendance indicators for the period'],
  'evidence.overdueCapa': ['حالات كابا متأخرة', 'Overdue CAPA cases'],
  'evidence.openComplaints': ['شكاوى مفتوحة مرتبطة بالموظف', 'Open complaints linked to the employee'],
  'evidence.reviewBasis': ['أساس المراجعة: أبعاد متراجعة ودرجة المخاطر', 'Review basis: declining dimensions and the risk score'],
};

export const HUB_RECOMMENDATIONS: Record<string, readonly [string, string]> = {
  'rec.coaching': ['يُوصى بتوجيه عملي على الإجراءات المتأثرة (المشكلات المتكررة)', 'Coaching recommended on the affected procedures (repeated issues)'],
  'rec.actionFollowUpReview': ['يُوصى بمراجعة حجم متابعات إجراءات الموظف والالتزام بمواعيدها', 'Review the employee’s internal action follow-up workload and SLA adherence'],
  'rec.bookingExecutionReview': ['يُوصى بمراجعة بنود الحجوزات المفتوحة لدى الموردين واستكمالها', 'Review open booking items at suppliers and complete them'],
  'rec.attendanceReview': ['يُوصى بمراجعة نمط الحضور مع الموارد البشرية', 'Review the attendance pattern with HR'],
  'rec.capaReview': ['يُوصى بمراجعة حالات كابا المتأخرة وتسريع استكمالها', 'Review overdue CAPA cases and accelerate completion'],
  'rec.complaintReview': ['يُوصى بمراجعة الشكاوى المفتوحة المرتبطة بالموظف', 'Review open complaints linked to the employee'],
  'rec.performanceReview': ['يُوصى بمراجعة أداء منظمة متعددة الأبعاد', 'Consider a structured performance review'],
};

// ─────────────────────────────────────────────────────────────
//  Changes / cross-signals / patterns
// ─────────────────────────────────────────────────────────────

export const HUB_CHANGE_METRICS: Record<string, readonly [string, string]> = {
  qualityPercent: ['نسبة الجودة', 'Quality percentage'],
  calculatedPoints: ['النقاط المحتسبة', 'Calculated points'],
  employeeActionFollowUpCompletion: ['نسبة إكمال متابعات إجراءات الموظف', 'Employee action follow-up completion'],
  employeeActionFollowUpsOverdue: ['متابعات الإجراءات المتأخرة', 'Overdue employee action follow-ups'],
  bookingCompletion: ['نسبة إتمام الحجوزات', 'Booking completion rate'],
  openBookingItems: ['بنود الحجز المفتوحة', 'Open booking items'],
  attendanceCompliance: ['نسبة الالتزام بالحضور', 'Attendance compliance'],
  dealsClosed: ['تقفيلات الفترة (تاريخ تقفيل الديل)', 'Closures this period (deal closure date)'],
  observationsCount: ['ملاحظات الجودة', 'Quality observations'],
  qualityDeductions: ['خصومات الجودة', 'Quality deductions'],
  riskScore: ['درجة المخاطر', 'Risk score'],
  hrDeductions: ['خصومات الموارد البشرية', 'HR deductions'],
};

/** §16 — association wording ONLY; never causal. */
export const HUB_CROSS_SIGNALS: Record<string, readonly [string, string]> = {
  'overlap.actionFollowUpDelaysQuality': ['تزامن: ارتفاع متابعات الإجراءات المتأخرة مع ارتفاع ملاحظات الجودة خلال الفترة نفسها', 'Observed overlap: increased overdue employee action follow-ups coincided with increased quality observations during the same period'],
  'overlap.deductionsComplaints': ['تزامن: ارتفاع خصومات الجودة مع ارتفاع ملاحظات الجودة خلال الفترة نفسها', 'Observed overlap: increased quality deductions coincided with increased quality observations during the same period'],
  'overlap.attendanceActionFollowUps': ['تزامن: انخفاض الالتزام بالحضور مع ارتفاع متابعات الإجراءات المتأخرة خلال الفترة نفسها', 'Observed overlap: lower attendance compliance coincided with increased overdue employee action follow-ups during the same period'],
  'overlap.dealsBookingExecution': ['تزامن: انخفاض التقفيلات مع انخفاض نسبة إتمام الحجوزات خلال الفترة نفسها', 'Observed overlap: fewer closures coincided with lower booking completion during the same period'],
  'overlap.qualityDeclineObservations': ['تزامن: انخفاض نسبة الجودة مع ارتفاع عدد الملاحظات خلال الفترة نفسها', 'Observed overlap: lower quality percentage coincided with more observations during the same period'],
};

export const HUB_PATTERNS: Record<string, readonly [string, string]> = {
  REPEATED: ['متكررة — يظهر نفس النمط عبر أكثر من شهر', 'Repeated — the same pattern across multiple months'],
  PERSISTENT: ['مستمرة — موجودة في الفترة الحالية والسابقة', 'Persistent — present in the current and previous periods'],
  EMERGING: ['ناشئة — ظهرت في الفترة الحالية دون سابقة', 'Emerging — appeared this period with no prior occurrence'],
  IMPROVING: ['تتحسن — مشكلة متكررة سابقًا لم تعد تتكرر', 'Improving — a previously recurring issue stopped recurring'],
  DETERIORATING: ['متراجع — بُعد كان مستقرًا في تراجع', 'Deteriorating — a previously stable dimension is declining'],
  ISOLATED: ['معزولة — حدث واحد دون تكرار كافٍ', 'Isolated — a single occurrence without sufficient recurrence'],
};

// ─────────────────────────────────────────────────────────────
//  Timeline / risk factors / data quality
// ─────────────────────────────────────────────────────────────

export const HUB_EVENT_TYPES: Record<string, readonly [string, string]> = {
  observation: ['ملاحظة جودة', 'Quality Observation'],
  qualityDeduction: ['خصم جودة', 'Quality Deduction'],
  // §FOLLOWUP-DOMAINS — the timeline names the internal-action domain
  // explicitly; never the ambiguous "Follow-up" alone.
  employeeActionFollowUp: ['متابعة إجراءات الموظف', 'Employee Action Follow-up'],
  complaint: ['شكوى', 'Complaint'],
  capa: ['كابا', 'CAPA'],
  dealClosed: ['تقفيل صفقة', 'Deal Closure'],
  attendanceResult: ['نتيجة الحضور الشهرية', 'Monthly Attendance Result'],
  hrDeduction: ['خصم موارد بشرية', 'HR Deduction'],
  kpiResult: ['نتيجة مؤشر الأداء', 'KPI Result'],
};

/** Canonical status vocabulary → display labels (unknown keys stay hidden). */
export const TIMELINE_STATUS_LABELS: Record<string, readonly [string, string]> = {
  approved: ['معتمدة', 'Approved'],
  pending: ['قيد الاعتماد', 'Pending'],
  rejected: ['مرفوضة', 'Rejected'],
  open: ['مفتوحة', 'Open'],
  under_review: ['قيد المراجعة', 'Under Review'],
  under_follow_up: ['قيد المتابعة', 'Under Follow-up'],
  resolved: ['منجزة', 'Resolved'],
  closed: ['مغلقة', 'Closed'],
  cancelled: ['ملغاة', 'Cancelled'],
  under_investigation: ['قيد التحقيق', 'Under Investigation'],
  pending_resolution: ['بانتظار الحل', 'Pending Resolution'],
  investigation: ['تحقيق', 'Investigation'],
  root_cause_analysis: ['تحليل السبب الجذري', 'Root Cause Analysis'],
  corrective_action: ['إجراء تصحيحي', 'Corrective Action'],
  preventive_action: ['إجراء وقائي', 'Preventive Action'],
  verification: ['تحقق من الفعالية', 'Verification'],
  reopened: ['معاد فتحها', 'Reopened'],
  upcoming: ['قادمة', 'Upcoming'],
  in_progress: ['جارية', 'In Progress'],
  completed: ['مكتملة', 'Completed'],
  FINALIZED: ['مجمّدة', 'Frozen'],
  AVAILABLE: ['متاح', 'Available'],
  INCOMPLETE: ['غير مكتمل', 'Incomplete'],
  PENDING: ['معلّق', 'Suspended'],
  NOT_ELIGIBLE: ['غير مؤهل', 'Ineligible'],
  NO_SCHEME: ['لا يوجد مخطط', 'No scheme'],
  AMBIGUOUS: ['مخططات متعددة', 'Multiple schemes'],
  OVERRIDE_NOT_RESOLVABLE: ['تجاوز غير قابل للتطبيق', 'Unresolvable override'],
};

export const HUB_DOMAINS: Record<string, readonly [string, string]> = {
  quality: ['الجودة', 'Quality'],
  customerDealFollowUp: ['متابعة العملاء والصفقات', 'Customer & Deal Follow-up'],
  bookingExecution: ['تنفيذ الحجوزات', 'Booking Execution'],
  employeeActionFollowUp: ['متابعة إجراءات الموظف', 'Employee Action Follow-up'],
  risk: ['المخاطر', 'Risk'],
  attendance: ['الحضور', 'Attendance'],
  deals: ['الصفقات', 'Deals'],
  hr: ['الموارد البشرية', 'HR'],
  complaints: ['الشكاوى', 'Complaints'],
  capa: ['كابا', 'CAPA'],
  kpi: ['مؤشر الأداء', 'KPI'],
};

export const HUB_RISK_FACTORS: Record<string, readonly [string, string]> = {
  delay: ['أيام التأخير', 'Late days'],
  absence: ['أيام الغياب', 'Absent days'],
  quality: ['خصومات جودة', 'Quality deductions'],
  hr: ['خصومات موارد بشرية', 'HR deductions'],
  openFollowUp: ['متابعات إجراءات مفتوحة', 'Open employee action follow-ups'],
  highPriorityFollowUp: ['متابعات إجراءات بأولوية عالية', 'High-priority employee action follow-ups'],
  criticalFollowUp: ['متابعات إجراءات حرجة', 'Critical employee action follow-ups'],
  complaint: ['شكاوى مفتوحة', 'Open complaints'],
  repeatedIssue: ['مشكلات متكررة', 'Repeated issues'],
  openCapa: ['حالات كابا مفتوحة', 'Open CAPA cases'],
  overdueCapa: ['حالات كابا متأخرة', 'Overdue CAPA cases'],
  criticalCapa: ['حالات كابا حرجة', 'Critical CAPA cases'],
  reopenedCapa: ['حالات كابا معاد فتحها', 'Reopened CAPA cases'],
};

export const HUB_RISK_LEVELS: Record<string, readonly [string, string]> = {
  low: ['منخفضة', 'Low'],
  medium: ['متوسطة', 'Medium'],
  high: ['مرتفعة', 'High'],
  critical: ['حرجة', 'Critical'],
};

export const HUB_DATA_QUALITY_NOTES: Record<string, readonly [string, string]> = {
  'note.kpiIncomplete': ['مؤشر الأداء غير مكتمل — القيم المعروضة جزئية وليست النتيجة النهائية', 'KPI incomplete — shown values are partial, not the final result'],
  'note.attendanceUnavailable': ['لا توجد نتيجة حضور مخزّنة للفترة المحددة', 'No stored attendance result for the selected period'],
  'note.riskRestricted': ['قسم المخاطر محجوب لصلاحياتك الحالية', 'The risk section is restricted for your current permissions'],
  'note.hrRestricted': ['تفاصيل الموارد البشرية محجوبة لصلاحياتك الحالية', 'HR details are restricted for your current permissions'],
  'note.dealClosureDatesUnknown': ['توجد صفقات مكتملة بتاريخ تقفيل غير معروف — لم تُنسب لأي شهر', 'Some completed deals have unknown closure dates — not attributed to any month'],
  'note.noTeam': ['لا ينتمي الموظف إلى فريق في الهيكل التنظيمي — المقارنة الفريقية غير متاحة', 'The employee has no team in the organization tree — team benchmark unavailable'],
  'note.insufficientMembers': ['عدد أعضاء الفريق المتاحين غير كافٍ للمقارنة', 'Not enough authorized team members for the benchmark'],
  'note.previousPeriodUnavailable': ['تعذر بناء بيانات الفترة السابقة — مقارنة التغير غير متاحة', 'The previous period dataset could not be built — change comparison unavailable'],
  'note.unattributedRecords': ['سجلات بلا تاريخ صالح استُثنيت من تحليل الفترة', 'Records without a valid date were excluded from the period analysis'],
  // §METRIC-VALIDATION — the structural verdict for customer & deal follow-up.
  'note.customerFollowUpNotMeasurable': [
    'متابعة العملاء والصفقات غير قابلة للقياس حاليًا: لا يوجد مصدر بيانات لمواعيد أو أحداث أو سجل متابعة العملاء. حالات حجز الخدمات (محجوز/معلق/غير موجود) تقيس تنفيذ الحجز فقط ولا تُستخدم بديلًا.',
    'Customer & deal follow-up is not measurable today: no data source exists for follow-up dates, contact events or history. Booking-item statuses (booked/pending/missing) measure booking execution only and are never used as a substitute.',
  ],
  'note.NO_CUSTOMER_FOLLOW_UP_SOURCE': [
    'لا يوجد مصدر بيانات لمتابعة العملاء (مهام متابعة بمواعيد ووقائع تواصل وسجل إكمال)',
    'No data source exists for customer follow-up (follow-up tasks with deadlines, contact events and completion history)',
  ],
};

export const HUB_DQ_STATES: Record<string, readonly [string, string]> = {
  COMPLETE: ['كاملة', 'Complete'],
  PARTIAL: ['جزئية', 'Partial'],
  MISSING: ['مفقودة', 'Missing'],
  RESTRICTED: ['محجوبة', 'Restricted'],
  UNAVAILABLE: ['غير متاحة', 'Unavailable'],
};

export const HUB_BENCHMARK_METRICS: Record<string, readonly [string, string]> = {
  quality: ['نسبة الجودة', 'Quality percentage'],
  attendance: ['نسبة الالتزام بالحضور', 'Attendance compliance'],
  deals: ['تقفيلات الفترة', 'Closures this period'],
  employeeActionFollowUpCompletion: ['نسبة إكمال متابعات إجراءات الموظف', 'Employee action follow-up completion'],
};

export const HUB_EMPLOYMENT_STATUS: Record<string, readonly [string, string]> = {
  active: ['نشط', 'Active'],
  inactive: ['غير نشط', 'Inactive'],
  archived: ['مؤرشف', 'Archived'],
  unknown: ['غير معروف', 'Unknown'],
};

// ─────────────────────────────────────────────────────────────
//  Group Report (§GROUP-REPORTING) — labels
// ─────────────────────────────────────────────────────────────

export const PerformanceGroupLabels: Record<string, readonly [string, string]> = {
  // Dimensions
  quality: ['الجودة', 'Quality'],
  bookingExecution: ['تنفيذ الحجوزات', 'Booking Execution'],
  employeeActionFollowUp: ['متابعة إجراءات الموظف', 'Employee Action Follow-up'],
  attendance: ['الحضور والانصراف', 'Attendance'],
  businessOutput: ['الناتج العملي (الصفقات)', 'Business Output'],
  risk: ['المخاطر التشغيلية', 'Operational Risk'],
  complaints: ['شكاوى العملاء', 'Complaints'],
  capa: ['إجراءات كابا', 'CAPA'],
  hr: ['انتظام الموارد البشرية', 'HR Discipline'],

  // Overview statuses
  IMPROVING: ['يتحسن', 'Improving'],
  STABLE: ['مستقر', 'Stable'],
  NEEDS_COACHING: ['يحتاج توجيه', 'Needs Coaching'],
  PERFORMANCE_IMPROVEMENT_REVIEW: ['مراجعة تحسين الأداء', 'Performance Improvement Review'],
  MANAGEMENT_REVIEW: ['مراجعة إدارية', 'Management Review'],
  INSUFFICIENT_DATA: ['بيانات غير كافية', 'Insufficient Data'],

  // Org unit types
  team: ['فريق', 'Team'],
  department: ['قسم', 'Department'],
  company: ['شركة', 'Company'],
  manager: ['مدير', 'Manager'],

  // Risk levels
  critical: ['حرجة', 'Critical'],
  high: ['مرتفعة', 'High'],
  medium: ['متوسطة', 'Medium'],
  low: ['منخفضة', 'Low'],

  // Strength / concern / area rule ids (subset — keys match single-employee hub)
  'strength.qualityImproved': ['تحسن نسبة الجودة', 'Quality Improved'],
  'strength.bookingExecutionComplete': ['بنود الحجوزات مكتملة', 'Booking Items Complete'],
  'strength.actionFollowUpsOnTrack': ['متابعات الإجراءات منجزة', 'Action Follow-ups On Track'],
  'strength.attendanceSolid': ['الالتزام بالحضور مرتفع', 'Attendance Solid'],
  'strength.dealsIncreased': ['التقفيلات زادت', 'Closures Increased'],
  'strength.capaClear': ['لا توجد حالات كابا مفتوحة', 'CAPA Clear'],
  'strength.noRepeatedIssues': ['لا توجد مشكلات متكررة', 'No Repeated Issues'],

  'concern.riskCritical': ['درجة المخاطر حرجة', 'Risk Critical'],
  'concern.riskHigh': ['درجة المخاطر مرتفعة', 'Risk High'],
  'concern.repeatedIssues': ['مشكلات جودة متكررة', 'Repeated Issues'],
  'concern.overdueActionFollowUps': ['متابعات إجراءات متأخرة', 'Overdue Action Follow-ups'],
  'concern.openBookingItems': ['بنود حجز مفتوحة', 'Open Booking Items'],
  'concern.qualityDeclining': ['نسبة الجودة في تراجع', 'Quality Declining'],
  'concern.attendance': ['الالتزام بالحضور', 'Attendance'],
  'concern.hrDeductions': ['خصومات موارد بشرية', 'HR Deductions'],
  'concern.dealsDeclining': ['التقفيلات في تراجع', 'Closures Declining'],

  'area.repeatedQualityIssues': ['الالتزام بإجراءات الجودة', 'Quality Procedure Adherence'],
  'area.overdueActionFollowUps': ['انتظام إنجاز متابعات الإجراءات', 'Action Follow-up Discipline'],
  'area.openBookingItems': ['استكمال حجوزات الخدمات المفتوحة', 'Open Service Bookings'],
  'area.qualityDeductions': ['دقة العمليات (خصومات جودة)', 'Operational Accuracy'],
  'area.attendanceConsistency': ['انتظام الحضور', 'Attendance Consistency'],
  'area.complaintHandling': ['معالجة شكاوى العملاء', 'Complaint Handling'],
  'area.capaFollowThrough': ['استكمال إجراءات كابا', 'CAPA Follow-through'],
  'area.hrDiscipline': ['الالتزام والسلوك', 'Commitment & Behavior'],
  'area.qualityAdherence': ['مستوى الجودة العام', 'Overall Quality Level'],
};

// ─────────────────────────────────────────────────────────────
//  Sentence builders (values interpolate client-side — data
//  values render verbatim, only the static sentence translates)
// ─────────────────────────────────────────────────────────────

export function evidenceSentence(
  locale: Locale,
  item: { key: string; labels?: string[] },
): string | null {
  const base = labeled(HUB_EVIDENCE, item.key);
  if (!base) return null;
  const label = item.labels?.[0];
  if (!label) return pick(locale, base);
  // §DYNAMIC-LABELS — the stored business label names the affected
  // procedure/issue; a known semantic label localizes, free text
  // renders verbatim.
  return `${pick(locale, base)} — ${resolveStoredLabelOrVerbatim(label, locale)}`;
}
