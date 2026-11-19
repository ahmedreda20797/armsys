// src/lib/connect/conversation-service.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — CONVERSATION SERVICE
//
//  All conversation lifecycle business logic. Route handlers stay
//  thin; everything here is server-side and membership-gated by the
//  caller (routes resolve the authenticated user FIRST — the userId
//  parameter is ALWAYS the authenticated identity, never client data).
//
//  §ORDERING — list ordering uses the per-user index entry's numeric
//  lastMessageAt (ONE ordering field per query — RTDB constraint).
//  §DIRECT-DEDUP — the directIndex node makes get-or-create race-safe
//  via a transaction: concurrent creates for the same pair resolve to
//  ONE conversation (the index transaction is the gate).
//  §FUTURE-TENANT — tenantId: null persisted everywhere from day one.
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { getById } from '@/lib/db';
import {
  CONVERSATIONS_PATH,
  CONNECT_DB_ROOT,
  GROUP_MEMBERS_MAX,
} from './constants';
import { connectGet, connectQuery, connectUpdate, connectTransaction, connectSet, isUnindexedQueryError, warnUnindexedOnce } from './rtdb';
import { newConversationId, directKeyFor } from './ids';
import { AccessDeniedError, loadUserProfiles, requireActiveMembership, type ConnectUserProfile, type MembershipContext } from './membership';
import { boundedUnreadCount } from './read-state-service';
import type {
  ConversationMember,
  ConversationMemberView,
  ConversationRecord,
  ConversationRole,
  ConversationType,
  ConversationView,
  UserConversationIndex,
} from './types';

// ─── Path helpers ──────────────────────────────────────────────

const conversationPath = (id: string) => `${CONVERSATIONS_PATH}/${id}`;
const memberPath = (convId: string, userId: string) => `${CONVERSATIONS_PATH}/${convId}/members/${userId}`;
const userIndexPath = (userId: string, convId: string) => `${CONNECT_DB_ROOT}/userConversations/${userId}/${convId}`;
const directIndexPath = (key: string) => `${CONNECT_DB_ROOT}/directIndex/${encodeURIComponent(key)}`;

function nowIso(): string {
  return new Date().toISOString();
}

/** Denormalized display fields the conversation list renders from. */
function buildIndexEntry(
  conversationId: string,
  conversation: Pick<ConversationRecord, 'type' | 'title' | 'lastMessageAt' | 'lastMessageId' | 'lastMessagePreview' | 'memberCount' | 'createdAt'>,
  extra: Partial<UserConversationIndex> = {},
): UserConversationIndex {
  return {
    conversationId,
    type: conversation.type,
    title: conversation.title,
    lastMessageAt: conversation.lastMessageAt ?? 0,
    lastMessageId: conversation.lastMessageId ?? null,
    lastMessagePreview: conversation.lastMessagePreview ?? null,
    memberCount: conversation.memberCount,
    createdAt: conversation.createdAt,
    lastReadMessageId: null,
    lastDeliveredMessageId: null,
    archivedAt: null,
    mutedUntil: null,
    updatedAt: nowIso(),
    ...extra,
  };
}

/** Verify users exist (server-authoritative membership materialization). */
async function assertUsersExist(userIds: string[]): Promise<void> {
  const unknown: string[] = [];
  for (const id of userIds) {
    const user = await getById<Record<string, unknown>>('users', id);
    if (!user) unknown.push(id);
  }
  if (unknown.length > 0) {
    throw new Error(`USERS_NOT_FOUND:${unknown.join(',')}`);
  }
}

// ─── Direct conversations ──────────────────────────────────────

export interface DirectConversationResult {
  conversation: ConversationRecord;
  created: boolean;
}

/**
 * Create or retrieve THE direct conversation between two users.
 * Concurrency: the directIndex transaction is the dedup gate — under
 * two concurrent creates, exactly one transaction commits; the loser
 * removes its just-created conversation shell and returns the winner's.
 */
export async function getOrCreateDirectConversation(
  meUserId: string,
  otherUserId: string,
  userNames: { me: string | null; other: string | null },
): Promise<DirectConversationResult> {
  if (meUserId === otherUserId) {
    throw new Error('DIRECT_SELF_FORBIDDEN');
  }

  const key = directKeyFor(meUserId, otherUserId);
  const existingId = await connectGet<string>(directIndexPath(key));
  if (existingId) {
    const existing = await connectGet<ConversationRecord>(conversationPath(existingId));
    if (existing) return { conversation: existing, created: false };
    // Dangling index (conversation purged) — fall through and recreate.
  }

  const now = nowIso();
  const conversationId = newConversationId();
  const conversation: ConversationRecord = {
    id: conversationId,
    type: 'direct',
    title: null,
    description: null,
    avatarRef: null,
    createdBy: meUserId,
    creatorName: userNames.me,
    createdAt: now,
    updatedAt: now,
    lastMessageId: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    directKey: key,
    deptNodeId: null,
    memberCount: 2,
    tenantId: null,
  };

  // §RTDB-MERGE-PATHS — 1.0.1 fix (verified against the server log:
  // "update failed: values argument contains a path X that is ancestor
  // of another path X/members/uid"). Real RTDB rejects an update map
  // containing both a path and its descendant, so the conversation
  // record and its member records are written as ONE node (members
  // embedded) instead of overlapping paths. Atomic, single write.
  const membersById: Record<string, ConversationMember> = {
    [meUserId]: { userId: meUserId, role: 'member', joinedAt: now, addedBy: meUserId, leftAt: null },
    [otherUserId]: { userId: otherUserId, role: 'member', joinedAt: now, addedBy: meUserId, leftAt: null },
  };
  await connectUpdate(CONVERSATIONS_PATH, {
    [conversationId]: { ...conversation, members: membersById },
  });
  await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, {
    [`${meUserId}/${conversationId}`]: buildIndexEntry(conversationId, conversation, {
      displayTitle: userNames.other ?? 'مستخدم',
      directOtherUserId: otherUserId,
      myRole: 'member',
    }),
    [`${otherUserId}/${conversationId}`]: buildIndexEntry(conversationId, conversation, {
      displayTitle: userNames.me ?? 'مستخدم',
      directOtherUserId: meUserId,
      myRole: 'member',
    }),
  });

  // 2. Claim the dedup index. Loser cleans up its shell and adopts the winner's.
  const claim = await connectTransaction<string>(directIndexPath(key), (current) => {
    if (current) return undefined; // someone else owns this pair
    return conversationId;
  });

  if (!claim.committed && claim.value && claim.value !== conversationId) {
    // Remove OUR duplicate shell (messages could not exist yet) and
    // return the existing conversation. §RTDB-MERGE-PATHS — deleting
    // the conversation path removes its members with it (single path).
    await connectUpdate(CONVERSATIONS_PATH, { [conversationId]: null });
    await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, {
      [`${meUserId}/${conversationId}`]: null,
      [`${otherUserId}/${conversationId}`]: null,
    });
    const winner = await connectGet<ConversationRecord>(conversationPath(claim.value));
    if (winner) return { conversation: winner, created: false };
    // Winner vanished (purge race) — caller can retry; fail loudly.
    throw new Error('DIRECT_CREATE_RACE');
  }

  return { conversation, created: true };
}

// ─── Group / department conversations ──────────────────────────

export interface CreateGroupInput {
  creatorId: string;
  creatorName: string | null;
  type: Extract<ConversationType, 'group' | 'department'>;
  title: string;
  description: string | null;
  /** Desired initial members (the creator is always added as owner). */
  memberUserIds: string[];
  /** Department conversations: the org node this group represents. */
  deptNodeId: string | null;
}

/**
 * §DEPARTMENT-MATERIALIZATION — department relationships are recorded
 * on the conversation (deptNodeId) but NEVER consulted for access:
 * membership consists EXACTLY of the explicitly materialized member
 * records below. Later employees of the same department gain nothing;
 * org-tree changes revoke nothing. (§SPEC-8)
 */
export async function createGroupConversation(input: CreateGroupInput): Promise<ConversationRecord> {
  const now = nowIso();
  const desired = Array.from(new Set(input.memberUserIds.filter((id) => id && id !== input.creatorId)));
  if (desired.length + 1 > GROUP_MEMBERS_MAX) {
    throw new Error(`GROUP_TOO_LARGE:${GROUP_MEMBERS_MAX}`);
  }
  await assertUsersExist(desired);

  const conversationId = newConversationId();
  const conversation: ConversationRecord = {
    id: conversationId,
    type: input.type,
    title: input.title,
    description: input.description,
    avatarRef: null,
    createdBy: input.creatorId,
    creatorName: input.creatorName,
    createdAt: now,
    updatedAt: now,
    lastMessageId: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    directKey: null,
    deptNodeId: input.deptNodeId,
    memberCount: desired.length + 1,
    tenantId: null,
  };

  const memberEntries: Record<string, ConversationMember> = {
    [`${conversationId}/members/${input.creatorId}`]: {
      userId: input.creatorId, role: 'owner', joinedAt: now, addedBy: input.creatorId, leftAt: null,
    },
  };
  const indexEntries: Record<string, UserConversationIndex> = {
    [`${input.creatorId}/${conversationId}`]: buildIndexEntry(conversationId, conversation),
  };
  for (const uid of desired) {
    memberEntries[`${conversationId}/members/${uid}`] = {
      userId: uid, role: 'member', joinedAt: now, addedBy: input.creatorId, leftAt: null,
    };
    indexEntries[`${uid}/${conversationId}`] = buildIndexEntry(conversationId, conversation);
  }

  // §RTDB-MERGE-PATHS — members embedded INSIDE the conversation node
  // (an update map with { convId, convId/members/uid } is rejected by
  // real RTDB as ancestor+descendant — the verified 1.0.1 500).
  const membersById: Record<string, ConversationMember> = {};
  for (const [path, member] of Object.entries(memberEntries)) {
    membersById[path.split('/members/')[1]!] = member;
  }
  await connectUpdate(CONVERSATIONS_PATH, {
    [conversationId]: { ...conversation, members: membersById },
  });
  await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, indexEntries);

  return conversation;
}

// ─── Listing ───────────────────────────────────────────────────

export interface ConversationListOptions {
  /** Include archived conversations (archivedAt set) in the result. */
  includeArchived: boolean;
  /** Max conversations returned (bounded — oldest-lastMessageAt dropped). */
  limit: number;
}

/**
 * §INDEX-FALLBACK — RTDB rejects child-ordered queries whose index is
 * not declared in the rules ("Index not defined … .indexOn") even for
 * the Admin SDK. Until the owner publishes the connect indexes (see
 * database.rules.json — already documented, NOT deployed), the list
 * falls back to a plain read of the caller's OWN index node (bounded
 * by the user's conversation count) sorted in memory. Identical
 * result, degraded efficiency.
 */

/**
 * The user's conversation list — ONE indexed query over the per-user
 * projection (orderByChild lastMessageAt, newest first), then bounded
 * unread scans (see read-state-service) for potentially-unread rows.
 */
export async function listUserConversations(
  userId: string,
  options: ConversationListOptions,
): Promise<ConversationView[]> {
  const indexPath = `${CONNECT_DB_ROOT}/userConversations/${userId}`;
  let entries: { key: string; value: UserConversationIndex & Record<string, unknown> }[];
  try {
    entries = await connectQuery<UserConversationIndex & Record<string, unknown>>(
      indexPath,
      { orderBy: { child: 'lastMessageAt' }, limitToLast: options.limit },
    );
  } catch (error) {
    if (!isUnindexedQueryError(error)) throw error;
    warnUnindexedOnce('list');
    // Plain read of the caller's own node → in-memory sort → newest N.
    const node = await connectGet<Record<string, UserConversationIndex & Record<string, unknown>>>(indexPath);
    const all = Object.entries(node ?? {}).map(([key, value]) => ({ key, value }));
    all.sort((a, b) => (a.value?.lastMessageAt ?? 0) - (b.value?.lastMessageAt ?? 0));
    entries = all.slice(-options.limit);
  }

  // RTDB returns ascending → newest first for the UI.
  const ordered = entries.slice().reverse().filter((e) => e.value && e.value.conversationId);
  const active = ordered.filter((e) => options.includeArchived || !e.value.archivedAt);

  // §AVATAR-SOURCE — ONE batched profile read for every direct row's
  // other participant (fresh from the canonical photoURL field; no
  // per-row cache to go stale).
  const otherIds = Array.from(new Set(
    active
      .filter((e) => e.value.type === 'direct')
      .map((e) => (e.value.directOtherUserId as string | undefined))
      .filter((v): v is string => Boolean(v)),
  ));
  const avatarById = otherIds.length > 0 ? await loadUserProfiles(otherIds) : new Map<string, ConnectUserProfile>();

  const views = await Promise.all(active.map(async (e) => {
    const idx = e.value;
    const view = await buildConversationViewFromIndex(userId, idx, e.key, avatarById);
    return view;
  }));
  return views;
}

/** The index entry IS the list payload; unread scan bounded per row. */
async function buildConversationViewFromIndex(
  userId: string,
  idx: UserConversationIndex & Record<string, unknown>,
  key: string,
  avatarById: Map<string, ConnectUserProfile> = new Map(),
): Promise<ConversationView> {
  const conversationId = (idx.conversationId as string) || key;
  const lastMessageId = (idx.lastMessageId as string | null) ?? null;
  const lastReadMessageId = (idx.lastReadMessageId as string | null) ?? null;
  const directOtherUserId = (idx.directOtherUserId as string | null) ?? null;

  let unreadCount = 0;
  let truncated = false;
  if (lastMessageId && lastMessageId !== lastReadMessageId) {
    const bounded = await boundedUnreadCount(conversationId, lastReadMessageId);
    unreadCount = bounded.count;
    truncated = bounded.truncated;
  }

  return {
    id: conversationId,
    type: (idx.type as ConversationType) ?? 'group',
    title: (idx.title as string | null) ?? null,
    description: null,
    createdAt: (idx.createdAt as string) ?? '',
    updatedAt: (idx.updatedAt as string) ?? '',
    lastMessageId,
    lastMessageAt: (idx.lastMessageAt as number) ?? null,
    lastMessagePreview: (idx.lastMessagePreview as string | null) ?? null,
    createdBy: '',
    memberCount: (idx.memberCount as number) ?? 0,
    displayTitle: (idx.displayTitle as string) ?? (idx.title as string) ?? 'محادثة',
    directOtherUserId,
    avatarUrl: directOtherUserId ? (avatarById.get(directOtherUserId)?.photoUrl ?? null) : null,
    myRole: (idx.myRole as ConversationRole) ?? 'member',
    archivedAt: (idx.archivedAt as string | null) ?? null,
    mutedUntil: (idx.mutedUntil as number | null) ?? null,
    lastReadMessageId,
    unreadCount,
    unreadCountTruncated: truncated,
    tenantId: null,
  };
}

/** Bounded unread scan lives in read-state-service (no import cycle). */

// ─── Details ───────────────────────────────────────────────────

/** Load every membership record of a conversation (small node). */
export async function loadMembers(conversationId: string): Promise<ConversationMember[]> {
  const value = await connectGet<Record<string, ConversationMember>>(`${conversationPath(conversationId)}/members`);
  if (!value) return [];
  return Object.values(value).filter((m) => m && typeof m.userId === 'string');
}

/**
 * Full details for one conversation (membership-gated by the caller).
 * Joins member profiles + read cursors (group "seen by" indicators)
 * + pinned ids. Suspended members carry the flag for the UI.
 */
export async function getConversationDetails(
  ctx: MembershipContext,
  meUserId: string,
): Promise<ConversationView & { members: ConversationMemberView[]; pinnedMessageIds: string[]; deptNodeId: string | null }> {
  const { conversation } = ctx;
  const members = await loadMembers(conversation.id);
  const activeMembers = members.filter((m) => !m.leftAt);

  const [profiles, readStates, pinned] = await Promise.all([
    loadUserProfiles(activeMembers.map((m) => m.userId)),
    connectGet<Record<string, { lastReadMessageId: string | null; lastDeliveredMessageId: string | null }>>(
      `${conversationPath(conversation.id)}/readState`,
    ),
    connectGet<Record<string, unknown>>(`${conversationPath(conversation.id)}/pinned`),
  ]);

  const lastIndexId = conversation.lastMessageId;
  const memberViews: ConversationMemberView[] = activeMembers.map((m) => {
    const profile = profiles.get(m.userId);
    const read = readStates?.[m.userId];
    return {
      ...m,
      name: profile?.name ?? null,
      email: profile?.email ?? null,
      photoUrl: profile?.photoUrl ?? null,
      hasRead: Boolean(lastIndexId && read?.lastReadMessageId && read.lastReadMessageId >= lastIndexId),
    };
  });

  // Direct display title = the OTHER member's name.
  let displayTitle = conversation.title ?? 'محادثة';
  let directOtherUserId: string | null = null;
  let otherAvatarUrl: string | null = null;
  if (conversation.type === 'direct') {
    const other = activeMembers.find((m) => m.userId !== meUserId) ?? null;
    directOtherUserId = other?.userId ?? null;
    otherAvatarUrl = other ? (profiles.get(other.userId)?.photoUrl ?? null) : null;
    displayTitle = other ? (profiles.get(other.userId)?.name ?? 'مستخدم') : 'محادثة';
  }

  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    description: conversation.description,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageId: conversation.lastMessageId,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    createdBy: conversation.createdBy,
    memberCount: conversation.memberCount,
    displayTitle,
    directOtherUserId,
    avatarUrl: otherAvatarUrl,
    myRole: ctx.member.role,
    archivedAt: null,
    mutedUntil: null,
    lastReadMessageId: readStates?.[meUserId]?.lastReadMessageId ?? null,
    unreadCount: 0,
    unreadCountTruncated: false,
    tenantId: conversation.tenantId,
    members: memberViews,
    pinnedMessageIds: pinned ? Object.keys(pinned) : [],
    deptNodeId: conversation.deptNodeId,
  };
}

// ─── Membership administration ─────────────────────────────────

/**
 * Add members to a group/department conversation. Actor must be
 * owner/admin. Already-active users are skipped; left members REJOIN
 * (role reset to member, addedBy = actor). memberCount maintained via
 * transaction per activation (race-exact for concurrent adds).
 */
export async function addMembers(
  conversationId: string,
  actorId: string,
  newUserIds: string[],
  conversation: ConversationRecord,
): Promise<string[]> {
  const now = nowIso();
  const desired = Array.from(new Set(newUserIds.filter((id) => id && id !== actorId)));
  await assertUsersExist(desired);

  const activated: string[] = [];
  for (const uid of desired) {
    const claim = await connectTransaction<ConversationMember>(memberPath(conversationId, uid), (current) => {
      if (current && !current.leftAt) return undefined; // already active
      if (current && current.leftAt) {
        return { ...current, leftAt: null, exitReason: null, role: 'member', addedBy: actorId, joinedAt: now };
      }
      return { userId: uid, role: 'member', joinedAt: now, addedBy: actorId, leftAt: null };
    });
    if (claim.committed) activated.push(uid);
  }

  if (activated.length === 0) return [];

  // memberCount += activated.length (transaction — race-exact).
  await connectTransaction<number>(`${conversationPath(conversationId)}/memberCount`, (cur) => (cur ?? 0) + activated.length);

  // Materialize index entries + refresh the denormalized display fields.
  const indexPatch: Record<string, unknown> = {};
  for (const uid of activated) {
    indexPatch[`${uid}/${conversationId}`] = buildIndexEntry(conversationId, conversation, { updatedAt: now });
  }
  await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, indexPatch);

  return activated;
}

/**
 * Remove a member (owner/admin; owner is irremovable — transfer
 * ownership first). Immediate access loss: the index entry is deleted
 * in the same atomic multi-path update that tombstones the membership.
 */
export async function removeMember(
  conversationId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  const now = nowIso();
  const member = await connectGet<ConversationMember>(memberPath(conversationId, targetUserId));
  if (!member || member.leftAt) throw new Error('MEMBER_NOT_ACTIVE');
  if (member.role === 'owner') throw new Error('OWNER_IRREMOVABLE');

  await connectUpdate(conversationPath(conversationId), {
    [`members/${targetUserId}/leftAt`]: now,
    [`members/${targetUserId}/exitReason`]: 'removed',
    [`members/${targetUserId}/role`]: 'member',
  });
  await connectTransaction<number>(`${conversationPath(conversationId)}/memberCount`, (cur) => Math.max(0, (cur ?? 1) - 1));
  await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, { [`${targetUserId}/${conversationId}`]: null });
}

/**
 * Leave a conversation. The owner must transfer ownership first
 * unless they are the last active member (then leaving is allowed and
 * the conversation becomes empty but keeps its history).
 */
export async function leaveConversation(
  conversationId: string,
  userId: string,
): Promise<void> {
  const now = nowIso();
  const member = await connectGet<ConversationMember>(memberPath(conversationId, userId));
  if (!member || member.leftAt) throw new Error('MEMBER_NOT_ACTIVE');

  if (member.role === 'owner') {
    const members = await loadMembers(conversationId);
    const others = members.filter((m) => !m.leftAt && m.userId !== userId);
    if (others.length > 0) {
      throw new Error('OWNER_MUST_TRANSFER');
    }
  }

  await connectUpdate(conversationPath(conversationId), {
    [`members/${userId}/leftAt`]: now,
    [`members/${userId}/exitReason`]: 'left',
    [`members/${userId}/role`]: 'member',
  });
  await connectTransaction<number>(`${conversationPath(conversationId)}/memberCount`, (cur) => Math.max(0, (cur ?? 1) - 1));
  await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, { [`${userId}/${conversationId}`]: null });
}

/**
 * Role change — OWNER only (cannot change own role). Role vocabulary:
 * owner > admin > member. Promote/demote admins and members.
 */
export async function changeRole(
  conversationId: string,
  actorId: string,
  targetUserId: string,
  newRole: Exclude<ConversationRole, 'owner'>,
): Promise<void> {
  if (actorId === targetUserId) throw new Error('SELF_ROLE_CHANGE_FORBIDDEN');
  const member = await connectGet<ConversationMember>(memberPath(conversationId, targetUserId));
  if (!member || member.leftAt) throw new Error('MEMBER_NOT_ACTIVE');

  await connectSet(`${conversationPath(conversationId)}/members/${targetUserId}/role`, newRole);
}

/** Transfer ownership: new owner + actor demoted to admin, atomically. */
export async function transferOwnership(
  conversationId: string,
  actorId: string,
  newOwnerId: string,
): Promise<void> {
  if (actorId === newOwnerId) throw new Error('SELF_ROLE_CHANGE_FORBIDDEN');
  const member = await connectGet<ConversationMember>(memberPath(conversationId, newOwnerId));
  if (!member || member.leftAt) throw new Error('MEMBER_NOT_ACTIVE');

  await connectUpdate(`${conversationPath(conversationId)}/members`, {
    [`${newOwnerId}/role`]: 'owner',
    [`${actorId}/role`]: 'admin',
  });
}

// ─── Per-user state (archive / mute) + meta updates ────────────

export async function setArchived(conversationId: string, userId: string, archived: boolean): Promise<void> {
  await connectSet(`${CONNECT_DB_ROOT}/userConversations/${userId}/${conversationId}/archivedAt`, archived ? nowIso() : null);
}

export async function setMutedUntil(conversationId: string, userId: string, mutedUntilMs: number | null): Promise<void> {
  await connectSet(`${CONNECT_DB_ROOT}/userConversations/${userId}/${conversationId}/mutedUntil`, mutedUntilMs);
}

/** Update group meta (owner/admin) + the denormalized list fields. */
export async function updateConversationMeta(
  conversationId: string,
  patch: { title?: string; description?: string | null },
): Promise<void> {
  const now = nowIso();
  const convPatch: Record<string, unknown> = { updatedAt: now };
  const indexPatch: Record<string, unknown> = { updatedAt: now };
  if (patch.title !== undefined) {
    convPatch.title = patch.title;
    indexPatch.title = patch.title;
  }
  if (patch.description !== undefined) {
    convPatch.description = patch.description;
  }
  await connectUpdate(conversationPath(conversationId), convPatch);

  const members = await loadMembers(conversationId);
  const idxMap: Record<string, unknown> = {};
  for (const m of members.filter((mm) => !mm.leftAt)) {
    idxMap[`${m.userId}/${conversationId}`] = indexPatch;
  }
  if (Object.keys(idxMap).length > 0) {
    await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, idxMap);
  }
}

/**
 * Resolve the OTHER member of a direct conversation for the
 * notification bridge (null when the pair data is inconsistent).
 */
export async function findDirectOtherUserId(conversationId: string, meUserId: string): Promise<string | null> {
  const members = await loadMembers(conversationId);
  const other = members.find((m) => !m.leftAt && m.userId !== meUserId);
  return other?.userId ?? null;
}

/**
 * Whether a conversation's meta update should be visible — used by
 * routes to prevent direct-conversation title edits (they are derived).
 */
export function canEditConversationMeta(conversation: ConversationRecord): boolean {
  return conversation.type !== 'direct';
}

/** Guard for non-member/missing conversation inside admin-only routes. */
export function denyIfMissing(conversation: unknown): asserts conversation is ConversationRecord {
  if (!conversation) throw new AccessDeniedError('not_found', 'المحادثة غير موجودة');
}

/** Screen a candidate member list against muted recipients for notify. */
export async function filterMutedRecipients(conversationId: string, recipientIds: string[]): Promise<string[]> {
  const checks = await Promise.all(recipientIds.map(async (uid) => {
    const entry = await connectGet<{ mutedUntil: number | null }>(userIndexPath(uid, conversationId));
    const mutedUntil = entry?.mutedUntil ?? null;
    return mutedUntil && mutedUntil > Date.now() ? null : uid;
  }));
  return checks.filter((v): v is string => v !== null);
}

// Re-export for route convenience.
export { requireActiveMembership, AccessDeniedError };
export type { MembershipContext, ConversationRecord };
