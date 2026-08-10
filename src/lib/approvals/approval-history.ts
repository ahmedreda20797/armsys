// ══════════════════════════════════════════════════════════════
//  Generic approval primitive — append-only history helpers
//
//  Append-only approval history utilities. Quality observations are
//  the first consumer; HR requests, CAPA reviews, salary/travel
//  approvals and any future approval-gated record can adopt the same
//  primitive.
//
//  Rules enforced here:
//    • Events are never overwritten — callers always append.
//    • The latest "decisive" action (approve/reject) projects the
//      fast-query status. submit/override/reopen do not change it
//      unless reopen resets a rejected item to pending.
//
//  This module imports ONLY from ./types — it has zero coupling to
//  any domain module and to Firebase.
// ══════════════════════════════════════════════════════════════

import type { ApprovalAction, ApprovalEvent, ApprovalStatus } from './types';

/** Input for building an immutable {@link ApprovalEvent}. */
export interface MakeApprovalEventInput {
  /** The transition performed (see {@link ApprovalAction}). */
  action: ApprovalAction;
  /** Stable identifier of the user performing the action. */
  actorId: string;
  /** Display name of the actor (snapshotted for history readability). */
  actorName: string;
  /** Optional free-text note (defaults to ''). */
  notes?: string;
  /** Optional magnitude before an override (e.g. point change). */
  pointsBefore?: number;
  /** Optional magnitude after an override (e.g. point change). */
  pointsAfter?: number;
  /** Optional injection of the current time (defaults to `new Date()`); useful for tests. */
  now?: Date;
}

/**
 * Build a new immutable {@link ApprovalEvent} stamped with a
 * server-issued timestamp.
 *
 * @param input - The event fields (see {@link MakeApprovalEventInput}).
 * @returns A frozen-shape {@link ApprovalEvent} ready to append.
 *
 * @remarks
 * This function is pure and performs no I/O. The caller is
 * responsible for persisting the resulting event via
 * {@link appendApprovalEvent}.
 */
export function makeApprovalEvent(input: MakeApprovalEventInput): ApprovalEvent {
  return {
    action: input.action,
    actorId: input.actorId,
    actorName: input.actorName,
    notes: input.notes ?? '',
    ...(input.pointsBefore !== undefined ? { pointsBefore: input.pointsBefore } : {}),
    ...(input.pointsAfter !== undefined ? { pointsAfter: input.pointsAfter } : {}),
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}

/**
 * Append an event to a history, returning a NEW array (immutable).
 * The caller persists the result. Never mutates the input array.
 *
 * @param history - The existing approval history (left untouched).
 * @param event   - The event to append.
 * @returns A new array containing all previous events plus `event`.
 *
 * @remarks
 * Side effects: none. This is a pure function returning a fresh array.
 */
export function appendApprovalEvent(
  history: ApprovalEvent[],
  event: ApprovalEvent,
): ApprovalEvent[] {
  return [...history, event];
}

/**
 * Project the latest fast-query approval status from a history.
 *
 * Walking newest → oldest, the first DECISIVE action wins:
 *  - `approve` → `'approved'`
 *  - `reject`  → `'rejected'`
 *  - `reopen`  → `'pending'` (a rejected item can be re-submitted)
 *  - `submit`  → only decisive if no decisive action follows
 *  - `override`→ preserves the current decisive status (a magnitude
 *                change, not a new decision)
 *
 * An empty history projects to `'pending'` (the default awaiting state).
 *
 * @param history - The approval history to project.
 * @returns The derived {@link ApprovalStatus}.
 *
 * @remarks
 * This is the single source of truth for the fast-query status; it
 * must never be stored independently of the history.
 */
export function projectLatestApprovalStatus(history: ApprovalEvent[]): ApprovalStatus {
  if (history.length === 0) return 'pending';

  // Walk newest → oldest; the first DECISIVE action wins.
  for (let i = history.length - 1; i >= 0; i--) {
    const action = history[i].action;
    if (action === 'approve') return 'approved';
    if (action === 'reject') return 'rejected';
    if (action === 'reopen') return 'pending';
    // 'submit' is only decisive if nothing decisive follows — keep walking.
  }
  // Only submit/override events remain (no decisive action yet).
  return 'pending';
}

/**
 * True if the latest decisive action is an approval.
 * @param status - The projected approval status.
 */
export function isApprovedStatus(status: ApprovalStatus): boolean {
  return status === 'approved';
}

/**
 * True if the item is still awaiting a decision.
 * @param status - The projected approval status.
 */
export function isPendingStatus(status: ApprovalStatus): boolean {
  return status === 'pending';
}

/**
 * True if the item has been rejected (latest decisive action).
 * @param status - The projected approval status.
 */
export function isRejectedStatus(status: ApprovalStatus): boolean {
  return status === 'rejected';
}
