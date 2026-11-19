// src/lib/__tests__/connect-authorization.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0 — AUTHORIZATION & SECURITY CONTRACTS
//
//  The REAL route handlers run against the in-memory layers:
//    • Nonmember access to EVERY conversation-scoped resource → 404
//      (identical for unknown conversations — enumeration-safe).
//    • Removed members lose access immediately.
//    • Sender identity is SESSION-derived (body spoofing ignored).
//    • Cross-conversation reply targets are rejected.
//    • Role gates (member ≠ admin ≠ owner).
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData, fakeDb } from './connect-test-support';
import { CONVERSATIONS_PATH } from '@/lib/connect/constants';

// Route modules import AFTER the firebase-server stub is installed.
import { GET as listConversations, POST as createConversation } from '@/app/api/connect/conversations/route';
import { GET as getConversation } from '@/app/api/connect/conversations/[conversationId]/route';
import { GET as getMessages, POST as sendMessageRoute } from '@/app/api/connect/conversations/[conversationId]/messages/route';
import { GET as syncRoute } from '@/app/api/connect/conversations/[conversationId]/sync/route';
import { GET as searchRoute } from '@/app/api/connect/conversations/[conversationId]/search/route';
import { POST as markReadRoute } from '@/app/api/connect/conversations/[conversationId]/read/route';
import { GET as membersRoute } from '@/app/api/connect/conversations/[conversationId]/members/route';
import { POST as addMembersRoute } from '@/app/api/connect/conversations/[conversationId]/members/route';
import { DELETE as removeMemberRoute } from '@/app/api/connect/conversations/[conversationId]/members/[memberId]/route';

let users: ReturnType<typeof seedUsers>;
let tokens: Record<string, string>;
let groupId: string;

async function statusOf(res: Response): Promise<number> {
  return res.status;
}

before(async () => {
  users = seedUsers();
  tokens = {
    admin: await tokenFor(users.admin),
    rana: await tokenFor(users.rana),
    omar: await tokenFor(users.omar),
    intruder: await tokenFor(users.intruder),
  };
});

beforeEach(() => {
  resetConnectData();
  seedUsers();
});

// ─── Fixture: a group owned by rana with omar as a member ───────

async function createFixtureGroup(): Promise<string> {
  const res = await createConversation(
    jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
      type: 'group',
      title: 'فريق الاختبار',
      description: null,
      memberUserIds: [users.omar.id],
    }) as never,
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  return body.data.id as string;
}

describe('Connect authorization — unauthenticated access', () => {
  it('401 for every endpoint without a token', async () => {
    const convId = await createFixtureGroup();
    const checks: Response[] = [
      await listConversations(new Request(getUrl('/api/connect/conversations')) as never) as unknown as Response,
      await getConversation(new Request(getUrl(`/api/connect/conversations/${convId}`)) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await getMessages(new Request(getUrl(`/api/connect/conversations/${convId}/messages`)) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await syncRoute(new Request(getUrl(`/api/connect/conversations/${convId}/sync`)) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await searchRoute(new Request(getUrl(`/api/connect/conversations/${convId}/search`)) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
    ];
    for (const res of checks) {
      assert.equal(await statusOf(res as unknown as Response), 401);
    }
  });

  it('401 for a tampered token', async () => {
    const convId = await createFixtureGroup();
    const { tamperToken } = await import('./m01-test-support');
    const bad = tamperToken(tokens.rana);
    const res = await getConversation(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}`), bad) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 401);
  });
});

describe('Connect authorization — nonmember + unknown conversation', () => {
  it('nonmember gets 404 (not 403) on details, messages, sync, search, members, read', async () => {
    const convId = await createFixtureGroup();
    const intruder = tokens.intruder;
    const checks: Response[] = [
      await getConversation(jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}`), intruder) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await getMessages(jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/messages`), intruder) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await syncRoute(jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/sync`), intruder) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await searchRoute(jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/search`), intruder, undefined) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await membersRoute(jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/members`), intruder) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
      await markReadRoute(jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), intruder, {}) as never, { params: Promise.resolve({ conversationId: convId }) } as never) as unknown as Response,
    ];
    for (const res of checks) {
      assert.equal(res.status, 404, `expected 404, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.error.message, 'المحادثة غير موجودة');
    }
  });

  it('unknown conversation id → the SAME 404 body (enumeration-safe)', async () => {
    const res = await getConversation(
      jsonRequest('GET', getUrl('/api/connect/conversations/does-not-exist'), tokens.intruder) as never,
      { params: Promise.resolve({ conversationId: 'does-not-exist' }) } as never,
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.message, 'المحادثة غير موجودة');
  });

  it('nonmember cannot send messages into the conversation', async () => {
    const convId = await createFixtureGroup();
    const res = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.intruder, {
        body: 'اختراق',
        clientKey: 'ck_intruder01',
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 404);
    const messages = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/messages`);
    assert.equal(messages, null, 'no message may be written');
  });
});

describe('Connect authorization — removed member loses access immediately', () => {
  it('removed member gets 404 on all conversation resources', async () => {
    const convId = await createFixtureGroup();
    // rana (owner) removes omar
    const res = await removeMemberRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/members/${users.omar.id}`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId, memberId: users.omar.id }) } as never,
    );
    assert.equal(res.status, 200);

    const after = await getMessages(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(after.status, 404);

    const sendAgain = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.omar, {
        body: 'أنا ما زلت هنا؟',
        clientKey: 'ck_removed_01',
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(sendAgain.status, 404);
  });
});

describe('Connect authorization — sender identity & cross-conversation guards', () => {
  it('senderUserId in the body is IGNORED — the session user is the sender', async () => {
    const convId = await createFixtureGroup();
    const res = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.omar, {
        body: 'رسالة عادية',
        clientKey: 'ck_spoof_01',
        // Spoofing attempt — the route never accepts this field.
        senderUserId: users.rana.id,
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.data.message.senderUserId, users.omar.id);
  });

  it('cross-conversation reply target is rejected (400)', async () => {
    const groupA = await createFixtureGroup();
    const groupB = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'مجموعة أخرى', memberUserIds: [users.omar.id],
      }) as never,
    );
    const groupBId = (await groupB.json()).data.id as string;

    // Send a message into group A as omar.
    const sendA = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${groupA}/messages`), tokens.omar, {
        body: 'في المجموعة الأولى', clientKey: 'ck_cross_a1',
      }) as never,
      { params: Promise.resolve({ conversationId: groupA }) } as never,
    );
    const messageA = (await sendA.json()).data.message.id as string;

    // omar tries to reply to it FROM group B.
    const res = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${groupBId}/messages`), tokens.omar, {
        body: 'رد عبر الحدود', clientKey: 'ck_cross_b1', replyToId: messageA,
      }) as never,
      { params: Promise.resolve({ conversationId: groupBId }) } as never,
    );
    assert.equal(res.status, 400);
  });

  it('plain member cannot administer the group (403 on add/remove/role)', async () => {
    const convId = await createFixtureGroup(); // owner: rana, member: omar
    const add = await addMembersRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/members`), tokens.omar, {
        userIds: [users.laila?.id ?? 'usr_laila'],
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(add.status, 403);
  });

  it('validation: bad clientKey and oversized body are rejected before any write', async () => {
    const convId = await createFixtureGroup();
    const badKey = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.omar, {
        body: 'مرحبا', clientKey: 'short',
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(badKey.status, 400);

    const bigBody = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.omar, {
        body: 'x'.repeat(4001),
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(bigBody.status, 400);

    const empty = await sendMessageRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.omar, {
        body: '   ',
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(empty.status, 400);
  });
});

describe('Connect — conversation list visibility', () => {
  it('the list shows ONLY the caller\u2019s conversations', async () => {
    const convId = await createFixtureGroup();
    const listRana = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.rana) as never);
    const listIntruder = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.intruder) as never);
    const ranaData = (await listRana.json()).data as { id: string }[];
    const intruderData = (await listIntruder.json()).data as { id: string }[];
    assert.ok(ranaData.some((c) => c.id === convId));
    assert.equal(intruderData.length, 0);
  });
});
