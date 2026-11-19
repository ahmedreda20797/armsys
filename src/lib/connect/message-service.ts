// src/lib/connect/message-service.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — MESSAGE SERVICE
//
//  Send / edit / delete / purge / paginate / pin / search.
//
//  §IDEMPOTENCY (§SPEC-5D) — the clientKey claim is a TRANSACTION on
//  connect/conversations/{id}/clientKeys/{clientKey}. Concurrent
//  duplicate requests serialize: exactly one commits ("created"),
//  every other resolves to the SAME logical message ("existing").
//  A pre-generated push key makes the message write itself
//  idempotent, so a crash between claim and write is healed by the
//  TAKEOVER path: a same-sender retry completes the interrupted write.
//  The claim-then-write pair is deliberately NARROW (one conversation,
//  one key) — no global transaction machinery (§SPEC-5D).
//
//  §ORDERING — message ids are RTDB push keys (time-ordered,
//  concurrency-safe). No sequence counter, no timestamps-as-ids, no
//  arrays (§SPEC-6).
//
//  §ATOMIC-VIEW — a send writes the message + conversation cursor +
//  every member's list index entry in ONE multi-path update.
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { getById } from '@/lib/db';
import {
  CONNECT_DB_ROOT,
  CONVERSATIONS_PATH,
  EDIT_WINDOW_MS,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
  REFERENCE_TARGETS,
  SEARCH_RESULT_LIMIT,
  SEARCH_SCAN_LIMIT,
} from './constants';
import { connectGet, connectNewPushKey, connectQuery, connectTransaction, connectUpdate } from './rtdb';
import { AccessDeniedError, loadUserProfiles, requireActiveMembership, type MembershipContext } from './membership';
import { validateMessageBody, validateClientKey } from './validation';
import type {
  ConversationMember,
  ConversationRecord,
  MessageRecord,
  MessageReference,
  MessageView,
  SendMessageResult,
  UserConversationIndex,
} from './types';

// ─── Path helpers ──────────────────────────────────────────────

const messagesRoot = (convId: string) => `${CONVERSATIONS_PATH}/${convId}/messages`;
const messagePath = (convId: string, messageId: string) => `${messagesRoot(convId)}/${messageId}`;
const clientKeyPath = (convId: string, clientKey: string) => `${CONVERSATIONS_PATH}/${convId}/clientKeys/${clientKey}`;
const pinnedPath = (convId: string) => `${CONVERSATIONS_PATH}/${convId}/pinned`;

function nowIso(): string {
  return new Date().toISOString();
}

// ─── View projection ───────────────────────────────────────────

/** Tombstone projection — deleted bodies NEVER leave the server. */
function toMessageView(record: MessageRecord, replyTarget?: MessageRecord | null): MessageView {
  const deleted = Boolean(record.deletedAt);
  return {
    id: record.id,
    conversationId: record.conversationId,
    senderUserId: record.senderUserId,
    senderName: record.senderName,
    body: deleted ? null : record.body,
    replyToId: record.replyToId ?? null,
    replyPreview: replyTarget
      ? {
          id: replyTarget.id,
          senderName: replyTarget.senderName,
          excerpt: replyTarget.deletedAt
            ? 'تم حذف هذه الرسالة'
            : (replyTarget.body ?? '').slice(0, 140),
        }
      : null,
    mentions: deleted ? null : (record.mentions ?? null),
    references: deleted ? null : (record.references ?? null),
    editedAt: record.editedAt ?? null,
    deletedAt: record.deletedAt ?? null,
    createdAt: record.createdAt,
    createdAtMs: record.createdAtMs ?? 0,
  };
}

/** Load a single message record (null when missing). */
export async function loadMessage(conversationId: string, messageId: string): Promise<MessageRecord | null> {
  if (!messageId || typeof messageId !== 'string' || messageId.length > 128) return null;
  return connectGet<MessageRecord>(messagePath(conversationId, messageId));
}

/** Resolve reply previews for a batch of messages (bounded, deduped). */
export async function attachReplyPreviews(
  conversationId: string,
  records: MessageRecord[],
): Promise<MessageView[]> {
  const replyIds = Array.from(new Set(records.map((r) => r.replyToId).filter((v): v is string => Boolean(v))));
  const targets = new Map<string, MessageRecord | null>();
  await Promise.all(replyIds.slice(0, 100).map(async (id) => {
    targets.set(id, await loadMessage(conversationId, id));
  }));
  return records.map((r) => toMessageView(r, r.replyToId ? targets.get(r.replyToId) ?? null : null));
}

// ─── Send ──────────────────────────────────────────────────────

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  clientKey: string | null;
  replyToId: string | null;
  /** Already-validated; mentions are filtered to ACTIVE members here. */
  mentions: string[] | null;
  /** Already-validated; existence-checked here. */
  references: MessageReference[] | null;
  /** Pre-resolved active members (mention filter + index writes). */
  activeMemberIds: string[];
  conversation: ConversationRecord;
}

/** Validation-shaped rejection the route maps to 400. */
export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageValidationError';
  }
}

/** Internal duplicate-resolution outcome. */
interface IdempotencyClaim {
  committed: boolean;
  messageId: string;
  claim: { messageId: string; senderUserId: string; createdAt: string } | null;
}

function buildMessageRecord(params: {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  clientKey: string | null;
  replyToId: string | null;
  mentions: string[] | null;
  references: MessageReference[] | null;
  createdAtIso: string;
  createdAtMs: number;
}): MessageRecord {
  return {
    id: params.messageId,
    conversationId: params.conversationId,
    senderUserId: params.senderId,
    senderName: params.senderName,
    body: params.body,
    clientKey: params.clientKey,
    replyToId: params.replyToId,
    mentions: params.mentions,
    references: params.references,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: params.createdAtIso,
    createdAtMs: params.createdAtMs,
    updatedAtMs: params.createdAtMs,
    tenantId: null,
  };
}

/**
 * THE atomic view update for one new message: message node +
 * conversation cursor + every active member's list index fields, in
 * ONE multi-path update (all-or-nothing).
 */
function buildSendUpdateMap(input: {
  conversation: ConversationRecord;
  activeMemberIds: string[];
  record: MessageRecord;
  preview: string;
  senderId: string;
  senderName: string | null;
}): Record<string, unknown> {
  const { conversation, activeMemberIds, record, preview } = input;
  const cid = conversation.id;
  const map: Record<string, unknown> = {
    [`conversations/${cid}/messages/${record.id}`]: record,
    [`conversations/${cid}/lastMessageId`]: record.id,
    [`conversations/${cid}/lastMessageAt`]: record.createdAtMs,
    [`conversations/${cid}/lastMessagePreview`]: preview,
    [`conversations/${cid}/updatedAt`]: record.createdAt,
    // §UNREAD-SELF — the sender has, by definition, seen their own
    // message: advance their read/delivery cursors so their own message
    // never counts as unread in their own list. The new message's push
    // key is the newest, so the advance is monotonic by construction.
    [`conversations/${cid}/readState/${input.senderId}`]: {
      lastReadMessageId: record.id,
      lastDeliveredMessageId: record.id,
      updatedAtMs: record.createdAtMs,
    },
  };

  for (const uid of activeMemberIds) {
    const base = `userConversations/${uid}/${cid}`;
    map[`${base}/lastMessageAt`] = record.createdAtMs;
    map[`${base}/lastMessageId`] = record.id;
    map[`${base}/lastMessagePreview`] = preview;
    map[`${base}/updatedAt`] = record.createdAt;
    if (uid === input.senderId) {
      // §UNREAD-SELF — sender's mirror cursors too.
      map[`${base}/lastReadMessageId`] = record.id;
      map[`${base}/lastDeliveredMessageId`] = record.id;
    }
    // Direct conversations keep display names fresh on every send
    // (§DIRECT-NAME): the recipient's tile shows the sender's name.
    if (conversation.type === 'direct' && uid !== input.senderId) {
      map[`${base}/displayTitle`] = input.senderName ?? 'مستخدم';
      map[`${base}/directOtherUserId`] = input.senderId;
    }
  }
  return map;
}

/** Bounded wait for a message that a committed claim points at. */
async function waitForClaimedMessage(convId: string, messageId: string, attempts = 4): Promise<MessageRecord | null> {
  for (let i = 0; i < attempts; i++) {
    const record = await loadMessage(convId, messageId);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

/**
 * Send one message (idempotent). The route derives senderId/senderName
 * from the AUTHENTICATED session — never from the request body
 * (§SECURITY: no sender impersonation).
 */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const { conversationId, senderId } = input;
  const bodyCheck = validateMessageBody(input.body);
  if (!bodyCheck.ok) throw new MessageValidationError(bodyCheck.error);
  const keyCheck = validateClientKey(input.clientKey);
  if (!keyCheck.ok) throw new MessageValidationError(keyCheck.error);
  const clientKey = keyCheck.clientKey || null;

  // Display snapshot — resolved fresh from the users table when the
  // caller did not pass one (route handlers pass null on purpose).
  const senderName = input.senderName ?? (await resolveSenderName(senderId));

  // Reply target must belong to THIS conversation (cross-conversation
  // replies are rejected — §SECURITY).
  if (input.replyToId) {
    const replyTarget = await loadMessage(conversationId, input.replyToId);
    if (!replyTarget) {
      throw new MessageValidationError('الرسالة الأصلية للرد غير موجودة في هذه المحادثة');
    }
  }

  // Mentions are filtered to ACTIVE members — a mention can never
  // produce a notification or data access for a non-member.
  const memberSet = new Set(input.activeMemberIds);
  const filteredMentions = input.mentions ? input.mentions.filter((m) => memberSet.has(m)) : null;
  const mentions = filteredMentions && filteredMentions.length > 0 ? filteredMentions : null;

  // §RECORD-REFS — every referenced record must EXIST in its table.
  if (input.references) {
    for (const ref of input.references) {
      const target = REFERENCE_TARGETS[ref.type];
      const record = await getById<Record<string, unknown>>(target.table, ref.id);
      if (!record) {
        throw new MessageValidationError(`السجل المرتبط غير موجود (${target.label})`);
      }
    }
  }

  const messageId = connectNewPushKey(messagesRoot(conversationId));
  const createdAtMs = Date.now();
  const createdAtIso = new Date(createdAtMs).toISOString();

  // ── Idempotency claim (transaction — the only concurrency gate) ──
  let claim: IdempotencyClaim;
  if (clientKey) {
    const result = await connectTransaction<{ messageId: string; senderUserId: string; createdAt: string }>(
      clientKeyPath(conversationId, clientKey),
      (current) => {
        if (current) return undefined; // already claimed — abort
        return { messageId, senderUserId: senderId, createdAt: createdAtIso };
      },
    );
    claim = { committed: result.committed, messageId: result.value?.messageId ?? messageId, claim: result.value };
  } else {
    claim = { committed: true, messageId, claim: null };
  }

  // ── Duplicate resolution path ──
  if (!claim.committed && claim.claim) {
    const existing = claim.claim;
    if (existing.senderUserId !== senderId) {
      // clientKey collision across users — reject, never disclose content.
      throw new MessageValidationError('تعارض في معرّف الطلب (clientKey مستخدم لمرسل آخر)');
    }
    const found = await waitForClaimedMessage(conversationId, existing.messageId);
    if (found) {
      return { status: 'existing', message: (await attachReplyPreviews(conversationId, [found]))[0] };
    }
    // TAKEOVER: the original writer died between claim and write.
    // The messageId is fixed in the claim, so completing the write is
    // idempotent — this retry becomes the writer.
    claim = { committed: true, messageId: existing.messageId, claim: existing };
  }

  // ── Write (single multi-path atomic update) ──
  const record = buildMessageRecord({
    conversationId,
    messageId: claim.messageId,
    senderId,
    senderName,
    body: bodyCheck.body,
    clientKey,
    replyToId: input.replyToId,
    mentions,
    references: input.references,
    createdAtIso,
    createdAtMs,
  });

  const preview = bodyCheck.body.slice(0, 120);
  try {
    await connectUpdate(CONNECT_DB_ROOT, buildSendUpdateMap({
      conversation: input.conversation,
      activeMemberIds: input.activeMemberIds,
      record,
      preview,
      senderId,
      senderName,
    }));
  } catch (error) {
    // Write failed after the claim — release the claim so the next
    // retry can claim fresh. Best-effort: the takeover path above
    // heals any residual dangling claim.
    if (clientKey) {
      connectUpdate(CONNECT_DB_ROOT, { [`conversations/${conversationId}/clientKeys/${clientKey}`]: null })
        .catch(() => undefined);
    }
    throw error;
  }

  const [view] = await attachReplyPreviews(conversationId, [record]);
  return { status: 'created', message: view };
}

// ─── Pagination ────────────────────────────────────────────────

export interface MessagePage {
  /** Ascending by push key (oldest → newest within the page). */
  messages: MessageView[];
  /** true when older history exists beyond this page. */
  hasOlder: boolean;
  /** The oldest key in this page (client stores it for "load older"). */
  oldestKey: string | null;
  /** The newest key in this page (the sync cursor). */
  newestKey: string | null;
}

/**
 * Newest page: key-ordered limitToLast(pageSize+1) — bounded, never a
 * full conversation load (§SPEC-6/§SPEC-17).
 */
export async function getLatestMessagePage(
  conversationId: string,
  pageSize: number = MESSAGE_PAGE_SIZE,
): Promise<MessagePage> {
  const size = Math.min(Math.max(1, pageSize), MESSAGE_PAGE_SIZE_MAX);
  const rows = await connectQuery<MessageRecord>(messagesRoot(conversationId), {
    orderBy: 'key',
    limitToLast: size + 1,
  });
  const hasOlder = rows.length > size;
  const page = hasOlder ? rows.slice(1) : rows;
  const records = page.map((r) => r.value);
  const messages = await attachReplyPreviews(conversationId, records);
  return {
    messages,
    hasOlder,
    oldestKey: page.length > 0 ? page[0].key : null,
    newestKey: page.length > 0 ? page[page.length - 1].key : null,
  };
}

/**
 * Older page BEFORE `beforeKey` (inclusive bound — the cursor itself
 * is fetched then dropped, since RTDB startAt/endAt are inclusive).
 */
export async function getOlderMessagePage(
  conversationId: string,
  beforeKey: string,
  pageSize: number = MESSAGE_PAGE_SIZE,
): Promise<MessagePage> {
  if (!beforeKey || typeof beforeKey !== 'string' || beforeKey.length > 128) {
    throw new MessageValidationError('مؤشر التصفح غير صالح');
  }
  const size = Math.min(Math.max(1, pageSize), MESSAGE_PAGE_SIZE_MAX);
  const rows = await connectQuery<MessageRecord>(messagesRoot(conversationId), {
    orderBy: 'key',
    endAt: beforeKey,
    limitToLast: size + 1,
  });
  // Drop the inclusive cursor (already on the client).
  const filtered = rows.filter((r) => r.key !== beforeKey);
  const hasOlder = rows.length > size;
  const page = hasOlder ? filtered.slice(filtered.length - size) : filtered;
  const records = page.map((r) => r.value);
  const messages = await attachReplyPreviews(conversationId, records);
  return {
    messages,
    hasOlder,
    oldestKey: page.length > 0 ? page[0].key : null,
    newestKey: page.length > 0 ? page[page.length - 1].key : null,
  };
}

// ─── Edit / delete / purge ─────────────────────────────────────

/**
 * §EDIT-POLICY — the author may edit their own, non-deleted message
 * within EDIT_WINDOW_MS. Nobody else (admins included) may rewrite
 * another person's words; admins have DELETE instead. Edits refresh
 * the conversation preview when the edited message is the newest.
 */
export async function editMessage(
  conversationId: string,
  actorId: string,
  messageId: string,
  newBody: string,
): Promise<MessageView> {
  const bodyCheck = validateMessageBody(newBody);
  if (!bodyCheck.ok) throw new MessageValidationError(bodyCheck.error);

  const record = await loadMessage(conversationId, messageId);
  if (!record) throw new AccessDeniedError('not_found', 'الرسالة غير موجودة');
  if (record.deletedAt) throw new MessageValidationError('لا يمكن تعديل رسالة محذوفة');
  if (record.senderUserId !== actorId) {
    throw new AccessDeniedError('forbidden', 'يمكن تعديل رسائلك فقط');
  }
  if (record.createdAtMs + EDIT_WINDOW_MS < Date.now()) {
    throw new MessageValidationError('انتهت المدة المسموح بها لتعديل الرسالة');
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const wasLast = (await connectGet<string>(`${CONVERSATIONS_PATH}/${conversationId}/lastMessageId`)) === messageId;
  const preview = bodyCheck.body.slice(0, 120);

  const map: Record<string, unknown> = {
    [`conversations/${conversationId}/messages/${messageId}/body`]: bodyCheck.body,
    [`conversations/${conversationId}/messages/${messageId}/editedAt`]: now,
    [`conversations/${conversationId}/messages/${messageId}/updatedAtMs`]: nowMs,
  };
  if (wasLast) {
    map[`conversations/${conversationId}/lastMessagePreview`] = preview;
    for (const uid of await loadActiveMemberIds(conversationId)) {
      map[`userConversations/${uid}/${conversationId}/lastMessagePreview`] = preview;
    }
  }
  await connectUpdate(CONNECT_DB_ROOT, map);

  return toMessageView({ ...record, body: bodyCheck.body, editedAt: now, updatedAtMs: nowMs });
}

/** Active member ids of a conversation (small node read). */
export async function loadActiveMemberIds(conversationId: string): Promise<string[]> {
  const value = await connectGet<Record<string, ConversationMember>>(`${CONVERSATIONS_PATH}/${conversationId}/members`);
  if (!value) return [];
  return Object.values(value).filter((m) => m && !m.leftAt).map((m) => m.userId);
}

/**
 * §DELETION — two logical modes (§SPEC-9):
 *  tombstone: author or group owner/admin. The body is SCRUBBED from
 *             the database in the same update that stamps deletedAt —
 *             the content is unrecoverable through the API.
 *  purge:     system administrators only (route-gated); removes the
 *             record entirely. Audit keeps METADATA only.
 */
export async function deleteMessageTombstone(
  conversationId: string,
  actorId: string,
  messageId: string,
  ctx: MembershipContext,
): Promise<MessageView> {
  const record = await loadMessage(conversationId, messageId);
  if (!record) throw new AccessDeniedError('not_found', 'الرسالة غير موجودة');

  const isAuthor = record.senderUserId === actorId;
  const isAdminOfConversation = ctx.member.role === 'owner' || ctx.member.role === 'admin';
  if (!isAuthor && !isAdminOfConversation) {
    throw new AccessDeniedError('forbidden', 'لا تملك صلاحية حذف هذه الرسالة');
  }
  if (record.deletedAt) {
    // Idempotent delete — return the existing tombstone.
    return toMessageView(record);
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const wasLast = (await connectGet<string>(`${CONVERSATIONS_PATH}/${conversationId}/lastMessageId`)) === messageId;

  const map: Record<string, unknown> = {
    [`conversations/${conversationId}/messages/${messageId}/body`]: '',
    [`conversations/${conversationId}/messages/${messageId}/deletedAt`]: now,
    [`conversations/${conversationId}/messages/${messageId}/deletedBy`]: actorId,
    [`conversations/${conversationId}/messages/${messageId}/updatedAtMs`]: nowMs,
    // Mentions/refs die with the content (no notifications from dead text).
    [`conversations/${conversationId}/messages/${messageId}/mentions`]: null,
    [`conversations/${conversationId}/messages/${messageId}/references`]: null,
  };
  if (wasLast) {
    map[`conversations/${conversationId}/lastMessagePreview`] = null;
    for (const uid of await loadActiveMemberIds(conversationId)) {
      map[`userConversations/${uid}/${conversationId}/lastMessagePreview`] = null;
    }
  }
  await connectUpdate(CONNECT_DB_ROOT, map);

  return toMessageView({ ...record, body: '', deletedAt: now, deletedBy: actorId, updatedAtMs: nowMs });
}

/** Permanent deletion — metadata-only audit, no content recovery claim. */
export async function purgeMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const record = await loadMessage(conversationId, messageId);
  if (!record) throw new AccessDeniedError('not_found', 'الرسالة غير موجودة');

  const wasLast = (await connectGet<string>(`${CONVERSATIONS_PATH}/${conversationId}/lastMessageId`)) === messageId;
  const map: Record<string, unknown> = {
    [`conversations/${conversationId}/messages/${messageId}`]: null,
  };
  if (wasLast) {
    // Reset the conversation cursor to the newest remaining message
    // (bounded scan for the previous key).
    const rows = await connectQuery<MessageRecord>(messagesRoot(conversationId), {
      orderBy: 'key', endAt: messageId, limitToLast: 2,
    });
    const prev = rows.filter((r) => r.key !== messageId).pop();
    map[`conversations/${conversationId}/lastMessageId`] = prev?.key ?? null;
    map[`conversations/${conversationId}/lastMessageAt`] = prev?.value.createdAtMs ?? null;
    map[`conversations/${conversationId}/lastMessagePreview`] = prev?.value.deletedAt ? null : (prev?.value.body ?? '').slice(0, 120) || null;
    for (const uid of await loadActiveMemberIds(conversationId)) {
      map[`userConversations/${uid}/${conversationId}/lastMessageId`] = prev?.key ?? null;
      map[`userConversations/${uid}/${conversationId}/lastMessageAt`] = prev?.value.createdAtMs ?? null;
      map[`userConversations/${uid}/${conversationId}/lastMessagePreview`] = prev?.value.deletedAt ? null : (prev?.value.body ?? '').slice(0, 120) || null;
    }
  }
  // Release the idempotency claim (the key becomes reusable).
  if (record.clientKey) {
    map[`conversations/${conversationId}/clientKeys/${record.clientKey}`] = null;
  }
  // Pinned entries referencing the purged message die with it.
  map[`conversations/${conversationId}/pinned/${messageId}`] = null;

  await connectUpdate(CONNECT_DB_ROOT, map);
}

// ─── Pins ──────────────────────────────────────────────────────

/**
 * §PIN-POLICY — group/department: owner/admin pins (shared pins are
 * an administration tool). Direct: either participant. Members see
 * pins; nobody pins silently for others.
 */
export async function setMessagePinned(
  conversationId: string,
  actorId: string,
  messageId: string,
  pinned: boolean,
  ctx: MembershipContext,
): Promise<void> {
  const record = await loadMessage(conversationId, messageId);
  if (!record) throw new AccessDeniedError('not_found', 'الرسالة غير موجودة');

  if (ctx.conversation.type !== 'direct') {
    if (ctx.member.role !== 'owner' && ctx.member.role !== 'admin') {
      throw new AccessDeniedError('forbidden', 'التثبيت متاح لمالك أو مشرف المجموعة');
    }
  }

  const value = pinned
    ? { pinnedBy: actorId, pinnedAt: nowIso(), excerpt: (record.body ?? '').slice(0, 140), senderUserId: record.senderUserId, senderName: record.senderName }
    : null;
  await connectUpdate(pinnedPath(conversationId), { [messageId]: value });
}

export async function listPinnedMessages(conversationId: string): Promise<{ messageId: string; pinnedBy: string; pinnedAt: string; excerpt: string | null; senderName: string | null }[]> {
  const node = await connectGet<Record<string, { pinnedBy: string; pinnedAt: string; excerpt: string | null; senderUserId: string; senderName: string | null }>>(pinnedPath(conversationId));
  if (!node) return [];
  return Object.entries(node)
    .filter(([, v]) => v && typeof v.pinnedAt === 'string')
    .map(([messageId, v]) => ({
      messageId,
      pinnedBy: v.pinnedBy,
      pinnedAt: v.pinnedAt,
      excerpt: v.excerpt ?? null,
      senderName: v.senderName ?? null,
    }))
    .sort((a, b) => (a.pinnedAt < b.pinnedAt ? 1 : -1));
}

// ─── In-conversation search ────────────────────────────────────

export interface ConversationSearchResult {
  messages: MessageView[];
  /** How many of the newest messages were scanned (bounded). */
  scannedCount: number;
  /** true when the scan window did NOT cover the full history. */
  partialCoverage: boolean;
}

/**
 * §SEARCH — RTDB has no full-text index; search is a BOUNDED
 * server-side scan of the newest SEARCH_SCAN_LIMIT messages
 * (one key-ordered query), filtered by case-insensitive substring.
 * Membership is enforced by the caller. The full history is NEVER
 * loaded into the browser — only SEARCH_RESULT_LIMIT matches travel
 * to the client (§SPEC-13).
 */
export async function searchConversationMessages(
  conversationId: string,
  query: string,
): Promise<ConversationSearchResult> {
  const q = query.trim().toLowerCase();
  const rows = await connectQuery<MessageRecord>(messagesRoot(conversationId), {
    orderBy: 'key',
    limitToLast: SEARCH_SCAN_LIMIT,
  });
  const matches = rows
    .filter((r) => !r.value.deletedAt && typeof r.value.body === 'string')
    .filter((r) => r.value.body.toLowerCase().includes(q))
    .reverse()
    .slice(0, SEARCH_RESULT_LIMIT);

  const messages = await attachReplyPreviews(conversationId, matches.map((r) => r.value));
  return {
    messages,
    scannedCount: rows.length,
    partialCoverage: rows.length >= SEARCH_SCAN_LIMIT,
  };
}

// ─── Sender identity helper (routes) ───────────────────────────

/** Fresh display name for the authenticated sender (snapshot on send). */
export async function resolveSenderName(userId: string): Promise<string | null> {
  const user = await getById<Record<string, unknown>>('users', userId);
  return (user?.name as string | undefined) ?? null;
}

/**
 * Guard used by routes: load membership context for send-time needs
 * (active member ids for the index write map + mention filter).
 */
export async function loadSendContext(conversationId: string, userId: string): Promise<{
  ctx: MembershipContext;
  activeMemberIds: string[];
}> {
  const ctx = await requireActiveMembership(conversationId, userId);
  const activeMemberIds = await loadActiveMemberIds(conversationId);
  return { ctx, activeMemberIds };
}

// Re-exports for routes.
export { requireActiveMembership, AccessDeniedError };
export type { ConversationRecord, UserConversationIndex };
