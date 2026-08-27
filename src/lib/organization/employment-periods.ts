// ══════════════════════════════════════════════════════════════
//  Employment periods — M0.6-A addendum (append-only + pure folding)
//
//  An employee's lifecycle is a SEQUENCE, not a single state:
//
//    ACTIVE ──► ARCHIVED ──► RESTORED ──► ACTIVE ──► …
//
//  The employee row keeps only its PRESENT state (status + archive
//  metadata). The full history lives in an append-only ledger
//  (arm_erp/employmentEvents): one immutable event per archive /
//  restore. Folding that ledger yields EMPLOYMENT PERIODS — the
//  data model future date-aware reporting, KPI and MTD engines need
//  in order to answer "was this person employed, and for which part
//  of the requested period?" WITHOUT ever zero-filling someone who
//  had already left (NO ACTIVITY ≠ NOT EMPLOYED).
//
//  DESIGN CONSTRAINTS (addendum §5-§13):
//    • Restore reuses the SAME employee record/id — nothing here
//      ever mints or copies identities.
//    • Restoring does NOT erase the archived period — events are
//      immutable and folding keeps both periods distinct.
//    • Multiple employment periods are first-class.
//    • Legacy employees (no events) fold to one open period —
//      nothing is fabricated.
// ══════════════════════════════════════════════════════════════

import { createId } from '@paralleldrive/cuid2';

/** RTDB table for the append-only employment lifecycle ledger. */
export const EMPLOYMENT_EVENTS_TABLE = 'employmentEvents';

export type EmploymentEventKind = 'archived' | 'restored';

export const EMPLOYMENT_EVENT_KINDS: readonly EmploymentEventKind[] = [
  'archived',
  'restored',
];

export interface EmploymentEvent {
  id: string;
  employeeId: string;
  kind: EmploymentEventKind;
  /** ISO instant the transition took effect. */
  effectiveAt: string;
  /** Authenticated actor id (server-derived; never client-supplied). */
  actorUserId?: string | null;
  /** Optional human reason (archive flows may capture one). */
  reason?: string | null;
  createdAt: string;
}

/**
 * Build one ledger entry. Refuses fabricated identities and unknown
 * kinds — a corrupt event must never enter the ledger.
 */
export function buildEmploymentEvent(input: {
  employeeId: string;
  kind: EmploymentEventKind;
  effectiveAt?: string;
  actorUserId?: string | null;
  reason?: string | null;
}): EmploymentEvent {
  if (!input.employeeId || typeof input.employeeId !== 'string') {
    throw new Error('employment event requires a stable employeeId');
  }
  if (!EMPLOYMENT_EVENT_KINDS.includes(input.kind)) {
    throw new Error(`unknown employment event kind: ${String(input.kind)}`);
  }
  return {
    id: createId(),
    employeeId: input.employeeId,
    kind: input.kind,
    effectiveAt: input.effectiveAt ?? new Date().toISOString(),
    actorUserId: input.actorUserId ?? null,
    reason:
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim()
        : null,
    createdAt: new Date().toISOString(),
  };
}

/** One contiguous employment span. `end === null` → still employed. */
export interface EmploymentPeriod {
  /** ISO instant the period began (null = predates known history). */
  start: string | null;
  /** ISO instant employment ended (null = currently employed). */
  end: string | null;
}

/**
 * Fold an employee's (unsorted) event list into chronological
 * employment periods. Pure — no DB access, deterministic.
 *
 * Legacy contract: an employee with NO archived events has ONE open
 * period; `fallbackStart` (typically employees.createdAt) anchors it
 * when the caller can supply one, otherwise start stays null rather
 * than being invented.
 */
export function foldEmploymentPeriods(
  events: ReadonlyArray<EmploymentEvent>,
  fallbackStart?: string | null,
): EmploymentPeriod[] {
  const sorted = [...events]
    .filter((e) => EMPLOYMENT_EVENT_KINDS.includes(e.kind))
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));

  const periods: EmploymentPeriod[] = [];
  let open: EmploymentPeriod | null = { start: fallbackStart ?? null, end: null };

  for (const event of sorted) {
    if (event.kind === 'archived') {
      if (open && open.end === null) {
        open.end = event.effectiveAt;
        periods.push(open);
        open = null;
      }
      // Defensive: a duplicate archive while nothing is open is
      // ignored (cannot be produced by the guarded write path).
      continue;
    }
    // restored
    if (!open) {
      open = { start: event.effectiveAt, end: null };
    }
    // Defensive: a restore while already employed closes+reopens so
    // the ledger sequence stays faithfully represented.
    else {
      open.end = event.effectiveAt;
      periods.push(open);
      open = { start: event.effectiveAt, end: null };
    }
  }
  if (open) periods.push(open);
  return periods;
}

/** Convert an ISO instant / day key to a `YYYY-MM-DD` day key. */
function toDayKey(value: string): string {
  return value.slice(0, 10);
}

/**
 * Did employment overlap the requested reporting window?
 * Day-key granularity, range-end INCLUSIVE (addendum §10: an
 * employee archived on the 20th is VISIBLE for a report ending on
 * the 20th, with metrics computed only over the eligible days).
 *
 * This answers ELIGIBILITY only — it never produces metric values,
 * so the no-zero-filling rule (§11) is structural: "not eligible"
 * and "zero activity" cannot be conflated by callers.
 */
export function employmentOverlapsRange(
  periods: ReadonlyArray<EmploymentPeriod>,
  rangeStartDay: string,
  rangeEndDay: string,
): boolean {
  if (!rangeStartDay || !rangeEndDay) return false;
  for (const period of periods) {
    const startDay = period.start ? toDayKey(period.start) : null;
    const endDay = period.end ? toDayKey(period.end) : null;
    // open-ended period → employed through "now" → overlaps any
    // window that starts before the period could have ended.
    const effectiveEnd = endDay ?? '9999-12-31';
    const effectiveStart = startDay ?? '0000-01-01';
    if (effectiveStart <= rangeEndDay && effectiveEnd >= rangeStartDay) {
      return true;
    }
  }
  return false;
}

/** Days of the requested window during which the employee was
 *  employed (the future metric engines' "eligible slice"). Returns
 *  an empty array when the employee was not employed at all — never
 *  a synthetic zero. */
export function eligibleDaysInRange(
  periods: ReadonlyArray<EmploymentPeriod>,
  rangeDays: ReadonlyArray<string>,
): string[] {
  return rangeDays.filter((day) => employmentOverlapsRange(periods, day, day));
}
