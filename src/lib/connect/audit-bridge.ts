// src/lib/connect/audit-bridge.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — AUDIT BRIDGE
//
//  Writes sensitive Connect actions to the EXISTING audit
//  infrastructure (lib/audit writeAudit — the same generic primitive
//  Quality/HR use). One collection: connectAuditLog. NO message
//  content is ever logged — only ids, actions and actors (§SPEC-5F).
//
//  Fire-and-forget: audit failures never break the primary operation
//  (the primitive already guarantees this — this wrapper just fills
//  in the Connect-specific fields).
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { writeAudit } from '@/lib/audit';
import { CONNECT_AUDIT_COLLECTION } from './constants';

type ConnectAuditAction =
  | 'conversation_create'
  | 'conversation_update'
  | 'member_add'
  | 'member_remove'
  | 'member_leave'
  | 'role_change'
  | 'message_edit'
  | 'message_delete'
  | 'message_purge'
  | 'pin_change';

export interface ConnectAuditInput {
  action: ConnectAuditAction;
  actorId: string;
  actorName: string | null;
  conversationId: string;
  /** Target user for membership/role actions (never message content). */
  targetUserId?: string | null;
  /** Target message id for message actions. */
  messageId?: string | null;
  /** Human-readable Arabic summary — metadata only, no bodies. */
  details: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function writeConnectAudit(input: ConnectAuditInput): Promise<void> {
  const entityId = input.messageId
    ? `${input.conversationId}/messages/${input.messageId}`
    : input.targetUserId
      ? `${input.conversationId}/members/${input.targetUserId}`
      : input.conversationId;

  await writeAudit({
    collection: CONNECT_AUDIT_COLLECTION,
    actorId: input.actorId,
    actorName: input.actorName ?? 'غير معروف',
    action: input.action,
    entityType: 'connect',
    entityId,
    monthKey: null,
    before: input.before ?? null,
    after: input.after ?? null,
    details: input.details,
  });
}
