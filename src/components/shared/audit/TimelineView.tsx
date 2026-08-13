'use client';

import { CheckCircle2, XCircle, Clock, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelinePoint, TimelineTone } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  TimelineView — shared chronological history display
//
//  Presentation-only consumer of the pure lib buildTimeline() output.
//  Accepts TimelinePoint[] (already derived by the lib layer from a
//  record's audit + approval histories) and renders them newest-first
//  with tone-coded icons. The component NEVER reconstructs business
//  history itself — it only displays the points it is given.
// ─────────────────────────────────────────────────────────────

const TONE_STYLE: Record<TimelineTone, { icon: typeof CheckCircle2; accent: string; dot: string }> = {
  positive: { icon: CheckCircle2, accent: 'text-emerald-400', dot: 'bg-emerald-500' },
  negative: { icon: XCircle, accent: 'text-rose-400', dot: 'bg-rose-500' },
  pending: { icon: Clock, accent: 'text-amber-400', dot: 'bg-amber-500' },
  neutral: { icon: History, accent: 'text-slate-300', dot: 'bg-slate-500' },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-EG', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

interface TimelineViewProps {
  points: TimelinePoint[];
  emptyLabel?: string;
  className?: string;
}

export function TimelineView({
  points,
  emptyLabel = 'لا يوجد سجل أحداث',
  className,
}: TimelineViewProps) {
  if (!points || points.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-6 text-center', className)}>
        <History className="size-7 text-slate-600 mb-2" />
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  // Defensive newest-first sort (buildTimeline already returns newest-first).
  const ordered = [...points].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <ol className={cn('relative space-y-4 ps-4', className)} dir="rtl">
      <span className="absolute top-1 bottom-1 end-[5px] w-px bg-slate-700/60" aria-hidden />
      {ordered.map((p) => {
        const style = TONE_STYLE[p.tone] ?? TONE_STYLE.neutral;
        const Icon = style.icon;
        return (
          <li key={p.key} className="relative">
            <span
              className={cn(
                'absolute top-1 end-0 size-2.5 rounded-full ring-2 ring-slate-900 translate-x-[3px]',
                style.dot,
              )}
              aria-hidden
            />
            <div className="flex items-center gap-2">
              <Icon className={cn('size-4 shrink-0', style.accent)} />
              <p className="text-sm font-medium text-slate-100">{p.label}</p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
              {p.actorName && <span>{p.actorName}</span>}
              {p.actorName && <span>·</span>}
              <span className="tabular-nums">{formatTimestamp(p.timestamp)}</span>
            </div>
            {p.details && (
              <p className="mt-1 text-xs text-slate-300 bg-slate-800/40 rounded-md px-2 py-1 border border-slate-700/40">
                {p.details}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default TimelineView;
