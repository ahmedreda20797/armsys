// ══════════════════════════════════════════════════════════════
//  §NOTIFICATIONS-UX — POST /api/notifications/mark-all-read
//
//  The ONE authoritative "mark all read" operation. Contract under
//  test (§NOTIFICATIONS acceptance):
//    1. ONE bulk write — a single updateRecords multi-path call,
//       NEVER a sequential per-record updateRecord fan-out.
//    2. Only the caller's VISIBLE unread notifications are marked
//       (recipient-visibility rule, per record).
//    3. Already-read records are untouched (readAt preserved).
//    4. Server authorization: a caller without notifications:update
//       is denied and NOTHING is written.
//    5. Idempotent: a second pass finds nothing to update.
//
//  Integration tests run the REAL route handler against the
//  in-memory db stubs (m01-test-support) with REAL JWTs.
//
//  Run: npx tsx --test src/app/api/notifications/__tests__/mark-all-read.test.ts
// ══════════════════════════════════════════════════════════════

import '../../../../lib/__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerFixtures,
  registerUser,
  mintToken,
  resetTestData,
  setTable,
  jsonRequest,
  bearerHeaders,
  dbStubs,
  calls,
  type TestTokens,
} from '../../../../lib/__tests__/m01-test-support';
import type { AppNotification } from '@/types';

function notifRow(over: Partial<AppNotification>): Record<string, unknown> {
  return {
    id: 'n-x',
    title: 'تنبيه',
    description: '',
    priority: 'medium',
    status: 'unread',
    category: 'risk',
    sourceModule: 'riskCenter',
    sourceRecordId: null,
    employeeId: null,
    employeeName: null,
    assignedTo: null,
    ruleId: null,
    ruleName: null,
    actionUrl: null,
    sourceType: 'manual',
    targetPage: 'riskCenter',
    createdAt: new Date().toISOString(),
    readAt: null,
    ...over,
  };
}

/** One unread broadcast risk row per scenario. */
function standardTable(): Record<string, unknown>[] {
  return [
    notifRow({ id: 'n1', title: 'مخاطر ١', status: 'unread' }),
    notifRow({ id: 'n2', title: 'مخاطر ٢', status: 'unread', assignedTo: 'u-clerk' }),
    notifRow({ id: 'n3', title: 'مقروء سابقاً', status: 'read', readAt: '2026-09-01T00:00:00.000Z' }),
    notifRow({ id: 'n4', title: 'كابا مخفي', status: 'unread', category: 'capa', targetPage: 'capa' }),
    notifRow({ id: 'n5', title: 'سفر', status: 'unread', category: 'travel', targetPage: 'travel' }),
  ];
}

describe('POST /api/notifications/mark-all-read', () => {
  let route: { POST: (req: Request) => Promise<Response> };
  let t: TestTokens;
  let clerkToken = '';

  before(async () => {
    route = (await import('@/app/api/notifications/mark-all-read/route')) as unknown as { POST: (req: Request) => Promise<Response> };
  });

  // Each test gets a fresh world (resetTestData clears the registered
  // users, so fixtures + the custom clerk are rebuilt every time).
  beforeEach(async () => {
    resetTestData();
    t = await registerFixtures();
    // A staff user with notifications:update + content permissions that
    // deliberately EXCLUDE capa — proves per-record visibility inside
    // the bulk operation (stored permissions override the role preset).
    registerUser({
      id: 'u-clerk',
      email: 'clerk@test.local',
      name: 'موظف',
      role: 'manager',
      permissions: {
        notifications: { level: 'edit', actions: { update: true } },
        riskCenter: 'read',
        travel: 'read',
        capa: 'none',
      },
    });
    clerkToken = await mintToken({ userId: 'u-clerk', email: 'clerk@test.local', role: 'manager' });
    setTable('notifications', standardTable());
  });

  it('admin: marks every visible unread record in ONE bulk write (no per-record fan-out)', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/notifications/mark-all-read', {}, bearerHeaders(t.adminToken)),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.updated, 4); // n1, n2, n4, n5 — n3 already read

    // THE contract: exactly ONE bulk multi-path write, ZERO per-record writes.
    const bulkCalls = calls.filter((c) => c.fn === 'updateRecords');
    const singleCalls = calls.filter((c) => c.fn === 'updateRecord');
    assert.equal(bulkCalls.length, 1, `expected one updateRecords call, got ${bulkCalls.length}`);
    assert.equal(singleCalls.length, 0, 'per-record updateRecord fan-out must not happen');

    const rows = (await dbStubs.getAll('notifications')) as unknown as Record<string, unknown>[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.n1!.status, 'read');
    assert.ok(String(byId.n1!.readAt ?? '').length > 0);
    assert.equal(byId.n2!.status, 'read');
    assert.equal(byId.n5!.status, 'read');
    // already-read record keeps its ORIGINAL readAt
    assert.equal(byId.n3!.readAt, '2026-09-01T00:00:00.000Z');
  });

  it('visibility: a caller marks only what they can SEE — hidden pages stay unread', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/notifications/mark-all-read', {}, bearerHeaders(clerkToken)),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    // clerk: riskCenter read + travel read + capa NONE → n1/n2/n5 yes, n4 no.
    assert.equal(body.updated, 3);

    const rows = (await dbStubs.getAll('notifications')) as unknown as Record<string, unknown>[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.n4!.status, 'unread'); // capa hidden from this caller
    assert.equal(byId.n1!.status, 'read');
    assert.equal(byId.n2!.status, 'read');
    assert.equal(byId.n5!.status, 'read');
  });

  it('authorization: notifications:update is enforced server-side (403, zero writes)', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/notifications/mark-all-read', {}, bearerHeaders(t.managerToken)),
    );
    assert.equal(res.status, 403);
    const bulkCalls = calls.filter((c) => c.fn === 'updateRecords');
    assert.equal(bulkCalls.length, 0, 'no persistence may happen for an unauthorized caller');
    const rows = (await dbStubs.getAll('notifications')) as unknown as Record<string, unknown>[];
    assert.ok(rows.every((r) => r.status !== 'read' || r.id === 'n3'));
  });

  it('unauthenticated requests are rejected', async () => {
    const res = await route.POST(jsonRequest('http://localhost/api/notifications/mark-all-read', {}));
    // the route maps both unauthenticated and forbidden callers to 403
    assert.equal(res.status, 403);
  });

  it('idempotent: a second pass finds nothing to update', async () => {
    await route.POST(jsonRequest('http://localhost/api/notifications/mark-all-read', {}, bearerHeaders(t.adminToken)));
    const res2 = await route.POST(jsonRequest('http://localhost/api/notifications/mark-all-read', {}, bearerHeaders(t.adminToken)));
    assert.equal(res2.status, 200);
    const body = await res2.json();
    assert.equal(body.updated, 0);
    const rows = (await dbStubs.getAll('notifications')) as unknown as Record<string, unknown>[];
    assert.ok(rows.filter((r) => r.status === 'read').length === 5);
  });
});
