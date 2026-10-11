'use client';

// ══════════════════════════════════════════════════════════════
//  QualityIntelligenceSection — the analytical explanation layer
//
//  §11 observation volume + category distribution (canonical Master
//      Data categories — EN labels resolve through the categories
//      master data, never the frozen Arabic snapshot alone)
//  §12 severity intelligence (count · percentage · change vs previous)
//  §13 repeated issues — the canonical deterministic detection,
//      rendered in business language; internal rule keys never show.
//  Every category/repeated-issue row drills down to the exact
//  quality observations (existing navigation seeds only).
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  CategoryInsight,
  KpiInsightsReport,
  RepeatedIssueInsight,
  SeverityInsight,
} from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatNumber, formatMonthKey } from '@/lib/i18n/format';
import { useAppStore } from '@/lib/store';
import { useObservationCategories } from '@/hooks/use-kpi-queries';
import { categoryDisplayName } from '@/lib/observation-categories/presentation';
import type { ObservationCategory } from '@/types/quality-kpi';
import { SEVERITY_LABELS, SEVERITY_ORDER, pick } from './insights-labels';

/** Resolve a category's display label from the canonical master data. */
function useCategoryLabelResolver() {
  const { locale } = useLanguage();
  const { data: categories } = useObservationCategories();
  return useMemo(() => {
    const byKey = new Map<string, ObservationCategory>();
    for (const cat of (categories ?? []) as ObservationCategory[]) {
      if (cat?.key) byKey.set(cat.key, cat);
    }
    return (key: string | null, fallback: string): string => {
      if (!key || key === '_unclassified') {
        return locale === 'en' ? 'Unclassified' : 'غير مصنّف';
      }
      const cat = byKey.get(key);
      if (!cat) return fallback; // stored snapshot verbatim (business data)
      return categoryDisplayName(cat, locale);
    };
  }, [categories, locale]);
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}

function CategoryBars({
  distribution,
  monthKey,
  resolveLabel,
}: {
  distribution: CategoryInsight[];
  monthKey: string;
  resolveLabel: (key: string | null, fallback: string) => string;
}) {
  const { locale } = useLanguage();
  const navigateTo = useAppStore((st) => st.navigateTo);
  const max = Math.max(1, ...distribution.map((c) => c.count));
  if (distribution.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-2">
        <T>لا توجد ملاحظات معتمدة في هذه الفترة للنطاق المحدد.</T>
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {distribution.map((category) => (
        <button
          key={category.key}
          type="button"
          title={translateUIText('عرض ملاحظات هذا التصنيف', locale)}
          onClick={() =>
            navigateTo('observations', undefined, {
              month: monthKey,
              ...(category.categoryId ? { categoryId: category.categoryId } : {}),
            })
          }
          className="group block w-full text-start"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 truncate text-slate-300 group-hover:text-brand-200">
              {resolveLabel(category.categoryId, category.label)}
            </span>
            <div className="h-4 flex-1 rounded bg-slate-800/60 overflow-hidden">
              <div
                className="h-full rounded bg-brand-500/40 group-hover:bg-brand-500/60 transition-colors"
                style={{ width: `${Math.max(4, (category.count / max) * 100)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-end font-mono tabular-nums text-slate-300">
              {formatNumber(category.count, { locale })}
            </span>
            <span className="w-12 shrink-0 text-end text-[11px] text-slate-500" dir="ltr">
              {category.pct !== null ? `${category.pct}%` : '—'}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function SeverityTable({
  distribution,
}: {
  distribution: SeverityInsight[];
}) {
  const { locale } = useLanguage();
  const total = distribution.reduce((a, s) => a + s.count, 0);
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {SEVERITY_ORDER.map((severity) => {
        const entry = distribution.find((s) => s.severity === severity);
        const count = entry?.count ?? 0;
        const pct = entry?.pct ?? null;
        const prev = entry?.previousCount ?? null;
        const delta = prev === null ? null : count - prev;
        return (
          <div
            key={severity}
            className={cn(
              'rounded-lg border px-3 py-2',
              severity === 'critical' && 'border-red-500/30 bg-red-500/5',
              severity === 'high' && 'border-orange-500/30 bg-orange-500/5',
              severity === 'medium' && 'border-amber-500/30 bg-amber-500/5',
              severity === 'low' && 'border-slate-700/50 bg-slate-800/30',
            )}
          >
            <p className="text-[11px] text-slate-400">{pick(locale, SEVERITY_LABELS[severity])}</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-slate-100 font-mono tabular-nums">
                {formatNumber(count, { locale })}
              </span>
              {total > 0 && (
                <span className="text-[10px] text-slate-500" dir="ltr">
                  {pct !== null ? `${pct}%` : ''}
                </span>
              )}
              {delta !== null && delta !== 0 && (
                <span
                  className={cn(
                    'text-[10px] font-semibold',
                    delta > 0 ? 'text-red-400' : 'text-emerald-400',
                  )}
                  dir="ltr"
                >
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RepeatedIssuesTable({
  issues,
  monthKey,
  resolveLabel,
  windowRecurrence,
  employeeNameOf,
}: {
  issues: RepeatedIssueInsight[];
  monthKey: string;
  resolveLabel: (key: string | null, fallback: string) => string;
  windowRecurrence: KpiInsightsReport['windowRecurrence'];
  employeeNameOf: (employeeId: string) => string;
}) {
  const { locale } = useLanguage();
  const navigateTo = useAppStore((st) => st.navigateTo);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const windowByKey = useMemo(
    () => new Map(windowRecurrence.map((w) => [w.key, w])),
    [windowRecurrence],
  );

  if (issues.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-2">
        <T>لا توجد أنماط متكررة (تصنيف واحد مرتين أو أكثر) في هذه الفترة للنطاق المحدد.</T>
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {issues.map((issue) => {
        const windowEntry = windowByKey.get(issue.key);
        const expanded = expandedKey === issue.key;
        return (
          <div key={issue.key} className="rounded-lg border border-slate-700/50 bg-slate-800/30">
            <div className="flex items-center gap-3 px-3 py-2 flex-wrap">
              <button
                type="button"
                onClick={() => setExpandedKey(expanded ? null : issue.key)}
                className="flex min-w-0 flex-1 items-center gap-2 text-start"
              >
                <Repeat2 className="size-3.5 shrink-0 text-amber-400" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-200">
                    {resolveLabel(issue.categoryId, issue.label)}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    <T>مشكلة متكررة</T>
                    {' — '}
                    {formatNumber(issue.occurrenceCount, { locale })}{' '}
                    <T>مرات التكرار</T>
                    {' · '}
                    {formatNumber(issue.employeeCount, { locale })}{' '}
                    <T>موظفون متأثرون</T>
                    {issue.affectedTeamLabels.length > 0 && (
                      <>
                        {' · '}
                        {formatNumber(issue.affectedTeamLabels.length, { locale })}{' '}
                        <T>فرق</T>
                      </>
                    )}
                    {windowEntry && (
                      <>
                        {' · '}
                        <T>متكرر عبر</T> {formatNumber(windowEntry.monthsPresent, { locale })}{' '}
                        <T>أشهر</T>
                      </>
                    )}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    navigateTo('observations', undefined, {
                      month: monthKey,
                      ...(issue.categoryId ? { categoryId: issue.categoryId } : {}),
                    })
                  }
                  className="rounded-md border border-slate-700/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700/40"
                >
                  <T>عرض الملاحظات</T>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedKey(expanded ? null : issue.key)}
                  className="rounded-md p-1 text-slate-500 hover:text-slate-300"
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
              </div>
            </div>
            {expanded && (
              <div className="border-t border-slate-700/50 px-3 py-2 space-y-1.5">
                <p className="text-[11px] text-slate-500">
                  {issue.firstOccurrence ?? '—'} ← {issue.lastOccurrence ?? '—'}
                  {windowEntry && windowEntry.firstMonth && (
                    <>
                      {' · '}
                      <T>امتداد</T>: {formatMonthKey(windowEntry.firstMonth, locale)} →{' '}
                      {formatMonthKey(windowEntry.lastMonth, locale)}
                    </>
                  )}
                </p>
                <div className="flex flex-wrap gap-1">
                  {issue.affectedEmployeeIds.map((employeeId) => (
                    <button
                      key={employeeId}
                      type="button"
                      onClick={() => navigateTo('employee360', undefined, { employeeId })}
                      className="rounded-full border border-slate-700/60 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300 hover:border-brand-500/40 hover:text-brand-200"
                    >
                      {employeeNameOf(employeeId)}
                    </button>
                  ))}
                  {issue.affectedTeamLabels.map((team) => (
                    <span
                      key={team}
                      className="rounded-full border border-slate-700/40 bg-slate-900/40 px-2 py-0.5 text-[11px] text-slate-400"
                    >
                      {team}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function QualityIntelligenceSection({ report }: { report: KpiInsightsReport }) {
  const { locale } = useLanguage();
  const resolveLabel = useCategoryLabelResolver();
  const { overview } = report;
  const rowNameById = useMemo(
    () => new Map(report.rows.map((r) => [r.employeeId, r.employeeName])),
    [report.rows],
  );
  const employeeNameOf = (employeeId: string): string => rowNameById.get(employeeId) ?? employeeId;

  return (
    <section className="space-y-4 rounded-xl border border-slate-700/40 bg-slate-800/20 p-4">
      <SectionHeading
        title={pick(locale, ['ذكاء الجودة', 'Quality Intelligence'])}
        hint={pick(locale, [
          'الملاحظات المعتمدة هي الشرح التشغيلي وراء أداء الجودة',
          'Approved observations are the operational explanation behind quality performance',
        ])}
      />

      {/* §11 — volume */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
          <T>المعتمدة</T>: {formatNumber(overview.observationsApproved, { locale })}
        </span>
        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sky-200">
          <T>بانتظار الاعتماد</T>: {formatNumber(overview.observationsPending, { locale })}
        </span>
        <span className="rounded-full border border-slate-600/40 bg-slate-700/20 px-2.5 py-1 text-slate-300">
          <T>المرفوضة</T>: {formatNumber(overview.observationsRejected, { locale })}
        </span>
        <span className="text-[11px] text-slate-500">
          <T>لا تدخل الملاحظات المعلقة أو المرفوضة في النتيجة</T>
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <SectionHeading title={pick(locale, ['التوزيع حسب التصنيف', 'Distribution by category'])} />
          <CategoryBars
            distribution={report.categoryDistribution}
            monthKey={report.monthKey}
            resolveLabel={resolveLabel}
          />
        </div>
        <div className="space-y-2">
          <SectionHeading
            title={pick(locale, ['التوزيع حسب الخطورة', 'Distribution by severity'])}
            hint={pick(locale, ['مع التغير عن الفترة السابقة', 'with change vs previous period'])}
          />
          <SeverityTable distribution={report.severityDistribution} />
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeading title={pick(locale, ['المشكلات المتكررة', 'Repeated issues'])} />
        <RepeatedIssuesTable
          issues={report.repeatedIssues}
          monthKey={report.monthKey}
          resolveLabel={resolveLabel}
          windowRecurrence={report.windowRecurrence}
          employeeNameOf={employeeNameOf}
        />
      </div>
    </section>
  );
}
