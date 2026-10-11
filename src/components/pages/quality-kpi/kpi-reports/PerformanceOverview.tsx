'use client';

// ══════════════════════════════════════════════════════════════
//  PerformanceOverview — the executive strip + performance signals
//
//  §9  compact executive overview (percentage terminology only —
//      "متوسط نسبة الجودة", never weights/contributions; an
//      incomplete evaluation is labeled, never presented as a KPI)
//  §10 cross-domain signals: ONE primary location per fact — other
//      sections reference these rather than repeat them.
// ══════════════════════════════════════════════════════════════

import { ArrowDownRight, ArrowUpRight, Eye, Minus, ShieldAlert, Repeat2, UserRound, Users2, Building2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CompactMetricCard } from '@/components/shared/CompactMetricCard';
import type { KpiInsightsReport } from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber } from '@/lib/i18n/format';
import { formatScore } from '../kpi-reports-shared';
import { presentSignal, SEVERITY_LABELS, pick } from './insights-labels';

const SIGNAL_LEVEL_STYLES: Record<string, string> = {
  critical: 'border-red-500/30 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  positive: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
};

export function QualityDeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const up = delta > 0;
  const flat = delta === 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[10px] font-semibold',
        flat && 'text-slate-400',
        up && 'text-emerald-400',
        !up && !flat && 'text-red-400',
      )}
      dir="ltr"
    >
      {up ? <ArrowUpRight className="size-3" /> : flat ? <Minus className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(delta)}
    </span>
  );
}

export function PerformanceOverview({ report }: { report: KpiInsightsReport }) {
  const { locale } = useLanguage();
  const { overview, selection, severityDistribution } = report;
  const delta = overview.qualityDeltaPoints;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <CompactMetricCard
          label={pick(locale, ['الموظفون', 'Employees'])}
          value={formatNumber(selection.employeeCount, { locale })}
          icon={<UserRound className="size-3.5" />}
          density="standard"
        />
        <CompactMetricCard
          label={pick(locale, ['الفرق', 'Teams'])}
          value={formatNumber(report.teamUnits.length, { locale })}
          icon={<Users2 className="size-3.5" />}
          density="standard"
        />
        <CompactMetricCard
          label={pick(locale, ['متوسط نسبة الجودة', 'Average quality'])}
          value={formatScore(overview.avgQuality, locale)}
          icon={<Eye className="size-3.5" />}
          tone={delta !== null && delta < 0 ? 'danger' : delta !== null && delta > 0 ? 'positive' : 'default'}
          density="standard"
          hint={
            delta !== null
              ? `${locale === 'en' ? 'vs previous' : 'عن الفترة السابقة'}: ${delta > 0 ? '+' : ''}${delta}`
              : pick(locale, ['لا توجد مقارنة متاحة', 'No comparison available'])
          }
        />
        <CompactMetricCard
          label={pick(locale, ['الملاحظات المعتمدة', 'Approved observations'])}
          value={formatNumber(overview.observationsApproved, { locale })}
          icon={<Eye className="size-3.5" />}
          density="standard"
          hint={
            overview.observationsPending > 0
              ? `${pick(locale, ['بانتظار الاعتماد', 'Pending'])}: ${formatNumber(overview.observationsPending, { locale })}`
              : undefined
          }
        />
        <CompactMetricCard
          label={pick(locale, ['مشكلات متكررة', 'Repeated issues'])}
          value={formatNumber(overview.repeatedIssues, { locale })}
          icon={<Repeat2 className="size-3.5" />}
          tone={overview.repeatedIssues > 0 ? 'warning' : 'default'}
          density="standard"
        />
        <CompactMetricCard
          label={pick(locale, ['مرتفعة/حرجة', 'High/Critical'])}
          value={formatNumber(overview.highCritical, { locale })}
          icon={<ShieldAlert className="size-3.5" />}
          tone={overview.highCritical > 0 ? 'danger' : 'default'}
          density="standard"
        />
        <CompactMetricCard
          label={pick(locale, ['بحاجة إلى متابعة', 'Needs attention'])}
          value={formatNumber(overview.needsAttention, { locale })}
          icon={<Clock className="size-3.5" />}
          tone={overview.needsAttention > 0 ? 'warning' : 'default'}
          density="standard"
        />
      </div>

      {/* Severity mini-strip (§12) — facts here; full tables in the
          quality-intelligence section reference the same numbers. */}
      {overview.observationsApproved > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {severityDistribution.map((s) => (
            <span
              key={s.severity}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                s.count === 0 && 'opacity-50',
                s.severity === 'critical' && 'bg-red-500/15 text-red-300 border-red-500/30',
                s.severity === 'high' && 'bg-orange-500/15 text-orange-300 border-orange-500/30',
                s.severity === 'medium' && 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                s.severity === 'low' && 'bg-slate-500/15 text-slate-300 border-slate-500/30',
              )}
            >
              {pick(locale, SEVERITY_LABELS[s.severity])}
              <span className="font-semibold">{formatNumber(s.count, { locale })}</span>
              {s.pct !== null && <span className="text-[10px] opacity-80" dir="ltr">{s.pct}%</span>}
            </span>
          ))}
        </div>
      )}

      {/* §10 — performance signals */}
      {report.signals.length > 0 && (
        <div className="space-y-1.5">
          {report.signals.map((signal) => {
            const presentation = presentSignal(signal, locale);
            return (
              <div
                key={signal.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
                  SIGNAL_LEVEL_STYLES[presentation.level],
                )}
              >
                <span className="shrink-0">
                  {presentation.level === 'critical' && '🔴'}
                  {presentation.level === 'warning' && '⚠'}
                  {presentation.level === 'positive' && '↑'}
                  {presentation.level === 'info' && 'ℹ'}
                </span>
                <span className="min-w-0 flex-1">{presentation.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {selection.isCompanyWide ? (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <Building2 className="size-3" />
          <T>النطاق: النطاق المصرح به بالكامل</T>
        </p>
      ) : (
        <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>
            <T>الموظفون ضمن النطاق:</T>{' '}
            <span className="text-slate-300">{formatNumber(selection.employeeCount, { locale })}</span>
          </span>
          {selection.teamLabels.length > 0 && (
            <span>
              <T>الفرق:</T> <span className="text-slate-300">{selection.teamLabels.join(' · ')}</span>
            </span>
          )}
          {selection.departmentLabels.length > 0 && (
            <span>
              <T>الأقسام:</T> <span className="text-slate-300">{selection.departmentLabels.join(' · ')}</span>
            </span>
          )}
        </p>
      )}
    </section>
  );
}
