'use client';

// ══════════════════════════════════════════════════════════════
//  FlexibleReportView — §FLEX-PERIODS report sections
//
//  Renders the flexible-period insights payload: the period +
//  independent comparison meta with the EXPLICIT value-basis
//  disclosure (FINALIZED/MTD/LIVE/MIXED + per-month bases),
//  overview with denominators, employee KPI table, unit rollups
//  (team/department/company), category/severity distributions,
//  repeated issues and quality deductions. Every value carries the
//  same canonical meaning as the monthly workspace — this view only
//  spans periods.
// ══════════════════════════════════════════════════════════════

import { AlertTriangle, CalendarRange } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatInteger, formatPercentage } from '@/lib/i18n/format';
import type { FlexibleKpiInsightsReport, FlexibleSpanMeta } from '@/lib/kpi-reporting';
import { resolveStoredLabelOrVerbatim } from '@/lib/i18n/dynamic-labels';

function spanLabelText(meta: FlexibleSpanMeta, locale: 'ar' | 'en'): string {
  const from = meta.startDayKey.split('-').reverse().join('/');
  const to = meta.endDayKey.split('-').reverse().join('/');
  return `${from} → ${to} (${formatInteger(meta.dayCount, locale)} ${locale === 'en' ? 'days' : 'يومًا'})`;
}

const BASIS_LABELS: Record<string, readonly [string, string]> = {
  FINALIZED: ['مجمّدة (أشهر مغلقة)', 'FINALIZED (closed months)'],
  MTD: ['حية حتى الآن (تشمل الشهر الحالي)', 'MTD (through now)'],
  LIVE: ['حية (حساب مباشر على نافذة الفترة)', 'LIVE (window calculation)'],
  MIXED: ['مختلطة (أشهر مجمّدة + حية)', 'MIXED (frozen + live months)'],
};

function BasisBadge({ basis }: { basis: string }) {
  const { locale } = useLanguage();
  const pair = BASIS_LABELS[basis];
  if (!pair) return null;
  const tone =
    basis === 'FINALIZED'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : basis === 'MTD'
        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
        : basis === 'MIXED'
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          : 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold ${tone}`}>
      {locale === 'en' ? pair[1] : pair[0]}
    </span>
  );
}

export function FlexiblePeriodHeader({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — a payload is never assumed; an absent report renders
  // nothing (the page shows its own loading/error state).
  if (!report || !report.period) return null;
  const comparison = report.comparison ?? null;
  return (
    <Card className="report-print bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-slate-100">
          <CalendarRange className="size-4 text-brand-400" />
          <h3 className="text-sm font-bold"><T>الفترة المرنة + المقارنة المستقلة</T></h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5 rounded-lg border border-slate-700/40 bg-slate-900/40 p-3">
            <p className="text-[10px] text-slate-500 font-semibold"><T>فترة التقرير</T></p>
            <p className="text-slate-200">{spanLabelText(report.period, locale)}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <BasisBadge basis={report.period.valueBasis} />
              <span className="text-[10px] text-slate-500">
                {report.period.monthKeys.map((m) => formatMonthCell(m, locale, report)).join(' · ')}
              </span>
            </div>
          </div>
          {comparison && (
            <div className="space-y-1.5 rounded-lg border border-slate-700/40 bg-slate-900/40 p-3">
              <p className="text-[10px] text-slate-500 font-semibold"><T>فترة المقارنة (مستقلة)</T></p>
              <p className="text-slate-200">{spanLabelText(comparison, locale)}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <BasisBadge basis={comparison.valueBasis} />
                <span className="text-[10px] text-slate-500">
                  {comparison.monthKeys.map((m) => formatMonthCell(m, locale, report)).join(' · ')}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatMonthCell(monthKey: string, locale: 'ar' | 'en', report: FlexibleKpiInsightsReport): string {
  const all = [...report.period.monthBases, ...(report.comparison?.monthBases ?? [])];
  const basis = all.find((b) => b.monthKey === monthKey);
  const label = locale === 'en' ? monthKey : monthKey.replace('-', '/');
  if (!basis) return label;
  return `${label}${basis.liveCalculated ? (locale === 'en' ? ' (live)' : ' (حية)') : ''}`;
}

export function FlexibleOverviewSection({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — an absent payload renders nothing (the page owns loading/error states).
  if (!report) return null;
  const o = report.overview;
  const delta = o.qualityDeltaPoints;
  return (
    <Card className="report-print bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-100"><T>ملخص مؤشر الجودة</T></h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
          <Stat label={locale === 'en' ? 'Avg quality' : 'متوسط الجودة'} value={o.averageQuality !== null ? formatPercentage(o.averageQuality, { locale, maximumFractionDigits: 1 }) : '—'} />
          <Stat label={locale === 'en' ? 'Comparison avg' : 'متوسط المقارنة'} value={o.previousAverageQuality !== null ? formatPercentage(o.previousAverageQuality, { locale, maximumFractionDigits: 1 }) : '—'} />
          <Stat
            label={locale === 'en' ? 'Change (points)' : 'التغير (نقاط)'}
            value={delta !== null ? `${delta > 0 ? '+' : ''}${delta}` : '—'}
            tone={delta === null ? 'none' : delta > 0 ? 'good' : delta < 0 ? 'bad' : 'none'}
          />
          <Stat label={locale === 'en' ? 'Approved obs.' : 'ملاحظات معتمدة'} value={formatInteger(o.observationsApproved, locale)} />
          <Stat label={locale === 'en' ? 'High/critical' : 'مرتفعة/حرجة'} value={formatInteger(o.highCritical, locale)} />
          <Stat label={locale === 'en' ? 'Employees w/ value' : 'موظفون بقيمة'} value={`${formatInteger(o.employeesWithValue, locale)} / ${formatInteger(o.employeesEvaluated, locale)}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone = 'none' }: { label: string; value: string; tone?: 'good' | 'bad' | 'none' }) {
  const toneClass = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-2.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

export function FlexibleEmployeesSection({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — an absent payload renders nothing (the page owns loading/error states).
  if (!report) return null;
  return (
    <Card className="report-print bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-100"><T>أداء الموظفين خلال الفترة</T></h3>
        {report.employees.length === 0 ? (
          <p className="text-xs text-slate-500"><T>لا يوجد موظفون مؤهلون في هذه الفترة</T></p>
        ) : (
          <div className="overflow-x-auto arm-scroll">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                  <th className="text-start py-1.5 px-2 font-medium"><T>الموظف</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>الفريق</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>القسم</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>الشركة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>أشهر بقيمة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>متوسط الفترة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>متوسط المقارنة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>التغير</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>ملاحظات معتمدة</T></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {report.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td className="py-1.5 px-2 text-slate-300">{e.employeeName}</td>
                    <td className="py-1.5 px-2 text-slate-400">{e.team ?? '—'}</td>
                    <td className="py-1.5 px-2 text-slate-400">{e.department ?? '—'}</td>
                    <td className="py-1.5 px-2 text-slate-400">{e.company ?? '—'}</td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">{e.monthsWithValue}</td>
                    <td className="py-1.5 px-2 text-slate-200 tabular-nums">
                      {e.averageQuality !== null ? formatPercentage(e.averageQuality, { locale, maximumFractionDigits: 1 }) : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">
                      {e.previousAverageQuality !== null ? formatPercentage(e.previousAverageQuality, { locale, maximumFractionDigits: 1 }) : '—'}
                    </td>
                    <td className={`py-1.5 px-2 font-bold tabular-nums ${e.deltaPoints === null ? 'text-slate-500' : e.deltaPoints > 0 ? 'text-emerald-300' : e.deltaPoints < 0 ? 'text-red-300' : 'text-slate-300'}`}>
                      {e.deltaPoints !== null ? `${e.deltaPoints > 0 ? '+' : ''}${e.deltaPoints}` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">{e.observationsApproved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FlexibleUnitsSection({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — an absent payload renders nothing (the page owns loading/error states).
  if (!report) return null;
  const typeLabel: Record<string, readonly [string, string]> = {
    team: ['فريق', 'Team'],
    department: ['قسم', 'Department'],
    company: ['شركة', 'Company'],
  };
  return (
    <Card className="report-print bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-100"><T>مقارنة الوحدات (العضوية الفعلية)</T></h3>
        {report.units.length === 0 ? (
          <p className="text-xs text-slate-500"><T>لا توجد وحدات للمقارنة</T></p>
        ) : (
          <div className="overflow-x-auto arm-scroll">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                  <th className="text-start py-1.5 px-2 font-medium"><T>النوع</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>الوحدة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>الأعضاء</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>متوسط الفترة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>متوسط المقارنة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>التغير</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>ملاحظات معتمدة</T></th>
                  <th className="text-start py-1.5 px-2 font-medium"><T>مشكلات متكررة</T></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {report.units.map((u) => (
                  <tr key={u.key}>
                    <td className="py-1.5 px-2 text-slate-500">{locale === 'en' ? typeLabel[u.unitType]?.[1] : typeLabel[u.unitType]?.[0]}</td>
                    <td className="py-1.5 px-2 text-slate-300">{u.label}</td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">{u.employeeCount} ({u.membersWithValue})</td>
                    <td className="py-1.5 px-2 text-slate-200 tabular-nums">{u.averageQuality !== null ? formatPercentage(u.averageQuality, { locale, maximumFractionDigits: 1 }) : '—'}</td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">{u.previousAverageQuality !== null ? formatPercentage(u.previousAverageQuality, { locale, maximumFractionDigits: 1 }) : '—'}</td>
                    <td className={`py-1.5 px-2 font-bold tabular-nums ${u.deltaPoints === null ? 'text-slate-500' : u.deltaPoints > 0 ? 'text-emerald-300' : u.deltaPoints < 0 ? 'text-red-300' : 'text-slate-300'}`}>
                      {u.deltaPoints !== null ? `${u.deltaPoints > 0 ? '+' : ''}${u.deltaPoints}` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">{u.observationsApproved}</td>
                    <td className="py-1.5 px-2 text-slate-400 tabular-nums">{u.repeatedIssues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FlexibleDistributionsSection({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — an absent payload renders nothing (the page owns loading/error states).
  if (!report) return null;
  const { observations, deductions } = report;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 report-print">
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-100"><T>توزيع الفئات (معتمدة)</T></h3>
          {observations.byCategory.length === 0 ? (
            <p className="text-xs text-slate-500"><T>لا توجد ملاحظات معتمدة في الفترة</T></p>
          ) : (
            <div className="space-y-1.5">
              {observations.byCategory.map((c) => (
                <div key={c.key} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 truncate max-w-[55%]">{resolveStoredLabelOrVerbatim(c.label, locale)}</span>
                  <span className="text-slate-400 tabular-nums">
                    {c.count}{c.pct !== null ? ` (${c.pct}%)` : ''}
                    {c.previousCount !== null && <span className="text-slate-600"> ← {c.previousCount}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-100"><T>توزيع الخطورة</T></h3>
          <div className="space-y-1.5">
            {observations.bySeverity.map((s) => (
              <div key={s.severity} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{severityLabel(s.severity, locale)}</span>
                <span className="text-slate-400 tabular-nums">
                  {s.count}{s.pct !== null ? ` (${s.pct}%)` : ''}
                  {s.previousCount !== null && <span className="text-slate-600"> ← {s.previousCount}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-800/60 pt-2 space-y-1.5">
            <h4 className="text-xs font-semibold text-slate-200"><T>خصومات الجودة (سارية)</T></h4>
            <p className="text-xs text-slate-400 tabular-nums">
              {locale === 'en'
                ? `${deductions.count} deductions · ${deductions.totalDays} days (comparison: ${deductions.previousCount ?? '—'})`
                : `${deductions.count} خصمًا · ${deductions.totalDays} يومًا (المقارنة: ${deductions.previousCount ?? '—'})`}
            </p>
            {deductions.byType.map((t) => (
              <p key={t.type} className="text-[11px] text-slate-500">
                {resolveStoredLabelOrVerbatim(t.type, locale)}: {t.count}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function severityLabel(severity: string, locale: 'ar' | 'en'): string {
  const map: Record<string, readonly [string, string]> = {
    critical: ['حرجة', 'Critical'],
    high: ['مرتفعة', 'High'],
    medium: ['متوسطة', 'Medium'],
    low: ['منخفضة', 'Low'],
  };
  const pair = map[severity];
  return pair ? (locale === 'en' ? pair[1] : pair[0]) : severity;
}

export function FlexibleIssuesSection({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — an absent payload renders nothing (the page owns loading/error states).
  if (!report) return null;
  const { observations } = report;
  if (observations.repeatedIssues.length === 0 && observations.windowRecurrence.length === 0) {
    return null;
  }
  return (
    <Card className="report-print bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-100"><T>المشكلات المتكررة خلال الفترة</T></h3>
        <div className="flex flex-wrap gap-1.5">
          {observations.repeatedIssues.map((g) => (
            <span key={g.key} className="px-2 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-200 text-xs">
              {resolveStoredLabelOrVerbatim(g.label, locale)} ({g.occurrenceCount} · {g.employeeCount})
            </span>
          ))}
        </div>
        {observations.windowRecurrence.length > 0 && (
          <div className="border-t border-slate-800/60 pt-2">
            <p className="text-[10px] text-slate-500 mb-1"><T>تكرار عبر أشهر الفترة</T></p>
            <div className="flex flex-wrap gap-1.5">
              {observations.windowRecurrence.map((g) => (
                <span key={g.key} className="px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
                  {resolveStoredLabelOrVerbatim(g.label, locale)} ({g.monthsPresent})
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FlexibleDataQualityNotes({ report }: { report: FlexibleKpiInsightsReport | null }) {
  const { locale } = useLanguage();
  // §NULL-SAFETY — an absent payload renders nothing (the page owns loading/error states).
  if (!report) return null;
  if (report.dataQuality.length === 0) return null;
  const human: Record<string, readonly [string, string]> = {
    observationsDateUnknown: ['ملاحظات بلا تاريخ صالح استُثنيت من النافذة', 'Observations without a valid date were excluded from the window'],
    mixedValueBasis: ['الفترة تجمع أشهرًا مجمّدة وأشهرًا حية — الأساس معلن لكل شهر', 'The span mixes frozen and live months — each month basis is disclosed'],
    liveCalculatedMonthsPresent: ['توجد أشهر بقيم حية (حساب مباشر)', 'Some months carry live (calculated) values'],
    deductionsRestricted: ['خصومات الجودة محجوبة لصلاحياتك', 'Quality deductions are restricted for your permissions'],
  };
  return (
    <Card className="bg-amber-950/10 border-amber-800/30">
      <CardContent className="p-3 space-y-1">
        {report.dataQuality.map((note, i) => {
          const key = note.split(':')[0]!;
          const pair = human[key];
          return (
            <p key={i} className="text-[11px] text-amber-200/80 flex items-center gap-1.5">
              <AlertTriangle className="size-3 shrink-0" />
              {pair ? (locale === 'en' ? pair[1] : pair[0]) : note}
            </p>
          );
        })}
      </CardContent>
    </Card>
  );
}
