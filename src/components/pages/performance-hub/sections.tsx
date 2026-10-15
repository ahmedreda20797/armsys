'use client';

// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — sections
//
//  Presentational components over the Hub dataset. Every section is
//  a projection of the server dataset (hub-view + hub-labels do the
//  formatting); no section recomputes a business value, and every
//  evidence row navigates through the shared navigateTo boundary.
//  Layout is intentionally responsive (grid collapse, internal
//  scrolling) and prints through the shared report host.
// ══════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ClipboardList,
  Compass,
  FileSearch,
  History,
  Info,
  Lightbulb,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type { Locale } from '@/lib/i18n/dictionary';
import { formatInteger } from '@/lib/i18n/format';
import type { EmployeePerformanceHubDataset, HubChangeItem, HubEvidenceItem } from '@/lib/performance-hub';
import type { OpenSource } from './PerformanceHubPage';
import {
  HUB_CHANGE_METRICS,
  HUB_CROSS_SIGNALS,
  HUB_DIMENSIONS,
  HUB_OVERVIEW_STATUS,
  HUB_TERMS,
  pick,
} from './hub-labels';
import {
  buildBenchmarkRows,
  buildChangeRows,
  buildDataQualityRows,
  buildDimensionRows,
  buildEvidenceItems,
  buildOverviewReasons,
  buildPatternRows,
  buildRecommendationViews,
  buildTimelineRows,
  employmentStatusLabel,
  formatSignedDelta,
  overviewStatusLabel,
  periodLabel,
  riskFactorLabel,
  riskLevelLabel,
  type BenchmarkRowView,
  type DataQualityRowView,
  type DimensionRowView,
  type EvidenceItemView,
  type PatternRowView,
  type TimelineRowView,
} from './hub-view';

// ─────────────────────────────────────────────────────────────
//  Small shared pieces
// ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon, subtitle, children, className }: {
  title: string;
  icon?: ReactNode;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-700/30">
        {icon}
        <h2 className="text-sm font-bold text-slate-100">{title}</h2>
        {subtitle && <span className="text-[10px] text-slate-500 ms-1 truncate">{subtitle}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  STRONG: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  STABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  IMPROVING: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  NEEDS_ATTENTION: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  DECLINING: 'bg-red-500/15 text-red-300 border-red-500/30',
  INSUFFICIENT_DATA: 'bg-slate-600/20 text-slate-400 border-slate-600/40',
};

const TONE_TEXT: Record<string, string> = {
  good: 'text-emerald-300',
  bad: 'text-red-300',
  neutral: 'text-slate-300',
  none: 'text-slate-400',
};

function statusBadgeClass(statusKey: string): string {
  return STATUS_BADGE_CLASS[statusKey] ?? STATUS_BADGE_CLASS.INSUFFICIENT_DATA;
}

function StatusBadge({ statusKey, label }: { statusKey: string; label: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold ${statusBadgeClass(statusKey)}`}>
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
//  §7 Employee context header
// ─────────────────────────────────────────────────────────────

export function EmployeeContextHeader({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const emp = dataset.employee;
  const org = dataset.organizationContext;
  const statusLabel = employmentStatusLabel(emp.employmentStatus, locale);
  const context = [
    { label: locale === 'en' ? 'Position' : 'الوظيفة', value: emp.position },
    { label: locale === 'en' ? 'Department' : 'الإدارة', value: org.department },
    { label: locale === 'en' ? 'Team' : 'الفريق', value: org.team },
    { label: locale === 'en' ? 'Manager' : 'المدير', value: org.manager },
    { label: locale === 'en' ? 'Company' : 'الشركة', value: org.company },
  ];
  return (
    <section className="rounded-xl border border-slate-700/40 bg-gradient-to-l from-slate-800/40 to-slate-800/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-slate-100">{emp.employeeName}</h1>
            {emp.employeeCode && (
              <span className="text-[11px] text-slate-400 font-mono" dir="ltr">{emp.employeeCode}</span>
            )}
            {statusLabel && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold bg-slate-600/20 text-slate-300 border-slate-600/40">
                {statusLabel}
              </span>
            )}
            {emp.archivedButEligible && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold bg-amber-500/15 text-amber-300 border-amber-500/30">
                {locale === 'en' ? 'Eligible for the period (archived)' : 'مؤهل للفترة (مؤرشف حاليًا)'}
              </span>
            )}
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            {context.map((c) => (
              <div key={c.label} className="flex items-center gap-1">
                <dt className="text-slate-500">{c.label}:</dt>
                <dd className={c.value ? 'text-slate-300' : 'text-slate-600 italic'}>{c.value ?? (locale === 'en' ? 'Unavailable' : 'غير متاح')}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="text-end shrink-0">
          <p className="text-[10px] text-slate-500">{locale === 'en' ? 'Period' : 'الفترة'}</p>
          <p className="text-sm font-semibold text-brand-300">{periodLabel(dataset.period.monthKey, locale)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {dataset.period.finalized
              ? (locale === 'en' ? 'Frozen result' : 'نتيجة مجمّدة')
              : (locale === 'en' ? 'Live view' : 'عرض حي')}
          </p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  §8 Performance overview
// ─────────────────────────────────────────────────────────────

export function OverviewCard({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const overview = dataset.overview;
  const positive = buildEvidenceItems(overview.positiveSignals, locale);
  const concerns = buildEvidenceItems(overview.concerns, locale);
  const reasons = buildOverviewReasons(overview.reasons, locale);

  const overviewStatusClass: Record<string, string> = {
    IMPROVING: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    STABLE: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    NEEDS_COACHING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    PERFORMANCE_IMPROVEMENT_REVIEW: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    MANAGEMENT_REVIEW: 'bg-red-500/15 text-red-300 border-red-500/30',
    INSUFFICIENT_DATA: 'bg-slate-600/20 text-slate-400 border-slate-600/40',
  };

  return (
    <SectionCard
      title={locale === 'en' ? 'Performance Overview' : 'ملخص الأداء'}
      icon={<TrendingUp className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? 'Current status and key signals' : 'الحالة الحالية والإشارات الرئيسية'}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold ${overviewStatusClass[overview.status] ?? overviewStatusClass.INSUFFICIENT_DATA}`}>
          <ShieldAlert className="size-3.5" />
          {overviewStatusLabel(overview.status, locale)}
        </span>
        {reasons.map((r) => (
          <span key={r} className="text-[11px] text-slate-400">• {r}</span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SignalList
          title={locale === 'en' ? 'Key Positive Signals' : 'إشارات إيجابية رئيسية'}
          items={positive}
          tone="positive"
          emptyText={locale === 'en' ? 'No positive signals supported by data this period.' : 'لا توجد إشارات إيجابية مدعومة بالبيانات في هذه الفترة.'}
        />
        <SignalList
          title={locale === 'en' ? 'Key Concerns' : 'مخاوف رئيسية'}
          items={concerns}
          tone="negative"
          emptyText={locale === 'en' ? 'No data-backed concerns this period.' : 'لا توجد مخاوف مدعومة بالبيانات في هذه الفترة.'}
        />
      </div>

      {overview.mainChange && (
        <MainChangeLine change={overview.mainChange} locale={locale} />
      )}
    </SectionCard>
  );
}

function SignalList({ title, items, tone, emptyText }: {
  title: string;
  items: EvidenceItemView[];
  tone: 'positive' | 'negative';
  emptyText: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'positive' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
      <p className="text-[11px] font-bold text-slate-300 mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.key + (item.values ? JSON.stringify(item.values) : '')} className="text-[11px] text-slate-300 flex gap-1.5">
              <span className={tone === 'positive' ? 'text-emerald-400' : 'text-amber-400'} aria-hidden="true">{tone === 'positive' ? '✓' : '⚠'}</span>
              <span>{item.sentence}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MainChangeLine({ change, locale }: { change: HubChangeItem; locale: Locale }) {
  const pair = HUB_CHANGE_METRICS[change.key];
  const label = pair ? pick(locale, pair) : change.key;
  const delta = formatSignedDelta(locale, change.delta, change.unit);
  return (
    <div className="mt-3 rounded-lg border border-slate-700/40 bg-slate-900/30 px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-bold text-slate-300">
        {locale === 'en' ? 'Main change vs previous period:' : 'أبرز تغير مقارنة بالفترة السابقة:'}
      </span>
      <span className="text-[11px] text-slate-200">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ${change.delta && change.delta !== 0 ? (change.delta > 0 === change.higherIsBetter ? 'text-emerald-300' : 'text-red-300') : 'text-slate-400'}`}>
        {delta}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  §9 Performance dimensions
// ─────────────────────────────────────────────────────────────

export function DimensionsGrid({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const rows = buildDimensionRows(dataset, locale);
  return (
    <SectionCard
      title={locale === 'en' ? 'Performance Dimensions' : 'أبعاد الأداء'}
      icon={<ClipboardList className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? 'Status per dimension — missing data is never a zero' : 'حالة كل بُعد — نقص البيانات لا يعني الصفر'}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {rows.map((row) => (
          <DimensionCard key={row.key} row={row} dataset={dataset} locale={locale} />
        ))}
      </div>
    </SectionCard>
  );
}

function DimensionCard({ row, dataset, locale }: { row: DimensionRowView; dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const dim = dataset.dimensions.find((d) => d.key === row.key);
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/30 p-3 flex flex-col gap-2 min-h-[104px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-200">{row.label}</span>
        <StatusBadge statusKey={row.statusKey} label={row.statusLabel} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-lg font-bold tabular-nums ${row.tone === 'none' ? 'text-slate-200' : TONE_TEXT[row.tone]}`}>
          {row.valueText}
        </span>
        {row.metricLabel && <span className="text-[10px] text-slate-500">{row.metricLabel}</span>}
      </div>
      {row.deltaText && (
        <p className="text-[10px] text-slate-500">
          {locale === 'en' ? 'Previous' : 'السابق'}: {row.previousText} · <span className={row.tone === 'none' ? '' : TONE_TEXT[row.tone]}>{row.deltaText}</span>
        </p>
      )}
      {dim && <DimensionFootnote dim={dim} locale={locale} />}
    </div>
  );
}

/** The dimension's supporting facts (typed per dimension — §9/§26 separation). */
function DimensionFootnote({ dim, locale }: { dim: EmployeePerformanceHubDataset['dimensions'][number]; locale: Locale }) {
  const fmt = (v: number | null) => (v === null ? null : formatInteger(v, locale));
  const notes: string[] = [];
  if (dim.details.quality) {
    const q = dim.details.quality;
    // §26 — observations / quality deductions / HR deductions stay SEPARATE.
    notes.push(`${pick(locale, HUB_TERMS.observations)}: ${fmt(q.observationsTotal) ?? '—'} (${fmt(q.observationsApproved) ?? '—'} ${locale === 'en' ? 'approved' : 'معتمدة'})`);
    notes.push(`${pick(locale, HUB_TERMS.qualityDeductions)}: ${fmt(q.qualityDeductions) ?? '—'}`);
    if (q.repeatedIssues > 0) notes.push(`${locale === 'en' ? 'Repeated issues' : 'مشكلات متكررة'}: ${fmt(q.repeatedIssues)}`);
  }
  if (dim.details.followUp) {
    const f = dim.details.followUp;
    notes.push(`${locale === 'en' ? 'Overdue' : 'متأخرة'}: ${fmt(f.overdue) ?? '—'} · ${locale === 'en' ? 'Completed' : 'منجزة'}: ${fmt(f.completed) ?? '—'}`);
  }
  if (dim.details.attendance) {
    const a = dim.details.attendance;
    if (a.status === 'NOT_AVAILABLE') {
      notes.push(locale === 'en' ? 'No stored result' : 'لا توجد نتيجة مخزّنة');
    } else {
      notes.push(`${locale === 'en' ? 'Late' : 'تأخير'}: ${fmt(a.lateDays) ?? '—'} · ${locale === 'en' ? 'Absent' : 'غياب'}: ${fmt(a.absentDays) ?? '—'}`);
    }
  }
  if (dim.details.businessOutput) {
    const b = dim.details.businessOutput;
    notes.push(`${locale === 'en' ? 'Confirmed' : 'مؤكدة'}: ${fmt(b.confirmedClosures) ?? '—'} · ${locale === 'en' ? 'Current deals' : 'صفقات حالية'}: ${fmt(b.currentDeals) ?? '—'}`);
  }
  if (dim.details.complaints) {
    notes.push(`${locale === 'en' ? 'Total' : 'الإجمالي'}: ${fmt(dim.details.complaints.total) ?? '—'}`);
  }
  if (dim.details.capa) {
    notes.push(`${locale === 'en' ? 'Overdue' : 'متأخرة'}: ${fmt(dim.details.capa.overdue) ?? '—'} · ${locale === 'en' ? 'Closed' : 'مغلقة'}: ${fmt(dim.details.capa.closedCount) ?? '—'}`);
  }
  if (notes.length === 0) return null;
  return (
    <p className="text-[10px] text-slate-500 leading-relaxed mt-auto pt-1 border-t border-slate-800/50">
      {notes.join(' · ')}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────
//  §17 Why performance changed
// ─────────────────────────────────────────────────────────────

export function ChangesSection({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const rows = buildChangeRows(dataset.changes, locale);
  return (
    <SectionCard
      title={locale === 'en' ? 'Why Performance Changed' : 'لماذا تغيّر الأداء؟'}
      icon={<TrendingUp className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? `vs ${periodLabel(dataset.period.previousMonthKey, locale)} — evidence-backed` : `مقارنة بـ ${periodLabel(dataset.period.previousMonthKey, locale)} — مدعوم بالأدلة`}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">
          {locale === 'en' ? 'No sufficient evidence to explain a change.' : 'لا توجد أدلة كافية لتفسير تغيّر في الأداء.'}
        </p>
      ) : (
        <div className="overflow-x-auto arm-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Metric' : 'المؤشر'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Previous' : 'السابق'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Current' : 'الحالي'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Change' : 'التغير'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5 px-2 text-slate-300">{r.label}</td>
                  <td className="py-1.5 px-2 text-slate-400 tabular-nums">{r.previousText}</td>
                  <td className="py-1.5 px-2 text-slate-200 tabular-nums">{r.currentText}</td>
                  <td className={`py-1.5 px-2 font-bold tabular-nums ${TONE_TEXT[r.tone]}`}>{r.deltaText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §15 Patterns + §16 Cross-signals
// ─────────────────────────────────────────────────────────────

const PATTERN_KIND_CLASS: Record<string, string> = {
  REPEATED: 'bg-red-500/15 text-red-300 border-red-500/30',
  PERSISTENT: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  EMERGING: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  IMPROVING: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DETERIORATING: 'bg-red-500/15 text-red-300 border-red-500/30',
  ISOLATED: 'bg-slate-600/20 text-slate-400 border-slate-600/40',
};

export function PatternsSection({ dataset, locale, onOpenSource }: {
  dataset: EmployeePerformanceHubDataset;
  locale: Locale;
  onOpenSource: OpenSource;
}) {
  const rows = buildPatternRows(dataset.patterns, locale);
  return (
    <SectionCard
      title={locale === 'en' ? 'Patterns' : 'الأنماط'}
      icon={<FileSearch className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? 'Deterministic, rule-based' : 'قواعد حتمية قابلة للتفسير'}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">{locale === 'en' ? 'No patterns detected in the available data.' : 'لم تُرصد أنماط في البيانات المتاحة.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className="flex items-start gap-2">
              <span className={`shrink-0 inline-flex px-2 py-0.5 rounded-md border text-[10px] font-bold ${PATTERN_KIND_CLASS[p.kindKey] ?? PATTERN_KIND_CLASS.ISOLATED}`}>
                {p.kindLabel}
              </span>
              <div className="min-w-0 text-[11px]">
                <span className="text-slate-300">{p.label ?? p.domainLabel}</span>
                {p.occurrencesText && <span className="text-slate-500"> · {locale === 'en' ? 'occurrences' : 'تكرار'}: {p.occurrencesText}</span>}
                {p.sources[0] && p.sources[0].recordIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenSource(p.sources[0].page, p.sources[0].recordIds[0], { month: dataset.period.monthKey })}
                    className="ms-1.5 text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5"
                  >
                    {locale === 'en' ? 'Evidence' : 'الأدلة'}
                    <ChevronLeft className="size-3 rotate-180 rtl:rotate-0" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function CrossSignalsSection({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  return (
    <SectionCard
      title={locale === 'en' ? 'Cross-Signal Analysis' : 'التحليل المتقاطع'}
      icon={<Info className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? 'Observed overlaps — association, not causation' : 'تزامن ملحوظ — ترافق لا سببية'}
    >
      {dataset.crossSignals.length === 0 ? (
        <p className="text-xs text-slate-500">{locale === 'en' ? 'No cross-dimension overlaps observed this period.' : 'لم يُلاحظ تزامن بين الأبعاد في هذه الفترة.'}</p>
      ) : (
        <ul className="space-y-2">
          {dataset.crossSignals.map((s) => (
            <li key={s.key} className="text-[11px] text-slate-300 flex gap-1.5">
              <span className="text-brand-400" aria-hidden="true">◈</span>
              <span>{HUB_CROSS_SIGNALS[s.key] ? pick(locale, HUB_CROSS_SIGNALS[s.key]) : null}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §18 Risk (server-gated block)
// ─────────────────────────────────────────────────────────────

export function RiskSection({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const risk = dataset.risk;
  if (!risk) {
    return (
      <SectionCard title={locale === 'en' ? 'Operational Risk' : 'المخاطر التشغيلية'} icon={<ShieldAlert className="size-4 text-red-400" />}>
        <p className="text-xs text-slate-500">
          {locale === 'en'
            ? 'The risk section is restricted for your current permissions.'
            : 'قسم المخاطر محجوب لصلاحياتك الحالية.'}
        </p>
      </SectionCard>
    );
  }
  const currentLabel = riskLevelLabel(risk.level, locale);
  const previousLabel = riskLevelLabel(risk.previousLevel, locale);
  const levelClass: Record<string, string> = {
    low: 'text-emerald-300',
    medium: 'text-amber-300',
    high: 'text-orange-300',
    critical: 'text-red-300',
  };
  return (
    <SectionCard
      title={locale === 'en' ? 'Why This Employee Is At Risk' : 'لماذا يوجد خطر على هذا الموظف؟'}
      icon={<ShieldAlert className="size-4 text-red-400" />}
      subtitle={locale === 'en' ? 'Canonical Risk Engine — verbatim' : 'محرك المخاطر المعتمد — كما هو'}
    >
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className={`text-2xl font-bold tabular-nums ${levelClass[risk.level] ?? 'text-slate-200'}`}>{formatInteger(risk.score, locale)}</span>
        <span className={`text-xs font-bold ${levelClass[risk.level] ?? ''}`}>{currentLabel}</span>
        {risk.previousScore !== null && (
          <span className="text-[11px] text-slate-500">
            {locale === 'en' ? 'Previous' : 'السابق'}: {formatInteger(risk.previousScore, locale)}{previousLabel ? ` (${previousLabel})` : ''}
            {risk.previousLevel && risk.previousLevel !== risk.level ? '' : ''}
          </span>
        )}
      </div>
      {risk.signals.length === 0 ? (
        <p className="text-xs text-slate-500">{locale === 'en' ? 'No active risk signals.' : 'لا توجد إشارات مخاطر نشطة.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {risk.signals.map((s) => (
            <li key={s.factor} className="flex items-center gap-2 text-[11px]">
              <AlertTriangle className="size-3 text-orange-400 shrink-0" aria-hidden="true" />
              <span className="text-slate-300">{riskFactorLabel(s.factor, locale) ?? s.factor}</span>
              <span className="text-slate-500 tabular-nums">({formatInteger(s.count, locale)} · {formatInteger(s.points, locale)} {locale === 'en' ? 'pts' : 'نقطة'})</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §19 Strengths / §20 Areas to develop
// ─────────────────────────────────────────────────────────────

export function AttentionItemsSection({ dataset, locale, kind, onOpenSource }: {
  dataset: EmployeePerformanceHubDataset;
  locale: Locale;
  kind: 'strengths' | 'developmentAreas';
  onOpenSource: OpenSource;
}) {
  const items = buildEvidenceItems(dataset[kind], locale);
  const positive = kind === 'strengths';
  const title = positive ? (locale === 'en' ? 'Strengths' : 'نقاط القوة') : (locale === 'en' ? 'Areas to Develop' : 'جوانب للتطوير');
  const emptyText = positive
    ? (locale === 'en' ? 'No data-backed strengths this period.' : 'لا توجد نقاط قوة مدعومة بالبيانات في هذه الفترة.')
    : (locale === 'en' ? 'No data-backed development areas this period.' : 'لا توجد جوانب تطوير مدعومة بالبيانات في هذه الفترة.');
  return (
    <SectionCard
      title={title}
      icon={positive ? <Lightbulb className="size-4 text-emerald-400" /> : <Compass className="size-4 text-amber-400" />}
    >
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={`${item.key}:${i}`} className="text-[11px] text-slate-300 flex gap-1.5">
              <span className={positive ? 'text-emerald-400' : 'text-amber-400'} aria-hidden="true">{positive ? '✓' : '⚠'}</span>
              <span className="min-w-0">
                {item.sentence}
                {item.sources[0] && item.sources[0].recordIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenSource(item.sources[0].page, item.sources[0].recordIds[0], { month: dataset.period.monthKey })}
                    className="ms-1.5 text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5"
                  >
                    {locale === 'en' ? 'Evidence' : 'الأدلة'}
                    <ChevronLeft className="size-3 rotate-180 rtl:rotate-0" aria-hidden="true" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §21 Recommended actions
// ─────────────────────────────────────────────────────────────

export function RecommendationsSection({ dataset, locale, onOpenSource }: {
  dataset: EmployeePerformanceHubDataset;
  locale: Locale;
  onOpenSource: OpenSource;
}) {
  const recommendations = buildRecommendationViews(dataset.recommendations, locale);
  return (
    <SectionCard
      title={locale === 'en' ? 'Recommended Actions' : 'الإجراءات الموصى بها'}
      icon={<ClipboardList className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? 'Evidence-based, actionable' : 'مبنية على الأدلة وقابلة للتنفيذ'}
    >
      {recommendations.length === 0 ? (
        <p className="text-xs text-slate-500">
          {locale === 'en' ? 'No recommendations — the evidence does not call for an action.' : 'لا توجد توصيات — الأدلة لا تستدعي إجراءً.'}
        </p>
      ) : (
        <ol className="space-y-2.5">
          {recommendations.map((rec, i) => (
            <li key={rec.key} className="flex gap-2.5">
              <span className="shrink-0 size-5 rounded-md bg-brand-500/15 border border-brand-500/30 text-brand-300 text-[10px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-slate-200">{rec.text}</p>
                {rec.rationale.length > 0 && (
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {locale === 'en' ? 'Based on: ' : 'استنادًا إلى: '}
                    {rec.rationale.map((r) => r.sentence).join(' · ')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §11 Unified timeline
// ─────────────────────────────────────────────────────────────

export function TimelineSection({ dataset, locale, onOpenSource }: {
  dataset: EmployeePerformanceHubDataset;
  locale: Locale;
  onOpenSource: OpenSource;
}) {
  const rows = buildTimelineRows(dataset.timeline, locale);
  return (
    <SectionCard
      title={locale === 'en' ? 'Unified Timeline' : 'السجل الزمني الموحد'}
      icon={<History className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? `${rows.length} events — an analytical index over the sources` : `${rows.length} حدثًا — فهرس تحليلي فوق المصادر`}
    >
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">{locale === 'en' ? 'No dated events in this period.' : 'لا توجد أحداث مؤرخة في هذه الفترة.'}</p>
      ) : (
        <div className="arm-scroll max-h-[420px] overflow-y-auto">
          <ul className="divide-y divide-slate-800/50">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpenSource(row.source.page, row.source.highlightId, row.source.navParams)}
                  className="w-full flex items-center gap-2.5 px-1 py-2 text-start hover:bg-slate-800/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-md"
                >
                  <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold ${row.severityClass || 'bg-slate-600/20 text-slate-300 border-slate-600/40'}`}>
                    {row.typeLabel}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] text-slate-200 truncate">{row.title || row.typeLabel}</span>
                    {row.statusLabel && <span className="block text-[10px] text-slate-500">{row.statusLabel}</span>}
                  </span>
                  <span className="text-[10px] text-slate-500 tabular-nums shrink-0" dir="ltr">{row.dateText}</span>
                  <ChevronLeft className="size-3.5 text-slate-600 shrink-0 rotate-180 rtl:rotate-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §14 Team benchmark
// ─────────────────────────────────────────────────────────────

export function BenchmarkSection({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {
  const benchmark = dataset.teamBenchmark;
  const rows: BenchmarkRowView[] = buildBenchmarkRows(benchmark, locale);
  const unavailable = !benchmark || benchmark.status !== 'AVAILABLE';
  const reason = benchmark?.unavailableReason;
  return (
    <SectionCard
      title={locale === 'en' ? 'Team Benchmark' : 'المقارنة الفريقية'}
      icon={<Building2 className="size-4 text-brand-400" />}
      subtitle={benchmark?.teamName ?? undefined}
    >
      {unavailable ? (
        <p className="text-xs text-slate-500">
          {reason === 'no_team'
            ? (locale === 'en' ? 'Team benchmark unavailable — the employee has no team in the organization tree.' : 'المقارنة الفريقية غير متاحة — الموظف لا ينتمي إلى فريق في الهيكل التنظيمي.')
            : (locale === 'en' ? 'Team benchmark unavailable — not enough authorized team members.' : 'المقارنة الفريقية غير متاحة — عدد الأعضاء المتاحين غير كافٍ.')}
        </p>
      ) : (
        <div className="overflow-x-auto arm-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Metric' : 'المؤشر'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Employee' : 'الموظف'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Team Average' : 'متوسط الفريق'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Difference' : 'الفرق'}</th>
                <th className="text-start py-1.5 px-2 font-medium">{locale === 'en' ? 'Position' : 'المركز'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5 px-2 text-slate-300">{r.label}</td>
                  <td className="py-1.5 px-2 text-slate-200 tabular-nums">{r.employeeText}</td>
                  <td className="py-1.5 px-2 text-slate-400 tabular-nums">{r.teamText}</td>
                  <td className={`py-1.5 px-2 font-bold tabular-nums ${TONE_TEXT[r.tone]}`}>{r.differenceText}</td>
                  <td className="py-1.5 px-2 text-slate-400 tabular-nums">{r.rankText ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-600 mt-2">
            {locale === 'en'
              ? `Aggregate team statistics only — ${benchmark?.memberCount ?? 0} authorized members. Individual team member details are never shown.`
              : `إحصاءات فريقية مجمعة فقط — ${benchmark?.memberCount ?? 0} عضوًا ضمن النطاق المصرّح. لا تُعرض تفاصيل أي موظف آخر.`}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §23 Evidence sources
// ─────────────────────────────────────────────────────────────

export function EvidenceSourcesSection({ dataset, locale, onOpenSource }: {
  dataset: EmployeePerformanceHubDataset;
  locale: Locale;
  onOpenSource: OpenSource;
}) {
  const graph = dataset.current.evidence;
  // §26 — Quality Observations, Quality Deductions and HR Deductions
  // stay SEPARATE source groups; HR appears only when authorized.
  const groups: Array<{ page: string; label: string; count: number; firstId: string | null }> = [
    { page: 'observations', label: pick(locale, HUB_DIMENSIONS.quality), count: graph.observations.recordIds.length, firstId: graph.observations.recordIds[0] ?? null },
    { page: 'quality', label: pick(locale, HUB_TERMS.qualityDeductions), count: graph.deductions.recordIds.length, firstId: graph.deductions.recordIds[0] ?? null },
    { page: 'followUps', label: pick(locale, HUB_DIMENSIONS.followUp), count: graph.followUps.recordIds.length, firstId: graph.followUps.recordIds[0] ?? null },
    { page: 'attendance', label: pick(locale, HUB_DIMENSIONS.attendance), count: graph.attendance ? 1 : 0, firstId: null },
    { page: 'travel', label: pick(locale, HUB_DIMENSIONS.businessOutput), count: graph.deals.recordIds.length, firstId: graph.deals.recordIds[0] ?? null },
    { page: 'hrDeductions', label: pick(locale, HUB_TERMS.hrDeductions), count: dataset.hr?.current?.deductionCount ?? 0, firstId: null },
    { page: 'complaints', label: pick(locale, HUB_DIMENSIONS.complaints), count: graph.complaints.recordIds.length, firstId: graph.complaints.recordIds[0] ?? null },
    { page: 'capa', label: pick(locale, HUB_DIMENSIONS.capa), count: graph.capa.recordIds.length, firstId: graph.capa.recordIds[0] ?? null },
  ].filter((g) => g.count > 0 && (g.page !== 'hrDeductions' || dataset.hr !== null));

  return (
    <SectionCard
      title={locale === 'en' ? 'Evidence & Sources' : 'الأدلة والمصادر'}
      icon={<FileSearch className="size-4 text-brand-400" />}
      subtitle={locale === 'en' ? 'Every number traces to its source records' : 'كل رقم يعود إلى سجلاته الأصلية'}
    >
      {groups.length === 0 ? (
        <p className="text-xs text-slate-500">{locale === 'en' ? 'No source records for this period.' : 'لا توجد سجلات مصدر لهذه الفترة.'}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <li key={g.page + g.label}>
              <button
                type="button"
                onClick={() => onOpenSource(g.page, g.firstId, { month: dataset.period.monthKey })}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-900/30 text-[11px] text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 transition-colors"
              >
                {g.label}
                <span className="text-[10px] text-slate-500 tabular-nums">{formatInteger(g.count, locale)}</span>
                <ChevronLeft className="size-3 rotate-180 rtl:rotate-0 text-slate-500" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────
//  §24 Data quality
// ─────────────────────────────────────────────────────────────

const DQ_STATE_CLASS: Record<string, string> = {
  COMPLETE: 'text-emerald-300',
  PARTIAL: 'text-amber-300',
  MISSING: 'text-slate-400',
  RESTRICTED: 'text-brand-300',
  UNAVAILABLE: 'text-slate-500',
};

export function DataQualitySection({ dataset, locale }: { dataset: EmployeePerformanceHubDataset; locale: Locale }) {  const rows: DataQualityRowView[] = buildDataQualityRows(dataset.dataQuality, locale);
  return (
    <SectionCard
      title={locale === 'en' ? 'Data Quality' : 'جودة البيانات'}
      icon={<Info className="size-4 text-slate-400" />}
      subtitle={locale === 'en' ? 'Material limitations only' : 'القيود الجوهرية فقط'}
    >
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="text-[11px] flex items-start gap-1.5">
            <span className={`font-bold shrink-0 ${DQ_STATE_CLASS[r.stateKey] ?? 'text-slate-400'}`}>{r.stateLabel}</span>
            <span className="text-slate-400 min-w-0">
              <span className="text-slate-300">{r.domainLabel}</span>
              {r.note && <span className="text-slate-500"> — {r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
