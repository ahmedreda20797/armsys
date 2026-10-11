'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports 2.0 — bilingual presentation layer
//
//  EVERY user-facing label of the insights workspace lives here as
//  [ar, en] tuples (house pattern). Terminology contract (spec §25):
//
//    • NO "weight / weighted / contribution" user-facing wording —
//      percentages only: نسبة الجودة · النسبة المحددة · النسبة
//      المحققة · النسبة المحتسبة · إجمالي النسبة · حالة التقييم.
//    • Engine status keys NEVER render raw — StatusBadge /
//      presentStatus resolve them; unknown keys stay invisible.
//    • Internal identifiers (rule ids, dataset keys, row_status_*)
//      never pass through this module.
//
//  Business data (employee names, stored category snapshots) is
//  rendered verbatim — never translated.
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import type { DataQualityEntry, InsightSignal } from '@/lib/kpi-reporting';

export type { DataQualityEntry, InsightSignal };

/** Client-safe structural slice of the insight signal payload. */
export type InsightSignalLike = Pick<
  InsightSignal,
  'kind' | 'level' | 'teamLabel' | 'categoryId' | 'categoryName' | 'employeeIds' | 'count' | 'deltaPoints' | 'occurrenceCount'
>;

/** Client-safe structural slice of the data-quality entry payload. */
export type InsightDataQualityStatusLike = Pick<DataQualityEntry, 'source' | 'status' | 'count'>;

export function pick(locale: Locale, pair: readonly [string, string]): string {
  return locale === 'en' ? pair[1] : pair[0];
}

// ─────────────────────────────────────────────────────────────
//  Percentage terminology (spec §9) — the ONLY user-facing names
// ─────────────────────────────────────────────────────────────

export const TERMS = {
  qualityPct: ['نسبة الجودة', 'Quality Percentage'] as const,
  definedPct: ['النسبة المحددة', 'Defined Percentage'] as const,
  achievedPct: ['النسبة المحققة', 'Achieved Percentage'] as const,
  calculatedPct: ['النسبة المحتسبة', 'Calculated Percentage'] as const,
  totalPct: ['إجمالي النسبة', 'Total Calculated Percentage'] as const,
  evaluationStatus: ['حالة التقييم', 'Evaluation Status'] as const,
  changeVsPrevious: ['التغير عن الفترة السابقة', 'Change vs previous period'] as const,
  approvedObservations: ['الملاحظات المعتمدة', 'Approved observations'] as const,
  repeatedIssues: ['مشكلات متكررة', 'Repeated issues'] as const,
  highCritical: ['مرتفعة/حرجة', 'High/Critical'] as const,
  needsAttention: ['بحاجة إلى متابعة', 'Needs attention'] as const,
  employees: ['الموظفون', 'Employees'] as const,
  teams: ['الفرق', 'Teams'] as const,
  departments: ['الأقسام', 'Departments'] as const,
  company: ['الشركة', 'Company'] as const,
  averageQuality: ['متوسط نسبة الجودة', 'Average Quality Percentage'] as const,
  evaluationIncomplete: ['التقييم غير مكتمل', 'Evaluation incomplete'] as const,
  calculatedSoFar: ['النسبة المحتسبة حاليًا', 'Currently calculated percentage'] as const,
  viewEmployeeReport: ['عرض تقرير الموظف', 'View employee report'] as const,
  openEmployee360: ['فتح ملف الموظف', 'Open Employee 360'] as const,
  affectedEmployees: ['الموظفون المتأثرون', 'Affected employees'] as const,
  affectedTeams: ['الفرق المتأثرة', 'Affected teams'] as const,
  managementFocus: ['محور المراجعة الإدارية', 'Suggested management focus'] as const,
  occurrences: ['مرات التكرار', 'Occurrences'] as const,
  notAvailable: ['غير متاح', 'Not available'] as const,
  noData: ['لا توجد بيانات', 'No data'] as const,
  restricted: ['محجوب — لا صلاحية', 'Withheld — no permission'] as const,
  notConfigured: ['غير مُهيأ', 'Not configured'] as const,
  available: ['متاح', 'Available'] as const,
};

// ─────────────────────────────────────────────────────────────
//  Severity (canonical observation vocabulary)
// ─────────────────────────────────────────────────────────────

export const SEVERITY_LABELS: Record<string, [string, string]> = {
  low: ['منخفضة', 'Low'],
  medium: ['متوسطة', 'Medium'],
  high: ['مرتفعة', 'High'],
  critical: ['حرجة', 'Critical'],
};

export const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export const SEVERITY_ORDER: Array<'critical' | 'high' | 'medium' | 'low'> = [
  'critical', 'high', 'medium', 'low',
];

// ─────────────────────────────────────────────────────────────
//  Data-quality table (spec §24)
// ─────────────────────────────────────────────────────────────

export const DATA_SOURCE_LABELS: Record<string, [string, string]> = {
  kpi: ['إطار KPI', 'KPI framework'],
  quality: ['ملاحظات الجودة', 'Quality observations'],
  followUps: ['المتابعات', 'Follow-ups'],
  complaints: ['الشكاوى', 'Complaints'],
  capa: ['تحليل المشكلات (CAPA)', 'CAPA'],
  attendance: ['الحضور والانصراف', 'Attendance'],
  hrDeductions: ['خصومات الموارد البشرية', 'HR deductions'],
};

export const DATA_STATUS_LABELS: Record<string, [string, string]> = {
  available: ['متاح', 'Available'],
  no_data: ['لا توجد بيانات', 'No data'],
  not_configured: ['غير مُهيأ', 'Not configured'],
  restricted: ['محجوب — لا صلاحية', 'Withheld — no permission'],
};

export const DATA_STATUS_STYLES: Record<string, string> = {
  available: 'text-emerald-300',
  no_data: 'text-slate-400',
  not_configured: 'text-amber-300',
  restricted: 'text-brand-300',
};

// ─────────────────────────────────────────────────────────────
//  Report types & scope
// ─────────────────────────────────────────────────────────────

export const REPORT_TYPE_LABELS: Record<string, [string, string]> = {
  employees: ['أداء الموظفين', 'Employee Performance'],
  teams: ['أداء الفرق', 'Team Performance'],
  comparison: ['مقارنة الأداء', 'Performance Comparison'],
  hr: ['دعم قرارات الموارد البشرية', 'HR Decision Support'],
};

export const REPORT_TYPE_HINTS: Record<string, [string, string]> = {
  employees: ['كيف يؤدي كل موظف مختار خلال الفترة؟', 'How is each selected employee performing?'],
  teams: ['كيف يؤدي كل فريق كوحدة تشغيلية؟', 'How is each team performing as an operating unit?'],
  comparison: ['كيف يقارن الموظفون والفرق والأقسام بعضها ببعض؟', 'How do employees, teams and departments compare?'],
  hr: ['ما معلومات دعم القرار المتاحة لإدارة الموارد البشرية؟', 'What deterministic decision-support information is available for HR?'],
};

export const SCOPE_MODE_LABELS: Record<string, [string, string]> = {
  company: ['الشركة', 'Company'],
  employees: ['موظفون', 'Employees'],
  teams: ['فرق', 'Teams'],
  departments: ['أقسام', 'Departments'],
};

// ─────────────────────────────────────────────────────────────
//  Signal narration (structured fact → bilingual sentence)
// ─────────────────────────────────────────────────────────────

export interface SignalPresentation {
  level: 'critical' | 'warning' | 'info' | 'positive';
  text: string;
}

const fmtSigned = (v: number): string => `${v > 0 ? '+' : ''}${v}`;

/**
 * Build the bilingual sentence for a structured signal. Deterministic
 * wording only — states facts, never causes (spec §19 language rules:
 * "يشير / يُسجَّل / مراجعة", never "تسبب في").
 */
export function presentSignal(signal: InsightSignalLike, locale: Locale): SignalPresentation {
  const ar = locale !== 'en';
  switch (signal.kind) {
    case 'TEAM_DECLINE': {
      const team = signal.teamLabel ?? '';
      const delta = Math.abs(signal.deltaPoints ?? 0);
      return {
        level: 'warning',
        text: ar
          ? `جودة فريق ${team} انخفضت ${delta} نقطة عن الفترة السابقة`
          : `Quality of team ${team} dropped ${delta} points vs the previous period`,
      };
    }
    case 'TEAM_IMPROVE': {
      const team = signal.teamLabel ?? '';
      const delta = signal.deltaPoints ?? 0;
      return {
        level: 'positive',
        text: ar
          ? `جودة فريق ${team} تحسنت ${delta} نقطة عن الفترة السابقة`
          : `Quality of team ${team} improved ${delta} points vs the previous period`,
      };
    }
    case 'REPEATED_PATTERN': {
      const count = signal.employeeIds?.length ?? 0;
      const category = signal.categoryName ?? '';
      return {
        level: 'warning',
        text: ar
          ? `${count} موظفين لديهم تكرار في تصنيف «${category}»`
          : `${count} employees show repeated "${category}" observations`,
      };
    }
    case 'HIGH_SEVERITY': {
      const count = signal.count ?? 0;
      return {
        level: 'critical',
        text: ar
          ? `${count} موظفين لديهم ملاحظات مرتفعة أو حرجة`
          : `${count} employees have high or critical observations`,
      };
    }
    case 'EMPLOYEE_DECLINE': {
      const delta = Math.abs(signal.deltaPoints ?? 0);
      return {
        level: 'warning',
        text: ar
          ? `موظف واحد على الأقل انخفضت جودته ${delta} نقطة عن الفترة السابقة`
          : `At least one employee's quality dropped ${delta} points vs the previous period`,
      };
    }
    case 'PENDING_APPROVALS': {
      const count = signal.count ?? 0;
      return {
        level: 'info',
        text: ar
          ? `${count} ملاحظة بانتظار الاعتماد — النتائج قد تتغير بعد الاعتماد`
          : `${count} observations await approval — results may change once approved`,
      };
    }
    default:
      return { level: 'info', text: '' };
  }
}

/** Management-attention suggested review action per signal kind (§21). */
export function signalSuggestedAction(signal: InsightSignalLike, locale: Locale): string {
  const ar = locale !== 'en';
  switch (signal.kind) {
    case 'TEAM_DECLINE':
      return ar ? 'مراجعة تغييرات العمل والحمل داخل الفريق' : 'Review team workload and process changes';
    case 'TEAM_IMPROVE':
      return ar ? 'توثيق الممارسات الجيدة ومشاركتها' : 'Document and share what worked';
    case 'REPEATED_PATTERN':
      return ar ? 'مراجعة إجراءات التصنيف المتكرر والالتزام بها' : 'Review the repeated-category workflow and adherence';
    case 'HIGH_SEVERITY':
      return ar ? 'مراجعة الاحتياجات التدريبية والتوجيهية' : 'Review coaching and training needs';
    case 'EMPLOYEE_DECLINE':
      return ar ? 'مقارنة أداء الموظف بمتوسط فريقه' : 'Compare the employee with their team average';
    case 'PENDING_APPROVALS':
      return ar ? 'إكمال دورة الاعتماد' : 'Complete the approval cycle';
    default:
      return '';
  }
}

export { fmtSigned };
