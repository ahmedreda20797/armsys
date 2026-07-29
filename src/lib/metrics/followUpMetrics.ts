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
 * A follow-up is overdue when it has a next-follow-up date in the past
 * AND it is still in an active status. Terminal follow-ups are never
 * overdue, and a missing nextFollowUpDate means no due date was set,
 * so it cannot be overdue.
 */
export function isOverdueFollowUp(f: FollowUpLike, now: Date = new Date()): boolean {
  if (!isActiveFollowUp(f)) return false;
  if (!f.nextFollowUpDate) return false;
  const due = new Date(f.nextFollowUpDate);
  if (isNaN(due.getTime())) return false;
  return due < startOfDay(now);
}

/**
 * A follow-up is due today when its next-follow-up date equals today.
 * Uses date-only comparison to avoid timezone edge cases near midnight.
 */
export function isDueToday(f: FollowUpLike, now: Date = new Date()): boolean {
  if (!isActiveFollowUp(f)) return false;
  if (!f.nextFollowUpDate) return false;
  const due = new Date(f.nextFollowUpDate);
  if (isNaN(due.getTime())) return false;
  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  return dueDay.getTime() === today.getTime();
}

/** Days between the due date and now; positive = overdue, negative = remaining. */
export function followUpOverdueDays(f: FollowUpLike, now: Date = new Date()): number {
  if (!f.nextFollowUpDate) return 0;
  const due = new Date(f.nextFollowUpDate);
  if (isNaN(due.getTime())) return 0;
  const ms = startOfDay(now).getTime() - startOfDay(due).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
