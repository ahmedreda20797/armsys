'use client';

// ══════════════════════════════════════════════════════════════
//  Page period indicator — Milestone 7 §10/§26
//
//  ONE shared presentation for the rule "the active period must be
//  VISIBLE on the page — never only inside a collapsed filter panel":
//
//    [📅 الفترة المعروضة: سبتمبر 2026]   [عرض كل الفترات ×]
//
//  The badge names the active period in Arabic; clicking it opens
//  the page's filter control (onOpenFilters). When a period filter
//  is active, a "عرض الكل" chip lets the user widen the view in one
//  click. Pure presentation — the page owns the state.
// ══════════════════════════════════════════════════════════════

import { CalendarDays, X } from 'lucide-react';

export interface PagePeriodIndicatorProps {
  /** Arabic label of the ACTIVE period, e.g. "سبتمبر 2026" or "اليوم 05/09/2026". */
  label: string;
  /** True when a period filter narrows the view (hides the widen chip when false). */
  filtered: boolean;
  /** Opens the page's period/filter control. */
  onOpenFilters?: () => void;
  /** Widens the view to all periods (clears the period filter). */
  onShowAll?: () => void;
  /** Test id hooks for the regression suite. */
  testId?: string;
}

export function PagePeriodIndicator({
  label,
  filtered,
  onOpenFilters,
  onShowAll,
  testId,
}: PagePeriodIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        data-testid={testId}
        onClick={onOpenFilters}
        title="الفترة المعروضة — اضغط لتغييرها"
        className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/15 transition-colors"
      >
        <CalendarDays className="size-3.5" />
        الفترة المعروضة: {label}
      </button>
      {filtered && onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          title="إلغاء تصفية الفترة وعرض كل السجلات"
          className="flex items-center gap-1 rounded-full border border-slate-600/50 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors"
        >
          <X className="size-3" />
          عرض الكل
        </button>
      )}
    </span>
  );
}
