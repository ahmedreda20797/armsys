// src/lib/i18n/format.ts
// ══════════════════════════════════════════════════════════════
//  §20.1-FORMAT — THE single locale-aware presentation layer for
//  numbers, percentages, dates and times.
//
//  WHY: report/dashboard components hardcoded their Intl locale
//  ('ar-EG' / 'ar-SA'), so English mode kept receiving Arabic-Indic
//  digits and Arabic month names (and no EN path existed at all).
//  Every numeric/date RENDER goes through here now; business logic
//  keeps raw numbers — this layer is presentation-only and never
//  feeds formatted strings back into calculations.
//
//  NUMERAL POLICY (the system-wide contract):
//    ar → 'ar-EG'  — Arabic-Indic digits (٠١٢…), Arabic month names,
//                    '٪' percent sign (the app's existing convention).
//    en → 'en-GB'  — Latin digits, English month names, day-first
//                    dates (same day/month ORDER as the Arabic
//                    presentation, so only script changes).
//
//  Two consumption modes:
//    • Explicit — pass `locale` (from useLanguage()) when the caller
//      re-renders on locale switch (preferred in React components).
//    • Current — omit `locale` and the module-current display locale
//      is used (synced by the LanguageProvider). For non-React
//      modules (print adapters, lib helpers) whose output is built
//      on user action, after the locale has settled.
// ══════════════════════════════════════════════════════════════

import type { Locale } from './dictionary';

/** The Intl tag each app locale renders with. */
const INTL_LOCALE: Record<Locale, string> = { ar: 'ar-EG', en: 'en-GB' };

// ── Module-current display locale (synced by LanguageProvider) ──
let currentLocale: Locale = 'ar';

/** Sync the module-current display locale (LanguageProvider calls this). */
export function setDisplayLocale(locale: Locale): void {
  currentLocale = locale;
}

/** The module-current display locale. */
export function displayLocale(): Locale {
  return currentLocale;
}

/** Resolve a caller locale (or the current one) to an Intl locale tag. */
export function intlLocale(locale?: Locale): string {
  return INTL_LOCALE[locale ?? currentLocale];
}

/** The universal missing-value glyph — a missing value is never 0. */
export const DASH = '—';

// ─────────────────────────────────────────────────────────────
//  Numbers
// ─────────────────────────────────────────────────────────────

export interface NumberFormatOptions {
  locale?: Locale;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Force grouping separators off (ids, codes). */
  useGrouping?: boolean;
}

/** Locale-aware number: 1,234.5 → «١٬٢٣٤٫٥» (ar) / «1,234.5» (en). */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const { locale, minimumFractionDigits, maximumFractionDigits, useGrouping } = options;
  return new Intl.NumberFormat(intlLocale(locale), {
    ...(minimumFractionDigits !== undefined ? { minimumFractionDigits } : {}),
    ...(maximumFractionDigits !== undefined ? { maximumFractionDigits } : {}),
    ...(useGrouping !== undefined ? { useGrouping } : {}),
  }).format(value);
}

/** Whole-number counts: 1234 → «١٬٢٣٤» (ar) / «1,234» (en). */
export function formatInteger(value: number, locale?: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(value);
}

/**
 * Percentage. The value is in PERCENT UNITS (88 → «88%»), matching the
 * existing report payloads — never style:'percent' (that would ×100).
 * ar renders with the Arabic percent sign: 88 → «٨٨٪».
 */
export function formatPercentage(
  value: number,
  options: NumberFormatOptions = {},
): string {
  const eff: Locale = options.locale ?? currentLocale;
  const body = new Intl.NumberFormat(intlLocale(eff), {
    maximumFractionDigits: options.maximumFractionDigits ?? 1,
    ...(options.minimumFractionDigits !== undefined ? { minimumFractionDigits: options.minimumFractionDigits } : {}),
    ...(options.useGrouping !== undefined ? { useGrouping: options.useGrouping } : {}),
  }).format(value);
  return eff === 'en' ? `${body}%` : `${body}٪`;
}

// ─────────────────────────────────────────────────────────────
//  Dates & times — presentation only; stored ISO/Firebase payloads
//  and period keys are never touched.
// ─────────────────────────────────────────────────────────────

type DateInput = Date | number | string;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Locale-aware date. Options passthrough when a site needs a custom shape. */
export function formatDate(
  value: DateInput,
  locale?: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  return options
    ? d.toLocaleDateString(intlLocale(locale), options)
    : d.toLocaleDateString(intlLocale(locale));
}

/** Locale-aware date + time. */
export function formatDateTime(
  value: DateInput,
  locale?: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  return options
    ? d.toLocaleString(intlLocale(locale), options)
    : d.toLocaleString(intlLocale(locale));
}

/** Locale-aware clock. */
export function formatTime(
  value: DateInput,
  locale?: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  return options
    ? d.toLocaleTimeString(intlLocale(locale), options)
    : d.toLocaleTimeString(intlLocale(locale));
}

/**
 * Canonical period key «YYYY-MM» → localized month label
 * («سبتمبر ٢٠٢٦» / «September 2026»). Unparseable keys pass through.
 */
export function formatMonthKey(monthKey: string | null | undefined, locale?: Locale): string {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return formatDate(new Date(y, m - 1, 1), locale, { month: 'long', year: 'numeric' });
}

/** Localized unit words for the shared «N days / N minutes» renderers. */
export function unitWord(unit: 'day' | 'days' | 'minute' | 'minutes' | 'record' | 'records', locale?: Locale): string {
  const eff: Locale = locale ?? currentLocale;
  const table: Record<string, [string, string]> = {
    day: ['يوم', 'day'],
    days: ['يوم', 'days'],
    minute: ['دقيقة', 'minute'],
    minutes: ['دقيقة', 'minutes'],
    record: ['سجل', 'record'],
    records: ['سجل', 'records'],
  };
  const [ar, enWord] = table[unit] ?? ['', ''];
  return eff === 'en' ? enWord : ar;
}
