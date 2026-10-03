'use client';

// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Intelligence Sections (§QUALITY-INTELLIGENCE)
//
//  The analytical layer of the report: Executive Performance Summary,
//  Executive Narrative, KPI Intelligence (full engine breakdown),
//  Quality Intelligence (issue concentration + patterns), Management
//  Attention and the Data-Quality availability matrix.
//
//  PRESENTATION ONLY: every component renders a pure view object from
//  intelligence-view.ts (which localizes the deterministic facts of
//  lib/quality-intelligence). No calculation, no invention, no AI —
//  missing values render the explicit unavailable state. Deep links
//  go through the EXISTING navigateTo store and are permission-gated
//  by the caller (a page the viewer cannot see is not offered).
// ══════════════════════════════════════════════════════════════

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BadgeCheck,
  Brain,
  Gauge,
  ShieldAlert,
  Table2,
  Target,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';
import type {
  AttentionItemView,
  DataQualityIntelView,
  ExecutiveSummaryView,
  KpiIntelView,
  NarrativeSentenceView,
  PatternView,
  QualityIntelView,
  SignalItemView,
  WhatChangedRowView,
} from './intelligence-view';

// ─────────────────────────────────────────────────────────────
//  §4 EXECUTIVE PERFORMANCE SUMMARY
// ─────────────────────────────────────────────────────────────

export function ExecutiveSummarySection({ view }: { view: ExecutiveSummaryView }) {
  const incomplete = view.scoreState === 'incomplete' || view.scoreState === 'configuration_required';
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200 font-medium">
          <Gauge className="h-4 w-4 text-emerald-400" />
          <T>ملخص الأداء والجودة</T>
          <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-600/60">
            {view.periodLabel} · {view.valueBasisLabel}
          </Badge>
        </div>

        {/* §3 EXECUTIVE STRIP — WHO/HOW/WHAT CHANGED at a glance. Every
            metric carries an EXPLICIT semantic label (no bare "deals"). */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <div className={cn(
            'rounded-xl border px-3 py-2.5 text-center',
            incomplete ? 'border-amber-500/40 bg-amber-500/10' : view.hasScore ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-600/50 bg-slate-800/40',
          )}>
            <div className={cn('text-2xl font-bold tabular-nums', incomplete ? 'text-amber-300' : view.hasScore ? 'text-emerald-300' : 'text-slate-400')} dir="ltr">
              {view.scoreDisplay}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5"><T>مؤشر الأداء (KPI)</T></div>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 px-3 py-2.5 text-center">
            <div className={cn(
              'text-2xl font-bold tabular-nums',
              view.deltaPositive === true ? 'text-emerald-300' : view.deltaPositive === false ? 'text-red-300' : 'text-slate-400',
            )} dir="ltr">
              {view.deltaDisplay ?? '—'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5"><T>نقطة مقارنة بالشهر السابق</T></div>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 px-3 py-2.5 text-center">
            <div className="text-2xl font-bold text-slate-200 tabular-nums">
              {view.riskLabel ?? <span className="text-slate-500"><T>غير متاح</T></span>}
              {view.riskScoreDisplay && <span className="text-xs text-slate-500" dir="ltr"> ({view.riskScoreDisplay})</span>}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5"><T>المخاطر</T></div>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 px-3 py-2.5 text-center">
            <div className="text-2xl font-bold text-slate-200 tabular-nums" dir="ltr">{view.closedDuringPeriodDisplay}</div>
            <div className="text-[10px] text-slate-500 mt-0.5"><T>تقفيلات الفترة</T></div>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 px-3 py-2.5 text-center">
            <div className="text-2xl font-bold text-slate-200 tabular-nums" dir="ltr">{view.currentDealsDisplay}</div>
            <div className="text-[10px] text-slate-500 mt-0.5"><T>الصفقات الحالية</T></div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          {view.trendLabel && (
            <span className="text-slate-400"><span className="text-slate-500"><T>الاتجاه: </T></span>{view.trendLabel}</span>
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500"><T>جودة الفترة: </T></span>
            <span className="text-slate-200 font-semibold" dir="ltr">{view.qualityScoreDisplay}</span>
          </span>
          {view.decisionStatusLabel && (
            <span className="text-slate-400"><span className="text-slate-500"><T>حالة القرار: </T></span>{view.decisionStatusLabel}</span>
          )}
        </div>

        {/* Incomplete configuration — never a fabricated total */}
        {incomplete && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs space-y-1">
            <p className="text-amber-300 font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {view.incompleteMessage}
            </p>
            {view.missingComponents.length > 0 && (
              <p className="text-amber-200/70">
                <T>مكونات تحتاج إلى إعداد: </T>{view.missingComponents.join('، ')}
              </p>
            )}
            {view.availableWeightDisplay && (
              <p className="text-slate-400">
                <T>الوزن المتاح: </T><span dir="ltr">{view.availableWeightDisplay}%</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §4 TOP 3 SIGNALS — the compact management headline
// ─────────────────────────────────────────────────────────────

const SIGNAL_TONE: Record<SignalItemView['severity'], string> = {
  critical: 'border-red-500/40 bg-red-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-slate-600/40 bg-slate-800/30',
};

const SIGNAL_PAGE_LABELS: Record<string, [string, string]> = {
  followUps: ['المتابعات', 'Follow-ups'],
  capa: ['CAPA', 'CAPA'],
  complaints: ['الشكاوى', 'Complaints'],
  observations: ['ملاحظات الجودة', 'Quality observations'],
  travel: ['السفر', 'Travel'],
};

export function TopSignalsSection({ signals, canOpenPage, onOpenPage }: {
  signals: SignalItemView[];
  canOpenPage: (page: string) => boolean;
  onOpenPage: (page: string) => void;
}) {
  const { locale } = useLanguage();
  if (signals.length === 0) return null;
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
          <Activity className="h-4 w-4 text-emerald-400" />
          <T>أهم 3 إشارات</T>
          <span className="text-[10px] font-normal text-slate-500"><T>مستمدة من بيانات الفترة — كل رقم من مصدره الفعلي</T></span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {signals.map((s, i) => (
            <div key={s.code} className={cn('rounded-lg border px-3 py-2.5 space-y-1', SIGNAL_TONE[s.severity])}>
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-mono text-slate-600 shrink-0" dir="ltr">#{i + 1}</span>
                <p className="text-xs text-slate-200 leading-relaxed">{s.text}</p>
              </div>
              {s.drillPage && canOpenPage(s.drillPage) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="no-print h-5 px-1.5 text-[10px] text-emerald-400 hover:text-emerald-300"
                  onClick={() => onOpenPage(s.drillPage!)}
                >
                  {locale === 'en'
                    ? (SIGNAL_PAGE_LABELS[s.drillPage]?.[1] ?? 'Open the page')
                    : (SIGNAL_PAGE_LABELS[s.drillPage]?.[0] ?? 'فتح الصفحة')}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §15 WHAT CHANGED — current vs previous comparable period
// ─────────────────────────────────────────────────────────────

export function WhatChangedSection({ rows }: { rows: WhatChangedRowView[] }) {
  const { locale } = useLanguage();
  if (rows.length === 0) return null;
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
          <ArrowLeftRight className="h-4 w-4 text-emerald-400" />
          <T>ماذا تغير؟</T>
          <span className="text-[10px] font-normal text-slate-500"><T>مقارنة بالشهر المماثل السابق — تُعرض الفترات المتوفرة فقط</T></span>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] text-slate-500 border-b border-slate-700/50 pb-1">
          <span><T>المؤشر</T></span>
          <span className="tabular-nums w-16 text-end"><T>السابق</T></span>
          <span className="tabular-nums w-16 text-end"><T>الحالي</T></span>
          <span className="tabular-nums w-14 text-end"><T>التغير</T></span>
        </div>
        {rows.map((r) => (
          <div key={r.metric} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-xs">
            <span className="text-slate-300 truncate">
              {r.metricLabel}
              {r.isScore && <span className="text-slate-600 text-[10px]"> (%)</span>}
            </span>
            <span className="tabular-nums w-16 text-end text-slate-400" dir="ltr">{r.previousDisplay}</span>
            <span className="tabular-nums w-16 text-end text-slate-200 font-medium" dir="ltr">{r.currentDisplay}</span>
            <span className={cn(
              'tabular-nums w-14 text-end font-medium flex items-center justify-end gap-0.5',
              r.deltaPositive === true ? 'text-emerald-400' : r.deltaPositive === false ? 'text-red-400' : 'text-slate-500',
            )} dir="ltr">
              {r.deltaPositive === true ? <ArrowUpRight className="h-3 w-3" />
                : r.deltaPositive === false ? <ArrowDownRight className="h-3 w-3" />
                  : null}
              {r.deltaDisplay}
            </span>
          </div>
        ))}
        {/* locale kept for future per-locale ordering; rows are already localized */}
        <span className="hidden">{locale}</span>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §21 EXECUTIVE NARRATIVE (deterministic sentences)
// ─────────────────────────────────────────────────────────────

export function NarrativeSection({ sentences }: { sentences: NarrativeSentenceView[] }) {
  if (sentences.length === 0) return null;
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
          <Brain className="h-4 w-4 text-emerald-400" />
          <T>التحليل التنفيذي</T>
          <span className="text-[10px] font-normal text-slate-500"><T>مشتق من الأرقام أعلاه — بلا ذكاء اصطناعي</T></span>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">
          {sentences.map((s) => (
            <span key={s.code}>{s.text} </span>
          ))}
        </p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §5 KPI INTELLIGENCE — the FULL configured component breakdown
// ─────────────────────────────────────────────────────────────

export function KpiIntelligenceSection({ view }: { view: KpiIntelView }) {
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200 font-medium">
          <Target className="h-4 w-4 text-emerald-400" />
          <T>مكونات KPI المُهيأة</T>
          {view.schemeLabel && <span className="text-xs font-normal text-slate-500">{view.schemeLabel}</span>}
          {!view.configurationComplete && (
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300 bg-amber-500/10">
              <T>الحساب الكامل غير مكتمل</T>
            </Badge>
          )}
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700/50">
                <th className="text-start font-medium py-1.5 pe-2"><T>المكون</T></th>
                <th className="text-start font-medium py-1.5 pe-2"><T>الوزن</T></th>
                <th className="text-start font-medium py-1.5 pe-2"><T>الدرجة</T></th>
                <th className="text-start font-medium py-1.5 pe-2"><T>الإسهام</T></th>
                <th className="text-start font-medium py-1.5"><T>الحالة</T></th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.name} className="border-b border-slate-800/50 last:border-0">
                  <td className="py-1.5 pe-2 text-slate-200 font-medium">{row.name}</td>
                  <td className="py-1.5 pe-2 text-slate-300 tabular-nums" dir="ltr">{row.weightDisplay}</td>
                  <td className={cn('py-1.5 pe-2 tabular-nums', row.hasValue ? 'text-slate-200' : 'text-slate-500 italic')} dir="ltr">
                    {row.actualDisplay}
                  </td>
                  <td className={cn('py-1.5 pe-2 tabular-nums', row.hasValue ? 'text-slate-200' : 'text-slate-500 italic')} dir="ltr">
                    {row.contributionDisplay}
                  </td>
                  <td className="py-1.5">
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full border',
                      row.hasValue
                        ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                        : 'border-amber-500/30 text-amber-300 bg-amber-500/10',
                    )}>
                      {row.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-700/50">
                <td className="py-1.5 pe-2 text-slate-100 font-semibold"><T>إجمالي KPI (المتاح)</T></td>
                <td className="py-1.5 pe-2 text-slate-400 tabular-nums" dir="ltr">
                  {view.availableWeightDisplay ?? '—'}
                </td>
                <td className="py-1.5 pe-2" />
                <td className="py-1.5 pe-2 text-slate-100 font-semibold tabular-nums" dir="ltr">{view.weightedTotalDisplay}</td>
                <td className="py-1.5" />
              </tr>
            </tbody>
          </table>
        </div>
        {!view.configurationComplete && (
          <p className="text-[11px] text-amber-300/80">
            <T>مكونات بلا قيمة تُعرض كـ«قيد الانتظار/غير متاح» — لا تُحتسب صفرًا ولا تُستكمل بقيم مختلقة.</T>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §6-§8 QUALITY INTELLIGENCE — concentration table + patterns
// ─────────────────────────────────────────────────────────────

const PATTERN_TONE: Record<PatternView['severity'], string> = {
  info: 'border-slate-500/40 text-slate-300 bg-slate-500/10',
  warning: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  critical: 'border-red-500/40 text-red-300 bg-red-500/10',
};

export function QualityIntelligenceSection({ view, patterns }: { view: QualityIntelView; patterns: PatternView[] }) {
  const maxCount = view.concentration.length > 0 ? view.concentration[0].count : 0;
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200 font-medium">
          <Table2 className="h-4 w-4 text-emerald-400" />
          <T>تحليل الملاحظات وتركّز المشكلات</T>
          {view.topIssueLine && (
            <Badge variant="outline" className="text-[10px] border-brand-500/40 text-brand-300 bg-brand-500/10 font-normal">
              {view.topIssueLine}
            </Badge>
          )}
        </div>

        {view.concentration.length === 0 ? (
          <p className="text-xs text-slate-500 py-2"><T>لا ملاحظات جودة مسجلة في هذه الفترة</T></p>
        ) : (
          <div className="space-y-1.5">
            {/* §8 totals strip — the period's observation outcome counts */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px] font-normal border-sky-500/30 text-sky-300 bg-sky-500/10">
                <T>الإجمالي</T>: <span className="tabular-nums">{view.total}</span>
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                <T>معتمدة</T>: <span className="tabular-nums">{view.approved}</span>
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal border-amber-500/30 text-amber-300 bg-amber-500/10">
                <T>قيد الاعتماد</T>: <span className="tabular-nums">{view.pending}</span>
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal border-red-500/30 text-red-300 bg-red-500/10">
                <T>مرفوضة</T>: <span className="tabular-nums">{view.rejected}</span>
              </Badge>
            </div>
            {/* Analytical table: category | count | share | concentration bar */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] text-slate-500 border-b border-slate-700/50 pb-1">
              <span><T>فئة المشكلة</T></span>
              <span className="tabular-nums"><T>العدد</T></span>
              <span className="tabular-nums w-14 text-end"><T>النسبة</T></span>
            </div>
            {view.concentration.map((row) => (
              <div key={`${row.categoryName}`} className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-slate-200">{row.categoryName}</span>
                    <span className="text-slate-500 tabular-nums">({row.count})</span>
                  </div>
                  {/* concentration bar — share of the top category */}
                  {maxCount > 0 && (
                    <div className="h-1 mt-1 rounded-full bg-slate-700/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-500/60"
                        style={{ width: `${Math.max(4, Math.round((row.count / maxCount) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
                <span className="tabular-nums text-slate-300" dir="ltr">{row.count}</span>
                <span className="tabular-nums w-14 text-end text-slate-300" dir="ltr">{row.shareDisplay}</span>
              </div>
            ))}
          </div>
        )}

        {view.previousDeltaLine && (
          <p className="text-[11px] text-slate-400">{view.previousDeltaLine}</p>
        )}

        {patterns.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-700/40">
            {patterns.map((p, i) => (
              <Badge key={`${p.code}-${i}`} variant="outline" className={cn('text-[10px] font-normal', PATTERN_TONE[p.severity])}>
                {p.text}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1 border-t border-slate-700/40">
          <span><T>فئات مسجلة: </T><span className="text-slate-300 tabular-nums">{view.issueCategoryCount}</span></span>
          <span><T>عالية/حرجة: </T><span className="text-slate-300 tabular-nums">{view.highImpactCount}</span></span>
          <span><T>أنماط متكررة: </T><span className="text-slate-300 tabular-nums">{view.repeatedGroupCount}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §16 MANAGEMENT ATTENTION — WHAT / WHY / SOURCE + honest drills
// ─────────────────────────────────────────────────────────────

const ATTENTION_TONE: Record<AttentionItemView['severity'], string> = {
  critical: 'border-red-500/40 bg-red-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-slate-600/40 bg-slate-800/30',
};

const ATTENTION_PAGE_LABELS: Record<string, [string, string]> = {
  followUps: ['فتح المتابعات', 'Open follow-ups'],
  capa: ['فتح CAPA', 'Open CAPA'],
  complaints: ['فتح الشكاوى', 'Open complaints'],
  observations: ['فتح ملاحظات الجودة', 'Open quality observations'],
  travel: ['فتح السفر', 'Open travel'],
  attendance: ['فتح الحضور', 'Open attendance'],
  hrDeductions: ['فتح خصومات HR', 'Open HR deductions'],
};

export function ManagementAttentionSection({ items, canOpenPage, onOpenPage }: {
  items: AttentionItemView[];
  canOpenPage: (page: string) => boolean;
  onOpenPage: (page: string) => void;
}) {
  const { locale } = useLanguage();
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <T>يحتاج انتباه الإدارة</T>
          {items.length > 0 && (
            <Badge variant="outline" className="text-[10px] tabular-nums border-slate-600/60 text-slate-300">{items.length}</Badge>
          )}
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-400" />
            <T>لا إشارات تتطلب انتباهًا — كل المؤشرات تحت السيطرة</T>
          </p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <div key={item.id} className={cn('rounded-lg border px-3 py-2', ATTENTION_TONE[item.severity])}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold text-slate-100">{item.what}</span>
                  {item.drillPage && canOpenPage(item.drillPage) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-emerald-400 hover:text-emerald-300 no-print"
                      onClick={() => onOpenPage(item.drillPage!)}
                    >
                      {locale === 'en'
                        ? (ATTENTION_PAGE_LABELS[item.drillPage]?.[1] ?? 'Open the page')
                        : (ATTENTION_PAGE_LABELS[item.drillPage]?.[0] ?? 'فتح الصفحة')}
                    </Button>
                  )}
                </div>
                {item.why && <p className="text-[11px] text-slate-400 mt-0.5">{item.why}</p>}
                {/* §12/§54 — the SOURCE renders as a human-readable domain
                    label ("ملاحظات الجودة"); the internal rule id never
                    reaches the report, print or PDF. */}
                <p className="text-[10px] text-slate-500 mt-0.5">
                  <T>المصدر: </T>{item.source}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §23 DATA QUALITY — source availability matrix
// ─────────────────────────────────────────────────────────────

const DQ_TONE_CLASS: Record<DataQualityIntelView['rows'][number]['tone'], string> = {
  good: 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10',
  warn: 'border-amber-500/30 text-amber-300 bg-amber-500/10',
  bad: 'border-red-500/30 text-red-300 bg-red-500/10',
  neutral: 'border-slate-600/50 text-slate-400 bg-slate-800/40',
};

export function DataQualityIntelSection({ view }: { view: DataQualityIntelView }) {
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
          <BadgeCheck className="h-4 w-4 text-emerald-400" />
          <T>جودة البيانات وتوافر المصادر</T>
        </div>
        {/* §18 — one compact management matrix: AVAILABLE / NO DATA /
            NOT CONFIGURED / WITHHELD stay four DISTINCT states. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
          {view.rows.map((row) => (
            <div
              key={row.sourceLabel}
              className="flex items-center justify-between gap-2 border-b border-slate-800/50 py-1"
              title={row.periodCountDisplay ? `${row.sourceLabel}: ${row.periodCountDisplay}` : row.sourceLabel}
            >
              <span className="text-xs text-slate-300 truncate">{row.sourceLabel}</span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap', DQ_TONE_CLASS[row.tone])}>
                {row.availabilityLabel}
              </span>
            </div>
          ))}
        </div>
        {view.unattributedChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-700/40">
            <span className="text-[10px] text-slate-500"><T>سجلات تعذر إسنادها لفترة (استُثنت دون تخمين): </T></span>
            {view.unattributedChips.map((u) => (
              <Badge key={u.label} variant="outline" className="text-[10px] font-normal border-amber-500/30 text-amber-300 bg-amber-500/10">
                {u.label}: <span className="tabular-nums">{u.count}</span>
              </Badge>
            ))}
          </div>
        )}
        {view.noteLines.length > 0 && (
          <ul className="text-[10px] text-slate-500 space-y-0.5">
            {view.noteLines.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-slate-500">
          <T>«لا بيانات في الفترة» تعني غياب سجلات — وليس أداءً جيدًا أو سيئًا. الأقسام المحجوبة تُستقطع من الخادم وفق الصلاحيات.</T>
        </p>
      </CardContent>
    </Card>
  );
}
