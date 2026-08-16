// ══════════════════════════════════════════════════════════════
//  TIME-SCOPE & EMPLOYEE PERFORMANCE HISTORY CONTRACT — Phase 2 M4
//
//  LOCKED SYSTEM-WIDE RULE (binding for every metric in ARM ERP):
//
//    Current-period metrics reset with the new period; historical
//    results are never erased. Every metric must have an explicit
//    time scope.
//
//  Three distinct metric layers this contract distinguishes:
//
//    1. CURRENT-PERIOD METRICS — recalculated for the currently
//       selected period (current day / current month / selected
//       month / selected range). A new period starts a NEW
//       calculation scope; values are never carried forward.
//
//    2. HISTORICAL RESULTS — previously calculated monthly results
//       (Quality `monthSnapshots`, Attendance `attendanceResults`,
//       future Sales/HR monthly results). Stored independently per
//       month + employee. NEVER erased when a new month starts.
//
//    3. CAREER / LONG-TERM METRICS — derived aggregations over the
//       historical results (lifetime, rolling 3/6 months, YTD, best
//       month, worst month, improvement trend). Derived views only
//       — they never replace or overwrite monthly results.
//
//  Scope of this module (Milestone 4 — contract only):
//    • The canonical, domain-agnostic time-scope vocabulary every
//      future consumer (Quality, Attendance, HR, Sales, Employee 360,
//      dashboards, reports, future Performance Engine) MUST use.
//    • The MetricResult interpretation contract (§5) and the reserved
//      future MonthlyPerformanceResult snapshot (§13).
//    • Pure current-vs-history-vs-career layering helpers that give
//      Employee 360 its three explicit layers (§7/§14).
//
//  Explicitly NOT here (hard scope lock):
//    • No Attendance KPI, no PerformanceFactor composition, no
//      Unified Performance Engine, no trend algorithm (trend
//      direction stays owned by the canonical Quality engine's
//      computeTrend over stored snapshots — §15), no consumer
//      migration, no dashboard/report redesign.
//
//  Dependencies (kept minimal by design):
//    • isValidMonthKey from @/lib/month-utils (pure, shared).
//    • TYPE-ONLY import of KpiRangePreset for the interop mapping
//      (§E) — the Quality preset strings stay defined exactly once
//      in @/types/quality-kpi; this module maps INTO them, never
//      redefines them. Calendar arithmetic is intentionally local
//      (≈15 lines) instead of importing the Quality KPI engine:
//      a parity test pins resolveTimeScopeMonthKeys to
//      resolveMonthsInRange so the two can never drift.
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';
import type { KpiRangePreset } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  §A  Scope vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * The canonical time-scope kinds (Milestone 4 §4).
 *
 * Naming reuses the ESTABLISHED project range conventions
 * (KpiRangePreset strings) verbatim for the five shared calendar
 * presets; `day`, `selected_month`, `custom_range` and `career`
 * are the additions the shared contract introduces.
 */
export type TimeScopeKind =
  | 'day'             // one specific calendar day (YYYY-MM-DD)
  | 'current_month'   // the calendar month of "now"
  | 'selected_month'  // one explicitly chosen month (YYYY-MM)
  | 'previous_month'  // the month before the current one
  | 'last_3_months'   // rolling window ending at the current month
  | 'last_6_months'   // rolling window ending at the current month
  | 'current_year'    // Jan..current month of the current year
  | 'custom_range'    // an explicit list of months
  | 'career';         // all available historical results (data-bound)

/**
 * A fully-parameterized time scope. Discriminated by `kind`; the
 * parameterized kinds carry their own payload so a TimeScope value
 * is self-describing (it can be logged, serialized, and labeled
 * without knowing the consumer).
 */
export type TimeScope =
  | { kind: 'day'; date: string }
  | { kind: 'current_month' }
  | { kind: 'selected_month'; monthKey: string }
  | { kind: 'previous_month' }
  | { kind: 'last_3_months' }
  | { kind: 'last_6_months' }
  | { kind: 'current_year' }
  | { kind: 'custom_range'; monthKeys: string[] }
  | { kind: 'career' };

/**
 * Scopes whose extent is decided by the CALENDAR (resolvable to
 * month keys without touching stored data).
 */
export function isCalendarScope(scope: TimeScope): boolean {
  return scope.kind !== 'career';
}

/**
 * Scopes whose extent is decided by the DATA — they aggregate every
 * available historical result and can only be resolved against a
 * stored history, never against the clock.
 */
export function isHistoricalAggregateScope(scope: TimeScope): boolean {
  return scope.kind === 'career';
}

// ─────────────────────────────────────────────────────────────
//  §B  Key helpers (shared formatting + validation)
// ─────────────────────────────────────────────────────────────

/** Plausible year bounds — mirrors month-utils strictness. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a Date as the canonical YYYY-MM month key (LOCAL time —
 * matches the established inline convention used by the report
 * routes, month-snapshots service and attendance adapters).
 */
export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Strictly validate a day key in `YYYY-MM-DD` format, including
 * real-calendar checks (rejects 2026-02-30, out-of-range months,
 * partial dates, ISO datetimes, non-strings).
 */
export function isValidDayKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(DAY_KEY_PATTERN);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (year < MIN_YEAR || year > MAX_YEAR) return false;

  // Date round-trip rejects impossible days (e.g. 31 in a 30-day month).
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Containing month (YYYY-MM) of a validated YYYY-MM-DD day key. */
export function dayKeyToMonthKey(dayKey: string): string {
  return dayKey.slice(0, 7);
}

// ─────────────────────────────────────────────────────────────
//  §C  Scope resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a time scope to its month keys (YYYY-MM), most-recent
 * first — the established ordering convention of
 * resolveMonthsInRange / the KPI dashboard.
 *
 *   • Calendar scopes (§B kinds) → their calendar month keys.
 *   • `day`                       → the CONTAINING month (month-keyed
 *     stores — attendanceResults / monthSnapshots — are the storage
 *     granularity; day-level filtering stays a consumer concern).
 *   • `custom_range`              → the supplied keys, validated,
 *     order preserved, duplicates preserved (parity with the
 *     dashboard's custom-months query convention).
 *   • `career`                    → `null`. Career scope is DATA-BOUND,
 *     not clock-bound: it resolves to "every stored historical
 *     month", which only the caller's history store can answer.
 *     Returning null (rather than a guess from the clock) makes it
 *     impossible to fabricate a career scope from calendar
 *     arithmetic — history grows, it is never inferred.
 *
 * Throws on invalid `selected_month` / `custom_range` / `day`
 * payloads (strict-contract convention: malformed input is a caller
 * bug, not an empty result).
 */
export function resolveTimeScopeMonthKeys(scope: TimeScope, now?: Date): string[] | null {
  switch (scope.kind) {
    case 'day': {
      if (!isValidDayKey(scope.date)) {
        throw new Error(`Invalid day key for day scope: ${JSON.stringify(scope.date)} (YYYY-MM-DD required)`);
      }
      return [dayKeyToMonthKey(scope.date)];
    }

    case 'selected_month': {
      if (!isValidMonthKey(scope.monthKey)) {
        throw new Error(`Invalid month key for selected_month scope: ${JSON.stringify(scope.monthKey)} (YYYY-MM required)`);
      }
      return [scope.monthKey];
    }

    case 'custom_range': {
      const keys = scope.monthKeys ?? [];
      if (keys.length === 0) {
        throw new Error('custom_range scope requires at least one month key');
      }
      for (const key of keys) {
        if (!isValidMonthKey(key)) {
          throw new Error(`Invalid month key in custom_range scope: ${JSON.stringify(key)} (YYYY-MM required)`);
        }
      }
      return [...keys];
    }

    case 'career':
      return null;

    case 'current_month':
    case 'previous_month':
    case 'last_3_months':
    case 'last_6_months':
    case 'current_year':
      // Calendar arithmetic — semantics pinned to the canonical
      // resolveMonthsInRange by the parity test in __tests__.
      return calendarMonthKeys(scope.kind, now);
  }
}

/** Build N month keys ending at (year, month), most recent first. */
function buildMonthKeys(year: number, month: number, count: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(year, month - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

/** Resolve the five calendar presets (see resolveTimeScopeMonthKeys). */
function calendarMonthKeys(kind: 'current_month' | 'previous_month' | 'last_3_months' | 'last_6_months' | 'current_year', now?: Date): string[] {
  const date = now ?? new Date();
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (kind) {
    case 'current_month':
      return [`${year}-${String(month + 1).padStart(2, '0')}`];
    case 'previous_month': {
      const prev = new Date(year, month - 1, 1);
      return [`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`];
    }
    case 'last_3_months':
      return buildMonthKeys(year, month, 3);
    case 'last_6_months':
      return buildMonthKeys(year, month, 6);
    case 'current_year':
      return buildMonthKeys(year, month, month + 1);
  }
}

// ─────────────────────────────────────────────────────────────
//  §D  Reporting / labeling contract (§8, §10, §11)
// ─────────────────────────────────────────────────────────────

/**
 * Arabic labels for every scope kind. Reports and dashboard cards
 * MUST label values with the scope they belong to; lifelong /
 * all-time counters are only ever displayed under the `career`
 * label ("المسار الوظيفي (كل الفترات)") — never as an unlabeled
 * current-period number.
 */
export const TIME_SCOPE_LABELS_AR: Readonly<Record<TimeScopeKind, string>> = {
  day: 'يوم محدد',
  current_month: 'الشهر الحالي',
  selected_month: 'شهر محدد',
  previous_month: 'الشهر السابق',
  last_3_months: 'آخر 3 أشهر',
  last_6_months: 'آخر 6 أشهر',
  current_year: 'السنة الحالية',
  custom_range: 'نطاق مخصص',
  career: 'المسار الوظيفي (كل الفترات)',
};

/**
 * Canonical machine-readable scope label for logs, reports and API
 * payloads: `kind[:parameter]`. Examples:
 *
 *   day:2026-08-16            selected_month:2026-03
 *   current_month             career:all-time
 *   custom_range:2026-06,2026-05
 *
 * A report carrying this string can never present a mixed time
 * scope without the mismatch being visible (§10).
 */
export function describeTimeScope(scope: TimeScope): string {
  switch (scope.kind) {
    case 'day':
      return `day:${scope.date}`;
    case 'selected_month':
      return `selected_month:${scope.monthKey}`;
    case 'custom_range':
      return `custom_range:${scope.monthKeys.join(',')}`;
    case 'career':
      return 'career:all-time';
    default:
      return scope.kind;
  }
}

// ─────────────────────────────────────────────────────────────
//  §E  KpiRangePreset interop (Quality vocabulary → shared scope)
// ─────────────────────────────────────────────────────────────

/**
 * Map an existing Quality `KpiRangePreset` (+ its established
 * comma-separated customMonths query convention) into the shared
 * TimeScope vocabulary.
 *
 * This is the ONLY bridge between the two vocabularies: the preset
 * strings stay defined once in @/types/quality-kpi, and every
 * future consumer that receives a preset translates it here instead
 * of re-deriving range semantics. Consumers may pass the raw query
 * string; unknown presets fall back to `current_month` (matching
 * resolveMonthsInRange's defensive default).
 */
export function kpiPresetToTimeScope(
  preset: KpiRangePreset | string,
  customMonths?: string | string[] | null,
): TimeScope {
  switch (preset) {
    case 'current_month':
    case 'previous_month':
    case 'last_3_months':
    case 'last_6_months':
    case 'current_year':
      return { kind: preset };
    case 'custom': {
      const raw = typeof customMonths === 'string'
        ? customMonths.split(',')
        : customMonths ?? [];
      const monthKeys = raw.map((m) => m.trim()).filter(Boolean);
      return { kind: 'custom_range', monthKeys };
    }
    default:
      return { kind: 'current_month' };
  }
}

// ─────────────────────────────────────────────────────────────
//  §F  Metric context contracts (future consumers only)
// ─────────────────────────────────────────────────────────────

/**
 * The source domain of a metric. HR deductions stay a SEPARATE
 * domain (§18): they are never absorbed into the Attendance or
 * Quality KPI — they may only become their own PerformanceFactor
 * in the future engine.
 */
export type MetricSource =
  | 'quality'
  | 'attendance'
  | 'hr'
  | 'sales'
  | 'final-kpi'
  | (string & {});

/**
 * The interpretation context every future KPI / performance metric
 * must carry (§5). A metric without all of these fields is not a
 * contract-compliant metric.
 *
 * This is a CONTRACT FOR FUTURE CONSUMERS: existing database records
 * (monthSnapshots, attendanceResults, …) are NOT migrated into this
 * shape. New consumers construct MetricResult views over them.
 */
export interface MetricResult<TValue = number> {
  metricId: string;
  employeeId: string;
  /**
   * The period the value belongs to: `YYYY-MM` for month scopes,
   * `YYYY-MM-DD` for day scopes. Always the PERIOD — never "now".
   */
  period: string;
  /** The explicit scope the value was calculated under. */
  scope: TimeScope;
  value: TValue;
  /** Engine version that produced the value (e.g. 'attendance-v1'). */
  calculationVersion: string;
  source: MetricSource;
  department?: string | null;
}

/**
 * RESERVED future monthly performance snapshot (§13) — the shape the
 * Unified Performance Engine will persist per employee + month.
 * Contract reservation ONLY: nothing constructs this yet, and the
 * future engine must keep per-factor results time-scoped and
 * historical exactly like Quality/Attendance results.
 */
export interface MonthlyPerformanceResult {
  employeeId: string;
  /** YYYY-MM */
  month: string;
  qualityFactor: number | null;
  attendanceFactor: number | null;
  salesFactor: number | null;
  hrFactor: number | null;
  finalScore: number | null;
  /** Factor weights frozen at generation time (e.g. { quality: 0.4 }). */
  weightsSnapshot: Record<string, number>;
  calculationVersion: string;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  §G  Current vs History vs Career — Employee 360 layering (§7)
// ─────────────────────────────────────────────────────────────

/**
 * The minimal shape a record must expose to participate in the
 * monthly-history layering: the attendanceResults identity contract
 * (month + employeeId) that every future monthly result domain
 * (Sales, HR, future performance snapshots) must mirror (§6).
 * StoredAttendanceResult satisfies this structurally today.
 */
export interface MonthScopedResult {
  employeeId: string;
  /** YYYY-MM — the canonical monthly identity. */
  month: string;
}

/** One month's derived point in a career view. */
export interface CareerMonthPoint<T extends MonthScopedResult> {
  month: string;
  value: number;
  result: T;
}

/**
 * Career / long-term view DERIVED from stored monthly results (§14:
 * career history = the sequence of historical period results).
 *
 * Contains only arithmetic aggregations. Trend DIRECTION
 * (improving/stable/declining) is intentionally NOT computed here:
 * it stays owned by the canonical Quality trend architecture
 * (computeTrend over stored snapshots — §15) and must never be
 * inferred from a single current score.
 */
export interface CareerSummary<T extends MonthScopedResult> {
  /** Number of monthly results the view was derived from. */
  sampleSize: number;
  firstMonth: string | null;
  lastMonth: string | null;
  bestMonth: CareerMonthPoint<T> | null;
  worstMonth: CareerMonthPoint<T> | null;
  /** Mean of the monthly values, rounded (computeTrend convention). */
  averageValue: number | null;
  /**
   * Chronological deltas across the AVAILABLE records (history may
   * contain gaps — deltas are between consecutive available months).
   * Entry i = value(monthᵢ) − value(monthᵢ₋₁). Empty when fewer than
   * two results exist: a career delta is never derived from a single
   * current-period value.
   */
  monthOverMonthDeltas: { month: string; delta: number }[];
}

/** The two explicit Employee 360 performance layers + derived career. */
export interface EmployeePerformanceLayers<T extends MonthScopedResult> {
  /** The month `current` was resolved against (caller-supplied "now"). */
  currentMonthKey: string;
  /**
   * Layer A — Current Performance: the stored result for the CURRENT
   * month only, or null when that month has not been generated yet.
   * A new month starts a new scope: this value is NEVER carried
   * forward from a previous month (§9).
   */
  current: { month: string; result: T } | null;
  /**
   * Layer B — Historical Performance: every stored result for a
   * STRICTLY EARLIER month, most recent first. Records here are
   * never deleted or mutated by the passage of time (§16).
   */
  history: { month: string; result: T }[];
  /**
   * Layer C — Trend / Career: derived from ALL stored monthly
   * results (the full sequence, including the current month's
   * generated result when present). Derived views only — building
   * this NEVER overwrites a monthly record (§14).
   */
  career: CareerSummary<T>;
}

/**
 * Index stored monthly results into a per-employee, per-month map.
 *
 * Mirrors the attendanceResults regeneration semantics: when the
 * same employeeId + month appears more than once, the LAST record
 * wins (deterministic replacement, never duplication).
 */
export function buildMonthlyHistoryIndex<T extends MonthScopedResult>(
  records: T[],
): Map<string, Map<string, T>> {
  const index = new Map<string, Map<string, T>>();
  for (const record of records) {
    let months = index.get(record.employeeId);
    if (!months) {
      months = new Map<string, T>();
      index.set(record.employeeId, months);
    }
    months.set(record.month, record);
  }
  return index;
}

/**
 * Select the records whose month is in `monthKeys`, returned in the
 * SUPPLIED key order (the established most-recent-first convention).
 * Used by selected_month / previous_month / rolling-window views.
 */
export function selectMonths<T extends MonthScopedResult>(records: T[], monthKeys: string[]): T[] {
  const byMonth = new Map(records.map((r) => [r.month, r]));
  const out: T[] = [];
  for (const key of monthKeys) {
    const record = byMonth.get(key);
    if (record) out.push(record);
  }
  return out;
}

/**
 * Derive the career view from already-collected monthly points
 * (chronological order not required — this function sorts).
 *
 * Tie-break rule: equal best/worst values resolve to the MOST
 * RECENT month (deterministic).
 */
export function deriveCareerSummary<T extends MonthScopedResult>(
  points: { month: string; value: number; result: T }[],
): CareerSummary<T> {
  if (points.length === 0) {
    return {
      sampleSize: 0,
      firstMonth: null,
      lastMonth: null,
      bestMonth: null,
      worstMonth: null,
      averageValue: null,
      monthOverMonthDeltas: [],
    };
  }

  const ordered = [...points].sort((a, b) => a.month.localeCompare(b.month));

  let best = ordered[0];
  let worst = ordered[0];
  for (const point of ordered) {
    // >= / <= keeps the LATEST month on ties.
    if (point.value >= best.value) best = point;
    if (point.value <= worst.value) worst = point;
  }

  const monthOverMonthDeltas: { month: string; delta: number }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    monthOverMonthDeltas.push({
      month: ordered[i].month,
      delta: ordered[i].value - ordered[i - 1].value,
    });
  }

  return {
    sampleSize: ordered.length,
    firstMonth: ordered[0].month,
    lastMonth: ordered[ordered.length - 1].month,
    bestMonth: best,
    worstMonth: worst,
    averageValue: Math.round(ordered.reduce((sum, p) => sum + p.value, 0) / ordered.length),
    monthOverMonthDeltas,
  };
}

/**
 * Build the Employee 360 performance layers for ONE employee from
 * that employee's stored monthly results (§7).
 *
 * PURE: reads nothing, writes nothing — the monthly records are
 * never modified, so deriving layers can never damage history.
 *
 * @param args.records        All stored monthly results for ONE employee.
 * @param args.currentMonthKey The current calendar month (YYYY-MM).
 * @param args.extractValue    How to read the metric value from a record
 *                             (e.g. compliance %, deduction days).
 */
export function buildEmployeePerformanceLayers<T extends MonthScopedResult>(args: {
  records: T[];
  currentMonthKey: string;
  extractValue: (record: T) => number;
}): EmployeePerformanceLayers<T> {
  const { records, currentMonthKey, extractValue } = args;

  if (!isValidMonthKey(currentMonthKey)) {
    throw new Error(`Invalid current month key: ${JSON.stringify(currentMonthKey)} (YYYY-MM required)`);
  }

  // Last-wins on duplicate employee+month (regeneration replacement).
  const byMonth = new Map<string, T>();
  for (const record of records) byMonth.set(record.month, record);

  const currentResult = byMonth.get(currentMonthKey) ?? null;

  const history = [...byMonth.entries()]
    .filter(([month]) => month < currentMonthKey)
    .sort(([a], [b]) => b.localeCompare(a)) // most recent first
    .map(([month, result]) => ({ month, result }));

  const points = [...byMonth.entries()].map(([month, result]) => ({
    month,
    value: extractValue(result),
    result,
  }));
  const career = deriveCareerSummary(points);

  return {
    currentMonthKey,
    current: currentResult ? { month: currentMonthKey, result: currentResult } : null,
    history,
    career,
  };
}
