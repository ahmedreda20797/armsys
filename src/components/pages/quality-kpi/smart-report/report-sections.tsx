'use client';

// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Section Components (Phase 4)
//
//  Presentation-only building blocks over the view models derived
//  from the Performance Intelligence dataset. Every displayed number
//  arrives already computed by the analytical layer — these
//  components NEVER recalculate, aggregate or infer anything.
//
//  Design language (spec §22): the existing ARM dark-slate palette,
//  compact enterprise density (spec §21), no AI clichés, no
//  interpretation copy (spec §9/§19/§30).
// ══════════════════════════════════════════════════════════════

import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  Activity,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Link2,
  MessageSquareWarning,
  Plane,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { presentEntity } from '@/lib/i18n/presentation';
import { formatInteger, unitWord } from '@/lib/i18n/format';
import {
  EVIDENCE_COLLECTIONS,
  isEvidenceCollection,
  type EvidenceCollection,
} from '@/lib/evidence/evidence-collections';
import type { ProjectedRecord } from '@/lib/evidence/record-projection';
import {
  buildEvidenceSummary,
  type EvidenceAccess,
} from '@/lib/evidence/evidence-summaries';
import { useEvidenceSummaries } from '@/hooks/use-evidence';
import { ValueBasisBadge } from '../kpi-reports-shared';
import {
  type AttendanceView,
  type CapaView,
  type ChipFact,
  type ComplaintsView,
  type DealsView,
  type DeductionsView,
  type EvidenceGroupView,
  type FollowUpsView,
  type KeyValueFact,
  type ReportHeaderView,
  type Tone,
  type TrendView,
} from './view-model';

// ─────────────────────────────────────────────────────────────
//  Primitives
// ─────────────────────────────────────────────────────────────

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bad: 'bg-red-500/15 text-red-300 border-red-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  accent: 'bg-brand-500/15 text-brand-300 border-brand-500/30',
};

/** Compact count chip — a fact with its stored count (no re-aggregation). */
export function CountChip({ label, count, tone = 'neutral' }: { label: string; count: number; tone?: Tone }) {
  const { locale } = useLanguage();
  return (
    <Badge variant="outline" className={cn('font-normal whitespace-nowrap text-[11px]', TONE_CLASSES[tone])}>
      {label}: <span className="font-mono mx-1 tabular-nums">{formatInteger(count, locale)}</span>
    </Badge>
  );
}

/** A single label/value fact — explicit unavailable state when absent. */
export function Fact({ label, value, unavailable }: { label: string; value: string; unavailable?: boolean }) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div
        className={cn(
          'text-sm font-semibold truncate',
          unavailable ? 'text-slate-500 font-normal italic' : 'text-slate-200',
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

export function FactGrid({ facts, cols = 4 }: { facts: KeyValueFact[]; cols?: 3 | 4 | 6 }) {
  const colClass = cols === 3 ? 'sm:grid-cols-3' : cols === 6 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4';
  return (
    <div className={cn('grid grid-cols-2 gap-x-4 gap-y-3', colClass)}>
      {facts.map((f) => (
        <Fact key={f.label} label={f.label} value={f.value} unavailable={f.unavailable} />
      ))}
    </div>
  );
}

/** Compact section card — uniform enterprise density (spec §21). */
export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card data-report-card className={cn('bg-slate-800/30 border-slate-700/40 print:border-slate-300', className)}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm text-slate-200 flex items-center gap-2 flex-wrap">
          <Icon className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{title}</span>
          {subtitle && <span className="text-xs font-normal text-slate-500">{subtitle}</span>}
          {actions && <span className="mr-auto no-print">{actions}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-3">{children}</CardContent>
    </Card>
  );
}

/** Inline empty state for a section with zero stored records. */
export function SectionEmpty({ message }: { message?: string }) {
  const { t } = useLanguage();
  return <p className="text-xs text-slate-500 py-2">{message ?? t('smart.empty')}</p>;
}

function ChipRow({ chips }: { chips: ChipFact[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <CountChip key={c.label} label={c.label} count={c.count} tone={c.tone} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  §3  Employee report header — COMPACT (§5)
// ─────────────────────────────────────────────────────────────

/**
 * §5 COMPACT HEADER — the whole identity block fits ~3 light rows:
 *   title row (document name + logo) · name row · context row ·
 *   period row. No oversized title area, no per-field borders, no
 *   large empty block. §10 — the REAL Qnalys logo asset (never a
 *   recreation): dark-theme wordmark on screen, the print variant on
 *   light theme AND on paper (both assets render; CSS picks one).
 */
export function ReportHeaderSection({ view }: { view: ReportHeaderView }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="px-4 py-3 space-y-2">
        {/* Row 1 — document title + brand lockup (balanced, not dominant) */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <p className="text-[11px] font-medium text-slate-500"><T>تقرير الجودة والأداء الذكي</T></p>
            {/* §19 — the report shows VERIFIED FACTS only (no AI layer). */}
            <Badge variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[9px] no-print">
              <T>حقائق موثقة</T>
            </Badge>
          </div>
          <div className="shrink-0" dir="ltr">
            <img
              src={mounted && resolvedTheme === 'light' ? '/qnlys-print.svg' : '/qnlys.svg'}
              alt="Qnalys"
              className="h-8 w-auto object-contain print:hidden"
            />
            <img
              src="/qnlys-print.svg"
              alt="Qnalys"
              className="h-8 w-auto object-contain hidden print:block"
            />
          </div>
        </div>

        {/* Row 2 — the EMPLOYEE is the primary identity; the code is
            secondary; lifecycle warnings stay inline. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-lg font-bold text-slate-100 leading-tight">{view.employeeName}</h2>
          {view.employeeCode && (
            <span className="text-xs font-mono text-slate-400" dir="ltr">({view.employeeCode})</span>
          )}
          {view.lifecycleBadges.map((b) => (
            <Badge key={b.label} variant="outline" className={cn('text-[10px]', TONE_CLASSES[b.tone])}>
              {b.label}
            </Badge>
          ))}
        </div>

        {/* Row 3 — position · organizational location · manager as ONE
            compact metadata line (§5/§6 semantics, no field borders). */}
        {view.contextSegments.length > 0 && (
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {view.contextSegments.map((segment, i) => (
              <span key={segment} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <span className="text-slate-600">·</span>}
                <span className="truncate">{segment}</span>
              </span>
            ))}
          </p>
        )}

        {/* Row 4 — period + provenance, visually secondary (§5). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 border-t border-slate-700/40 pt-2">
          <span>
            <T>الفترة: </T>
            <span className="text-slate-300 font-medium">{view.periodLabel}</span>
          </span>
          <ValueBasisBadge basis={view.valueBasis} />
          <span><T>تاريخ الإصدار: </T>{view.generatedAtLabel}</span>
          {view.schemeLabel && <span className="text-slate-500">{view.schemeLabel}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §7  Performance trend
// ─────────────────────────────────────────────────────────────

export function TrendSection({ view }: { view: TrendView }) {
  const { t, locale } = useLanguage();
  return (
    <SectionCard icon={Activity} title={t('smart.section.trend')} subtitle={t('smart.section.trendSub')}>
      {view.insufficient ? (
        <p className="text-sm text-slate-400 py-3 text-center"><T>لا توجد بيانات تاريخية كافية لعرض الاتجاه</T></p>
      ) : (
        /* §12 — the section shows the monthly series only; the MoM
            comparison lives ONCE in "What Changed" (no repeated -16). */
        <div className="flex flex-wrap gap-2">
          {view.points.map((p) => (
            <Badge
              key={p.monthKey}
              variant="outline"
              className={cn(
                'font-mono text-[11px] whitespace-nowrap',
                p.available
                  ? 'bg-slate-800/50 text-slate-200 border-slate-700/60'
                  : 'bg-slate-900/40 text-slate-600 border-slate-800',
              )}
              title={p.available ? undefined : translateUIText('شهر بدون نتيجة — لا يُعرض كصفر', locale)}
            >
              {p.monthLabel}: {p.scoreDisplay}
              {p.available && p.finalized ? ' 🔒' : ''}
            </Badge>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §10  Quality deductions
// ─────────────────────────────────────────────────────────────

export function DeductionsSection({ view, canDrill, onDrill }: {
  view: DeductionsView;
  canDrill: boolean;
  onDrill: () => void;
}) {
  const { t, locale } = useLanguage();
  // §16 — the executive report carries the SUMMARY only (count, totals,
  // highest deduction, top category). Detailed reasons stay in the
  // dedicated deductions view (permission-gated) — never in this report.
  return (
    <SectionCard icon={Scale} title={t('smart.section.deductions')} subtitle={<T>ملخص خصومات الجودة للفترة</T>}>
      {view.empty ? (
        <SectionEmpty message={translateUIText('خصومات الجودة: لا توجد خصومات مسجلة خلال الفترة.', locale)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label={translateUIText('عدد الخصومات', locale)} count={view.count} tone="warn" />
            <CountChip label={translateUIText('إجمالي الأيام', locale)} count={view.totalDays} tone="bad" />
            <CountChip label={translateUIText('إجمالي المبلغ', locale)} count={view.totalAmount} tone="bad" />
          </div>
          {view.typeChips.length > 0 && <ChipRow chips={view.typeChips} />}
          {view.highestLine && (
            <p className="text-[11px] text-slate-400 border-t border-slate-700/40 pt-2">{view.highestLine}</p>
          )}
          {canDrill && (
            <Button
              variant="ghost"
              size="sm"
              className="no-print h-7 px-2 text-[11px] text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10"
              onClick={(e) => { e.stopPropagation(); onDrill(); }}
            >
              <T>عرض تفاصيل الخصومات</T>
            </Button>
          )}
          <p className="text-[10px] text-slate-600">
            <T>التفاصيل والأسباب تُعرض في تقرير الخصومات المخصص وفق الصلاحيات.</T>
          </p>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §11  Complaints
// ─────────────────────────────────────────────────────────────

export function ComplaintsSection({ view }: { view: ComplaintsView }) {
  const { t, locale } = useLanguage();
  const indirect = view.relationship === 'INDIRECT';
  return (
    <SectionCard
      icon={MessageSquareWarning}
      title={t('smart.section.complaints')}
      subtitle={<><T>الإسناد: </T>{view.relationshipLabel}</>}
    >
      {indirect ? (
        <p className="text-xs text-amber-300/90 border-r-2 border-amber-500/40 pr-2">
          <T>ارتباط غير مباشر فقط — لا يُسند هذه الشكاوى إلى الموظف مباشرة، وتُعرض كسياق منفصل دون نسبة تأكيدية.</T>
        </p>
      ) : null}
      {view.total === 0 ? (
        /* §18 — a zero is a compact meaningful line, never a large card. */
        <SectionEmpty message={translateUIText('الشكاوى: لا توجد حالات مسجلة خلال الفترة.', locale)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label={t('smart.col.total')} count={view.total} tone="info" />
            <CountChip label={translateUIText('محلولة/مغلقة', locale)} count={view.resolvedOrClosed} tone="good" />
            <CountChip label={translateUIText('مفتوحة', locale)} count={view.stillOpen} tone="warn" />
            {view.viaDealCount > 0 && <CountChip label={translateUIText('عبر صفقة', locale)} count={view.viaDealCount} tone="neutral" />}
          </div>
          <ChipRow chips={view.statusChips} />
          <ChipRow chips={view.typeChips} />
          <ChipRow chips={view.severityChips} />
          {view.repeatedTypes.length > 0 && (
            <div className="text-[11px] text-slate-500">
              <T>أنواع متكررة: </T>{view.repeatedTypes.map((t) => `${t.label} (${formatInteger(t.count, locale)})`).join('، ')}
            </div>
          )}
          <div className="text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            <T>متوسط زمن الحل: </T><span className="font-mono tabular-nums text-slate-200">{view.avgResolutionDisplay}</span>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §12  CAPA
// ─────────────────────────────────────────────────────────────

export function CapaSection({ view }: { view: CapaView }) {
  const { t, locale } = useLanguage();
  return (
    <SectionCard icon={ShieldCheck} title={t('smart.section.capa')} subtitle={<>{t('smart.section.capaSub')}: {view.relationshipLabel}</>}>
      {view.total === 0 ? (
        /* §18 — a zero is a compact meaningful line, never a large card. */
        <SectionEmpty message={translateUIText('حالات CAPA: لا توجد حالات مسجلة خلال الفترة.', locale)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label={t('smart.col.total')} count={view.total} tone="info" />
            <CountChip label={translateUIText('نشطة', locale)} count={view.active} tone="warn" />
            <CountChip label={translateUIText('مغلقة/نهائية', locale)} count={view.terminal} tone="good" />
            <CountChip label={translateUIText('متأخرة (SLA النظام)', locale)} count={view.overdue} tone="bad" />
            {view.indirectCount > 0 && <CountChip label={translateUIText('ارتباط غير مباشر', locale)} count={view.indirectCount} tone="neutral" />}
          </div>
          <ChipRow chips={view.statusChips} />
          <ChipRow chips={view.priorityChips} />
          <ChipRow chips={view.sourceChips} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-700/40 pt-2">
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-500"><T>حالة الإجراء التصحيحي</T></div>
              <ChipRow chips={view.correctiveChips} />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-500"><T>حالة الإجراء الوقائي</T></div>
              <ChipRow chips={view.preventiveChips} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            <span>
              <T>مغلقة: </T><span className="font-mono tabular-nums text-slate-200">{formatInteger(view.closedCount, locale)}</span>
            </span>
            <span>
              <T>متوسط زمن الإغلاق: </T><span className="font-mono tabular-nums text-slate-200">{view.avgClosureDisplay}</span>
            </span>
            <span>
              <T>متوسط أيام التأخر: </T><span className="font-mono tabular-nums text-slate-200">{view.avgOverdueDisplay}</span>
            </span>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §13  Follow-ups
// ─────────────────────────────────────────────────────────────

export function FollowUpsSection({ view }: { view: FollowUpsView }) {
  const { t, locale } = useLanguage();
  return (
    <SectionCard icon={ClipboardCheck} title={t('smart.section.followUps')} subtitle={t('smart.section.followUpsSub')}>
      {view.total === 0 ? (
        /* §18 — a zero is a compact meaningful line, never a large card. */
        <SectionEmpty message={translateUIText('المتابعات: لا توجد متابعات مسجلة خلال الفترة.', locale)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label={t('smart.col.total')} count={view.total} tone="info" />
            <CountChip label={translateUIText('مكتملة', locale)} count={view.completed} tone="good" />
            <CountChip label={translateUIText('معلّقة (نشطة)', locale)} count={view.active} tone="warn" />
            <CountChip label={translateUIText('متأخرة (قاعدة النظام)', locale)} count={view.overdue} tone="bad" />
            <CountChip label={translateUIText('مستحقة اليوم', locale)} count={view.dueToday} tone="warn" />
          </div>
          <ChipRow chips={view.statusChips} />
          <ChipRow chips={view.typeChips} />
          <ChipRow chips={view.priorityChips} />
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            <span>
              <T>نسبة الإكمال: </T><span className="font-mono tabular-nums text-slate-200">{view.completionRateDisplay}</span>
            </span>
            <span>
              <T>تأخر الإكمال: </T><span className="font-mono tabular-nums text-slate-200">{view.avgOverdueDisplay}</span>
            </span>
            <span title={view.onTimeNote}>
              <T>الإنجاز في الموعد: </T><span className="font-mono tabular-nums text-slate-500 italic">{view.onTimeRateDisplay}</span>
              <span className="text-[10px] text-slate-600"> — {view.onTimeNote}</span>
            </span>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §14  Travel deals / operational context
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
//  §14/§35-§36  Deal performance — explicit date semantics + drills
// ─────────────────────────────────────────────────────────────

/** §40 — the deal questions a metric may drill into (the page owns navigation). */
export type DealDrillTarget = 'closed' | 'confirmed' | 'cancelled' | 'current' | 'travel' | 'completed';

export function DealsSection({ view, canDrill, onDrill }: {
  view: DealsView;
  canDrill: boolean;
  onDrill: (target: DealDrillTarget) => void;
}) {
  const { t, locale } = useLanguage();
  // §DEAL-DATES/§32-§36 — every count carries its EXPLICIT semantics;
  // the closure breakdown reconciles with the headline population
  // (confirmed + cancelled + still-active = closed during period).
  const hasAnyDealData = view.closedWithEmployeeTotal > 0
    || view.travelTotal > 0
    || view.closedTotal > 0
    || view.currentDeals > 0;

  const drill = (target: DealDrillTarget, e: ReactMouseEvent) => {
    e.stopPropagation();
    onDrill(target);
  };

  return (
    <SectionCard icon={Plane} title={t('smart.section.deals')} subtitle={<T>أداء الصفقات — أساس تاريخ صريح لكل رقم</T>}>
      {!hasAnyDealData ? (
        <SectionEmpty message={translateUIText('صفقات السفر: لا توجد صفقات مرتبطة بالموظف خلال الفترة.', locale)} />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {([
              {
                target: 'closed' as DealDrillTarget,
                label: <T>تقفيلات الفترة</T>,
                hint: <T>تاريخ تقفيل الديل · أي حالة حالية</T>,
                value: view.closedWithEmployeeInPeriod, tone: 'text-slate-100',
              },
              {
                target: 'confirmed' as DealDrillTarget,
                label: <T>التقفيلات المؤكدة</T>,
                hint: <T>حالة حالية: مكتملة</T>,
                value: view.confirmedClosures, tone: 'text-emerald-300',
              },
              {
                target: 'cancelled' as DealDrillTarget,
                label: <T>التقفيلات الملغاة</T>,
                hint: <T>أُغلقت ثم أُلغيت لاحقًا</T>,
                value: view.cancelledClosures, tone: 'text-red-300',
              },
              {
                target: 'current' as DealDrillTarget,
                label: <T>الصفقات الحالية</T>,
                hint: <T>الحالة الحالية: تعديل/جاري</T>,
                value: view.currentDeals, tone: 'text-sky-300',
              },
              {
                target: 'travel' as DealDrillTarget,
                label: <T>رحلات السفر</T>,
                hint: <T>تاريخ المغادرة</T>,
                value: view.travelTotal, tone: 'text-slate-200',
              },
              {
                target: 'completed' as DealDrillTarget,
                label: <T>المكتملات المرصودة</T>,
                hint: <T>تاريخ الاكتمال</T>,
                value: view.closedTotal, tone: 'text-slate-200',
              },
            ] as const).map((tile) => (
              <div
                key={tile.target}
                className={cn(
                  'rounded-xl bg-slate-900/40 border border-slate-700/40 p-3 space-y-0.5',
                  canDrill && 'cursor-pointer hover:border-emerald-500/40 transition-colors',
                )}
                onClick={canDrill ? (e) => drill(tile.target, e) : undefined}
                title={canDrill ? translateUIText('عرض السجلات المطابقة في صفحة السفر', locale) : undefined}
              >
                <div className="text-[10px] text-slate-500">{tile.label}</div>
                <div className={cn('text-2xl font-bold tabular-nums', tile.tone)} dir="ltr">
                  {formatInteger(tile.value, locale)}
                </div>
                <div className="text-[9px] text-slate-600">{tile.hint}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500 border-t border-slate-700/40 pt-2">
            <span title={translateUIText('المؤكدة + الملغاة + الجارية = تقفيلات الفترة', locale)}>
              <T>تطابق التقفيلات: </T>
              <span className="font-mono tabular-nums text-slate-300" dir="ltr">
                {formatInteger(view.confirmedClosures, locale)} + {formatInteger(view.cancelledClosures, locale)} + {formatInteger(view.stillActiveClosures, locale)} = {formatInteger(view.closedWithEmployeeInPeriod, locale)}
              </span>
            </span>
            {view.closedUnknownMonth > 0 && (
              <span title={translateUIText('لا يوجد طابع زمني موثوق لتقفيل هذه الصفقات — لا تُنسب لأي شهر', locale)}>
                <T>تقفيلات بتاريخ غير محدد: </T>
                <span className="font-mono tabular-nums text-slate-300">{formatInteger(view.closedUnknownMonth, locale)}</span>
              </span>
            )}
          </div>

          {view.statusAllTime.length > 0 && (
            <p className="text-[10px] text-slate-500">
              <T>الحالة الحالية (كل الفترات): </T>
              {view.statusAllTime.map((s) => `${s.label} ${formatInteger(s.count, locale)}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §15  Attendance context (never part of Quality KPI)
// ─────────────────────────────────────────────────────────────

export function AttendanceSection({ view }: { view: AttendanceView }) {
  const { t } = useLanguage();
  return (
    <SectionCard icon={Clock} title={t('smart.section.attendance')} subtitle={t('smart.section.attendanceSub')}>
      {!view.available ? (
        <p className="text-xs text-slate-500 py-2">
          <T>لا توجد نتيجة شهرية مخزّنة لهذه الفترة (غير متاح — لا يُعرض كصفر)</T>
        </p>
      ) : (
        <FactGrid facts={view.facts} cols={3} />
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §16/§17  Evidence — traceability + counts (Phase 5.2)
//
//  Human-readable evidence cards (spec §32) replace the raw-ID
//  list as the PRIMARY presentation: each row shows the Arabic
//  record title + meta lines, with the raw id kept secondary and
//  [عرض الدليل] opening the Evidence Preview modal (§30). Summaries
//  load ON DEMAND — one batched request per expanded group (§38).
// ─────────────────────────────────────────────────────────────

export interface EvidenceDetailSelection {
  collection: EvidenceCollection;
  recordId: string;
  projected: ProjectedRecord | null;
  access: EvidenceAccess;
}

/**
 * On-demand summary rows for ONE evidence group. Mounted only while
 * the group Collapsible is open (Radix unmounts closed content), so
 * the batched query fires exactly when the user asks for it.
 */
function EvidenceRecordRows({
  collection,
  recordIds,
  onViewEvidence,
}: {
  collection: EvidenceCollection;
  recordIds: string[];
  onViewEvidence: (selection: EvidenceDetailSelection) => void;
}) {
  const collectionTitle = EVIDENCE_COLLECTIONS[collection]?.title ?? presentEntity(collection, 'ar');
  const summariesQuery = useEvidenceSummaries(collection, recordIds, true);

  if (summariesQuery.isLoading) {
    return (
      <div className="space-y-1.5 py-1" aria-busy>
        {recordIds.slice(0, 3).map((id) => (
          <Skeleton key={id} className="h-9 w-full bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (summariesQuery.isError || !summariesQuery.data) {
    // Degrade to an explicit localized state — raw record IDs are
    // never rendered as visible content (§PRESENTATION-BOUNDARY).
    return (
      <div className="rounded-b-lg border border-t-0 border-slate-700/40 bg-slate-900/20 px-4 py-2 max-h-48 overflow-y-auto arm-scroll">
        <p className="text-[10px] text-amber-300/70"><T>تعذر تحميل ملخصات الأدلة — أعد فتح القسم للمحاولة مجدداً.</T></p>
      </div>
    );
  }

  const byId = new Map(summariesQuery.data.records.map((r) => [r.recordId, r]));
  return (
    <div className="rounded-b-lg border border-t-0 border-slate-700/40 bg-slate-900/20 px-4 py-2 max-h-64 overflow-y-auto arm-scroll">
      <ul className="space-y-1.5" data-testid="evidence-summary-list">
        {recordIds.map((recordId) => {
          const entry = byId.get(recordId);
          const access = (entry?.access ?? 'not_found') as EvidenceAccess;
          const summary = buildEvidenceSummary(
            collectionTitle,
            recordId,
            entry?.record ?? null,
            access,
          );
          return (
            <li
              key={recordId}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/60 bg-slate-900/40 px-2.5 py-1.5"
              data-testid="evidence-summary-row"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] text-slate-200" title={recordId}>
                  <span className="font-medium">{summary.title}</span>
                  {summary.metaLines.length > 0 && (
                    <span className="text-slate-400"> — {summary.metaLines.join(' · ')}</span>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="no-print h-6 shrink-0 px-2 text-[11px] text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10"
                data-testid="evidence-view-detail"
                onClick={() => onViewEvidence({
                  collection,
                  recordId,
                  projected: entry?.record ?? null,
                  access,
                })}
              >
                <T>عرض الدليل</T>
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function EvidenceSection({
  groups,
  canOpenPage,
  onOpenPage,
  onViewEvidence,
}: {
  groups: EvidenceGroupView[];
  canOpenPage: (page: string) => boolean;
  onOpenPage: (page: string) => void;
  onViewEvidence: (selection: EvidenceDetailSelection) => void;
}) {
  const { t, locale } = useLanguage();
  const totalEvidence = groups.reduce((sum, g) => sum + g.count, 0);
  return (
    <SectionCard
      icon={Link2}
      title={t('smart.section.evidence')}
      subtitle={<><T>إجمالي السجلات المرجعية: </T>{formatInteger(totalEvidence, locale)}</>}
    >
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <CountChip
            key={g.collection}
            label={g.label}
            count={g.count}
            tone={g.count > 0 ? 'accent' : 'neutral'}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        {groups.filter((g) => g.count > 0).length === 0 && <SectionEmpty message={translateUIText('لا توجد سجلات مرجعية لهذه الفترة', locale)} />}
        {groups
          .filter((g) => g.count > 0)
          .map((g) => (
            <Collapsible key={g.collection}>
              <div className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/30 px-3 py-2">
                <CollapsibleTrigger className="group flex flex-1 items-center gap-2 text-right min-w-0">
                  <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
                  <span className="text-xs text-slate-300">{g.label}</span>
                  <span className="mr-auto text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                    {formatInteger(g.count, locale)} {unitWord(g.count === 1 ? 'record' : 'records', locale)}
                  </span>
                </CollapsibleTrigger>
                {g.targetPage && canOpenPage(g.targetPage) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="no-print h-7 px-2 text-[11px] text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10"
                    onClick={() => onOpenPage(g.targetPage as string)}
                  >
                    <T>فتح صفحة المصدر</T>
                  </Button>
                )}
              </div>
              <CollapsibleContent>
                {isEvidenceCollection(g.collection) ? (
                  <EvidenceRecordRows
                    collection={g.collection}
                    recordIds={g.recordIds}
                    onViewEvidence={onViewEvidence}
                  />
                ) : (
                  <div className="rounded-b-lg border border-t-0 border-slate-700/40 bg-slate-900/20 px-4 py-2 max-h-48 overflow-y-auto arm-scroll">
                    <p className="text-[10px] text-slate-500">
                      <T>سجلات مرجعية بلا معاينة متاحة</T> — {formatInteger(g.recordIds.length, locale)}
                    </p>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          ))}
      </div>
      <p className="text-[10px] text-slate-600">
        <T>تُفتح سجلات المصدر فقط ضمن الصفحات المخوّلة لمستخدمك — الربط يحترم صلاحيات كل صفحة.</T>
      </p>
    </SectionCard>
  );
}
