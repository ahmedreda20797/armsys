'use client';

// ══════════════════════════════════════════════════════════════
//  CAPADetailPanel — compact inline CAPA viewer for the Risk Center
//
//  Reuses the existing CAPACase data shape (no parallel type) and the
//  existing severity/status vocabulary (no parallel taxonomy). Designed
//  for embedding INSIDE other pages — Risk Center, Follow-Ups — so the
//  user never has to navigate away to view CAPA details.
// ══════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import {
  FileText, Loader2, X, ExternalLink, Calendar, User, AlertTriangle,
  CheckCircle2, ArrowRight,
} from 'lucide-react';
import { authFetch } from '@/lib/api-fetch';
import { formatDate } from '@/lib/capa-helpers';

interface CAPADetailPanelProps {
  capaId: string;
  onBack?: () => void;
  onFullPage?: () => void;
}

const PRIORITY_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'حرج', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  high: { label: 'عالي', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  medium: { label: 'متوسط', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  low: { label: 'منخفض', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: 'مفتوح', color: 'text-blue-400' },
  in_progress: { label: 'قيد التنفيذ', color: 'text-violet-400' },
  under_review: { label: 'قيد المراجعة', color: 'text-purple-400' },
  pending_verification: { label: 'بانتظار التحقق', color: 'text-amber-400' },
  resolved: { label: 'تم الحل', color: 'text-emerald-400' },
  closed: { label: 'مغلق', color: 'text-slate-500' },
  overdue: { label: 'متأخر', color: 'text-red-400' },
};

export function CAPADetailPanel({ capaId, onBack, onFullPage }: CAPADetailPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['capa-case', capaId],
    queryFn: () => authFetch(`/api/capa-cases/${capaId}`).then((r) => r.ok ? r.json() : null),
    staleTime: 5_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 gap-2 text-slate-500 text-[10px]">
        <Loader2 className="size-3 animate-spin" />
        جاري التحميل...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center py-6 text-[10px] text-slate-500">
        تعذّر تحميل الحالة
      </div>
    );
  }

  const priority = PRIORITY_META[data.priority] ?? PRIORITY_META.medium;
  const status = STATUS_META[data.status] ?? STATUS_META.open;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="space-y-2"
      dir="rtl"
    >
      <div className="flex items-center justify-between gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="text-[10px] text-slate-500 hover:text-white flex items-center gap-1"
          >
            <ArrowRight className="size-3" />
            العودة للقائمة
          </button>
        )}
        {onFullPage && (
          <button
            onClick={onFullPage}
            className="text-[10px] text-violet-300 hover:text-violet-200 flex items-center gap-1"
          >
            فتح الصفحة الكاملة
            <ExternalLink className="size-3" />
          </button>
        )}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-white text-[12px] font-semibold truncate">{data.title || '(بدون عنوان)'}</p>
          {data.problemDescription && (
            <p className="text-slate-500 text-[10px] mt-1 line-clamp-2 leading-relaxed">{data.problemDescription}</p>
          )}
        </div>
        <div className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${priority.bg} ${priority.color} ${priority.border}`}>
          <AlertTriangle className="size-3" />
          {priority.label}
        </div>
      </div>

      {/* Status + meta row */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          <span className={status.color}>{status.label}</span>
        </span>
        {data.department && (
          <span className="inline-flex items-center gap-1">
            <FileText className="size-3" />
            {data.department}
          </span>
        )}
        {data.assignedToName && (
          <span className="inline-flex items-center gap-1">
            <User className="size-3" />
            {data.assignedToName}
          </span>
        )}
        {data.dueDate && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3" />
            {formatDate(data.dueDate)}
          </span>
        )}
      </div>

      {/* Description block (full) */}
      {data.problemDescription && (
        <div className="rounded-md bg-slate-900/40 p-2 border border-slate-700/30">
          <p className="text-[9px] font-bold text-slate-500 mb-1">وصف المشكلة</p>
          <p className="text-slate-300 text-[11px] leading-relaxed">{data.problemDescription}</p>
        </div>
      )}

      {/* Actions / root cause if available */}
      {(data.rootCause || data.actionPlan) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.rootCause && (
            <div className="rounded-md bg-slate-900/40 p-2 border border-slate-700/30">
              <p className="text-[9px] font-bold text-slate-500 mb-1">السبب الجذري</p>
              <p className="text-slate-300 text-[11px] leading-relaxed">{data.rootCause}</p>
            </div>
          )}
          {data.actionPlan && (
            <div className="rounded-md bg-slate-900/40 p-2 border border-slate-700/30">
              <p className="text-[9px] font-bold text-slate-500 mb-1">خطة الإجراء</p>
              <p className="text-slate-300 text-[11px] leading-relaxed">{data.actionPlan}</p>
            </div>
          )}
        </div>
      )}

      {/* Verification */}
      {data.verificationResult && (
        <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-2">
          <p className="text-[9px] font-bold text-emerald-400 mb-1">نتيجة التحقق</p>
          <p className="text-emerald-200 text-[11px]">{data.verificationResult}</p>
        </div>
      )}

      {/* Progress if any */}
      {typeof data.progress === 'number' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">التقدم</span>
            <span className="text-slate-300 font-mono">{Math.round(data.progress)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
            <div className="h-full bg-linear-to-l from-violet-500 to-emerald-500 transition-all" style={{ width: `${Math.min(100, data.progress)}%` }} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
