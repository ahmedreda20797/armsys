// ══════════════════════════════════════════════════════════════
//  CANONICAL FOLLOW-UP METRICS — single source of truth
//
//  Defines the follow-up status taxonomy and the overdue rule.
//  "Overdue" is COMPUTED ON READ from nextFollowUpDate — it is never
//  a stored status, because no job transitions status='overdue' and
//  relying on the stored field silently missed 12 real-overdue records
//  in production (audit finding F3).
// ══════════════════════════════════════════════════════════════

/** A follow-up is still being worked on (not resolved/closed/cancelled). */
export const ACTIVE_FOLLOWUP_STATUSES = [
  'open',
  'under_review',
  'under_follow_up',
] as const;

/** A follow-up that is finished — no longer counts as open or overdue. */
export const TERMINAL_FOLLOWUP_STATUSES = [
  'resolved',
  'closed',
  'cancelled',
] as const;

/** The full canonical status enum (see src/types/index.ts:149). */
export const ALL_FOLLOWUP_STATUSES = [
  ...ACTIVE_FOLLOWUP_STATUSES,
  ...TERMINAL_FOLLOWUP_STATUSES,
] as const;

export type FollowUpStatus = (typeof ALL_FOLLOWUP_STATUSES)[number];

export interface FollowUpLike {
  status?: string | null;
  nextFollowUpDate?: string | null;
}

/** True if the follow-up is in an active (non-terminal) status. */
export function isActiveFollowUp(f: FollowUpLike): boolean {
  return (ACTIVE_FOLLOWUP_STATUSES as readonly string[]).includes(f.status ?? '');
}

/** True if the follow-up is in a terminal status. */
export function isTerminalFollowUp(f: FollowUpLike): boolean {
  return (TERMINAL_FOLLOWUP_STATUSES as readonly string[]).includes(f.status ?? '');
}

/** Midnight of the given date in the system timezone (clears the time components). */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Parse a stored follow-up date as a LOCAL calendar date.
 *
 * `nextFollowUpDate` is a date-only string (YYYY-MM-DD) the user picked
 * in their OWN calendar (<input type="date">). `new Date('YYYY-MM-DD')`
 * parses it as UTC midnight, which shifts it a full day against local
 * midnight for every timezone east of UTC — so a follow-up due "today"
 * failed the due-today check between 00:00 and 03:00 for UTC+3 clients
 * (found by the canonical tests running across a midnight boundary).
 * Date-only shapes are therefore parsed as LOCAL midnight; timestamps
 * (ISO with time) keep their instant.
 */
function parseDueDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A follow-up is overdue when it has a next-follow-up date in the past
 * AND it is still in an active status. Terminal follow-ups are never
 * overdue, and a missing nextFollowUpDate means no due date was set,
 * so it cannot be overdue.
 */
export function isOverdueFollowUp(f: FollowUpLike, now: Date = new Date()): boolean {
  if (!isActiveFollowUp(f)) return false;
  if (!f.nextFollowUpDate) return false;
  const due = parseDueDate(f.nextFollowUpDate);
  if (!due) return false;
  return due < startOfDay(now);
}

/**
 * A follow-up is due today when its next-follow-up date equals today.
 * Uses date-only comparison to avoid timezone edge cases near midnight.
 */
export function isDueToday(f: FollowUpLike, now: Date = new Date()): boolean {
  if (!isActiveFollowUp(f)) return false;
  if (!f.nextFollowUpDate) return false;
  const due = parseDueDate(f.nextFollowUpDate);
  if (!due) return false;
  return startOfDay(due).getTime() === startOfDay(now).getTime();
}

/** Days between the due date and now; positive = overdue, negative = remaining. */
export function followUpOverdueDays(f: FollowUpLike, now: Date = new Date()): number {
  if (!f.nextFollowUpDate) return 0;
  const due = parseDueDate(f.nextFollowUpDate);
  if (!due) return 0;
  const ms = startOfDay(now).getTime() - startOfDay(due).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
