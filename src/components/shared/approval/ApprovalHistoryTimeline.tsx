'use client';

import {
  CheckCircle2, XCircle, Edit3, Send, RotateCcw, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApprovalEvent } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  ApprovalHistoryTimeline — shared append-only approval display
//
//  Presentation-only. Renders an ApprovalEvent[] newest-first with
//  tone-coded icons, actor, timestamp, notes, and override magnitude
//  (pointsBefore → pointsAfter) when present. No approval state is
//  computed or mutated here — the events are the source of truth and
//  arrive already written by the backend approval routes.
// ─────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  submit: 'إرسال للاعتماد',
  approve: 'موافقة',
  reject: 'رفض',
  override: 'تجاوز النقاط',
  reopen: 'إعادة فتح',
};

const ACTION_STYLE: Record<string, { icon: typeof CheckCircle2; accent: string; dot: string }> = {
  submit: { icon: Send, accent: 'text-slate-300', dot: 'bg-slate-500' },
  approve: { icon: CheckCircle2, accent: 'text-emerald-400', dot: 'bg-emerald-500' },
  reject: { icon: XCircle, accent: 'text-rose-400', dot: 'bg-rose-500' },
  override: { icon: Edit3, accent: 'text-amber-400', dot: 'bg-amber-500' },
  reopen: { icon: RotateCcw, accent: 'text-blue-400', dot: 'bg-blue-500' },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-EG', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

interface ApprovalHistoryTimelineProps {
  events: ApprovalEvent[];
  emptyLabel?: string;
  className?: string;
}

export function ApprovalHistoryTimeline({
  events,
  emptyLabel = 'لا يوجد سجل اعتماد بعد',
  className,
}: ApprovalHistoryTimelineProps) {
  if (!events || events.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-6 text-center', className)}>
        <History className="size-7 text-slate-600 mb-2" />
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  // Newest-first (events are append-only; sort defensively without mutating).
  const ordered = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <ol className={cn('space-y-4', className)} dir="rtl">
      {ordered.map((ev, i) => {
        const style = ACTION_STYLE[ev.action] ?? ACTION_STYLE.submit;
        const Icon = style.icon;
        const label = ACTION_LABELS[ev.action] ?? ev.action;
        return (
          <li
            key={`${ev.timestamp}-${i}`}
            // Per-event layout: dot marker → flexible horizontal connector →
            // content. Pure flex (no absolute positioning, no fixed pixel
            // widths) so the connector stretches with the available dialog
            // width and never overflows on narrow screens.
            className="flex items-start gap-2.5"
          >
            {/* Event dot — shrinks never, aligns with the header line */}
            <span
              className={cn(
                'mt-1 size-2.5 shrink-0 rounded-full ring-2 ring-slate-900',
                style.dot,
              )}
              aria-hidden
            />
            {/* Content column — takes remaining width, wraps safely */}
            <div className="min-w-0 flex-1">
              {/* Header row: icon + label + flexible connector line */}
              <div className="flex items-center gap-2">
                <Icon className={cn('size-4 shrink-0', style.accent)} />
                <p className="shrink-0 text-sm font-medium text-slate-100">{label}</p>
                {/* Horizontal connector — flexes to fill the remaining width */}
                <span className="h-px min-w-4 flex-1 bg-slate-700/60" aria-hidden />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                {ev.actorName && <span>{ev.actorName}</span>}
                <span>·</span>
                <span className="tabular-nums">{formatTimestamp(ev.timestamp)}</span>
              </div>
              {ev.notes && (
                <p className="mt-1 text-xs text-slate-300 bg-slate-800/40 rounded-md px-2 py-1 border border-slate-700/40 break-words">
                  {ev.notes}
                </p>
              )}
              {ev.action === 'override' && ev.pointsBefore !== undefined && ev.pointsAfter !== undefined && (
                <p className="mt-1 text-[11px] text-amber-400 tabular-nums">
                  النقاط: {ev.pointsBefore} ← {ev.pointsAfter}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default ApprovalHistoryTimeline;
