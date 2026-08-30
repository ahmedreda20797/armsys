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

import { useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Eye,
  Gauge,
  Layers,
  Link2,
  MessageSquareWarning,
  Plane,
  Repeat,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { StatusBadge, ValueBasisBadge } from '../kpi-reports-shared';
import {
  UNAVAILABLE,
  type AttendanceView,
  type CapaView,
  type ChipFact,
  type ComplaintsView,
  type DataQualityView,
  type DealsView,
  type DeductionsView,
  type EvidenceGroupView,
  type FollowUpsView,
  type KeyValueFact,
  type KpiComponentsView,
  type KpiHeroView,
  type ObservationsView,
  type ReportHeaderView,
  type RepeatedIssuesView,
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
  accent: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

/** Compact count chip — a fact with its stored count (no re-aggregation). */
export function CountChip({ label, count, tone = 'neutral' }: { label: string; count: number; tone?: Tone }) {
  return (
    <Badge variant="outline" className={cn('font-normal whitespace-nowrap text-[11px]', TONE_CLASSES[tone])}>
      {label}: <span className="font-mono mx-1 tabular-nums">{count}</span>
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
  subtitle?: string;
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
export function SectionEmpty({ message = 'لا توجد سجلات لهذه الفترة' }: { message?: string }) {
  return <p className="text-xs text-slate-500 py-2">{message}</p>;
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
//  §3  Employee report header
// ─────────────────────────────────────────────────────────────

export function ReportHeaderSection({ view }: { view: ReportHeaderView }) {
  return (
    <Card data-report-card className="bg-slate-800/30 border-slate-700/40 print:border-slate-300">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">{view.employeeName}</h2>
              {view.employeeCode && (
                <span className="text-xs font-mono text-slate-400">({view.employeeCode})</span>
              )}
              {view.lifecycleBadges.map((b) => (
                <Badge key={b.label} variant="outline" className={cn('text-[10px]', TONE_CLASSES[b.tone])}>
                  {b.label}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              {view.periodLabel}
              <span className="mx-1.5 text-slate-600">·</span>
              <ValueBasisBadge basis={view.valueBasis} />
            </p>
          </div>
          {/* §19 — the report shows VERIFIED FACTS only (no AI layer). */}
          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px] no-print">
            حقائق موثقة — VERIFIED FACTS
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 pt-1 border-t border-slate-700/40">
          {view.facts.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} unavailable={f.unavailable} />
          ))}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1 border-t border-slate-700/40">
          <span className="text-slate-500">
            مخطط KPI: {view.schemeLabel ?? <span className="italic">{UNAVAILABLE}</span>}
          </span>
          <span className="text-slate-500 font-mono">
            {view.datasetKind}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §4  KPI hero — raw score vs weighted contribution
// ─────────────────────────────────────────────────────────────

export function KpiHeroSection({ view }: { view: KpiHeroView }) {
  return (
    <SectionCard icon={Gauge} title="موقع جودة KPI" subtitle="درجة الجودة مقابل المساهمة الموزونة">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl bg-slate-900/40 border border-slate-700/40 p-4 space-y-1">
          <div className="text-[11px] text-slate-500">درجة الجودة (خام)</div>
          <div className="text-3xl font-bold text-slate-100 tabular-nums">{view.rawScoreDisplay}</div>
          <div className="text-[11px] text-slate-500">Raw Quality Score — مخرج المحرك كما هو</div>
        </div>
        <div className="rounded-xl bg-slate-900/40 border border-slate-700/40 p-4 space-y-1">
          <div className="text-[11px] text-slate-500">
            المساهمة الموزونة{view.weightPercent !== null ? ` (وزن ${view.weightPercent}%)` : ''}
          </div>
          <div className="text-3xl font-bold text-emerald-300 tabular-nums">{view.contributionDisplay}</div>
          <div className="text-[11px] text-slate-500">Quality Contribution — وليست KPI الشركة</div>
        </div>
        <div className="rounded-xl bg-slate-900/40 border border-slate-700/40 p-4 space-y-2">
          <div className="text-[11px] text-slate-500">حالة KPI</div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={view.rowStatusLabel} />
            {view.overallStatusLabel && view.overallStatusLabel !== view.rowStatusLabel && (
              <StatusBadge status={view.overallStatusLabel} />
            )}
          </div>
          <div className="text-[11px] text-slate-500">
            المجموع الموزون المتاح: {view.weightedTotalDisplay ?? UNAVAILABLE}
            {view.availableWeightDisplay !== null ? ` / وزن متاح ${view.availableWeightDisplay}` : ''}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs pt-1 border-t border-slate-700/40">
        {view.previousScoreDisplay && (
          <span className="text-slate-400">
            الشهر السابق: <span className="font-mono tabular-nums text-slate-200">{view.previousScoreDisplay}</span>
          </span>
        )}
        {view.deltaDisplay && (
          <span className="text-slate-400">
            التغير:{' '}
            <span
              className={cn(
                'font-mono tabular-nums',
                view.deltaToneValue === 'good' && 'text-emerald-300',
                view.deltaToneValue === 'bad' && 'text-red-300',
              )}
            >
              {view.deltaDisplay} نقطة مئوية
            </span>
          </span>
        )}
        {view.directionLabel && <span className="text-slate-400">{view.directionLabel}</span>}
        {!view.previousScoreDisplay && !view.deltaDisplay && (
          <span className="text-slate-500 italic">لا توجد مقارنة شهر سابق متاحة</span>
        )}
      </div>

      {view.outcomeMessage && (
        <p className="text-xs text-amber-300/90 border-r-2 border-amber-500/40 pr-2">{view.outcomeMessage}</p>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §5  KPI component status
// ─────────────────────────────────────────────────────────────

export function KpiComponentsSection({ view }: { view: KpiComponentsView }) {
  return (
    <SectionCard icon={Layers} title="مكونات مخطط KPI" subtitle="عرض معلوماتي — لا يُحسب أي مكون ناقص هنا">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-700/50">
            <TableHead className="text-right h-9">المكون</TableHead>
            <TableHead className="text-right h-9">المساهمة / الحد الأقصى</TableHead>
            <TableHead className="text-right h-9">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.rows.map((row) => (
            <TableRow key={row.label} className={cn('border-slate-800/60', row.isOverall && 'bg-slate-900/30')}>
              <TableCell className={cn('text-slate-200', row.isOverall && 'font-bold')}>
                {row.label}
              </TableCell>
              <TableCell className="font-mono tabular-nums text-slate-200">{row.contributionDisplay}</TableCell>
              <TableCell>
                {row.available ? (
                  <StatusBadge status={row.statusLabel} />
                ) : (
                  <Badge variant="outline" className="bg-slate-600/20 text-slate-400 border-slate-600/40 text-[11px] font-mono">
                    NOT AVAILABLE
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {view.hasUnavailableComponents && (
        <p className="text-[11px] text-slate-500">
          مكونات المخطط الإضافية غير متاحة في بيانات هذه الفترة — تُعرض كما يوفرها المحرك دون أي حساب بديل.
        </p>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §7  Performance trend
// ─────────────────────────────────────────────────────────────

export function TrendSection({ view }: { view: TrendView }) {
  return (
    <SectionCard icon={Activity} title="اتجاه الأداء" subtitle="درجة الجودة الخام عبر نافذة التحليل">
      {view.insufficient ? (
        <p className="text-sm text-slate-400 py-3 text-center">لا توجد بيانات تاريخية كافية لعرض الاتجاه</p>
      ) : (
        <>
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
                title={p.available ? undefined : 'شهر بدون نتيجة — لا يُعرض كصفر'}
              >
                {p.monthLabel}: {p.scoreDisplay}
                {p.available && p.finalized ? ' 🔒' : ''}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs border-t border-slate-700/40 pt-2">
            {view.previousMonthLabel && view.previousScoreDisplay && (
              <span className="text-slate-400">
                {view.previousMonthLabel}: <span className="font-mono tabular-nums">{view.previousScoreDisplay}</span>
              </span>
            )}
            {view.deltaDisplay && (
              <span className="text-slate-400">
                التغير عن الشهر السابق:{' '}
                <span
                  className={cn(
                    'font-mono tabular-nums',
                    view.deltaToneValue === 'good' && 'text-emerald-300',
                    view.deltaToneValue === 'bad' && 'text-red-300',
                  )}
                >
                  {view.deltaDisplay} نقطة مئوية
                </span>
              </span>
            )}
            {view.directionLabel && <span className="text-slate-400">{view.directionLabel}</span>}
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §8  Quality observations
// ─────────────────────────────────────────────────────────────

export function ObservationsSection({ view }: { view: ObservationsView }) {
  return (
    <SectionCard icon={Eye} title="ملاحظات الجودة" subtitle="تجميعات المحرك التحليلي كما هي">
      <div className="flex flex-wrap gap-1.5">
        <CountChip label="الإجمالي" count={view.total} tone="info" />
        <CountChip label="معتمدة" count={view.approved} tone="good" />
        <CountChip label="معلّقة" count={view.pending} tone="warn" />
        <CountChip label="مرفوضة" count={view.rejected} tone="bad" />
      </div>
      <ChipRow chips={view.severityChips} />
      <ChipRow chips={view.resolutionChips} />

      {view.categoryRows.length > 0 ? (
        <div className="overflow-x-auto -mx-1 px-1">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/50">
                <TableHead className="text-right h-9">الفئة</TableHead>
                <TableHead className="text-right h-9 w-20">العدد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.categoryRows.map((c) => (
                <TableRow key={c.categoryId ?? '_'} className="border-slate-800/60">
                  <TableCell className="text-slate-200">{c.categoryName}</TableCell>
                  <TableCell className="font-mono tabular-nums">{c.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <SectionEmpty />
      )}

      {view.typeRows.length > 0 && (
        <div className="text-[11px] text-slate-500">
          توزيع الأنواع (فوق حد التكرار {view.minOccurrences}):{' '}
          {view.typeRows.map((t) => `${t.label} (${t.count})`).join('، ')}
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §9  Repeated issues
// ─────────────────────────────────────────────────────────────

export function RepeatedIssuesSection({ view }: { view: RepeatedIssuesView }) {
  return (
    <SectionCard
      icon={Repeat}
      title="المشكلات المتكررة"
      subtitle={`تجميع حتمي حسب الفئة/النوع — حد أدنى ${view.minOccurrences} تكرارات`}
    >
      {view.empty ? (
        <SectionEmpty message="لا توجد مشكلات متكررة ضمن حد التكرار" />
      ) : (
        <>
          {view.categoryRows.length > 0 && (
            <div className="overflow-x-auto -mx-1 px-1">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50">
                    <TableHead className="text-right h-9">المشكلة (فئة)</TableHead>
                    <TableHead className="text-right h-9 w-16">التكرار</TableHead>
                    <TableHead className="text-right h-9 w-40">أول / آخر ظهور</TableHead>
                    <TableHead className="text-right h-9 w-36">عبر نافذة التحليل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.categoryRows.map((row) => (
                    <TableRow key={row.label} className="border-slate-800/60">
                      <TableCell className="text-slate-200">{row.label}</TableCell>
                      <TableCell className="font-mono tabular-nums">{row.occurrenceCount}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-400" dir="ltr">
                        {row.firstOccurrence ?? '—'} → {row.lastOccurrence ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">{row.windowSummary ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {view.typeRows.length > 0 && (
            <div className="text-[11px] text-slate-500">
              حسب النوع: {view.typeRows.map((t) => `${t.label} (${t.occurrenceCount})`).join('، ')}
            </div>
          )}
          <p className="text-[10px] text-slate-600">
            حقائق قابلة للقياس فقط — لا يتضمن هذا التقرير أي استنتاج عن الأداء أو الانضباط.
          </p>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §10  Quality deductions
// ─────────────────────────────────────────────────────────────

export function DeductionsSection({ view }: { view: DeductionsView }) {
  return (
    <SectionCard icon={Scale} title="خصومات الجودة" subtitle="أيام ومبالغ — وحدات منفصلة">
      {view.empty ? (
        <SectionEmpty />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label="العدد" count={view.count} tone="warn" />
            <CountChip label="إجمالي الأيام" count={view.totalDays} tone="bad" />
            <CountChip label="إجمالي المبلغ" count={view.totalAmount} tone="bad" />
          </div>
          <ChipRow chips={view.typeChips} />
          {view.records.length > 0 && (
            <div className="overflow-x-auto -mx-1 px-1">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/50">
                    <TableHead className="text-right h-9">التاريخ</TableHead>
                    <TableHead className="text-right h-9">النوع</TableHead>
                    <TableHead className="text-right h-9">السبب</TableHead>
                    <TableHead className="text-right h-9 w-20">أيام</TableHead>
                    <TableHead className="text-right h-9 w-24">مبلغ</TableHead>
                    <TableHead className="text-right h-9 w-28">مرجع CAPA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.records.map((r) => (
                    <TableRow key={r.id} className="border-slate-800/60">
                      <TableCell className="font-mono text-xs text-slate-300 whitespace-nowrap">{r.date}</TableCell>
                      <TableCell className="text-slate-200">{r.type}</TableCell>
                      <TableCell className="text-slate-400 text-xs max-w-48 truncate" title={r.description}>
                        {r.description || '—'}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-red-300">{r.daysDisplay}</TableCell>
                      <TableCell className="font-mono tabular-nums text-red-300">{r.amountDisplay}</TableCell>
                      <TableCell className="font-mono text-[10px] text-slate-500 truncate max-w-28" dir="ltr">
                        {r.relatedCapaId ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[10px] text-slate-600">
            الخصومات مجال رواتب مستقل — لا يفترض هذا التقرير أي أثر تلقائي لها على KPI؛ قيم KPI تُستهلك من المحرك كما هي.
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
  const indirect = view.relationship === 'INDIRECT';
  return (
    <SectionCard
      icon={MessageSquareWarning}
      title="شكاوى العملاء"
      subtitle={`إسناد ${view.relationshipLabel}`}
    >
      {indirect ? (
        <p className="text-xs text-amber-300/90 border-r-2 border-amber-500/40 pr-2">
          ارتباط غير مباشر فقط — لا يُسند هذه الشكاوى إلى الموظف مباشرة، وتُعرض كسياق منفصل دون نسبة تأكيدية.
        </p>
      ) : null}
      {view.total === 0 ? (
        <SectionEmpty />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label="الإجمالي" count={view.total} tone="info" />
            <CountChip label="محلولة/مغلقة" count={view.resolvedOrClosed} tone="good" />
            <CountChip label="مفتوحة" count={view.stillOpen} tone="warn" />
            {view.viaDealCount > 0 && <CountChip label="عبر صفقة" count={view.viaDealCount} tone="neutral" />}
          </div>
          <ChipRow chips={view.statusChips} />
          <ChipRow chips={view.typeChips} />
          <ChipRow chips={view.severityChips} />
          {view.repeatedTypes.length > 0 && (
            <div className="text-[11px] text-slate-500">
              أنواع متكررة: {view.repeatedTypes.map((t) => `${t.label} (${t.count})`).join('، ')}
            </div>
          )}
          <div className="text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            متوسط زمن الحل: <span className="font-mono tabular-nums text-slate-200">{view.avgResolutionDisplay}</span>
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
  return (
    <SectionCard icon={ShieldCheck} title="إجراءات CAPA" subtitle={`إسناد: ${view.relationshipLabel}`}>
      {view.total === 0 ? (
        <SectionEmpty />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label="الإجمالي" count={view.total} tone="info" />
            <CountChip label="نشطة" count={view.active} tone="warn" />
            <CountChip label="مغلقة/نهائية" count={view.terminal} tone="good" />
            <CountChip label="متأخرة (SLA النظام)" count={view.overdue} tone="bad" />
            {view.indirectCount > 0 && <CountChip label="ارتباط غير مباشر" count={view.indirectCount} tone="neutral" />}
          </div>
          <ChipRow chips={view.statusChips} />
          <ChipRow chips={view.priorityChips} />
          <ChipRow chips={view.sourceChips} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-700/40 pt-2">
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-500">حالة الإجراء التصحيحي</div>
              <ChipRow chips={view.correctiveChips} />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-500">حالة الإجراء الوقائي</div>
              <ChipRow chips={view.preventiveChips} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            <span>
              مغلقة: <span className="font-mono tabular-nums text-slate-200">{view.closedCount}</span>
            </span>
            <span>
              متوسط زمن الإغلاق: <span className="font-mono tabular-nums text-slate-200">{view.avgClosureDisplay}</span>
            </span>
            <span>
              متوسط أيام التأخر: <span className="font-mono tabular-nums text-slate-200">{view.avgOverdueDisplay}</span>
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
  return (
    <SectionCard icon={ClipboardCheck} title="المتابعات" subtitle="تعريف التوقيت القانوني للنظام كما هو">
      {view.total === 0 ? (
        <SectionEmpty />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label="الإجمالي" count={view.total} tone="info" />
            <CountChip label="مكتملة" count={view.completed} tone="good" />
            <CountChip label="معلّقة (نشطة)" count={view.active} tone="warn" />
            <CountChip label="متأخرة (قاعدة النظام)" count={view.overdue} tone="bad" />
            <CountChip label="مستحقة اليوم" count={view.dueToday} tone="warn" />
          </div>
          <ChipRow chips={view.statusChips} />
          <ChipRow chips={view.typeChips} />
          <ChipRow chips={view.priorityChips} />
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            <span>
              نسبة الإكمال: <span className="font-mono tabular-nums text-slate-200">{view.completionRateDisplay}</span>
            </span>
            <span>
              تأخر الإكمال: <span className="font-mono tabular-nums text-slate-200">{view.avgOverdueDisplay}</span>
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

export function DealsSection({ view }: { view: DealsView }) {
  return (
    <SectionCard icon={Plane} title="صفقات السفر" subtitle="سياق تشغيلي فقط — بلا حسابات مستهدفات">
      {view.total === 0 ? (
        <SectionEmpty />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label="الإجمالي" count={view.total} tone="info" />
          </div>
          <ChipRow chips={view.statusChips} />
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400 border-t border-slate-700/40 pt-2">
            <span>
              نسبة الإكمال: <span className="font-mono tabular-nums text-slate-200">{view.completionRateDisplay}</span>
            </span>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §15  Attendance context (never part of Quality KPI)
// ─────────────────────────────────────────────────────────────

export function AttendanceSection({ view }: { view: AttendanceView }) {
  return (
    <SectionCard icon={Clock} title="الحضور" subtitle="سياقي فقط — خارج KPI الجودة">
      {!view.available ? (
        <p className="text-xs text-slate-500 py-2">
          لا توجد نتيجة شهرية مخزّنة لهذه الفترة (غير متاح — لا يُعرض كصفر)
        </p>
      ) : (
        <FactGrid facts={view.facts} cols={3} />
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §16/§17  Evidence — traceability + counts
// ─────────────────────────────────────────────────────────────

export function EvidenceSection({
  groups,
  canOpenPage,
  onOpenPage,
}: {
  groups: EvidenceGroupView[];
  canOpenPage: (page: string) => boolean;
  onOpenPage: (page: string) => void;
}) {
  const totalEvidence = groups.reduce((sum, g) => sum + g.count, 0);
  return (
    <SectionCard
      icon={Link2}
      title="الأدلة والمراجع (Evidence)"
      subtitle={`إجمالي السجلات المرجعية: ${totalEvidence}`}
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
        {groups.filter((g) => g.count > 0).length === 0 && <SectionEmpty message="لا توجد سجلات مرجعية لهذه الفترة" />}
        {groups
          .filter((g) => g.count > 0)
          .map((g) => (
            <Collapsible key={g.collection}>
              <div className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/30 px-3 py-2">
                <CollapsibleTrigger className="group flex flex-1 items-center gap-2 text-right min-w-0">
                  <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
                  <span className="text-xs text-slate-300">{g.label}</span>
                  <span className="text-[10px] font-mono text-slate-600 truncate hidden sm:inline" dir="ltr">
                    {g.collection}
                  </span>
                  <span className="mr-auto text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                    {g.count} سجل
                  </span>
                </CollapsibleTrigger>
                {g.targetPage && canOpenPage(g.targetPage) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="no-print h-7 px-2 text-[11px] text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10"
                    onClick={() => onOpenPage(g.targetPage as string)}
                  >
                    فتح المصدر
                  </Button>
                )}
              </div>
              <CollapsibleContent>
                <div className="rounded-b-lg border border-t-0 border-slate-700/40 bg-slate-900/20 px-4 py-2 max-h-48 overflow-y-auto arm-scroll">
                  <ul className="space-y-1">
                    {g.recordIds.map((id) => (
                      <li key={id} className="font-mono text-[10px] text-slate-500 truncate" dir="ltr" title={id}>
                        {id}
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
      </div>
      <p className="text-[10px] text-slate-600">
        تُفتح سجلات المصدر فقط ضمن الصفحات المخوّلة لمستخدمك — الربط يحترم صلاحيات كل صفحة.
      </p>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §18  Data quality
// ─────────────────────────────────────────────────────────────

export function DataQualitySection({ view }: { view: DataQualityView }) {
  if (!view.hasIssues) return null;
  return (
    <Card data-report-card className="bg-amber-950/20 border-amber-800/40 print:border-amber-400">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm text-amber-200 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          جودة البيانات
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-2">
        {view.unattributedChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {view.unattributedChips.map((u) => (
              <CountChip key={u.label} label={u.label} count={u.count} tone="warn" />
            ))}
          </div>
        )}
        {view.unattributedChips.length > 0 && (
          <p className="text-xs text-amber-200/90">
            سجلات تعذر إسنادها لفترة بشكل حتمي (استُثنت دون تخمين — ولا تُخفى).
          </p>
        )}
        {view.notes.length > 0 && (
          <ul className="text-[11px] text-amber-100/70 space-y-1">
            {view.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §31  Future AI placeholder — clearly labeled, no fake content
// ─────────────────────────────────────────────────────────────

export function SmartAnalysisPlaceholder() {
  return (
    <Card data-report-card className="bg-slate-800/20 border-dashed border-slate-700/40 no-print">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-slate-800/60 border border-slate-700/50 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-slate-500" />
        </div>
        <div className="space-y-0.5 min-w-0">
          <div className="text-sm font-semibold text-slate-400">التحليل الذكي</div>
          <p className="text-[11px] text-slate-600">
            مساحة محفوظة لطبقة تحليل لاحقة — غير مفعّلة في هذه المرحلة (حقائق موثقة فقط).
          </p>
        </div>
        <Badge variant="outline" className="mr-auto bg-slate-800/50 text-slate-500 border-slate-700/50 text-[10px] shrink-0">
          قادم في مرحلة لاحقة
        </Badge>
      </CardContent>
    </Card>
  );
}
