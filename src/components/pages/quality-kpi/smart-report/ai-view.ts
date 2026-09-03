// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — AI section view mapping (Phase 6.2)
//
//  PURE presentation mapping (spec §46): stable English enums →
//  Arabic labels + badge tones. NO logic, NO fetching, NO state —
//  the same pattern as analytics-view.ts so it stays unit-testable
//  and the AI output contract stays untouched.
// ══════════════════════════════════════════════════════════════

import type {
  AIConfidence,
  AIInsightType,
  AIPriority,
  AIRecommendationCategory,
  AISeverity,
} from '@/lib/ai/quality/contracts';

export const AI_INSIGHT_TYPE_LABELS: Record<AIInsightType, string> = {
  TREND: 'اتجاه',
  PATTERN: 'نمط',
  RISK: 'مخاطرة',
  OPPORTUNITY: 'فرصة',
  PROCESS_GAP: 'فجوة إجرائية',
  REPEATED_ISSUE: 'مشكلة متكررة',
  PERFORMANCE_SIGNAL: 'إشارة أداء',
  DATA_QUALITY: 'جودة بيانات',
};

export const AI_SEVERITY_LABELS: Record<AISeverity, string> = {
  INFO: 'معلوماتية',
  LOW: 'منخفضة',
  MEDIUM: 'متوسطة',
  HIGH: 'عالية',
  CRITICAL: 'حرجة',
};

export const AI_CONFIDENCE_LABELS: Record<AIConfidence, string> = {
  LOW: 'منخفضة',
  MEDIUM: 'متوسطة',
  HIGH: 'عالية',
};

export const AI_CATEGORY_LABELS: Record<AIRecommendationCategory, string> = {
  PROCESS: 'إجراءات',
  TRAINING: 'تدريب',
  FOLLOW_UP: 'متابعة',
  QUALITY: 'جودة',
  CUSTOMER_EXPERIENCE: 'تجربة العملاء',
  WORKFLOW: 'سير عمل',
  DATA_QUALITY: 'جودة البيانات',
  MANAGEMENT_REVIEW: 'مراجعة إدارية',
};

export const AI_PRIORITY_LABELS: Record<AIPriority, string> = {
  LOW: 'منخفضة',
  MEDIUM: 'متوسطة',
  HIGH: 'عالية',
};

export const AI_IMPACT_LABELS: Record<string, string> = {
  IMPROVEMENT: 'تحسين متوقع',
  RISK_REDUCTION: 'تقليل المخاطر',
  NEUTRAL: 'أثر محايد',
};

/** Badge tone for severity / priority / confidence / data-status. */
export function aiBadgeTone(level: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent' {
  switch (level) {
    case 'HIGH': return 'bad';
    case 'CRITICAL': return 'bad';
    case 'MEDIUM': return 'warn';
    case 'LOW': return 'neutral';
    case 'INFO': return 'info';
    case 'RISK_REDUCTION': return 'good';
    case 'IMPROVEMENT': return 'good';
    case 'NEUTRAL': return 'neutral';
    default: return 'neutral';
  }
}

/** Failure-state heading per status (message body comes from the envelope). */
export function aiFailureHeading(status: string): string {
  switch (status) {
    case 'NO_DATA': return 'لا توجد بيانات لهذه الفترة';
    case 'INSUFFICIENT_DATA': return 'البيانات التاريخية غير كافية حاليًا';
    case 'AI_UNAVAILABLE': return 'التحليل الذكي غير مُهيأ';
    case 'AI_TIMEOUT': return 'انتهت مهلة التحليل الذكي';
    case 'AI_ERROR': return 'تعذر إتمام التحليل الذكي';
    case 'AI_INVALID_RESPONSE': return 'استجابة تحليل غير موثوقة';
    case 'AI_RATE_LIMITED': return 'طلبات كثيرة — انتظر لحظة';
    default: return 'حالة غير متوقعة';
  }
}

// ── Phase 6.5-A §17 — gateway diagnostic → user-safe hint ──────
// The envelope now carries `diagnostic.status` (the REAL category
// behind the friendly message). This maps each gateway state to ONE
// honest, actionable, secret-free Arabic hint. Raw provider errors,
// keys and stack traces never reach this layer.

/** User-safe hint per gateway diagnostic status (null = no hint). */
export function aiDiagnosticHint(gatewayStatus: string): string | null {
  switch (gatewayStatus) {
    case 'DISABLED':
      return 'الذكاء الاصطناعي معطّل في هذه البيئة (AI_ENABLED) — التفعيل يتم من إعدادات الخادم بواسطة المدير.';
    case 'MISCONFIGURED':
      return 'إعداد المزود ناقص (المزود/الموديل/المفتاح) — راجع /api/ai/diagnostics بصلاحية المدير.';
    case 'MODEL_ERROR':
      return 'الموديل المُهيأ غير متاح لدى المزود — يلزم اختيار موديل صريح مدعوم (راجع /api/ai/models).';
    case 'UNAVAILABLE':
      return 'تعذر الوصول إلى مزود الذكاء الاصطناعي — تحقق من الشبكة أو إعداد المزود ثم أعد المحاولة.';
    case 'RATE_LIMITED':
      return 'تم تجاوز حد الاستخدام المؤقت — انتظر قليلاً ثم أعد المحاولة.';
    case 'PROVIDER_ERROR':
      return 'أعاد المزود خطأً مؤقتًا — أعد المحاولة بعد قليل.';
    case 'TIMEOUT':
      return 'استغرقت المعالجة وقتًا أطول من المهلة المحددة — أعد المحاولة، ويمكن للمدير مراجعة AI_TIMEOUT_MS.';
    case 'VALIDATION_ERROR':
      return 'لم تجتز الاستجابة التحقق الصارم — لن تُعرض أي نتيجة غير موثوقة.';
    default:
      return null;
  }
}

/** Sufficiency chip label (§2/§69 — never call limited data "فشل"). */
export function aiSufficiencyLabel(sufficiency: 'SUFFICIENT_DATA' | 'LIMITED_DATA'): string {
  return sufficiency === 'LIMITED_DATA' ? 'محدودة' : 'كافية';
}
