'use client';

// ══════════════════════════════════════════════════════════════
//  Insights sections — §19 opportunities · §21 attention · §24 data
//  quality. One primary location per fact: opportunities reference
//  the quality-intelligence numbers (never restate the signals),
//  attention is capped at 5 action-oriented items derived from the
//  signals, and data quality is ONE compact table at the end.
//
//  Language discipline (spec §19): "يشير / نمط متكرر / مراجعة
//  موصى بها" — never causal claims ("تسبب في"), never guaranteed
//  improvements, never internal diagnostic codes.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KpiInsightsReport } from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber, formatMonthKey } from '@/lib/i18n/format';
import { navigateToStore } from './nav';
import {
  DATA_SOURCE_LABELS,
  DATA_STATUS_LABELS,
  DATA_STATUS_STYLES,
  presentSignal,
  signalSuggestedAction,
  pick,
} from './insights-labels';

// ─────────────────────────────────────────────────────────────
//  §19 — Operational improvement opportunities
// ─────────────────────────────────────────────────────────────

export function ImprovementOpportunitiesSection({
  report,
  employeeNameOf,
}: {
  report: KpiInsightsReport;
  employeeNameOf: (employeeId: string) => string;
}) {
  const { locale } = useLanguage();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (report.opportunities.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2 rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-4">
      <div className="flex items-baseline gap-2">
        <Lightbulb className="size-4 text-brand-300" />
        <h3 className="text-sm font-semibold text-slate-200">
          <T>فرص التحسين التشغيلي</T>
        </h3>
        <span className="text-[11px] text-slate-500">
          <T>أنماط متكررة من ملاحظات الجودة المعتمدة — تُقرأ كمؤشر مراجعة، لا كسبب نهائي</T>
        </span>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {report.opportunities.map((opportunity, index) => {
          const expanded = expandedKey === opportunity.key;
          return (
            <div
              key={opportunity.key}
              className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-100">
                    {formatNumber(index + 1, { locale })}. {opportunity.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    <T>نمط متكرر مرتبط بـ</T> {formatNumber(opportunity.employeeCount, { locale })}{' '}
                    <T>موظف</T>
                    {opportunity.teamCount > 0 && (
                      <>
                        {' '}
                        <T>في</T> {formatNumber(opportunity.teamCount, { locale })} <T>فريق</T>
                      </>
                    )}
                    {' · '}
                    {formatNumber(opportunity.occurrenceCount, { locale })} <T>ملاحظة معتمدة</T>
                  </p>
                </div>
                {opportunity.changePct !== null && (
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
                      opportunity.changePct > 0
                        ? 'border-red-500/30 bg-red-500/10 text-red-300'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
                    )}
                    dir="ltr"
                  >
                    {opportunity.changePct > 0
                      ? <ArrowUpRight className="size-3" />
                      : <ArrowDownRight className="size-3" />}
                    {Math.abs(opportunity.changePct)}%
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                <T>محور المراجعة الإدارية:</T>{' '}
                {locale === 'en'
                  ? `Review the "${opportunity.label}" workflow and adherence.`
                  : `مراجعة إجراءات «${opportunity.label}» ومستوى الالتزام بها.`}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedKey(expanded ? null : opportunity.key)}
                  className="text-[11px] text-brand-300 hover:text-brand-200"
                >
                  {expanded ? <T>إخفاء الموظفين المتأثرين</T> : <T>عرض الموظفين المتأثرين</T>}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigateToStore('observations', undefined, {
                      month: report.monthKey,
                      ...(opportunity.categoryId ? { categoryId: opportunity.categoryId } : {}),
                    })
                  }
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  <T>عرض الملاحظات</T>
                </button>
              </div>
              {expanded && (
                <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-700/50 pt-2">
                  {opportunity.affectedEmployeeIds.map((employeeId) => (
                    <button
                      key={employeeId}
                      type="button"
                      onClick={() => navigateToStore('employee360', undefined, { employeeId })}
                      className="rounded-full border border-slate-700/60 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300 hover:border-brand-500/40 hover:text-brand-200"
                    >
                      {employeeNameOf(employeeId)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  §21 — Management attention (max 5, action-oriented)
// ─────────────────────────────────────────────────────────────

const ATTENTION_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
  positive: 'bg-emerald-400',
};

export function ManagementAttentionSection({ report }: { report: KpiInsightsReport }) {
  const { locale } = useLanguage();
  const items = report.signals.slice(0, 5);
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="space-y-2 rounded-xl border border-slate-700/40 bg-slate-800/20 p-4">
      <h3 className="text-sm font-semibold text-slate-200">
        <T>يتطلب انتباه الإدارة</T>
      </h3>
      <ul className="space-y-2">
        {items.map((signal) => {
          const presentation = presentSignal(signal, locale);
          return (
            <li key={signal.id} className="flex items-start gap-2 text-xs">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', ATTENTION_DOT[presentation.level])} />
              <span className="min-w-0">
                <span className="block text-slate-200">{presentation.text}</span>
                <span className="block text-[11px] text-slate-500">
                  → {signalSuggestedAction(signal, locale)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  §24 — Data quality (ONE compact section near the end)
// ─────────────────────────────────────────────────────────────

export function DataQualitySection({ report }: { report: KpiInsightsReport }) {
  const { locale } = useLanguage();
  return (
    <section className="space-y-2 rounded-xl border border-slate-700/40 bg-slate-800/20 p-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-200">
          <T>جودة البيانات</T>
        </h3>
        <span className="text-[11px] text-slate-500">
          <T>تُقرأ القيم المفقودة كـ«غير متاح» — لا كصفر ولا كأداء ضعيف</T>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
        {report.dataQuality.map((entry) => (
          <div key={entry.source} className="flex items-center justify-between gap-2 border-b border-slate-800/60 py-1 text-xs">
            <span className="text-slate-400">{pick(locale, DATA_SOURCE_LABELS[entry.source] ?? [entry.source, entry.source])}</span>
            <span className={cn('text-[11px]', DATA_STATUS_STYLES[entry.status])}>
              {pick(locale, DATA_STATUS_LABELS[entry.status] ?? [entry.status, entry.status])}
              {entry.status === 'available' && typeof entry.count === 'number' && (
                <span className="text-slate-600"> · {formatNumber(entry.count, { locale })}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600">
        <T>أُنشئ التقرير</T> {formatMonthKey(report.monthKey, locale)} · {new Date(report.generatedAt).toLocaleString(locale === 'en' ? 'en-GB' : 'ar-EG')}
      </p>
    </section>
  );
}
