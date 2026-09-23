'use client';

import {
  CheckCircle2, XCircle, Edit3, Send, RotateCcw, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatDateTime as localeDateTime, formatNumber, displayLocale } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/dictionary';
import type { ApprovalEvent } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  ApprovalHistoryTimeline — shared append-only approval display
//
//  Presentation-only. Renders an ApprovalEvent[] newest-first with
//  tone-coded icons, actor, timestamp, notes, and override magnitude
//  (pointsBefore → pointsAfter) when present. No approval state is
//  computed or mutated here — the events are the source of truth and
//  arrive already written by the backend approval routes.
//
//  §I18N-BOUNDARY: only the TIMELINE CHROME is claimed UI (action
//  labels derived from the system event enum, empty-state label, the
//  static «النقاط:» fragment). Actor names, notes and raw fallback
//  action codes are data — rendered raw.
// ─────────────────────────────────────────────────────────────

/** [ar, en] — system approval-event enum vocabulary (never user data). */
const ACTION_LABELS: Record<string, [string, string]> = {
  submit: ['إرسال للاعتماد', 'Submitted for approval'],
  approve: ['موافقة', 'Approved'],
  reject: ['رفض', 'Rejected'],
  override: ['تجاوز النقاط', 'Points override'],
  reopen: ['إعادة فتح', 'Reopened'],
};

const ACTION_STYLE: Record<string, { icon: typeof CheckCircle2; accent: string; dot: string }> = {
  submit: { icon: Send, accent: 'text-slate-300', dot: 'bg-slate-500' },
  approve: { icon: CheckCircle2, accent: 'text-emerald-400', dot: 'bg-emerald-500' },
  reject: { icon: XCircle, accent: 'text-rose-400', dot: 'bg-rose-500' },
  override: { icon: Edit3, accent: 'text-amber-400', dot: 'bg-amber-500' },
  reopen: { icon: RotateCcw, accent: 'text-blue-400', dot: 'bg-blue-500' },
};

function formatTimestamp(iso: string, locale: Locale = displayLocale()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return localeDateTime(d, locale, {
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
  const { locale } = useLanguage();
  if (!events || events.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-6 text-center', className)}>
        <History className="size-7 text-slate-600 mb-2" />
        <p className="text-xs text-slate-500">{translateUIText(emptyLabel, locale)}</p>
      </div>
    );
  }

  // Newest-first (events are append-only; sort defensively without mutating).
  const ordered = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <ol className={cn('space-y-4', className)}>
      {ordered.map((ev, i) => {
        const style = ACTION_STYLE[ev.action] ?? ACTION_STYLE.submit;
        const Icon = style.icon;
        const labelEntry = ACTION_LABELS[ev.action];
        const label = labelEntry ? (locale === 'en' ? labelEntry[1] : labelEntry[0]) : ev.action;
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
                <span className="tabular-nums">{formatTimestamp(ev.timestamp, locale)}</span>
              </div>
              {ev.notes && (
                <p className="mt-1 text-xs text-slate-300 bg-slate-800/40 rounded-md px-2 py-1 border border-slate-700/40 break-words">
                  {ev.notes}
                </p>
              )}
              {ev.action === 'override' && ev.pointsBefore !== undefined && ev.pointsAfter !== undefined && (
                <p className="mt-1 text-[11px] text-amber-400 tabular-nums">
                  <T>النقاط: </T>{formatNumber(ev.pointsBefore, { locale })} ← {formatNumber(ev.pointsAfter, { locale })}
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
