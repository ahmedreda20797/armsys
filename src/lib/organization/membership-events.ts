// ══════════════════════════════════════════════════════════════
//  Membership events — M0.6-A (append-only ledger)
//
//  Employee organizational membership is stored as ONE present-state
//  pointer (employees.orgNodeId). That is the authoritative
//  relationship for scope resolution, but it cannot answer "which
//  team was Ahmed in last January?" — the historical-gap documented
//  by the M0.6 audit (§25).
//
//  This ledger closes that gap WITHOUT touching any existing data:
//  every actual assignment change made through the privileged move
//  route appends one immutable event. Nothing is ever updated or
//  deleted here; reports reconstruct membership periods later by
//  folding consecutive events per employee (future phase).
//
//  NO BEHAVIOR CHANGE: scope, permissions and reports do not read
//  this collection in M0.6-A.
// ══════════════════════════════════════════════════════════════

import { createId } from '@paralleldrive/cuid2';

/** RTDB table for the append-only org-membership ledger. */
export const MEMBERSHIP_EVENTS_TABLE = 'membershipEvents';

/** The only kinds the system writes; unknown future kinds fail validation. */
export type MembershipEventKind =
  | 'joined'      // first assignment onto a node (from null)
  | 'transferred' // node A → node B
  | 'unassigned'; // removed from a node (to null)

export const MEMBERSHIP_EVENT_KINDS: readonly MembershipEventKind[] = [
  'joined',
  'transferred',
  'unassigned',
];

export interface MembershipEvent {
  id: string;
  employeeId: string;
  /** Display snapshot at event time (the employee may be renamed later). */
  employeeName?: string | null;
  kind: MembershipEventKind;
  /** Destination node id (null for 'unassigned'). */
  nodeId: string | null;
  /** Source node id (null when joining from unassigned). */
  previousNodeId: string | null;
  actorUserId?: string | null;
  createdAt: string;
}

/**
 * Derive the event kind from the before/after pair. Pure so tests can
 * pin it and so any future writer produces identical semantics.
 */
export function deriveMembershipKind(
  previousNodeId: string | null,
  nextNodeId: string | null,
): MembershipEventKind {
  if (previousNodeId && nextNodeId) return 'transferred';
  if (!previousNodeId && nextNodeId) return 'joined';
  return 'unassigned';
}

/**
 * Build one ledger entry from an ACTUAL change (caller has already
 * verified previous !== next). Validates the derived kind against the
 * whitelist and refuses to fabricate ids.
 */
export function buildMembershipEvent(input: {
  employeeId: string;
  employeeName?: string | null;
  previousNodeId: string | null;
  nextNodeId: string | null;
  actorUserId?: string | null;
}): MembershipEvent {
  if (!input.employeeId || typeof input.employeeId !== 'string') {
    throw new Error('membership event requires a stable employeeId');
  }
  const kind = deriveMembershipKind(
    input.previousNodeId ?? null,
    input.nextNodeId ?? null,
  );
  return {
    id: createId(),
    employeeId: input.employeeId,
    employeeName: input.employeeName ?? null,
    kind,
    nodeId: input.nextNodeId,
    previousNodeId: input.previousNodeId,
    actorUserId: input.actorUserId ?? null,
    createdAt: new Date().toISOString(),
  };
}
