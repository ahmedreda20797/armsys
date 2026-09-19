// ══════════════════════════════════════════════════════════════
//  §AUTH-REQUEST-MEMO — request-scoped authentication memoization
//
//  Focused verification that authenticateFromRequest / requireAuth /
//  verifyPermission / verifyAnyAction share ONE user lookup per
//  Request instance, while separate HTTP requests always pay fresh,
//  independent lookups (suspension / role / permission / position
//  changes stay observable). Boundaries mocked: the Admin RTDB
//  (firebase-server) provides a counting fake; the JWT layer
//  (lib/auth) resolves canned Bearer tokens. Everything between —
//  db.getById, permission resolution, authorize() — runs REAL code.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Fake RTDB store + read counter ────────────────────────────
const store = {
  users: {} as Record<string, Record<string, unknown>>,
  positions: {} as Record<string, Record<string, unknown>>,
  tokens: {} as Record<string, { userId: string; email: string; role: string; type: 'access' } | undefined>,
  reads: new Map<string, number>(),
  failNextPath: null as string | null, // one-shot transient failure
};

function resetStore() {
  store.users = {
    u1: {
      email: 'u1@arm.com', role: 'user', isSuspended: false, positionId: null,
      linkedEmployeeId: 'e1',
      permissions: JSON.stringify({
        employees: { level: 'view', scope: 'own' },
        quality: { level: 'edit', actions: { approve: true } },
      }),
    },
    noact: {
      email: 'noact@arm.com', role: 'user', isSuspended: false, positionId: null,
      permissions: JSON.stringify({ quality: { level: 'edit' } }), // edit level, NO action flags
    },
    admin1: {
      email: 'admin@arm.com', role: 'admin', isSuspended: false, positionId: null,
      permissions: JSON.stringify({}),
    },
    pos1: {
      email: 'pos@arm.com', role: 'user', isSuspended: false, positionId: 'p1',
      permissions: JSON.stringify({}),
    },
    susp: {
      email: 'susp@arm.com', role: 'user', isSuspended: true, positionId: null,
      permissions: JSON.stringify({}),
    },
  };
  store.positions = {
    p1: { name: 'Quality Lead', permissions: JSON.stringify({ quality: { level: 'edit', actions: { approve: true, reject: true } } }) },
  };
  store.tokens = {
    'tok-u1': { userId: 'u1', email: 'u1@arm.com', role: 'user', type: 'access' },
    'tok-noact': { userId: 'noact', email: 'noact@arm.com', role: 'user', type: 'access' },
    'tok-admin': { userId: 'admin1', email: 'admin@arm.com', role: 'admin', type: 'access' },
    'tok-pos': { userId: 'pos1', email: 'pos@arm.com', role: 'user', type: 'access' },
    'tok-susp': { userId: 'susp', email: 'susp@arm.com', role: 'user', type: 'access' },
    'tok-ghost': { userId: 'ghost', email: 'ghost@arm.com', role: 'user', type: 'access' },
  };
  store.reads = new Map();
  store.failNextPath = null;
}

function makeSnapshot(obj: Record<string, unknown> | undefined) {
  const empty = !obj || Object.keys(obj).length === 0;
  return { exists: () => !empty, val: () => (empty ? null : obj) };
}

const fakeDb = {
  ref(path: string) {
    return {
      async get() {
        store.reads.set(path, (store.reads.get(path) ?? 0) + 1);
        if (store.failNextPath === path) {
          store.failNextPath = null;
          throw new Error('transient RTDB failure');
        }
        const parts = path.split('/'); // arm_erp/<table>/<id>
        const table = parts[1];
        const id = parts.slice(2).join('/');
        const row = (store as any)[table]?.[id];
        return makeSnapshot(row ? { ...row } : undefined);
      },
    };
  },
};

mock.module('server-only', {
  // No-op stub — same intent as tsconfig.test.json's path mapping,
  // applied directly because this Node/tsx combination resolves the
  // real throwing package inside the CJS transform. The modules under
  // test (db.ts, verify-permission.ts) are otherwise REAL code.
  exports: {},
});

mock.module('@/lib/firebase-server', {
  exports: { getAdminDb: () => fakeDb },
});

mock.module('@/lib/auth', {
  exports: {
    authenticateRequestAsync: async (request: Request) => {
      const header = request.headers.get('authorization') ?? '';
      if (!header.startsWith('Bearer ')) return null;
      return store.tokens[header.slice(7)] ?? null;
    },
  },
});

const {
  authenticateFromRequest,
  requireAuth,
  verifyPermission,
  verifyAnyAction,
  authorize,
  authorizeRequest,
} = await import('@/lib/verify-permission');

// ─── Helpers ───────────────────────────────────────────────────
function reqFor(token: string | null): Request {
  return new Request('http://localhost:3000/api/test', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}
const userReads = (id: string) => store.reads.get(`arm_erp/users/${id}`) ?? 0;
const posReads = (id: string) => store.reads.get(`arm_erp/positions/${id}`) ?? 0;

// ══════════════════════════════════════════════════════════════
//  A / B / C / D — duplicate reads eliminated WITHIN a request
// ══════════════════════════════════════════════════════════════
describe('§AUTH-REQUEST-MEMO — one user lookup per request', () => {
  beforeEach(resetStore);

  it('A. two authenticateFromRequest calls on the SAME request → exactly one users read', async () => {
    const req = reqFor('tok-u1');
    const c1 = await authenticateFromRequest(req);
    const c2 = await authenticateFromRequest(req);
    assert.equal(c1?.userId, 'u1');
    assert.equal(c2?.userId, 'u1');
    assert.equal(userReads('u1'), 1);
  });

  it('B. requireAuth + verifyPermission on the SAME request → one users read (was two)', async () => {
    const req = reqFor('tok-u1');
    const caller = await requireAuth(req);
    const check = await verifyPermission(req, 'employees', 'view');
    assert.equal(caller?.userId, 'u1');
    assert.equal(check.allowed, true);
    assert.equal(check.user?.id, 'u1');
    assert.equal(userReads('u1'), 1);
  });

  it('C. verifyAnyAction over multiple denied actions → ONE users read, same denial text as authorize()', async () => {
    const req = reqFor('tok-noact');
    const result = await verifyAnyAction(req, 'quality', ['approve', 'reject']);
    // Semantics: every action evaluated, none allowed → last action's denial reason
    const caller = await authenticateFromRequest(req);
    const expectedReason = authorize(caller!, { page: 'quality', action: 'reject' }).reason;
    assert.equal(result.allowed, false);
    assert.equal(result.error, expectedReason);
    assert.equal(userReads('noact'), 1, 'one authentication for the whole action list (was N)');
  });

  it('C2. verifyAnyAction allowed path reuses the single lookup', async () => {
    const req = reqFor('tok-u1');
    const result = await verifyAnyAction(req, 'quality', ['reject', 'approve', 'update']);
    assert.equal(result.allowed, true, 'u1 holds the approve action flag');
    assert.equal(result.user?.id, 'u1');
    assert.equal(userReads('u1'), 1);
  });

  it('D. two SEPARATE requests → independent lookups (two reads, fresh data observed)', async () => {
    const req1 = reqFor('tok-u1');
    const c1 = await authenticateFromRequest(req1);
    assert.equal(c1?.role, 'user');

    // Between requests the user's role changes — the next request MUST see it
    store.users.u1.role = 'admin';
    const req2 = reqFor('tok-u1');
    const c2 = await authenticateFromRequest(req2);
    assert.equal(c2?.role, 'admin', 'no cross-request caching of the caller');
    assert.equal(userReads('u1'), 2);
  });

  it('concurrent requests never leak a caller across Request instances', async () => {
    const [a, b] = await Promise.all([
      authenticateFromRequest(reqFor('tok-u1')),
      authenticateFromRequest(reqFor('tok-admin')),
    ]);
    assert.equal(a?.userId, 'u1');
    assert.equal(b?.userId, 'admin1');
    assert.equal(userReads('u1'), 1);
    assert.equal(userReads('admin1'), 1);
  });

  it('a transient lookup FAILURE evicts the memo — the same request may re-attempt', async () => {
    const req = reqFor('tok-u1');
    store.failNextPath = 'arm_erp/users/u1';
    await assert.rejects(() => authenticateFromRequest(req));
    assert.equal(userReads('u1'), 1);

    const caller = await authenticateFromRequest(req); // re-attempt succeeds
    assert.equal(caller?.userId, 'u1');
    assert.equal(userReads('u1'), 2);

    await authenticateFromRequest(req); // settled success is now memoized
    assert.equal(userReads('u1'), 2);
  });

  it('invalid token never reaches the database (JWT gate precedes the user read)', async () => {
    const bad = await verifyPermission(reqFor('bogus-token'), 'employees', 'view');
    assert.equal(bad.allowed, false);
    assert.equal(bad.error, 'لم يتم المصادقة على المستخدم');
    assert.equal(store.reads.size, 0);
  });
});

// ══════════════════════════════════════════════════════════════
//  E / F / G / H — security semantics preserved
// ══════════════════════════════════════════════════════════════
describe('§AUTH-REQUEST-MEMO — security semantics unchanged', () => {
  beforeEach(resetStore);

  it('E. suspension is observed on every NEW request', async () => {
    // Active user authenticates fine…
    const ok = await requireAuth(reqFor('tok-u1'));
    assert.ok(ok);
    // …the suspended account is rejected — fresh lookup, not a cached caller
    const denied = await requireAuth(reqFor('tok-susp'));
    assert.equal(denied, null);
    // And after u1 is suspended mid-session, the NEXT request rejects them
    store.users.u1.isSuspended = true;
    assert.equal(await requireAuth(reqFor('tok-u1')), null);
  });

  it('F. permission changes are visible to the next request (allow → deny)', async () => {
    const before = await verifyPermission(reqFor('tok-u1'), 'employees', 'view');
    assert.equal(before.allowed, true);

    store.users.u1.permissions = JSON.stringify({ employees: { level: 'none' } });
    const after = await verifyPermission(reqFor('tok-u1'), 'employees', 'view');
    assert.equal(after.allowed, false);
    assert.equal(after.error, 'صلاحية غير كافية');
  });

  it('F2. effective permission shape is unchanged (stored override + role preset merge)', async () => {
    const check = await verifyPermission(reqFor('tok-u1'), 'quality', 'approve');
    assert.equal(check.allowed, true);
    const caller = await authenticateFromRequest(reqFor('tok-u1'));
    assert.equal((caller!.permissions.quality as any).level, 'edit');
    assert.equal((caller!.permissions.quality as any).actions?.approve, true);
  });

  it('G. admin (System Owner) bypass is unchanged', async () => {
    const check = await verifyPermission(reqFor('tok-admin'), 'anythingAtAll', 'delete');
    assert.equal(check.allowed, true);
    const decision = await authorizeRequest(reqFor('tok-admin'), { page: 'anythingAtAll', action: 'delete' });
    assert.equal(decision.decision.allowed, true);
    assert.equal(decision.decision.isAdminBypass, true);
    assert.equal(decision.decision.matchedRule, 'admin-bypass');
  });

  it('G2. position template still overlays the effective map (one positions read per fresh lookup)', async () => {
    const req = reqFor('tok-pos');
    const check = await verifyAnyAction(req, 'quality', ['reject']);
    assert.equal(check.allowed, true, 'reject flag comes from the p1 position template');

    const caller = await authenticateFromRequest(req);
    assert.equal(caller?.positionId, 'p1');
    assert.equal((caller!.permissions.quality as any).actions?.reject, true);
    assert.equal(posReads('p1'), 1, 'position lookup shared within the request');

    const req2 = reqFor('tok-pos');
    await authenticateFromRequest(req2);
    assert.equal(posReads('p1'), 2, 'a new request re-reads the position');
  });

  it('H. data-scope resolution is unchanged (stored scope honored; admin unrestricted)', async () => {
    const scoped = await authorizeRequest(reqFor('tok-u1'), { page: 'employees', action: 'view' });
    assert.equal(scoped.decision.allowed, true);
    assert.equal(scoped.decision.scope, 'own');

    const admin = await authorizeRequest(reqFor('tok-admin'), { page: 'employees', action: 'view' });
    assert.equal(admin.decision.scope, 'all');
  });

  it('valid token for a deleted user → null caller (fresh read, no fallback)', async () => {
    assert.equal(await authenticateFromRequest(reqFor('tok-ghost')), null);
    assert.equal(userReads('ghost'), 1);
  });
});
