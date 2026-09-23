// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — locale-aware formatting helpers
//
//  Pure, deterministic value rendering for factor signals and
//  scorecard metrics. Null renders '—' — a missing value is never
//  formatted as 0 (the report's data-honesty rule).
//
//  Presentation only: delegates to the shared locale-aware layer
//  (src/lib/i18n/format). React callers pass the active locale
//  (useLanguage()); non-React modules omit it and the module-current
//  display locale applies.
// ══════════════════════════════════════════════════════════════

import { displayLocale, formatNumber, formatPercentage } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/dictionary';

const DASH = '—';

/** Percentage; null → dash. */
export function pctAr(value: number | null | undefined, locale: Locale = displayLocale()): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return formatPercentage(Math.round(value * 10) / 10, { locale, maximumFractionDigits: 1 });
}

/** Point deltas; null → dash. */
export function pointsAr(value: number | null | undefined, locale: Locale = displayLocale()): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return formatNumber(Math.round(value * 10) / 10, { locale, maximumFractionDigits: 1 });
}

/** Day counts (may be fractional, e.g. 0.25-day deductions). */
export function daysAr(value: number | null | undefined, locale: Locale = displayLocale()): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${formatNumber(value, { locale, maximumFractionDigits: 1 })} يوم`;
}

/** Plain counts. */
export function countAr(value: number | null | undefined, locale: Locale = displayLocale()): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return formatNumber(value, { locale, maximumFractionDigits: 1 });
}

/** Minute totals (attendance lateness). */
export function minutesAr(value: number | null | undefined, locale: Locale = displayLocale()): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${formatNumber(value, { locale, maximumFractionDigits: 1 })} دقيقة`;
}
