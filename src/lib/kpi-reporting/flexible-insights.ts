// ══════════════════════════════════════════════════════════════
//  KPI Reporting — FLEXIBLE-PERIOD INSIGHTS (§FLEX-PERIODS)
//
//  ONE flexible reporting surface over the CANONICAL machinery —
//  no second engine:
//    • period boundaries  → flexible-period.ts (pure; canonical
//      time utilities underneath)
//    • FULLY-covered months → buildMonthlyKpiReport rows verbatim
//      (frozen-first: closed month → verbatim frozen result; open
//      month → live engine preview — the EXISTING lifecycle)
//    • PARTIALLY-covered months (day/week/custom window edges) →
//      the ONE canonical scoring function (computeEmployeeScore —
//      the same function computeMonthSnapshot applies per employee)
//      run over the WINDOW'S approved observations with that month's
//      stored settings. A live calculation, ALWAYS disclosed — the
//      frozen full-month value is never narrowed silently.
//    • observations       → the insights loaders + canonical
//      aggregateObservations / detectRepeatedIssues /
//      detectWindowRecurrence, day-filtered to the period bounds
//    • scope/selection    → the SAME effective-scope rule as the
//      insights workspace (authorized ∩ requested)
//
//  VALUE BASIS (§4.2 — frozen-first, never silently mixed):
//    • Each month carries its OWN basis (FINALIZED / MTD / LIVE).
//    • FULLY-covered span, all months closed → FINALIZED.
//    • Span including the current open month → MTD.
//    • Partial-window months → LIVE (liveCalculated: true).
//    • Closed + open-past mix → MIXED, per-month bases listed.
//    • Frozen snapshot values are READ, never overwritten.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { buildOrgIndex, type OrgIndex } from '@/lib/organization/graph';
import { findAncestorAtLevel } from '@/lib/organization/levels';
import type { OrgNode } from '@/lib/organization';
import { roundTo2 } from '@/lib/kpi-framework/validation';
import { isEffectiveDeduction } from '@/lib/quality-deductions/domain';
import { computeEmployeeScore } from '@/lib/metrics/kpiMetrics';
import type { QualityDeduction } from '@/types';
import type { KpiSettings, MonthSnapshot, QualityObservation } from '@/types/quality-kpi';
import {
  aggregateObservations,
  detectRepeatedIssues,
  detectWindowRecurrence,
  UNCLASSIFIED_KEY,
} from '@/lib/performance-intelligence';
import {
  buildMonthlyKpiReport,
  defaultKpiInsightsLoaders,
  employeeIdsInOrgSubtrees,
  type KpiInsightsFilters,
  type KpiInsightsLoaders,
  type KpiInsightsSelection,
} from './index';
import type { KpiReportRow } from './types';
import type { KpiValueBasis } from './types';
import {
  resolvePeriodWithComparison,
  FlexiblePeriodValidationError,
  type FlexibleComparisonSpec,
  type FlexiblePeriodSpec,
  type ResolvedFlexiblePeriod,
} from './flexible-period';

// ─────────────────────────────────────────────────────────────
//  Public contract
// ─────────────────────────────────────────────────────────────

export interface BuildFlexibleKpiInsightsInput {
  primary: FlexiblePeriodSpec;
  comparison: FlexibleComparisonSpec;
  /** AUTHORIZED employee set (route-resolved); null = unrestricted. */
  scopeLimit?: ReadonlyArray<string> | null;
  selection?: KpiInsightsSelection;
  filters?: KpiInsightsFilters;
  minOccurrences?: number;
  now?: Date;
  loaders?: FlexibleKpiLoaders;
}

export interface FlexibleKpiLoaders extends KpiInsightsLoaders {
  /**
   * EFFECTIVE quality-deduction records for the given months (the
   * workflow gate applied by the default loader; tests inject).
   */
  loadQualityDeductionRecords(monthKeys: ReadonlyArray<string>): Promise<QualityDeduction[]>;
}

export const defaultFlexibleKpiLoaders: FlexibleKpiLoaders = {
  ...defaultKpiInsightsLoaders,
  loadQualityDeductionRecords: async (monthKeys) => {
    const months = new Set(monthKeys);
    const all = await getAll<QualityDeduction>('qualityDeductions', TTL.MEDIUM);
    return all.filter((r) => r && months.has(r.month) && isEffectiveDeduction(r));
  },
};

/** A month's basis inside a flexible span. */
export interface FlexibleMonthBasis {
  monthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  /** True when the reported value is a live window calculation. */
  liveCalculated: boolean;
}

export type FlexibleSpanBasis = 'FINALIZED' | 'MTD' | 'LIVE' | 'MIXED';

export interface FlexibleSpanMeta {
  spec: FlexiblePeriodSpec;
  startDayKey: string;
  endDayKey: string;
  monthKeys: string[];
  dayCount: number;
  includesCurrentMonth: boolean;
  labelKey: string;
  /** §4.2 — the span-level basis with per-month disclosure. */
  valueBasis: FlexibleSpanBasis;
  monthBases: FlexibleMonthBasis[];
}

export interface FlexibleEmployeeKpi {
  employeeId: string;
  employeeName: string;
  team: string | null;
  department: string | null;
  company: string | null;
  /** Span months where the employee contributed a value (denominator). */
  monthsWithValue: number;
  /** Mean raw score over contributing months (null when none). */
  averageQuality: number | null;
  /** The LAST contributing month's value (the standing result). */
  lastQuality: number | null;
  /** Comparison-span average (null when absent). */
  previousAverageQuality: number | null;
  deltaPoints: number | null;
  observationsApproved: number;
  highCritical: number;
}

export interface FlexibleUnitRollup {
  key: string;
  unitType: 'team' | 'department' | 'company';
  label: string;
  employeeCount: number;
  membersWithValue: number;
  averageQuality: number | null;
  previousAverageQuality: number | null;
  deltaPoints: number | null;
  observationsApproved: number;
  highCritical: number;
  repeatedIssues: number;
}

export interface FlexibleDeductionFacts {
  count: number;
  totalDays: number;
  byType: Array<{ type: string; count: number }>;
  previousCount: number | null;
}

export interface FlexibleKpiInsightsReport {
  reportKind: 'FLEXIBLE_INSIGHTS';
  statisticsKind: 'QUALITY_KPI';
  period: FlexibleSpanMeta;
  comparison: FlexibleSpanMeta | null;
  overview: {
    averageQuality: number | null;
    previousAverageQuality: number | null;
    qualityDeltaPoints: number | null;
    observationsTotal: number;
    observationsApproved: number;
    observationsPending: number;
    observationsRejected: number;
    highCritical: number;
    repeatedIssues: number;
    /** Denominators — value-bearing employees over evaluated ones. */
    employeesWithValue: number;
    employeesEvaluated: number;
  };
  employees: FlexibleEmployeeKpi[];
  units: FlexibleUnitRollup[];
  observations: {
    byCategory: Array<{ key: string; categoryId: string | null; label: string; count: number; pct: number | null; previousCount: number | null }>;
    bySeverity: Array<{ severity: string; count: number; pct: number | null; previousCount: number | null }>;
    repeatedIssues: Array<{ key: string; label: string; occurrenceCount: number; employeeCount: number }>;
    windowRecurrence: Array<{ key: string; label: string; occurrenceCount: number; monthsPresent: number }>;
    /** Records whose date could not be parsed — excluded, surfaced. */
    dateUnknownCount: number;
  };
  deductions: FlexibleDeductionFacts;
  dataQuality: string[];
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Pure helpers
// ─────────────────────────────────────────────────────────────

/** DD/MM/YYYY (the stored display contract) → YYYY-MM-DD, or null. */
function displayDateToDayKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function filterObservationsToSpan(
  observations: ReadonlyArray<QualityObservation>,
  span: ResolvedFlexiblePeriod,
): { inRange: QualityObservation[]; dateUnknownCount: number } {
  const inRange: QualityObservation[] = [];
  let dateUnknownCount = 0;
  for (const obs of observations) {
    const dayKey = displayDateToDayKey(obs.observationDate);
    if (dayKey === null) {
      dateUnknownCount += 1;
      continue;
    }
    if (dayKey >= span.startDayKey && dayKey <= span.endDayKey) inRange.push(obs);
  }
  return { inRange, dateUnknownCount };
}

/** Whether a span covers a month entirely (frozen-first) or partially (window). */
function monthCoverage(span: ResolvedFlexiblePeriod, monthKey: string): 'FULL' | 'PARTIAL' {
  const [y, m] = monthKey.split('-').map(Number);
  const first = `${monthKey}-01`;
  const last = new Date(y!, m!, 0).getDate();
  const lastKey = `${monthKey}-${String(last).padStart(2, '0')}`;
  return span.startDayKey <= first && span.endDayKey >= lastKey ? 'FULL' : 'PARTIAL';
}

function spanBasisOf(monthBases: ReadonlyArray<FlexibleMonthBasis>, includesCurrentMonth: boolean): FlexibleSpanBasis {
  if (monthBases.length === 0) return includesCurrentMonth ? 'MTD' : 'LIVE';
  const allFinalized = monthBases.every((m) => m.finalized);
  const anyFinalized = monthBases.some((m) => m.finalized);
  if (allFinalized) return 'FINALIZED';
  if (includesCurrentMonth) return 'MTD';
  return anyFinalized ? 'MIXED' : 'LIVE';
}

function averageOf(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  return roundTo2(values.reduce((a, b) => a + b, 0) / values.length);
}

function deltaOrNull(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return roundTo2(current - previous);
}

// ─────────────────────────────────────────────────────────────
//  Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build the flexible-period KPI insights report. Overlapping
 * primary/comparison periods produce an EXPLICIT error (§4.1) —
 * never a misleading side-by-side.
 */
export async function buildFlexibleKpiInsights(
  input: BuildFlexibleKpiInsightsInput,
): Promise<FlexibleKpiInsightsReport> {
  const now = input.now ?? new Date();
  const loaders = input.loaders ?? defaultFlexibleKpiLoaders;
  const minOccurrences = input.minOccurrences ?? 2;
  const includeArchived = input.filters?.includeArchived === true;

  // ── §4.1 periods (overlap policy enforced inside) ──
  const resolvedPair = resolvePeriodWithComparison(input.primary, input.comparison, now);
  if (!resolvedPair.ok) {
    // §API-ERROR-CONTRACTS — typed validation failure (stable code, no
    // message-substring classification downstream).
    throw new FlexiblePeriodValidationError(resolvedPair.code, resolvedPair.error);
  }
  const { primary: primarySpan, comparison: comparisonSpan } = resolvedPair.value;

  // ── Effective employee set (the SAME rule as the insights workspace) ──
  const [orgNodes, allEmployees] = await Promise.all([
    loaders.loadOrgNodes(),
    loaders.loadEmployees(),
  ]);
  const orgIndex = buildOrgIndex(orgNodes);

  const requested = new Set<string>();
  let hasRequestedSelection = false;
  for (const id of input.selection?.employeeIds ?? []) {
    if (typeof id === 'string' && id.length > 0) {
      requested.add(id);
      hasRequestedSelection = true;
    }
  }
  const orgNodeIds = (input.selection?.orgNodeIds ?? []).filter((id) => typeof id === 'string' && id.length > 0);
  if (orgNodeIds.length > 0) {
    hasRequestedSelection = true;
    for (const id of employeeIdsInOrgSubtrees(orgIndex, orgNodeIds, allEmployees)) requested.add(id);
  }
  let effectiveLimit: ReadonlyArray<string> | null;
  if (hasRequestedSelection) {
    effectiveLimit = input.scopeLimit
      ? [...requested].filter((id) => input.scopeLimit!.includes(id))
      : [...requested];
  } else {
    effectiveLimit = input.scopeLimit ?? null;
  }
  const inScope = (employeeId: string): boolean =>
    effectiveLimit === null || effectiveLimit.includes(employeeId);

  // Company label resolution (org-tree semantic level — the canonical rule).
  const companyLabelByEmployee = new Map<string, string | null>();
  for (const employee of allEmployees) {
    companyLabelByEmployee.set(
      employee.id,
      employee.orgNodeId ? findAncestorAtLevel(orgIndex, employee.orgNodeId, 'company')?.name ?? null : null,
    );
  }

  // ── Canonical monthly assemblies — ONE per span month (batched) ──
  const allMonths = [...new Set([...primarySpan.monthKeys, ...comparisonSpan.monthKeys])].sort();
  const monthlyReports = await Promise.all(
    allMonths.map((monthKey) =>
      buildMonthlyKpiReport({
        monthKey,
        reportKind: 'MONTHLY',
        filters: { includeArchived, scopeLimit: effectiveLimit },
        now,
        loaders,
      }),
    ),
  );
  const reportByMonth = new Map(monthlyReports.map((report) => [report.monthKey, report]));
  // Snapshot docs ONCE per month (settings for window recomputes +
  // finalized flags — no duplicate queries; read-only).
  const snapshotByMonth = new Map<string, MonthSnapshot | null>(
    await Promise.all(
      allMonths.map(async (monthKey) => [monthKey, await loaders.loadMonthDetail(monthKey)] as const),
    ),
  );

  const spanMetaOf = (span: ResolvedFlexiblePeriod): FlexibleSpanMeta => {
    const monthBases: FlexibleMonthBasis[] = span.monthKeys.map((monthKey) => {
      const report = reportByMonth.get(monthKey);
      const coverage = monthCoverage(span, monthKey);
      const windowLive = coverage === 'PARTIAL';
      return {
        monthKey,
        // A partially-covered month reports a live WINDOW value even
        // when the underlying snapshot is frozen — disclosed, never
        // narrowed silently.
        valueBasis: windowLive ? 'LIVE' : report?.valueBasis ?? 'LIVE',
        finalized: windowLive ? false : report?.finalized ?? false,
        liveCalculated: windowLive || (report ? !report.finalized : true),
      };
    });
    return {
      spec: span.spec,
      startDayKey: span.startDayKey,
      endDayKey: span.endDayKey,
      monthKeys: span.monthKeys,
      dayCount: span.dayCount,
      includesCurrentMonth: span.includesCurrentMonth,
      labelKey: span.labelKey,
      valueBasis: spanBasisOf(monthBases, span.includesCurrentMonth),
      monthBases,
    };
  };

  const periodMeta = spanMetaOf(primarySpan);
  const comparisonMeta = spanMetaOf(comparisonSpan);

  // ── Observations: each span month loaded ONCE, day-filtered ──
  const [primaryObsByMonth, comparisonObsByMonth, primaryDeductions, comparisonDeductions] = await Promise.all([
    Promise.all(primarySpan.monthKeys.map((m) => loaders.loadObservations(m))),
    Promise.all(comparisonSpan.monthKeys.map((m) => loaders.loadObservations(m))),
    loaders.loadQualityDeductionRecords(primarySpan.monthKeys),
    loaders.loadQualityDeductionRecords(comparisonSpan.monthKeys),
  ]);
  const primaryObsByMonthMap = new Map(
    primarySpan.monthKeys.map((m, i) => [m, (primaryObsByMonth[i] ?? []).filter((o) => o && typeof o.employeeId === 'string' && inScope(o.employeeId))]),
  );
  const scopeObs = (rows: QualityObservation[][]) =>
    rows.flat().filter((o) => o && typeof o.employeeId === 'string' && inScope(o.employeeId));

  const primaryFiltered = filterObservationsToSpan(scopeObs(primaryObsByMonth.map((m) => m)), primarySpan);
  const comparisonFiltered = filterObservationsToSpan(scopeObs(comparisonObsByMonth), comparisonSpan);
  const primaryApproved = primaryFiltered.inRange.filter((o) => o.approvalStatus === 'approved');
  const comparisonApproved = comparisonFiltered.inRange.filter((o) => o.approvalStatus === 'approved');

  // ── Quality distributions (canonical aggregations, window-filtered) ──
  const analysis = aggregateObservations({
    observations: primaryApproved,
    windowObservations: primaryApproved,
    windowMonths: primarySpan.monthKeys,
  });
  const approvedTotal = analysis.total;

  const prevCategoryCounts = new Map<string, number>();
  for (const obs of comparisonApproved) {
    const key = obs.categoryId ?? UNCLASSIFIED_KEY;
    prevCategoryCounts.set(key, (prevCategoryCounts.get(key) ?? 0) + 1);
  }
  const prevSeverityCounts = new Map<string, number>();
  for (const obs of comparisonApproved) {
    prevSeverityCounts.set(obs.severity, (prevSeverityCounts.get(obs.severity) ?? 0) + 1);
  }

  const byCategory = analysis.byCategory.map((entry) => ({
    key: entry.categoryId ?? UNCLASSIFIED_KEY,
    categoryId: entry.categoryId,
    label: entry.categoryName,
    count: entry.count,
    pct: approvedTotal > 0 ? roundTo2((entry.count / approvedTotal) * 100) : null,
    previousCount: comparisonApproved.length > 0 ? prevCategoryCounts.get(entry.categoryId ?? UNCLASSIFIED_KEY) ?? 0 : null,
  }));

  const bySeverity = (['critical', 'high', 'medium', 'low'] as const).map((severity) => {
    const count = analysis.bySeverity[severity] ?? 0;
    return {
      severity,
      count,
      pct: approvedTotal > 0 ? roundTo2((count / approvedTotal) * 100) : null,
      previousCount: comparisonApproved.length > 0 ? prevSeverityCounts.get(severity) ?? 0 : null,
    };
  });

  const repetition = detectRepeatedIssues({ observations: primaryApproved, minOccurrences });
  const repeatedIssues = repetition.byCategory.map((group) => {
    const affected = [...new Set(
      group.observationIds
        .map((id) => primaryApproved.find((o) => o.id === id)?.employeeId)
        .filter((id): id is string => !!id),
    )];
    return {
      key: group.issueKey,
      label: group.label,
      occurrenceCount: group.occurrenceCount,
      employeeCount: affected.length,
    };
  });

  const windowRecurrence = detectWindowRecurrence({
    observations: primaryApproved,
    windowMonths: primarySpan.monthKeys,
    minOccurrences,
  }).map((group) => ({
    key: group.issueKey,
    label: group.label,
    occurrenceCount: group.occurrenceCount,
    monthsPresent: group.monthsPresent,
  }));

  // ── Quality deductions (effective records, month-scoped) ──
  const deductions: FlexibleDeductionFacts = {
    count: primaryDeductions.length,
    totalDays: roundTo2(primaryDeductions.reduce((sum, d) => sum + (d.deductionDays ?? 0), 0)),
    byType: [...primaryDeductions.reduce((map, d) => {
      map.set(d.type, (map.get(d.type) ?? 0) + 1);
      return map;
    }, new Map<string, number>())].map(([type, count]) => ({ type, count })),
    previousCount: comparisonDeductions.length,
  };

  // ── Per-employee KPI across the span (frozen-first + window rule) ──
  const isValueBearing = (row: KpiReportRow): boolean => row.quality !== null && row.quality.rawScore !== null;

  /**
   * ONE canonical scoring function on the WINDOW's approved
   * observations with the month's stored settings — the identical
   * function computeMonthSnapshot applies per employee. null when
   * the settings or observations are unavailable (disclosed, never
   * substituted by the full-month frozen value).
   */
  const windowScoreOf = (
    employeeId: string,
    monthKey: string,
    span: ResolvedFlexiblePeriod,
  ): number | null => {
    const snapshot = snapshotByMonth.get(monthKey);
    const settings = snapshot?.settingsSnapshot;
    if (!settings) return null;
    const monthObs = primaryObsByMonthMap.get(monthKey) ?? [];
    const windowObs = filterObservationsToSpan(monthObs, span).inRange.filter(
      (o) => o.employeeId === employeeId,
    );
    if (windowObs.length === 0) return null;
    return computeEmployeeScore(windowObs, settings, employeeId).score;
  };

  const spanValuesByEmployee = (span: ResolvedFlexiblePeriod): Map<string, number[]> => {
    const out = new Map<string, number[]>();
    for (const monthKey of span.monthKeys) {
      const rows = reportByMonth.get(monthKey)?.rows ?? [];
      const coverage = monthCoverage(span, monthKey);
      const seen = new Set<string>();
      for (const row of rows) {
        if (!isValueBearing(row)) continue;
        seen.add(row.employeeId);
        if (coverage === 'FULL') {
          // Frozen-first verbatim (or the month's canonical live value).
          const list = out.get(row.employeeId) ?? [];
          list.push(row.quality!.rawScore!);
          out.set(row.employeeId, list);
        }
      }
      if (coverage === 'PARTIAL') {
        // Window rule — employees with in-window observations get a
        // live canonical recomputation; the full-month frozen value
        // is never narrowed silently.
        const monthEmployees = new Set([
          ...[...(reportByMonth.get(monthKey)?.rows ?? []).map((r) => r.employeeId)],
        ]);
        for (const employeeId of monthEmployees) {
          if (!inScope(employeeId)) continue;
          const score = windowScoreOf(employeeId, monthKey, span);
          if (score === null) continue;
          const list = out.get(employeeId) ?? [];
          list.push(score);
          out.set(employeeId, list);
        }
      }
    }
    return out;
  };

  const primaryValues = spanValuesByEmployee(primarySpan);
  const comparisonValues = spanValuesByEmployee(comparisonSpan);

  const evaluatedIds = new Set<string>();
  for (const rows of primarySpan.monthKeys.map((m) => reportByMonth.get(m)?.rows ?? [])) {
    for (const row of rows) evaluatedIds.add(row.employeeId);
  }

  const employeesOut: FlexibleEmployeeKpi[] = [];
  for (const employeeId of [...evaluatedIds].sort()) {
    const values = primaryValues.get(employeeId) ?? [];
    const prevValues = comparisonValues.get(employeeId) ?? [];
    // Identity from the LAST span month's row (the standing snapshot).
    let base: KpiReportRow | null = null;
    for (let i = primarySpan.monthKeys.length - 1; i >= 0; i -= 1) {
      const row = reportByMonth.get(primarySpan.monthKeys[i]!)?.rows.find((r) => r.employeeId === employeeId);
      if (row) {
        base = row;
        break;
      }
    }
    if (!base) continue;
    const approvedObsForEmployee = primaryApproved.filter((o) => o.employeeId === employeeId);
    employeesOut.push({
      employeeId,
      employeeName: base.employeeName,
      team: base.team,
      department: base.department,
      company: companyLabelByEmployee.get(employeeId) ?? null,
      monthsWithValue: values.length,
      averageQuality: averageOf(values),
      lastQuality: values.length > 0 ? values[values.length - 1]! : null,
      previousAverageQuality: averageOf(prevValues),
      deltaPoints: deltaOrNull(averageOf(values), averageOf(prevValues)),
      observationsApproved: approvedObsForEmployee.length,
      highCritical: approvedObsForEmployee.filter((o) => o.severity === 'high' || o.severity === 'critical').length,
    });
  }

  // ── Unit rollups (team / department / company — real membership) ──
  const buildUnitRollups = (unitType: 'team' | 'department' | 'company'): FlexibleUnitRollup[] => {
    const groups = new Map<string, FlexibleEmployeeKpi[]>();
    for (const employee of employeesOut) {
      const label = unitType === 'team' ? employee.team : unitType === 'department' ? employee.department : employee.company;
      if (!label) continue;
      const list = groups.get(label) ?? [];
      list.push(employee);
      groups.set(label, list);
    }
    return [...groups.entries()]
      .map(([label, members]) => {
        const memberIds = new Set(members.map((m) => m.employeeId));
        const avg = averageOf(members.map((m) => m.averageQuality).filter((v): v is number => v !== null));
        const prevAvg = averageOf(members.map((m) => m.previousAverageQuality).filter((v): v is number => v !== null));
        const unitApproved = primaryApproved.filter((o) => memberIds.has(o.employeeId));
        return {
          key: `${unitType}:${label}`,
          unitType,
          label,
          employeeCount: members.length,
          membersWithValue: members.filter((m) => m.averageQuality !== null).length,
          averageQuality: avg,
          previousAverageQuality: prevAvg,
          deltaPoints: deltaOrNull(avg, prevAvg),
          observationsApproved: unitApproved.length,
          highCritical: unitApproved.filter((o) => o.severity === 'high' || o.severity === 'critical').length,
          repeatedIssues: detectRepeatedIssues({ observations: unitApproved, minOccurrences }).byCategory.length,
        };
      })
      .sort((a, b) => b.employeeCount - a.employeeCount || a.label.localeCompare(b.label, 'ar'));
  };

  const units = [
    ...buildUnitRollups('team'),
    ...buildUnitRollups('department'),
    ...buildUnitRollups('company'),
  ];

  // ── Overview (independent comparison) ──
  const allValues = employeesOut.map((e) => e.averageQuality).filter((v): v is number => v !== null);
  const allPrevValues = employeesOut.map((e) => e.previousAverageQuality).filter((v): v is number => v !== null);
  const averageQuality = averageOf(allValues);
  const previousAverageQuality = averageOf(allPrevValues);

  // ── Data quality (explicit limitations) ──
  const dataQuality: string[] = [];
  if (primaryFiltered.dateUnknownCount > 0) {
    dataQuality.push(`observationsDateUnknown:${primaryFiltered.dateUnknownCount}`);
  }
  if (periodMeta.valueBasis === 'MIXED') {
    dataQuality.push(`mixedValueBasis:${periodMeta.monthBases.filter((m) => !m.finalized).length}`);
  }
  if (periodMeta.monthBases.some((m) => m.liveCalculated)) {
    dataQuality.push('liveCalculatedMonthsPresent');
  }

  return {
    reportKind: 'FLEXIBLE_INSIGHTS',
    statisticsKind: 'QUALITY_KPI',
    period: periodMeta,
    comparison: comparisonMeta,
    overview: {
      averageQuality,
      previousAverageQuality,
      qualityDeltaPoints: deltaOrNull(averageQuality, previousAverageQuality),
      observationsTotal: primaryFiltered.inRange.length,
      observationsApproved: primaryApproved.length,
      observationsPending: primaryFiltered.inRange.filter((o) => o.approvalStatus === 'pending').length,
      observationsRejected: primaryFiltered.inRange.filter((o) => o.approvalStatus === 'rejected').length,
      highCritical: primaryApproved.filter((o) => o.severity === 'high' || o.severity === 'critical').length,
      repeatedIssues: repeatedIssues.length,
      employeesWithValue: allValues.length,
      employeesEvaluated: employeesOut.length,
    },
    employees: employeesOut,
    units,
    observations: {
      byCategory,
      bySeverity,
      repeatedIssues,
      windowRecurrence,
      dateUnknownCount: primaryFiltered.dateUnknownCount,
    },
    deductions,
    dataQuality,
    generatedAt: now.toISOString(),
  };
}
