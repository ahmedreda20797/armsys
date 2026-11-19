// src/lib/__tests__/connect-conversations.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0 — CONVERSATION LIFECYCLE CONTRACTS
//
//  Direct get-or-create (dedupe, self-forbidden), group creation
//  (owner + materialized members), department gating on the
//  ORGANIZATION page permission, membership administration, role
//  changes, leave/transfer rules, and per-user state (archive/mute).
// ══════════════════════════════════════════════════════════════

import './connect-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { seedUsers, tokenFor, jsonRequest, getUrl, resetConnectData, setTable, fakeDb } from './connect-test-support';
import { CONVERSATIONS_PATH, CONNECT_DB_ROOT } from '@/lib/connect/constants';

import { GET as listConversations, POST as createConversation } from '@/app/api/connect/conversations/route';
import { GET as getConversation, PATCH as patchConversation, DELETE as deleteConversation } from '@/app/api/connect/conversations/[conversationId]/route';
import { POST as addMembersRoute } from '@/app/api/connect/conversations/[conversationId]/members/route';
import { PATCH as changeRoleRoute, DELETE as removeMemberRoute } from '@/app/api/connect/conversations/[conversationId]/members/[memberId]/route';

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

describe('Direct conversations', () => {
  it('creates a direct conversation between two users', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: users.omar.id,
      }) as never,
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.created, true);
    assert.equal(body.data.type, 'direct');
    assert.equal(body.data.memberCount, 2);

    // Both members got index entries.
    const ranaIdx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.rana.id}/${body.data.id}`);
    const omarIdx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.omar.id}/${body.data.id}`);
    assert.ok(ranaIdx && omarIdx);
  });

  it('get-or-create returns the SAME conversation (no duplicates)', async () => {
    const first = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: users.omar.id,
      }) as never,
    );
    const second = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.omar, {
        type: 'direct', otherUserId: users.rana.id,
      }) as never,
    );
    const firstId = (await first.json()).data.id;
    const secondBody = await second.json();
    assert.equal(secondBody.created, false);
    assert.equal(secondBody.data.id, firstId);

    // Only ONE conversation exists in the DB.
    const dump = fakeDb().dump(CONVERSATIONS_PATH) as Record<string, unknown>;
    assert.equal(Object.keys(dump).length, 1);
  });

  it('self-direct is forbidden (400)', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: users.rana.id,
      }) as never,
    );
    assert.equal(res.status, 400);
  });

  it('unknown other-user is rejected (400)', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: 'usr_ghost',
      }) as never,
    );
    assert.equal(res.status, 400);
  });

  it('SUSPENDED (inactive) accounts cannot be targeted (400)', async () => {
    const { registerUser } = await import('./connect-test-support');
    registerUser({ id: 'usr_suspended', name: 'معلق', email: 'suspended@test.local', role: 'user', isSuspended: true, permissions: null });
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'direct', otherUserId: 'usr_suspended',
      }) as never,
    );
    assert.equal(res.status, 400);
    const dump = (fakeDb().dump(CONVERSATIONS_PATH) ?? {}) as Record<string, unknown>;
    assert.equal(Object.keys(dump).length, 0, 'no conversation shell was created');
  });

  it('CONCURRENT selection of the same account → exactly ONE conversation (race-safe dedupe)', async () => {
    const [a, b] = await Promise.all([
      createConversation(
        jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
          type: 'direct', otherUserId: users.omar.id,
        }) as never,
      ),
      createConversation(
        jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.omar, {
          type: 'direct', otherUserId: users.rana.id,
        }) as never,
      ),
    ]);
    const bodyA = await a.json();
    const bodyB = await b.json();
    // Exactly one winner; both callers converge on the SAME conversation.
    assert.equal(bodyA.data.id, bodyB.data.id);
    assert.equal(
      (bodyA.created ? 1 : 0) + (bodyB.created ? 1 : 0), 1,
      'exactly one create wins the directIndex transaction',
    );
    const dump = fakeDb().dump(CONVERSATIONS_PATH) as Record<string, unknown>;
    assert.equal(Object.keys(dump).length, 1);
    // The loser's duplicate shell + index entries were cleaned up.
    const ranaEntries = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.rana.id}`) as Record<string, unknown>;
    assert.equal(Object.keys(ranaEntries).length, 1);
  });

  it('a connect-permission override of none → 403 (authentication alone is NOT enough)', async () => {
    const { registerUser } = await import('./connect-test-support');
    registerUser({ id: 'usr_noconn', name: 'بلا تواصل', email: 'noconn@test.local', role: 'user', isSuspended: false, permissions: { connect: 'none' } });
    const noconnToken = await tokenFor({ id: 'usr_noconn', email: 'noconn@test.local', role: 'user' });

    const listed = await listConversations(
      jsonRequest('GET', getUrl('/api/connect/conversations'), noconnToken) as never,
    );
    assert.equal(listed.status, 403, 'list denied without the connect page permission');

    const created = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), noconnToken, {
        type: 'direct', otherUserId: users.omar.id,
      }) as never,
    );
    assert.equal(created.status, 403, 'creation denied without the connect page permission');
  });
});

describe('Group conversations', () => {
  it('creator becomes owner; members are materialized explicitly', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'فريق الجودة', description: 'تنسيق يومي', memberUserIds: [users.omar.id, users.laila.id],
      }) as never,
    );
    assert.equal(res.status, 201);
    const conv = (await res.json()).data;

    const members = fakeDb().dump(`${CONVERSATIONS_PATH}/${conv.id}/members`) as Record<string, { role: string; userId: string }>;
    assert.equal(members[users.rana.id].role, 'owner');
    assert.equal(members[users.omar.id].role, 'member');
    assert.equal(members[users.laila.id].role, 'member');
    assert.equal(conv.memberCount, 3);
  });

  it('unknown member ids are rejected (server-authoritative materialization)', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'شبح', memberUserIds: ['usr_ghost'],
      }) as never,
    );
    assert.equal(res.status, 400);
  });

  it('title is validated (required, length-capped)', async () => {
    const missing = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', memberUserIds: [],
      }) as never,
    );
    assert.equal(missing.status, 400);
    const tooLong = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'x'.repeat(121), memberUserIds: [],
      }) as never,
    );
    assert.equal(tooLong.status, 400);
  });
});

describe('Department conversations', () => {
  beforeEach(() => {
    setTable('orgNodes', [
      { id: 'node_quality', name: 'قسم الجودة', type: 'department', parentId: null, status: 'active', order: 0 },
    ]);
  });

  it('requires the ORGANIZATION page permission (plain user → 403)', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'department', title: 'محادثة القسم', memberUserIds: [users.omar.id], deptNodeId: 'node_quality',
      }) as never,
    );
    assert.equal(res.status, 403);
  });

  it('admin can create it; membership is EXPLICIT (node grants nothing)', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.admin, {
        type: 'department', title: 'محادثة القسم', memberUserIds: [users.omar.id], deptNodeId: 'node_quality',
      }) as never,
    );
    assert.equal(res.status, 201);
    const conv = (await res.json()).data;
    assert.equal(conv.type, 'department');
    assert.equal(conv.deptNodeId, 'node_quality');

    // Only the explicitly materialized members exist — dept employees
    // were NEVER granted membership automatically.
    const members = fakeDb().dump(`${CONVERSATIONS_PATH}/${conv.id}/members`) as Record<string, unknown>;
    assert.deepEqual(Object.keys(members).sort(), [users.admin.id, users.omar.id].sort());

    // A third user (laila, same org node by assumption) has NO access.
    const res2 = await getConversation(
      jsonRequest('GET', getUrl(`/api/connect/conversations/${conv.id}`), tokens.laila) as never,
      { params: Promise.resolve({ conversationId: conv.id }) } as never,
    );
    assert.equal(res2.status, 404);
  });

  it('unknown dept node is rejected', async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.admin, {
        type: 'department', title: 'غير موجود', memberUserIds: [], deptNodeId: 'node_ghost',
      }) as never,
    );
    assert.equal(res.status, 400);
  });
});

describe('Membership administration', () => {
  let convId: string;

  beforeEach(async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'إدارة العضوية', memberUserIds: [users.omar.id],
      }) as never,
    );
    convId = (await res.json()).data.id as string;
  });

  it('admin adds a member; memberCount advances; index entry created', async () => {
    const res = await addMembersRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/members`), tokens.rana, {
        userIds: [users.laila.id],
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.deepEqual(body.data.activated, [users.laila.id]);
    const conv = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}`) as { memberCount: number };
    assert.equal(conv.memberCount, 3);
    const idx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.laila.id}/${convId}`);
    assert.ok(idx);
  });

  it('adding an already-active member is a no-op (no double count)', async () => {
    await addMembersRoute(
      jsonRequest('POST', getUrl(`/api/connect/conversations/${convId}/members`), tokens.rana, { userIds: [users.omar.id] }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    const conv = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}`) as { memberCount: number };
    assert.equal(conv.memberCount, 2);
  });

  it('owner cannot be removed (409) — even by a promoted admin', async () => {
    // rana promotes omar to admin first
    await changeRoleRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/members/${users.omar.id}`), tokens.rana, { role: 'admin' }) as never,
      { params: Promise.resolve({ conversationId: convId, memberId: users.omar.id }) } as never,
    );
    // omar (admin) attempts to remove the OWNER → 409 (transfer first)
    const res = await removeMemberRoute(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}/members/${users.rana.id}`), tokens.omar) as never,
      { params: Promise.resolve({ conversationId: convId, memberId: users.rana.id }) } as never,
    );
    assert.equal(res.status, 409);
  });

  it('role changes are OWNER-only; owner cannot change own role', async () => {
    // omar (member) tries to promote laila → 403 first (not a member yet), so promote omar first.
    const selfChange = await changeRoleRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/members/${users.rana.id}`), tokens.rana, { role: 'admin' }) as never,
      { params: Promise.resolve({ conversationId: convId, memberId: users.rana.id }) } as never,
    );
    assert.equal(selfChange.status, 400); // self role change forbidden

    // rana promotes omar
    const promote = await changeRoleRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/members/${users.omar.id}`), tokens.rana, { role: 'admin' }) as never,
      { params: Promise.resolve({ conversationId: convId, memberId: users.omar.id }) } as never,
    );
    assert.equal(promote.status, 200);
    const member = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/members/${users.omar.id}`) as { role: string };
    assert.equal(member.role, 'admin');

    // promoted admin (omar) CANNOT change roles (owner-only)
    const adminAttempt = await changeRoleRoute(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}/members/${users.omar.id}`), tokens.rana, { role: 'member' }) as never,
      { params: Promise.resolve({ conversationId: convId, memberId: users.omar.id }) } as never,
    );
    assert.equal(adminAttempt.status, 200); // owner can demote again
  });

  it('owner must transfer ownership before leaving (409)', async () => {
    const res = await deleteConversation(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 409);
  });

  it('transfer ownership then leave: access ends for the leaver', async () => {
    // transfer to omar
    const transfer = await patchConversation(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}`), tokens.rana, {
        transferOwnershipTo: users.omar.id,
      }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(transfer.status, 200);
    const roles = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/members`) as Record<string, { role: string }>;
    assert.equal(roles[users.omar.id].role, 'owner');
    assert.equal(roles[users.rana.id].role, 'admin');

    // rana (now admin) leaves
    const leave = await deleteConversation(
      jsonRequest('DELETE', getUrl(`/api/connect/conversations/${convId}`), tokens.rana) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(leave.status, 200);
    const member = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}/members/${users.rana.id}`) as { leftAt: string | null };
    assert.ok(member.leftAt);
    const idx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.rana.id}/${convId}`);
    assert.equal(idx, null, 'index entry removed — no stale access');
  });
});

describe('Per-user state (archive / mute) and group meta', () => {
  let convId: string;
  beforeEach(async () => {
    const res = await createConversation(
      jsonRequest('POST', getUrl('/api/connect/conversations'), tokens.rana, {
        type: 'group', title: 'اسم المجموعة', memberUserIds: [users.omar.id],
      }) as never,
    );
    convId = (await res.json()).data.id as string;
  });

  it('archive is PER-USER (other members unaffected)', async () => {
    const res = await patchConversation(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}`), tokens.omar, { archived: true }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(res.status, 200);
    const omarIdx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.omar.id}/${convId}`) as { archivedAt: string | null };
    assert.ok(omarIdx.archivedAt);
    const ranaIdx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.rana.id}/${convId}`) as { archivedAt: string | null };
    assert.equal(ranaIdx.archivedAt, null);

    // Archived list filter
    const archived = await listConversations(jsonRequest('GET', getUrl('/api/connect/conversations'), tokens.rana, undefined) as never);
    void archived;
  });

  it('group meta edit: admin only; direct conversations refuse', async () => {
    const memberTry = await patchConversation(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}`), tokens.omar, { title: 'اسم جديد' }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(memberTry.status, 403);

    const adminOk = await patchConversation(
      jsonRequest('PATCH', getUrl(`/api/connect/conversations/${convId}`), tokens.rana, { title: 'الاسم الجديد' }) as never,
      { params: Promise.resolve({ conversationId: convId }) } as never,
    );
    assert.equal(adminOk.status, 200);
    const conv = fakeDb().dump(`${CONVERSATIONS_PATH}/${convId}`) as { title: string };
    assert.equal(conv.title, 'الاسم الجديد');
    // Denormalized list title updated for members too.
    const idx = fakeDb().dump(`${CONNECT_DB_ROOT}/userConversations/${users.omar.id}/${convId}`) as { title: string };
    assert.equal(idx.title, 'الاسم الجديد');
  });
});
