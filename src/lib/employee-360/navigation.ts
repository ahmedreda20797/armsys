// ══════════════════════════════════════════════════════════════
//  Employee 360 — drill-down navigation adapter (client)
//
//  THE existing navigation system (useAppStore.navigateTo +
//  navParams + record highlight) — no second mechanism. The server
//  sends attention drills as { page, highlightId, params }; this
//  adapter executes them verbatim.
// ══════════════════════════════════════════════════════════════

import { useAppStore } from '@/lib/store';
import type { Employee360AttentionItem } from '@/lib/employee-360/view-model';

/** Execute a server-resolved drill target through the canonical store. */
export function executeDrill(drill: Employee360AttentionItem['drill'] | null | undefined) {
  if (!drill?.page) return;
  const store = useAppStore.getState();
  store.navigateTo(drill.page, drill.highlightId ?? undefined, drill.params);
  // The 360 overlay is an overlay, not a route: hand focus to the
  // target page behind it, then close the overlay.
  store.closeEmployee360();
}

/** Open the employee in the Employee Database (list + record highlight). */
export function navigateToEmployeeProfile(employeeId: string) {
  const store = useAppStore.getState();
  store.navigateTo('employees', employeeId);
  store.closeEmployee360();
}

/** Deals drill — DEAL_CLOSED dimension (dealClosedAt = closed with the
 *  employee): the travel page opens with an EXPLICIT date basis +
 *  period + status=all, the same canonical semantics the metric was
 *  computed with (§DEAL-DATES — the two month filters never substitute). */
export function navigateToClosedDeals(employeeId: string, monthKey?: string) {
  const store = useAppStore.getState();
  store.navigateTo('travel', undefined, {
    employeeId,
    dateBasis: 'dealClosedAt',
    ...(monthKey ? { month: monthKey } : {}),
    status: 'all',
  });
  store.closeEmployee360();
}

/** Deals drill — CLOSED dimension (closedAt = completion): completed
 *  deals attributed by their completion month (status=completed makes
 *  the completion semantics explicit — §9 basis/status independence). */
export function navigateToCompletedDeals(employeeId: string, monthKey?: string) {
  const store = useAppStore.getState();
  store.navigateTo('travel', undefined, {
    employeeId,
    dateBasis: 'closedAt',
    ...(monthKey ? { month: monthKey } : {}),
    status: 'completed',
  });
  store.closeEmployee360();
}

/** Deals drill — TRAVEL dimension (departure month filter). */
export function navigateToTravelDeals(employeeId: string, monthKey?: string) {
  const store = useAppStore.getState();
  store.navigateTo('travel', undefined, monthKey ? { employeeId, month: monthKey } : { employeeId });
  store.closeEmployee360();
}
