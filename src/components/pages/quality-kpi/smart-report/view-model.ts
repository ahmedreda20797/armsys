// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — View-Model Layer (Phase 4)
//
//  A PRESENTATION-ONLY mapping from the deterministic
//  EmployeePerformanceDataset (Performance Intelligence, Phase 3)
//  to display-ready, RTL/Arabic view models.
//
//  HARD RULES (Phase-4 spec):
//    • NO new calculations. Every number is read VERBATIM from the
//      dataset (the KPI engine stays the single source of truth).
//    • Missing data is an explicit UNAVAILABLE state — never a
//      fabricated zero, never an estimate (spec §3/§7/§13).
//    • NO interpretation, NO narrative, NO AI content (spec §19/§30).
//    • This module is CLIENT-SAFE and PURE: dataset types are
//      imported TYPE-ONLY (the performance-intelligence barrel is
//      server-side) and there are zero React imports, so the module
//      is directly unit-testable under node:test.
//
//  §I18N-BOUNDARY — every label emitted here is APPLICATION-OWNED UI
//  derived from system enum codes (never business/user data, which
//  passes through raw). Label maps carry [ar, en] pairs picked by the
//  caller's locale; 'ar' (the default) reproduces the historical
//  Arabic rendering byte-for-byte.
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset, RelationshipConfidence } from '@/lib/performance-intelligence';
import type { KpiValueBasis } from '@/lib/kpi-reporting';
import type { Locale } from '@/lib/i18n/dictionary';
import { formatMonthKey } from '@/lib/i18n/format';

// ─────────────────────────────────────────────────────────────
//  Shared vocabulary
// ─────────────────────────────────────────────────────────────

/** Explicit unavailable state — spec §3 ("Never invent information"). */
export const UNAVAILABLE = 'غير متاح';

const UNAVAILABLE_LABELS: [string, string] = ['غير متاح', 'N/A'];

/** Locale-aware unavailable label (UNAVAILABLE is its Arabic side). */
export function unavailableLabel(locale: Locale = 'ar'): string {
  return locale === 'en' ? UNAVAILABLE_LABELS[1] : UNAVAILABLE_LABELS[0];
}

/** The unclassified grouping key used by the analytical engine. */
const UNCLASSIFIED_KEY = '_unclassified';

const UNCLASSIFIED_LABELS: [string, string] = ['غير مصنّف', 'Unclassified'];

/** Pick the locale side of an application-owned [ar, en] label pair. */
function uiLabel(pair: [string, string], locale: Locale): string {
  return locale === 'en' ? pair[1] : pair[0];
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent';

export interface KeyValueFact {
  label: string;
  value: string;
  /** True when the source field was absent (rendered as explicit unavailable). */
  unavailable: boolean;
}

export interface ChipFact {
  label: string;
  count: number;
  tone: Tone;
}

// ─────────────────────────────────────────────────────────────
//  Label maps (system enum codes → [ar, en] display labels)
// ─────────────────────────────────────────────────────────────

const MONTH_LABELS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export function formatMonth(monthKey: string, locale: Locale = 'ar'): string {
  if (locale === 'en') return formatMonthKey(monthKey, 'en');
  const [y, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return monthKey;
  return `${MONTH_LABELS_AR[idx]} ${y}`;
}

/** Pure month arithmetic (display helper — NOT a KPI calculation). */
export function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const EMPLOYMENT_STATUS_LABELS: Record<string, [string, string]> = {
  active: ['نشط', 'Active'],
  inactive: ['غير نشط', 'Inactive'],
  archived: ['مؤرشف', 'Archived'],
  unknown: ['غير معروف', 'Unknown'],
};

export const RELATIONSHIP_LABELS: Record<RelationshipConfidence, [string, string]> = {
  CONFIRMED: ['ربط مباشر مؤكد', 'Confirmed direct attribution'],
  INDIRECT: ['ارتباط غير مباشر (عبر مرجع ثانوي)', 'Indirect (via secondary reference)'],
  NOT_AVAILABLE: ['لا توجد بيانات مخزّنة', 'No stored data'],
};

export const VALUE_BASIS_LABELS: Record<KpiValueBasis, [string, string]> = {
  MTD: ['MTD — حتى تاريخه', 'MTD — month to date'],
  LIVE: ['حية (غير نهائية)', 'Live (non-final)'],
  FINALIZED: ['مجمّدة نهائية', 'Finalized'],
};

const SEVERITY_LABELS: Record<string, [string, string]> = {
  low: ['منخفضة', 'Low'],
  medium: ['متوسطة', 'Medium'],
  high: ['عالية', 'High'],
  critical: ['حرجة', 'Critical'],
};

const TREND_LABELS: Record<string, [string, string]> = {
  UP: ['▲ اتجاه صاعد', '▲ Upward trend'],
  DOWN: ['▼ اتجاه هابط', '▼ Downward trend'],
  STABLE: ['─ مستقر', '─ Stable'],
};

const DEAL_STATUS_LABELS: Record<string, [string, string]> = {
  upcoming: ['قادمة', 'Upcoming'],
  in_progress: ['قيد التنفيذ', 'In progress'],
  completed: ['مكتملة', 'Completed'],
  canceled: ['ملغاة', 'Canceled'],
};

const ACTION_STATE_LABELS: Record<string, [string, string]> = {
  not_started: ['لم تبدأ', 'Not started'],
  in_progress: ['قيد التنفيذ', 'In progress'],
  completed: ['مكتملة', 'Completed'],
};

const RESOLUTION_LABELS_AR: Record<string, [string, string]> = {
  open: ['مفتوحة', 'Open'],
  in_review: ['قيد المراجعة', 'In review'],
  resolved: ['محلولة', 'Resolved'],
  closed: ['مغلقة', 'Closed'],
};

/** Fallback-aware label for stored vocabularies (unknown keys stay verbatim). */
function storedLabel(map: Record<string, [string, string]>, key: string, locale: Locale): string {
  const pair = map[key];
  return pair ? uiLabel(pair, locale) : key;
}

// ─────────────────────────────────────────────────────────────
//  Number / display formatting (presentation only)
// ─────────────────────────────────────────────────────────────

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return `${Math.round(value * 100) / 100}%`;
}

export function formatContribution(
  value: number | null | undefined,
  max: number | null | undefined,
): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  const v = Math.round(value * 100) / 100;
  return max === null || max === undefined ? `${v}` : `${v} / ${max}`;
}

/** Signed percentage-point delta (e.g. "+5" / "-3"); null passes through. */
export function formatSignedPoints(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return `${Math.round(value * 100) / 100}%`;
}

export function formatPlainNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return `${Math.round(value * 100) / 100}`;
}

export function deltaTone(delta: number | null | undefined): Tone {
  if (delta === null || delta === undefined || delta === 0) return 'neutral';
  return delta > 0 ? 'good' : 'bad';
}

// ─────────────────────────────────────────────────────────────
//  §3  Report header view
// ─────────────────────────────────────────────────────────────

export interface ReportHeaderView {
  employeeName: string;
  employeeId: string;
  employeeCode: string | null;
  facts: KeyValueFact[];
  lifecycleBadges: Array<{ label: string; tone: Tone }>;
  periodLabel: string;
  valueBasis: KpiValueBasis;
  valueBasisLabel: string;
  schemeLabel: string | null;
  datasetKind: string;
}

export function buildReportHeader(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): ReportHeaderView {
  const { employee, period, kpi } = dataset;

  const facts: KeyValueFact[] = [
    { label: uiLabel(['القسم', 'Department'], locale), value: employee.department ?? unavailableLabel(locale), unavailable: employee.department === null },
    {
      // The team resolves from the ORGANIZATION TREE (service-side).
      // Datasets built before the team field existed (and unassigned
      // employees) render the explicit unavailable state — spec §3.
      label: uiLabel(['الفريق', 'Team'], locale),
      value: employee.team ?? unavailableLabel(locale),
      unavailable: !employee.team,
    },
    { label: uiLabel(['المسمى الوظيفي', 'Job title'], locale), value: employee.position ?? unavailableLabel(locale), unavailable: employee.position === null },
    {
      label: uiLabel(['حالة التوظيف', 'Employment status'], locale),
      value: storedLabel(EMPLOYMENT_STATUS_LABELS, employee.employmentStatus, locale),
      unavailable: employee.employmentStatus === 'unknown',
    },
    {
      label: uiLabel(['أهلية الفترة', 'Period eligibility'], locale),
      value: employee.eligibleForPeriod
        ? uiLabel(['مؤهل للفترة', 'Eligible for the period'], locale)
        : uiLabel(['غير مؤهل للفترة', 'Not eligible for the period'], locale),
      unavailable: false,
    },
  ];

  const lifecycleBadges: Array<{ label: string; tone: Tone }> = [];
  if (employee.archivedButEligible) {
    lifecycleBadges.push({ label: uiLabel(['مؤرشف حاليًا — فترة تاريخية', 'Currently archived — historical period'], locale), tone: 'warn' });
  }
  if (employee.relationship === 'INDIRECT') {
    lifecycleBadges.push({ label: uiLabel(RELATIONSHIP_LABELS.INDIRECT, locale), tone: 'warn' });
  }

  return {
    employeeName: employee.employeeName || employee.employeeId,
    employeeId: employee.employeeId,
    employeeCode: employee.employeeCode,
    facts,
    lifecycleBadges,
    periodLabel: formatMonth(period.monthKey, locale),
    valueBasis: period.valueBasis,
    valueBasisLabel: uiLabel(VALUE_BASIS_LABELS[period.valueBasis], locale),
    schemeLabel: kpi.scheme
      ? locale === 'en'
        ? `${kpi.scheme.schemeName} — version ${kpi.scheme.schemeVersion}`
        : `${kpi.scheme.schemeName} — إصدار ${kpi.scheme.schemeVersion}`
      : null,
    datasetKind: dataset.datasetKind,
  };
}

// ─────────────────────────────────────────────────────────────
//  §4  KPI hero view — raw score vs weighted contribution
// ─────────────────────────────────────────────────────────────

export interface KpiHeroView {
  /** Raw Quality Score (0–100) — engine output, verbatim. */
  rawScoreDisplay: string;
  hasRawScore: boolean;
  /** Weighted Quality Contribution — engine output, verbatim. */
  contributionDisplay: string;
  weightPercent: number | null;
  componentStatusLabel: string | null;
  /** Company-KPI row status (e.g. INCOMPLETE) — engine verdict. */
  rowStatusLabel: string;
  overallStatusLabel: string | null;
  weightedTotalDisplay: string | null;
  availableWeightDisplay: string | null;
  previousScoreDisplay: string | null;
  deltaDisplay: string | null;
  deltaToneValue: Tone;
  directionLabel: string | null;
  /** Arabic engine explanation for non-value outcomes (verbatim). */
  outcomeMessage: string | null;
  schemeLabel: string | null;
  /**
   * §6 STATE DISTINCTION — set only when the KPI engine returned NO
   * value while REAL quality evidence exists in the dataset for the
   * same employee/period. This is state B/D (evidence exists, KPI
   * unavailable / not eligible) — never rendered for state A (no
   * evidence). Pure projection of dataset counters; nothing invented.
   */
  evidenceNote: string | null;
}

export function buildKpiHero(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): KpiHeroView {
  const { kpi, trend } = dataset;
  const quality = kpi.quality;
  const mom = trend.mom;

  // §6 — the KPI engine verdict never suppresses quality evidence:
  // when the engine produced no score/contribution while the dataset
  // holds real period observations/deductions, say so explicitly
  // (state B/D). Counts are the dataset's own — verbatim.
  const kpiValueAvailable = quality?.rawScore != null || quality?.weightedContribution != null;
  const obsTotal = dataset.quality.observations.total;
  const dedCount = dataset.quality.deductions.count;
  const evidenceParts: string[] = [];
  if (obsTotal > 0) evidenceParts.push(locale === 'en' ? `${obsTotal} quality observations` : `${obsTotal} ملاحظة جودة`);
  if (dedCount > 0) evidenceParts.push(locale === 'en' ? `${dedCount} quality deductions` : `${dedCount} خصم جودة`);
  const evidenceNote =
    !kpiValueAvailable && evidenceParts.length > 0
      ? locale === 'en'
        ? `Real quality evidence exists for this period (${evidenceParts.join(' · ')}) and is shown in the sections below — the KPI result is unavailable per engine rules, and no substitute values are invented.`
        : `توجد أدلة جودة حقيقية لهذه الفترة (${evidenceParts.join(' · ')}) وتُعرض في الأقسام أدناه — نتيجة KPI غير متاحة وفق قواعد المحرك، ولا تُختلق قيم بديلة.`
      : null;

  return {
    rawScoreDisplay: formatScore(quality?.rawScore ?? null),
    hasRawScore: quality?.rawScore !== null && quality?.rawScore !== undefined,
    contributionDisplay: formatContribution(
      quality?.weightedContribution ?? null,
      quality?.maxContribution ?? null,
    ),
    weightPercent: quality?.weight ?? kpi.scheme?.qualityWeight ?? null,
    componentStatusLabel: quality?.status ?? null,
    rowStatusLabel: kpi.rowStatus,
    overallStatusLabel: kpi.overallStatus ?? null,
    weightedTotalDisplay: kpi.weightedTotal === null ? null : formatPlainNumber(kpi.weightedTotal),
    availableWeightDisplay: kpi.availableWeight === null ? null : formatPlainNumber(kpi.availableWeight),
    previousScoreDisplay: mom ? formatScore(mom.previousRawScore) : null,
    deltaDisplay: formatSignedPoints(mom?.deltaPoints ?? null),
    deltaToneValue: deltaTone(mom?.deltaPoints ?? null),
    directionLabel: trend.direction ? storedLabel(TREND_LABELS, trend.direction, locale) : null,
    outcomeMessage: kpi.message,
    schemeLabel: kpi.scheme
      ? locale === 'en'
        ? `${kpi.scheme.schemeName} — version ${kpi.scheme.schemeVersion}`
        : `${kpi.scheme.schemeName} — إصدار ${kpi.scheme.schemeVersion}`
      : null,
    evidenceNote,
  };
}

// ─────────────────────────────────────────────────────────────
//  §5  KPI component status view (informational only)
// ─────────────────────────────────────────────────────────────

export interface KpiComponentRowView {
  label: string;
  contributionDisplay: string;
  statusLabel: string;
  available: boolean;
  isOverall: boolean;
}

export interface KpiComponentsView {
  rows: KpiComponentRowView[];
  /** True when the engine verdict says the scheme has unvalued components. */
  hasUnavailableComponents: boolean;
}

export function buildKpiComponents(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): KpiComponentsView {
  const { kpi } = dataset;
  const quality = kpi.quality;

  const rows: KpiComponentRowView[] = [];

  if (quality) {
    rows.push({
      label: quality.name || uiLabel(['الجودة', 'Quality'], locale),
      contributionDisplay: formatContribution(quality.weightedContribution, quality.maxContribution),
      statusLabel: quality.status,
      available: quality.weightedContribution !== null,
      isOverall: false,
    });
  } else {
    // No quality component result — explicit NOT AVAILABLE row (no zero).
    rows.push({
      label: uiLabel(['الجودة', 'Quality'], locale),
      contributionDisplay: unavailableLabel(locale),
      statusLabel: 'NOT_AVAILABLE',
      available: false,
      isOverall: false,
    });
  }

  rows.push({
    label: uiLabel(['إجمالي KPI (المتاح)', 'Total KPI (available)'], locale),
    contributionDisplay:
      kpi.weightedTotal === null
        ? unavailableLabel(locale)
        : `${formatPlainNumber(kpi.weightedTotal)}${
            kpi.availableWeight === null
              ? ''
              : locale === 'en'
                ? ` / available weight ${formatPlainNumber(kpi.availableWeight)}`
                : ` / وزن متاح ${formatPlainNumber(kpi.availableWeight)}`
          }`,
    statusLabel: kpi.rowStatus,
    available: kpi.rowStatus === 'AVAILABLE' || kpi.rowStatus === 'FINALIZED',
    isOverall: true,
  });

  return {
    rows,
    hasUnavailableComponents: kpi.rowStatus === 'INCOMPLETE' || kpi.rowStatus === 'PENDING',
  };
}

// ─────────────────────────────────────────────────────────────
//  §7  Performance trend view
// ─────────────────────────────────────────────────────────────

export interface TrendPointView {
  monthKey: string;
  monthLabel: string;
  /** Raw score display — UNAVAILABLE for months without results (never 0). */
  scoreDisplay: string;
  available: boolean;
  finalized: boolean;
}

export interface TrendView {
  points: TrendPointView[];
  availableCount: number;
  /** True when NO point in the window carries a valid result. */
  insufficient: boolean;
  directionLabel: string | null;
  deltaDisplay: string | null;
  deltaToneValue: Tone;
  previousMonthLabel: string | null;
  previousScoreDisplay: string | null;
}

export function buildTrend(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): TrendView {
  const { trend } = dataset;
  const points: TrendPointView[] = trend.points.map((p) => ({
    monthKey: p.monthKey,
    monthLabel: formatMonth(p.monthKey, locale),
    scoreDisplay: p.available ? formatScore(p.rawScore) : unavailableLabel(locale),
    available: p.available,
    finalized: p.finalized,
  }));

  const mom = trend.mom;
  return {
    points,
    availableCount: points.filter((p) => p.available).length,
    insufficient: points.every((p) => !p.available),
    directionLabel: trend.direction ? storedLabel(TREND_LABELS, trend.direction, locale) : null,
    deltaDisplay: mom ? formatSignedPoints(mom.deltaPoints) : null,
    deltaToneValue: deltaTone(mom?.deltaPoints ?? null),
    previousMonthLabel: mom ? formatMonth(mom.previousMonth, locale) : null,
    previousScoreDisplay: mom ? formatScore(mom.previousRawScore) : null,
  };
}

// ─────────────────────────────────────────────────────────────
//  §8  Quality observations view
// ─────────────────────────────────────────────────────────────

export interface ObservationsView {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  severityChips: ChipFact[];
  resolutionChips: ChipFact[];
  categoryRows: Array<{ categoryId: string | null; categoryName: string; count: number }>;
  /** Observation-type distribution above the engine's repetition threshold. */
  typeRows: Array<{ label: string; count: number }>;
  minOccurrences: number;
}

const RESOLUTION_TONES: Record<string, Tone> = {
  open: 'warn',
  in_review: 'info',
  resolved: 'good',
  closed: 'neutral',
};

export function buildObservations(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): ObservationsView {
  const obs = dataset.quality.observations;
  return {
    total: obs.total,
    approved: obs.approved,
    pending: obs.pending,
    rejected: obs.rejected,
    severityChips: Object.entries(obs.bySeverity).map(([key, count]) => ({
      label: storedLabel(SEVERITY_LABELS, key, locale),
      count,
      tone: key === 'critical' || key === 'high' ? 'bad' : key === 'medium' ? 'warn' : 'neutral',
    })),
    resolutionChips: Object.entries(obs.byResolutionStatus).map(([key, count]) => ({
      label: storedLabel(RESOLUTION_LABELS_AR, key, locale),
      count,
      tone: RESOLUTION_TONES[key] ?? 'neutral',
    })),
    categoryRows: obs.byCategory.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryId === UNCLASSIFIED_KEY ? uiLabel(UNCLASSIFIED_LABELS, locale) : c.categoryName,
      count: c.count,
    })),
    typeRows: dataset.quality.repeatedIssues.byType.map((t) => ({
      label: t.issueKey === UNCLASSIFIED_KEY ? uiLabel(UNCLASSIFIED_LABELS, locale) : t.label,
      count: t.occurrenceCount,
    })),
    minOccurrences: dataset.quality.repeatedIssues.minOccurrences,
  };
}

// ─────────────────────────────────────────────────────────────
//  §9  Repeated issues view (deterministic groups only)
// ─────────────────────────────────────────────────────────────

export interface RepeatedIssueRowView {
  label: string;
  occurrenceCount: number;
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  /** Cross-window recurrence summary, when the engine returned one. */
  windowSummary: string | null;
  recordCount: number;
}

export interface RepeatedIssuesView {
  minOccurrences: number;
  categoryRows: RepeatedIssueRowView[];
  typeRows: RepeatedIssueRowView[];
  empty: boolean;
}

export function buildRepeatedIssues(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): RepeatedIssuesView {
  const ri = dataset.quality.repeatedIssues;
  const windowByKey = new Map(ri.windowByCategory.map((w) => [w.issueKey, w]));

  const mapRows = (groups: typeof ri.byCategory): RepeatedIssueRowView[] =>
    groups.map((g) => {
      const w = windowByKey.get(g.issueKey);
      return {
        label: g.issueKey === UNCLASSIFIED_KEY ? uiLabel(UNCLASSIFIED_LABELS, locale) : g.label,
        occurrenceCount: g.occurrenceCount,
        firstOccurrence: g.firstOccurrence,
        lastOccurrence: g.lastOccurrence,
        windowSummary: w
          ? locale === 'en'
            ? `${w.occurrenceCount} occurrences across ${w.monthsPresent} months`
            : `${w.occurrenceCount} مرات عبر ${w.monthsPresent} أشهر`
          : null,
        recordCount: g.observationIds.length,
      };
    });

  const categoryRows = mapRows(ri.byCategory);
  const typeRows = mapRows(ri.byType);

  return {
    minOccurrences: ri.minOccurrences,
    categoryRows,
    typeRows,
    empty: categoryRows.length === 0 && typeRows.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────
//  §10  Quality deductions view (days vs money kept separate)
// ─────────────────────────────────────────────────────────────

export interface DeductionsView {
  count: number;
  /** Raw totals (kept SEPARATE: days unit vs monetary unit). */
  totalDays: number;
  totalAmount: number;
  totalDaysDisplay: string;
  totalAmountDisplay: string;
  typeChips: ChipFact[];
  records: Array<{
    id: string;
    date: string;
    type: string;
    description: string;
    daysDisplay: string;
    amountDisplay: string;
    relatedCapaId: string | null;
  }>;
  empty: boolean;
}

export function buildDeductions(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): DeductionsView {
  const d = dataset.quality.deductions;
  return {
    count: d.count,
    totalDays: d.totalDays,
    totalAmount: d.totalAmount,
    totalDaysDisplay: formatPlainNumber(d.totalDays),
    totalAmountDisplay: formatPlainNumber(d.totalAmount),
    typeChips: d.byType.map((t) => ({
      label: t.categoryId === UNCLASSIFIED_KEY ? uiLabel(UNCLASSIFIED_LABELS, locale) : t.categoryName,
      count: t.count,
      tone: 'neutral',
    })),
    records: d.records.map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type,
      description: r.description,
      daysDisplay: r.deductionDays === 0 ? '—' : formatPlainNumber(r.deductionDays),
      amountDisplay: r.deductionAmount === 0 ? '—' : formatPlainNumber(r.deductionAmount),
      relatedCapaId: r.relatedCapaId,
    })),
    empty: d.count === 0,
  };
}

// ─────────────────────────────────────────────────────────────
//  §11  Complaints view (confirmed attribution only)
// ─────────────────────────────────────────────────────────────

export interface ComplaintsView {
  relationship: RelationshipConfidence;
  relationshipLabel: string;
  total: number;
  statusChips: ChipFact[];
  typeChips: ChipFact[];
  severityChips: ChipFact[];
  resolvedOrClosed: number;
  stillOpen: number;
  viaDealCount: number;
  /** Explicit "غير متاح" when not measurable — never estimated (spec §11). */
  avgResolutionDisplay: string;
  repeatedTypes: Array<{ label: string; count: number }>;
}

export function buildComplaints(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): ComplaintsView {
  const c = dataset.complaints;
  return {
    relationship: c.relationship,
    relationshipLabel: uiLabel(RELATIONSHIP_LABELS[c.relationship], locale),
    total: c.total,
    statusChips: entriesToChips(c.byStatus, RESOLUTION_LABELS_AR, locale),
    typeChips: entriesToChips(c.byType),
    severityChips: entriesToChips(c.bySeverity, SEVERITY_LABELS, locale),
    resolvedOrClosed: c.resolvedOrClosed,
    stillOpen: c.stillOpen,
    viaDealCount: c.viaDealCount,
    avgResolutionDisplay:
      c.avgResolutionDays === null
        ? unavailableLabel(locale)
        : locale === 'en'
          ? `${Math.round(c.avgResolutionDays * 100) / 100} days`
          : `${Math.round(c.avgResolutionDays * 100) / 100} يوم`,
    repeatedTypes: c.repeatedTypes.map((t) => ({
      label: t.issueKey === UNCLASSIFIED_KEY ? uiLabel(UNCLASSIFIED_LABELS, locale) : t.label,
      count: t.occurrenceCount,
    })),
  };
}

// ─────────────────────────────────────────────────────────────
//  §12  CAPA view (existing workflow meaning preserved)
// ─────────────────────────────────────────────────────────────

export interface CapaView {
  relationshipLabel: string;
  total: number;
  statusChips: ChipFact[];
  priorityChips: ChipFact[];
  sourceChips: ChipFact[];
  active: number;
  terminal: number;
  overdue: number;
  avgOverdueDisplay: string;
  correctiveChips: ChipFact[];
  preventiveChips: ChipFact[];
  closedCount: number;
  avgClosureDisplay: string;
  indirectCount: number;
}

export function buildCapa(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): CapaView {
  const c = dataset.capa;
  return {
    relationshipLabel: uiLabel(RELATIONSHIP_LABELS[c.relationship], locale),
    total: c.total,
    statusChips: entriesToChips(c.byStatus),
    priorityChips: entriesToChips(c.byPriority, SEVERITY_LABELS, locale),
    sourceChips: entriesToChips(c.bySource),
    active: c.active,
    terminal: c.terminal,
    overdue: c.overdue,
    avgOverdueDisplay:
      c.avgOverdueDays === null
        ? unavailableLabel(locale)
        : locale === 'en'
          ? `${Math.round(c.avgOverdueDays * 100) / 100} days`
          : `${Math.round(c.avgOverdueDays * 100) / 100} يوم`,
    correctiveChips: entriesToChips(c.correctiveStatus, ACTION_STATE_LABELS, locale),
    preventiveChips: entriesToChips(c.preventiveStatus, ACTION_STATE_LABELS, locale),
    closedCount: c.closedCount,
    avgClosureDisplay:
      c.avgClosureDays === null
        ? unavailableLabel(locale)
        : locale === 'en'
          ? `${Math.round(c.avgClosureDays * 100) / 100} days`
          : `${Math.round(c.avgClosureDays * 100) / 100} يوم`,
    indirectCount: c.indirectCount,
  };
}

// ─────────────────────────────────────────────────────────────
//  §13  Follow-ups view (canonical timing definitions only)
// ─────────────────────────────────────────────────────────────

export interface FollowUpsView {
  total: number;
  completed: number;
  /** Active (non-terminal) follow-ups — the pending set. */
  active: number;
  overdue: number;
  completionRateDisplay: string;
  dueToday: number;
  avgOverdueDisplay: string;
  statusChips: ChipFact[];
  typeChips: ChipFact[];
  priorityChips: ChipFact[];
}

export function buildFollowUps(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): FollowUpsView {
  const f = dataset.followUps;
  return {
    total: f.total,
    completed: f.completed,
    active: f.active,
    overdue: f.overdue,
    completionRateDisplay: formatPercent(f.completionRate),
    dueToday: f.dueToday,
    // Explicit unavailable state — never an estimate (spec §13).
    avgOverdueDisplay:
      f.avgOverdueDays === null
        ? unavailableLabel(locale)
        : locale === 'en'
          ? `${Math.round(f.avgOverdueDays * 100) / 100} days`
          : `${Math.round(f.avgOverdueDays * 100) / 100} يوم`,
    statusChips: entriesToChips(f.byStatus),
    typeChips: entriesToChips(f.byType),
    priorityChips: entriesToChips(f.byPriority, SEVERITY_LABELS, locale),
  };
}

// ─────────────────────────────────────────────────────────────
//  §14  Travel deals / operational context view (§DEAL-DATES)
// ─────────────────────────────────────────────────────────────

export interface DealsView {
  /** TRAVEL dimension — deals departing in the period (travel volume). */
  travelTotal: number;
  statusChips: ChipFact[];
  /** CLOSED dimension — observed closures in the period (closedAt). */
  closedTotal: number;
  /** Completed deals with unknown closure month — surfaced, never attributed. */
  closedUnknownMonth: number;
  canceled: number;
  active: number;
  completionRateDisplay: string;
}

export function buildDeals(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): DealsView {
  const d = dataset.deals;
  return {
    travelTotal: d.travelTotal,
    statusChips: (Object.entries(d.byStatus) as Array<[string, number]>).map(([key, count]) => ({
      label: storedLabel(DEAL_STATUS_LABELS, key, locale),
      count,
      tone: key === 'completed' ? 'good' : key === 'canceled' ? 'bad' : 'info',
    })),
    closedTotal: d.closedTotal,
    closedUnknownMonth: d.closedUnknownMonth,
    canceled: d.canceled,
    active: d.active,
    completionRateDisplay: formatPercent(d.completionRate),
  };
}

// ─────────────────────────────────────────────────────────────
//  §15  Attendance context view (NEVER part of Quality KPI)
// ─────────────────────────────────────────────────────────────

export interface AttendanceView {
  available: boolean;
  facts: KeyValueFact[];
}

export function buildAttendance(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): AttendanceView {
  const a = dataset.attendance;
  if (a.status !== 'AVAILABLE' || !a.result) {
    return { available: false, facts: [] };
  }
  const r = a.result;
  return {
    available: true,
    facts: [
      { label: uiLabel(['أيام التأخير', 'Late days'], locale), value: formatPlainNumber(r.lateDays), unavailable: false },
      { label: uiLabel(['أيام الغياب', 'Absent days'], locale), value: formatPlainNumber(r.absentDays), unavailable: false },
      { label: uiLabel(['أيام الإجازة/الاستثناء', 'Exempt days'], locale), value: formatPlainNumber(r.exemptDays), unavailable: false },
      { label: uiLabel(['إجمالي دقائق التأخير', 'Total late minutes'], locale), value: formatPlainNumber(r.totalMinutesLate), unavailable: false },
      { label: uiLabel(['نسبة الالتزام', 'Compliance rate'], locale), value: formatPercent(r.compliance), unavailable: false },
      { label: uiLabel(['أيام خصم الحضور', 'Attendance deduction days'], locale), value: formatPlainNumber(r.attendanceDeductionDays), unavailable: false },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
//  §16/§17  Evidence view — traceability into source collections
// ─────────────────────────────────────────────────────────────

export interface EvidenceGroupView {
  /** The owning RTDB collection (record type) — verbatim. */
  collection: string;
  label: string;
  /** recordIds.length — reconciles 1:1 with the dataset. */
  count: number;
  recordIds: string[];
  /** Sidebar page that owns these records, when one exists. */
  targetPage: string | null;
}

const EVIDENCE_TARGETS: Record<string, string | null> = {
  qualityObservations: 'observations',
  qualityDeductions: null,
  complaints: 'complaints',
  capaCases: 'capa',
  followUps: 'followUps',
  travelDeals: 'travel',
  attendanceResults: 'attendance',
  monthSnapshots: 'monthClose',
  kpiSchemes: 'kpiSettings',
};

const EVIDENCE_LABELS: Record<string, [string, string]> = {
  qualityObservations: ['ملاحظات الجودة', 'Quality observations'],
  qualityDeductions: ['خصومات الجودة', 'Quality deductions'],
  complaints: ['شكاوى العملاء', 'Customer complaints'],
  capaCases: ['حالات CAPA', 'CAPA cases'],
  followUps: ['المتابعات', 'Follow-ups'],
  travelDeals: ['صفقات السفر', 'Travel deals'],
  attendanceResults: ['نتائج الحضور', 'Attendance results'],
  monthSnapshots: ['لقطات الشهر (KPI)', 'Month snapshots (KPI)'],
  kpiSchemes: ['مخططات KPI', 'KPI schemes'],
};

export function buildEvidenceGroups(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): EvidenceGroupView[] {
  const e = dataset.evidence;
  const groups: EvidenceGroupView[] = [e.observations, e.deductions, e.complaints, e.capa, e.followUps, e.deals].map(
    (ref) => ({
      collection: ref.collection,
      label: storedLabel(EVIDENCE_LABELS, ref.collection, locale),
      count: ref.recordIds.length,
      recordIds: ref.recordIds,
      targetPage: EVIDENCE_TARGETS[ref.collection] ?? null,
    }),
  );
  if (e.attendance) {
    groups.push({
      collection: e.attendance.collection,
      label: storedLabel(EVIDENCE_LABELS, e.attendance.collection, locale),
      count: e.attendance.recordIds.length,
      recordIds: e.attendance.recordIds,
      targetPage: EVIDENCE_TARGETS[e.attendance.collection] ?? null,
    });
  }
  // KPI evidence (frozen snapshots + resolved scheme) — separate groups.
  for (const ref of e.kpi) {
    groups.push({
      collection: ref.collection,
      label: storedLabel(EVIDENCE_LABELS, ref.collection, locale),
      count: ref.recordIds.length,
      recordIds: ref.recordIds,
      targetPage: EVIDENCE_TARGETS[ref.collection] ?? null,
    });
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────
//  §18  Data-quality view
// ─────────────────────────────────────────────────────────────

export interface DataQualityView {
  hasIssues: boolean;
  unattributedChips: Array<{ label: string; count: number }>;
  notes: string[];
}

export function buildDataQuality(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): DataQualityView {
  const dq = dataset.dataQuality;
  const unattributedChips = dq.unattributedRecords.map((u) => ({
    label: storedLabel(EVIDENCE_LABELS, u.collection, locale),
    count: u.count,
  }));
  return {
    hasIssues: unattributedChips.length > 0 || dq.notes.length > 0,
    unattributedChips,
    notes: dq.notes,
  };
}

// ─────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────

function entriesToChips(
  entries: Record<string, number>,
  labels?: Record<string, [string, string]>,
  locale: Locale = 'ar',
): ChipFact[] {
  return Object.entries(entries).map(([key, count]) => ({
    label: labels ? storedLabel(labels, key, locale) : key,
    count,
    tone: 'neutral' as const,
  }));
}
