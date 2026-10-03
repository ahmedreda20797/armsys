// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — shared view helpers
//
//  Small client-safe utilities shared by view-model.ts and
//  intelligence-view.ts. NO calculations — display formatting and
//  application-owned label lookup only.
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import { formatPercentage, DASH } from '@/lib/i18n/format';

/**
 * Fallback-aware lookup of an application-owned [ar, en] label pair.
 * Returns null when the key is unknown (caller decides the fallback).
 */
export function uiLabelSafe(
  map: Record<string, readonly [string, string] | [string, string]>,
  key: string,
  locale: Locale,
): string | null {
  const pair = map[key];
  if (!pair) return null;
  return locale === 'en' ? pair[1] : pair[0];
}

/** Locale-aware percent display (unavailable passes through as a dash state). */
export function formatPercent(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return formatPercentage(Math.round(value * 100) / 100, { locale });
}

/** Signed percentage-point delta, e.g. "+5.2" / "-3"; null passes through. */
export function formatSignedPoints(value: number | null | undefined, locale: Locale): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  const body = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'ar-EG', {
    maximumFractionDigits: 2,
  }).format(Math.abs(rounded));
  if (rounded === 0) return locale === 'en' ? '0' : '٠';
  return rounded > 0 ? (locale === 'en' ? `+${body}` : `+${body}`) : (locale === 'en' ? `-${body}` : `-${body}`);
}
