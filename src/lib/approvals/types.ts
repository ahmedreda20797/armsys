// ══════════════════════════════════════════════════════════════
//  Generic approval primitive — type definitions
//
//  Domain-agnostic approval types owned by the approvals library so
//  that NO consumer of this library is ever coupled to a specific
//  module. Quality is the first consumer; future modules (HR
//  requests, CAPA reviews, salary/travel approvals, Workflow) reuse
//  these primitives directly.
//
//  This file imports nothing from any domain — it is the root of the
//  approvals dependency tree.
// ══════════════════════════════════════════════════════════════

/**
 * The set of actions that may be recorded in an append-only approval
 * history. Every module that gates records behind an approval flow
 * expresses its transitions with these same actions.
 *
 * @remarks
 * This is a closed union on purpose: it keeps the approval lifecycle
 * consistent across the whole ERP and lets {@link projectLatestApprovalStatus}
 * derive a deterministic fast-query status from any history.
 */
export type ApprovalAction = 'submit' | 'approve' | 'reject' | 'override' | 'reopen';

/**
 * A single immutable entry in an approval history.
 *
 * Approval histories are append-only: an event is never edited or
 * deleted once written. {@link appendApprovalEvent} always returns a
 * new array, leaving the previous one untouched.
 *
 * @property action      - The transition performed (see {@link ApprovalAction}).
 * @property actorId     - Stable identifier of the user who performed the action.
 * @property actorName   - Display name of the actor (snapshot for history readability).
 * @property timestamp   - ISO 8601 timestamp issued by the server.
 * @property notes       - Free-text note attached by the actor (may be empty).
 * @property pointsBefore - Optional magnitude before an override (e.g. a point change).
 * @property pointsAfter  - Optional magnitude after an override (e.g. a point change).
 */
export interface ApprovalEvent {
  action: ApprovalAction;
  actorId: string;
  actorName: string;
  /** ISO 8601 timestamp issued by the server. */
  timestamp: string;
  notes: string;
  /** Present only on override events — captures the magnitude before the change. */
  pointsBefore?: number;
  /** Present only on override events — captures the magnitude after the change. */
  pointsAfter?: number;
}

/**
 * The projected latest approval state, derived from a history for fast
 * querying. This is never stored as a source of truth — it is always
 * derived by {@link projectLatestApprovalStatus}.
 *
 * - `pending`  — awaiting a decision (empty history, only submit/override events,
 *                or reset by a `reopen`).
 * - `approved` — the latest decisive action was an approval.
 * - `rejected` — the latest decisive action was a rejection.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
