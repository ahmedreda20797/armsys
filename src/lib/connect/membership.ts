// src/lib/connect/membership.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — MEMBERSHIP AUTHORIZATION PRIMITIVE
//
//  THE reusable server-side gate for every conversation-scoped
//  operation (§AUTHORIZATION): a conversation record + an ACTIVE
//  membership record must BOTH resolve, or access is denied. There
//  is no client-trusted shortcut and no employee/department-scope
//  substitution — a department relationship NEVER authorizes access
//  to a conversation (§SPEC-7).
//
//  ENUMERATION POLICY: "conversation does not exist" and "you are
//  not a member" produce the SAME AccessDeniedError(kind='not_found')
//  so routes return 404 for both — an outsider cannot distinguish
//  existing conversations from missing ones by probing.
//
//  §SERVER-ONLY — reaches RTDB through lib/connect/rtdb and the
//  users table through lib/db (cached).
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { getById } from '@/lib/db';
import { connectGet } from './rtdb';
import { CONVERSATIONS_PATH } from './constants';
import type { ConversationMember, ConversationRecord, ConversationRole } from './types';

/** Denial kinds a route can map to HTTP statuses deterministically. */
export type AccessDeniedKind = 'not_found' | 'forbidden' | 'gone';

export class AccessDeniedError extends Error {
  readonly kind: AccessDeniedKind;
  constructor(kind: AccessDeniedKind, message: string) {
    super(message);
    this.name = 'AccessDeniedError';
    this.kind = kind;
  }
}

const ROLE_RANK: Record<ConversationRole, number> = { member: 0, admin: 1, owner: 2 };

export function roleSatisfies(role: ConversationRole, minimum: ConversationRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isConversationRecord(value: unknown): value is ConversationRecord {
  return typeof value === 'object' && value !== null && typeof (value as ConversationRecord).id === 'string';
}

/** Load a conversation record (null when missing). */
export async function loadConversation(conversationId: string): Promise<ConversationRecord | null> {
  const value = await connectGet<ConversationRecord>(`${CONVERSATIONS_PATH}/${conversationId}`);
  return isConversationRecord(value) ? value : null;
}

/** Load one membership record (null when never a member). */
export async function loadMember(conversationId: string, userId: string): Promise<ConversationMember | null> {
  return connectGet<ConversationMember>(`${CONVERSATIONS_PATH}/${conversationId}/members/${userId}`);
}

export interface MembershipContext {
  conversation: ConversationRecord;
  member: ConversationMember;
}

/**
 * THE authorization primitive: resolve the conversation AND the
 * caller's ACTIVE membership, or deny.
 *
 *   • unknown conversation       → not_found (404)
 *   • never a member             → not_found (404)  [enumeration-safe]
 *   • removed / left member      → not_found (404)  [immediate loss]
 *   • conversation deleted+gone  → gone (410)
 *
 * Callers that additionally need a role gate chain
 * assertMinimumRole below with the returned member.
 */
export async function requireActiveMembership(
  conversationId: string,
  userId: string,
): Promise<MembershipContext> {
  if (!conversationId || typeof conversationId !== 'string') {
    throw new AccessDeniedError('not_found', 'المحادثة غير موجودة');
  }

  const conversation = await loadConversation(conversationId);
  if (!conversation) {
    throw new AccessDeniedError('not_found', 'المحادثة غير موجودة');
  }

  const member = await loadMember(conversationId, userId);
  if (!member || member.leftAt) {
    // Never-was / left / removed — one identical denial, no probing.
    throw new AccessDeniedError('not_found', 'المحادثة غير موجودة');
  }

  return { conversation, member };
}

/** Role gate on top of an already-resolved membership context. */
export function assertMinimumRole(
  ctx: MembershipContext,
  minimum: ConversationRole,
): void {
  if (!roleSatisfies(ctx.member.role, minimum)) {
    throw new AccessDeniedError('forbidden', 'صلاحية غير كافية في هذه المحادثة');
  }
}

/**
 * Combined gate: active membership + minimum role. Used by every
 * group-administration operation (add/remove member, role change,
 * pin, delete-any-message).
 */
export async function requireConversationRole(
  conversationId: string,
  userId: string,
  minimum: ConversationRole,
): Promise<MembershipContext> {
  const ctx = await requireActiveMembership(conversationId, userId);
  assertMinimumRole(ctx, minimum);
  return ctx;
}

// ─── User profile join (display only — NOT authorization) ─────

export interface ConnectUserProfile {
  id: string;
  name: string | null;
  email: string | null;
  photoUrl: string | null;
  isSuspended: boolean;
}

/**
 * Batch-load display profiles for a set of user ids. This is a
 * PRESENTATION join only — membership records remain the sole
 * authorization source. Suspended users still resolve (their
 * historical messages stay attributable); callers decide what to do
 * with the flag.
 *
 * §AVATAR-SOURCE — the canonical profile picture is the user record's
 * `photoURL` field: a self-contained 256×256 WebP data: URL written by
 * the EXISTING /api/profile/photo workflow (no storage provider, CSP
 * already allows img-src data:). `photoUrl` (lowercase) is accepted as
 * a defensive fallback for legacy records.
 */
export async function loadUserProfiles(userIds: string[]): Promise<Map<string, ConnectUserProfile>> {
  const out = new Map<string, ConnectUserProfile>();
  const unique = Array.from(new Set(userIds)).filter((id) => typeof id === 'string' && id.length > 0);
  await Promise.all(unique.map(async (id) => {
    const user = await getById<Record<string, unknown>>('users', id);
    if (!user) {
      out.set(id, { id, name: null, email: null, photoUrl: null, isSuspended: false });
      return;
    }
    out.set(id, {
      id,
      name: (user.name as string | undefined) ?? null,
      email: (user.email as string | undefined) ?? null,
      photoUrl: ((user.photoURL ?? user.photoUrl) as string | undefined) ?? null,
      isSuspended: user.isSuspended === true,
    });
  }));
  return out;
}
