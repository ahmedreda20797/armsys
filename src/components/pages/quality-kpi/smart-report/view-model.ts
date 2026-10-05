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
import { formatDateTime, formatMonthKey } from '@/lib/i18n/format';
import { presentSystemOrVerbatim } from '@/lib/i18n/presentation';

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

/**
 * Fallback-aware label for stored vocabularies. §PRESENTATION-BOUNDARY:
 * unknown keys resolve through the canonical presentation resolver —
 * known system keys get their localized label, legacy/user-entered
 * values stay verbatim, and a raw record id is never displayed.
 */
function storedLabel(map: Record<string, [string, string]>, key: string, locale: Locale): string {
  const pair = map[key];
  return pair ? uiLabel(pair, locale) : presentSystemOrVerbatim(key, locale);
}

// ─────────────────────────────────────────────────────────────
//  Number / display formatting (presentation only)
// ─────────────────────────────────────────────────────────────

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return `${Math.round(value * 100) / 100}%`;
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
//  §3  Report header view — COMPACT identity (§5)
// ─────────────────────────────────────────────────────────────

export interface ReportHeaderView {
  employeeName: string;
  employeeId: string;
  employeeCode: string | null;
  /**
   * §5 COMPACT HEADER — the employee's context as ONE metadata line:
   * position · organizational location (§6 semantics) · manager. The
   * name stays the primary identity; this line is secondary context.
   */
  contextSegments: string[];
  lifecycleBadges: Array<{ label: string; tone: Tone }>;
  periodLabel: string;
  generatedAtLabel: string;
  valueBasis: KpiValueBasis;
  valueBasisLabel: string;
  schemeLabel: string | null;
}

/**
 * §ORG-SEMANTICS — the employee's organizational location line.
 * Department and TEAM are distinct org-tree levels: the same node is
 * never displayed under both labels. When only a team exists (or the
 * department resolves to the team itself), the single value renders
 * under the neutral «الموقع التنظيمي» label instead of a false
 * department claim. The manager stays a LABELED fact — a bare person
 * name in a metadata line would be ambiguous.
 */
function buildOrgSegments(
  employee: EmployeePerformanceDataset['employee'],
  locale: Locale,
): string[] {
  const department = employee.department?.trim() || null;
  const team = employee.team?.trim() || null;
  const sameNode = department !== null && team !== null
    && department.localeCompare(team, 'ar') === 0;
  const segments: string[] = [];
  if (department && team && !sameNode) {
    segments.push(department, team);
  } else if (department || team) {
    segments.push(`${uiLabel(['الموقع التنظيمي', 'Organizational location'], locale)}: ${department ?? team}`);
  }
  if (employee.manager) {
    segments.push(`${uiLabel(['المدير المباشر', 'Direct manager'], locale)}: ${employee.manager}`);
  }
  return segments;
}

export function buildReportHeader(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): ReportHeaderView {
  const { employee, period, kpi } = dataset;

  // §REPORT-IDENTITY — the EMPLOYEE is the report's primary identity:
  // position/org location/manager are ONE compact context line (§5).
  const contextSegments: string[] = [];
  if (employee.position) contextSegments.push(employee.position);
  contextSegments.push(...buildOrgSegments(employee, locale));

  const lifecycleBadges: Array<{ label: string; tone: Tone }> = [];
  if (employee.employmentStatus !== 'active') {
    lifecycleBadges.push({
      label: `${uiLabel(['حالة التوظيف', 'Employment status'], locale)}: ${storedLabel(EMPLOYMENT_STATUS_LABELS, employee.employmentStatus, locale)}`,
      tone: 'warn',
    });
  }
  if (!employee.eligibleForPeriod) {
    lifecycleBadges.push({ label: uiLabel(['غير مؤهل للفترة', 'Not eligible for the period'], locale), tone: 'warn' });
  }
  if (employee.archivedButEligible) {
    lifecycleBadges.push({ label: uiLabel(['مؤرشف حاليًا — فترة تاريخية', 'Currently archived — historical period'], locale), tone: 'warn' });
  }
  if (employee.relationship === 'INDIRECT') {
    lifecycleBadges.push({ label: uiLabel(RELATIONSHIP_LABELS.INDIRECT, locale), tone: 'warn' });
  }

  return {
    // §PRESENTATION-BOUNDARY — a raw employee record id never becomes
    // the visible report title; the localized unnamed label is used.
    employeeName: employee.employeeName || (locale === 'en' ? 'Unnamed employee' : 'موظف بدون اسم'),
    employeeId: employee.employeeId,
    employeeCode: employee.employeeCode,
    contextSegments,
    lifecycleBadges,
    periodLabel: formatMonth(period.monthKey, locale),
    generatedAtLabel: formatDateTime(dataset.generatedAt, locale),
    valueBasis: period.valueBasis,
    valueBasisLabel: uiLabel(VALUE_BASIS_LABELS[period.valueBasis], locale),
    schemeLabel: kpi.scheme
      ? locale === 'en'
        ? `${kpi.scheme.schemeName} — version ${kpi.scheme.schemeVersion}`
        : `${kpi.scheme.schemeName} — إصدار ${kpi.scheme.schemeVersion}`
      : null,
  };
}

// ─────────────────────────────────────────────────────────────
//  §4/§5 KPI hero + component-status views — REMOVED (§SMART-REPORT-
//  REFINEMENT). The KpiIntelligenceSection/intelligence-view pipeline
//  is the ONE KPI presentation (percentage business terminology:
//  Defined Rate / Achieved Rate / Calculated Points). The legacy
//  "raw score vs weighted contribution" hero builders carried the
//  retired weight/contribution vocabulary and are gone so the old
//  terminology cannot resurface.
//
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
  /** §16 — highest single deduction (days, then amount) as a summary
   *  line. Detailed reasons stay in the dedicated deductions view. */
  highestLine: string | null;
  empty: boolean;
}

export function buildDeductions(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): DeductionsView {
  const d = dataset.quality.deductions;
  // Highest single deduction — same comparator as the intelligence
  // layer (days first, then amount); a presentation pick, not a new
  // aggregation.
  const highest = d.records.reduce<typeof d.records[number] | null>((acc, r) => {
    if (!acc) return r;
    if (r.deductionDays > acc.deductionDays) return r;
    if (r.deductionDays === acc.deductionDays && r.deductionAmount > acc.deductionAmount) return r;
    return acc;
  }, null);
  const highestLine = highest
    ? locale === 'en'
      ? `Highest single deduction: ${formatPlainNumber(highest.deductionDays)} day(s)${highest.deductionAmount > 0 ? ` · ${formatPlainNumber(highest.deductionAmount)}` : ''} (${highest.date})`
      : `أعلى خصم منفرد: ${formatPlainNumber(highest.deductionDays)} يوم${highest.deductionAmount > 0 ? ` · ${formatPlainNumber(highest.deductionAmount)}` : ''} (${highest.date})`
    : null;
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
    highestLine,
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
    typeChips: entriesToChips(c.byType, undefined, locale),
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
    statusChips: entriesToChips(c.byStatus, undefined, locale),
    priorityChips: entriesToChips(c.byPriority, SEVERITY_LABELS, locale),
    sourceChips: entriesToChips(c.bySource, undefined, locale),
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
  /**
   * On-time completion is NOT COMPUTABLE from the canonical model —
   * follow-ups carry no completion timestamp. Explicit unavailable
   * state (never an estimate), surfaced in the section.
   */
  onTimeRateDisplay: string;
  onTimeNote: string;
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
    onTimeRateDisplay: unavailableLabel(locale),
    onTimeNote: uiLabel(['يتطلب طابعًا زمنيًا للإكمال في المصدر — لا يُقدَّر أبدًا', 'Requires a completion timestamp at the source — never estimated'], locale),
    statusChips: entriesToChips(f.byStatus, undefined, locale),
    typeChips: entriesToChips(f.byType, undefined, locale),
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
  /** CLOSED dimension — observed completions in the period (closedAt). */
  closedTotal: number;
  /** Completed deals with unknown closure month — surfaced, never attributed. */
  closedUnknownMonth: number;
  /** DEAL_CLOSED dimension — closed WITH the employee in the period
   *  (dealClosedAt, ANY current status) — the sales-closure metric. */
  closedWithEmployeeInPeriod: number;
  /** §CLOSURE-BREAKDOWN — current-status split of the SAME closure
   *  population; the three parts sum exactly to the count above. */
  confirmedClosures: number;
  cancelledClosures: number;
  stillActiveClosures: number;
  /** DEAL_CLOSED dimension — all-time deals closed with the employee. */
  closedWithEmployeeTotal: number;
  /** §27 — CURRENT-STATUS snapshot (upcoming + in_progress, all-time). */
  currentDeals: number;
  canceled: number;
  active: number;
  completionRateDisplay: string;
  /** All-time current-status snapshot (verbatim vocabulary). */
  statusAllTime: Array<{ label: string; count: number }>;
}

export function buildDeals(dataset: EmployeePerformanceDataset, locale: Locale = 'ar'): DealsView {
  const d = dataset.deals;
  const byClosureStatus = d.closedWithEmployeeInPeriodByStatus;
  return {
    travelTotal: d.travelTotal,
    statusChips: (Object.entries(d.byStatus) as Array<[string, number]>).map(([key, count]) => ({
      label: storedLabel(DEAL_STATUS_LABELS, key, locale),
      count,
      tone: key === 'completed' ? 'good' : key === 'canceled' ? 'bad' : 'info',
    })),
    closedTotal: d.closedTotal,
    closedUnknownMonth: d.closedUnknownMonth,
    closedWithEmployeeInPeriod: d.closedWithEmployeeInPeriod,
    confirmedClosures: byClosureStatus.completed,
    cancelledClosures: byClosureStatus.canceled,
    stillActiveClosures: byClosureStatus.upcoming + byClosureStatus.in_progress,
    closedWithEmployeeTotal: d.closedWithEmployeeTotal,
    currentDeals: d.statusAllTime.upcoming + d.statusAllTime.in_progress,
    canceled: d.canceled,
    active: d.active,
    completionRateDisplay: formatPercent(d.completionRate),
    statusAllTime: (Object.entries(d.statusAllTime) as Array<[string, number]>)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ label: storedLabel(DEAL_STATUS_LABELS, key, locale), count })),
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
  labels: Record<string, [string, string]> | undefined,
  locale: Locale,
): ChipFact[] {
  return Object.entries(entries).map(([key, count]) => ({
    label: labels ? storedLabel(labels, key, locale) : presentSystemOrVerbatim(key, locale),
    count,
    tone: 'neutral' as const,
  }));
}
