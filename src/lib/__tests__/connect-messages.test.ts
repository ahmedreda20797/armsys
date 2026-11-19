// src/lib/__tests__/connect-messages.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0 — MESSAGE FUNCTIONALITY CONTRACTS
//
//  Send (ordering + atomic view updates), reply previews, §EDIT-POLICY
//  (author-only, inside the window), tombstone deletion (body scrubbed
//  from the database), permanent deletion (system-admin only), mention
//  member-filtering, internal record reference validation, and pinned
//  messages.
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData, setTable, fakeDb, createdRecords } from './connect-test-support';
import { CONVERSATIONS_PATH, CONNECT_DB_ROOT } from '@/lib/connect/constants';

import { POST as createConversation } from '@/app/api/connect/conversations/route';
import { POST as sendMessageRoute } from '@/app/api/connect/conversations/[conversationId]/messages/route';
import { GET as getMessages } from '@/app/api/connect/conversations/[conversationId]/messages/route';
import { PATCH as editMessageRoute, DELETE as deleteMessageRoute } from '@/app/api/connect/conversations/[conversationId]/messages/[messageId]/route';
import { POST as togglePinRoute } from '@/app/api/connect/conversations/[conversationId]/pins/route';

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

async function createGroup(title = 'رسائل'): Promise<string> {
  const res = await createConversation(
    jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
      type: 'group', title, memberUserIds: [users.omar.id],
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

describe('Sending messages', () => {
  let convId: string;
  beforeEach(async () => { convId = await createGroup(); });

  it('send → 201 with a push-key id; conversation cursor + member index update atomically', async () => {
    const res = await send(convId, tokens.rana, 'الرسالة الأولى');
    assert.equal(res.status, 201);
    const message = (await res.json()).data.message;

    assert.ok(message.id.startsWith('-k'), 'message id is a push key');
    assert.equal(message.body, 'الرسالة الأولى');
    assert.equal(message.senderUserId, users.rana.id);
    assert.ok(message.senderName);

    const conv = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}`) as { lastMessageId: string; lastMessagePreview: string };
    assert.equal(conv.lastMessageId, message.id);
    assert.ok(conv.lastMessagePreview.includes('الرسالة الأولى'));

    const omarIdx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.omar.id}/${convId}`) as { lastMessageId: string };
    assert.equal(omarIdx.lastMessageId, message.id);
  });

  it('stable ordering: consecutive sends sort chronologically by key', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await send(convId, tokens.rana, `رسالة ${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1], 'later sends have larger keys');
    }
    const page = await getMessages(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const messages = (await page.json()).data.messages as { id: string; body: string }[];
    assert.deepEqual(messages.map((m) => m.id), ids.slice().sort());
    assert.equal(messages[4].body, 'رسالة 4');
  });

  it('reply stores the reply and serves a bounded preview', async () => {
    const first = await send(convId, tokens.rana, 'الأصلية');
    const firstId = ((await first.json()).data.message.id) as string;
    const reply = await send(convId, tokens.omar, 'رد على الأصلية', { replyToId: firstId });
    const replyBody = (await reply.json()).data.message;
    assert.equal(replyBody.replyToId, firstId);
    assert.equal(replyBody.replyPreview.id, firstId);
    assert.equal(replyBody.replyPreview.excerpt, 'الأصلية');
  });

  it('mentions of NON-members are dropped (never notified, never stored)', async () => {
    const res = await send(convId, tokens.rana, 'إشارة لشبح', { mentions: ['usr_ghost'] });
    const message = (await res.json()).data.message;
    assert.equal(message.mentions, null);
  });

  it('mentions of active members are stored', async () => {
    const res = await send(convId, tokens.rana, 'تنبيه @عمر', { mentions: [users.omar.id] });
    const message = (await res.json()).data.message;
    assert.deepEqual(message.mentions, [users.omar.id]);
  });

  it('internal record references must EXIST in their table (400 otherwise)', async () => {
    setTable('employees', [{ id: 'emp_1', name: 'موظف موجود' }]);
    const bad = await send(convId, tokens.rana, 'ارتباط شبح', {
      references: [{ type: 'employee', id: 'emp_ghost' }],
    });
    assert.equal(bad.status, 400);

    const good = await send(convId, tokens.rana, 'ارتباط صحيح', {
      references: [{ type: 'employee', id: 'emp_1', title: 'موظف موجود' }],
    });
    assert.equal(good.status, 201);
    const message = (await good.json()).data.message;
    assert.equal(message.references?.[0]?.id, 'emp_1');

    const unsupported = await send(convId, tokens.rana, 'نوع غير مدعوم', {
      references: [{ type: 'payroll', id: 'x' }],
    });
    assert.equal(unsupported.status, 400);
  });
});

describe('§EDIT-POLICY', () => {
  let convId: string;
  let messageId: string;
  beforeEach(async () => {
    convId = await createGroup();
    const res = await send(convId, tokens.omar, 'النص الأصلي');
    messageId = ((await res.json()).data.message.id) as string;
  });

  it('the author may edit their own message; editedAt + previews refresh', async () => {
    const res = await editMessageRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/messages/${messageId}`), tokens.omar, { body: 'النص المعدل' }) as never,
      { params: Promise.resolve({ conversationId: convId, messageId }) } as never,
    );
    assert.equal(res.status, 200);
    const updated = (await res.json()).data;
    assert.equal(updated.body, 'النص المعدل');
    assert.ok(updated.editedAt);

    // The conversation preview refreshed because it is the newest message.
    const conv = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}`) as { lastMessagePreview: string };
    assert.ok(conv.lastMessagePreview.includes('المعدل'));
  });

  it('NOBODY may edit another person\u2019s message (owner included)', async () => {
    const res = await editMessageRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/messages/${messageId}`), tokens.rana, { body: 'التحريف' }) as never,
      { params: Promise.resolve({ conversationId: convId, messageId }) } as never,
    );
    assert.equal(res.status, 403);
    const record = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/messages/${messageId}`) as { body: string };
    assert.equal(record.body, 'النص الأصلي');
  });
});

describe('§DELETION — tombstone', () => {
  let convId: string;
  beforeEach(async () => { convId = await createGroup(); });

  it('author tombstones own message: body scrubbed from the DB, tombstone served', async () => {
    const send1 = await send(convId, tokens.omar, 'سأحذفها');
    const id = ((await send1.json()).data.message.id) as string;
    const res = await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    assert.equal(res.status, 200);
    const view = (await res.json()).data;
    assert.equal(view.body, null);
    assert.ok(view.deletedAt);

    const record = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/messages/${id}`) as { body: string; deletedAt: string };
    assert.equal(record.body, '', 'the body is scrubbed from the database');
    assert.ok(record.deletedAt);
  });

  it('conversation owner may tombstone a member\u2019s message; plain member cannot', async () => {
    const send1 = await send(convId, tokens.omar, 'رسالة عمر');
    const id = ((await send1.json()).data.message.id) as string;

    // laila is not even a member → 404
    const stranger = await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.laila) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    assert.equal(stranger.status, 404);

    // omar (plain member) tries to delete rana's message → 403
    const ranaMsg = await send(convId, tokens.rana, 'رسالة رنا');
    const ranaId = ((await ranaMsg.json()).data.message.id) as string;
    const memberTry = await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${ranaId}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: ranaId }) } as never,
    );
    assert.equal(memberTry.status, 403);

    // rana (owner) deletes omar's message → 200
    const ownerOk = await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    assert.equal(ownerOk.status, 200);
  });
});

describe('§DELETION — permanent purge (system admin only)', () => {
  let convId: string;
  beforeEach(async () => { convId = await createGroup(); });

  it('non-admin (even conversation owner) cannot purge — 403', async () => {
    const send1 = await send(convId, tokens.rana, 'للحذف النهائي');
    const id = ((await send1.json()).data.message.id) as string;
    const res = await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}?mode=purge`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    assert.equal(res.status, 403);
    const record = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/messages/${id}`);
    assert.ok(record, 'record untouched');
  });

  it('system admin purges: record GONE, conversation cursor reset, clientKey released', async () => {
    const send1 = await send(convId, tokens.omar, 'للحذف النهائي', { clientKey: 'ck_purge_01' });
    const id = ((await send1.json()).data.message.id) as string;
    const send2 = await send(convId, tokens.omar, 'الرسالة الأخيرة');
    const lastId = ((await send2.json()).data.message.id) as string;

    const res = await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}?mode=purge`), tokens.admin) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    assert.equal(res.status, 200);

    const gone = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/messages/${id}`);
    assert.equal(gone, null);
    const conv = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}`) as { lastMessageId: string };
    assert.equal(conv.lastMessageId, lastId);
    const claim = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/clientKeys/ck_purge_01`);
    assert.equal(claim, null, 'idempotency claim released');
  });
});

describe('Pinned messages', () => {
  let convId: string;
  beforeEach(async () => { convId = await createGroup(); });

  it('owner pins/unpins; plain member cannot pin (group policy)', async () => {
    const send1 = await send(convId, tokens.rana, 'مهم للتثبيت');
    const id = ((await send1.json()).data.message.id) as string;

    const memberTry = await togglePinRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/pins`), tokens.omar, { messageId: id, pinned: true }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(memberTry.status, 403);

    const ownerPin = await togglePinRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/pins`), tokens.rana, { messageId: id, pinned: true }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(ownerPin.status, 200);
    const pinned = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/pinned/${id}`);
    assert.ok(pinned);

    const unpin = await togglePinRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/pins`), tokens.rana, { messageId: id, pinned: false }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(unpin.status, 200);
    const after = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/pinned`);
    assert.equal(after, null);
  });
});

describe('Audit trail', () => {
  it('sensitive actions land in connectAuditLog WITHOUT message content', async () => {
    const convId = await createGroup('مجموعة التدقيق');
    const send1 = await send(convId, tokens.omar, 'رسالة حساسة نوعاً ما');
    const id = ((await send1.json()).data.message.id) as string;
    await editMessageRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.omar, { body: 'نص معدل' }) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );
    await deleteMessageRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/messages/${id}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId, messageId: id }) } as never,
    );

    const auditRows = createdRecords.filter((r) => r.table === 'connectAuditLog');
    const actions = auditRows.map((r) => r.data.action);
    assert.ok(actions.includes('message_edit'));
    assert.ok(actions.includes('message_delete'));
    // No message content anywhere in the audit records.
    for (const row of auditRows) {
      assert.ok(!JSON.stringify(row.data).includes('رسالة حساسة'));
      assert.ok(!JSON.stringify(row.data).includes('نص معدل'));
    }
  });
});
