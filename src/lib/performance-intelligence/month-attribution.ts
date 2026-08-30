// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Month attribution (Phase 3)
//
//  Pure helpers that attribute a stored record to a YYYY-MM period.
//  The project stores dates in TWO canonical shapes:
//    • month keys          — strict `YYYY-MM` (lib/month-utils)
//    • display dates       — `DD/MM/YYYY` (observations, attendance,
//                            travel, follow-ups)
//    • engine timestamps   — ISO (`createdAt`/`updatedAt`/`closedAt`)
//
//  Attribution is DETERMINISTIC and CONSERVATIVE: a record whose
//  month cannot be derived reliably is reported as unattributed
//  (surfaced in dataset.dataQuality), never guessed into a bucket.
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';

/**
 * Strict stored month key — used verbatim when valid, null otherwise.
 */
export function monthKeyOfStoredMonth(value: unknown): string | null {
  return isValidMonthKey(value) ? value : null;
}

/**
 * Derive a YYYY-MM month key from a DD/MM/YYYY display date — the
 * SAME convention as the observations route's canonical `deriveMonth`
 * (day-first split), plus strict validation of the produced key.
 * Returns null for unparseable input (never fabricates a month).
 */
export function monthKeyOfDisplayDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [, month, year] = parts;
  if (!/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const candidate = `${year}-${month.padStart(2, '0')}`;
  return isValidMonthKey(candidate) ? candidate : null;
}

/** Derive a YYYY-MM month key from an ISO timestamp (or an ISO date). */
export function monthKeyOfIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 7) return null;
  if (!/^\d{4}-\d{2}/.test(value)) return null;
  const candidate = value.slice(0, 7);
  return isValidMonthKey(candidate) ? candidate : null;
}

/**
 * First-choice-then-fallback attribution. Returns the first
 * parseable month key among the candidates, else null.
 */
export function attributeMonth(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const fromStored = monthKeyOfStoredMonth(candidate);
    if (fromStored) return fromStored;
    const fromDisplay = monthKeyOfDisplayDate(candidate);
    if (fromDisplay) return fromDisplay;
    const fromIso = monthKeyOfIso(candidate);
    if (fromIso) return fromIso;
  }
  return null;
}

/**
 * Chronological ordering key for a DD/MM/YYYY display date
 * (y×10000 + m×100 + d). Null when unparseable — callers keep such
 * records out of first/last occurrence ordering.
 */
export function displayDateOrderKey(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return y * 10000 + m * 100 + d;
}
