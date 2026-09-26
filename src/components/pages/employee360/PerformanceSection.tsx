'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Performance Overview (rebuild)
//
//  The canonical KPI engine's own output, verbatim:
//    • the FULL component breakdown (each component's configured
//      weight + raw score + weighted contribution + status) — the
//      UI hardcodes NO weights; PENDING components stay pending.
//    • weightedTotal vs the CONFIGURED target (kpiSettings).
//    • the frozen-first trend + percentage-point MoM delta.
//  A missing scheme is "يتطلب إعداداً" — never a fabricated score.
// ══════════════════════════════════════════════════════════════

import { BarChart3, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatMonthKey } from '@/lib/i18n/format';
import {
  SectionShell, MetricTile, Sparkline, DeltaChip, ConfigRequiredState, scoreTone,
} from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

const COMPONENT_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'متاح',
  ZERO: 'صفر محسوب',
  PENDING: 'قيد الانتظار',
  INCOMPLETE: 'غير مكتمل',
  NOT_ELIGIBLE: 'غير مشمول',
  FINALIZED: 'مثبت',
};

const TREND_LABELS: Record<string, string> = {
  UP: 'تحسّن',
  DOWN: 'تراجع',
  STABLE: 'مستقر',
};

export function PerformanceSection({ kpi, trend, targetScore, periodLabel }: {
  kpi: NonNullable<Employee360Data['kpi']>;
  trend: NonNullable<Employee360Data['trend']>;
  targetScore: number | null;
  periodLabel: string;
}) {
  const { locale } = useLanguage();

  // ── No value outcome → explicit configuration state ──
  const hasValue = kpi.weightedTotal !== null && kpi.rowStatus !== 'PENDING';
  if (!hasValue) {
    return (
      <SectionShell title={<T>الأداء والتقييم</T>} icon={<BarChart3 className="size-4 text-brand-500" />} periodLabel={periodLabel}>
        <ConfigRequiredState
          text={kpi.message ?? <T>لا توجد نتيجة تقييم لهذه الفترة — تحقق من مخطط المؤشرات وترتيب الموظف</T>}
        />
      </SectionShell>
    );
  }

  const weightedTotal = kpi.weightedTotal ?? 0;
  const momDelta = trend.mom?.deltaPoints ?? null;
  const direction = trend.direction;
  const sparkValues = [...trend.points]
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((p) => p.rawScore);
  const targetDelta = targetScore !== null ? Math.round((weightedTotal - targetScore) * 10) / 10 : null;

  return (
    <SectionShell
      title={<T>الأداء والتقييم</T>}
      icon={<BarChart3 className="size-4 text-brand-500" />}
      periodLabel={periodLabel}
      actions={kpi.scheme ? (
        <Badge variant="outline" className="rounded-md text-[10px] text-muted-foreground">
          {kpi.scheme.schemeName} · v{kpi.scheme.schemeVersion}
          {kpi.scheme.frozen ? ' · مثبت' : ''}
        </Badge>
      ) : undefined}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
        {/* Primary + components */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <MetricTile
              big
              label={<><T>التقييم العام</T>{kpi.availableWeight !== null && kpi.availableWeight < 100 ? ` (${kpi.availableWeight}%)` : ''}</>}
              value={weightedTotal}
              sub={kpi.overallStatus === 'INCOMPLETE'
                ? <T>بعض المكونات بلا قيمة — لا يُعاد توزيع الوزن</T>
                : <T>من 100</T>}
              tone={scoreTone(weightedTotal)}
            />
            {targetScore !== null && (
              <MetricTile
                big
                label={<T>المستهدف (المُعد)</T>}
                value={targetScore}
                sub={targetDelta !== null
                  ? <span className={targetDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {targetDelta >= 0 ? '+' : ''}{targetDelta} <T>عن المستهدف</T>
                    </span>
                  : null}
                tone={targetDelta !== null ? (targetDelta >= 0 ? 'good' : 'bad') : 'neutral'}
              />
            )}
            <MetricTile
              big
              label={<T>الجودة (خام)</T>}
              value={kpi.quality?.rawScore ?? '—'}
              sub={kpi.quality
                ? <><T>الوزن</T> {kpi.quality.weight}% · <T>الإسهام</T> {kpi.quality.weightedContribution ?? '—'}</>
                : null}
              tone={scoreTone(kpi.quality?.rawScore)}
            />
          </div>

          {/* FULL component breakdown — read from the configured scheme */}
          {kpi.components.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium"><T>المكون</T></th>
                    <th className="px-3 py-2 text-start font-medium"><T>الوزن</T></th>
                    <th className="px-3 py-2 text-start font-medium"><T>الدرجة</T></th>
                    <th className="px-3 py-2 text-start font-medium"><T>الإسهام</T></th>
                  </tr>
                </thead>
                <tbody>
                  {kpi.components.map((c) => {
                    const available = c.rawScore !== null;
                    return (
                      <tr key={c.componentId} className="border-b border-border/30 last:border-0">
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-foreground">{c.name}</span>
                          {!available && (
                            <span className="ms-2 text-[10px] text-muted-foreground">
                              {COMPONENT_STATUS_LABELS[c.status] ?? c.status}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">{c.weight}%</td>
                        <td className="px-3 py-2.5">
                          {available
                            ? <span className={`font-bold ${scoreToneClass(c.rawScore)}`} dir="ltr">{c.rawScore}</span>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {c.weightedContribution !== null
                            ? <span className="font-semibold text-foreground" dir="ltr">{c.weightedContribution}</span>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Trend panel */}
        <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground"><T>الاتجاه (أشهر مُثبتة أولاً)</T></p>
            {direction && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                direction === 'UP' ? 'text-emerald-600 dark:text-emerald-400'
                  : direction === 'DOWN' ? 'text-red-600 dark:text-red-400'
                  : 'text-muted-foreground'
              }`}>
                {direction === 'UP' ? <TrendingUp className="size-3.5" />
                  : direction === 'DOWN' ? <TrendingDown className="size-3.5" />
                  : <Minus className="size-3.5" />}
                {TREND_LABELS[direction] ?? direction}
              </span>
            )}
          </div>
          <Sparkline values={sparkValues} />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {trend.mom
                ? <><T>مقارنة بالشهر السابق</T> ({formatMonthKey(trend.mom.previousMonth, locale)})</>
                : <T>لا مقارنة متاحة (يتطلب شهرين بنتيجة)</T>}
            </span>
            <DeltaChip delta={momDelta} suffix="pt" />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            <T>القيم من محرك التقييم القانوني — الأشهر المغلقة تُقرأ من النتائج المثبتة، والأشهر بلا نتيجة تبقى غير متاحة (لا تصفير).</T>
          </p>
        </div>
      </div>
    </SectionShell>
  );
}

function scoreToneClass(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 85) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
