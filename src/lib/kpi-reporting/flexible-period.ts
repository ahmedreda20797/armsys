// ══════════════════════════════════════════════════════════════
//  KPI Reporting — FLEXIBLE PERIOD RESOLUTION (§FLEX-PERIODS)
//
//  Pure date-boundary resolution for KPI Reports' flexible reporting
//  periods. Reuses the CANONICAL time utilities — no second period
//  engine:
//    • day-key validity/calendar checks → lib/time-scope isValidDayKey
//    • day → containing month            → lib/time-scope dayKeyToMonthKey
//    • day-range → month keys            → lib/reports/scope monthKeysBetween
//    • month arithmetic                  → period-basis monthKeyOf
//
//  Supported period kinds (§4 required periods):
//    day | week | month | quarter | six_months | year | custom_range
//  plus an INDEPENDENT comparison period (any kind, or 'previous' =
//  the immediately-preceding equal-length span).
//
//  Conventions (ONE policy, applied everywhere):
//    • Boundaries are DAY keys (YYYY-MM-DD), inclusive on both ends.
//    • All date math is LOCAL-timezone `new Date(y, m-1, d)` — the
//      same convention the canonical month utilities use.
//    • 'week' = a 7-day span anchored at an explicit weekStart day —
//      no week-numbering system is invented; the UI presets compute
//      the anchor through weekStartOf()/previousWeekStartOf().
//    • 'quarter'/'six_months'/'year' are CALENDAR spans (Q1–Q4, H1/H2,
//      Jan–Dec) — "first quarter vs second quarter" semantics.
//    • Maximum span: 372 days (a year + leap tolerance) — bounded,
//      explicit, never a silent truncation.
//    • The primary and comparison periods must NOT overlap — an
//      overlap is an explicit validation error, never a misleading
//      comparison.
// ══════════════════════════════════════════════════════════════

import { isValidDayKey, dayKeyToMonthKey } from '@/lib/time-scope';
import { monthKeysBetween } from '@/lib/reports/scope';
import { monthKeyOf } from './period-basis';

/** §FLEX-PERIODS — the supported reporting-period kinds. */
export type FlexiblePeriodKind =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'six_months'
  | 'year'
  | 'custom_range';

export type FlexiblePeriodSpec =
  | { kind: 'day'; date: string }
  | { kind: 'week'; weekStart: string }
  | { kind: 'month'; monthKey: string }
  | { kind: 'quarter'; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: 'six_months'; year: number; half: 1 | 2 }
  | { kind: 'year'; year: number }
  | { kind: 'custom_range'; fromDate: string; toDate: string };

/** The independent comparison period: explicit, or the auto previous span. */
export type FlexibleComparisonSpec = FlexiblePeriodSpec | { kind: 'previous_period' };

/** Max supported span (days, inclusive) — bounded and documented. */
export const FLEXIBLE_PERIOD_MAX_DAYS = 372;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
//  Typed validation failures (§API-ERROR-CONTRACTS)
//
//  Every rejection below is USER-INPUT validation, never a server
//  fault. Instead of classifying these errors by matching Arabic
//  message substrings (fragile against copy changes), each failure
//  carries a STABLE machine-readable code. The Arabic text stays the
//  user-facing message; the code travels in the API error body's
//  `details` so clients branch on structure, not prose.
// ─────────────────────────────────────────────────────────────

/** Stable, machine-readable codes for flexible-period validation failures. */
export type FlexiblePeriodErrorCode =
  | 'INVALID_DAY_KEY'      // a YYYY-MM-DD boundary failed validation
  | 'INVALID_MONTH_KEY'    // a YYYY-MM key failed validation
  | 'INVALID_YEAR'         // calendar year out of the supported range
  | 'INVALID_RANGE_ORDER'  // custom_range: toDate before fromDate
  | 'EXCEEDS_MAX_SPAN'     // span beyond FLEXIBLE_PERIOD_MAX_DAYS
  | 'UNKNOWN_KIND'         // unsupported period kind
  | 'PERIOD_OVERLAP';      // primary/comparison periods overlap (§4.1)

/** A user-input validation failure raised while resolving periods. */
export class FlexiblePeriodValidationError extends Error {
  readonly code: FlexiblePeriodErrorCode;
  constructor(code: FlexiblePeriodErrorCode, message: string) {
    super(message);
    this.name = 'FlexiblePeriodValidationError';
    this.code = code;
  }
}

/**
 * Structural classification (never message matching): true for ANY
 * flexible-period validation failure, whether received as the error
 * class or cross-bundle as a plain object with the stable name/code.
 */
export function isFlexiblePeriodValidationError(error: unknown): error is FlexiblePeriodValidationError {
  if (error instanceof FlexiblePeriodValidationError) return true;
  const candidate = error as { name?: unknown; code?: unknown } | null;
  return (
    !!candidate &&
    candidate.name === 'FlexiblePeriodValidationError' &&
    typeof candidate.code === 'string'
  );
}

// ─────────────────────────────────────────────────────────────
//  Day-key primitives (local-timezone policy)
// ─────────────────────────────────────────────────────────────

function dayKeyToDate(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function dateToDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDays(dayKey: string, days: number): string {
  const date = dayKeyToDate(dayKey);
  date.setDate(date.getDate() + days);
  return dateToDayKey(date);
}

function daysInclusive(startDayKey: string, endDayKey: string): number {
  return Math.round((dayKeyToDate(endDayKey).getTime() - dayKeyToDate(startDayKey).getTime()) / DAY_MS) + 1;
}

function isValidYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

// ─────────────────────────────────────────────────────────────
//  Resolution
// ─────────────────────────────────────────────────────────────

export interface ResolvedFlexiblePeriod {
  kind: FlexiblePeriodKind;
  /** Inclusive start boundary (day key). */
  startDayKey: string;
  /** Inclusive end boundary (day key). */
  endDayKey: string;
  /** Containing month keys spanned by the range, ASCENDING. */
  monthKeys: string[];
  /** The span in days (inclusive) — the honest denominator basis. */
  dayCount: number;
  /** True when the span reaches into the current calendar month. */
  includesCurrentMonth: boolean;
  /** Stable label rule id (the UI renders the localized label). */
  labelKey: string;
  /** Raw spec echo (serializable identity). */
  spec: FlexiblePeriodSpec;
}

export type PeriodResolution =
  | { ok: true; period: ResolvedFlexiblePeriod }
  | { ok: false; error: string; code: FlexiblePeriodErrorCode };

/**
 * Resolve ONE period spec to explicit day boundaries + month keys.
 * Pure; `now` is injectable for deterministic tests.
 */
export function resolveFlexiblePeriod(spec: FlexiblePeriodSpec, now: Date = new Date()): PeriodResolution {
  const currentMonth = monthKeyOf(now);

  switch (spec.kind) {
    case 'day': {
      if (!isValidDayKey(spec.date)) return { ok: false, error: `تاريخ غير صالح: ${spec.date}`, code: 'INVALID_DAY_KEY' };
      return {
        ok: true,
        period: {
          kind: 'day',
          startDayKey: spec.date,
          endDayKey: spec.date,
          monthKeys: [dayKeyToMonthKey(spec.date)],
          dayCount: 1,
          includesCurrentMonth: dayKeyToMonthKey(spec.date) === currentMonth,
          labelKey: 'period.day',
          spec,
        },
      };
    }
    case 'week': {
      if (!isValidDayKey(spec.weekStart)) return { ok: false, error: `بداية أسبوع غير صالحة: ${spec.weekStart}`, code: 'INVALID_DAY_KEY' };
      const endDayKey = shiftDays(spec.weekStart, 6);
      const monthKeys = monthKeysBetween(spec.weekStart, endDayKey);
      return {
        ok: true,
        period: {
          kind: 'week',
          startDayKey: spec.weekStart,
          endDayKey,
          monthKeys,
          dayCount: 7,
          includesCurrentMonth: monthKeys.includes(currentMonth),
          labelKey: 'period.week',
          spec,
        },
      };
    }
    case 'month': {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(spec.monthKey)) {
        return { ok: false, error: `شهر غير صالح: ${spec.monthKey}`, code: 'INVALID_MONTH_KEY' };
      }
      const [y, m] = spec.monthKey.split('-').map(Number);
      const lastDay = new Date(y!, m!, 0).getDate();
      const startDayKey = `${spec.monthKey}-01`;
      const endDayKey = `${spec.monthKey}-${String(lastDay).padStart(2, '0')}`;
      return {
        ok: true,
        period: {
          kind: 'month',
          startDayKey,
          endDayKey,
          monthKeys: [spec.monthKey],
          dayCount: lastDay,
          includesCurrentMonth: spec.monthKey === currentMonth,
          labelKey: 'period.month',
          spec,
        },
      };
    }
    case 'quarter': {
      if (!isValidYear(spec.year)) return { ok: false, error: `سنة غير صالحة: ${String(spec.year)}`, code: 'INVALID_YEAR' };
      const startMonth = (spec.quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const lastDay = new Date(spec.year, endMonth, 0).getDate();
      const startDayKey = dayKeyOfYearMonth(spec.year, startMonth, 1);
      const endDayKey = dayKeyOfYearMonth(spec.year, endMonth, lastDay);
      const monthKeys = monthKeysBetween(startDayKey, endDayKey);
      return {
        ok: true,
        period: {
          kind: 'quarter',
          startDayKey,
          endDayKey,
          monthKeys,
          dayCount: daysInclusive(startDayKey, endDayKey),
          includesCurrentMonth: monthKeys.includes(currentMonth),
          labelKey: 'period.quarter',
          spec,
        },
      };
    }
    case 'six_months': {
      if (!isValidYear(spec.year)) return { ok: false, error: `سنة غير صالحة: ${String(spec.year)}`, code: 'INVALID_YEAR' };
      const startMonth = spec.half === 1 ? 1 : 7;
      const endMonth = spec.half === 1 ? 6 : 12;
      const lastDay = new Date(spec.year, endMonth, 0).getDate();
      const startDayKey = dayKeyOfYearMonth(spec.year, startMonth, 1);
      const endDayKey = dayKeyOfYearMonth(spec.year, endMonth, lastDay);
      const monthKeys = monthKeysBetween(startDayKey, endDayKey);
      return {
        ok: true,
        period: {
          kind: 'six_months',
          startDayKey,
          endDayKey,
          monthKeys,
          dayCount: daysInclusive(startDayKey, endDayKey),
          includesCurrentMonth: monthKeys.includes(currentMonth),
          labelKey: 'period.sixMonths',
          spec,
        },
      };
    }
    case 'year': {
      if (!isValidYear(spec.year)) return { ok: false, error: `سنة غير صالحة: ${String(spec.year)}`, code: 'INVALID_YEAR' };
      const isLeap = new Date(spec.year, 1, 29).getMonth() === 1;
      const startDayKey = dayKeyOfYearMonth(spec.year, 1, 1);
      const endDayKey = dayKeyOfYearMonth(spec.year, 12, 31);
      return {
        ok: true,
        period: {
          kind: 'year',
          startDayKey,
          endDayKey,
          monthKeys: monthKeysBetween(startDayKey, endDayKey),
          dayCount: isLeap ? 366 : 365,
          includesCurrentMonth: now.getFullYear() === spec.year,
          labelKey: 'period.year',
          spec,
        },
      };
    }
    case 'custom_range': {
      if (!isValidDayKey(spec.fromDate)) return { ok: false, error: `تاريخ بداية غير صالح: ${spec.fromDate}`, code: 'INVALID_DAY_KEY' };
      if (!isValidDayKey(spec.toDate)) return { ok: false, error: `تاريخ نهاية غير صالح: ${spec.toDate}`, code: 'INVALID_DAY_KEY' };
      if (spec.toDate < spec.fromDate) {
        return { ok: false, error: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية (أو مساويًا له)', code: 'INVALID_RANGE_ORDER' };
      }
      const dayCount = daysInclusive(spec.fromDate, spec.toDate);
      if (dayCount > FLEXIBLE_PERIOD_MAX_DAYS) {
        return { ok: false, error: `المدى يتجاوز الحد الأقصى (${FLEXIBLE_PERIOD_MAX_DAYS} يومًا)`, code: 'EXCEEDS_MAX_SPAN' };
      }
      const monthKeys = monthKeysBetween(spec.fromDate, spec.toDate);
      return {
        ok: true,
        period: {
          kind: 'custom_range',
          startDayKey: spec.fromDate,
          endDayKey: spec.toDate,
          monthKeys,
          dayCount,
          includesCurrentMonth: monthKeys.includes(currentMonth),
          labelKey: 'period.customRange',
          spec,
        },
      };
    }
    default: {
      // Exhaustiveness guard — unknown kinds never resolve.
      return { ok: false, error: `نوع فترة غير معروف: ${String((spec as { kind?: unknown }).kind)}`, code: 'UNKNOWN_KIND' };
    }
  }
}

function dayKeyOfYearMonth(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
//  Comparison period + overlap policy
// ─────────────────────────────────────────────────────────────

/**
 * The immediately-preceding EQUAL-LENGTH span (no overlap, no gap):
 * [start − dayCount, start − 1] shifted as whole days. Calendar-
 * anchored kinds (quarter/half/year/month) keep calendar alignment
 * through their own previous unit.
 */
export function previousPeriodSpecOf(spec: FlexiblePeriodSpec): FlexiblePeriodSpec {
  switch (spec.kind) {
    case 'month': {
      const [y, m] = spec.monthKey.split('-').map(Number);
      const date = new Date(y!, m! - 2, 1);
      return { kind: 'month', monthKey: monthKeyOf(date) };
    }
    case 'quarter': {
      return spec.quarter === 1
        ? { kind: 'quarter', year: spec.year - 1, quarter: 4 }
        : { kind: 'quarter', year: spec.year, quarter: (spec.quarter - 1) as 1 | 2 | 3 | 4 };
    }
    case 'six_months': {
      return spec.half === 1
        ? { kind: 'six_months', year: spec.year - 1, half: 2 }
        : { kind: 'six_months', year: spec.year, half: 1 };
    }
    case 'year':
      return { kind: 'year', year: spec.year - 1 };
    default: {
      // day / week / custom_range — equal-length preceding span by days.
      const resolved = resolveFlexiblePeriod(spec);
      if (!resolved.ok) return { kind: 'month', monthKey: monthKeyOf(new Date()) };
      const { startDayKey, dayCount } = resolved.period;
      return {
        kind: 'custom_range',
        fromDate: shiftDays(startDayKey, -dayCount),
        toDate: shiftDays(startDayKey, -1),
      };
    }
  }
}

/** True when two resolved spans share at least one day. */
export function periodsOverlap(a: ResolvedFlexiblePeriod, b: ResolvedFlexiblePeriod): boolean {
  return a.startDayKey <= b.endDayKey && b.startDayKey <= a.endDayKey;
}

export interface ComparisonResolution {
  primary: ResolvedFlexiblePeriod;
  comparison: ResolvedFlexiblePeriod;
}

export type ComparisonResolutionResult =
  | { ok: true; value: ComparisonResolution }
  | { ok: false; error: string; code: FlexiblePeriodErrorCode };

/**
 * Resolve the primary + comparison pair under the OVERLAP POLICY: an
 * overlapping comparison is an explicit error — never a misleading
 * side-by-side (spec §4.1).
 */
export function resolvePeriodWithComparison(
  primarySpec: FlexiblePeriodSpec,
  comparisonSpec: FlexibleComparisonSpec,
  now: Date = new Date(),
): ComparisonResolutionResult {
  const primary = resolveFlexiblePeriod(primarySpec, now);
  if (!primary.ok) return primary;
  const effectiveSpec =
    comparisonSpec.kind === 'previous_period' ? previousPeriodSpecOf(primarySpec) : comparisonSpec;
  const comparison = resolveFlexiblePeriod(effectiveSpec, now);
  if (!comparison.ok) return comparison;
  if (periodsOverlap(primary.period, comparison.period)) {
    return { ok: false, error: 'فترتا التقرير والمقارنة متداخلتان — اختر فترتي مقارنة مستقلتين', code: 'PERIOD_OVERLAP' };
  }
  return { ok: true, value: { primary: primary.period, comparison: comparison.period } };
}

// ─────────────────────────────────────────────────────────────
//  Week anchors (UI presets — no week-numbering system invented)
// ─────────────────────────────────────────────────────────────

/**
 * The week anchor (Saturday) containing `dayKey` — the Egypt business
 * week runs Sun–Thu with the Fri/Sat weekend, so weeks START Saturday.
 */
export function weekStartOf(dayKey: string, now: Date = new Date()): string {
  if (!isValidDayKey(dayKey)) return dateToDayKey(now);
  const date = dayKeyToDate(dayKey);
  // getDay(): 0=Sun … 6=Sat. Saturday-anchored start:
  // Sat(6)→0 shift, Sun(0)→-1, Mon(1)→-2, … Fri(5)→-6.
  const shift = date.getDay() === 6 ? 0 : date.getDay() + 1;
  return shiftDays(dayKey, -shift);
}

/** The week anchor immediately before the one containing `dayKey`. */
export function previousWeekStartOf(dayKey: string, now: Date = new Date()): string {
  return shiftDays(weekStartOf(dayKey, now), -7);
}

// ─────────────────────────────────────────────────────────────
//  Comparison derivation (§FLEX-PERIODS UI)
//
//  The picker offers an explicit comparison KIND; this helper derives
//  a spec OF THAT KIND from the primary period — the chosen kind is
//  honored exactly (never silently replaced by the primary's kind),
//  and the derived value is the natural neighbor of the primary:
//    day          → the day immediately before the primary start
//    week         → the 7 days before the primary start (Saturday-
//                   anchored when the primary itself is a week)
//    month        → the calendar month before the primary's first month
//    quarter      → the quarter containing the primary's first month,
//                   stepped one quarter back
//    six_months   → the half containing the primary's first month,
//                   stepped one half back
//    year         → the year of the primary's first month, minus one
//    custom_range → the equal-length span immediately before the
//                   primary (no overlap, no gap)
//  The result may OVERLAP nothing by construction only for day/week/
//  custom_range; calendar kinds derive from the primary's FIRST month
//  so a caller still validates through resolvePeriodWithComparison.
// ─────────────────────────────────────────────────────────────

/** The previous calendar unit of a month key (pure YYYY-MM arithmetic). */
function previousMonthKeyOf(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return monthKeyOf(new Date(y!, m! - 2, 1));
}

export function deriveComparisonSpec(
  primarySpec: FlexiblePeriodSpec,
  kind: Exclude<FlexibleComparisonSpec, { kind: 'previous_period' }>['kind'],
): FlexiblePeriodSpec {
  // The primary's first-month anchor (calendar kinds derive from it).
  const firstMonthKeyOf = (spec: FlexiblePeriodSpec): string => {
    switch (spec.kind) {
      case 'month':
        return spec.monthKey;
      case 'quarter':
        return `${spec.year}-${String((spec.quarter - 1) * 3 + 1).padStart(2, '0')}`;
      case 'six_months':
        return `${spec.year}-${spec.half === 1 ? '01' : '07'}`;
      case 'year':
        return `${spec.year}-01`;
      default: {
        const resolved = resolveFlexiblePeriod(spec);
        if (!resolved.ok) return monthKeyOf(new Date());
        return resolved.period.monthKeys[0] ?? monthKeyOf(new Date());
      }
    }
  };
  const firstMonth = firstMonthKeyOf(primarySpec);
  const [fy, fm] = firstMonth.split('-').map(Number);
  const firstDay = dayKeyOfYearMonth(fy!, fm!, 1);

  switch (kind) {
    case 'day':
      return { kind: 'day', date: shiftDays(firstDay, -1) };
    case 'week': {
      // Saturday-anchored when the primary is itself a week; otherwise
      // the 7 days immediately before the primary start.
      if (primarySpec.kind === 'week') {
        return { kind: 'week', weekStart: shiftDays(primarySpec.weekStart, -7) };
      }
      const resolved = resolveFlexiblePeriod(primarySpec);
      const start = resolved.ok ? resolved.period.startDayKey : firstDay;
      return { kind: 'week', weekStart: shiftDays(start, -7) };
    }
    case 'month':
      return { kind: 'month', monthKey: previousMonthKeyOf(firstMonth) };
    case 'quarter': {
      const q = Math.floor((fm! - 1) / 3) + 1;
      return q === 1
        ? { kind: 'quarter', year: fy! - 1, quarter: 4 }
        : { kind: 'quarter', year: fy!, quarter: (q - 1) as 1 | 2 | 3 | 4 };
    }
    case 'six_months': {
      const half = fm! <= 6 ? 1 : 2;
      return half === 1
        ? { kind: 'six_months', year: fy! - 1, half: 2 }
        : { kind: 'six_months', year: fy!, half: 1 };
    }
    case 'year':
      return { kind: 'year', year: fy! - 1 };
    case 'custom_range': {
      const resolved = resolveFlexiblePeriod(primarySpec);
      const start = resolved.ok ? resolved.period.startDayKey : firstDay;
      const count = resolved.ok ? resolved.period.dayCount : 30;
      return { kind: 'custom_range', fromDate: shiftDays(start, -count), toDate: shiftDays(start, -1) };
    }
    default:
      return { kind: 'month', monthKey: previousMonthKeyOf(firstMonth) };
  }
}
