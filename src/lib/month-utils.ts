// ══════════════════════════════════════════════════════════════
//  Month-key validation (YYYY-MM)
//
//  Reusable, STRICT validator for the month-key format used across the
//  Quality KPI Monthly Snapshot pipeline. Rejects malformed values,
//  arbitrary strings, out-of-range months, and non-string types.
//
//  This is a pure module with no database dependency, so it can be
//  unit-tested in isolation and imported by any API route or service.
// ══════════════════════════════════════════════════════════════

/** Strict YYYY-MM shape (used as the first-line regex gate). */
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

/** Plausible year bounds — guards against `0000` / far-future junk. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/**
 * Strictly validate a month key in `YYYY-MM` format.
 *
 * Rules enforced (spec §18):
 *   • Must be a string.
 *   • Must match `YYYY-MM` exactly (4-digit year, dash, 2-digit month).
 *   • Month must be 01–12 (rejects 00 and 13+).
 *   • Year must fall within a plausible range.
 *   • Rejects arbitrary strings, partial dates, ISO datetimes, etc.
 *
 * @param value - The candidate month key.
 * @returns `true` only when the value is a well-formed, in-range `YYYY-MM`.
 */
export function isValidMonthKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = value.match(MONTH_KEY_PATTERN);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12) return false;
  if (year < MIN_YEAR || year > MAX_YEAR) return false;

  return true;
}

/**
 * Validate a month key and return an error message if invalid.
 *
 * Convenience wrapper for API routes that need to surface a specific
 * Arabic validation error to the client.
 *
 * @param value - The candidate month key.
 * @returns `null` when valid, otherwise an Arabic error message.
 */
export function validateMonthKey(value: unknown): string | null {
  if (isValidMonthKey(value)) return null;
  return 'صيغة الشهر غير صحيحة (YYYY-MM مطلوبة، شهر من 01 إلى 12)';
}
