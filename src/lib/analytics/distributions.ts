// ══════════════════════════════════════════════════════════════
//  Analytics distributions — Phase 5.3 TypeScript engine
//
//  EXACT port of the reference distribution builders
//  (python-analytics/employee_analytics.py — REFERENCE ONLY).
//  Pure functions over the verified dataset's aggregate blocks.
// ══════════════════════════════════════════════════════════════

import { num, pct, r } from './numeric';

export interface AnalyticsDistributionItem {
  key: string | null;
  label: string;
  count: number;
  sharePct: number | null;
}

export interface AnalyticsDistribution {
  total: number;
  items: AnalyticsDistributionItem[];
  concentration: AnalyticsDistributionItem[];
}

/** Measurable-concentration thresholds (reference §8 — FACTS only). */
export const CONCENTRATION_MIN_COUNT = 3;
export const CONCENTRATION_MIN_SHARE_PCT = 40;

type Entry = [key: unknown, label: unknown, count: unknown];

/**
 * Shared distribution builder (reference _distribution):
 * cleaned entries (count numeric > 0), deterministic order
 * (count desc, then key asc by code units), sharePct = count/total*100,
 * concentration = count >= 3 AND share >= 40%.
 */
export function buildDistribution(entries: Iterable<Entry>, total: unknown): AnalyticsDistribution {
  const cleaned: Array<{ key: string; label: string; count: number }> = [];
  for (const [key, labelValue, count] of entries) {
    const n = num(count);
    if (n === null || n <= 0) continue;
    cleaned.push({
      key: key === null || key === undefined ? '_unclassified' : (key as string),
      label: labelValue ? String(labelValue) : '_unclassified',
      count: Math.trunc(n),
    });
  }
  cleaned.sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const cleanedSum = cleaned.reduce((acc, e) => acc + e.count, 0);
  const totalNum = typeof total === 'number' && total !== 0 ? total : cleanedSum;

  const items: AnalyticsDistributionItem[] = cleaned.map((e) => ({
    key: e.key,
    label: e.label,
    count: e.count,
    sharePct: pct(e.count, totalNum),
  }));

  const concentration: AnalyticsDistributionItem[] = [];
  for (const item of items) {
    if (
      item.count >= CONCENTRATION_MIN_COUNT &&
      item.sharePct !== null &&
      item.sharePct >= CONCENTRATION_MIN_SHARE_PCT
    ) {
      concentration.push({
        key: item.key,
        label: item.label,
        count: item.count,
        sharePct: item.sharePct,
      });
    }
  }

  return { total: Math.trunc(totalNum), items, concentration };
}

/** Distribution over a Record<string, number> mapping (reference _record_dist). */
export function recordDistribution(record: unknown): AnalyticsDistribution {
  const mapping: Record<string, unknown> =
    typeof record === 'object' && record !== null && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : {};
  const entries: Entry[] = Object.entries(mapping).map(([k, v]) => [k, k, v] as Entry);
  const total = Object.values(mapping).reduce<number>((acc, v) => acc + Math.trunc(num(v) ?? 0), 0);
  return buildDistribution(entries, total);
}

export interface CategoryCountRow {
  categoryId?: unknown;
  categoryName?: unknown;
  count?: unknown;
}

/** Distribution over CategoryCount[] rows (reference _category_dist). */
export function categoryDistribution(categoryCounts: unknown): AnalyticsDistribution {
  const rows = Array.isArray(categoryCounts)
    ? categoryCounts.filter((c): c is CategoryCountRow =>
        typeof c === 'object' && c !== null && !Array.isArray(c))
    : [];
  const entries: Entry[] = rows.map((c) => [c.categoryId ?? null, c.categoryName ?? null, c.count] as Entry);
  const total = rows.reduce((acc, c) => acc + Math.trunc(num(c.count) ?? 0), 0);
  return buildDistribution(entries, total);
}

export interface MonthlySeriesRow {
  month?: unknown;
  count?: unknown;
}

export interface MonthlySeriesResult {
  series: number[];
  outside: string[];
}

/**
 * Complete count series over the window (reference _monthly_series):
 * `monthly` is the dataset's canonical "months WITH data" list.
 * A window month absent from it has 0 STORED records — a stored fact,
 * never a fabricated observation. Months OUTSIDE the window are
 * reported separately for the data-quality section.
 */
export function monthlySeries(window: string[], monthly: unknown): MonthlySeriesResult {
  const counts = new Map<string, number>();
  if (Array.isArray(monthly)) {
    for (const row of monthly) {
      if (typeof row !== 'object' || row === null) continue;
      const m = (row as MonthlySeriesRow).month;
      const n = num((row as MonthlySeriesRow).count);
      if (m === null || m === undefined || n === null) continue;
      counts.set(String(m), Math.trunc(n));
    }
  }
  const windowSet = new Set(window);
  const series = window.map((m) => counts.get(m) ?? 0);
  const outside = Array.from(counts.keys()).filter((m) => !windowSet.has(m)).sort();
  return { series, outside };
}
