// ══════════════════════════════════════════════════════════════
//  FOLLOW-UPS PERIOD SEMANTICS — pure, isomorphic helpers
//
//  One module for the Follow-ups period dimension (§PERF-FOLLOWUPS):
//    • Period membership uses the record's canonical `date` field.
//    • Due/overdue logic stays on `nextFollowUpDate` via the canonical
//      predicates in lib/metrics/followUpMetrics — NEVER here.
//    • Month keys are the project-wide "YYYY-MM" convention
//      (isValidMonthKey / currentMonthKey / generateMonthOptions).
//    • Bounds are pure STRING comparisons — record `date` values are
//      "YYYY-MM-DD" day keys, so comparing strings needs no timezone
//      arithmetic and cannot drift across UTC offsets.
//  Used by GET /api/follow-ups (server-side restriction), the page
//  (default period + deep-link seed) and the regression tests.
// ══════════════════════════════════════════════════════════════

import { currentMonthKey } from '@/lib/date-utils';
import { isValidMonthKey } from '@/lib/month-utils';

/** The cross-month attention set the GET response carries alongside
 *  the period-bounded list (canonical predicates, server-computed). */
export interface FollowUpsAttentionPayload {
  overdue: Record<string, any>[];
  dueToday: Record<string, any>[];
}

export interface MonthBounds {
  /** Inclusive lower bound — "YYYY-MM-01". */
  start: string;
  /** EXCLUSIVE upper bound — first day of the following month. */
  endExclusive: string;
}

/** '2026-10' → { start: '2026-10-01', endExclusive: '2026-11-01' }. */
export function monthBounds(month: string): MonthBounds {
  const [y, m] = month.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: `${month}-01`,
    endExclusive: `${nextY}-${String(nextM).padStart(2, '0')}-01`,
  };
}

/**
 * The effective page month: the explicit value when it is a valid
 * "YYYY-MM" key, otherwise the CURRENT CALENDAR MONTH (local
 * semantics via currentMonthKey — never UTC-derived). Deep-link seeds
 * and stale persisted state both pass through here, so an invalid or
 * missing period can never widen the query to all history.
 */
export function resolveFollowUpsMonth(raw: unknown, now: Date = new Date()): string {
  return isValidMonthKey(raw) ? raw : currentMonthKey(now);
}

/**
 * The cache-identity token for the follow-ups list query: distinct
 * periods MUST produce distinct tokens so September and October never
 * overwrite each other's snapshot, while an absent period collapses
 * to one stable "current" identity.
 */
export function followUpsPeriodToken(
  month: string | null,
  range: { start?: string; end?: string } | null,
): string {
  if (range && (range.start || range.end)) {
    return `range:${range.start ?? ''}..${range.end ?? ''}`;
  }
  return month || 'current';
}

/**
 * Period selector options: the NEXT month first (advance planning),
 * then the current month and the 11 months before it — the same
 * generateMonthOptions window every other module uses, no duplicate
 * month-picker architecture.
 */
export function followUpMonthOptions(now: Date = new Date()): string[] {
  const current = currentMonthKey(now);
  const [y, m] = current.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const next = `${nextY}-${String(nextM).padStart(2, '0')}`;
  // monthKeysBack(12) = current + the 11 before it; prepending next
  // gives next + current + 11 previous = 13 unique months.
  return [next, ...monthKeysBack(12, now)].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );
}

/** The n months before (and including) the current one, newest first. */
function monthKeysBack(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
