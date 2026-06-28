// src/lib/capa-helpers.ts
// Shared CAPA helper functions — extracted from CAPAPage for reuse

import type { CAPACase } from '@/types';
import {
  SLA_DAYS, WORKFLOW_STAGES, CATEGORY_LABELS, ROOT_CAUSE_LABELS, SOURCE_LABELS,
} from './capa-constants';
import {
  FolderOpen, Search, Brain, Wrench, Shield, ClipboardList,
  CheckCircle2, X, RefreshCw, CircleDot,
} from 'lucide-react';

// ═══════════════════════════════════════════════════
//  Badge Configuration Helpers
// ═══════════════════════════════════════════════════

export function getStatusConfig(status: string) {
  const map: Record<string, { label: string; color: string; icon: any }> = {
    open: { label: 'مفتوح', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: FolderOpen },
    investigation: { label: 'تحقيق', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', icon: Search },
    root_cause_analysis: { label: 'تحليل السبب', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Brain },
    corrective_action: { label: 'إجراء تصحيحي', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30', icon: Wrench },
    preventive_action: { label: 'إجراء وقائي', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30', icon: Shield },
    verification: { label: 'التحقق', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30', icon: ClipboardList },
    closed: { label: 'مغلقة', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30', icon: CheckCircle2 },
    rejected: { label: 'مرفوضة', color: 'bg-red-500/15 text-red-400 border-red-500/30', icon: X },
    reopened: { label: 'أُعيد فتحها', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30', icon: RefreshCw },
  };
  return map[status] || { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', icon: CircleDot };
}

export function getPriorityConfig(priority: string) {
  const map: Record<string, { label: string; color: string }> = {
    critical: { label: 'حرج', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
    high: { label: 'عالي', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    medium: { label: 'متوسط', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
    low: { label: 'منخفض', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
  };
  return map[priority] || { label: priority, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

export function getActionStatusConfig(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    not_started: { label: 'لم يبدأ', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
    in_progress: { label: 'قيد التنفيذ', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    completed: { label: 'مكتمل', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  };
  return map[status] || { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

// ═══════════════════════════════════════════════════
//  Date & Formatting Helpers
// ═══════════════════════════════════════════════════

export function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function truncate(str: string, max: number): string {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// ═══════════════════════════════════════════════════
//  SLA & Overdue Helpers
// ═══════════════════════════════════════════════════

export function isOverdue(capa: CAPACase): boolean {
  if (capa.status === 'closed' || capa.status === 'rejected') return false;
  const sla = capa.slaDays || SLA_DAYS[capa.priority] || 7;
  const created = new Date(capa.createdAt).getTime();
  const due = created + sla * 86400000;
  return Date.now() > due;
}

export function getStageIndex(status: string): number {
  return WORKFLOW_STAGES.findIndex((s) => s.key === status);
}

export interface SLAInfo {
  daysRemaining: number;
  isOverdue: boolean;
  overdueDays: number;
  state: 'normal' | 'warning' | 'critical' | 'escalation' | 'closed';
  slaDays: number;
}

export function getSLAInfo(capa: CAPACase): SLAInfo {
  if (capa.status === 'closed' || capa.status === 'rejected') {
    return { daysRemaining: 0, isOverdue: false, overdueDays: 0, state: 'closed', slaDays: capa.slaDays || 7 };
  }
  const slaDays = capa.slaDays || SLA_DAYS[capa.priority] || 7;
  const created = new Date(capa.createdAt).getTime();
  const due = created + slaDays * 86400000;
  const now = Date.now();
  const daysRemaining = Math.max(0, Math.ceil((due - now) / 86400000));
  const overdueDays = Math.max(0, Math.floor((now - due) / 86400000));
  const isOverdue = now > due;

  let state: SLAInfo['state'] = 'normal';
  if (isOverdue && overdueDays >= 2) state = 'escalation';
  else if (isOverdue) state = 'critical';
  else if (daysRemaining <= 1) state = 'warning';

  return { daysRemaining, isOverdue, overdueDays, state, slaDays };
}

// ═══════════════════════════════════════════════════
//  Smart Progress System — Section-based completion
// ═══════════════════════════════════════════════════

export interface ProgressStep {
  key: string;
  label: string;
  completed: boolean;
}

export function getProgressSteps(capa: CAPACase): ProgressStep[] {
  return [
    { key: 'problem_defined', label: 'تحديد المشكلة', completed: !!(capa.title && capa.problemDescription) },
    { key: 'investigation_complete', label: 'اكتمال التحقيق', completed: !!(capa.rootCauseDescription || capa.rootCauseCategory) },
    { key: 'root_cause_identified', label: 'تحديد السبب الجذري', completed: !!(capa.rootCauseCategory && capa.rootCauseDescription) },
    { key: 'corrective_assigned', label: 'تعيين الإجراء التصحيحي', completed: !!(capa.correctiveAction && capa.correctiveAssignedTo) },
    { key: 'preventive_assigned', label: 'تعيين الإجراء الوقائي', completed: !!(capa.preventiveAction && capa.preventiveAssignedTo) },
    { key: 'verification_complete', label: 'اكتمال التحقق', completed: !!(capa.verificationResult) },
    { key: 'closure_complete', label: 'اكتمال الإغلاق', completed: capa.status === 'closed' },
  ];
}

export function calculateProgress(capa: CAPACase): number {
  const steps = getProgressSteps(capa);
  const completed = steps.filter((s) => s.completed).length;
  return Math.round((completed / steps.length) * 100);
}

// ═══════════════════════════════════════════════════
//  Label Lookups
// ═══════════════════════════════════════════════════

export { CATEGORY_LABELS, ROOT_CAUSE_LABELS, SOURCE_LABELS };