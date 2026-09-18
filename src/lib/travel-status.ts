// ══════════════════════════════════════════════════════════════
//  Travel status — THE canonical business rules (§TRAVEL-THRESHOLD)
//
//  One module owns every departure-proximity threshold so the page,
//  the API and the Operations Center can never disagree again:
//
//    daysUntilTravel = difference(travelDate, today)
//      < 0        → already departed (traveling / returned)
//      0  .. 10   → "قريب" (NEAR) — the ONLY window labeled قريب
//      > 10       → scheduled future (NOT قريب)
//
//  Sub-windows inside the near window (for urgency styling only —
//  they never widen the قريب label):
//      0          → اليوم (today)
//      1 .. 3     → عاجل (critical)
//      4 .. 7     → urgent
//      8 .. 10    → soon
//
//  RETURN alerts are a SEPARATE concept (own date, own window) and
//  deliberately keep their own threshold — departure and return must
//  never be derived from each other.
// ══════════════════════════════════════════════════════════════

import { getDaysRemaining } from '@/lib/date-utils';

/** "قريب" window: departure within 10 days (inclusive). */
export const NEAR_TRAVEL_DAYS = 10;

/** عاجل window: departure within 3 days (inclusive, ≥ today). */
export const URGENT_TRAVEL_DAYS = 3;

/** Attention window for upcoming RETURNS (independent of departure). */
export const RETURN_ATTENTION_DAYS = 14;

/** Alert-window for upcoming DEPARTURES — same 10-day قريب rule. */
export const DEPARTURE_ATTENTION_DAYS = NEAR_TRAVEL_DAYS;

/** Coarse phase of a deal relative to TODAY. */
export type TravelPhase =
  | 'near'        // departure within 10 days (قريب)
  | 'scheduled'   // departure further out than 10 days (مجدولة — NOT قريب)
  | 'traveling'   // departed, return date not passed yet
  | 'returned';   // return date passed

export type DepartureUrgency = 'critical' | 'urgent' | 'soon' | 'normal';

/** Days until a DD/MM/YYYY date (0 = today). Thin wrapper for tests. */
export function travelDaysUntil(dateStr: string): number {
  return getDaysRemaining(dateStr);
}

/** The قريب rule: departure today or within the next 10 days. */
export function isNearDeparture(daysLeft: number): boolean {
  return daysLeft >= 0 && daysLeft <= NEAR_TRAVEL_DAYS;
}

/** Urgency styling for a departure countdown (label wording stays in getUrgencyLabel). */
export function getDepartureUrgency(daysLeft: number): DepartureUrgency {
  if (daysLeft >= 0 && daysLeft <= URGENT_TRAVEL_DAYS) return 'critical';
  if (daysLeft > URGENT_TRAVEL_DAYS && daysLeft <= 7) return 'urgent';
  if (daysLeft > 7 && daysLeft <= NEAR_TRAVEL_DAYS) return 'soon';
  return 'normal';
}

/**
 * Phase of a deal from its ACTUAL dates.
 *   returned  — returnDate passed (final state, wins over everything)
 *   traveling — departure passed, return still ahead (or no return date)
 *   near      — departure today..+10d
 *   scheduled — departure beyond +10d (future, never قريب)
 */
export function getTravelPhase(
  departureDate: string,
  returnDate: string | null | undefined,
): TravelPhase {
  const depDays = getDaysRemaining(departureDate);
  const retDays = returnDate ? getDaysRemaining(returnDate) : null;
  if (retDays !== null && retDays < 0) return 'returned';
  if (depDays < 0) return 'traveling';
  return isNearDeparture(depDays) ? 'near' : 'scheduled';
}

/** Whether an upcoming departure belongs in the attention/alert list. */
export function isDepartureAttention(daysLeft: number): boolean {
  return daysLeft >= 0 && daysLeft <= DEPARTURE_ATTENTION_DAYS;
}

/** Whether an upcoming RETURN belongs in the attention/alert list (independent). */
export function isReturnAttention(retDays: number): boolean {
  return retDays >= 0 && retDays <= RETURN_ATTENTION_DAYS;
}

/**
 * §TRAVEL-TOMORROW — does a DD/MM/YYYY display date fall on TOMORROW
 * (server clock)? Unparseable dates never match (fail-closed). The
 * canonical helper for the travel page's "المسافرون/العائدون غدًا"
 * server filters — one implementation for API and tests.
 */
export function isTomorrow(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string') return false;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return false;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (!day || !month || !year) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    day === tomorrow.getDate() &&
    month === tomorrow.getMonth() + 1 &&
    year === tomorrow.getFullYear()
  );
}
