// src/lib/connect/read-state-service.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — READ / DELIVERY STATE
//
//  §CURSORS — per-member monotonic cursors, NOT per-message read
//  records (§SPEC-10). Two mirrored locations, both written by this
//  module only:
//    • connect/conversations/{id}/readState/{userId}  (source of
//      truth — drives group "seen by" indicators, one node read)
//    • connect/userConversations/{userId}/{id} (list-side mirror —
//      the conversation list reads cursors without touching
//      conversation nodes)
//
//  MONOTONICITY — cursor updates are TRANSACTIONS comparing RTDB push
//  keys lexicographically (push keys are time-ordered; a later key is
//  always "newer"). A stale client echoing an older cursor can never
//  regress the state. Concurrent mark-read calls serialize on the
//  transaction path — no lost-update window (§CONCURRENCY in the
//  delivery report).
//
//  UNREAD COUNTS — computed lazily with a BOUNDED key-range scan
//  (startAt(cursor) limitToFirst(CAP+1)) — never a full conversation
//  download (§SPEC-17). Above the cap the response says "truncated".
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { CONNECT_DB_ROOT, CONVERSATIONS_PATH, TYPING_TTL_MS, UNREAD_COUNT_CAP } from './constants';
import { connectGet, connectQuery, connectSet, connectTransaction, connectUpdate } from './rtdb';
import { newerPushKey } from './ids';
import type { UserConversationIndex } from './types';

export interface MemberReadState {
  lastReadMessageId: string | null;
  lastDeliveredMessageId: string | null;
  updatedAtMs: number;
}

const readStatePath = (convId: string, userId: string) => `${CONVERSATIONS_PATH}/${convId}/readState/${userId}`;
const userIndexPath = (userId: string, convId: string) => `arm_erp/connect/userConversations/${userId}/${convId}`;
const typingPath = (convId: string) => `${CONVERSATIONS_PATH}/${convId}/typing`;

export interface BoundedCount {
  count: number;
  truncated: boolean;
}

/**
 * Count messages STRICTLY AFTER `afterMessageId` (null = from the
 * beginning), capped at UNREAD_COUNT_CAP. One bounded key-range query.
 */
export async function boundedUnreadCount(conversationId: string, afterMessageId: string | null): Promise<BoundedCount> {
  const rows = await connectQuery(`${CONVERSATIONS_PATH}/${conversationId}/messages`, {
    orderBy: 'key',
    startAt: afterMessageId ?? null,
    limitToFirst: UNREAD_COUNT_CAP + 2,
  });
  // startAt is INCLUSIVE — the cursor message itself is not unread.
  const unread = rows.filter((r) => r.key !== afterMessageId);
  if (unread.length > UNREAD_COUNT_CAP) {
    return { count: UNREAD_COUNT_CAP, truncated: true };
  }
  return { count: unread.length, truncated: false };
}

/** All member read states of one conversation (one small node read). */
export async function loadReadStates(conversationId: string): Promise<Record<string, MemberReadState>> {
  return (await connectGet<Record<string, MemberReadState>>(
    `${CONVERSATIONS_PATH}/${conversationId}/readState`,
  )) ?? {};
}

/**
 * §MIRROR-WRITE — advance mirrored cursor fields on the list-side
 * index entry with an EXISTENCE-CHECKED LEAF update (monotonic,
 * null-safe). `leafFields` are relative to the entry node (e.g.
 * `lastReadMessageId`). The previous implementation used a
 * full-replace TRANSACTION with `if (!cur) return undefined` — on real
 * RTDB the transaction function's first (speculative) invocation
 * receives a null cached value, and returning undefined there ABORTED
 * the transaction every time, so mirrors never recorded
 * reads/deliveries (the unread badge never cleared — verified live).
 * The mirror is a projection: the SOURCE transactions keep the
 * monotonic guarantee; this leaf update self-heals on the next
 * mark-read (documented 1.0 limitation — the mirror may briefly lag).
 */
async function advanceMirrorCursorFields(
  userId: string,
  conversationId: string,
  leafFields: Record<string, unknown>,
): Promise<void> {
  const entry = await connectGet<UserConversationIndex & Record<string, unknown>>(userIndexPath(userId, conversationId));
  if (!entry) return; // removed member / never materialized — nothing to mirror
  const leafMap: Record<string, unknown> = {};
  for (const [leaf, value] of Object.entries(leafFields)) {
    leafMap[`${userId}/${conversationId}/${leaf}`] = value;
  }
  await connectUpdate(`${CONNECT_DB_ROOT}/userConversations`, leafMap);
}

/**
 * Advance the DELIVERED cursor (called by sync when the recipient has
 * actually downloaded the messages). Monotonic on the source-of-truth
 * node (transaction) + the list-side mirror (§MIRROR-WRITE leaf update).
 */
export async function markDelivered(conversationId: string, userId: string, messageId: string): Promise<void> {
  const now = Date.now();

  const claim = await connectTransaction<MemberReadState>(readStatePath(conversationId, userId), (cur) => {
    if (cur && cur.lastDeliveredMessageId && cur.lastDeliveredMessageId >= messageId) return undefined;
    return {
      lastReadMessageId: cur?.lastReadMessageId ?? null,
      lastDeliveredMessageId: newerPushKey(messageId, cur?.lastDeliveredMessageId ?? null),
      updatedAtMs: now,
    };
  });
  if (!claim.committed) return;

  // Mirror — §MIRROR-WRITE (existence-checked leaf update, forward-only).
  const entry = await connectGet<{ lastDeliveredMessageId: string | null }>(userIndexPath(userId, conversationId));
  if (!entry) return; // no index entry (removed member) — nothing to mirror
  if (entry.lastDeliveredMessageId && entry.lastDeliveredMessageId >= messageId) return;
  await advanceMirrorCursorFields(userId, conversationId, {
    lastDeliveredMessageId: messageId,
    updatedAt: new Date(now).toISOString(),
  });
}

/**
 * Advance the READ cursor (recipient opened/viewed the conversation).
 * `messageId` = the newest message the client actually rendered (or
 * null → the conversation's current lastMessageId). Monotonic on the
 * source (transaction); the mirror advances via §MIRROR-WRITE
 * (existence-checked leaf update — the aborting full-replace mirror
 * transaction never landed on real RTDB).
 */
export async function markRead(
  conversationId: string,
  userId: string,
  messageId: string | null,
  conversationLastMessageId: string | null,
): Promise<{ lastReadMessageId: string | null }> {
  const effective = messageId ?? conversationLastMessageId;
  if (!effective) return { lastReadMessageId: null };

  const now = Date.now();
  const claim = await connectTransaction<MemberReadState>(readStatePath(conversationId, userId), (cur) => {
    const currentRead = cur?.lastReadMessageId ?? null;
    if (currentRead && currentRead >= effective) return undefined; // no regression
    return {
      lastReadMessageId: effective,
      // read ⊇ delivered
      lastDeliveredMessageId: newerPushKey(effective, cur?.lastDeliveredMessageId ?? null),
      updatedAtMs: now,
    };
  });

  if (claim.committed && claim.value) {
    // §MIRROR-WRITE — monotonic leaf update (existence-checked).
    const entry = await connectGet<{ lastReadMessageId: string | null }>(userIndexPath(userId, conversationId));
    if (entry && !(entry.lastReadMessageId && entry.lastReadMessageId >= effective)) {
      await advanceMirrorCursorFields(userId, conversationId, {
        lastReadMessageId: effective,
        updatedAt: new Date(now).toISOString(),
      });
    }
  }

  return { lastReadMessageId: claim.value?.lastReadMessageId ?? effective };
}

// ─── Typing indicators ─────────────────────────────────────────

/**
 * Heartbeat-style typing ping with an EXPIRY timestamp (§SPEC-11 —
 * indicators auto-expire even if the browser dies mid-typing; no
 * cleanup dependency, readers simply filter `until <= now`).
 */
export async function setTyping(conversationId: string, userId: string): Promise<void> {
  await connectSet(`${typingPath(conversationId)}/${userId}`, { until: Date.now() + TYPING_TTL_MS });
}

/** Currently-typing users (expired entries filtered; swept best-effort). */
export async function getTypingUsers(conversationId: string): Promise<{ userId: string; until: number }[]> {
  const node = await connectGet<Record<string, { until: number }>>(typingPath(conversationId));
  if (!node) return [];
  const now = Date.now();
  const active: { userId: string; until: number }[] = [];
  const expiredPaths: Record<string, null> = {};
  for (const [userId, entry] of Object.entries(node)) {
    if (entry && typeof entry.until === 'number' && entry.until > now) {
      active.push({ userId, until: entry.until });
    } else {
      expiredPaths[userId] = null;
    }
  }
  // Opportunistic sweep — never blocks the reader on failure.
  if (Object.keys(expiredPaths).length > 0) {
    connectUpdate(typingPath(conversationId), expiredPaths).catch(() => undefined);
  }
  return active;
}
