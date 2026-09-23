'use client';

// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Statistical Insights section (Phase 5)
//
//  MINIMAL UI integration for the analytics layer
//  (spec §31): one extra section mounted after Data Quality and
//  before the future-AI placeholder. The facts-only sections of
//  the report are UNCHANGED.
//
//  Presentation only — every number arrives pre-computed from the
//  deterministic TypeScript engine (in-process — no Python, no
//  remote service). ERROR is a first-class explicit state
//  explicit states (spec §27/§28): the section degrades alone and
//  the rest of the report keeps working. No AI, no narratives,
//  no recommendations (spec §33).
// ══════════════════════════════════════════════════════════════

import { type ReactNode } from 'react';
import {
  AlertTriangle,
  Clock,
  Info,
  Network,
  Percent,
  RefreshCw,
  Sigma,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useEmployeeAnalytics } from '@/hooks/use-kpi-queries';
import type { AnalyticsApiResponse } from '@/lib/analytics/types';
import { SectionCard } from './report-sections';
import {
  buildAnalyticsView,
  type AnalyticsBadgeView,
  type AnalyticsReadyView,
} from './analytics-view';

export function AnalyticsSection({ employeeId, month }: { employeeId: string; month: string }) {
  const { locale } = useLanguage();
  const analyticsQuery = useEmployeeAnalytics(employeeId || null, month || null);

  // Explicit state machine (spec §27/§28): loading, network error,
  // ERROR (failed analytics) degrades
  // this section alone — the rest of the report is untouched.
  let view = buildAnalyticsView(analyticsQuery.data as AnalyticsApiResponse | undefined, locale);
  if (analyticsQuery.isLoading) view = { kind: 'LOADING' };
  if (analyticsQuery.isError) {
    view = {
      kind: 'ERROR',
      reason: 'NETWORK_ERROR',
      message: translateUIText('تعذر الاتصال بخدمة التحليل الإحصائي — باقي التقرير يعمل بشكل طبيعي', locale),
    };
  }

  return (
    <SectionCard
      icon={Sigma}
      title={translateUIText('التحليل الإحصائي', locale)}
      subtitle={translateUIText('نتائج تحليلية حتمية فوق مجموعة البيانات المتحقق منها — طبقة تحليل فقط، بلا أحكام أو تفسير', locale)}
      actions={<OverallConfidenceBadge view={view} />}
    >
      {view.kind === 'IDLE' && (
        <p className="text-xs text-slate-500"><T>بانتظار بيانات الفترة…</T></p>
      )}

      {view.kind === 'LOADING' && (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-5 w-2/3 bg-slate-800/40" />
          <Skeleton className="h-16 w-full bg-slate-800/40" />
          <Skeleton className="h-10 w-full bg-slate-800/40" />
        </div>
      )}

      {view.kind === 'UNAVAILABLE' && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm text-sky-200">{view.message}</p>
            <p className="text-[11px] text-slate-500">
              <T>سبب الحالة: </T><span className="font-mono" dir="ltr">{view.reason}</span>
            </p>
          </div>
        </div>
      )}

      {view.kind === 'ERROR' && (
        <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-amber-200">{view.message}</p>
              <p className="text-[11px] text-slate-500 font-mono" dir="ltr">{view.reason}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="no-print border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
            onClick={() => analyticsQuery.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5 ml-1" />
            <T>إعادة المحاولة</T>
          </Button>
        </div>
      )}

      {view.kind === 'TIMEOUT' && (
        <div className="space-y-2 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-orange-200">{view.message}</p>
              <p className="text-[11px] text-slate-500 font-mono" dir="ltr">{view.reason}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="no-print border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
            onClick={() => analyticsQuery.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5 ml-1" />
            <T>إعادة المحاولة</T>
          </Button>
        </div>
      )}

      {view.kind === 'READY' && <ReadyBlocks view={view} />}
    </SectionCard>
  );
}

function OverallConfidenceBadge({ view }: { view: ReturnType<typeof buildAnalyticsView> }) {
  if (view.kind !== 'READY') return null;
  return (
    <div className="flex items-center gap-1.5">
      <ToneBadge badge={view.overallConfidence} />
      <span className="hidden sm:inline text-[10px] text-slate-500"><T>الثقة الإجمالية</T></span>
    </div>
  );
}

function ToneBadge({ badge }: { badge: AnalyticsBadgeView }) {
  const TONE: Record<string, string> = {
    neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
    info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    accent: 'bg-brand-500/15 text-brand-300 border-brand-500/30',
  };
  return (
    <Badge variant="outline" className={cn('font-normal text-[11px]', TONE[badge.tone])}>
      {badge.label}
    </Badge>
  );
}

function BlockTitle({ icon: Icon, children }: { icon: typeof Sigma; children: ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-200">
      <Icon className="h-3.5 w-3.5 text-emerald-400" />
      {children}
    </h4>
  );
}

function ReadyBlocks({ view }: { view: AnalyticsReadyView }) {
  const hasAnomalies = view.anomalies.length > 0;
  const hasPatterns = view.patterns.length > 0;
  const hasCorrelations = view.correlations.length > 0;
  const hasDeltas = view.deltas.length > 0;
  const hasConcentration = view.concentration.length > 0;

  return (
    <div className="space-y-5">
      {/* §7 Trend statistics */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BlockTitle icon={Sigma}>{view.trend.statusLabel}</BlockTitle>
          <div className="flex items-center gap-1.5">
            <ToneBadge badge={view.trend.confidence} />
            <span className="text-[10px] text-slate-500"><T>اتجاه: </T>{view.trend.directionLabel}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {view.trend.facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <div className="text-[11px] text-slate-500">{f.label}</div>
              <div
                className={cn(
                  'truncate text-sm font-semibold tabular-nums',
                  f.unavailable ? 'text-slate-500 font-normal italic' : 'text-slate-200',
                )}
                title={f.value}
                dir="ltr"
              >
                {f.value}
              </div>
            </div>
          ))}
        </div>
        {view.trend.missingLabel && (
          <p className="text-[11px] text-amber-300/80">{view.trend.missingLabel}</p>
        )}
        {hasConcentration && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {view.concentration.map((c) => (
              <Badge
                key={c.label}
                variant="outline"
                className="border-slate-500/30 bg-slate-500/15 font-normal text-[11px] text-slate-300"
              >
                <T>تركّز </T>{c.label}: <span className="mx-1 tabular-nums">{c.text}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* §6 Period-over-period count deltas */}
      {hasDeltas && (
        <div className="space-y-2">
          <BlockTitle icon={Percent}><T>مقارنة الفترة بالشهر السابق (عدد السجلات)</T></BlockTitle>
          <div className="flex flex-wrap gap-1.5">
            {view.deltas.map((d) => (
              <Badge
                key={d.label}
                variant="outline"
                className={cn(
                  'font-normal text-[11px] tabular-nums',
                  d.tone === 'warn' && 'border-amber-500/30 bg-amber-500/15 text-amber-300',
                  d.tone === 'good' && 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
                  d.tone === 'neutral' && 'border-slate-500/30 bg-slate-500/15 text-slate-300',
                )}
              >
                {d.label}: <span className="mx-1">{d.text}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* §10 Anomalies — explicitly NOT wrongdoing */}
      <div className="space-y-2">
        <BlockTitle icon={AlertTriangle}><T>الاختلافات الإحصائية</T></BlockTitle>
        {hasAnomalies ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50">
                  <TableHead className="text-slate-400"><T>الاختلاف</T></TableHead>
                  <TableHead className="text-slate-400"><T>المؤشر</T></TableHead>
                  <TableHead className="text-slate-400"><T>القيمة المرصودة</T></TableHead>
                  <TableHead className="text-slate-400"><T>النطاق المتوقع</T></TableHead>
                  <TableHead className="text-slate-400"><T>الشدة</T></TableHead>
                  <TableHead className="text-slate-400"><T>الثقة</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.anomalies.map((a, idx) => (
                  <TableRow key={`${a.title}-${idx}`} className="border-slate-800/60">
                    <TableCell className="align-top">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-slate-200">
                          {a.title.includes('هبوط')
                            ? <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                            : <TrendingUp className="h-3.5 w-3.5 text-amber-400" />}
                          <span className="text-[13px] font-medium">{a.title}</span>
                        </div>
                        <p className="text-[10px] text-slate-500">{a.noteLabel}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-[12px] text-slate-300 align-top">
                      {a.metricLabel}
                      <div className="text-[10px] text-slate-500" dir="ltr">{a.month} · {a.zLabel}</div>
                    </TableCell>
                    <TableCell className="text-[12px] text-slate-200 tabular-nums align-top" dir="ltr">
                      {a.observedLabel}
                    </TableCell>
                    <TableCell className="text-[11px] text-slate-400 align-top" dir="ltr">
                      {a.rangeLabel}
                    </TableCell>
                    <TableCell className="align-top"><ToneBadge badge={a.severity} /></TableCell>
                    <TableCell className="align-top"><ToneBadge badge={a.confidence} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            <T>لا توجد اختلافات إحصائية ضمن العتبات المحافظة المطبقة لهذه الفترة.</T>
          </p>
        )}
      </div>

      {/* §17 Cross-domain temporal associations */}
      <div className="space-y-2">
        <BlockTitle icon={Network}><T>أنماط زمنية عبر النطاقات</T></BlockTitle>
        {hasPatterns ? (
          <ul className="space-y-2">
            {view.patterns.map((p, idx) => (
              <li
                key={`${p.pairLabel}-${idx}`}
                className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-slate-200">{p.pairLabel}</span>
                  <ToneBadge badge={p.confidence} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{p.monthsLabel}</p>
                <p className="text-[10px] text-slate-500">{p.noteLabel}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500"><T>لا توجد أنماط تزامن مؤهلة ضمن العتبات المطبقة.</T></p>
        )}
      </div>

      {/* §18 Correlations — reported with n and limitations only */}
      {hasCorrelations && (
        <div className="space-y-2">
          <BlockTitle icon={Percent}><T>الارتباطات (بشرط كفاية العينة)</T></BlockTitle>
          <ul className="space-y-2">
            {view.correlations.map((c, idx) => (
              <li
                key={`${c.pairLabel}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/40 bg-slate-800/20 p-3"
              >
                <span className="text-[13px] font-medium text-slate-200">{c.pairLabel}</span>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums text-slate-400" dir="ltr">
                  <span className="font-mono">{c.coefficientLabel}</span>
                  <span className="font-mono">{c.sampleLabel}</span>
                  <Badge variant="outline" className={cn('font-normal text-[11px]', c.strengthTone === 'info' ? 'border-sky-500/30 bg-sky-500/15 text-sky-300' : 'border-slate-500/30 bg-slate-500/15 text-slate-300')}>
                    {c.strengthLabel}
                  </Badge>
                  <ToneBadge badge={c.confidence} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-500"><T>الارتباط الإحصائي ليس سببية — يُعرض للتتبع التحليلي فقط.</T></p>
        </div>
      )}

      {/* §19 Analytics data quality — gaps never hidden */}
      <div className="space-y-2 rounded-xl border border-slate-700/40 bg-slate-900/20 p-3">
        <BlockTitle icon={Info}><T>جودة بيانات التحليل</T></BlockTitle>
        {view.gaps.length > 0 && (
          <ul className="space-y-1">
            {view.gaps.map((g, idx) => (
              <li key={idx} className="text-[11px] text-slate-400">
                <span className="text-slate-300">{g.areaLabel}:</span> {g.reasonLabel}
                {g.detailLabel ? <span className="text-slate-500"> — {g.detailLabel}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {view.gaps.length === 0 && (
          <p className="text-[11px] text-slate-500"><T>جميع التحليلات استوفت الحد الأدنى من البيانات.</T></p>
        )}
        {view.unavailableMetricsLabel && (
          <p className="text-[11px] text-slate-500"><T>مؤشرات غير متاحة: </T>{view.unavailableMetricsLabel}</p>
        )}
        {view.noteLabels.length > 0 && (
          <ul className="space-y-1 border-t border-slate-800/60 pt-2">
            {view.noteLabels.map((n, idx) => (
              <li key={idx} className="text-[10px] leading-5 text-slate-500">{n}</li>
            ))}
          </ul>
        )}
      </div>

      <Card className="bg-slate-900/30 border-slate-700/30">
        <CardContent className="p-3">
          <p className="text-[10px] leading-5 text-slate-500">
            <T>هذه النتائج طبقة تحليل إحصائي حتمية (FACT + ANALYSIS) فوق بيانات ذكاء الأداء المتحقق منها —
            لا تتضمن أي حكم على الموظف، ولا سرداً توليدياً، ولا توصيات. القيم المعروضة منسوخة كما أنتجها
            محرك التحليل ولا تمثل إعادة حساب لأي مؤشر KPI.</T>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
