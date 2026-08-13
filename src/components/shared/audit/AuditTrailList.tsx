'use client';

import { ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { QualityAuditLogEntry, QualityAuditEntityType } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  AuditTrailList — shared queryable audit trail display
//
//  Presentation-only. Renders a flat list of QualityAuditLogEntry
//  rows (the global, queryable trail) with localized entity/action
//  labels. Used by the Quality audit-log page. No audit entries are
//  created, filtered by business rules, or paginated here — that is
//  the responsibility of the calling page / API.
// ─────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<QualityAuditEntityType, string> = {
  observation: 'ملاحظة',
  month: 'شهر',
  category: 'تصنيف',
  template: 'قالب',
  settings: 'إعدادات',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  approve: 'اعتماد',
  reject: 'رفض',
  override: 'تجاوز',
  reopen: 'إعادة فتح',
  close: 'إغلاق',
  submit: 'إرسال',
  status_change: 'تغيير الحالة',
  points_change: 'تغيير النقاط',
  month_closed: 'إغلاق الشهر',
  month_reopened: 'إعادة فتح الشهر',
};

const ACTION_TONE: Record<string, string> = {
  create: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  approve: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  delete: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  reject: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  override: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  reopen: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  month_reopened: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  close: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
  month_closed: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-EG', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

interface AuditTrailListProps {
  entries: QualityAuditLogEntry[];
  emptyLabel?: string;
  className?: string;
}

export function AuditTrailList({
  entries,
  emptyLabel = 'لا توجد سجلات',
  className,
}: AuditTrailListProps) {
  if (!entries || entries.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-10 text-center', className)}>
        <ScrollText className="size-8 text-slate-600 mb-2" />
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <ul className={cn('space-y-2', className)} dir="rtl">
      {entries.map((e) => {
        const actionLabel = ACTION_LABELS[e.action] ?? e.action;
        const entityLabel = ENTITY_LABELS[e.entityType] ?? e.entityType;
        const tone = ACTION_TONE[e.action] ?? 'bg-slate-500/10 text-slate-300 border-slate-500/20';
        return (
          <li
            key={e.id}
            className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={tone}>{actionLabel}</Badge>
              <Badge variant="outline" className="bg-slate-700/30 text-slate-300">{entityLabel}</Badge>
              {e.monthKey && (
                <span className="text-[11px] text-slate-500 tabular-nums">{e.monthKey}</span>
              )}
            </div>
            {(e.details || e.reason) && (
              <p className="mt-1.5 text-xs text-slate-300">{e.details || e.reason}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
              {e.actorName && <span>{e.actorName}</span>}
              {e.actorName && <span>·</span>}
              <span className="tabular-nums">{formatTimestamp(e.timestamp)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default AuditTrailList;
