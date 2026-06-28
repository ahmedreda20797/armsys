// src/lib/capa-constants.ts
// Shared CAPA constants — extracted from CAPAPage for reuse across modules

import {
  ShieldCheck, Search, X, Trash2, CalendarDays, Users,
  CheckCircle2, AlertTriangle, Clock, Eye, BarChart3,
  UserCheck, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText,
  Target, Zap, TrendingUp, ArrowRight, BookOpen, Brain,
  ClipboardList, FolderOpen, AlertOctagon, CircleDot, Flame,
  Wrench, Shield, RefreshCw, History, Lightbulb, ArrowDownUp, Download,
} from 'lucide-react';

export const STATUS_OPTIONS = [
  { value: 'open', label: 'مفتوح' },
  { value: 'investigation', label: 'تحقيق' },
  { value: 'root_cause_analysis', label: 'تحليل السبب الجذري' },
  { value: 'corrective_action', label: 'الإجراء التصحيحي' },
  { value: 'preventive_action', label: 'الإجراء الوقائي' },
  { value: 'verification', label: 'التحقق' },
  { value: 'closed', label: 'مغلقة' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'reopened', label: 'أُعيد فتحها' },
];

export const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'حرج' },
  { value: 'high', label: 'عالي' },
  { value: 'medium', label: 'متوسط' },
  { value: 'low', label: 'منخفض' },
];

export const ISSUE_CATEGORIES = [
  { value: 'quality_issue', label: 'مشكلة جودة' },
  { value: 'attendance_issue', label: 'مشكلة حضور' },
  { value: 'behavior_issue', label: 'مشكلة سلوك' },
  { value: 'training_issue', label: 'مشكلة تدريب' },
  { value: 'customer_complaint', label: 'شكوى عميل' },
  { value: 'process_failure', label: 'فشل عملية' },
  { value: 'system_error', label: 'خطأ نظام' },
  { value: 'sales_error', label: 'خطأ مبيعات' },
  { value: 'operations_error', label: 'خطأ تشغيلي' },
  { value: 'other', label: 'أخرى' },
];

export const ROOT_CAUSE_CATEGORIES = [
  { value: 'lack_of_training', label: 'نقص تدريب' },
  { value: 'human_error', label: 'خطأ بشري' },
  { value: 'poor_process', label: 'عملية ضعيفة' },
  { value: 'missing_procedure', label: 'إجراء مفقود' },
  { value: 'communication_failure', label: 'فشل تواصل' },
  { value: 'system_limitation', label: 'قيود النظام' },
  { value: 'workload', label: 'ضغط عمل' },
  { value: 'management_issue', label: 'مشكلة إدارية' },
  { value: 'other', label: 'أخرى' },
];

export const ACTION_STATUS_OPTIONS = [
  { value: 'not_started', label: 'لم يبدأ' },
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'completed', label: 'مكتمل' },
];

export const VERIFICATION_RESULTS = [
  { value: 'effective', label: 'فعّال' },
  { value: 'partially_effective', label: 'فعّال جزئياً' },
  { value: 'not_effective', label: 'غير فعّال' },
];

export const WORKFLOW_STAGES = [
  { key: 'open', label: 'مفتوح', icon: FolderOpen },
  { key: 'investigation', label: 'تحقيق', icon: Search },
  { key: 'root_cause_analysis', label: 'تحليل السبب', icon: Brain },
  { key: 'corrective_action', label: 'إجراء تصحيحي', icon: Wrench },
  { key: 'preventive_action', label: 'إجراء وقائي', icon: Shield },
  { key: 'verification', label: 'التحقق', icon: ClipboardList },
  { key: 'closed', label: 'مغلقة', icon: CheckCircle2 },
];

export const SLA_DAYS: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c.value, c.label]));
export const ROOT_CAUSE_LABELS: Record<string, string> = Object.fromEntries(ROOT_CAUSE_CATEGORIES.map((c) => [c.value, c.label]));

export const SOURCE_OPTIONS = [
  { value: 'manual', label: 'يدوي' },
  { value: 'audit', label: 'تدقيق' },
  { value: 'complaint', label: 'شكوى' },
  { value: 'mistake_pattern', label: 'نمط أخطاء' },
  { value: 'management_review', label: 'مراجعة إدارية' },
  { value: 'employee_feedback', label: 'ملاحظات موظف' },
  { value: 'automation', label: 'أتمتة' },
];

export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(SOURCE_OPTIONS.map((c) => [c.value, c.label]));

export const DEPARTMENTS = ['الإدارة', 'المبيعات', 'التشغيل', 'الموارد البشرية', 'المالية', 'تقنية المعلومات', 'الجودة', 'خدمة العملاء'];

// Detail page section definitions
export const CAPA_DETAIL_SECTIONS = [
  { key: 'overview', label: 'نظرة عامة', icon: Eye },
  { key: 'investigation', label: 'التحقيق', icon: Search },
  { key: 'root_cause', label: 'تحليل السبب الجذري', icon: Brain },
  { key: 'corrective', label: 'الإجراء التصحيحي', icon: Wrench },
  { key: 'preventive', label: 'الإجراء الوقائي', icon: Shield },
  { key: 'verification', label: 'التحقق', icon: ClipboardList },
  { key: 'timeline', label: 'الجدول الزمني', icon: History },
  { key: 'attachments', label: 'المرفقات', icon: FileText },
  { key: 'linked_records', label: 'السجلات المرتبطة', icon: ArrowRight },
  { key: 'activity_log', label: 'سجل الأنشطة', icon: BarChart3 },
] as const;

export type CAPASectionKey = typeof CAPA_DETAIL_SECTIONS[number]['key'];