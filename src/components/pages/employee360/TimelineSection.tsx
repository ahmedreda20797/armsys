'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Professional Timeline (rebuild)
//
//  A clean chronological journal of operational events (each gated
//  server-side by its owning section). Raw audit-log dumps are not
//  part of the profile — the timeline carries concise, typed events
//  with dates and status.
// ══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { ChevronDown, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { T } from '@/lib/i18n/T';
import { SectionShell, EmptyState } from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

const EVENT_DOT: Record<string, string> = {
  followUp: 'bg-brand-500',
  quality: 'bg-orange-500',
  hrDeduction: 'bg-pink-500',
  request: 'bg-sky-500',
  complaint: 'bg-red-500',
  travel: 'bg-cyan-500',
  capa: 'bg-teal-500',
};

const EVENT_STATUS_LABELS: Record<string, string> = {
  present: 'حاضر', late: 'متأخر', absent: 'غائب',
  approved: 'مقبول', rejected: 'مرفوض', pending: 'معلق',
  open: 'مفتوح', completed: 'مكتمل', deduction: 'خصم',
  created: 'إنشاء', closed: 'مغلق', verified: 'تم التحقق',
  reopened: 'معاد فتحه', resolved: 'تمت', cancelled: 'ملغاة',
};

const PAGE_SIZE = 15;

export function TimelineSection({ events, periodLabel }: {
  events: Employee360Data['timeline'];
  periodLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events.slice(0, 60) : events.slice(0, PAGE_SIZE);

  return (
    <SectionShell title={<T>السجل الزمني</T>} icon={<History className="size-4 text-brand-500" />} periodLabel={periodLabel}>
      {events.length === 0 ? (
        <EmptyState text={<T>لا أحداث مسجلة</T>} />
      ) : (
        <div className="relative">
          <div className="absolute bottom-2 top-2 w-px bg-border/60 start-[7px]" aria-hidden />
          <ol className="space-y-3">
            {visible.map((event, i) => (
              <li key={`${event.type}-${event.timestamp ?? ''}-${i}`} className="relative flex items-start gap-3 ps-1">
                <span className={`relative z-10 mt-1.5 size-3.5 shrink-0 rounded-full border-2 border-card ${EVENT_DOT[event.type] ?? 'bg-slate-400'}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{event.title}</p>
                    {event.priority && (
                      <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[9px] text-muted-foreground">
                        {event.priority}
                      </Badge>
                    )}
                    {event.status && (
                      <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[9px] text-muted-foreground">
                        {EVENT_STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                    )}
                  </div>
                  {event.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{event.description}</p>
                  )}
                  {event.user && <p className="text-[10px] text-muted-foreground/70">{event.user}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground" dir="ltr">{event.date}</span>
              </li>
            ))}
          </ol>
          {events.length > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 flex w-full items-center justify-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded
                ? <T>عرض أقل</T>
                : <><T>عرض المزيد</T> ({events.length - PAGE_SIZE})</>}
            </button>
          )}
        </div>
      )}
    </SectionShell>
  );
}
