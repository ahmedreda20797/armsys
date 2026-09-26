'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Reporting Period Control
//
//  THE explicit reporting period (§33): every period-sensitive
//  section carries this month label; the value is part of the cache
//  identity so switching months restores that month's cached
//  snapshot instantly and revalidates in the background.
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { CalendarDays, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatMonthKey } from '@/lib/i18n/format';

/** Shift a YYYY-MM key by ±n months (pure calendar arithmetic). */
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function PeriodBar({
  month,
  onChange,
  isFetching,
  freshness,
}: {
  month: string;
  onChange: (month: string) => void;
  isFetching: boolean;
  freshness?: React.ReactNode;
}) {
  const { locale } = useLanguage();

  const monthOptions = useMemo(() => {
    const out: string[] = [];
    // 24 months back from the selected month + 3 forward.
    for (let i = 24; i >= -3; i--) out.push(shiftMonth(month, -i));
    return out.reverse().slice().sort((a, b) => b.localeCompare(a));
  }, [month]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <CalendarDays className="size-4 text-brand-600 dark:text-brand-400" />
        <span className="text-xs font-medium text-muted-foreground"><T>فترة التقرير</T></span>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="previous month"
            onClick={() => onChange(shiftMonth(month, -1))}
          >
            {/* Time flows with reading direction: RTL → right is earlier. */}
            {locale === 'ar' ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
          <span className="min-w-32 text-center text-sm font-bold text-foreground" dir="ltr">
            {formatMonthKey(month, locale)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="next month"
            onClick={() => onChange(shiftMonth(month, 1))}
          >
            {locale === 'ar' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        </div>
        <Select value={month} onValueChange={onChange}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="select month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((m) => (
              <SelectItem key={m} value={m}>{formatMonthKey(m, locale)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFetching && (
          <span className="text-[11px] text-muted-foreground"><T>تحديث…</T></span>
        )}
      </div>
      {freshness}
    </div>
  );
}
