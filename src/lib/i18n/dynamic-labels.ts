// src/lib/i18n/dynamic-labels.ts
// ══════════════════════════════════════════════════════════════
//  §DYNAMIC-LABELS — the canonical resolver for DYNAMIC STORED VALUES
//  (§8 of the performance-hub spec: "Canonical Dynamic Label
//  Resolution").
//
//  Resolution model:
//
//    stored value/key
//      → 1. master-data vocabulary (caller-provided labelAr/labelEn)
//      → 2. system enum vocabulary (./presentation STATUS_LABELS)
//      → 3. known LEGACY Arabic alias (exact match below)
//      → 4. null → the caller renders the stored value VERBATIM
//         (user/business data — never auto-translated)
//
//  WHAT THIS FIXES: legacy records froze ARABIC display labels
//  («تأخر متابعة», «مكتملة», «مشكلة جودة») instead of canonical keys.
//  English surfaces (reports, print, exports) rendered them raw.
//  Known semantic values now resolve to their English label
//  EVERYWHERE through this one module — no page-specific patches.
//
//  SAFETY RULES (binding):
//    • EXACT trimmed-string match only — never substring replacement,
//      never a sentence. An arbitrary user sentence never matches.
//    • A value that matches nothing is returned as null — the caller
//      renders it verbatim (it is business data). Nothing is invented.
//    • The underlying business meaning never changes: the EN label is
//      the same semantic value, only the display language differs.
//    • Pure + client-safe: no db, no React.
// ══════════════════════════════════════════════════════════════

import type { Locale } from './dictionary';
import { resolveSystemLabel } from './presentation';

/** [ar, en] label pair (the insights/hub house pattern). */
export type StoredLabelPair = readonly [string, string];

/**
 * Known LEGACY Arabic stored values (exact strings frozen in records)
 * → bilingual labels. Keys are the ARABIC legacy labels; the pair
 * carries both locales so 'ar' renders the familiar Arabic and 'en'
 * renders the professional English label.
 */
export const LEGACY_VALUE_LABELS: Readonly<Record<string, StoredLabelPair>> = {
  // ── Legacy observation category names (§MASTER-DATA-MIGRATION) ──
  'تأخر متابعة': ['تأخر متابعة', 'Follow-up Delay'],
  'تأخر المتابعة': ['تأخر المتابعة', 'Follow-up Delay'],
  'تأخير المتابعة': ['تأخير المتابعة', 'Follow-up Delay'],
  'أداء ممتاز': ['أداء ممتاز', 'Excellent Performance'],
  'معلومات غير صحيحة': ['معلومات غير صحيحة', 'Incorrect Information'],
  'فقدان عميل': ['فقدان عميل', 'Customer Loss'],
  'مساعدة الفريق': ['مساعدة الفريق', 'Team Support'],
  'تعافي سريع': ['تعافي سريع', 'Quick Recovery'],
  'مخالفة أمان': ['مخالفة أمان', 'Safety Violation'],
  'مشكلة حضور': ['مشكلة حضور', 'Attendance Issue'],
  'شكوى جودة عميل': ['شكوى جودة عميل', 'Customer Quality Complaint'],
  'تحسين عملية': ['تحسين عملية', 'Process Improvement'],
  'تأخير تجهيز الباكدج': ['تأخير تجهيز الباكدج', 'Package Preparation Delay'],
  'تأخير الرد على العميل': ['تأخير الرد على العميل', 'Delayed Customer Response'],
  'إهمال الديلات': ['إهمال الديلات', 'Deal Neglect'],
  'عدم التركيز': ['عدم التركيز', 'Lack of Focus'],
  'عدم تنفيذ التاسكات والتنبيهات': ['عدم تنفيذ التاسكات والتنبيهات', 'Tasks and Alerts Not Completed'],
  'عدم مساعدة الفريق': ['عدم مساعدة الفريق', 'Failure to Support the Team'],
  'أخطاء في التعامل مع الموردين': ['أخطاء في التعامل مع الموردين', 'Supplier Handling Errors'],
  'تجاهل العميل': ['تجاهل العميل', 'Ignoring the Customer'],

  // ── Legacy follow-up TYPE labels (the historical static list) ──
  'مشكلة جودة': ['مشكلة جودة', 'Quality Issue'],
  'مشكلة سلوك': ['مشكلة سلوك', 'Behavior Issue'],
  'مشكلة أداء': ['مشكلة أداء', 'Performance Issue'],
  'تدريب': ['تدريب', 'Training'],
  'توجيه': ['توجيه', 'Coaching'],
  'شكوى عميل': ['شكوى عميل', 'Customer Complaint'],
  'ملاحظة إيجابية': ['ملاحظة إيجابية', 'Positive Note'],
  'فرصة تحسين': ['فرصة تحسين', 'Improvement Opportunity'],
  'أخرى': ['أخرى', 'Other'],

  // ── Legacy STATUS labels (Arabic frozen in records) ──
  'مفتوحة': ['مفتوحة', 'Open'],
  'مفتوح': ['مفتوح', 'Open'],
  'مكتملة': ['مكتملة', 'Completed'],
  'مكتمل': ['مكتمل', 'Completed'],
  'متأخرة': ['متأخرة', 'Overdue'],
  'متأخر': ['متأخر', 'Overdue'],
  'مغلقة': ['مغلقة', 'Closed'],
  'مغلق': ['مغلق', 'Closed'],
  'تم الحل': ['تم الحل', 'Resolved'],
  'منجزة': ['منجزة', 'Completed'],
  'ملغي': ['ملغي', 'Cancelled'],
  'ملغاة': ['ملغاة', 'Cancelled'],
  'قيد المراجعة': ['قيد المراجعة', 'Under Review'],
  'قيد المتابعة': ['قيد المتابعة', 'Under Follow-up'],
  'قيد التحقيق': ['قيد التحقيق', 'Under Investigation'],
  'بانتظار الحل': ['بانتظار الحل', 'Pending Resolution'],
  'قيد الانتظار': ['قيد الانتظار', 'Pending'],
  'معتمدة': ['معتمدة', 'Approved'],
  'معلقة': ['معلقة', 'Pending'],
  'مرفوضة': ['مرفوضة', 'Rejected'],

  // ── Legacy priority/severity labels ──
  'منخفض': ['منخفض', 'Low'],
  'منخفضة': ['منخفضة', 'Low'],
  'متوسط': ['متوسط', 'Medium'],
  'متوسطة': ['متوسطة', 'Medium'],
  'عالي': ['عالي', 'High'],
  'عالية': ['عالية', 'High'],
  'حرج': ['حرج', 'Critical'],
  'حرجة': ['حرجة', 'Critical'],
  'عاجل': ['عاجل', 'Urgent'],
  'عاجلة': ['عاجلة', 'Urgent'],
};

const ARABIC = /[\u0600-\u06FF]/;

/**
 * Resolve ONE dynamic stored value to its locale label.
 * Returns null when the value is NOT a known semantic label — the
 * caller's signal to render the stored value verbatim (business data).
 */
export function resolveStoredLabel(
  value: string | null | undefined,
  locale: Locale,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // 1) System-owned enum/collection/rule key.
  const system = resolveSystemLabel(trimmed, locale);
  if (system !== null) return system;
  // 2) Known legacy alias (exact).
  const legacy = LEGACY_VALUE_LABELS[trimmed];
  if (legacy) return locale === 'en' ? legacy[1] : legacy[0];
  // 3) Unknown — business data; never guessed.
  return null;
}

/**
 * Resolve-or-verbatim: known semantic values localize; anything else
 * passes through UNCHANGED (user content stays the user's content).
 */
export function resolveStoredLabelOrVerbatim(
  value: string | null | undefined,
  locale: Locale,
): string {
  if (typeof value !== 'string') return '';
  return resolveStoredLabel(value, locale) ?? value;
}

/**
 * True when the value is a KNOWN semantic label (system enum or legacy
 * alias) — i.e. it SHOULD never render raw in English. Diagnostic
 * helper for the "no known enum renders raw in EN" guarantee.
 */
export function isKnownStoredLabel(value: string | null | undefined): boolean {
  return resolveStoredLabel(value, 'en') !== null;
}

/**
 * Development/test diagnostic: Arabic text that is NOT a known label
 * is business data (names, notes, sentences) and must render verbatim.
 * Never used to translate — only to assert the boundary in tests.
 */
export function isBusinessDataLike(value: string): boolean {
  return ARABIC.test(value) && !isKnownStoredLabel(value);
}
