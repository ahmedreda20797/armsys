// ══════════════════════════════════════════════════════════════
//  Canonical Attendance Engine — date utilities
//
//  Boundary validation and legacy month semantics for the DD/MM/YYYY
//  + YYYY-MM formats used across the attendance domain (audit §1.8).
//  Pure functions only — no I/O.
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';

/** Strict DD/MM/YYYY shape. */
const LEGACY_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

const ARABIC_DAY_NAMES = [
  'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
] as const;

export interface ParsedLegacyDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

function daysInMonth(year: number, month: number): number {
  // month is 1-based; day 0 of the next month = last day of this month.
  // Handles leap years via the Gregorian rules implemented in Date.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parse a legacy DD/MM/YYYY date string into components.
 * Returns null for malformed strings, impossible months (13+), or
 * days beyond the month's length (e.g. 31/02/2026, 29/02/2023).
 */
export function parseLegacyDate(value: unknown): ParsedLegacyDate | null {
  if (typeof value !== 'string') return null;
  const match = value.match(LEGACY_DATE_PATTERN);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (year < 1900 || year > 2100) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

/** True only for well-formed, real DD/MM/YYYY calendar dates. */
export function isValidLegacyDate(value: unknown): value is string {
  return parseLegacyDate(value) !== null;
}

/** Arabic day-of-week name for a validated DD/MM/YYYY date. Timezone-independent. */
export function legacyDateDayName(dateStr: string): string {
  const parsed = parseLegacyDate(dateStr);
  if (!parsed) return '';
  const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return ARABIC_DAY_NAMES[weekday];
}

/**
 * Evaluate the list of calendar dates a month computation must walk,
 * preserving the legacy semantics of the previous report routes:
 *
 *   • every calendar day of the month (weekends included — see
 *     WeekendPolicy in types.ts), zero-padded DD/MM/YYYY;
 *   • when `asOf` falls inside the SAME month, only days up to and
 *     including the asOf day are evaluated (future days don't exist);
 *   • `asOf` null or in a different month → the full month
 *     (leap-year February included).
 *
 * Throws on an invalid month key — the engine must never silently
 * accept malformed months.
 */
export function getEvaluatedDates(monthKey: string, asOf: Date | null): string[] {
  if (!isValidMonthKey(monthKey)) {
    throw new TypeError(`Invalid month key "${monthKey}" (expected YYYY-MM)`);
  }

  const [yearStr, monStr] = monthKey.split('-');
  const year = Number(yearStr);
  const month = Number(monStr);

  const total = daysInMonth(year, month);
  const dates: string[] = [];
  for (let day = 1; day <= total; day++) {
    dates.push(`${String(day).padStart(2, '0')}/${monStr}/${yearStr}`);
  }

  if (asOf) {
    const asOfYear = asOf.getFullYear();
    const asOfMonth = asOf.getMonth() + 1;
    if (asOfYear === year && asOfMonth === month) {
      const todayDay = asOf.getDate();
      return dates.filter((d) => Number(d.slice(0, 2)) <= todayDay);
    }
  }

  return dates;
}

/**
 * Format a minute total using the legacy Arabic presentation
 * (e.g. 190 → "3س 10د", 45 → "45د"). Moved verbatim from the report
 * routes so both adapters share one implementation.
 */
export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}د`;
  return mins > 0 ? `${hours}س ${mins}د` : `${hours}س`;
}

/** Round to 2 decimal places (legacy deduction-total rounding). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
