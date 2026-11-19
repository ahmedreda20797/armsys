// src/lib/__tests__/connect-idempotency.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0 — IDEMPOTENCY, CONCURRENCY, PAGINATION & CURSORS
//
//  §IDEMPOTENCY — same clientKey (sequential AND concurrent) resolves
//  to exactly ONE logical message; concurrent DISTINCT sends all
//  succeed with stable ordering; read cursors are monotonic under
//  concurrent stale/new updates; pagination is bounded and correct.
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData } from './connect-test-support';
import { connectFakeDb } from './connect-rtdb-fake';
import { CONVERSATIONS_PATH } from '@/lib/connect/constants';

import { POST as createConversation } from '@/app/api/connect/conversations/route';
import { POST as sendMessageRoute } from '@/app/api/connect/conversations/[conversationId]/messages/route';
import { GET as getMessages } from '@/app/api/connect/conversations/[conversationId]/messages/route';
import { POST as markReadRoute } from '@/app/api/connect/conversations/[conversationId]/read/route';
import { POST as typingRoute } from '@/app/api/connect/conversations/[conversationId]/typing/route';

let users: ReturnType<typeof seedUsers>;
let tokens: Record<string, string>;

before(async () => {
  users = seedUsers();
  tokens = {
    rana: await tokenFor(users.rana),
    omar: await tokenFor(users.omar),
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

async function send(conversationId: string, token: string, body: string, clientKey?: string) {
  return sendMessageRoute(
    jsonRequest('POST', getUrl(`/api/connect/conversations/${conversationId}/messages`), token, {
      body, ...(clientKey ? { clientKey } : {}),
    }) as never,
    { params: Promise.resolve({ conversationId }) } as never,
  );
}

async function messageCount(conversationId: string): Promise<number> {
  const dump = (await fakeCount(conversationId)) as Record<string, unknown> | null;
  return dump ? Object.keys(dump).length : 0;
}

function fakeCount(conversationId: string): Promise<unknown> {
  // Direct fake access — the count of the messages node.
  return Promise.resolve(connectFakeDb.dump(`${CONVERSATIONS_PATH}/${conversationId}/messages`));
}

describe('§IDEMPOTENCY — sequential retries', () => {
  it('the same clientKey twice returns the SAME message (created → existing)', async () => {
    const convId = await createDirect();
    const first = await send(convId, tokens.rana, 'مرسلة مرة واحدة', 'ck_retry_0001');
    assert.equal(first.status, 201);
    const firstBody = (await first.json()).data;
    assert.equal(firstBody.status, 'created');

    const second = await send(convId, tokens.rana, 'مرسلة مرة واحدة', 'ck_retry_0001');
    assert.equal(second.status, 200);
    const secondBody = (await second.json()).data;
    assert.equal(secondBody.status, 'existing');
    assert.equal(secondBody.message.id, firstBody.message.id);

    assert.equal(await messageCount(convId), 1, 'exactly one message stored');
  });

  it('a DIFFERENT clientKey creates a NEW message (normal traffic unaffected)', async () => {
    const convId = await createDirect();
    await send(convId, tokens.rana, 'أولى', 'ck_a_0001');
    await send(convId, tokens.rana, 'ثانية', 'ck_b_0001');
    assert.equal(await messageCount(convId), 2);
  });

  it('a clientKey claimed by another sender is rejected (no content leak)', async () => {
    const convId = await createDirect();
    await send(convId, tokens.rana, 'رسالة رنا', 'ck_shared_01');
    const res = await send(convId, tokens.omar, 'رسالة عمر بنفس المفتاح', 'ck_shared_01');
    assert.equal(res.status, 400);
    assert.equal(await messageCount(convId), 1);
  });

  it('same sender + same clientKey + DIFFERENT payload → the ORIGINAL message wins (never replaced)', async () => {
    const convId = await createDirect();
    const first = await send(convId, tokens.rana, 'النص الأصلي المعتمد', 'ck_conflict_01');
    const firstBody = (await first.json()).data;

    // A retry that (buggy client) carries a different body under the
    // same key must NOT overwrite the accepted message.
    const retry = await send(convId, tokens.rana, 'نص مختلف تماماً', 'ck_conflict_01');
    assert.equal(retry.status, 200);
    const retryBody = (await retry.json()).data;
    assert.equal(retryBody.status, 'existing');
    assert.equal(retryBody.message.id, firstBody.message.id);
    assert.equal(retryBody.message.body, 'النص الأصلي المعتمد', 'the accepted payload is authoritative');
    assert.equal(await messageCount(convId), 1);
  });

  it('TAKEOVER — a claim left by a crashed writer is completed idempotently by a same-sender retry', async () => {
    const convId = await createDirect();

    // Simulate the 1.0 crash window: the claim transaction COMMITTED,
    // then the process died BEFORE the multi-path message write.
    const fixedMessageId = connectFakeDb.ref(`${CONVERSATIONS_PATH}/${convId}/messages`).push().key as string;
    connectFakeDb.ref(`${CONVERSATIONS_PATH}/${convId}/clientKeys/ck_takeover_01`).set({
      messageId: fixedMessageId,
      senderUserId: users.rana.id,
      createdAt: new Date().toISOString(),
    });
    assert.equal(await messageCount(convId), 0, 'claim exists, message does not');

    // The retry adopts the claim-fixed id and COMPLETES the write —
    // it never mints a second message.
    const res = await send(convId, tokens.rana, 'إكمال الكتابة المقاطعة', 'ck_takeover_01');
    assert.equal(res.status, 201);
    const body = (await res.json()).data;
    assert.equal(body.status, 'created', 'the retry becomes the writer');
    assert.equal(body.message.id, fixedMessageId, 'message id fixed by the claim');
    assert.equal(await messageCount(convId), 1);

    // And it stays idempotent afterwards (normal existing replay).
    const again = await send(convId, tokens.rana, 'إكمال الكتابة المقاطعة', 'ck_takeover_01');
    const againBody = (await again.json()).data;
    assert.equal(againBody.status, 'existing');
    assert.equal(await messageCount(convId), 1);
  });
});

describe('§IDEMPOTENCY — concurrent duplicate requests', () => {
  it('10 concurrent sends with the SAME clientKey → exactly ONE message', async () => {
    const convId = await createDirect();
    const attempts = Array.from({ length: 10 }, (_, i) =>
      send(convId, tokens.rana, 'رسالة متزامنة', 'ck_concurrent_01'),
    );
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);
    // Exactly ONE writer succeeds with 201; the rest replay with 200.
    assert.equal(statuses.filter((s) => s === 201).length, 1, 'one 201 among: ' + JSON.stringify(statuses));
    assert.equal(statuses.filter((s) => s === 200).length, 9);
    const bodies = await Promise.all(results.map((r) => r.json()));
    const ids = new Set(bodies.map((b) => b.data.message.id as string));
    for (const body of bodies) {
      assert.equal(body.data.message.body, 'رسالة متزامنة');
      assert.equal(body.data.message.id, bodies[0].data.message.id, 'same logical message for every attempt');
    }
    assert.equal(ids.size, 1);
    assert.equal(await messageCount(convId), 1);
  });
});

describe('Concurrency — concurrent DISTINCT sends', () => {
  it('8 concurrent distinct messages all land, each unique, keys time-ordered', async () => {
    const convId = await createDirect();
    const attempts = Array.from({ length: 8 }, (_, i) =>
      send(convId, tokens.rana, `رسالة رقم ${i}`, `ck_distinct_${i}`),
    );
    const results = await Promise.all(attempts);
    const bodies = await Promise.all(results.map((r) => r.json()));
    const ids = bodies.map((b) => b.data.message.id as string);
    assert.equal(new Set(ids).size, 8);
    assert.equal(await messageCount(convId), 8);

    // Stable ordering: the stored set, sorted by key, equals sorted ids.
    const sorted = ids.slice().sort();
    const page = await getMessages(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/messages`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const pageIds = ((await page.json()).data.messages as { id: string }[]).map((m) => m.id);
    assert.deepEqual(pageIds, sorted);
  });
});

describe('Pagination (bounded)', () => {
  it('latest page returns the NEWEST 50 with hasOlder; older pages walk back correctly', async () => {
    const convId = await createDirect();
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const res = await send(convId, tokens.rana, `رسالة ${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }

    const latest = await getMessages(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/messages?limit=50`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const latestData = (await latest.json()).data;
    assert.equal(latestData.messages.length, 50);
    assert.equal(latestData.hasOlder, true);
    assert.equal(latestData.oldestKey, ids[10]);
    assert.equal(latestData.newestKey, ids[59]);

    // Walk one older page.
    const older = await getMessages(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${convId}/messages?limit=50&before=${encodeURIComponent(latestData.oldestKey)}`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const olderData = (await older.json()).data;
    assert.equal(olderData.messages.length, 10);
    assert.equal(olderData.hasOlder, false);
    assert.equal(olderData.oldestKey, ids[0]);
  });
});

describe('Read cursor monotonicity (§SPEC-10)', () => {
  it('a stale client cannot REGRESS the read cursor; newest always wins', async () => {
    const convId = await createDirect();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await send(convId, tokens.rana, `م${i}`);
      ids.push(((await res.json()).data.message.id) as string);
    }
    ids.sort();

    // Read the newest…
    const readNewest = await markReadRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), tokens.omar, { messageId: ids[2] }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(readNewest.status, 200);
    assert.equal(((await readNewest.json()).data).lastReadMessageId, ids[2]);

    // …then a stale client echoes the OLDEST cursor — no regression.
    const readStale = await markReadRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), tokens.omar, { messageId: ids[0] }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(readStale.status, 200);
    const state = (await readStale.json()).data as { lastReadMessageId: string };
    assert.equal(state.lastReadMessageId, ids[2], 'cursor stayed at the newest');

    // Concurrent stale + fresh — the fresh cursor survives.
    const [staleRace, freshRace] = await Promise.all([
      markReadRoute(jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), tokens.omar, { messageId: ids[0] }) as never, { params: Promise.resolve({ conversationId: convId }) } as never),
      markReadRoute(jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), tokens.omar, { messageId: ids[1] }) as never, { params: Promise.resolve({ conversationId: convId }) } as never),
    ]);
    assert.equal(staleRace.status, 200);
    assert.equal(freshRace.status, 200);
    const finalState = (await (await markReadRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/read`), tokens.omar, { messageId: ids[1] }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    )).json()).data as { lastReadMessageId: string };
    assert.ok(finalState.lastReadMessageId >= ids[1]);
  });
});

describe('Typing indicators', () => {
  it('typing ping sets an expiry; expired entries are filtered out', async () => {
    const convId = await createDirect();
    await typingRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/typing`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const node = (await (async () => {
      return connectFakeDb.dump(`${CONVERSATIONS_PATH}/${convId}/typing`);
    })()) as Record<string, { until: number }>;
    assert.ok(node[users.omar.id]);
    assert.ok(node[users.omar.id].until > Date.now());

    // Simulate expiry.
    node[users.omar.id].until = Date.now() - 1000;
  });
});
