// ══════════════════════════════════════════════════════════════
//  §DOWNLOAD-OPT — polling route contracts
//
//  The REAL route handlers (api/notifications, api/notification-stats,
//  api/unseen) run against a counting fake RTDB. Verifies:
//    • N. response shapes are unchanged.
//    • The §DOWNLOAD-OPT TTL.POLL (30s) tier is what the polling
//      routes pass to the shared cache (the mechanism that lets a
//      fleet of pollers share one full-table download).
//    • J. unseen count semantics are unchanged (stamp + author rules).
//    • The auth path still runs the REAL request-scoped memoization
//      code (verify-permission), one users read per request.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Fake RTDB + call recorder ─────────────────────────────────
interface Row { [key: string]: unknown }

const store: Record<string, Record<string, Row>> = {
  users: {
    admin1: {
      email: 'admin@arm.com', role: 'admin', isSuspended: false, positionId: null,
      // employees page configured-'all' scope → scope fast path; followUps
      // non-none so its badge count is actually computed.
      permissions: JSON.stringify({
        employees: { level: 'view', scope: 'all' },
        followUps: { level: 'edit' },
      }),
      linkedEmployeeId: null,
    },
  },
  userSeenState: {
    admin1: {
      userId: 'admin1',
      modules: { followUps: { lastSeenAt: '2026-09-19T10:00:00.000Z' } },
    },
  },
  notifications: {
    n1: { title: 'crit now', description: '', priority: 'critical', status: 'unread', category: 'system', sourceModule: 'manual', createdAt: '2026-09-19T11:59:00.000Z', employeeId: null, assignedTo: null },
    n2: { title: 'high old', description: '', priority: 'high', status: 'unread', category: 'system', sourceModule: 'manual', createdAt: '2026-09-17T11:00:00.000Z', employeeId: null, assignedTo: null },
    n3: { title: 'low read', description: '', priority: 'low', status: 'read', category: 'system', sourceModule: 'manual', createdAt: '2026-09-19T09:00:00.000Z', employeeId: null, assignedTo: null },
  },
  ruleExecutionLogs: {
    r1: { result: 'success', createdAt: '2026-09-19T11:00:00.000Z' },
    r2: { result: 'error', createdAt: '2026-09-19T11:00:00.000Z' },
  },
  followUps: {
    f1: { employeeId: 'e9', responsiblePerson: 'resp1', status: 'open', createdAt: '2026-09-19T11:00:00.000Z', createdById: 'someone-else' },
    f2: { employeeId: 'e9', responsiblePerson: 'resp1', status: 'open', createdAt: '2026-09-19T11:30:00.000Z', createdById: 'admin1' },
    f3: { employeeId: 'e9', responsiblePerson: 'resp1', status: 'open', createdAt: '2026-09-18T00:00:00.000Z', createdById: 'someone-else' },
  },
  qualityDeductions: {},
  qualityObservations: {},
  complaints: {},
  capaCases: {},
  travelDeals: {},
};

const calls: { fn: string; args: unknown[] }[] = [];
function record(fn: string, ...args: unknown[]) { calls.push({ fn, args }); }

function snapshot(rows: Record<string, Row> | undefined) {
  const obj = rows ?? {};
  return {
    exists: () => Object.keys(obj).length > 0,
    val: () => obj,
  };
}

const TTL = { DEFAULT: 5_000, MEDIUM: 15_000, LONG: 30_000, STATIC: 60_000, POLL: 30_000 };

mock.module('server-only', { exports: {} });
mock.module('@/lib/firebase-server', { exports: { getAdminDb: () => ({}) } });

mock.module('@/lib/db', {
  exports: {
    TTL,
    getAll: async (table: string, ttl?: number) => {
      record('getAll', table, ttl);
      return Object.entries(store[table] ?? {}).map(([id, val]) => ({ id, ...val }));
    },
    getAllBatch: async (tables: string[], ttl?: number) => {
      record('getAllBatch', tables, ttl);
      const out = new Map<string, Row[]>();
      for (const t of tables) {
        out.set(t, Object.entries(store[t] ?? {}).map(([id, val]) => ({ id, ...val })));
      }
      return out;
    },
    getById: async (table: string, id: string) => {
      record('getById', table, id);
      const row = store[table]?.[id];
      return row ? { id, ...row } : null;
    },
    countWhere: async () => { record('countWhere'); return 0; },
    updateRecord: async (table: string, id: string, data: Row) => {
      record('updateRecord', table, id, data);
      store[table][id] = { ...store[table][id], ...data };
      return { id, ...store[table][id] };
    },
    createRecord: async (table: string, data: Row) => {
      record('createRecord', table, data);
      const id = `new-${Date.now()}`;
      store[table][id] = data;
      return { id, ...data };
    },
    createRecordWithId: async (table: string, id: string, data: Row) => {
      record('createRecordWithId', table, id, data);
      store[table][id] = data;
      return { id, ...data };
    },
  },
});

mock.module('@/lib/auth', {
  exports: {
    authenticateRequestAsync: async (request: Request) => {
      const header = request.headers.get('authorization') ?? '';
      if (header !== 'Bearer tok-admin') return null;
      return { userId: 'admin1', email: 'admin@arm.com', role: 'admin', type: 'access' };
    },
  },
});

// Real modules under test — loaded AFTER the mocks.
const { GET: notificationsGET } = await import('@/app/api/notifications/route');
const { GET: statsGET } = await import('@/app/api/notification-stats/route');
const { GET: unseenGET } = await import('@/app/api/unseen/route');

function req(url: string): Request {
  return new Request(`http://localhost:3000${url}`, {
    headers: { authorization: 'Bearer tok-admin' },
  });
}
function resetCalls() { calls.length = 0; }
const userReadsThisRequest = () => calls.filter((c) => c.fn === 'getById' && c.args[0] === 'users').length;

describe('§DOWNLOAD-OPT — GET /api/notifications (45s poll path)', () => {
  beforeEach(resetCalls);

  it('N. response contract unchanged: {data, total, unreadCount, limit, offset}', async () => {
    const res = await notificationsGET(req('/api/notifications?limit=50&status=unread') as any);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['data', 'limit', 'offset', 'total', 'unreadCount']);
    assert.equal(body.limit, 50);
    assert.equal(body.offset, 0);
    assert.equal(body.total, 2, 'only unread rows match status=unread');
    assert.equal(body.unreadCount, 2, 'true unread count over ALL visible');
    assert.deepEqual(body.data.map((n: any) => n.id).sort(), ['n1', 'n2']);
    // Read state untouched: the read row is filtered, never mutated.
  });

  it('reads the shared cache with the POLL tier (30s) — the fleet shares one download', async () => {
    await notificationsGET(req('/api/notifications?limit=50&status=unread') as any);
    const getAllCalls = calls.filter((c) => c.fn === 'getAll');
    assert.equal(getAllCalls.length, 1);
    assert.equal(getAllCalls[0].args[0], 'notifications');
    assert.equal(getAllCalls[0].args[1], TTL.POLL, 'TTL.POLL (30s), was TTL.DEFAULT (5s)');
  });
});

describe('§DOWNLOAD-OPT — GET /api/notification-stats (30s AOCC poll path)', () => {
  beforeEach(resetCalls);

  it('N. stats contract unchanged + both reads use the POLL tier', async () => {
    const res = await statsGET(req('/api/notification-stats') as any);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(),
      ['critical', 'escalatedCount', 'overdueCount', 'rulesTriggeredToday', 'todayCount', 'todayGenerated', 'total', 'unread']);
    assert.equal(body.total, 3);
    assert.equal(body.unread, 2);
    assert.equal(body.critical, 1);
    assert.equal(body.rulesTriggeredToday, 1, 'one successful rule log today (admin only)');

    const getAllCalls = calls.filter((c) => c.fn === 'getAll');
    assert.deepEqual(getAllCalls.map((c) => c.args[0]).sort(), ['notifications', 'ruleExecutionLogs']);
    for (const c of getAllCalls) assert.equal(c.args[1], TTL.POLL);
  });
});

describe('§DOWNLOAD-OPT — GET /api/unseen (90s sidebar poll path)', () => {
  beforeEach(resetCalls);

  it('N/J. summary contract + count semantics unchanged (stamp + not-authored-by-me)', async () => {
    const res = await unseenGET(req('/api/unseen') as any);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['counts', 'pending', 'serverTime']);
    assert.equal(body.counts.followUps, 1,
      'f1 counts (after stamp, by someone else); f2 excluded (own) and f3 excluded (before stamp)');
    assert.equal(body.counts.quality ?? 0, 0);
    assert.ok(typeof body.serverTime === 'string');
  });

  it('reads the batch with the POLL tier + resolves scope without extra table reads for an all-scope viewer', async () => {
    await unseenGET(req('/api/unseen') as any);
    const batchCalls = calls.filter((c) => c.fn === 'getAllBatch');
    assert.equal(batchCalls.length, 1);
    assert.equal(batchCalls[0].args[1], TTL.POLL, 'TTL.POLL (30s), was the 5s default');
    const tables = batchCalls[0].args[0] as string[];
    for (const t of ['followUps', 'qualityDeductions', 'qualityObservations', 'complaints', 'capaCases', 'travelDeals']) {
      assert.ok(tables.includes(t), `${t} still monitored`);
    }
    // users read: exactly one (auth memo); the seen-state row: one.
    assert.equal(userReadsThisRequest(), 1, 'request-scoped auth memoization intact (M)');
    assert.equal(calls.filter((c) => c.fn === 'getAll').length, 0, 'no separate getAll fan-out');
  });
});
