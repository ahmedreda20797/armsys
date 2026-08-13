'use client';

import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { KpiRangePreset } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  RangeSelector — shared KPI date-range picker
//
//  Presentation-only. Owns no data; just reports the user's choice
//  upward via callbacks. Supports the six canonical presets and a
//  "custom" mode that collects a list of YYYY-MM month keys.
//
//  The custom month list is exchanged as a comma-joined string so it
//  maps directly onto the existing dashboard query-string convention
//  (customMonths=2026-07,2026-08) — no new API contract required.
// ─────────────────────────────────────────────────────────────

const RANGE_OPTIONS: { value: KpiRangePreset; label: string }[] = [
  { value: 'current_month', label: 'الشهر الحالي' },
  { value: 'previous_month', label: 'الشهر السابق' },
  { value: 'last_3_months', label: 'آخر 3 أشهر' },
  { value: 'last_6_months', label: 'آخر 6 أشهر' },
  { value: 'current_year', label: 'السنة الحالية' },
  { value: 'custom', label: 'مخصص' },
];

interface RangeSelectorProps {
  /** Currently selected preset. */
  value: KpiRangePreset;
  /** Called when the user picks a different preset. */
  onValueChange: (value: KpiRangePreset) => void;
  /** Comma-joined YYYY-MM keys (only relevant when value === 'custom'). */
  customMonths?: string;
  /** Called with the updated comma-joined key list. */
  onCustomMonthsChange?: (value: string) => void;
  className?: string;
}

function parseMonths(joined: string | undefined): string[] {
  if (!joined) return [];
  return joined
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

export function RangeSelector({
  value,
  onValueChange,
  customMonths,
  onCustomMonthsChange,
  className,
}: RangeSelectorProps) {
  const selected = parseMonths(customMonths);

  function addMonth(month: string) {
    if (!month) return;
    const next = selected.includes(month) ? selected : [...selected, month];
    onCustomMonthsChange?.(next.join(','));
  }

  function removeMonth(month: string) {
    onCustomMonthsChange?.(selected.filter((m) => m !== month).join(','));
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Select value={value} onValueChange={(v) => onValueChange(v as KpiRangePreset)}>
        <SelectTrigger className="w-44 bg-slate-800/50 border-slate-700">
          <Calendar className="size-3.5 text-slate-400 me-2" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value === 'custom' && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-700/40 bg-slate-800/30 p-2.5">
          <div className="flex items-center gap-2">
            <Input
              type="month"
              className="bg-slate-800/50 border-slate-700 h-9 w-40"
              onChange={(e) => {
                if (e.target.value) addMonth(e.target.value);
                e.target.value = '';
              }}
            />
            <span className="text-[11px] text-slate-500">أضف شهراً</span>
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-[11px] text-slate-200 tabular-nums"
                >
                  {m}
                  <button
                    type="button"
                    onClick={() => removeMonth(m)}
                    className="text-slate-400 hover:text-rose-400"
                    aria-label={`إزالة ${m}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          {selected.length === 0 && (
            <p className="text-[11px] text-slate-500">لم يتم اختيار أشهر بعد</p>
          )}
        </div>
      )}
    </div>
  );
}

export default RangeSelector;
