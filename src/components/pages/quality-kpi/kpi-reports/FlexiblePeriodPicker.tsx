'use client';

// ══════════════════════════════════════════════════════════════
//  FlexiblePeriodPicker — §FLEX-PERIODS period selection UI
//
//  The ONE period selector generalized for KPI Reports (day / week /
//  month / quarter / six months / year / custom range) plus an
//  INDEPENDENT comparison period (default: the preceding equal-
//  length span).
//
//  §CONSISTENCY CONTRACT (fixed after review):
//    • Choosing an explicit comparison KIND derives a spec OF THAT
//      KIND (deriveComparisonSpec) — the selected kind is never
//      silently replaced.
//    • Week defaults snap to the Saturday anchor (weekStartOf) — the
//      ONE documented week convention.
//    • Custom-range defaults span the FULL anchor month (1st → last
//      day), never an arbitrary day like -28.
//    • Every control is h-9 / text-xs — one visual rhythm with the
//      rest of the control bar.
//
//  Values are FlexiblePeriodSpec objects resolved server-side
//  (flexible-period.ts is the ONE boundary policy); this control
//  only produces specs, never resolved ranges.
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import type { MonthOption } from '../kpi-reports-shared';
import type {
  FlexiblePeriodKind,
  FlexiblePeriodSpec,
  FlexibleComparisonSpec,
} from '@/lib/kpi-reporting';
// §CLIENT-BUNDLE — the pure period module DIRECTLY (never the
// kpi-reporting barrel: that pulls the server loaders/Firebase into
// the client bundle).
import { weekStartOf, deriveComparisonSpec } from '@/lib/kpi-reporting/flexible-period';

const PERIOD_KINDS: ReadonlyArray<{ kind: FlexiblePeriodKind; ar: string; en: string }> = [
  { kind: 'month', ar: 'شهر', en: 'Month' },
  { kind: 'day', ar: 'يوم', en: 'Day' },
  { kind: 'week', ar: 'أسبوع', en: 'Week' },
  { kind: 'quarter', ar: 'ربع سنوي', en: 'Quarter' },
  { kind: 'six_months', ar: 'نصف سنوي', en: 'Six Months' },
  { kind: 'year', ar: 'سنة', en: 'Year' },
  { kind: 'custom_range', ar: 'مدى مخصص', en: 'Custom Range' },
];

export interface FlexiblePeriodPickerProps {
  /** The active period spec. */
  spec: FlexiblePeriodSpec;
  onSpecChange: (spec: FlexiblePeriodSpec) => void;
  comparison: FlexibleComparisonSpec;
  onComparisonChange: (spec: FlexibleComparisonSpec) => void;
  /** Existing month options (snapshot-backed) for the month kind. */
  monthOptions: ReadonlyArray<MonthOption>;
  /** The current month key — kind defaults anchor to it. */
  currentMonthKey: string;
}

const CONTROL_CLASS = 'h-9 bg-slate-950/40 border-slate-700/60 text-xs';

export function FlexiblePeriodPicker({
  spec,
  onSpecChange,
  comparison,
  onComparisonChange,
  monthOptions,
  currentMonthKey,
}: FlexiblePeriodPickerProps) {
  const { locale } = useLanguage();

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current + 1; y >= current - 4; y -= 1) years.push(y);
    return years;
  }, []);

  /** Anchor day key of the current month's first day (for defaults). */
  const anchorDay = useMemo(() => `${currentMonthKey}-01`, [currentMonthKey]);

  const kindLabel = (k: FlexiblePeriodKind): string => {
    const entry = PERIOD_KINDS.find((p) => p.kind === k);
    return locale === 'en' ? entry?.en ?? k : entry?.ar ?? k;
  };

  /** Switching kinds resets to a SAFE, FULL default of the new kind. */
  const handleKindChange = (rawKind: string) => {
    const kind = rawKind as FlexiblePeriodKind;
    switch (kind) {
      case 'month':
        onSpecChange({ kind: 'month', monthKey: currentMonthKey });
        break;
      case 'day':
        onSpecChange({ kind: 'day', date: anchorDay });
        break;
      case 'week':
        // §CONSISTENCY — snap to the documented Saturday anchor.
        onSpecChange({ kind: 'week', weekStart: weekStartOf(anchorDay) });
        break;
      case 'quarter': {
        const q = Math.floor((Number(currentMonthKey.slice(5, 7)) - 1) / 3) + 1;
        onSpecChange({ kind: 'quarter', year: Number(currentMonthKey.slice(0, 4)), quarter: q as 1 | 2 | 3 | 4 });
        break;
      }
      case 'six_months': {
        const half = Number(currentMonthKey.slice(5, 7)) <= 6 ? 1 : 2;
        onSpecChange({ kind: 'six_months', year: Number(currentMonthKey.slice(0, 4)), half: half as 1 | 2 });
        break;
      }
      case 'year':
        onSpecChange({ kind: 'year', year: Number(currentMonthKey.slice(0, 4)) });
        break;
      case 'custom_range': {
        // §CONSISTENCY — the FULL anchor month (1st → last day).
        const [y, m] = currentMonthKey.split('-').map(Number);
        const lastDay = new Date(y!, m!, 0).getDate();
        onSpecChange({
          kind: 'custom_range',
          fromDate: anchorDay,
          toDate: `${currentMonthKey}-${String(lastDay).padStart(2, '0')}`,
        });
        break;
      }
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-3 items-start">
      {/* ── Primary period ── */}
      <div className="space-y-2">
        <div className="grid grid-cols-[110px_1fr] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px] text-slate-500"><T>نوع الفترة</T></Label>
            <Select value={spec.kind} onValueChange={handleKindChange}>
              <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_KINDS.map((p) => (
                  <SelectItem key={p.kind} value={p.kind}>
                    {locale === 'en' ? p.en : p.ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-slate-500"><T>الفترة</T></Label>
            {spec.kind === 'month' && (
              <Select value={spec.monthKey} onValueChange={(v) => onSpecChange({ kind: 'month', monthKey: v })}>
                <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {spec.kind === 'day' && (
              <Input
                type="date"
                className={CONTROL_CLASS}
                value={spec.date}
                onChange={(e) => onSpecChange({ kind: 'day', date: e.target.value })}
              />
            )}
            {spec.kind === 'week' && (
              <Input
                type="date"
                className={CONTROL_CLASS}
                value={spec.weekStart}
                onChange={(e) => onSpecChange({ kind: 'week', weekStart: e.target.value })}
              />
            )}
            {spec.kind === 'quarter' && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={String(spec.year)} onValueChange={(v) => onSpecChange({ ...spec, year: Number(v) })}>
                  <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(spec.quarter)} onValueChange={(v) => onSpecChange({ ...spec, quarter: Number(v) as 1 | 2 | 3 | 4 })}>
                  <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((q) => (
                      <SelectItem key={q} value={String(q)}>
                        {locale === 'en' ? `Q${q}` : `الربع ${q}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {spec.kind === 'six_months' && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={String(spec.year)} onValueChange={(v) => onSpecChange({ ...spec, year: Number(v) })}>
                  <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={String(spec.half)} onValueChange={(v) => onSpecChange({ ...spec, half: Number(v) as 1 | 2 })}>
                  <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">{locale === 'en' ? 'H1 (Jan–Jun)' : 'النصف الأول'}</SelectItem>
                    <SelectItem value="2">{locale === 'en' ? 'H2 (Jul–Dec)' : 'النصف الثاني'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {spec.kind === 'year' && (
              <Select value={String(spec.year)} onValueChange={(v) => onSpecChange({ kind: 'year', year: Number(v) })}>
                <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {spec.kind === 'custom_range' && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  className={CONTROL_CLASS}
                  value={spec.fromDate}
                  onChange={(e) => onSpecChange({ ...spec, fromDate: e.target.value })}
                />
                <Input
                  type="date"
                  className={CONTROL_CLASS}
                  value={spec.toDate}
                  onChange={(e) => onSpecChange({ ...spec, toDate: e.target.value })}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Comparison (independent) ── */}
      <div className="space-y-2">
        <div className="grid grid-cols-[110px_1fr] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[11px] text-slate-500"><T>فترة المقارنة</T></Label>
            <Select
              value={comparison.kind === 'previous_period' ? 'previous_period' : comparison.kind}
              onValueChange={(v) => {
                if (v === 'previous_period') {
                  onComparisonChange({ kind: 'previous_period' });
                  return;
                }
                // §CONSISTENCY — a comparison spec OF THE CHOSEN KIND,
                // derived from the primary's natural neighbor.
                onComparisonChange(deriveComparisonSpec(spec, v as FlexiblePeriodKind));
              }}
            >
              <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="previous_period">
                  {locale === 'en' ? 'Previous (auto)' : 'السابقة (تلقائي)'}
                </SelectItem>
                {PERIOD_KINDS.map((p) => (
                  <SelectItem key={p.kind} value={p.kind}>{kindLabel(p.kind)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0">
            {comparison.kind !== 'previous_period' ? (
              <>
                <Label className="text-[11px] text-slate-500"><T>قيمة المقارنة</T></Label>
                {comparison.kind === 'month' && (
                  <Select value={comparison.monthKey} onValueChange={(v) => onComparisonChange({ kind: 'month', monthKey: v })}>
                    <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {comparison.kind === 'day' && (
                  <Input type="date" className={CONTROL_CLASS} value={comparison.date}
                    onChange={(e) => onComparisonChange({ kind: 'day', date: e.target.value })} />
                )}
                {comparison.kind === 'week' && (
                  <Input type="date" className={CONTROL_CLASS} value={comparison.weekStart}
                    onChange={(e) => onComparisonChange({ kind: 'week', weekStart: e.target.value })} />
                )}
                {comparison.kind === 'quarter' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={String(comparison.year)} onValueChange={(v) => onComparisonChange({ ...comparison, year: Number(v) })}>
                      <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(comparison.quarter)} onValueChange={(v) => onComparisonChange({ ...comparison, quarter: Number(v) as 1 | 2 | 3 | 4 })}>
                      <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>{locale === 'en' ? `Q${q}` : `الربع ${q}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {comparison.kind === 'six_months' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={String(comparison.year)} onValueChange={(v) => onComparisonChange({ ...comparison, year: Number(v) })}>
                      <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(comparison.half)} onValueChange={(v) => onComparisonChange({ ...comparison, half: Number(v) as 1 | 2 })}>
                      <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{locale === 'en' ? 'H1' : 'النصف الأول'}</SelectItem>
                        <SelectItem value="2">{locale === 'en' ? 'H2' : 'النصف الثاني'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {comparison.kind === 'year' && (
                  <Select value={String(comparison.year)} onValueChange={(v) => onComparisonChange({ kind: 'year', year: Number(v) })}>
                    <SelectTrigger className={CONTROL_CLASS}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {comparison.kind === 'custom_range' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="date" className={CONTROL_CLASS} value={comparison.fromDate}
                      onChange={(e) => onComparisonChange({ ...comparison, fromDate: e.target.value })} />
                    <Input type="date" className={CONTROL_CLASS} value={comparison.toDate}
                      onChange={(e) => onComparisonChange({ ...comparison, toDate: e.target.value })} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-[11px] text-slate-500 h-9 flex items-center leading-snug">
                <T>تُحسب تلقائيًا كالفترة السابقة المساوية بالطول (بدون تداخل)</T>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Swap (makes the comparison the primary) ── */}
      <div className="flex items-end justify-center lg:justify-start pb-0.5">
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-slate-700/60 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          title={locale === 'en' ? 'Swap: make the comparison the primary period' : 'تبديل: اجعل فترة المقارنة هي الفترة الأساسية'}
          disabled={comparison.kind === 'previous_period'}
          onClick={() => {
            if (comparison.kind === 'previous_period') return;
            onSpecChange(comparison);
            onComparisonChange(spec);
          }}
        >
          <ArrowLeftRight className="size-3.5" />
          <span className="hidden xl:inline"><T>تبديل</T></span>
        </Button>
      </div>
    </div>
  );
}
