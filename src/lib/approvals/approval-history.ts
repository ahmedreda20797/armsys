// ══════════════════════════════════════════════════════════════
//  Generic approval-history primitive (Improvement #4)
//
//  Append-only approval history. Quality observations are the first
//  consumer; HR-deduction requests, CAPA reviews, and any future
//  approval-gated record can adopt the same primitive.
//
//  Rules enforced here:
//    • Events are never overwritten — callers always append.
//    • The latest "decisive" action (approve/reject) projects the
//      fast-query status. submit/override/reopen do not change it
//      unless reopen resets a rejected item to pending.
// ══════════════════════════════════════════════════════════════

import type { ApprovalAction, ApprovalEvent, ApprovalStatus } from '@/types/quality-kpi';

/** Build a new immutable approval event with a server-issued timestamp. */
export function makeApprovalEvent(input: {
  action: ApprovalAction;
  actorId: string;
  actorName: string;
  notes?: string;
  pointsBefore?: number;
  pointsAfter?: number;
  now?: Date;
}): ApprovalEvent {
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
 */
export function appendApprovalEvent(history: ApprovalEvent[], event: ApprovalEvent): ApprovalEvent[] {
  return [...history, event];
}

/**
 * Project the latest fast-query approval status from a history.
 *
 *  - approve  → 'approved'
 *  - reject   → 'rejected'
 *  - reopen   → 'pending' (a rejected item can be re-submitted for review)
 *  - submit   → 'pending' (only if there is no later decisive action)
 *  - override → preserves the current decisive status (a point change,
 *               not a new decision)
 *
 * An empty history projects to 'pending' (the default awaiting state).
 */
export function projectLatestStatus(history: ApprovalEvent[]): ApprovalStatus {
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

/** True if the latest decisive action is an approval. */
export function isApprovedStatus(status: ApprovalStatus): boolean {
  return status === 'approved';
}

/** True if the item is still awaiting a decision. */
export function isPendingStatus(status: ApprovalStatus): boolean {
  return status === 'pending';
}

/** True if the item has been rejected (latest decisive action). */
export function isRejectedStatus(status: ApprovalStatus): boolean {
  return status === 'rejected';
}
