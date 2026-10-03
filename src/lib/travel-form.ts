// src/lib/travel-form.ts
// ══════════════════════════════════════════════════════════════
//  §TRAVEL-FORM — the ONE canonical Travel deal save contract.
//
//  Pure, UI-framework-free helpers shared by the Travel page dialog
//  and its regression tests:
//    • buildTravelSavePayload — the exact PUT/POST body. closedAt is
//      sent ONLY for an edit of a COMPLETED deal (the §LEGACY-BACKFILL
//      / authorized-correction path); an empty value means "unknown —
//      leave the stored ledger untouched" and is never fabricated
//      (§5). closedAt is NEVER sent for non-completed deals (§6.A).
//    • describeTravelSaveError — the visible save-failure text: a
//      server-provided SAFE error message is displayed verbatim
//      (§14); network/abort/unknown failures fall back to the
//      localized generic message instead of leaking internals.
// ══════════════════════════════════════════════════════════════

import type { BookingItem } from '@/types';

/** §TRAVEL-SAVE-TIMEOUT — a save attempt must always settle: the
 *  mutation aborts after 30s so the UI can never sit in "جاري الحفظ"
 *  forever (§13: every save ends in SUCCESS or VISIBLE ERROR). */
export const TRAVEL_SAVE_TIMEOUT_MS = 30_000;

export interface TravelFormData {
  employeeId: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  /** §DEAL-DATES (DEAL_CLOSED) — تاريخ تقفيل الديل (DD/MM/YYYY). */
  dealClosedAt: string;
  /** §DEAL-DATES (CLOSED ledger) — تاريخ الاكتمال as a display date
   *  (DD/MM/YYYY) for the historical backfill input. '' = unknown /
   *  not provided (never fabricated). */
  closedAt: string;
  dealerName: string;
  customerNames: string;
  bookingItems: BookingItem[];
  notes: string;
  status: string;
}

export interface TravelSavePayload {
  employeeId: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  dealClosedAt?: string;
  closedAt?: string;
  dealerName: string;
  customerNames: string;
  bookingItems: BookingItem[];
  notes: string;
  status: string;
}

/**
 * The canonical save payload for one dialog submission.
 *
 * `editing` distinguishes the EDIT path (closedAt may be sent for a
 * completed deal) from the CREATE path (the server owns the initial
 * ledger — created-as-completed records start closedAt=null per the
 * existing canonical behavior).
 */
export function buildTravelSavePayload(
  form: TravelFormData,
  editing: boolean,
): TravelSavePayload {
  return {
    employeeId: form.employeeId,
    destination: form.destination,
    departureDate: form.departureDate,
    returnDate: form.returnDate,
    // §DEAL-DATES — dealClosedAt goes through only when set; an empty
    // value on a legacy edit leaves the stored value untouched (the
    // server rejects invalid shapes and never fabricates the date).
    ...(form.dealClosedAt ? { dealClosedAt: form.dealClosedAt } : {}),
    // §LEGACY-BACKFILL — the historical completion date travels ONLY
    // for a completed-deal EDIT; empty means "leave the ledger as-is".
    ...(editing && form.status === 'completed' && form.closedAt
      ? { closedAt: form.closedAt }
      : {}),
    dealerName: form.dealerName,
    customerNames: form.customerNames,
    bookingItems: form.bookingItems,
    notes: form.notes,
    status: form.status,
  };
}

/**
 * §13/§14 — the visible save-failure text for one failed attempt.
 * A server-provided safe error (already localized Arabic from the API
 * validation paths) is displayed verbatim; fetch/abort/unknown
 * failures never leak browser internals — they get the localized
 * fallback line.
 */
export function describeTravelSaveError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message || '';
    // Network-level failures carry browser jargon ("Failed to fetch",
    // "Load failed", "The operation was aborted") — not user-safe.
    const isTransportFailure =
      /failed to fetch|load failed|networkerror|aborted?|timed? ?out|ERR_/i.test(message);
    if (!isTransportFailure && message.length > 0 && message.length <= 300) {
      return message;
    }
  }
  return fallback;
}
