// ══════════════════════════════════════════════════════════════
//  CANONICAL CAPA METRICS — single source of truth
//
//  Replaces FOUR divergent "overdue" definitions that existed across:
//    - capa-cases/route.ts      (correctiveDueDate || createdAt) + slaDays
//    - capa-sla/route.ts        correctiveDueDate + slaDays  ← DOUBLE SLA bug (F13)
//    - risk-center/route.ts     createdAt + slaDays (ignored correctiveDueDate)
//    - reports/capa, capa-export  c.overdueDays > 0  ← stale stored field (F5)
// ══════════════════════════════════════════════════════════════

/** A CAPA counted as "closed" for closed-rate / effectiveness purposes. */
export const CLOSED_CAPA_STATUSES = ['closed'] as const;

/** Terminal CAPA statuses — excluded from open / overdue / critical counts. */
export const TERMINAL_CAPA_STATUSES = ['closed', 'rejected'] as const;

/** Active (non-terminal) CAPA workflow statuses. */
export const ACTIVE_CAPA_STATUSES = [
  'open',
  'investigation',
  'root_cause_analysis',
  'corrective_action',
  'preventive_action',
  'verification',
  'reopened',
] as const;

export type CAPAStatus = (typeof ACTIVE_CAPA_STATUSES)[number] | (typeof TERMINAL_CAPA_STATUSES)[number];

export type CAPAPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * SLA day allowance per priority. Single source — was duplicated in
 * capa-cases, capa-sla, capa-helpers, reports/capa-export.
 */
export const CAPA_SLA_DAYS: Record<CAPAPriority, number> = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 14,
};

export const CAPA_DEFAULT_SLA_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CAPALike {
  status?: string | null;
  priority?: string | null;
  slaDays?: number | null;
  createdAt?: string | null;
  correctiveDueDate?: string | null;
  closedAt?: string | null;
  verificationResult?: string | null;
}

/** Resolve the effective SLA window for a CAPA (explicit override > priority table > default). */
export function effectiveSlaDays(c: CAPALike): number {
  if (typeof c.slaDays === 'number' && c.slaDays > 0) return c.slaDays;
  const p = (c.priority ?? '') as CAPAPriority;
  return CAPA_SLA_DAYS[p] ?? CAPA_DEFAULT_SLA_DAYS;
}

/**
 * The due date for a CAPA.
 *
 * Business rule (audited, unified): if an explicit `correctiveDueDate`
 * is set, it IS the due date. Otherwise the due date is `createdAt`
 * plus the SLA window. The due date is NEVER `correctiveDueDate + sla`
 * (that was the F13 double-SLA bug).
 */
export function capaDueDateMs(c: CAPALike): number | null {
  if (c.correctiveDueDate) {
    const ms = new Date(c.correctiveDueDate).getTime();
    if (!isNaN(ms)) return ms;
  }
  if (c.createdAt) {
    const created = new Date(c.createdAt).getTime();
    if (!isNaN(created)) return created + effectiveSlaDays(c) * MS_PER_DAY;
  }
  return null;
}

/** True if the CAPA is in a closed (effectively-done) status. */
export function isClosedCAPA(c: CAPALike): boolean {
  return (CLOSED_CAPA_STATUSES as readonly string[]).includes(c.status ?? '');
}

/** True if the CAPA has reached a terminal state (closed or rejected). */
export function isTerminalCAPA(c: CAPALike): boolean {
  return (TERMINAL_CAPA_STATUSES as readonly string[]).includes(c.status ?? '');
}

/**
 * Whole days a CAPA is past due. Returns 0 for terminal CAPAs or when
 * no due date can be computed. Computed fresh on every call — never
 * trusts the stale stored `overdueDays` field.
 */
export function capaOverdueDays(c: CAPALike, now: Date = new Date()): number {
  if (isTerminalCAPA(c)) return 0;
  const due = capaDueDateMs(c);
  if (due === null) return 0;
  const diff = now.getTime() - due;
  if (diff <= 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}

/** True if an active CAPA is past its due date. */
export function isOverdueCAPA(c: CAPALike, now: Date = new Date()): boolean {
  if (isTerminalCAPA(c)) return false;
  const due = capaDueDateMs(c);
  if (due === null) return false;
  return now.getTime() > due;
}

/** Days remaining before a CAPA becomes overdue (0 if already overdue/terminal). */
export function capaDaysRemaining(c: CAPALike, now: Date = new Date()): number {
  if (isTerminalCAPA(c)) return 0;
  const due = capaDueDateMs(c);
  if (due === null) return 0;
  const diff = due - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / MS_PER_DAY);
}

/**
 * Effectiveness percentage = effective closed cases / total closed cases × 100.
 *
 * Single canonical definition — replaces the three divergent denominators
 * (closed vs. verified vs. effective) that produced three different numbers
 * across Employee 360, CAPA dashboard, and the CAPA report (F9).
 */
export function calcCAPAEffectiveness(cases: CAPALike[]): number {
  const closed = cases.filter((c) => isClosedCAPA(c));
  if (closed.length === 0) return 0;
  const effective = closed.filter((c) => c.verificationResult === 'effective').length;
  return Math.round((effective / closed.length) * 100);
}

/** Number of effective closed cases (raw count, for Employee 360 display). */
export function countEffectiveCAPAs(cases: CAPALike[]): number {
  return cases.filter((c) => isClosedCAPA(c) && c.verificationResult === 'effective').length;
}
