// src/lib/__tests__/connect-sync.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0 — SYNC, DELIVERY MARKING & NOTIFICATION BRIDGE
//
//  Incremental sync (only NEW messages after the cursor; edits come
//  through updatedMessages), delivered-cursor advancement, unread
//  bounded counting, and the notification volume policy (direct
//  messages deduped in a window; mentions per-message; group
//  messages silent except mentions; muted recipients skipped).
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData, fakeDb, createdRecords, waitFor } from './connect-test-support';
import { CONVERSATIONS_PATH } from '@/lib/connect/constants';

import { POST as createConversation } from '@/app/api/connect/conversations/route';
import { POST as sendMessageRoute } from '@/app/api/connect/conversations/[conversationId]/messages/route';
import { GET as syncRoute } from '@/app/api/connect/conversations/[conversationId]/sync/route';
import { GET as listConversations } from '@/app/api/connect/conversations/route';
import { PATCH as editMessageRoute, DELETE as deleteMessageRoute } from '@/app/api/connect/conversations/[conversationId]/messages/[messageId]/route';

let users: ReturnType<typeof seedUsers>;
let tokens: Record<string, string>;

before(async () => {
  users = seedUsers();
  tokens = {
    admin: await tokenFor(users.admin),
    rana: await tokenFor(users.rana),
    omar: await tokenFor(users.omar),
    laila: await tokenFor(users.laila),
  };
});

beforeEach(() => {
  resetConnectData();
  seedUsers();
});

async function createDirect(): Promise<string> {
  const res = await createConversation(
    jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
      type: 'direct', otherUserId: users.omar.id,
    }) as never,
  );
  return (await res.json()).data.id as string;
}

async function createGroup(): Promise<string> {
  const res = await createConversation(
    jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
      type: 'group', title: 'مجموعة الإشعارات', memberUserIds: [users.omar.id, users.laila.id],
    }) as never,
  );
  return (await res.json()).data.id as string;
}

async function send(conversationId: string, token: string, body: string, extra: Record<string, unknown> = {}) {
  return sendMessageRoute(
    jsonRequest('POST', getUrl(`/api/connect/conversations/${conversationId}/messages`), token, { body, ...extra }) as never,
    { params: Promise.resolve({ conversationId }) } as never,
  );
}

describe('Incremental sync', () => {
  it('returns ONLY messages after the cursor; delivered cursor advances', async () => {
    const convId = await createDirect();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await send(convId, tokens.rana, `م${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }
    ids.sort();

    // omar syncs with cursor = first message.
    const res = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[0])}&sinceMs=0`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()).data;
    const newIds = payload.newMessages.map((m: { id: string }) => m.id);
    assert.deepEqual(newIds, [ids[1], ids[2]], 'strictly after the cursor, ascending');
    assert.equal(payload.cursor, ids[2]);

    // Delivered cursor advanced for omar (readState node).
    const readState = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/readState/${users.omar.id}`) as { lastDeliveredMessageId: string };
    assert.equal(readState.lastDeliveredMessageId, ids[2]);
  });

  it('first sync without a cursor returns nothing new (initial page owns history)', async () => {
    const convId = await createDirect();
    await send(convId, tokens.rana, 'أهلاً');
    const res = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const payload = (await res.json()).data;
    assert.equal(payload.newMessages.length, 0);
    assert.ok(payload.cursor);
  });

  it('edits and tombstones flow through updatedMessages (not newMessages)', async () => {
    const convId = await createDirect();
    const send1 = await send(convId, tokens.rana, 'الأصلية');
    const id = ((await send1.json()).data.message.id) as string;

    // omar syncs (delivers everything up to id).
    await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(id)}&sinceMs=0`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );

    // Author edits, then tombstones.
    await editMessageRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.rana, { body: 'النص الجديد' }) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );

    const res = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(id)}&sinceMs=1`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const payload = (await res.json()).data;
    assert.equal(payload.newMessages.length, 0);
    assert.equal(payload.updatedMessages.length, 1);
    const updated = payload.updatedMessages[0];
    assert.equal(updated.id, id);
    assert.equal(updated.body, null, 'tombstone body never leaves the server');
    assert.ok(updated.deletedAt);
  });

  it('§SYNC-CONTINUATION — >100 new messages paginate by SERVED cursor; nothing is skipped', async () => {
    const convId = await createDirect();
    const total = 130;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      const res = await send(convId, tokens.rana, `رسالة ${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }
    ids.sort();

    // Round 1: from the first message — cap 100 served.
    const r1 = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[0])}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const p1 = (await r1.json()).data;
    const got1 = p1.newMessages.map((m: { id: string }) => m.id);
    assert.equal(got1.length, 100, 'capped at SYNC_NEW_MESSAGES_MAX');
    assert.deepEqual(got1, ids.slice(1, 101), 'the FIRST 100 after the cursor, ascending');
    // The cursor advances ONLY to the last SERVED message — never to
    // the conversation's newest (that was the 1.0 overshoot bug).
    assert.equal(p1.cursor, ids[100]);
    // Delivery stamped to what was SERVED, not beyond it.
    const rs1 = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/readState/${users.omar.id}`) as { lastDeliveredMessageId: string };
    assert.equal(rs1.lastDeliveredMessageId, ids[100]);

    // Round 2: continue from the served cursor — the remaining 29.
    const r2 = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(p1.cursor)}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const p2 = (await r2.json()).data;
    const got2 = p2.newMessages.map((m: { id: string }) => m.id);
    assert.deepEqual(got2, ids.slice(101), 'the rest arrive in the next round — NO GAP');
    assert.equal(p2.cursor, ids[total - 1]);

    // Round 3: fully caught up — nothing new.
    const r3 = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(p2.cursor)}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const p3 = (await r3.json()).data;
    assert.equal(p3.newMessages.length, 0);
  });

  it('§SYNC-CONTINUATION — >100 updated messages continue via updatedCursorMs; no missed edits', async () => {
    const convId = await createDirect();
    const total = 120;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      const res = await send(convId, tokens.rana, `أصل ${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }
    ids.sort();

    // Deliver everything first (omar caught up to the newest).
    await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[total - 1])}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );

    // Edit every message (client sends its serverTimeMs as sinceMs).
    const editStart = Date.now();
    for (const id of ids) {
      await editMessageRoute(
        jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.rana, { body: `معدلة ${id}` }) as never,
        { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
      );
    }

    // Round 1 (sinceMs = pre-edit server time) → capped at 100 updates.
    const r1 = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[total - 1])}&sinceMs=${editStart}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const p1 = (await r1.json()).data;
    assert.equal(p1.updatedMessages.length, 100, 'capped at SYNC_UPDATED_MESSAGES_MAX');
    assert.ok(p1.updatedCursorMs !== null && p1.updatedCursorMs !== undefined, 'an updated cursor is returned');
    assert.ok(p1.updatedCursorKey, 'the composite cursor carries the tie-break key');

    // Round 2 (client echoes the composite cursor) → the remaining edits.
    const r2 = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[total - 1])}&sinceMs=${p1.updatedCursorMs}&sinceKey=${encodeURIComponent(p1.updatedCursorKey)}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const p2 = (await r2.json()).data;
    assert.ok(p2.updatedMessages.length >= 1, 'the truncated remainder continues next round');

    // NO MISSED EDITS: round1 + round2 cover every edited id (dedup
    // makes overlap harmless).
    const served = new Set<string>([
      ...p1.updatedMessages.map((m: { id: string }) => m.id),
      ...p2.updatedMessages.map((m: { id: string }) => m.id),
    ]);
    for (const id of ids) {
      assert.ok(served.has(id), `edit of ${id} must reach the client`);
    }

    // Round 3: monotonic — nothing further is returned.
    const r3 = await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[total - 1])}&sinceMs=${p2.updatedCursorMs}&sinceKey=${encodeURIComponent(p2.updatedCursorKey ?? '')}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const p3 = (await r3.json()).data;
    assert.equal(p3.updatedMessages.length, 0, 'fully processed window returns nothing');
  });

  it('§SYNC-CONTINUATION — a same-millisecond burst larger than the cap neither stalls nor skips', async () => {
    // Pathological but contract-critical: edits sharing ONE exact
    // millisecond with a group bigger than the sync cap. The window
    // widens (bounded) and the composite (ms,key) cursor walks the
    // whole tie group without re-serving or stalling.
    const convId = await createDirect();
    const total = 110;
    const ids: string[] = [];
    for (let i = 0; i < total; i++) {
      const res = await send(convId, tokens.rana, `أصل ${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }
    ids.sort();
    await syncRoute(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[total - 1])}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );

    // Patch the fake clock: every edit stamps the SAME updatedAtMs.
    // The edit route reads Date.now() — freeze it just for the edits.
    const realNow = Date.now;
    const frozenMs = realNow() + 5_000;
    Date.now = () => frozenMs;
    try {
      for (const id of ids) {
        await editMessageRoute(
          jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.rana, { body: `معدلة ${id}` }) as never,
          { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
        );
      }
    } finally {
      Date.now = realNow;
    }

    const servedIds = new Set<string>();
    let sinceMs = frozenMs - 1;
    let sinceKey = '';
    for (let round = 0; round < 5; round++) {
      const res = await syncRoute(
        jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync?cursor=${encodeURIComponent(ids[total - 1])}&sinceMs=${sinceMs}&sinceKey=${encodeURIComponent(sinceKey)}`), tokens.omar) as never,
        { params: Promise.resolve({ conversationId: convId }) } as never,
      );
      const payload = (await res.json()).data;
      for (const m of payload.updatedMessages as { id: string }[]) servedIds.add(m.id);
      if (payload.updatedCursorMs === sinceMs && payload.updatedCursorKey === sinceKey) break;
      sinceMs = payload.updatedCursorMs;
      sinceKey = payload.updatedCursorKey ?? '';
    }
    assert.equal(servedIds.size, total, 'every same-ms edit reached the client across rounds');
  });
});

describe('Unread counts (bounded)', () => {
  it('unread count reflects messages after the read cursor; mark-read resets it', async () => {
    const convId = await createDirect();
    for (let i = 0; i < 4; i++) {
      await send(convId, tokens.rana, `unread ${i}`);
    }
    const list = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.omar) as never);
    const conv = ((await list.json()).data as { id: string; unreadCount: number }[]).find((c) => c.id === convId);
    assert.equal(conv?.unreadCount, 4);

    // omar opens the conversation → mark read via the read endpoint.
    const { POST: markReadRoute } = await import('@/app/api/connect/conversations/[conversationId]/read/route');
    await markReadRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), tokens.omar, {}) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const list2 = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.omar) as never);
    const conv2 = ((await list2.json()).data as { id: string; unreadCount: number }[]).find((c) => c.id === convId);
    assert.equal(conv2?.unreadCount, 0);
  });

  it('§UNREAD-SELF — the sender’s own message never counts as unread for the sender', async () => {
    const convId = await createDirect();
    for (let i = 0; i < 3; i++) {
      await send(convId, tokens.rana, `رسالتي ${i}`);
    }
    const list = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.rana) as never);
    const ranaRow = ((await list.json()).data as { id: string; unreadCount: number }[]).find((c) => c.id === convId);
    assert.equal(ranaRow?.unreadCount, 0, 'the sender has seen their own messages by definition');

    // The recipient still counts them.
    const listOmar = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.omar) as never);
    const omarRow = ((await listOmar.json()).data as { id: string; unreadCount: number }[]).find((c) => c.id === convId);
    assert.equal(omarRow?.unreadCount, 3, 'the recipient’s badge is unaffected');
  });
});

describe('Notification bridge — volume policy', () => {
  const notifsOf = () => createdRecords.filter((r) => r.table === 'notifications');

  it('direct message notifies the other member with a deep link; window dedups the second message', async () => {
    const convId = await createDirect();
    await send(convId, tokens.rana, 'أهلاً عمر');
    await waitFor(() => notifsOf().some((n) => n.data.title?.startsWith('رسالة جديدة')));
    let notifs = notifsOf().filter((n) => n.data.title?.startsWith('رسالة جديدة'));
    assert.equal(notifs.length, 1);
    assert.deepEqual(notifs[0].data.recipientUserIds, [users.omar.id]);
    assert.equal(notifs[0].data.sourceModule, 'connect');
    assert.equal(notifs[0].data.targetPage, 'connect');
    assert.equal(notifs[0].data.navParams.conversationId, convId);

    // Second message inside the dedup window → NO new notification.
    await send(convId, tokens.rana, 'رسالة ثانية');
    await new Promise((r) => setTimeout(r, 150));
    notifs = notifsOf().filter((n) => n.data.title?.startsWith('رسالة جديدة'));
    assert.equal(notifs.length, 1, 'window dedup suppressed the duplicate');
  });

  it('group message is silent; a mention notifies the mentioned member', async () => {
    const convId = await createGroup();
    await send(convId, tokens.rana, 'رسالة عادية للمجموعة');
    await new Promise((r) => setTimeout(r, 150));
    // Group creation notifies ADDED members ('تمت إضافتك'); a plain
    // group message must NOT create a 'رسالة جديدة' broadcast.
    assert.equal(
      notifsOf().filter((n) => n.data.title?.startsWith('رسالة جديدة')).length, 0,
      'no broadcast for group messages',
    );

    await send(convId, tokens.rana, 'تنبيه', { mentions: [users.laila.id] });
    await waitFor(() => notifsOf().some((n) => n.data.title?.includes('أشار إليك')));
    const mentionNotifs = notifsOf().filter((n) => n.data.title?.includes('أشار إليك'));
    assert.equal(mentionNotifs.length, 1);
    assert.ok(mentionNotifs[0].data.recipientUserIds?.includes(users.laila.id));
    assert.equal(mentionNotifs[0].data.priority, 'high');
  });

  it('mentioned NON-members are never notified (already dropped at send)', async () => {
    const convId = await createGroup();
    await send(convId, tokens.rana, 'إشارة شبح', { mentions: ['usr_ghost'] });
    await new Promise((r) => setTimeout(r, 200));
    const ghostNotifs = notifsOf().filter((n) => n.data.recipientUserIds?.includes('usr_ghost'));
    assert.equal(ghostNotifs.length, 0);
  });

  it('adding members notifies them (added_to_group)', async () => {
    const { POST: addMembersRoute } = await import('@/app/api/connect/conversations/[conversationId]/members/route');
    const convId = await createGroup();
    const res = await addMembersRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/members`), tokens.rana, { userIds: [users.admin.id] }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 201);
    await waitFor(() => notifsOf().some((n) => n.data.recipientUserIds?.includes(users.admin.id)));
    const added = notifsOf().filter((n) => n.data.recipientUserIds?.includes(users.admin.id));
    assert.equal(added.length, 1);
    assert.ok(added[0].data.title.includes('تمت إضافتك'));
  });
});

describe('Sync policy + client merge (pure helpers)', () => {
  it('hidden tabs never poll; overlap guard blocks concurrent rounds; backoff grows', async () => {
    const { shouldPollNow, mayStartSyncRound, activePollIntervalMs } = await import('@/lib/connect/sync-policy');
    assert.equal(shouldPollNow({ isVisible: false, lastPollAt: null, now: 1000, intervalMs: 10_000 }), false);
    assert.equal(shouldPollNow({ isVisible: true, lastPollAt: null, now: 1000, intervalMs: 10_000 }), true);
    assert.equal(shouldPollNow({ isVisible: true, lastPollAt: 0, now: 9_999, intervalMs: 10_000 }), false);
    assert.equal(shouldPollNow({ isVisible: true, lastPollAt: 0, now: 10_000, intervalMs: 10_000 }), true);

    assert.equal(mayStartSyncRound({ hasPendingRound: true, lastRoundFinishedAt: null, now: 0 }), false);
    assert.equal(mayStartSyncRound({ hasPendingRound: false, lastRoundFinishedAt: 1000, now: 2000 }), false);
    assert.equal(mayStartSyncRound({ hasPendingRound: false, lastRoundFinishedAt: 1000, now: 4000 }), true);

    assert.equal(activePollIntervalMs(0), 10_000);
    assert.equal(activePollIntervalMs(1), 20_000);
    assert.equal(activePollIntervalMs(3), 80_000);
    assert.equal(activePollIntervalMs(10), 80_000, 'capped at 8x');
  });

  it('applySyncPayload merges new+updated without duplicates and advances the cursor forward only', async () => {
    const { applySyncPayload, makeInitialCache } = await import('@/lib/connect/client-merge');
    const cache = makeInitialCache(
      [{ id: 'a', conversationId: 'c', senderUserId: 'u', senderName: null, body: 'أ', replyToId: null, replyPreview: null, mentions: null, references: null, editedAt: null, deletedAt: null, createdAt: '', createdAtMs: 1 }],
      false, 'a', 'a',
    );
    const payload = {
      conversationId: 'c',
      newMessages: [
        { id: 'b', conversationId: 'c', senderUserId: 'u', senderName: null, body: 'ب', replyToId: null, replyPreview: null, mentions: null, references: null, editedAt: null, deletedAt: null, createdAt: '', createdAtMs: 2 },
      ],
      updatedMessages: [
        // Same id 'a' with an edit → replaces in place.
        { id: 'a', conversationId: 'c', senderUserId: 'u', senderName: null, body: 'أ معدلة', replyToId: null, replyPreview: null, mentions: null, references: null, editedAt: 'now', deletedAt: null, createdAt: '', createdAtMs: 1 },
      ],
      cursor: 'b',
      typing: [],
      pinnedMessageIds: [],
      serverTimeMs: 5,
    };
    const next = applySyncPayload(cache, payload as never);
    assert.equal(next.messages.length, 2);
    assert.equal(next.messages[0].body, 'أ معدلة');
    assert.equal(next.cursor, 'b');

    // A SLOWER sync carrying an older cursor must not regress it.
    const stale = applySyncPayload(next, { ...payload, cursor: 'a', newMessages: [], updatedMessages: [] } as never);
    assert.equal(stale.cursor, 'b', 'cursor never regresses');
  });

  it('§SYNC-CONTINUATION — the cache persists updatedCursorMs/syncedAtMs monotonically (client echoes sinceMs)', async () => {
    const { applySyncPayload, makeInitialCache } = await import('@/lib/connect/client-merge');
    const cache = makeInitialCache([], false, null, null);
    assert.equal(cache.updatedCursorMs, null);
    assert.equal(cache.syncedAtMs, null);

    // Round 1: server time only (no updated window ran yet).
    const afterServerTime = applySyncPayload(cache, {
      conversationId: 'c', newMessages: [], updatedMessages: [],
      cursor: null, updatedCursorMs: null, typing: [], pinnedMessageIds: [], serverTimeMs: 1000,
    } as never);
    assert.equal(afterServerTime.syncedAtMs, 1000);
    assert.equal(afterServerTime.updatedCursorMs, null);

    // Round 2: the server processed updates up to 2500 → stored.
    const afterUpdates = applySyncPayload(afterServerTime, {
      conversationId: 'c', newMessages: [], updatedMessages: [],
      cursor: null, updatedCursorMs: 2500, typing: [], pinnedMessageIds: [], serverTimeMs: 2000,
    } as never);
    assert.equal(afterUpdates.updatedCursorMs, 2500);
    assert.equal(afterUpdates.syncedAtMs, 2000, 'updatedCursorMs wins the sinceMs echo (more precise)');

    // A stale round can never regress either cursor.
    const stale = applySyncPayload(afterUpdates, {
      conversationId: 'c', newMessages: [], updatedMessages: [],
      cursor: null, updatedCursorMs: 1200, typing: [], pinnedMessageIds: [], serverTimeMs: 1500,
    } as never);
    assert.equal(stale.updatedCursorMs, 2500, 'updatedCursorMs never regresses');
    assert.equal(stale.syncedAtMs, 2000, 'syncedAtMs never regresses');
  });
});
