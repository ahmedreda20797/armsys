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
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset, RelationshipConfidence } from '@/lib/performance-intelligence';
import type { KpiValueBasis } from '@/lib/kpi-reporting';

// ─────────────────────────────────────────────────────────────
//  Shared vocabulary
// ─────────────────────────────────────────────────────────────

/** Explicit unavailable state — spec §3 ("Never invent information"). */
export const UNAVAILABLE = 'غير متاح';

/** The unclassified grouping key used by the analytical engine. */
const UNCLASSIFIED_KEY = '_unclassified';

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
//  Label maps (stored vocabulary → Arabic display labels)
// ─────────────────────────────────────────────────────────────

const MONTH_LABELS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export function formatMonth(monthKey: string): string {
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

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  archived: 'مؤرشف',
  unknown: 'غير معروف',
};

export const RELATIONSHIP_LABELS: Record<RelationshipConfidence, string> = {
  CONFIRMED: 'ربط مباشر مؤكد',
  INDIRECT: 'ارتباط غير مباشر (عبر مرجع ثانوي)',
  NOT_AVAILABLE: 'لا توجد بيانات مخزّنة',
};

export const VALUE_BASIS_LABELS: Record<KpiValueBasis, string> = {
  MTD: 'MTD — حتى تاريخه',
  LIVE: 'حية (غير نهائية)',
  FINALIZED: 'مجمّدة نهائية',
};

const SEVERITY_LABELS: Record<string, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

const TREND_LABELS: Record<string, string> = {
  UP: '▲ اتجاه صاعد',
  DOWN: '▼ اتجاه هابط',
  STABLE: '─ مستقر',
};

const DEAL_STATUS_LABELS: Record<string, string> = {
  upcoming: 'قادمة',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
  canceled: 'ملغاة',
};

const ACTION_STATE_LABELS: Record<string, string> = {
  not_started: 'لم تبدأ',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتملة',
};

const RESOLUTION_LABELS_AR: Record<string, string> = {
  open: 'مفتوحة',
  in_review: 'قيد المراجعة',
  resolved: 'محلولة',
  closed: 'مغلقة',
};

/** Fallback-aware label for stored vocabularies (unknown keys stay verbatim). */
function storedLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
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

export function buildReportHeader(dataset: EmployeePerformanceDataset): ReportHeaderView {
  const { employee, period, kpi } = dataset;

  const facts: KeyValueFact[] = [
    { label: 'القسم', value: employee.department ?? UNAVAILABLE, unavailable: employee.department === null },
    // The analytical dataset carries no team field — an explicit
    // unavailable state (spec §3), never an invented value.
    { label: 'الفريق', value: UNAVAILABLE, unavailable: true },
    { label: 'المسمى الوظيفي', value: employee.position ?? UNAVAILABLE, unavailable: employee.position === null },
    {
      label: 'حالة التوظيف',
      value: storedLabel(EMPLOYMENT_STATUS_LABELS, employee.employmentStatus),
      unavailable: employee.employmentStatus === 'unknown',
    },
    {
      label: 'أهلية الفترة',
      value: employee.eligibleForPeriod ? 'مؤهل للفترة' : 'غير مؤهل للفترة',
      unavailable: false,
    },
  ];

  const lifecycleBadges: Array<{ label: string; tone: Tone }> = [];
  if (employee.archivedButEligible) {
    lifecycleBadges.push({ label: 'مؤرشف حاليًا — فترة تاريخية', tone: 'warn' });
  }
  if (employee.relationship === 'INDIRECT') {
    lifecycleBadges.push({ label: RELATIONSHIP_LABELS.INDIRECT, tone: 'warn' });
  }

  return {
    employeeName: employee.employeeName || employee.employeeId,
    employeeId: employee.employeeId,
    employeeCode: employee.employeeCode,
    facts,
    lifecycleBadges,
    periodLabel: formatMonth(period.monthKey),
    valueBasis: period.valueBasis,
    valueBasisLabel: VALUE_BASIS_LABELS[period.valueBasis],
    schemeLabel: kpi.scheme ? `${kpi.scheme.schemeName} — إصدار ${kpi.scheme.schemeVersion}` : null,
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
}

export function buildKpiHero(dataset: EmployeePerformanceDataset): KpiHeroView {
  const { kpi, trend } = dataset;
  const quality = kpi.quality;
  const mom = trend.mom;

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
    directionLabel: trend.direction ? TREND_LABELS[trend.direction] ?? trend.direction : null,
    outcomeMessage: kpi.message,
    schemeLabel: kpi.scheme ? `${kpi.scheme.schemeName} — إصدار ${kpi.scheme.schemeVersion}` : null,
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

export function buildKpiComponents(dataset: EmployeePerformanceDataset): KpiComponentsView {
  const { kpi } = dataset;
  const quality = kpi.quality;

  const rows: KpiComponentRowView[] = [];

  if (quality) {
    rows.push({
      label: quality.name || 'الجودة',
      contributionDisplay: formatContribution(quality.weightedContribution, quality.maxContribution),
      statusLabel: quality.status,
      available: quality.weightedContribution !== null,
      isOverall: false,
    });
  } else {
    // No quality component result — explicit NOT AVAILABLE row (no zero).
    rows.push({
      label: 'الجودة',
      contributionDisplay: UNAVAILABLE,
      statusLabel: 'NOT_AVAILABLE',
      available: false,
      isOverall: false,
    });
  }

  rows.push({
    label: 'إجمالي KPI (المتاح)',
    contributionDisplay:
      kpi.weightedTotal === null
        ? UNAVAILABLE
        : `${formatPlainNumber(kpi.weightedTotal)}${
            kpi.availableWeight === null ? '' : ` / وزن متاح ${formatPlainNumber(kpi.availableWeight)}`
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

export function buildTrend(dataset: EmployeePerformanceDataset): TrendView {
  const { trend } = dataset;
  const points: TrendPointView[] = trend.points.map((p) => ({
    monthKey: p.monthKey,
    monthLabel: formatMonth(p.monthKey),
    scoreDisplay: p.available ? formatScore(p.rawScore) : UNAVAILABLE,
    available: p.available,
    finalized: p.finalized,
  }));

  const mom = trend.mom;
  return {
    points,
    availableCount: points.filter((p) => p.available).length,
    insufficient: points.every((p) => !p.available),
    directionLabel: trend.direction ? TREND_LABELS[trend.direction] ?? trend.direction : null,
    deltaDisplay: mom ? formatSignedPoints(mom.deltaPoints) : null,
    deltaToneValue: deltaTone(mom?.deltaPoints ?? null),
    previousMonthLabel: mom ? formatMonth(mom.previousMonth) : null,
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

export function buildObservations(dataset: EmployeePerformanceDataset): ObservationsView {
  const obs = dataset.quality.observations;
  return {
    total: obs.total,
    approved: obs.approved,
    pending: obs.pending,
    rejected: obs.rejected,
    severityChips: Object.entries(obs.bySeverity).map(([key, count]) => ({
      label: storedLabel(SEVERITY_LABELS, key),
      count,
      tone: key === 'critical' || key === 'high' ? 'bad' : key === 'medium' ? 'warn' : 'neutral',
    })),
    resolutionChips: Object.entries(obs.byResolutionStatus).map(([key, count]) => ({
      label: storedLabel(RESOLUTION_LABELS_AR, key),
      count,
      tone: RESOLUTION_TONES[key] ?? 'neutral',
    })),
    categoryRows: obs.byCategory.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryId === UNCLASSIFIED_KEY ? 'غير مصنّف' : c.categoryName,
      count: c.count,
    })),
    typeRows: dataset.quality.repeatedIssues.byType.map((t) => ({
      label: t.issueKey === UNCLASSIFIED_KEY ? 'غير مصنّف' : t.label,
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

export function buildRepeatedIssues(dataset: EmployeePerformanceDataset): RepeatedIssuesView {
  const ri = dataset.quality.repeatedIssues;
  const windowByKey = new Map(ri.windowByCategory.map((w) => [w.issueKey, w]));

  const mapRows = (groups: typeof ri.byCategory): RepeatedIssueRowView[] =>
    groups.map((g) => {
      const w = windowByKey.get(g.issueKey);
      return {
        label: g.issueKey === UNCLASSIFIED_KEY ? 'غير مصنّف' : g.label,
        occurrenceCount: g.occurrenceCount,
        firstOccurrence: g.firstOccurrence,
        lastOccurrence: g.lastOccurrence,
        windowSummary: w
          ? `${w.occurrenceCount} مرات عبر ${w.monthsPresent} أشهر`
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

export function buildDeductions(dataset: EmployeePerformanceDataset): DeductionsView {
  const d = dataset.quality.deductions;
  return {
    count: d.count,
    totalDays: d.totalDays,
    totalAmount: d.totalAmount,
    totalDaysDisplay: formatPlainNumber(d.totalDays),
    totalAmountDisplay: formatPlainNumber(d.totalAmount),
    typeChips: d.byType.map((t) => ({
      label: t.categoryId === UNCLASSIFIED_KEY ? 'غير مصنّف' : t.categoryName,
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

export function buildComplaints(dataset: EmployeePerformanceDataset): ComplaintsView {
  const c = dataset.complaints;
  return {
    relationship: c.relationship,
    relationshipLabel: RELATIONSHIP_LABELS[c.relationship],
    total: c.total,
    statusChips: entriesToChips(c.byStatus, RESOLUTION_LABELS_AR),
    typeChips: entriesToChips(c.byType),
    severityChips: entriesToChips(c.bySeverity, SEVERITY_LABELS),
    resolvedOrClosed: c.resolvedOrClosed,
    stillOpen: c.stillOpen,
    viaDealCount: c.viaDealCount,
    avgResolutionDisplay: c.avgResolutionDays === null ? UNAVAILABLE : `${Math.round(c.avgResolutionDays * 100) / 100} يوم`,
    repeatedTypes: c.repeatedTypes.map((t) => ({
      label: t.issueKey === UNCLASSIFIED_KEY ? 'غير مصنّف' : t.label,
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

export function buildCapa(dataset: EmployeePerformanceDataset): CapaView {
  const c = dataset.capa;
  return {
    relationshipLabel: RELATIONSHIP_LABELS[c.relationship],
    total: c.total,
    statusChips: entriesToChips(c.byStatus),
    priorityChips: entriesToChips(c.byPriority, SEVERITY_LABELS),
    sourceChips: entriesToChips(c.bySource),
    active: c.active,
    terminal: c.terminal,
    overdue: c.overdue,
    avgOverdueDisplay: c.avgOverdueDays === null ? UNAVAILABLE : `${Math.round(c.avgOverdueDays * 100) / 100} يوم`,
    correctiveChips: entriesToChips(c.correctiveStatus, ACTION_STATE_LABELS),
    preventiveChips: entriesToChips(c.preventiveStatus, ACTION_STATE_LABELS),
    closedCount: c.closedCount,
    avgClosureDisplay: c.avgClosureDays === null ? UNAVAILABLE : `${Math.round(c.avgClosureDays * 100) / 100} يوم`,
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

export function buildFollowUps(dataset: EmployeePerformanceDataset): FollowUpsView {
  const f = dataset.followUps;
  return {
    total: f.total,
    completed: f.completed,
    active: f.active,
    overdue: f.overdue,
    completionRateDisplay: formatPercent(f.completionRate),
    dueToday: f.dueToday,
    // Explicit unavailable state — never an estimate (spec §13).
    avgOverdueDisplay: f.avgOverdueDays === null ? UNAVAILABLE : `${Math.round(f.avgOverdueDays * 100) / 100} يوم`,
    statusChips: entriesToChips(f.byStatus),
    typeChips: entriesToChips(f.byType),
    priorityChips: entriesToChips(f.byPriority, SEVERITY_LABELS),
  };
}

// ─────────────────────────────────────────────────────────────
//  §14  Travel deals / operational context view
// ─────────────────────────────────────────────────────────────

export interface DealsView {
  total: number;
  statusChips: ChipFact[];
  completed: number;
  canceled: number;
  active: number;
  completionRateDisplay: string;
}

export function buildDeals(dataset: EmployeePerformanceDataset): DealsView {
  const d = dataset.deals;
  return {
    total: d.total,
    statusChips: (Object.entries(d.byStatus) as Array<[string, number]>).map(([key, count]) => ({
      label: storedLabel(DEAL_STATUS_LABELS, key),
      count,
      tone: key === 'completed' ? 'good' : key === 'canceled' ? 'bad' : 'info',
    })),
    completed: d.completed,
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

export function buildAttendance(dataset: EmployeePerformanceDataset): AttendanceView {
  const a = dataset.attendance;
  if (a.status !== 'AVAILABLE' || !a.result) {
    return { available: false, facts: [] };
  }
  const r = a.result;
  return {
    available: true,
    facts: [
      { label: 'أيام التأخير', value: formatPlainNumber(r.lateDays), unavailable: false },
      { label: 'أيام الغياب', value: formatPlainNumber(r.absentDays), unavailable: false },
      { label: 'أيام الإجازة/الاستثناء', value: formatPlainNumber(r.exemptDays), unavailable: false },
      { label: 'إجمالي دقائق التأخير', value: formatPlainNumber(r.totalMinutesLate), unavailable: false },
      { label: 'نسبة الالتزام', value: formatPercent(r.compliance), unavailable: false },
      { label: 'أيام خصم الحضور', value: formatPlainNumber(r.attendanceDeductionDays), unavailable: false },
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

const EVIDENCE_LABELS: Record<string, string> = {
  qualityObservations: 'ملاحظات الجودة',
  qualityDeductions: 'خصومات الجودة',
  complaints: 'شكاوى العملاء',
  capaCases: 'حالات CAPA',
  followUps: 'المتابعات',
  travelDeals: 'صفقات السفر',
  attendanceResults: 'نتائج الحضور',
  monthSnapshots: 'لقطات الشهر (KPI)',
  kpiSchemes: 'مخططات KPI',
};

export function buildEvidenceGroups(dataset: EmployeePerformanceDataset): EvidenceGroupView[] {
  const e = dataset.evidence;
  const groups: EvidenceGroupView[] = [e.observations, e.deductions, e.complaints, e.capa, e.followUps, e.deals].map(
    (ref) => ({
      collection: ref.collection,
      label: storedLabel(EVIDENCE_LABELS, ref.collection),
      count: ref.recordIds.length,
      recordIds: ref.recordIds,
      targetPage: EVIDENCE_TARGETS[ref.collection] ?? null,
    }),
  );
  if (e.attendance) {
    groups.push({
      collection: e.attendance.collection,
      label: storedLabel(EVIDENCE_LABELS, e.attendance.collection),
      count: e.attendance.recordIds.length,
      recordIds: e.attendance.recordIds,
      targetPage: EVIDENCE_TARGETS[e.attendance.collection] ?? null,
    });
  }
  // KPI evidence (frozen snapshots + resolved scheme) — separate groups.
  for (const ref of e.kpi) {
    groups.push({
      collection: ref.collection,
      label: storedLabel(EVIDENCE_LABELS, ref.collection),
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

export function buildDataQuality(dataset: EmployeePerformanceDataset): DataQualityView {
  const dq = dataset.dataQuality;
  const unattributedChips = dq.unattributedRecords.map((u) => ({
    label: storedLabel(EVIDENCE_LABELS, u.collection),
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
  labels?: Record<string, string>,
): ChipFact[] {
  return Object.entries(entries).map(([key, count]) => ({
    label: labels ? storedLabel(labels, key) : key,
    count,
    tone: 'neutral' as const,
  }));
}
