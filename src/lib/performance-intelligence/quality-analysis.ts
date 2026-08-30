// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Quality Analysis (Phase 3)
//
//  PURE aggregations over the employee's EXISTING quality records:
//    • observation status/severity/category/monthly distributions
//    • deterministic repeated-issue detection (grouping keys are
//      stored fields only — categoryId (the canonical engine's own
//      key, '_unclassified' fallback) and the observation `type`)
//    • qualityDeductions (payroll domain) aggregation — the days and
//      amount units are kept separate; KPI scoring is NEVER
//      recomputed here (lib/metrics/kpiMetrics owns that).
// ══════════════════════════════════════════════════════════════

import type { QualityObservation } from '@/types/quality-kpi';
import type { QualityDeduction } from '@/types';
import { roundTo2 } from '@/lib/kpi-framework/validation';
import { displayDateOrderKey, monthKeyOfDisplayDate, monthKeyOfStoredMonth } from './month-attribution';
import type {
  CategoryCount,
  MonthlyCount,
  ObservationAnalysisFacts,
  QualityDeductionFacts,
  QualityDeductionRecordFacts,
  RepeatedIssueGroup,
  RepeatedIssuesFacts,
  WindowRepeatedIssueGroup,
} from './types';

/** Canonical fallback key — the same one the engine's categoryTotals uses. */
export const UNCLASSIFIED_KEY = '_unclassified';

export const DEFAULT_MIN_OCCURRENCES = 2;

const SEVERITIES: ReadonlyArray<QualityObservation['severity']> = ['low', 'medium', 'high', 'critical'];

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/** Deterministic order: count desc, then key asc. */
function byCountThenKey<T extends { issueKey: string; occurrenceCount: number }>(a: T, b: T): number {
  return b.occurrenceCount - a.occurrenceCount || a.issueKey.localeCompare(b.issueKey);
}

// ─────────────────────────────────────────────────────────────
//  §6  Observation aggregation
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate the employee's observations OF THE REPORTED PERIOD.
 * All fields read are actual stored fields — no classification is
 * invented (spec §6).
 */
export function aggregateObservations(args: {
  /** Period observations — all count/severity/category aggregates (§6). */
  observations: ReadonlyArray<QualityObservation>;
  /** Window observations — §14 monthly trend series (months with data only). */
  windowObservations: ReadonlyArray<QualityObservation>;
  windowMonths: ReadonlyArray<string>;
}): ObservationAnalysisFacts {
  const { observations, windowObservations, windowMonths } = args;
  const windowSet = new Set(windowMonths);

  const byResolutionStatus: Record<string, number> = {};
  const bySeverity: Record<QualityObservation['severity'], number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const categoryCounts = new Map<string, CategoryCount>();
  const monthlyCounts = new Map<string, number>();

  for (const obs of observations) {
    increment(byResolutionStatus, obs.status);
    if (SEVERITIES.includes(obs.severity)) bySeverity[obs.severity] += 1;
    const catKey = obs.categoryId ?? UNCLASSIFIED_KEY;
    const entry = categoryCounts.get(catKey) ?? {
      categoryId: obs.categoryId ?? null,
      categoryName: obs.categoryName || UNCLASSIFIED_KEY,
      count: 0,
    };
    entry.count += 1;
    categoryCounts.set(catKey, entry);
  }
  // Monthly distribution: only months of the analysis window that
  // actually carry data — never a fabricated month.
  for (const obs of windowObservations) {
    const month = monthKeyOfStoredMonth(obs.month);
    if (month && windowSet.has(month)) monthlyCounts.set(month, (monthlyCounts.get(month) ?? 0) + 1);
  }

  const monthly: MonthlyCount[] = [...monthlyCounts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    total: observations.length,
    approved: observations.filter((o) => o.approvalStatus === 'approved').length,
    pending: observations.filter((o) => o.approvalStatus === 'pending').length,
    rejected: observations.filter((o) => o.approvalStatus === 'rejected').length,
    byResolutionStatus,
    bySeverity,
    byCategory: [...categoryCounts.values()].sort((a, b) => b.count - a.count || (a.categoryId ?? UNCLASSIFIED_KEY).localeCompare(b.categoryId ?? UNCLASSIFIED_KEY)),
    monthly,
  };
}

// ─────────────────────────────────────────────────────────────
//  §7  Repeated issue detection
// ─────────────────────────────────────────────────────────────

/** Earliest/latest stored observationDate among ids (deterministic day-first parse). */
function occurrenceBounds(ids: ReadonlyArray<string>, dateOf: Map<string, string>): {
  first: string | null;
  last: string | null;
} {
  let first: string | null = null;
  let last: string | null = null;
  let firstOrder = Number.POSITIVE_INFINITY;
  let lastOrder = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const date = dateOf.get(id);
    if (!date) continue;
    const order = displayDateOrderKey(date);
    if (order === null) continue;
    if (order < firstOrder) {
      firstOrder = order;
      first = date;
    }
    if (order > lastOrder) {
      lastOrder = order;
      last = date;
    }
  }
  return { first, last };
}

function groupObservations(
  observations: ReadonlyArray<QualityObservation>,
  keyOf: (obs: QualityObservation) => { key: string; label: string },
  minOccurrences: number,
): RepeatedIssueGroup[] {
  const groups = new Map<string, { label: string; ids: string[] }>();
  const dateOf = new Map(observations.map((o) => [o.id, o.observationDate] as const));
  for (const obs of observations) {
    const { key, label } = keyOf(obs);
    const entry = groups.get(key) ?? { label, ids: [] };
    entry.ids.push(obs.id);
    groups.set(key, entry);
  }
  const out: RepeatedIssueGroup[] = [];
  for (const [key, entry] of groups) {
    if (entry.ids.length < minOccurrences) continue;
    const bounds = occurrenceBounds(entry.ids, dateOf);
    out.push({
      issueKey: key,
      label: entry.label,
      occurrenceCount: entry.ids.length,
      firstOccurrence: bounds.first,
      lastOccurrence: bounds.last,
      observationIds: [...entry.ids].sort((a, b) => a.localeCompare(b)),
    });
  }
  return out.sort(byCountThenKey);
}

/**
 * Repeated issues WITHIN the reported period: same category and same
 * observation type appearing ≥ minOccurrences times. Pure grouping
 * over stored fields — no AI, no behavioral inference (spec §7).
 */
export function detectRepeatedIssues(args: {
  observations: ReadonlyArray<QualityObservation>;
  minOccurrences?: number;
}): Pick<RepeatedIssuesFacts, 'byCategory' | 'byType'> {
  const min = args.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  return {
    byCategory: groupObservations(
      args.observations,
      (obs) => ({
        key: obs.categoryId ?? UNCLASSIFIED_KEY,
        label: obs.categoryName || UNCLASSIFIED_KEY,
      }),
      min,
    ),
    byType: groupObservations(
      args.observations,
      (obs) => ({ key: obs.type || UNCLASSIFIED_KEY, label: obs.type || UNCLASSIFIED_KEY }),
      min,
    ),
  };
}

/**
 * Cross-month recurrence of the same issue key across the analysis
 * window (monthsPresent / firstMonth / lastMonth). Only stored month
 * keys are used — months without data are never fabricated.
 */
export function detectWindowRecurrence(args: {
  observations: ReadonlyArray<QualityObservation>;
  windowMonths: ReadonlyArray<string>;
  minOccurrences?: number;
}): WindowRepeatedIssueGroup[] {
  const min = args.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  const byKey = new Map<string, { label: string; idsByMonth: Map<string, string[]> }>();
  for (const obs of args.observations) {
    const month = monthKeyOfStoredMonth(obs.month);
    if (!month) continue;
    const key = obs.categoryId ?? UNCLASSIFIED_KEY;
    const entry = byKey.get(key) ?? { label: obs.categoryName || UNCLASSIFIED_KEY, idsByMonth: new Map() };
    const ids = entry.idsByMonth.get(month) ?? [];
    ids.push(obs.id);
    entry.idsByMonth.set(month, ids);
    byKey.set(key, entry);
  }

  const out: WindowRepeatedIssueGroup[] = [];
  for (const [key, entry] of byKey) {
    const months = [...entry.idsByMonth.keys()].sort((a, b) => a.localeCompare(b));
    const observationIds = months.flatMap((m) => entry.idsByMonth.get(m) ?? []).sort((a, b) => a.localeCompare(b));
    if (observationIds.length < min) continue;
    out.push({
      issueKey: key,
      label: entry.label,
      occurrenceCount: observationIds.length,
      monthsPresent: months.length,
      firstMonth: months[0] ?? null,
      lastMonth: months[months.length - 1] ?? null,
      observationIds,
    });
  }
  return out.sort(byCountThenKey);
}

// ─────────────────────────────────────────────────────────────
//  §8  Quality deductions (payroll domain)
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate the employee's qualityDeductions for the reported
 * period. Existing value semantics are preserved: deductionDays and
 * deductionAmount are SEPARATE units and are never merged, and no
 * assumption is made about any KPI effect (the canonical engine
 * alone defines KPI scoring).
 */
export function aggregateQualityDeductions(args: {
  records: ReadonlyArray<QualityDeduction>;
}): QualityDeductionFacts {
  const byType = new Map<string, CategoryCount>();
  let totalDays = 0;
  let totalAmount = 0;
  const records: QualityDeductionRecordFacts[] = [];

  for (const record of args.records) {
    totalDays += Number(record.deductionDays) || 0;
    totalAmount += Number(record.deductionAmount) || 0;
    const typeKey = record.type || UNCLASSIFIED_KEY;
    const entry = byType.get(typeKey) ?? { categoryId: null, categoryName: typeKey, count: 0 };
    entry.count += 1;
    byType.set(typeKey, entry);
    records.push({
      id: record.id,
      date: record.date,
      month: monthKeyOfStoredMonth(record.month) ?? monthKeyOfDisplayDate(record.date),
      type: record.type,
      description: record.description,
      deductionDays: record.deductionDays,
      deductionAmount: record.deductionAmount,
      relatedCapaId: record.relatedCapaId,
    });
  }

  return {
    count: args.records.length,
    totalDays: roundTo2(totalDays),
    totalAmount: roundTo2(totalAmount),
    byType: [...byType.values()].sort((a, b) => b.count - a.count || a.categoryName.localeCompare(b.categoryName)),
    records,
  };
}

/** Minimal per-domain count row shared by the trend series builders. */
export function countByMonth(months: ReadonlyArray<string>, records: ReadonlyArray<{ month: string | null }>): MonthlyCount[] {
  const windowSet = new Set(months);
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record.month || !windowSet.has(record.month)) continue;
    counts.set(record.month, (counts.get(record.month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
