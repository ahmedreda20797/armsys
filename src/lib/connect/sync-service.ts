// src/lib/connect/sync-service.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — SYNC SERVICE
//
//  Cursor-based incremental synchronization (§SPEC-11):
//    • newMessages   — strictly after the client's message-id cursor
//                      (key-ordered range — the §ORDERING guarantee).
//    • updatedMessages — edits/deletes since the client's serverTimeMs
//                      (child-ordered on updatedAtMs — REQUIRES the
//                      documented .indexOn declaration; see the
//                      delivery report §INDEXES).
//    • delivered marking happens here — a recipient is "delivered"
//      only when the sync endpoint actually served them the messages.
//  No WebSockets, no paid realtime infrastructure (§SPEC-15).
// ══════════════════════════════════════════════════════════════

import 'server-only';

import {
  CONVERSATIONS_PATH,
  SYNC_NEW_MESSAGES_MAX,
  SYNC_UPDATED_FALLBACK_SCAN,
  SYNC_UPDATED_MESSAGES_MAX,
} from './constants';
import { connectGet, connectQuery, isUnindexedQueryError, warnUnindexedOnce } from './rtdb';
import { markDelivered, getTypingUsers } from './read-state-service';
import { attachReplyPreviews, loadMessage } from './message-service';
import type { MembershipContext } from './membership';
import type { ConversationSyncPayload, MessageRecord, MessageView } from './types';

export interface SyncRequest {
  /** Client's last known message id (null → initial page via messages endpoint). */
  cursor: string | null;
  /** Client's last serverTimeMs (edit/delete window). */
  sinceMs: number | null;
  /**
   * §SYNC-CONTINUATION — the push key of the last processed update at
   * `sinceMs` (composite cursor: RTDB orders value ties by key). With
   * it, a truncated round resumes EXACTLY after the last served
   * record — same-millisecond bursts neither stall nor skip.
   */
  sinceKey?: string | null;
}

/**
 * One incremental sync round for an OPEN conversation. Membership is
 * enforced by the caller (ctx from requireActiveMembership).
 *
 * §SYNC-CONTINUATION — BOTH cursors advance only past records that
 * were actually SERVED and processed this round:
 *   • `cursor`       = the last served NEW message id (a round that
 *     hits SYNC_NEW_MESSAGES_MAX leaves the rest for the next round —
 *     previously it jumped to conversation.lastMessageId, which
 *     permanently skipped messages 101..N).
 *   • `updatedCursorMs` = the highest updatedAtMs fully examined for
 *     updates, stepped back 1ms when the round truncated so
 *     same-millisecond records re-fetch (merge is idempotent by id).
 */
export async function syncConversation(
  ctx: MembershipContext,
  request: SyncRequest,
): Promise<ConversationSyncPayload> {
  const conversationId = ctx.conversation.id;
  const sinceMs = request.sinceMs && Number.isFinite(request.sinceMs) ? request.sinceMs : null;

  // ── New messages (strictly after cursor) ──
  const newRecords: MessageRecord[] = [];
  if (request.cursor) {
    // Validate the cursor shape before using it as a bound.
    if (typeof request.cursor === 'string' && request.cursor.length <= 128) {
      const rows = await connectQuery<MessageRecord>(`${CONVERSATIONS_PATH}/${conversationId}/messages`, {
        orderBy: 'key',
        startAt: request.cursor,
        limitToFirst: SYNC_NEW_MESSAGES_MAX + 1,
      });
      // startAt is inclusive — drop the cursor the client already has.
      for (const row of rows) {
        if (row.key === request.cursor) continue;
        newRecords.push(row.value);
      }
      if (newRecords.length > SYNC_NEW_MESSAGES_MAX) newRecords.length = SYNC_NEW_MESSAGES_MAX;
    }
  }

  const newIds = new Set(newRecords.map((r) => r.id));
  const lastServedId = newRecords.length > 0 ? newRecords[newRecords.length - 1].id : null;

  // ── Updated messages (edits/deletes since last sync) ──
  // §SYNC-CONTINUATION — composite cursor (updatedAtMs, push key):
  // the window resumes strictly AFTER the last processed record, so a
  // round that hits the cap never skips and a same-millisecond burst
  // (ties ordered by key) never stalls. When the fetched window is
  // ENTIRELY already-processed prefix (giant tie group at the cursor
  // timestamp), the window widens (bounded ×3) until it reaches
  // unprocessed records or the conversation tail.
  //
  // §INDEX-FALLBACK — until the messages/.indexOn["updatedAtMs"] is
  // published, RTDB rejects the child-ordered window ("Index not
  // defined"). The fallback scans a bounded newest-by-key window
  // (SYNC_UPDATED_FALLBACK_SCAN) and filters by updatedAtMs in memory:
  // correct for the recent-edit traffic Connect actually serves;
  // edits older than the scanned window are deferred until the index
  // is published (documented limitation, never a crash).
  const updatedRecords: MessageRecord[] = [];
  let updatedCursorMs: number | null = null;
  let updatedCursorKey: string | null = null;
  if (sinceMs !== null && sinceMs > 0) {
    const sinceKey = typeof request.sinceKey === 'string' && request.sinceKey.length <= 128 ? request.sinceKey : null;
    let rows: { key: string; value: MessageRecord }[] = [];
    let eligible: { key: string; value: MessageRecord }[] = [];
    let indexUnavailable = false;
    let fetchLimit = SYNC_UPDATED_MESSAGES_MAX + 1;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        rows = await connectQuery<MessageRecord>(`${CONVERSATIONS_PATH}/${conversationId}/messages`, {
          orderBy: { child: 'updatedAtMs' },
          startAt: sinceMs,
          limitToFirst: fetchLimit,
        });
        eligible = rows.filter((row) => {
          const ts = row.value.updatedAtMs;
          if (ts > sinceMs) return true;
          if (ts < sinceMs) return false;
          // ts === sinceMs — strictly after the composite cursor position.
          return !sinceKey || row.key > sinceKey;
        });
        // Progress, or the whole tail fit in the window (exhausted).
        if (eligible.length > 0 || rows.length < fetchLimit) break;
        fetchLimit = Math.min(fetchLimit * 3, SYNC_UPDATED_MESSAGES_MAX * 6);
      }
    } catch (error) {
      if (!isUnindexedQueryError(error)) throw error;
      indexUnavailable = true;
      warnUnindexedOnce('sync');
      // Bounded newest-by-key scan, filtered in memory.
      rows = await connectQuery<MessageRecord>(`${CONVERSATIONS_PATH}/${conversationId}/messages`, {
        orderBy: 'key',
        limitToLast: SYNC_UPDATED_FALLBACK_SCAN,
      });
      eligible = rows.filter((row) => {
        const ts = row.value.updatedAtMs;
        if (ts > sinceMs) return true;
        if (ts < sinceMs) return false;
        return !sinceKey || row.key > sinceKey;
      });
    }

    // Both paths cap at SYNC_UPDATED_MESSAGES_MAX per round; the
    // fallback window may hold more eligible rows than the cap — they
    // are re-served next round (the cursor advanced only past the
    // last SERVED record).
    const served = eligible.slice(0, SYNC_UPDATED_MESSAGES_MAX);
    for (const row of served) {
      if (!newIds.has(row.value.id)) updatedRecords.push(row.value);
    }
    if (served.length > 0) {
      // Advance exactly past the last SERVED record (identical to the
      // indexed path — the composite cursor is lookup-order agnostic).
      const last = served[served.length - 1];
      updatedCursorMs = last.value.updatedAtMs;
      updatedCursorKey = last.key;
    } else if (indexUnavailable) {
      // Fallback with nothing new in the scanned window: HOLD the
      // cursor — the next round rescans the same bounded window and
      // re-filters (cheap; the window is capped). Never advance past
      // records the key-window could not prove processed.
      updatedCursorMs = sinceMs;
      updatedCursorKey = sinceKey;
    } else if (rows.length > 0) {
      if (rows.length < fetchLimit) {
        // Everything from sinceMs was examined and processed — advance
        // to the very tail of the examined window.
        const last = rows[rows.length - 1];
        updatedCursorMs = last.value.updatedAtMs;
        updatedCursorKey = last.key;
      } else {
        // Widening exhausted without progress (pathological burst) —
        // keep the client's cursor; it retries next round unchanged.
        updatedCursorMs = sinceMs;
        updatedCursorKey = sinceKey;
      }
    } else {
      // Nothing at/after sinceMs at all — cursor stays put.
      updatedCursorMs = sinceMs;
      updatedCursorKey = sinceKey;
    }
  }

  const [newMessages, updatedMessages] = await Promise.all([
    attachReplyPreviews(conversationId, newRecords),
    attachReplyPreviews(conversationId, updatedRecords),
  ]);

  // ── Delivery cursor advances because we SERVED these messages ──
  // lastServedId = newest message actually downloaded this round;
  // request.cursor = a message id the client already holds from an
  // earlier round. Never stamp conversation.lastMessageId blindly —
  // with a truncated round it would mark unserved messages delivered.
  const deliveryTarget = lastServedId ?? (request.cursor ?? null);
  if (deliveryTarget) {
    // Fire-and-forget: a failed delivery stamp must not fail the sync.
    markDelivered(conversationId, ctx.member.userId, deliveryTarget).catch(() => undefined);
  }

  // ── Typing + pins (cheap single-node reads, active conversation only) ──
  const [typing, pinned] = await Promise.all([
    getTypingUsers(conversationId),
    connectGet<Record<string, unknown>>(`${CONVERSATIONS_PATH}/${conversationId}/pinned`),
  ]);

  return {
    conversationId,
    newMessages,
    updatedMessages,
    // §SYNC-CONTINUATION — served-based cursor; a cursor-less client
    // (history owned by the initial page) still learns the newest id.
    cursor: lastServedId ?? request.cursor ?? ctx.conversation.lastMessageId,
    updatedCursorMs,
    updatedCursorKey,
    typing,
    pinnedMessageIds: pinned ? Object.keys(pinned) : [],
    serverTimeMs: Date.now(),
  };
}

/**
 * Resolve one message WITH membership enforcement — used by the
 * deep-link jump path (notification → specific message) so a message
 * id from a notification can never cross a conversation boundary.
 */
export async function getMessageForViewer(
  ctx: MembershipContext,
  messageId: string,
): Promise<MessageView | null> {
  const record = await loadMessage(ctx.conversation.id, messageId);
  if (!record) return null;
  const [view] = await attachReplyPreviews(ctx.conversation.id, [record]);
  return view;
}
