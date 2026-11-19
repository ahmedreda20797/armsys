// src/lib/__tests__/connect-merge-paths-avatars.test.ts
// ══════════════════════════════════════════════════════════════
//  §RTDB-MERGE-PATHS + §AVATAR-LIST — 1.0.2 regression contracts
//
//  1. The RTDB fake now mirrors the REAL SDK's merge-path validation:
//     an update() map must not contain a path that is an ancestor of
//     another path in the same map. This is the EXACT production 500
//     ("values argument contains a path X that is ancestor of another
//     path X/members/uid") that the 1.0 lenient fake hid.
//  2. Direct/group conversation creation writes members EMBEDDED in
//     the conversation node (single path) — proven by asserting the
//     members exist after creation through the normal API flow.
//  3. The conversation list carries the other participant's existing
//     profile picture (avatarUrl) for direct conversations.
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData, setTable, fakeDb } from './connect-test-support';
import { connectFakeDb } from './connect-rtdb-fake';
import { CONVERSATIONS_PATH, CONNECT_DB_ROOT } from '@/lib/connect/constants';

import { GET as listConversations, POST as createConversation } from '@/app/api/connect/conversations/route';

let users: ReturnType<typeof seedUsers>;
let tokens: Record<string, string>;

before(async () => {
  users = seedUsers();
  tokens = {
    admin: await tokenFor(users.admin),
    rana: await tokenFor(users.rana),
    omar: await tokenFor(users.omar),
  };
});

beforeEach(() => {
  resetConnectData();
  users = seedUsers();
});

describe('§RTDB-MERGE-PATHS — the fake enforces the real update() contract', () => {
  it('rejects an update map where one path is an ANCESTOR of another (the production 500)', async () => {
    const ref = connectFakeDb.ref('arm_erp/connect/conversations');
    await assert.rejects(
      ref.update({
        conv_1: { id: 'conv_1', title: 'x' },
        'conv_1/members/usr_a': { userId: 'usr_a', role: 'member' },
      }),
      /values argument contains a path \/arm_erp\/connect\/conversations\/conv_1 that is ancestor of another path \/arm_erp\/connect\/conversations\/conv_1\/members\/usr_a/,
      'the exact real-RTDB ancestor/descendant rejection',
    );
  });

  it('rejects descendant-before-ancestor ordering too (order-independent)', async () => {
    const ref = connectFakeDb.ref('arm_erp/x');
    await assert.rejects(
      ref.update({ 'a/b': 1, a: 2 }),
      /ancestor of another path/,
    );
  });

  it('still accepts SIBLING paths and null deletions (normal traffic unaffected)', async () => {
    const ref = connectFakeDb.ref('arm_erp/y');
    await ref.update({ 'a/b': 1, 'a/c': 2, d: 3, e: null }); // no overlaps
    assert.deepEqual(
      { b: 1, c: 2 },
      connectFakeDb.dump('arm_erp/y/a') as Record<string, number>,
      'siblings under a stay intact',
    );
    assert.equal(connectFakeDb.dump('arm_erp/y/d'), 3, 'sibling of a lands at its own path');
    assert.equal(connectFakeDb.dump('arm_erp/y/e'), null, 'null deletes');
  });

  it('a rejected update writes NOTHING (atomic client-side validation)', async () => {
    const ref = connectFakeDb.ref('arm_erp/z');
    await assert.rejects(ref.update({ ok: 1, 'ok/nested': 2 }), /ancestor of another path/);
    assert.equal(connectFakeDb.dump('arm_erp/z/ok'), null, 'no partial write');
  });
});

describe('§RTDB-MERGE-PATHS — conversation creation is real-RTDB-legal', () => {
  it('direct creation stores members EMBEDDED in the conversation node', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: users.omar.id,
      }) as never,
    );
    assert.equal(res.status, 201, 'creation succeeds (the ancestor/descendant map is gone)');
    const convId = ((await res.json()).data as { id: string }).id;

    const members = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/members`) as Record<string, { userId: string; role: string }>;
    assert.ok(members, 'members node exists beneath the single-path conversation write');
    assert.equal(members[users.rana.id]?.userId, users.rana.id);
    assert.equal(members[users.omar.id]?.userId, users.omar.id);
    assert.equal(members[users.rana.id]?.role, 'member');
  });

  it('group creation stores members EMBEDDED (creator = owner) without overlapping paths', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'فريق', memberUserIds: [users.omar.id],
      }) as never,
    );
    assert.equal(res.status, 201);
    const convId = ((await res.json()).data as { id: string }).id;
    const members = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/members`) as Record<string, { role: string }>;
    assert.equal(members[users.rana.id]?.role, 'owner');
    assert.equal(members[users.omar.id]?.role, 'member');
  });
});

describe('§AVATAR-LIST — the conversation list carries the other participant’s picture', () => {
  it('direct rows expose avatarUrl from the canonical photoURL; groups → null', async () => {
    // loadUserProfiles reads via getById('users') — the REGISTERED map.
    const DATA_URL = 'data:image/webp;base64,AAAA';
    const { registerUser } = await import('./connect-test-support');
    registerUser({ id: users.omar.id, name: users.omar.name, email: users.omar.email, role: users.omar.role, photoURL: DATA_URL, isSuspended: false });

    const direct = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: users.omar.id,
      }) as never,
    );
    const directId = ((await direct.json()).data as { id: string }).id;

    const group = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'فريق بلا صورة', memberUserIds: [users.laila.id],
      }) as never,
    );
    const groupId = ((await group.json()).data as { id: string }).id;

    const list = await listConversations(
      jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.rana) as never,
    );
    assert.equal(list.status, 200);
    const rows = ((await list.json()).data as { id: string; type: string; avatarUrl: string | null }[]);
    const directRow = rows.find((r) => r.id === directId);
    const groupRow = rows.find((r) => r.id === groupId);
    assert.equal(directRow?.avatarUrl, DATA_URL, "the other participant's existing picture resolves");
    assert.equal(groupRow?.avatarUrl, null, 'group rows have no participant picture');
    assert.equal(fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.omar.id}/${directId}`) !== null, true,
      'both members keep their index entries');
  });

  it('a direct row without a picture carries avatarUrl null (initials fallback)', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: users.omar.id,
      }) as never,
    );
    const convId = ((await res.json()).data as { id: string }).id;
    const list = await listConversations(
      jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.rana) as never,
    );
    const row = ((await list.json()).data as { id: string; avatarUrl: string | null }[]).find((r) => r.id === convId);
    assert.equal(row?.avatarUrl, null);
  });
});
